// 기기 간 동기화: Firebase (아이디·비밀번호 로그인 + Firestore)
// 기록은 각 기기 IndexedDB에 먼저 저장되고(오프라인에서도 동작), 로그인하면 Firestore 문서 하나로 맞춘다.
// Firebase 로그인은 이메일 형식이 필요해서, 아이디를 "아이디@study-routine.app"으로 바꿔 쓴다 (실제 메일은 가지 않는다).
// 비밀번호 찾기용 이메일(본인이나 부모님)을 등록하면, 그 메일 인증을 마친 뒤부터 계정 이메일이 그 이메일로 바뀐다.
// 그래서 ids/<아이디> 문서에 아이디 → 계정 이메일을 적어 두고, 로그인할 때 찾아 쓴다.
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
  canRecover: true,
  recoveryEmail: '', // 등록한 비밀번호 찾기용 이메일 (인증 전이면 verified: false)
  recoveryVerified: false,
  status: 'unconfigured', // unconfigured | loading | signedOut | connecting | pushing | synced | error
  userId: '',
  lastSync: 0,
  error: '',
  schedulePush() {},
  signUp() {},
  logIn() {},
  logOut() {},
  changePassword() {},
  sendReset() {},
  setRecovery() {},
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
  if (code === 'auth/requires-recent-login') return '보안을 위해 로그아웃했다가 다시 로그인한 뒤 해 주세요.';
  if (code === 'auth/missing-email' || code === 'auth/invalid-new-email') return '이메일 주소를 다시 확인해 주세요.';
  if (code === 'permission-denied') return '권한이 없어요. Firestore 규칙을 게시했는지 확인해 주세요 (FIREBASE_SETUP.md 4번).';
  return (e && e.message) || '알 수 없는 오류';
}

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}
window.maskEmail = maskEmail;

// 로그인한 아이디를 기기에 기억한다 (계정 이메일이 찾기용 이메일로 바뀐 뒤에도 아이디를 보여 주려고)
function readStoredId() {
  try {
    return localStorage.getItem('authId') || '';
  } catch (e) {
    return '';
  }
}

function storeId(id) {
  try {
    localStorage.setItem('authId', id);
  } catch (e) { /* 다음 로그인 때 다시 적는다 */ }
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
    // 아이디는 처음 만든 아이디 이메일에서 (찾기용 이메일로 바뀐 뒤에도 기억해 둔 아이디를 쓴다)
    const fromEmail = String(user.email || '').endsWith(`@${ID_DOMAIN}`) ? String(user.email).split('@')[0] : '';
    cloud.userId = fromEmail || readStoredId() || '';
    if (cloud.userId) storeId(cloud.userId);
    const info = cloud.userId ? await lookup(cloud.userId) : null;
    cloud.recoveryEmail = (info && info.email) || '';
    cloud.recoveryVerified = !!cloud.recoveryEmail && String(user.email || '').toLowerCase() === cloud.recoveryEmail.toLowerCase();
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

  // 아이디 → 계정 정보 (uid, 비밀번호 찾기용 이메일). 아이디를 알아야만 읽을 수 있고, 목록은 볼 수 없다
  async function lookup(id) {
    try {
      const snap = await fb.getDoc(fb.doc(db, 'ids', id));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      return null;
    }
  }

  // 찾기용 이메일로 인증 메일을 보낸다. 링크를 누르면 계정 이메일이 그 주소로 바뀌어 비밀번호 찾기가 된다
  async function startRecovery(user, id, email) {
    await fb.verifyBeforeUpdateEmail(user, email);
    await fb.setDoc(fb.doc(db, 'ids', id), { uid: user.uid, email }, { merge: true });
    cloud.recoveryEmail = email;
    cloud.recoveryVerified = false;
  }

  async function enter(make, id, password, recovery) {
    const clean = String(id || '').trim().toLowerCase();
    if (!ID_RE.test(clean)) {
      window.app.toast('아이디는 영어 소문자·숫자 3~20자로 정해 주세요.');
      return false;
    }
    setStatus('connecting');
    try {
      justLoggedIn = !make;
      if (make) {
        if (await lookup(clean)) {
          const err = new Error('exists');
          err.code = 'auth/email-already-in-use';
          throw err;
        }
        storeId(clean);
        const cred = await fb.createUserWithEmailAndPassword(auth, emailOf(clean), password);
        await fb.setDoc(fb.doc(db, 'ids', clean), { uid: cred.user.uid, email: '' });
        if (recovery) {
          try {
            await startRecovery(cred.user, clean, recovery);
          } catch (e) {
            window.app.toast(`계정은 만들었지만 이메일 등록은 못 했어요: ${friendlyError(e)}`);
          }
        }
      } else {
        // 찾기용 이메일 인증을 마친 계정은 그 이메일로, 아니면 아이디 이메일로 로그인한다
        const info = await lookup(clean);
        storeId(clean);
        try {
          await fb.signInWithEmailAndPassword(auth, info && info.email ? info.email : emailOf(clean), password);
        } catch (e) {
          if (!(info && info.email)) throw e;
          await fb.signInWithEmailAndPassword(auth, emailOf(clean), password); // 아직 인증 전
        }
      }
      window.app.toast(make
        ? `${clean} 계정을 만들었어요.${recovery ? ' 등록한 이메일로 온 인증 메일의 링크를 눌러 주세요.' : ''} 다른 기기에서는 같은 아이디로 로그인하세요.`
        : `${clean}로 로그인했어요.`);
      return true;
    } catch (e) {
      justLoggedIn = false;
      setStatus(auth.currentUser ? cloud.status : 'signedOut');
      window.app.toast(friendlyError(e));
      return false;
    }
  }

  cloud.signUp = (id, password, invite, recovery) => enter(true, id, password, String(recovery || '').trim());
  cloud.logIn = (id, password) => enter(false, id, password);
  cloud.logOut = () => fb.signOut(auth);

  cloud.setRecovery = async (email) => {
    const user = auth.currentUser;
    if (!user || !cloud.userId) return false;
    try {
      await startRecovery(user, cloud.userId, String(email || '').trim());
      window.app.toast('인증 메일을 보냈어요. 메일의 링크를 누르면 등록이 끝나요.');
      window.app.syncChanged();
      return true;
    } catch (e) {
      window.app.toast(friendlyError(e));
      return false;
    }
  };

  // 비밀번호를 잊었을 때: 등록한 이메일로 재설정 링크를 보낸다
  cloud.sendReset = async (id) => {
    const clean = String(id || '').trim().toLowerCase();
    const info = ID_RE.test(clean) ? await lookup(clean) : null;
    if (!info) {
      window.app.toast('그런 아이디가 없어요. 아이디를 다시 확인해 주세요.');
      return false;
    }
    if (!info.email) {
      window.app.toast('이 아이디는 비밀번호 찾기용 이메일이 없어요. 로그인된 다른 기기에서 비밀번호를 바꿔 주세요.');
      return false;
    }
    try {
      await fb.sendPasswordResetEmail(auth, info.email);
      window.app.toast(`${maskEmail(info.email)}로 비밀번호 재설정 메일을 보냈어요. (인증을 마친 이메일만 받을 수 있어요)`);
      return true;
    } catch (e) {
      window.app.toast(friendlyError(e));
      return false;
    }
  };

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
