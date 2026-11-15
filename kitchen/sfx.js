/* 부엌 소리 (Web Audio로 직접 만듦, 음원 파일 없음).
   - 짧고 부드럽게: 높은 삑삑 소리 금지. 걸러진 잡음과 낮은 음 위주.
   - 아이폰 규칙: 첫 터치 뒤에만 소리가 난다 (audio.unlock()).
   - 소리 켜기/끄기는 이 휴대폰에만 저장 (localStorage 'bab.sound').
   - 실제 녹음 소리로 바꿀 때는 SFX 안의 함수만 바꾸면 된다. */

function whiteNoise(ctx) {
  if (!ctx.__white) {
    const n = (ctx.sampleRate * 2) | 0, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    ctx.__white = b;
  }
  return ctx.__white;
}
function brownNoise(ctx) {
  if (!ctx.__brown) {
    const n = (ctx.sampleRate * 4) | 0, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    ctx.__brown = b;
  }
  return ctx.__brown;
}
// 걸러진 잡음 한 번
function burst(ctx, out, t, { f = 800, f2 = 0, q = 1, type = 'bandpass', dur = 0.1, vol = 0.3, att = 0.004 }) {
  const s = ctx.createBufferSource(); s.buffer = whiteNoise(ctx);
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
// 부드러운 음 하나
function tone(ctx, out, t, { f, f2 = 0, dur, vol, type = 'sine', att = 0.005, lp = 0 }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src = o; if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); src = fl; }
  src.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
function bell(ctx, out, t, f, v) {
  tone(ctx, out, t, { f, dur: 1.4, vol: v, att: 0.004 });
  tone(ctx, out, t, { f: f * 1.0035, dur: 1.1, vol: v * 0.4, att: 0.004 });
  tone(ctx, out, t, { f: f * 2, dur: 0.5, vol: v * 0.2, att: 0.003 });
}

export const SFX = {
  // 도마 톡: 짧은 칼질 4번 (톡톡톡톡) — 나무 도마에 닿는 낮은 '톡' + 아주 짧은 칼날 잡음
  tok: (c, o, t) => {
    for (let i = 0; i < 4; i++) {
      const ti = t + i * 0.09 + (i % 2) * 0.012;
      burst(c, o, ti, { f: 2000 + (i % 3) * 260, q: 2.5, dur: 0.03, vol: 0.22, att: 0.002 });
      tone(c, o, ti, { f: 150, f2: 92, dur: 0.06, vol: 0.2 });
    }
  },
  // 재료가 솥에 '퐁'
  plop: (c, o, t) => { tone(c, o, t, { f: 260, f2: 120, dur: 0.14, vol: 0.12 }); burst(c, o, t, { type: 'lowpass', f: 600, dur: 0.08, vol: 0.08 }); },
  // 솥 완성 '뿅': 낮은 음에서 위로 빠르게
  pop: (c, o, t) => {
    tone(c, o, t, { f: 320, f2: 980, dur: 0.16, vol: 0.2, att: 0.004 });
    tone(c, o, t, { f: 160, f2: 420, dur: 0.12, vol: 0.1, att: 0.004 });
    burst(c, o, t, { type: 'lowpass', f: 700, dur: 0.06, vol: 0.12, att: 0.002 });
  },
  // 잘 먹겠습니다: 맑은 종 3음 (위로)
  meal: (c, o, t) => { [[523.25, 0.07], [659.25, 0.065], [783.99, 0.055]].forEach(([f, v], i) => bell(c, o, t + i * 0.16, f, v)); },
  // 밥 됐어요~~~ 부르는 소리: 부드러운 종 두 번 (딩-동, 딩-동)
  call: (c, o, t) => { [[783.99, 0], [659.25, 0.28], [783.99, 0.75], [659.25, 1.03]].forEach(([f, d]) => bell(c, o, t + d, f, 0.06)); },
  // 인사: 작고 둥근 음 두 개
  greet: (c, o, t) => { tone(c, o, t, { f: 587.33, dur: 0.22, vol: 0.07, att: 0.01 }); tone(c, o, t + 0.1, { f: 880, dur: 0.3, vol: 0.05, att: 0.01 }); },
  // 미엘 '야옹' 비슷한 짧은 음 미끄러짐 (아주 작게)
  // 일거리 소리 (톡 누를 때마다 한 번)
  splash: (c, o, t) => { burst(c, o, t, { type: 'lowpass', f: 1400, dur: 0.35, vol: 0.18, att: 0.02 }); for (let i = 0; i < 5; i++) burst(c, o, t + 0.03 + Math.random() * 0.25, { f: 700 + Math.random() * 600, q: 6, dur: 0.08, vol: 0.22 }); }, // 물 첨벙
  crackle: (c, o, t) => { burst(c, o, t, { type: 'lowpass', f: 500, dur: 0.5, vol: 0.12, att: 0.05 }); for (let i = 0; i < 8; i++) burst(c, o, t + Math.random() * 0.5, { f: 2500 + Math.random() * 1500, q: 3, dur: 0.012, vol: 0.2, att: 0.001 }); }, // 장작 타닥
  pluck: (c, o, t) => { tone(c, o, t, { f: 420, f2: 260, dur: 0.09, vol: 0.12, att: 0.003 }); burst(c, o, t, { f: 1800, q: 2, dur: 0.03, vol: 0.12, att: 0.002 }); }, // 톡 따기
  thump: (c, o, t) => { tone(c, o, t, { f: 110, f2: 70, dur: 0.14, vol: 0.25 }); burst(c, o, t, { type: 'lowpass', f: 400, dur: 0.08, vol: 0.18 }); }, // 반죽 쿵
  clink: (c, o, t) => { tone(c, o, t, { f: 1320, dur: 0.25, vol: 0.035, att: 0.002 }); tone(c, o, t + 0.07, { f: 1760, dur: 0.2, vol: 0.025, att: 0.002 }); burst(c, o, t, { f: 1500, q: 3, dur: 0.15, vol: 0.06 }); }, // 그릇 달그락
  swish: (c, o, t) => { burst(c, o, t, { f: 900, f2: 2200, q: 0.8, dur: 0.22, vol: 0.12, att: 0.05 }); }, // 크림 쭉
  // 창밖 새소리 (낮, 아주 작게): 짧은 지저귐 2~3번
  birds: (c, o, t) => { const n = 2 + (Math.random() < 0.5 ? 1 : 0), f = 2100 + Math.random() * 700; for (let i = 0; i < n; i++) tone(c, o, t + i * 0.13, { f: f * (1 + i * 0.06), f2: f * 1.25, dur: 0.09, vol: 0.012, att: 0.01, lp: 3200 }); },
  // 창밖 풀벌레 (밤, 아주 작게): 떨리는 낮은 울음 3번
  crickets: (c, o, t) => { for (let i = 0; i < 3; i++) tone(c, o, t + i * 0.11, { f: 2600, dur: 0.06, vol: 0.007, type: 'triangle', att: 0.01, lp: 2800 }); },
  meow: (c, o, t) => { tone(c, o, t, { f: 620, f2: 880, dur: 0.18, vol: 0.05, type: 'triangle', att: 0.03, lp: 1800 }); tone(c, o, t + 0.17, { f: 880, f2: 560, dur: 0.28, vol: 0.05, type: 'triangle', att: 0.02, lp: 1600 }); },
};

