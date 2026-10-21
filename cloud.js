// 기기 동기화: 우리 집 서버(worker/) + 연결 코드
// Firebase 설정이 없을 때 쓴다. 가족 코드(AI 연결)를 넣으면 이 기기 기록에 연결 코드가 하나 생기고,
// 다른 기기에서 그 연결 코드를 넣으면 같은 기록을 본다. 충돌은 "더 나중에 사람이 바꾼 쪽"이 이긴다.
// 오답 사진은 기록과 따로 올리고, 다른 기기에서는 없는 사진만 내려받는다.

(function () {
  if (window.FIREBASE_CONFIG) return; // Firebase를 쓰면 sync.js가 맡는다

  const PUSH_DELAY = 4000;
  const PULL_EVERY = 2 * 60 * 1000;
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

  function stored(key, make) {
    try {
      let v = localStorage.getItem(key);
      if (!v && make) {
        v = make();
        localStorage.setItem(key, v);
      }
      return v || '';
    } catch (e) {
      return make ? make() : '';
    }
  }

  function setStored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) { /* 저장 못 해도 이번에는 쓴다 */ }
  }

  function randomCode(n) {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  }

  const deviceId = stored('deviceId', () => randomCode(12));

  const cloud = {
    mode: 'code',
    status: 'needsAi', // needsAi | unlinked | connecting | pushing | synced | error
    id: stored('syncId'),
    lastSync: 0,
    error: '',
    schedulePush() {},
    refresh() {},
    link() {},
    unlink() {},
    // 사람이 읽기 쉽게 4자리씩 끊는다
    displayCode() {
      return this.id ? this.id.match(/.{1,4}/g).join('-') : '';
    },
    statusText() {
      switch (this.status) {
        case 'needsAi': return '가족 코드를 넣으면 동기화가 켜져요.';
        case 'unlinked': return '아직 연결 전이에요.';
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

  const settings = () => window.app.getState().settings;
  const base = () => (settings().aiUrl || window.AI_URL || '').replace(/\/+$/, '');
  const ready = () => !!(base() && settings().aiCode);

  async function call(method, path, body) {
    const res = await fetch(`${base()}/sync/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Family-Code': settings().aiCode },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) { /* 빈 답 */ }
    return { status: res.status, data };
  }

  function explain(r) {
    if (r.status === 401) return '가족 코드가 맞지 않아요.';
    if (r.status === 501) return '서버에 동기화 저장소가 아직 없어요. 서버를 다시 올려 주세요.';
    return (r.data && r.data.error) || `서버 오류 (${r.status})`;
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
      const r = await call('PUT', `${cloud.id}/img/${w.id}`, { data: w.img });
      if (r.status === 200) w.cloudImg = true; // 다음 저장 때 이 기기 기록에도 남는다
    }
  }

  async function downloadImages() {
    const missing = window.app.getState().wrongs.filter((w) => w.cloudImg && !w.img);
    if (!missing.length) return;
    let changed = false;
    for (const w of missing) {
      try {
        const r = await call('GET', `${cloud.id}/img/${w.id}`);
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

  async function push() {
    if (!ready() || !cloud.id) return;
    if (busy) {
      cloud.schedulePush();
      return;
    }
    busy = true;
    setStatus('pushing');
    try {
      const state = window.app.getState();
      await uploadImages(state);
      const r = await call('PUT', cloud.id, { state: JSON.stringify(stripped(state)), updatedAt: state.updatedAt || 0, by: deviceId });
      if (r.status === 409) {
        await applyIfNewer(r.data); // 다른 기기에서 더 나중에 고쳤다
        downloadImages();
      } else if (r.status !== 200) {
        throw new Error(explain(r));
      }
      setStatus('synced');
    } catch (e) {
      setStatus('error', e.message === 'Failed to fetch' ? '인터넷 연결을 확인해 주세요.' : e.message);
    }
    busy = false;
  }

  async function pull() {
    if (!ready() || !cloud.id || busy) return;
    busy = true;
    setStatus('connecting');
    try {
      const r = await call('GET', cloud.id);
      busy = false;
      if (r.status === 404) {
        await push(); // 서버에 아직 없으면 이 기기 기록을 올린다
        return;
      }
      if (r.status !== 200) throw new Error(explain(r));
      const local = window.app.getState();
      if ((local.updatedAt || 0) > (r.data.updatedAt || 0)) {
        await push();
        return;
      }
      await applyIfNewer(r.data);
      setStatus('synced');
      downloadImages();
    } catch (e) {
      busy = false;
      setStatus('error', e.message === 'Failed to fetch' ? '인터넷 연결을 확인해 주세요.' : e.message);
    }
  }

  // 처음: 이 기기 기록으로 새 연결 코드를 만든다
  async function create() {
    for (let i = 0; i < 3; i++) {
      const id = randomCode(16);
      const state = window.app.getState();
      const r = await call('PUT', id, { state: JSON.stringify(stripped(state)), updatedAt: state.updatedAt || 0, by: deviceId, create: true });
      if (r.status === 200) {
        cloud.id = id;
        setStored('syncId', id);
        await uploadImages(state);
        setStatus('synced');
        return;
      }
      if (r.status !== 409) throw new Error(explain(r));
    }
    throw new Error('연결 코드를 만들지 못했어요.');
  }

  async function refresh() {
    if (!ready()) {
      setStatus('needsAi');
      return;
    }
    if (!cloud.id) {
      setStatus('connecting');
      try {
        await create();
      } catch (e) {
        setStatus('error', e.message === 'Failed to fetch' ? '인터넷 연결을 확인해 주세요.' : e.message);
      }
      return;
    }
    await pull();
  }

  cloud.refresh = refresh;

  cloud.schedulePush = () => {
    if (!ready() || !cloud.id) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  };

  // 다른 기기의 연결 코드로 바꾼다. 이 기기 기록 대신 그 기기 기록을 쓴다
  cloud.link = async (input) => {
    const id = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (id.length < 12) {
      window.app.toast('연결 코드를 다시 확인해 주세요.');
      return false;
    }
    if (!ready()) {
      window.app.toast('가족 코드를 먼저 넣어 주세요.');
      return false;
    }
    setStatus('connecting');
    try {
      const r = await call('GET', id);
      if (r.status === 404) throw new Error('이 연결 코드의 기록이 없어요. 코드를 다시 확인해 주세요.');
      if (r.status !== 200) throw new Error(explain(r));
      clearTimeout(pushTimer);
      cloud.id = id;
      setStored('syncId', id);
      await window.app.applyRemote(JSON.parse(r.data.state));
      setStatus('synced');
      downloadImages();
      window.app.toast('연결했어요. 이제 두 기기의 기록이 같아요.');
      return true;
    } catch (e) {
      setStatus(cloud.id ? 'error' : 'unlinked', e.message);
      window.app.toast(e.message === 'Failed to fetch' ? '인터넷 연결을 확인해 주세요.' : e.message);
      return false;
    }
  };

  // 이 기기만 연결을 끊는다. 기록은 이 기기에 그대로 남는다
  cloud.unlink = () => {
    clearTimeout(pushTimer);
    cloud.id = '';
    setStored('syncId', '');
    setStatus(ready() ? 'unlinked' : 'needsAi');
  };

  (async () => {
    await window.app.ready;
    await refresh();
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
