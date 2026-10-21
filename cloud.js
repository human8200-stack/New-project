// 기기 동기화: 우리 집 서버(worker/) + 아이디·비밀번호 로그인
// Firebase 설정이 없을 때 쓴다. 기기마다 같은 아이디로 로그인하면 기록이 저절로 맞춰진다.
// 충돌은 "더 나중에 사람이 바꾼 쪽"이 이긴다. 오답 사진은 기록과 따로 올리고, 없는 사진만 내려받는다.

(function () {
  if (window.FIREBASE_CONFIG) return; // Firebase를 쓰면 sync.js가 맡는다

  const PUSH_DELAY = 4000;
  const PULL_EVERY = 2 * 60 * 1000;

  function stored(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function setStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) { /* 저장 못 해도 이번에는 쓴다 */ }
  }

  let deviceId = stored('deviceId');
  if (!deviceId) {
    deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    setStored('deviceId', deviceId);
  }

  const cloud = {
    mode: 'login',
    status: 'noServer', // noServer | signedOut | connecting | pushing | synced | error
    userId: stored('authId'),
    lastSync: 0,
    error: '',
    schedulePush() {},
    signUp() {},
    logIn() {},
    logOut() {},
    changePassword() {},
    statusText() {
      switch (this.status) {
        case 'noServer': return '부모님이 우리 집 서버를 올리면 로그인할 수 있어요.';
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
  window.cloud = cloud;

  function setStatus(status, error = '') {
    cloud.status = status;
    cloud.error = error;
    if (status === 'synced') cloud.lastSync = Date.now();
    if (window.app) window.app.syncChanged();
  }

  const base = () => (window.app.getState().settings.aiUrl || window.AI_URL || '').replace(/\/+$/, '');
  const token = () => stored('authToken');
  const signedIn = () => !!(base() && token());

  function friendly(e) {
    return e && e.message === 'Failed to fetch' ? '인터넷 연결을 확인해 주세요.' : (e && e.message) || '알 수 없는 오류';
  }

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(`${base()}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try {
      data = await res.json();
    } catch (e) { /* 빈 답 */ }
    // 로그인이 풀렸으면 (토큰이 만료되거나 다른 기기에서 비밀번호를 바꿈) 다시 로그인하게
    if (res.status === 401 && path.startsWith('me/')) {
      forget();
      throw new Error('다시 로그인해 주세요.');
    }
    return { status: res.status, data };
  }

  function explain(r) {
    if (r.status === 501) return '서버에 동기화 저장소가 아직 없어요. 서버를 다시 올려 주세요.';
    return (r.data && r.data.error) || `서버 오류 (${r.status})`;
  }

  function forget() {
    clearTimeout(pushTimer);
    setStored('authToken', '');
    setStored('authId', '');
    cloud.userId = '';
    setStatus(base() ? 'signedOut' : 'noServer');
  }

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
      const r = await call('PUT', `me/img/${w.id}`, { data: w.img });
      if (r.status === 200) w.cloudImg = true; // 다음 저장 때 이 기기 기록에도 남는다
    }
  }

  async function downloadImages() {
    const missing = window.app.getState().wrongs.filter((w) => w.cloudImg && !w.img);
    if (!missing.length) return;
    let changed = false;
    for (const w of missing) {
      try {
        const r = await call('GET', `me/img/${w.id}`);
        if (r.status === 200 && r.data && r.data.data) {
          w.img = r.data.data;
          changed = true;
        }
      } catch (e) { /* 사진 하나 실패해도 나머지 기록은 계속 쓴다 */ }
    }
    if (changed) await window.app.applyRemote(window.app.getState());
  }

  async function applyIfNewer(record) {
    const local = window.app.getState();
    if (!record || typeof record.state !== 'string' || (record.updatedAt || 0) <= (local.updatedAt || 0)) return false;
    await window.app.applyRemote(JSON.parse(record.state));
    return true;
  }

  let pushTimer = null;
  let busy = false;

  async function push(force = false) {
    if (!signedIn()) return;
    if (busy) {
      cloud.schedulePush();
      return;
    }
    busy = true;
    setStatus('pushing');
    try {
      const state = window.app.getState();
      await uploadImages(state);
      const r = await call('PUT', 'me/state', { state: JSON.stringify(stripped(state)), updatedAt: state.updatedAt || 0, by: deviceId, force });
      if (r.status === 409) {
        await applyIfNewer(r.data); // 다른 기기에서 더 나중에 고쳤다
        downloadImages();
      } else if (r.status !== 200) {
        throw new Error(explain(r));
      }
      setStatus('synced');
    } catch (e) {
      if (signedIn()) setStatus('error', friendly(e));
    }
    busy = false;
  }

  async function pull() {
    if (!signedIn() || busy) return;
    busy = true;
    setStatus('connecting');
    try {
      const r = await call('GET', 'me/state');
      busy = false;
      if (r.status === 404) {
        await push(); // 계정에 아직 없으면 이 기기 기록을 올린다
        return;
      }
      if (r.status !== 200) throw new Error(explain(r));
      if ((window.app.getState().updatedAt || 0) > (r.data.updatedAt || 0)) {
        await push();
        return;
      }
      await applyIfNewer(r.data);
      setStatus('synced');
      downloadImages();
    } catch (e) {
      busy = false;
      if (signedIn()) setStatus('error', friendly(e));
    }
  }

  cloud.schedulePush = () => {
    if (!signedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(), PUSH_DELAY);
  };

  // 공부 기록이 조금이라도 쌓인 기기인지 (처음 연 기기면 계정 기록을 그냥 받는다)
  function hasOwnRecords(state) {
    return (state.sessions || []).length > 0 || (state.wrongs || []).length > 0 || (state.logs || []).length > 0;
  }

  async function afterAuth(r, isNew) {
    if (r.status !== 200) throw new Error(explain(r));
    setStored('authToken', r.data.token);
    setStored('authId', r.data.id);
    cloud.userId = r.data.id;
    setStatus('connecting');
    if (isNew) {
      await push(true); // 새 계정: 이 기기 기록이 첫 기록
      return;
    }
    const got = await call('GET', 'me/state');
    if (got.status === 404) {
      await push(true);
      return;
    }
    if (got.status !== 200) throw new Error(explain(got));
    const local = window.app.getState();
    // 이 기기에도 기록이 있으면 어느 쪽을 쓸지 묻는다
    if (hasOwnRecords(local) && !confirm(`${r.data.id} 계정에 저장된 기록을 이 기기로 가져올까요?\n취소를 누르면 이 기기 기록을 계정에 올려요.`)) {
      await push(true);
      return;
    }
    clearTimeout(pushTimer);
    await window.app.applyRemote(JSON.parse(got.data.state));
    setStatus('synced');
    downloadImages();
  }

  async function auth(path, body, isNew) {
    if (!base()) {
      window.app.toast('아직 우리 집 서버가 없어요.');
      return false;
    }
    setStatus('connecting');
    try {
      await afterAuth(await call('POST', path, body), isNew);
      window.app.toast(isNew ? `${cloud.userId} 계정을 만들었어요. 다른 기기에서 같은 아이디로 로그인하세요.` : `${cloud.userId}로 로그인했어요.`);
      return true;
    } catch (e) {
      if (!token()) setStatus('signedOut');
      else setStatus('error', friendly(e));
      window.app.toast(friendly(e));
      return false;
    }
  }

  cloud.signUp = (id, password, invite) => auth('auth/signup', { id, password, invite }, true);
  cloud.logIn = (id, password) => auth('auth/login', { id, password }, false);

  cloud.logOut = async () => {
    try {
      await call('POST', 'auth/logout', {});
    } catch (e) { /* 서버에 못 알려도 이 기기에서는 로그아웃 */ }
    forget();
  };

  cloud.changePassword = async (old, password) => {
    try {
      const r = await call('POST', 'auth/password', { old, password });
      if (r.status !== 200) throw new Error(explain(r));
      window.app.toast('비밀번호를 바꿨어요. 다른 기기는 로그인된 그대로예요.');
      return true;
    } catch (e) {
      window.app.toast(friendly(e));
      return false;
    }
  };

  (async () => {
    await window.app.ready;
    if (!base()) setStatus('noServer');
    else if (!token()) setStatus('signedOut');
    else await pull();
    // 다른 기기에서 고친 것을 받아 온다: 화면에 돌아올 때, 그리고 켜 둔 동안 2분마다
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pull();
      else if (pushTimer) {
        clearTimeout(pushTimer);
        push(); // 앱을 내리기 전에 바로 올린다
      }
    });
    setInterval(() => { if (document.visibilityState === 'visible') pull(); }, PULL_EVERY);
  })();
})();
