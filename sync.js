// 기기 간 동기화: Firebase (아이디·비밀번호 로그인 + Firestore)
// 기록은 각 기기 IndexedDB에 먼저 저장되고(오프라인에서도 동작), 로그인하면 Firestore 문서 하나로 맞춘다.
// Firebase 로그인은 이메일 형식이 필요해서, 아이디를 "아이디@study-routine.app"으로 바꿔 쓴다 (실제 메일은 가지 않는다).
// 충돌은 "더 최근에 사람이 바꾼 쪽"이 이긴다. 오답 사진은 문서 크기 제한(1MB) 때문에 따로 저장한다.

const SDK = window.FIREBASE_SDK || 'https://www.gstatic.com/firebasejs/10.12.2';
const PUSH_DELAY = 1500;
const MAX_DOC = 900000;
const ID_DOMAIN = 'study-routine.app';
const ID_RE = /^[a-z0-9_]{3,20}$/;

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

// app.js의 동기화 칸(loginSyncCard)이 쓰는 모양: cloud.js와 같다
const cloud = {
  mode: 'login',
  needsInvite: false,
  status: 'unconfigured', // unconfigured | loading | signedOut | connecting | pushing | synced | error
  userId: '',
  lastSync: 0,
  error: '',
  schedulePush() {},
  signUp() {},
  logIn() {},
  logOut() {},
  changePassword() {},
  statusText() {
    switch (this.status) {
      case 'loading': return '연결 준비 중…';
      case 'signedOut': return '로그인하면 아이패드와 휴대폰 기록이 저절로 맞춰져요.';
      case 'connecting': return '기록을 맞추는 중…';
      case 'pushing': return '올리는 중…';
      case 'synced': return `동기화됨${this.lastSync ? ` (${new Date(this.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})` : ''}`;
      case 'error': return `동기화 오류: ${this.error}`;
      default: return '';
    }
  },
  badge() {
    return { connecting: '맞추는 중', pushing: '올리는 중', synced: '동기화됨', error: '동기화 오류' }[this.status] || '';
  },
};
// Firebase 설정이 없으면 cloud.js(우리 집 서버)가 맡는다
if (window.FIREBASE_CONFIG || !window.cloud) window.cloud = cloud;

function setStatus(status, error = '') {
  cloud.status = status;
  cloud.error = error;
  if (status === 'synced') cloud.lastSync = Date.now();
  if (window.app) window.app.syncChanged();
}

function friendlyError(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/email-already-in-use') return '이미 있는 아이디예요. 다른 아이디로 정하거나 로그인해 주세요.';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) return '아이디나 비밀번호가 맞지 않아요.';
  if (code === 'auth/weak-password') return '비밀번호는 6자 이상으로 정해 주세요.';
  if (code === 'auth/invalid-email') return '아이디는 영어 소문자·숫자 3~20자로 정해 주세요.';
  if (code === 'auth/too-many-requests') return '여러 번 틀렸어요. 잠시 뒤에 다시 해 주세요.';
  if (code === 'auth/operation-not-allowed') return 'Firebase에서 이메일/비밀번호 로그인이 꺼져 있어요 (FIREBASE_SETUP.md 2번).';
  if (code === 'auth/network-request-failed' || code === 'unavailable') return '인터넷 연결을 확인해 주세요.';
  if (code === 'permission-denied') return '권한이 없어요. Firestore 규칙을 게시했는지 확인해 주세요 (FIREBASE_SETUP.md 4번).';
  return (e && e.message) || '알 수 없는 오류';
}

function hasOwnRecords(state) {
  return (state.sessions || []).length > 0 || (state.wrongs || []).length > 0 || (state.logs || []).length > 0;
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
  if (window.FIREBASE_EMULATOR) {
    fb.connectAuthEmulator(auth, window.FIREBASE_EMULATOR.auth, { disableWarnings: true });
    fb.connectFirestoreEmulator(db, ...window.FIREBASE_EMULATOR.firestore);
  }
  let ref = null;
  let unsubscribe = null;
  let pushTimer = null;
  // 방금 로그인한 기기: 계정 기록을 받을지, 이 기기 기록을 올릴지 한 번 정한다
  let justLoggedIn = false;

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
      await fb.setDoc(ref, { state: body, updatedAt: state.updatedAt || Date.now(), by: deviceId }, { merge: true });
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
    const local = window.app.getState();
    const localAt = local.updatedAt || 0;
    const remoteAt = data.updatedAt || 0;
    if (justLoggedIn) {
      justLoggedIn = false;
      // 이 기기에도 공부 기록이 있으면 어느 쪽을 쓸지 묻는다
      if (data.state && hasOwnRecords(local)
        && !confirm(`${cloud.userId} 계정에 저장된 기록을 이 기기로 가져올까요?\n취소를 누르면 이 기기 기록을 계정에 올려요.`)) {
        await push();
        return;
      }
      if (data.state) {
        await window.app.applyRemote(JSON.parse(data.state));
        setStatus('synced');
        downloadImages();
        return;
      }
    }
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

  // 계정마다 기록 문서 하나 (households/<uid>). 처음이면 이 기기 기록으로 만든다
  async function openHousehold(user) {
    const own = fb.doc(db, 'households', user.uid);
    const snap = await fb.getDoc(own);
    if (!snap.exists()) {
      const state = window.app.getState();
      await fb.setDoc(own, { createdAt: Date.now(), state: JSON.stringify(stripped(state)), updatedAt: state.updatedAt || 0, by: deviceId });
      ref = own;
      justLoggedIn = false;
      await uploadImages(state);
    }
    return own;
  }

  fb.onAuthStateChanged(auth, async (user) => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    ref = null;
    if (!user) {
      cloud.userId = '';
      setStatus('signedOut');
      return;
    }
    cloud.userId = String(user.email || '').split('@')[0];
    setStatus('connecting');
    try {
      ref = await openHousehold(user);
      unsubscribe = fb.onSnapshot(ref, (snap) => { onRemote(snap); }, (e) => setStatus('error', friendlyError(e)));
    } catch (e) {
      setStatus('error', friendlyError(e));
    }
  });

  function emailOf(id) {
    return `${String(id || '').trim().toLowerCase()}@${ID_DOMAIN}`;
  }

  async function enter(make, id, password) {
    const clean = String(id || '').trim().toLowerCase();
    if (!ID_RE.test(clean)) {
      window.app.toast('아이디는 영어 소문자·숫자 3~20자로 정해 주세요.');
      return false;
    }
    setStatus('connecting');
    try {
      justLoggedIn = !make;
      if (make) await fb.createUserWithEmailAndPassword(auth, emailOf(clean), password);
      else await fb.signInWithEmailAndPassword(auth, emailOf(clean), password);
      window.app.toast(make ? `${clean} 계정을 만들었어요. 다른 기기에서 같은 아이디로 로그인하세요.` : `${clean}로 로그인했어요.`);
      return true;
    } catch (e) {
      justLoggedIn = false;
      setStatus(auth.currentUser ? cloud.status : 'signedOut');
      window.app.toast(friendlyError(e));
      return false;
    }
  }

  cloud.signUp = (id, password) => enter(true, id, password);
  cloud.logIn = (id, password) => enter(false, id, password);
  cloud.logOut = () => fb.signOut(auth);

  cloud.changePassword = async (old, password) => {
    const user = auth.currentUser;
    if (!user) return false;
    try {
      await fb.reauthenticateWithCredential(user, fb.EmailAuthProvider.credential(user.email, old));
      await fb.updatePassword(user, password);
      window.app.toast('비밀번호를 바꿨어요.');
      return true;
    } catch (e) {
      window.app.toast(friendlyError(e));
      return false;
    }
  };
}

if (window.FIREBASE_CONFIG) {
  start(window.FIREBASE_CONFIG);
} else if (window.app && window.cloud === cloud) {
  window.app.syncChanged();
}
