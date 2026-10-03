// 기기 간 동기화: Google 로그인 + Firestore
// 기록은 각 기기 IndexedDB에 먼저 저장되고(오프라인에서도 동작), 로그인하면 Firestore 문서 하나로 맞춘다.
// 충돌은 "더 최근에 사람이 바꾼 쪽"이 이긴다. 오답 사진은 문서 크기 제한(1MB) 때문에 따로 저장한다.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const PUSH_DELAY = 1500;
const MAX_DOC = 900000;

function readDeviceId() {
  try {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('deviceId', id);
    }
    return id;
  } catch (e) {
    return Math.random().toString(36).slice(2);
  }
}

const deviceId = readDeviceId();

const cloud = {
  status: 'unconfigured', // unconfigured | loading | signedOut | connecting | synced | pushing | error
  email: '',
  members: [],
  ownerEmail: '',
  lastSync: 0,
  error: '',
  schedulePush() {},
  signIn() {},
  signOut() {},
  addMember() {},
  removeMember() {},
  statusText() {
    switch (this.status) {
      case 'loading': return '연결 준비 중…';
      case 'signedOut': return '로그인하지 않았어요. 기록은 이 기기에만 있어요.';
      case 'connecting': return '온라인 기록과 맞추는 중…';
      case 'pushing': return '올리는 중…';
      case 'synced': return `동기화됨${this.lastSync ? ` (${new Date(this.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})` : ''}`;
      case 'error': return `동기화 오류: ${this.error}`;
      default: return '';
    }
  },
  badge() {
    return { loading: '연결 중', signedOut: '로그인 필요', connecting: '맞추는 중', pushing: '올리는 중', synced: '동기화됨', error: '동기화 오류' }[this.status] || '';
  },
};
window.cloud = cloud;

function setStatus(status, error = '') {
  cloud.status = status;
  cloud.error = error;
  if (status === 'synced') cloud.lastSync = Date.now();
  if (window.app) window.app.syncChanged();
}

function friendlyError(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/popup-blocked') return '팝업이 막혔어요. Safari 설정에서 팝업 차단을 끄거나 다시 눌러 주세요.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '로그인 창이 닫혔어요.';
  if (code === 'auth/unauthorized-domain') return '이 주소가 Firebase 승인된 도메인에 없어요 (FIREBASE_SETUP.md 3번).';
  if (code === 'auth/operation-not-supported-in-this-environment') return '홈 화면 앱에서는 로그인이 안 될 수 있어요. Safari에서 열어 로그인해 주세요.';
  if (code === 'permission-denied') return '권한이 없어요. 가족으로 추가됐는지, Firestore 규칙을 게시했는지 확인해 주세요.';
  if (code === 'unavailable') return '인터넷 연결을 확인해 주세요.';
  return (e && e.message) || '알 수 없는 오류';
}

async function start(config) {
  await window.app.ready;
  setStatus('loading');
  let fb;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    fb = { ...appMod, ...authMod, ...fsMod };
  } catch (e) {
    setStatus('error', 'Firebase를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    return;
  }

  const firebaseApp = fb.initializeApp(config);
  const auth = fb.getAuth(firebaseApp);
  const db = fb.getFirestore(firebaseApp);
  let ref = null;
  let unsubscribe = null;
  let pushTimer = null;

  // 사진을 뺀 기록. 사진이 있던 오답에는 cloudImg 표시만 남긴다
  function stripped(state) {
    const copy = JSON.parse(JSON.stringify(state));
    copy.wrongs.forEach((w) => {
      if (w.img) {
        w.cloudImg = true;
        delete w.img;
      }
    });
    return copy;
  }

  async function uploadImages(state) {
    for (const w of state.wrongs) {
      if (!w.img || w.cloudImg) continue;
      await fb.setDoc(fb.doc(ref, 'images', w.id), { data: w.img });
      w.cloudImg = true; // 다음 저장 때 이 기기 기록에도 남는다
    }
  }

  async function downloadImages() {
    const state = window.app.getState();
    const missing = state.wrongs.filter((w) => w.cloudImg && !w.img);
    if (!missing.length) return;
    let changed = false;
    for (const w of missing) {
      try {
        const snap = await fb.getDoc(fb.doc(ref, 'images', w.id));
        if (snap.exists()) {
          w.img = snap.data().data;
          changed = true;
        }
      } catch (e) {
        // 사진 하나 실패해도 나머지 기록은 계속 쓴다
      }
    }
    if (changed) await window.app.applyRemote(window.app.getState());
  }

  async function push() {
    if (!ref) return;
    const state = window.app.getState();
    const body = JSON.stringify(stripped(state));
    if (body.length > MAX_DOC) {
      setStatus('error', '기록이 너무 커졌어요. 백업 후 오래된 기록 정리가 필요해요.');
      return;
    }
    setStatus('pushing');
    try {
      await uploadImages(state);
      await fb.updateDoc(ref, { state: body, updatedAt: state.updatedAt || Date.now(), by: deviceId });
      setStatus('synced');
    } catch (e) {
      setStatus('error', friendlyError(e));
    }
  }

  cloud.schedulePush = () => {
    if (!ref) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  };

  async function onRemote(snap) {
    if (!snap.exists()) return;
    const data = snap.data();
    cloud.members = data.members || [];
    cloud.ownerEmail = data.ownerEmail || '';
    const local = window.app.getState();
    const localAt = local.updatedAt || 0;
    const remoteAt = data.updatedAt || 0;
    // 내가 올린 내용이 되돌아온 것이면 다시 적용하지 않는다
    if (data.by === deviceId && remoteAt <= localAt) {
      setStatus('synced');
      return;
    }
    if (data.state && remoteAt > localAt) {
      await window.app.applyRemote(JSON.parse(data.state));
      setStatus('synced');
      downloadImages();
    } else if (localAt > remoteAt) {
      cloud.schedulePush();
    } else {
      setStatus('synced');
    }
  }

  // 내가 속한 가족 기록 찾기: 내가 만든 문서 → 가족으로 추가된 문서 → 없으면 새로 만들기
  async function findHousehold(user) {
    const own = fb.doc(db, 'households', user.uid);
    try {
      const snap = await fb.getDoc(own);
      if (snap.exists()) return own;
    } catch (e) {
      if (e.code !== 'permission-denied') throw e; // 문서가 없으면 규칙상 권한 오류로 온다
    }
    const q = fb.query(fb.collection(db, 'households'), fb.where('members', 'array-contains', user.email), fb.limit(1));
    const found = await fb.getDocs(q);
    if (!found.empty) return found.docs[0].ref;

    const state = window.app.getState();
    await fb.setDoc(own, {
      members: [user.email],
      owner: user.uid,
      ownerEmail: user.email,
      createdAt: Date.now(),
      state: JSON.stringify(stripped(state)),
      updatedAt: state.updatedAt || 0,
      by: deviceId,
    });
    ref = own;
    await uploadImages(state);
    return own;
  }

  fb.onAuthStateChanged(auth, async (user) => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    ref = null;
    if (!user) {
      cloud.email = '';
      cloud.members = [];
      setStatus('signedOut');
      return;
    }
    cloud.email = user.email;
    setStatus('connecting');
    try {
      ref = await findHousehold(user);
      unsubscribe = fb.onSnapshot(ref, (snap) => { onRemote(snap); }, (e) => setStatus('error', friendlyError(e)));
    } catch (e) {
      setStatus('error', friendlyError(e));
    }
  });

  cloud.signIn = async () => {
    try {
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
    } catch (e) {
      setStatus(cloud.email ? cloud.status : 'signedOut');
      window.app.toast(friendlyError(e));
    }
  };

  cloud.signOut = () => fb.signOut(auth);

  cloud.addMember = async (email) => {
    const clean = String(email || '').trim().toLowerCase();
    if (!ref || !clean) return;
    try {
      await fb.updateDoc(ref, { members: fb.arrayUnion(clean) });
      window.app.toast(`${clean}을(를) 가족으로 추가했어요.`);
    } catch (e) {
      window.app.toast(friendlyError(e));
    }
  };

  cloud.removeMember = async (email) => {
    if (!ref || email === cloud.email || email === cloud.ownerEmail) return;
    try {
      await fb.updateDoc(ref, { members: fb.arrayRemove(email) });
    } catch (e) {
      window.app.toast(friendlyError(e));
    }
  };
}

if (window.FIREBASE_CONFIG) {
  start(window.FIREBASE_CONFIG);
} else if (window.app) {
  window.app.syncChanged();
}
