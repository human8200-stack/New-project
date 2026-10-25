// 화면들이 같이 쓰는 작은 도구
// 이 브라우저가 진행하는 행사들 [{ id, key, name, at }] (진행자 키는 여기에만 있다)
const hosts = {
  list() {
    try { return JSON.parse(store('ld_hosts') || '[]'); } catch { return []; }
  },
  save(list) { store('ld_hosts', JSON.stringify(list)); },
  get(id) { return this.list().find((h) => h.id === id); },
  put(h) { this.save([{ ...this.get(h.id), ...h }, ...this.list().filter((x) => x.id !== h.id)]); },
  remove(id) { this.save(this.list().filter((x) => x.id !== id)); },
};

async function api(path, options = {}) {
  const headers = options.body ? { 'Content-Type': 'application/json' } : {};
  const m = path.match(/^events\/([a-z0-9]+)/);
  const host = m && hosts.get(m[1]);
  if (host) headers['X-Host-Key'] = host.key;
  const res = await fetch(`/api/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error === 'NO_DB' ? '데이터베이스가 아직 연결되지 않았어요' : data.error || `오류 (${res.status})`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return value;
}

// 빵빠레 꽃가루
function confetti(ms = 3200) {
  const c = el('canvas', { class: 'confetti' });
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const colors = ['#ff5a3c', '#ffb800', '#2ec4b6', '#7b61ff', '#ff6fb5', '#1f9d61'];
  const bits = Array.from({ length: 180 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 16 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const b of bits) {
      b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (now - start < ms) requestAnimationFrame(frame);
    else c.remove();
  })(start);
}

// 룰렛·이름 뽑기 소리 (작은 딸깍, 당첨 팡파레)
const sound = {
  ctx: null,
  on: store('ld_sound') !== 'off',
  get() {
    if (!this.on) return null;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { return null; }
    return this.ctx;
  },
  tone(freq, dur, type = 'square', gain = 0.05, at = 0) {
    const ctx = this.get();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur);
  },
  tick() { this.tone(1200, 0.03, 'square', 0.03); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.08, i * 0.12)); },
};