// 솥 끓는 소리 (계속): 낮은 잡음 + 가끔 보글. level 0~1
function simmer(ctx, out) {
  const s = ctx.createBufferSource(); s.buffer = brownNoise(ctx); s.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 420;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  s.connect(fl); fl.connect(g); g.connect(out); s.start();
  let timer = 0, level = 0;
  const bubble = () => {
    if (level > 0.05) { const t = ctx.currentTime + 0.02; tone(ctx, out, t, { f: 180 + Math.random() * 140, f2: 320 + Math.random() * 200, dur: 0.07, vol: 0.03 * level, att: 0.01 }); }
    timer = setTimeout(bubble, 500 + Math.random() * (1600 - level * 1000));
  };
  bubble();
  return {
    set(v) { level = Math.max(0, Math.min(1, v)); g.gain.setTargetAtTime(0.0001 + 0.05 * level, ctx.currentTime, 0.5); },
    stop() { clearTimeout(timer); try { s.stop(); } catch (e) { /* 이미 멈춤 */ } },
  };
}

// 휴대폰 소리 관리: 첫 터치에 켜고, 켜기/끄기 저장
export const audio = {
  ctx: null, out: null, on: true, loop: null,
  init() { try { this.on = localStorage.getItem('bab.sound') !== 'off'; } catch (e) { this.on = true; } },
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      this.ctx = new AC();
      this.out = this.ctx.createGain(); this.out.gain.value = this.on ? 0.9 : 0; this.out.connect(this.ctx.destination);
      this.loop = simmer(this.ctx, this.out);
    } catch (e) { this.ctx = null; }
  },
  set(on) {
    this.on = on; try { localStorage.setItem('bab.sound', on ? 'on' : 'off'); } catch (e) { /* 저장 불가 */ }
    if (this.ctx) this.out.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.08);
  },
  play(name, delay = 0, vol = 1) { // vol: 다른 요리사 소리처럼 작게 낼 때 (0~1)
    if (!this.ctx || !this.on || !SFX[name] || this.ctx.state !== 'running') return;
    let o = this.out;
    if (vol < 1) { o = this.ctx.createGain(); o.gain.value = Math.max(0, vol); o.connect(this.out); setTimeout(() => o.disconnect(), 3000); }
    SFX[name](this.ctx, o, this.ctx.currentTime + 0.01 + delay);
  },
  simmer(v) { if (this.loop) this.loop.set(this.on ? v : 0); },
};
