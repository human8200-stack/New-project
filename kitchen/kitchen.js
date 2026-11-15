/* 밥 짓는 집 (가칭) — 링크로 들어오는 온라인 부엌 한 칸.
   - 장소(배경·소품·소리·카드)는 places.js · 별명은 names.js · 카드는 cards/ · 한마디 거르기는 notes-rules.js
   - 서버(config.js SERVER)가 없으면 "혼자 도는 부엌": 나 + 그 부엌의 주인·일꾼 연출 캐릭터 + 미엘. 사람 수는 보이지 않는다.
   - 손님처럼 보이는 가짜 사람은 만들지 않는다 (회장님 11/15). 연출 캐릭터는 역할 이름표를 달고 사람 수에 안 셈.
   - 솥 한 바퀴 = 3분. 서버 없이 시각으로 계산해서 모두 같은 때에 "잘 먹겠습니다" (Date.now() % 3분).
   - 장면 안에는 글자·로고가 없다 (이름표·인사 말풍선만).
   - 미리보기 주소: ?place=tuscany · ?place=paris · ?hour=21 (밤) · ?at=158 (솥이 다 되기 2초 전부터) */
import * as THREE from './vendor/three.module.min.js';
import { NAMES } from './names.js';
import { PLACES, DEFAULT_PLACE, PLACE_ORDER } from './places.js';
import { audio } from './sfx.js';
import { createNet } from './net.js';
import { SERVER } from './config.js';
import { checkNote, checkName, NOTE_MAX, REPLY_MAX, NOTE_DAY_LIMIT, NOTE_WHY } from './notes-rules.js';
import { LIVE } from './live.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const PLACE_KEY = PLACES[Q.get('place')] ? Q.get('place') : DEFAULT_PLACE;
const P = PLACES[PLACE_KEY];
const HOUR_FIX = Q.has('hour') ? Math.max(0, Math.min(23.99, parseFloat(Q.get('hour')) || 0)) : null;
const AT = Q.has('at') ? Math.max(0, Math.min(179, parseFloat(Q.get('at')) || 0)) : null;
document.documentElement.dataset.place = PLACE_KEY;
// 시험용: 이 컴퓨터(localhost)에서 열 때만 ?server=ws://localhost:8787 로 내 컴퓨터 서버에 붙음. 실제 주소에서는 무시
const SERVER_URL = (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(Q.get('server') || '')) ? Q.get('server') : SERVER;

/* ---------------- 솥 한 바퀴 (3분) ---------------- */
// 0:00 요리 → 2:00 "밥 됐어요~~~" (상에 모이기 30초) → 2:30 다 같이 "잘 먹겠습니다" → 2:56 다 먹음 → 3:00 다음 솥
const PERIOD = 180000, CALL_AT = 120000, MEAL_AT = 150000, MEAL_END = 176000;
const JOBS = (P.jobs && P.jobs.length ? P.jobs : [{ id: 'table', name: '요리하기', who: '요리하는', tap: '도마 톡', icon: '🔪', act: 'chop', sound: 'tok' }]);
const GREETS = P.greets || ['밥 먹었어요?', '맛있게 드세요', '잘 먹었습니다']; // 장소마다 첫 인사가 다름 (서버는 번호만)
let atShift = AT == null ? 0 : AT * 1000 - (Date.now() % PERIOD);
let net = null;
const clock = () => (net && net.online ? net.now() : Date.now()) + atShift;
const phaseOf = (t) => ((t % PERIOD) + PERIOD) % PERIOD;
const kstDayIndex = () => Math.floor((Date.now() + 9 * 3600e3) / 86400e3);
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* ---------------- 이 휴대폰에만 저장하는 것 (개인정보 아님) ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('bab.' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bab.' + k, v); } catch (e) { /* 사생활 보호 모드 — 무시 */ } },
};
const randomName = () => NAMES[Math.floor(Math.random() * NAMES.length)] || '손님';
let myStyle = store.get('style', ''); if (myStyle !== 'f' && myStyle !== 'm') myStyle = Math.random() < 0.5 ? 'f' : 'm'; // 한옥 차림: 'f' 쪽 · 'm' 갓 (처음엔 무작위)
let myName = store.get('myname', ''); if (!checkName(myName).ok) myName = randomName(); // 이 안에서 불릴 이름 (입장 화면에서 고침)
let devId = store.get('dev', '');
if (!/^[a-z0-9]{16,40}$/.test(devId)) { devId = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); store.set('dev', devId); }

/* ---------------- 작은 도구 ---------------- */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261115);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);
function shade(hex, k) { // k < 0 어둡게, k > 0 밝게
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, clamp(hsl.l + k, 0, 1)); return '#' + c.getHexString();
}
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
const matCache = new Map();
function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!extra || !extra.map) { if (matCache.has(key)) return matCache.get(key); }
  const m = new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
  if (!extra || !extra.map) matCache.set(key, m);
  return m;
}
const FONT = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';

/* ---------------- 그림 그리기 판 ---------------- */
const stage = $('stage');
const DPR = window.devicePixelRatio || 1;
const renderer = new THREE.WebGLRenderer({ antialias: DPR < 2, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false; // 그림자는 발밑 동그라미로만 (아이폰 가볍게)
const QUALITY = [Math.min(DPR, 1.5), Math.min(DPR, 1), 0.75]; // 빛·화질 3단계 — 느리면 저절로 한 단계씩 내림
let tier = 0;
renderer.setPixelRatio(QUALITY[0]);
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showFatal('화면 그리기가 멈췄어요. 새로고침해 주세요.'); });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 80); // 가까운 면 0.5 → 바닥 겹침 깜빡임 줄임
const hemi = new THREE.HemisphereLight(0xfff6e8, 0xb59a7a, 1.3); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff0d6, 1.0); sunLight.position.set(-3, 6, -8); scene.add(sunLight); // 창 쪽에서 들어오는 빛
const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(2, 7, 9); scene.add(fill);
const lampLight = new THREE.PointLight(new THREE.Color(P.lamp), 0, 9, 1.6); lampLight.position.set(0, 2.4, 0); scene.add(lampLight);

/* ---------------- 바닥·벽 무늬 (사진 없이 캔버스로) ---------------- */
function woodGrain(g, x, y, w, h, base, r) {
  g.fillStyle = shade(base, (r() - 0.5) * 0.06); g.fillRect(x, y, w, h);
  g.globalAlpha = 0.18; g.strokeStyle = shade(base, -0.18); g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const yy = y + r() * h; g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + w * 0.3, yy + (r() - 0.5) * 6, x + w * 0.7, yy + (r() - 0.5) * 6, x + w, yy + (r() - 0.5) * 4); g.stroke(); }
  g.globalAlpha = 1; g.fillStyle = shade(base, -0.22); g.fillRect(x, y + h - 2, w, 2);
}
const FLOORS = {
  maru: () => canvasTex(512, 512, (g, w, h) => { const r = rng(7); for (let i = 0; i < 4; i++) { let x = -r() * 200; while (x < w) { const L = 260 + r() * 200; woodGrain(g, x, i * 128, L, 128, P.floor.color, r); g.fillStyle = shade(P.floor.color, -0.25); g.fillRect(x + L - 2, i * 128, 2, 128); x += L; } } }, [3, 3]),
  wood: () => canvasTex(512, 512, (g, w, h) => { const r = rng(8); for (let i = 0; i < 8; i++) { let x = -r() * 200; while (x < w) { const L = 200 + r() * 200; woodGrain(g, x, i * 64, L, 64, P.floor.color, r); x += L; } } }, [3, 3]),
  terracotta: () => canvasTex(512, 512, (g, w, h) => { const r = rng(9); g.fillStyle = '#d9c9b0'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = shade(P.floor.color, (r() - 0.5) * 0.08); g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122); g.globalAlpha = 0.12; g.fillStyle = '#000'; for (let k = 0; k < 30; k++) g.fillRect(i * 128 + r() * 122, j * 128 + r() * 122, 2, 2); g.globalAlpha = 1; } }, [5, 5]),
  checker: () => canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#cfc8bc'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#2f3133' : P.floor.color; g.fillRect(i * 64 + 1, j * 64 + 1, 62, 62); } }, [6, 6]),
};
const WALLS = {
  plaster: (base) => canvasTex(512, 512, (g, w, h) => { const r = rng(11); g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.globalAlpha = 0.05; g.fillStyle = shade(base, (r() - 0.5) * 0.12); g.beginPath(); g.arc(r() * w, r() * h, 20 + r() * 60, 0, 7); g.fill(); } g.globalAlpha = 0.08; g.fillStyle = shade(base, -0.3); for (let i = 0; i < 400; i++) g.fillRect(r() * w, r() * h, 1.5, 1.5); g.globalAlpha = 1; }, [3, 1]),
  stone: (base) => canvasTex(512, 512, (g, w, h) => { const r = rng(12); g.fillStyle = shade(base, -0.12); g.fillRect(0, 0, w, h); let y = 0; while (y < h) { const rh = 40 + r() * 34; let x = -r() * 60; while (x < w) { const rw = 60 + r() * 70; g.fillStyle = shade(base, (r() - 0.5) * 0.12); g.beginPath(); g.roundRect ? g.roundRect(x + 3, y + 3, rw - 6, rh - 6, 10) : g.rect(x + 3, y + 3, rw - 6, rh - 6); g.fill(); x += rw; } y += rh; } }, [3, 1]),
  tile: (base) => canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, w, h); const rh = 32, rw = 64; for (let j = 0; j * rh < h; j++) for (let i = -1; i * rw < w; i++) { const x = i * rw + (j % 2) * rw / 2; g.fillStyle = base; g.fillRect(x + 2, j * rh + 2, rw - 4, rh - 4); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 4, j * rh + 4, rw - 12, 3); } }, [4, 2]),
};

/* ---------------- 방 ---------------- */
const ROOM = { x0: -5, x1: 5, z0: -4, zFront: 1.6, h: 3.2 };
const COURT = P.layout === 'courtyard'; // 한옥 마당형
const MARU_SIT = 0.12; // 방석에 앉은 엉덩이 높이
const MARU_H = COURT ? (P.court && P.court.maruH) || 0.45 : 0; // 대청마루 높이 (상에 앉는 자리 바닥)
const TABLE_TOP = COURT ? MARU_H + 0.33 : 0.59; // 마당형은 좌식 낮은 상
const room = new THREE.Group(); scene.add(room);
function box(parent, w, h, d, m, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); parent.add(o); return o; }
function cyl(parent, rt, rb, h, m, x, y, z, seg = 16) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); parent.add(o); return o; }
function sph(parent, r, m, x, y, z, ws = 14, hs = 10) { const o = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m); o.position.set(x, y, z); parent.add(o); return o; }

function buildRoom() {
  // 바닥 (인형의 집처럼 두께가 있는 판)
  const ft = FLOORS[P.floor.texture] ? FLOORS[P.floor.texture]() : null;
  const floorTop = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 8.2), mat('#ffffff', { map: ft }));
  floorTop.rotation.x = -Math.PI / 2; floorTop.position.set(0, 0, -0.0 + 0.1); room.add(floorTop);
  box(room, 10.4, 0.25, 8.2, mat(shade(P.floor.color, -0.2)), 0, -0.251, 0.1);
  if (P.yard) { const y = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 2.0), mat(P.yard.color)); y.rotation.x = -Math.PI / 2; y.position.set(0, 0.012, 3.2); room.add(y); } // 부엌 앞 마당 (흙)
  // 벽 (뒤·왼쪽·오른쪽)
  const wt = WALLS[P.wall.texture] ? WALLS[P.wall.texture](P.wall.color) : null;
  const wallM = mat('#ffffff', { map: wt });
  // 뒷벽: 창 자리에 진짜 구멍 (창밖 그림과 창밖 연출 캐릭터가 구멍 너머로 보임)
  const sh = new THREE.Shape(); sh.moveTo(-5.2, 0); sh.lineTo(5.2, 0); sh.lineTo(5.2, ROOM.h); sh.lineTo(-5.2, ROOM.h); sh.closePath();
  for (const wn of WIN) {
    const hw = WIN_W / 2, y0 = WIN_Y, H = winH(), hole = new THREE.Path();
    hole.moveTo(wn.x - hw, y0); hole.lineTo(wn.x + hw, y0);
    if (P.window.style === 'arch') { hole.lineTo(wn.x + hw, y0 + H - hw); hole.absarc(wn.x, y0 + H - hw, hw, 0, Math.PI, false); }
    else { hole.lineTo(wn.x + hw, y0 + H); hole.lineTo(wn.x - hw, y0 + H); }
    hole.closePath(); sh.holes.push(hole);
  }
  const bt = wt ? wt.clone() : null; if (bt) { bt.repeat.set(3 / 10.4, 1 / ROOM.h); bt.needsUpdate = true; } // 모양 판은 좌표 = 무늬 좌표
  const back = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), mat('#ffffff', { map: bt })); back.position.set(0, 0, ROOM.z0); room.add(back);
  const sideT = wt ? wt.clone() : null; if (sideT) { sideT.repeat.set(1.7, 1); sideT.needsUpdate = true; }
  const sideM = mat('#ffffff', { map: sideT });
  for (const s of [-1, 1]) {
    const d = ROOM.zFront - ROOM.z0;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(d, ROOM.h), sideM); w.rotation.y = -s * Math.PI / 2; w.position.set(s * 5.2, ROOM.h / 2, ROOM.z0 + d / 2); room.add(w);
    box(room, 0.2, ROOM.h, d + 0.2, mat(shade(P.wall.color, -0.25)), s * 5.31, 0, ROOM.z0 + d / 2 - 0.1); // 벽 두께 (앞에서 보이는 단면)
  }
  box(room, 10.82, 0.1, 0.22, mat(shade(P.wall.color, -0.25)), 0, ROOM.h - 0.1, ROOM.z0 - 0.11); // 뒷벽 윗면 (단면)
  for (const wn of WIN) { const rm = mat(shade(P.wall.color, -0.12)), H = winH(); // 창 구멍 안쪽 면 (벽 두께)
    box(room, WIN_W, 0.02, 0.22, rm, wn.x, WIN_Y - 0.02, ROOM.z0 - 0.11);
    for (const s of [-1, 1]) box(room, 0.02, P.window.style === 'arch' ? H - WIN_W / 2 : H, 0.22, rm, wn.x + s * WIN_W / 2, WIN_Y, ROOM.z0 - 0.11);
    if (P.window.style !== 'arch') box(room, WIN_W, 0.02, 0.22, rm, wn.x, WIN_Y + H, ROOM.z0 - 0.11);
  }
  if (P.wall.lower) { // 아래쪽 벽판
    box(room, 10.4, 0.9, 0.04, mat(P.wall.lower), 0, 0, ROOM.z0 + 0.02);
    for (const s of [-1, 1]) box(room, 0.04, 0.9, ROOM.zFront - ROOM.z0, mat(P.wall.lower), s * 5.18, 0, (ROOM.zFront + ROOM.z0) / 2);
  }
  if (P.wall.timber) { // 나무 기둥·인방 (한옥)
    const tm = mat(P.wall.timber);
    for (const x of [-5.1, -1.35, 1.0, 5.1]) box(room, 0.22, ROOM.h, 0.12, tm, x, 0, ROOM.z0 + 0.06);
    box(room, 10.4, 0.16, 0.12, tm, 0, ROOM.h - 0.3, ROOM.z0 + 0.06);
    box(room, 10.4, 0.1, 0.1, tm, 0, 0.9, ROOM.z0 + 0.06);
    for (const s of [-1, 1]) { const p = cyl(room, 0.13, 0.15, ROOM.h, tm, s * 5.0, 0, ROOM.zFront - 0.15, 14); p.position.y = ROOM.h / 2; }
    for (const s of [-1, 1]) cyl(room, 0.26, 0.28, 0.14, mat('#a49c8e'), s * 5.0, 0, ROOM.zFront - 0.15, 12); // 주춧돌
  }
  // 천장 들보 (벽 위쪽만 — 위에서 내려다보는 장면을 가리지 않게)
  if (P.ceiling.beams) {
    const bm = mat(P.ceiling.beam);
    if (P.ceiling.beams === 'round') {
      const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 10.4, 12), bm); cb.rotation.z = Math.PI / 2; cb.position.set(0, ROOM.h - 0.05, ROOM.z0 + 0.2); room.add(cb);
      for (let x = -4.6; x <= 4.7; x += 0.75) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8), bm); r.rotation.x = Math.PI / 2 - 0.25; r.position.set(x, ROOM.h + 0.05, ROOM.z0 + 0.5); room.add(r); }
    } else {
      box(room, 10.4, 0.22, 0.26, bm, 0, ROOM.h - 0.22, ROOM.z0 + 0.13);
      for (let x = -4.5; x <= 4.6; x += 1.5) box(room, 0.18, 0.18, 1.0, bm, x, ROOM.h - 0.18, ROOM.z0 + 0.5);
    }
  }
}

/* ---------------- 창 (창밖은 그 장소의 현지 시각) ---------------- */
const WIN = [{ x: -3.0 }, { x: 2.45 }];
const WIN_W = 1.5, WIN_H = 1.3, WIN_Y = 1.25;
const winH = () => (P.window.style === 'arch' ? WIN_H * 1.15 : WIN_H);
const BACKDROP = { z: -5.3, y0: -0.5, y1: 2.7, w: 10.4 }; // 뒷벽 1.3m 뒤의 창밖 그림 (벽 위로 안 보이게 2.7m 까지)
let outsideCanvas = null, outsideTex = null; const hanjiMats = [];
const TZ = (P.local && P.local.tz) || 'Asia/Seoul';
const tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function hourNow() { // 그 장소의 지금 시각 (0~24). ?hour= 가 있으면 그 시각
  if (HOUR_FIX != null) return HOUR_FIX;
  const parts = tzFmt.formatToParts(new Date()), h = +parts.find((x) => x.type === 'hour').value, m = +parts.find((x) => x.type === 'minute').value;
  return (h % 24) + m / 60;
}
function localTimeText() { const hh = hourNow(), h = Math.floor(hh), m = Math.floor((hh - h) * 60 + 1e-6); return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`; }
function daylight(h) { // 0 = 밤 · 1 = 낮
  if (h < 5 || h >= 20) return 0; if (h < 7) return (h - 5) / 2; if (h < 17.5) return 1; return 1 - (h - 17.5) / 2.5;
}
function mix(a, b, t) { const c = new THREE.Color(a).lerp(new THREE.Color(b), clamp(t, 0, 1)); return '#' + c.getHexString(); }
function skyColors(h) {
  const k = daylight(h);
  if (k <= 0) return ['#0e1630', '#2a3660'];
  if (k >= 1) return ['#8fc0e6', '#e6f1f6'];
  return h < 12 ? [mix('#27335a', '#9fc6e6', k), mix('#e8a98a', '#e9f2f6', k)] : [mix('#27335a', '#8fb7dc', k), mix('#5a4a78', '#f2b27a', Math.min(1, k * 1.6))];
}
// 창밖 그림 (장소마다). 캔버스 가로 = 세계 x -5.2~5.2, 세로 = 세계 y 2.7(위)~-0.5(아래). 창으로 보이는 곳은 세로 0.15~0.6, 가로 0.25~0.36 · 0.6~0.7
const fx = (x) => (x + BACKDROP.w / 2) / BACKDROP.w;
const OUTSIDE = {
  courtyard(g, w, h, k, r) {
    ridge(g, w, h * 0.3, '#8a9c93', 18, r); ridge(g, w, h * 0.36, '#6f8a72', 14, r); // 먼 산
    g.fillStyle = '#cbb48e'; g.fillRect(0, h * 0.46, w, h); // 마당
    g.fillStyle = '#b9a48a'; g.fillRect(0, h * 0.38, w, h * 0.08); g.fillStyle = '#44484e'; g.fillRect(0, h * 0.36, w, h * 0.025); // 돌담 + 기와
    for (let x = 0; x < w; x += 14) { g.beginPath(); g.arc(x + 7, h * 0.36, 7, Math.PI, 0); g.fill(); }
    tree(g, w * fx(2.6), h * 0.56, 34, '#4e3626', '#5c7f3e', r, '#e48a3a'); // 감나무
    g.fillStyle = '#9e9284'; g.fillRect(w * fx(-3.9), h * 0.53, w * 0.09, h * 0.035); // 장독대 돌 단
    for (let i = 0; i < 6; i++) onggi(g, w * fx(-3.75) + i * w * 0.0145, h * 0.535, 9 + (i % 3) * 3);
  },
  vineyard(g, w, h, k, r) {
    ridge(g, w, h * 0.3, '#a3ae84', 16, r); ridge(g, w, h * 0.36, '#86995f', 12, r);
    g.fillStyle = '#8e9c5a'; g.fillRect(0, h * 0.42, w, h);
    for (let i = 0; i < 8; i++) { const y = h * 0.44 + i * h * 0.03; g.strokeStyle = '#506b35'; g.lineWidth = 2 + i * 0.6; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (i % 2) * 2); g.stroke(); } // 포도밭 줄
    for (const x of [-3.5, -2.6, 3.4]) cypress(g, w * fx(x), h * 0.42, 7, 54);
    tree(g, w * fx(2.0), h * 0.6, 30, '#6a5a48', '#8f9f7c', r, null); // 올리브 나무
  },
  street(g, w, h, k, r) {
    const cols = ['#e9dcc5', '#dfd2bc', '#e7e0d2', '#d9c9ad'], n = 12;
    for (let i = 0; i < n; i++) {
      const x = i * w / n, bw = w / n + 2, top = h * (0.02 + (i % 2) * 0.05);
      g.fillStyle = cols[i % 4]; g.fillRect(x, top + 18, bw, h);
      g.fillStyle = '#5f6b75'; g.beginPath(); g.moveTo(x - 2, top + 20); g.lineTo(x + 8, top); g.lineTo(x + bw - 8, top); g.lineTo(x + bw + 2, top + 20); g.fill(); // 지붕
      for (let fy = 0; fy < 3; fy++) for (let fxx = 0; fxx < 2; fxx++) {
        const wx = x + 12 + fxx * (bw / 2), wy = top + 30 + fy * h * 0.16;
        g.fillStyle = k < 0.5 && r() < 0.6 ? '#f6c66a' : '#7f93a3'; g.fillRect(wx, wy, bw / 2 - 22, h * 0.09);
        g.fillStyle = '#2e3236'; g.fillRect(wx - 3, wy + h * 0.09, bw / 2 - 16, 3); // 난간
      }
    }
    g.fillStyle = '#8c8a86'; g.fillRect(0, h * 0.56, w, h);
    const lx = w * fx(2.0); g.fillStyle = '#2e3236'; g.fillRect(lx, h * 0.3, 4, h * 0.27); g.fillStyle = k < 0.5 ? '#ffd88a' : '#dfe4e2'; g.beginPath(); g.arc(lx + 2, h * 0.3, 7, 0, 7); g.fill(); // 가로등
  },
};
function ridge(g, w, y, c, amp, r) { g.fillStyle = c; g.beginPath(); g.moveTo(0, g.canvas.height); const ph = r() * 6; for (let x = 0; x <= w; x += 16) g.lineTo(x, y - Math.sin(x / w * 9 + ph) * amp - Math.sin(x / w * 23 + ph) * amp * 0.3); g.lineTo(w, g.canvas.height); g.fill(); }
function tree(g, x, y, s, trunk, leaf, r, fruit) {
  g.fillStyle = trunk; g.fillRect(x - s * 0.08, y - s * 1.2, s * 0.16, s * 1.2);
  g.fillStyle = leaf; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x + (r() - 0.5) * s, y - s * 1.3 - r() * s * 0.6, s * (0.45 + r() * 0.2), 0, 7); g.fill(); }
  if (fruit) { g.fillStyle = fruit; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(x + (r() - 0.5) * s * 1.4, y - s * 1.1 - r() * s * 0.9, 3, 0, 7); g.fill(); } }
}
function cypress(g, x, y, rw, hh) { g.fillStyle = '#2f4a2e'; g.beginPath(); g.ellipse(x, y - hh / 2, rw, hh / 2, 0, 0, 7); g.fill(); }
function onggi(g, x, y, s) { g.fillStyle = '#6b3f26'; g.beginPath(); g.ellipse(x, y - s * 0.7, s * 0.7, s * 0.75, 0, 0, 7); g.fill(); g.fillStyle = '#58321e'; g.fillRect(x - s * 0.45, y - s * 1.5, s * 0.9, s * 0.25); }

function drawOutside() {
  if (!outsideCanvas) return;
  const h = hourNow(), k = daylight(h), [top, bottom] = skyColors(h);
  const c = outsideCanvas, g = c.getContext('2d'), w = c.width, H = c.height, r = rng(31);
  const grad = g.createLinearGradient(0, 0, 0, H * 0.4); grad.addColorStop(0, top); grad.addColorStop(1, bottom); g.fillStyle = grad; g.fillRect(0, 0, w, H);
  if (k < 0.3) { g.fillStyle = 'rgba(255,255,240,.85)'; for (let i = 0; i < 90; i++) g.fillRect(r() * w, r() * H * 0.3, 1.5, 1.5); }
  // 해는 오전엔 왼쪽 창, 오후엔 오른쪽 창 쪽 · 달은 밤에 오른쪽 창 쪽
  if (k > 0) { g.fillStyle = k < 1 ? '#ffd29a' : '#fff6d8'; g.beginPath(); g.arc(w * fx(h < 12.5 ? -3.0 : 2.3), H * 0.22, 9, 0, 7); g.fill(); }
  else { const mx = w * fx(2.2); g.fillStyle = '#f3efd9'; g.beginPath(); g.arc(mx, H * 0.2, 8, 0, 7); g.fill(); g.fillStyle = top; g.beginPath(); g.arc(mx + 4, H * 0.19, 7, 0, 7); g.fill(); }
  (OUTSIDE[P.window.outside] || OUTSIDE.courtyard)(g, w, H, k, r);
  if (k < 1) { g.fillStyle = `rgba(14,20,46,${(1 - k) * 0.55})`; g.fillRect(0, 0, w, H); }
  if (outsideTex) outsideTex.needsUpdate = true;
  for (const m of hanjiMats) { m.emissive.set(k > 0.3 ? '#fff4dc' : '#ffd9a0'); m.emissiveIntensity = k > 0.3 ? 0.35 + k * 0.3 : 0.55; }
}
function buildWindows() {
  outsideCanvas = document.createElement('canvas'); outsideCanvas.width = 1040; outsideCanvas.height = 320;
  outsideTex = new THREE.CanvasTexture(outsideCanvas); outsideTex.colorSpace = THREE.SRGBColorSpace;
  const bd = new THREE.Mesh(new THREE.PlaneGeometry(BACKDROP.w, BACKDROP.y1 - BACKDROP.y0), new THREE.MeshBasicMaterial({ map: outsideTex, toneMapped: false }));
  bd.position.set(0, (BACKDROP.y0 + BACKDROP.y1) / 2, BACKDROP.z); room.add(bd);
  const fm = mat(P.window.frame), H = winH();
  WIN.forEach((wn) => {
    box(room, WIN_W + 0.3, 0.08, 0.26, fm, wn.x, WIN_Y - 0.08, ROOM.z0 + 0.13); // 창턱
    if (P.window.style === 'arch') {
      for (const s of [-1, 1]) box(room, 0.08, H - WIN_W / 2, 0.08, fm, wn.x + s * WIN_W / 2, WIN_Y, ROOM.z0 + 0.04);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(WIN_W / 2, 0.04, 6, 24, Math.PI), fm); arc.position.set(wn.x, WIN_Y + H - WIN_W / 2, ROOM.z0 + 0.04); room.add(arc);
      box(room, 0.04, H, 0.04, fm, wn.x, WIN_Y, ROOM.z0 + 0.02); box(room, WIN_W, 0.04, 0.04, fm, wn.x, WIN_Y + H * 0.45, ROOM.z0 + 0.02); // 창살
    } else {
      for (const s of [-1, 1]) box(room, 0.08, H + 0.08, 0.08, fm, wn.x + s * (WIN_W / 2 + 0.02), WIN_Y - 0.04, ROOM.z0 + 0.04);
      box(room, WIN_W + 0.12, 0.08, 0.08, fm, wn.x, WIN_Y + H, ROOM.z0 + 0.04);
    }
    if (P.window.style === 'hanji') { // 창호지 격자 창 두 짝 (가운데는 열려 있음)
      const lat = canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#7a5434'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4); g.lineWidth = 3; for (let x = 1; x < 4; x++) { g.beginPath(); g.moveTo(x * w / 4, 0); g.lineTo(x * w / 4, h); g.stroke(); } for (let y = 1; y < 8; y++) { g.beginPath(); g.moveTo(0, y * h / 8); g.lineTo(w, y * h / 8); g.stroke(); } });
      const hm = new THREE.MeshLambertMaterial({ color: '#f6ecd6', map: lat, emissive: '#fff4dc', emissiveIntensity: 0.4 }); hanjiMats.push(hm);
      for (const s of [-1, 1]) { const pn = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W / 3, H), hm); pn.position.set(wn.x + s * WIN_W / 3, WIN_Y + H / 2, ROOM.z0 + 0.03); room.add(pn); }
    }
    if (P.window.style === 'shutter' && P.window.shutter) { // 열어 둔 덧문
      const sl = canvasTex(64, 128, (g, w, h) => { g.fillStyle = P.window.shutter; g.fillRect(0, 0, w, h); g.fillStyle = shade(P.window.shutter, -0.12); for (let y = 6; y < h; y += 10) g.fillRect(4, y, w - 8, 4); });
      const sm = new THREE.MeshLambertMaterial({ map: sl });
      for (const s of [-1, 1]) { const pn = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W / 2, H + 0.05), sm); pn.position.set(wn.x + s * (WIN_W * 0.75 + 0.08), WIN_Y + H / 2, ROOM.z0 + 0.03); room.add(pn); }
    }
  });
  drawOutside();
}

/* ---------------- 장소 이름 · 현지 시각 · 날씨 (왼쪽 위) ---------------- */
// 날씨: Open-Meteo (무료, 키 없음). 장소 좌표만 보냄 (손님 위치·정보는 보내지 않음). 실패하면 날씨 칸만 숨김
const WCODE = (c) => (c === 0 ? '맑음' : c <= 2 ? '구름 조금' : c === 3 ? '흐림' : c <= 48 ? '안개' : c <= 57 ? '이슬비' : c <= 67 ? '비' : c <= 77 ? '눈' : c <= 82 ? '소나기' : c <= 86 ? '눈' : '천둥');
let weather = null;
async function loadWeather() {
  if (!P.local || HOUR_FIX != null) return; // ?hour= 미리보기 때는 진짜 날씨를 안 부름
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${P.local.lat}&longitude=${P.local.lon}&current=temperature_2m,weather_code`, { signal: ctl.signal });
    clearTimeout(tm); const j = await r.json(), c = j && j.current;
    weather = c && typeof c.temperature_2m === 'number' ? `${WCODE(c.weather_code | 0)} ${Math.round(c.temperature_2m)}℃` : null;
  } catch (e) { weather = null; }
  placeChip();
}
function placeChip() {
  $('placeName').textContent = P.label || P.title;
  $('placeLocal').textContent = (P.local ? `${P.local.city} ${localTimeText()}` : localTimeText()) + (weather ? ' · ' + weather : '');
}

/* ---------------- 조리대·식탁·냄비 ---------------- */
let potGroup, potLid, potFood, POT_TOP = 1.0;
const POT_POS = new THREE.Vector3(0, TABLE_TOP, 0);
function buildCounter() {
  const hasHearth = P.props.includes('hearth');
  const x0 = -4.95, x1 = hasHearth ? 2.95 : 4.95, w = x1 - x0, cx = (x0 + x1) / 2, z = ROOM.z0 + 0.34;
  box(room, w, 0.82, 0.62, mat(P.counter), cx, 0, z);
  const topM = P.marble ? mat('#ffffff', { map: canvasTex(512, 128, (g, W, H) => { g.fillStyle = P.counterTop; g.fillRect(0, 0, W, H); const r = rng(5); g.strokeStyle = 'rgba(120,120,130,.25)'; for (let i = 0; i < 14; i++) { g.lineWidth = 0.5 + r() * 1.5; g.beginPath(); let x = r() * W, y = 0; g.moveTo(x, y); while (y < H) { x += (r() - 0.5) * 30; y += 10; g.lineTo(x, y); } g.stroke(); } }) }) : mat(P.counterTop);
  box(room, w + 0.04, 0.06, 0.68, topM, cx, 0.82, z + 0.02);
  for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.1) box(room, 0.9, 0.62, 0.02, mat(shade(P.counter, -0.06)), x + 0.2, 0.1, z + 0.32); // 문짝
}
function buildTable() {
  const t = canvasTex(512, 128, (g, w, h) => { const r = rng(3); for (let i = 0; i < 4; i++) woodGrain(g, 0, i * 32, w, 32, P.table, r); });
  const tm = mat('#ffffff', { map: t });
  box(room, 6.9, 0.08, 1.5, tm, 0, TABLE_TOP - 0.08, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(room, 0.1, TABLE_TOP - 0.08, 0.1, mat(shade(P.table, -0.1)), sx * 3.25, 0, sz * 0.62);
  if (P.props.includes('rug')) { const rg = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 3.6), mat(P.rug)); rg.rotation.x = -Math.PI / 2; rg.position.set(0, 0.006, 0); room.add(rg); }
}
function lathe(points, m, seg = 24) { return new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg), m); }
function buildPot() { // 가운데 큰 냄비 — 장소마다 모양만 바꿈 (로고·상표 없음)
  potGroup = new THREE.Group(); potGroup.position.copy(POT_POS); room.add(potGroup);
  const k = P.pot.kind, bm = mat(P.pot.body, k === 'stockpot' ? { emissive: '#3a3e44', emissiveIntensity: 0.25 } : k === 'copper' ? { emissive: '#4a2410', emissiveIntensity: 0.25 } : undefined);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 6, 20), mat('#3a3633')); ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; potGroup.add(ring); // 받침
  let top;
  if (k === 'gamasot') {
    const body = lathe([[0.02, 0.05], [0.25, 0.07], [0.42, 0.2], [0.47, 0.34], [0.46, 0.4]], bm); potGroup.add(body);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.03, 28), bm); rim.position.y = 0.3; potGroup.add(rim); // 가마솥 전(넓은 테)
    top = 0.4;
  } else if (k === 'copper') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.4, 0.4, 28, 1, true), bm); body.material.side = THREE.DoubleSide; body.position.y = 0.25; potGroup.add(body);
    const bot = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), bm); bot.rotation.x = -Math.PI / 2; bot.position.y = 0.06; potGroup.add(bot);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI), mat('#8a5a36')); h.position.set(s * 0.48, 0.36, 0); h.rotation.set(0, s * Math.PI / 2, 0); potGroup.add(h); }
    top = 0.45;
  } else { // stockpot
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 28, 1, true), bm); body.material.side = THREE.DoubleSide; body.position.y = 0.3; potGroup.add(body);
    const bot = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), bm); bot.rotation.x = -Math.PI / 2; bot.position.y = 0.06; potGroup.add(bot);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12, Math.PI), mat(P.pot.knob)); h.position.set(s * 0.45, 0.48, 0); h.rotation.set(0, s * Math.PI / 2, 0); potGroup.add(h); }
    top = 0.55;
  }
  POT_TOP = TABLE_TOP + top;
  potFood = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(P.pot.food)); potFood.scale.y = 0.35; potFood.position.y = top - 0.06; potFood.visible = false; potGroup.add(potFood);
  potLid = new THREE.Group(); potLid.position.y = top; potGroup.add(potLid);
  const lm = mat(P.pot.lid, k === 'gamasot' ? undefined : { emissive: '#30343a', emissiveIntensity: 0.2 });
  const lr = k === 'gamasot' ? 0.5 : 0.45;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(lr, 24, 8, 0, Math.PI * 2, 0, k === 'gamasot' ? 0.45 : 0.4), lm); lid.scale.y = k === 'gamasot' ? 0.45 : 0.4; lid.position.y = -lr * (k === 'gamasot' ? 0.4 : 0.37); potLid.add(lid);
  const knob = k === 'gamasot' ? new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.07), mat(P.pot.knob)) : new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(P.pot.knob));
  knob.position.y = 0.1; potLid.add(knob);
}

/* ---------------- 소품 (places.js 의 props 이름) ---------------- */
const fireMats = [];
const PROPS = {
  hearth() { // 아궁이 + 가마솥 (오른쪽 뒤)
    const g = new THREE.Group(); g.position.set(3.95, 0, ROOM.z0 + 0.6); room.add(g);
    box(g, 1.9, 0.72, 1.1, mat('#b49a7c'), 0, 0, 0); box(g, 1.96, 0.06, 1.16, mat('#9a8164'), 0, 0.72, 0);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16, 0, Math.PI), mat('#1d1512')); mouth.position.set(-0.3, 0.12, 0.56); g.add(mouth);
    const fm = new THREE.MeshBasicMaterial({ color: '#ff9a48', transparent: true, opacity: 0.8 }); fireMats.push(fm);
    const fire = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12, 0, Math.PI), fm); fire.position.set(-0.3, 0.12, 0.565); g.add(fire); fireMeshes.push(fire);
    const pot = lathe([[0.02, 0.0], [0.2, 0.03], [0.33, 0.14], [0.36, 0.24]], mat('#2d2b2a')); pot.position.set(-0.3, 0.72, 0); g.add(pot);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.025, 24), mat('#2d2b2a')); rim.position.set(-0.3, 0.92, 0); g.add(rim);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.37, 18, 6, 0, Math.PI * 2, 0, 0.5), mat('#8a5e3a')); lid.scale.y = 0.4; lid.position.set(-0.3, 0.88, 0); g.add(lid);
    for (const [x, y] of [[0.45, 0.8], [0.65, 0.8]]) cyl(g, 0.12, 0.14, 0.18, mat('#c9a45a'), x, y - 0.02, 0.1, 12); // 놋그릇
  },
  jangdok() { // 장독 (오른쪽 앞 구석)
    const m = mat('#6b3f26', { emissive: '#2a1408', emissiveIntensity: 0.15 }), lm = mat('#58321e');
    [[4.5, 0.9, 0.32], [4.55, 0.25, 0.24], [4.15, 1.3, 0.2]].forEach(([x, z, s]) => {
      const p = lathe([[0.02, 0], [s * 0.7, 0.02], [s, s * 0.8], [s * 0.85, s * 1.5], [s * 0.55, s * 1.7]], m); p.position.set(x, 0, z); room.add(p);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.6, s * 0.62, 0.05, 16), lm); l.position.set(x, s * 1.72, z); room.add(l);
    });
  },
  bowlShelf() { // 그릇 선반 (왼쪽 벽)
    const g = new THREE.Group(); g.position.set(-5.0, 0, -1.6); g.rotation.y = Math.PI / 2; room.add(g);
    const wm = mat(P.wall.timber || '#7a5434');
    for (const y of [1.3, 1.85]) { box(g, 1.6, 0.05, 0.32, wm, 0, y, 0.16); for (let i = 0; i < 4; i++) cyl(g, 0.13, 0.09, 0.1, mat(i % 2 ? '#c9a45a' : '#f4efe4'), -0.55 + i * 0.37, y + 0.05, 0.16, 14); }
  },
  garlic() { // 마늘 엮음 (왼쪽 창 옆)
    const wm = mat('#f1ead8'), sm = mat('#b89a66');
    for (const x of [-4.35, -4.1]) { cyl(room, 0.01, 0.01, 0.7, sm, x, 1.6, ROOM.z0 + 0.12, 4); for (let i = 0; i < 5; i++) sph(room, 0.065, wm, x + (i % 2 ? 0.03 : -0.03), 1.68 + i * 0.12, ROOM.z0 + 0.15, 8, 6); }
  },
  herbs() { // 말린 허브 다발 (오른쪽 벽 위)
    const sm = mat('#7c8a52'), tm = mat('#a98a60');
    for (let i = 0; i < 4; i++) { const x = 3.4 + i * 0.32; cyl(room, 0.008, 0.008, 0.3, tm, x, 2.55, ROOM.z0 + 0.12, 4); const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 8), sm); c.position.set(x, 2.42, ROOM.z0 + 0.14); room.add(c); }
  },
  copperPans() { // 벽에 건 구리 팬 (왼쪽 벽)
    const g = new THREE.Group(); g.position.set(-5.15, 0, 0.0); g.rotation.y = Math.PI / 2; room.add(g);
    box(g, 1.6, 0.05, 0.05, mat('#3a2e26'), 0, 2.45, 0.05);
    [0.22, 0.18, 0.15].forEach((r, i) => { const x = -0.5 + i * 0.5; const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.05, 20), mat('#c27a4a', { emissive: '#4a2410', emissiveIntensity: 0.3 })); p.rotation.x = Math.PI / 2; p.position.set(x, 2.2 - r, 0.08); g.add(p); box(g, 0.04, 0.24, 0.03, mat('#3a2e26'), x, 2.2 - 0.02, 0.07); });
  },
  oliveJar() { // 올리브기름 항아리와 병 (왼쪽 뒤 바닥·조리대)
    const p = lathe([[0.02, 0], [0.22, 0.03], [0.32, 0.35], [0.24, 0.7], [0.16, 0.78], [0.18, 0.84]], mat('#c27450')); p.position.set(-4.55, 0, ROOM.z0 + 1.15); room.add(p);
    for (let i = 0; i < 3; i++) { const b = lathe([[0.01, 0], [0.06, 0.01], [0.06, 0.18], [0.025, 0.26], [0.02, 0.32]], mat(['#9aa34a', '#6e7a34', '#c4b04a'][i], { transparent: true, opacity: 0.85 }), 12); b.position.set(-4.4 + i * 0.18, 0.88, ROOM.z0 + 0.3); room.add(b); }
  },
  breadBoard() { // 빵 도마 (조리대)
    box(room, 0.6, 0.04, 0.34, mat('#c79a64'), -1.9, 0.88, ROOM.z0 + 0.34);
    const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.26, 4, 10), mat('#c98a4a')); loaf.rotation.z = Math.PI / 2; loaf.position.set(-1.9, 1.0, ROOM.z0 + 0.34); room.add(loaf);
  },
  breadBaskets() { // 빵 바구니 (조리대 위)
    const bm = mat('#b88a50');
    [-4.3, -1.9, 3.9].forEach((x, i) => {
      const b = lathe([[0.02, 0], [0.25, 0.02], [0.3, 0.16]], bm, 16); b.material.side = THREE.DoubleSide; b.position.set(x, 0.88, ROOM.z0 + 0.34); room.add(b);
      for (let j = 0; j < 3; j++) { const l = new THREE.Mesh(i === 1 ? new THREE.CapsuleGeometry(0.04, 0.42, 4, 8) : new THREE.SphereGeometry(0.1, 10, 8), mat(j % 2 ? '#d49a58' : '#c4834a')); if (i === 1) { l.rotation.set(0.4, 0, 0.3 + j * 0.3); } l.position.set(x - 0.1 + j * 0.1, 1.02 + (i === 1 ? 0.08 : 0), ROOM.z0 + 0.34); room.add(l); }
    });
  },
  cakeStand() { // 케이크 받침 (조리대 위)
    cyl(room, 0.04, 0.08, 0.16, mat('#f4f1ea'), 1.3, 0.88, ROOM.z0 + 0.34, 12); cyl(room, 0.26, 0.26, 0.02, mat('#f4f1ea'), 1.3, 1.04, ROOM.z0 + 0.34, 20);
    cyl(room, 0.2, 0.2, 0.16, mat('#f3dcc0'), 1.3, 1.06, ROOM.z0 + 0.34, 20); cyl(room, 0.21, 0.21, 0.03, mat('#e9a3a6'), 1.3, 1.2, ROOM.z0 + 0.34, 20);
  },
  plants() { // 창턱 화분
    for (const wn of WIN) for (const s of [-1, 1]) { const x = wn.x + s * 0.5; cyl(room, 0.08, 0.06, 0.13, mat('#c98a62'), x, WIN_Y, ROOM.z0 + 0.14, 10); sph(room, 0.12, mat('#6f9a5c'), x, WIN_Y + 0.22, ROOM.z0 + 0.14, 10, 8); }
  },
  shelfJars() { // 병 선반 (왼쪽 벽, 무지 병)
    const g = new THREE.Group(); g.position.set(-5.15, 0, -1.4); g.rotation.y = Math.PI / 2; room.add(g);
    box(g, 1.4, 0.05, 0.3, mat('#a98a60'), 0, 1.6, 0.15);
    for (let i = 0; i < 5; i++) { cyl(g, 0.08, 0.08, 0.2, mat(['#e9d9b5', '#d9b38c', '#c8d3b0'][i % 3], { transparent: true, opacity: 0.9 }), -0.5 + i * 0.25, 1.65, 0.15, 12); cyl(g, 0.085, 0.085, 0.04, mat('#8a6a4a'), -0.5 + i * 0.25, 1.85, 0.15, 12); }
  },
  rug() { /* buildTable 에서 깔개를 깜 */ },
};
let lamps = [];
function buildLamps() {
  for (const x of [-1.9, 1.9]) {
    const g = new THREE.Group(); g.position.set(x, 2.55, 0); room.add(g);
    cyl(g, 0.008, 0.008, 0.55, mat('#3a3330'), 0, 0.3, 0, 4);
    const em = new THREE.MeshLambertMaterial({ color: P.lamp, emissive: P.lamp, emissiveIntensity: 0.3 }); lamps.push(em);
    if (P.lampKind === 'paper') { cyl(g, 0.2, 0.2, 0.34, em, 0, 0, 0, 14); cyl(g, 0.21, 0.21, 0.02, mat(P.wall.timber || '#6e4a2c'), 0, 0.33, 0, 14); cyl(g, 0.21, 0.21, 0.02, mat(P.wall.timber || '#6e4a2c'), 0, 0, 0, 14); }
    else if (P.lampKind === 'glass') { sph(g, 0.18, em, 0, 0.12, 0, 14, 10); cyl(g, 0.05, 0.05, 0.06, mat('#c9a45a'), 0, 0.28, 0, 8); }
    else { const sh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.24, 16, 1, true), mat('#2e2a27')); sh.material.side = THREE.DoubleSide; sh.position.y = 0.22; g.add(sh); sph(g, 0.08, em, 0, 0.1, 0, 10, 8); }
  }
}

/* ---------------- 일거리 자리 소품 (places.js jobs 의 prop.kind) ---------------- */
const fireMeshes = [];
const WATER = () => mat('#8fc6de', { emissive: '#2a5a70', emissiveIntensity: 0.25 });
const CZ = ROOM.z0 + 0.34; // 뒤 조리대 가운데 z
const BRASS = () => mat('#c9a45a', { emissive: '#4a3410', emissiveIntensity: 0.35 }); // 놋
const JOB_PROPS = {
  hearthYard(p) { // 부엌칸 아궁이 + 가마솥 (앞이 마당 가운데를 봄) + 장작
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -Math.PI / 2; room.add(g);
    box(g, 1.3, 0.7, 0.9, mat('#ffffff', { map: earthTex() }), 0, 0, 0); box(g, 1.36, 0.06, 0.96, mat('#9a8164'), 0, 0.7, 0);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.22, 14, 0, Math.PI), mat('#1d1512')); mouth.position.set(0, 0.1, 0.455); g.add(mouth);
    const fm = new THREE.MeshBasicMaterial({ color: '#ff9a48', transparent: true, opacity: 0.8 }); fireMats.push(fm);
    const fire = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12, 0, Math.PI), fm); fire.position.set(0, 0.1, 0.46); g.add(fire); fireMeshes.push(fire);
    const pot = lathe([[0.02, 0], [0.2, 0.03], [0.33, 0.14], [0.36, 0.24]], mat('#2d2b2a'), 16); pot.position.set(0, 0.7, 0); g.add(pot);
    cyl(g, 0.47, 0.47, 0.025, mat('#2d2b2a'), 0, 0.9, 0, 20); const lid = sph(g, 0.37, mat('#8a5e3a'), 0, 0.9, 0, 16, 6); lid.scale.y = 0.35;
    const logs = []; for (let i = 0; i < 6; i++) logs.push([0.95 + (i % 3) * 0.13, 0.06 + Math.floor(i / 3) * 0.11, 0.1]);
    const lg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 7).rotateX(Math.PI / 2), mat('#8a5e3a'), logs.length), o = new THREE.Object3D();
    logs.forEach((v, i) => { o.position.set(v[0], v[1], v[2]); o.updateMatrix(); lg.setMatrixAt(i, o.matrix); }); g.add(lg);
  },
  riceStand(p) { // 쌀 씻는 함지박 (낮은 나무 받침 위) + 바가지
    box(room, 0.7, 0.45, 0.5, mat(CT.wood || '#9a6a40'), p.x, 0, p.z);
    const b = lathe([[0.02, 0], [0.22, 0.01], [0.3, 0.13]], mat('#a07a4e'), 16); b.material.side = THREE.DoubleSide; b.position.set(p.x, 0.45, p.z); room.add(b);
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14), mat('#f6f1e4')); r.rotation.x = -Math.PI / 2; r.position.set(p.x, 0.55, p.z); room.add(r);
    const bg = sph(room, 0.12, mat('#e2c98a'), p.x + 0.2, 0.5, p.z + 0.15, 10, 6); bg.scale.y = 0.45;
  },
  trough(p) { // 돌 개수대 + 물 + 놋그릇
    box(room, 1.0, 0.45, 0.55, mat('#ffffff', { map: WALLS.stone(CT.stone || '#a49c8e') }), p.x, 0, p.z);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.4), WATER()); w.rotation.x = -Math.PI / 2; w.position.set(p.x, 0.46, p.z); room.add(w);
    for (let i = 0; i < 3; i++) cyl(room, 0.1, 0.07, 0.06, BRASS(), p.x - 0.25 + i * 0.25, 0.46, p.z, 12);
  },
  platform(p) { // 평상 + 가운데 나물 바구니
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); room.add(g); const wm = mat('#a07a4e');
    box(g, 1.8, 0.06, 1.2, wm, 0, 0.26, 0); for (let i = -3; i <= 3; i++) box(g, 0.02, 0.005, 1.2, mat('#8a653d'), i * 0.25, 0.32, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.08, 0.26, 0.08, wm, sx * 0.82, 0, sz * 0.52);
    const b = lathe([[0.02, 0], [0.26, 0.01], [0.3, 0.07]], mat('#b88a50'), 16); b.material.side = THREE.DoubleSide; b.position.y = 0.32; g.add(b);
    for (let i = 0; i < 10; i++) sph(g, 0.05, mat(i % 3 ? '#6fae4a' : '#8cc35e'), (Math.random() - 0.5) * 0.34, 0.38, (Math.random() - 0.5) * 0.24, 8, 6);
  },
  well(p) { // 우물 + 대야
    const st = mat('#a49c8e');
    const [wx, wz] = p.wellAt || [p.x - 1.0, p.z + 0.45];
    const w = lathe([[0.42, 0], [0.42, 0.62], [0.36, 0.62], [0.36, 0.1]], st, 18); w.material.side = THREE.DoubleSide; w.position.set(wx, 0, wz); room.add(w);
    const wt = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), mat('#2c4a5a')); wt.rotation.x = -Math.PI / 2; wt.position.set(wx, 0.45, wz); room.add(wt);
    for (const s of [-1, 1]) box(room, 0.06, 1.1, 0.06, mat('#7a5434'), wx + s * 0.38, 0.6, wz); box(room, 0.9, 0.06, 0.06, mat('#7a5434'), wx, 1.7, wz);
    const basin = lathe([[0.02, 0], [0.3, 0.01], [0.4, 0.14]], mat('#c9a45a', { emissive: '#3a2a10', emissiveIntensity: 0.2 }), 20); basin.material.side = THREE.DoubleSide; basin.position.set(p.x, 0, p.z); room.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.36, 18), WATER()); water.rotation.x = -Math.PI / 2; water.position.set(p.x, 0.11, p.z); room.add(water);
    for (let i = 0; i < 5; i++) sph(room, 0.06, mat(i % 2 ? '#6fae4a' : '#e9e2c8'), p.x + (Math.random() - 0.5) * 0.4, 0.13, p.z + (Math.random() - 0.5) * 0.3, 8, 6);
  },
  counterBasin(p) { // 조리대 위 쌀 씻는 함지박
    const b = lathe([[0.02, 0], [0.24, 0.01], [0.32, 0.14]], mat('#a07a4e'), 18); b.material.side = THREE.DoubleSide; b.position.set(p.x, 0.88, CZ); room.add(b);
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), mat('#f6f1e4')); r.rotation.x = -Math.PI / 2; r.position.set(p.x, 0.98, CZ); room.add(r);
  },
  firewood(p) { // 장작 더미
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), mat(i % 2 ? '#8a5e3a' : '#7a5234')); l.rotation.x = Math.PI / 2; l.position.set(p.x - 0.13 + (i % 3) * 0.13, 0.06 + Math.floor(i / 3) * 0.11, p.z); room.add(l); }
  },
  sink(p) { // 개수대 (조리대에 물 담긴 우묵한 곳 + 그릇)
    box(room, 0.9, 0.02, 0.5, mat('#5b6a72'), p.x, 0.875, CZ);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.42), WATER()); w.rotation.x = -Math.PI / 2; w.position.set(p.x, 0.9, CZ); room.add(w);
    for (let i = 0; i < 3; i++) cyl(room, 0.11, 0.08, 0.06, mat(i % 2 ? '#c9a45a' : '#f4efe4'), p.x - 0.25 + i * 0.25, 0.9, CZ, 12);
  },
  garden(p) { // 텃밭 (흙 이랑 + 고추 포기)
    box(room, 2.3, 0.08, 1.3, mat('#8a6440'), p.x, 0, p.z);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const x = p.x - 0.85 + i * 0.57, z = p.z - 0.3 + j * 0.6;
      cyl(room, 0.015, 0.02, 0.5, mat('#4f7a34'), x, 0.08, z, 5); sph(room, 0.17, mat('#5f9a43'), x, 0.6, z, 10, 8).scale.y = 0.8;
      for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), mat(p.fruit)); c.rotation.x = Math.PI; c.position.set(x + (Math.random() - 0.5) * 0.25, 0.45 + Math.random() * 0.15, z + (Math.random() - 0.5) * 0.25); room.add(c); }
    }
  },
  tree(p) { // 큰 화분 올리브 나무
    cyl(room, 0.35, 0.28, 0.45, mat('#c27450'), p.x, 0, p.z, 16); cyl(room, 0.07, 0.1, 1.2, mat('#6a5a48'), p.x, 0.4, p.z, 8);
    for (let i = 0; i < 6; i++) sph(room, 0.35, mat(p.leaf || '#8f9f7c'), p.x + (Math.random() - 0.5) * 0.7, 1.6 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.5, 10, 8);
    for (let i = 0; i < 16; i++) sph(room, 0.035, mat(p.fruit), p.x + (Math.random() - 0.5) * 1.0, 1.4 + Math.random() * 0.6, p.z + 0.2 + Math.random() * 0.25, 6, 5);
  },
  vine(p) { // 포도 덩굴 시렁
    const wm = mat('#6a4a2c');
    for (const sx of [-1, 1]) box(room, 0.08, 2.0, 0.08, wm, p.x + sx * 0.9, 0, p.z); box(room, 2.0, 0.08, 0.6, wm, p.x, 2.0, p.z);
    for (let i = 0; i < 9; i++) sph(room, 0.22, mat('#6f9a5c'), p.x - 0.9 + i * 0.22, 2.05, p.z + (Math.random() - 0.5) * 0.4, 8, 6);
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 8), mat('#6a3f7a')); c.rotation.x = Math.PI; c.position.set(p.x - 0.7 + i * 0.35, 1.78, p.z + 0.1); room.add(c); }
  },
  oven(p) { // 화덕(돔) 또는 빵 오븐(네모)
    const g = new THREE.Group(); g.position.set(p.x, 0, ROOM.z0 + 0.65); room.add(g);
    box(g, 1.6, 0.6, 1.2, mat(p.dome ? '#b49a7c' : '#d9d4cc'), 0, 0, 0);
    if (p.dome) { const d = sph(g, 0.62, mat('#c9a27a'), 0, 0.6, 0, 18, 10); d.scale.y = 0.8; }
    else box(g, 1.2, 0.9, 1.0, mat('#3f4a52'), 0, 0.6, -0.05);
    const mouth = new THREE.Mesh(p.dome ? new THREE.CircleGeometry(0.22, 16, 0, Math.PI) : new THREE.PlaneGeometry(0.8, 0.4), mat('#1d1512')); mouth.position.set(0, p.dome ? 0.62 : 0.85, p.dome ? 0.6 : 0.46); g.add(mouth);
    const fm = new THREE.MeshBasicMaterial({ color: '#ff9a48', transparent: true, opacity: 0.8 }); fireMats.push(fm);
    const fire = new THREE.Mesh(p.dome ? new THREE.CircleGeometry(0.14, 12, 0, Math.PI) : new THREE.PlaneGeometry(0.7, 0.3), fm); fire.position.set(0, p.dome ? 0.62 : 0.85, p.dome ? 0.605 : 0.465); g.add(fire); fireMeshes.push(fire);
  },
  rack(p) { // 파스타 너는 나무 걸이
    const wm = mat('#8a6440');
    for (const sx of [-1, 1]) box(room, 0.06, 1.3, 0.06, wm, p.x + sx * 0.7, 0, p.z); for (const y of [1.0, 1.25]) box(room, 1.5, 0.04, 0.04, wm, p.x, y, p.z);
    for (let i = 0; i < 18; i++) box(room, 0.012, 0.45, 0.012, mat('#f2d27a'), p.x - 0.6 + i * 0.07, (i % 2 ? 1.25 : 1.0) - 0.45, p.z + (i % 2 ? 0.02 : -0.02));
  },
  rollingPin(p) { // 대리석 작업대 위 반죽 + 밀대
    const d = sph(room, 0.2, mat('#f1e2c2'), p.x, 0.9, CZ, 14, 8); d.scale.y = 0.2;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10), mat('#c79a64')); r.rotation.z = Math.PI / 2; r.position.set(p.x, 0.97, CZ + 0.05); room.add(r);
  },
  standBasin(p) { // 받침대 위 과일 대야
    cyl(room, 0.06, 0.1, 0.62, mat('#3f4a52'), p.x, 0, p.z, 10);
    const b = lathe([[0.02, 0], [0.3, 0.01], [0.38, 0.14]], mat('#dfe2e6', { emissive: '#3a3e44', emissiveIntensity: 0.3 }), 20); b.material.side = THREE.DoubleSide; b.position.set(p.x, 0.62, p.z); room.add(b);
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), WATER()); w.rotation.x = -Math.PI / 2; w.position.set(p.x, 0.73, p.z); room.add(w);
    for (let i = 0; i < 6; i++) sph(room, 0.05, mat(p.fruit), p.x + (Math.random() - 0.5) * 0.4, 0.75, p.z + (Math.random() - 0.5) * 0.3, 8, 6);
  },
  dishTable(p) { // 그릇 닦는 작은 탁자 + 그릇 더미
    box(room, 1.2, 0.62, 0.6, mat(shade(P.table, 0.05)), p.x, 0, p.z); box(room, 1.26, 0.04, 0.66, mat('#f2efea'), p.x, 0.62, p.z);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) cyl(room, 0.13, 0.1, 0.03, mat('#f4f1ea'), p.x - 0.35 + i * 0.35, 0.66 + k * 0.035, p.z, 14);
  },
  basketStand(p) { // 빵 바구니 놓는 받침 + 바구니 둘
    box(room, 1.2, 0.45, 0.6, mat('#a07a4e'), p.x, 0, p.z);
    for (const s of [-1, 1]) { const b = lathe([[0.02, 0], [0.22, 0.01], [0.26, 0.15]], mat('#b88a50'), 14); b.material.side = THREE.DoubleSide; b.position.set(p.x + s * 0.3, 0.45, p.z); room.add(b); for (let i = 0; i < 3; i++) sph(room, 0.08, mat(i % 2 ? '#d49a58' : '#c4834a'), p.x + s * 0.3 + (i - 1) * 0.1, 0.58, p.z, 8, 6); }
  },
};

/* ---------------- ㄷ자 한옥 마당 (places.js layout: 'courtyard') ----------------
   뒤 = 대청마루 (기단 돌 · 마루 널 · 좌식 긴 상 · 꽃무늬 방석 · 창호지 격자문 · 흰 회벽 · 서까래 · 기와 처마)
   양옆 = 날개채 (창호지 문 · 기와지붕) · 앞 = 잔디 마당 · 디딤돌 · 장독대 · 평상 · 우물 · 텃밭 · 부엌칸(아궁이) · 돌의자와 화로
   멀리 = 늦가을 산과 하늘 (현지 시각: 낮 맑은 하늘 · 밤 짙은 파랑과 노란 달)
   진짜 빛은 3개 (하늘빛 · 해/달빛 · 마루 등 하나). 처마 등·창호지·화로는 스스로 빛나는 재질. 사진 파일은 쓰지 않고 무늬는 모두 코드로 그림 */
const CT = P.court || {};
let courtSky = null, courtSkyTex = null;
function grassTex() { return canvasTex(256, 256, (g, w, h) => { const r = rng(41); g.fillStyle = CT.grass || '#7f9a55'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { g.strokeStyle = shade(CT.grass || '#7f9a55', (r() - 0.5) * 0.18); g.lineWidth = 1; const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4); g.stroke(); } }, [10, 8]); }
function giwaTex() { // 기와: 암키와 바탕 + 수키와 줄 (둥근 줄 · 끝 막새)
  return canvasTex(256, 256, (g, w, h) => {
    const base = CT.tile || '#4a4c50'; g.fillStyle = shade(base, -0.06); g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      const gr = g.createLinearGradient(x, 0, x + 20, 0); gr.addColorStop(0, shade(base, -0.12)); gr.addColorStop(0.5, shade(base, 0.12)); gr.addColorStop(1, shade(base, -0.1));
      g.fillStyle = gr; g.fillRect(x + 6, 0, 20, h);
      for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 6, y + 60, 20, 4); }
    }
  }, [1, 1]);
}
function earthTex() { return canvasTex(256, 256, (g, w, h) => { const r = rng(43); g.fillStyle = CT.earth || '#c9ab84'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,90,50,.25)' : 'rgba(240,220,170,.35)'; g.fillRect(r() * w, r() * h, 1 + r() * 4, 1); } }, [3, 1]); }
function hanjiLattice() { return canvasTex(128, 256, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = CT.woodDark || '#5e3e24'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.lineWidth = 3; for (let x = 1; x < 4; x++) { g.beginPath(); g.moveTo(x * w / 4, 0); g.lineTo(x * w / 4, h); g.stroke(); } for (let y = 1; y < 8; y++) { g.beginPath(); g.moveTo(0, y * h / 8); g.lineTo(w, y * h / 8); g.stroke(); } }); }
function cushionTex() { return canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#c94a4a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e9c46a'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, h - 8); for (const [x, y] of [[20, 20], [44, 44], [44, 20], [20, 44], [32, 32]]) { g.fillStyle = '#f7d7dc'; for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, 7); g.fill(); } g.fillStyle = '#e9c46a'; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); } }); }
// 휘어 오른 처마 지붕 (기와 무늬): 앞 처마(x0,z0,y0) → 용마루(z1,y1), 양 끝이 위로 들림. axis 'z' = 앞뒤로 기움, 'x' = 옆으로 기움
function curvedRoof(len, front, back, axis, lift, m) {
  const nx = 18, nz = 4, pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, t = j / nz, a = -len / 2 + len * u, e = Math.pow(Math.abs(u * 2 - 1), 3) * lift * (1 - t) * (1 - t);
    const d = lerp(front.d, back.d, t), y = lerp(front.y, back.y, t) + e;
    if (axis === 'z') pos.push(a, y, d); else pos.push(d, y, a);
    uv.push(a / 0.9, t * Math.hypot(back.d - front.d, back.y - front.y) / 0.9);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = j * (nx + 1) + i; idx.push(k, k + nx + 1, k + 1, k + 1, k + nx + 1, k + nx + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m); room.add(mesh); return mesh;
}
function instanced(geo, m, list) { // list: [[x, y, z, sx, sy, sz, ry], ...] → 그리기 1번
  const im = new THREE.InstancedMesh(geo, m, list.length), o = new THREE.Object3D();
  list.forEach((v, i) => { o.position.set(v[0], v[1], v[2]); o.scale.set(v[3] || 1, v[4] || 1, v[5] || 1); o.rotation.set(0, v[6] || 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.instanceMatrix.needsUpdate = true; room.add(im); return im;
}
function hallWall(x0, x1, z, h0, h1, bays, faceX) { // 기둥 + 창호지 격자문 + 흰 회벽 띠 (faceX: 옆채 — x 쪽을 봄)
  const wd = mat(CT.woodDark || '#5e3e24'), lat = hanjiLattice(), plaster = mat(CT.plaster || '#f1ece2'), doorTop = h0 + (h1 - h0) * 0.68;
  const hm = new THREE.MeshLambertMaterial({ color: '#f6ecd6', map: lat, emissive: '#fff4dc', emissiveIntensity: 0.4 }); hanjiMats.push(hm);
  const L = x1 - x0, bw = L / bays;
  for (let b = 0; b < bays; b++) {
    const c = x0 + bw * (b + 0.5), skip = bays === 3 && b === 1 && !faceX; // 가운데 칸은 한마디 판
    const tex = lat.clone(); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(4, 1); tex.needsUpdate = true;
    const dm = skip ? plaster : new THREE.MeshLambertMaterial({ color: '#f6ecd6', map: tex, emissive: '#fff4dc', emissiveIntensity: 0.4 }); if (!skip) hanjiMats.push(dm);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.2, doorTop - h0 - 0.1), dm);
    if (faceX) { door.rotation.y = faceX > 0 ? Math.PI / 2 : -Math.PI / 2; door.position.set(z, (h0 + doorTop) / 2, c); } else door.position.set(c, (h0 + doorTop) / 2, z);
    room.add(door);
  }
  const band = new THREE.Mesh(new THREE.PlaneGeometry(L, h1 - doorTop), plaster); // 흰 회벽 띠
  if (faceX) { band.rotation.y = faceX > 0 ? Math.PI / 2 : -Math.PI / 2; band.position.set(z, (doorTop + h1) / 2, (x0 + x1) / 2); } else band.position.set((x0 + x1) / 2, (doorTop + h1) / 2, z);
  room.add(band);
  const posts = []; for (let b = 0; b <= bays; b++) { const c = x0 + bw * b; posts.push(faceX ? [z, h0, c] : [c, h0, z]); }
  instanced(new THREE.CylinderGeometry(0.12, 0.13, h1 - h0 + 0.15, 10).translate(0, (h1 - h0 + 0.15) / 2, 0), wd, posts.map((p) => [p[0], p[1], p[2]])); // 기둥
  for (const y of [doorTop, h1]) { const bm = faceX ? new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, L), wd) : new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.16), wd); bm.position.set(faceX ? z : (x0 + x1) / 2, y, faceX ? (x0 + x1) / 2 : z); room.add(bm); } // 인방
}
function buildCourtyard() {
  const H = MARU_H, wood = CT.wood || '#9a6a40', wd = mat(CT.woodDark || '#5e3e24'), stoneT = WALLS.stone(CT.stone || '#a49c8e');
  // 땅: 잔디 (집 뒤 멀리까지)
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(44, 34), mat('#ffffff', { map: grassTex() })); gr.rotation.x = -Math.PI / 2; gr.position.set(0, -0.01, -4); room.add(gr);
  // 대청마루: 돌 기단 + 마루 널
  const st = stoneT.clone(); st.repeat.set(6, 0.4); st.needsUpdate = true;
  box(room, 9.6, 0.22, 3.9, mat('#ffffff', { map: st }), 0, 0, -0.15);
  const pl = FLOORS.maru(); pl.repeat.set(4, 2);
  box(room, 9.2, H - 0.22, 3.5, mat('#ffffff', { map: pl }), 0, 0.22, -0.13);
  box(room, 1.1, 0.2, 0.55, mat(CT.stone || '#a49c8e'), 0, 0, 2.05); // 디딤돌 (마루 앞)
  // 뒤 본채 벽 · 지붕
  hallWall(-4.6, 4.6, -1.82, H, 2.95, 3, 0);
  box(room, 9.6, 3.0, 0.1, mat(CT.plaster || '#f1ece2'), 0, 0, -1.95);
  const tileM = new THREE.MeshLambertMaterial({ map: giwaTex(), side: THREE.DoubleSide }); tileM.map.wrapS = tileM.map.wrapT = THREE.RepeatWrapping;
  curvedRoof(11.2, { d: -0.55, y: 3.05 }, { d: -3.7, y: 4.35 }, 'z', 0.45, tileM);
  box(room, 11.0, 0.18, 0.3, mat(shade(CT.tile || '#4a4c50', -0.15)), 0, 4.3, -3.7); // 용마루
  box(room, 10.8, 0.16, 0.16, wd, 0, 2.92, -0.62); // 처마 도리
  const rafters = []; for (let x = -5.2; x <= 5.21; x += 0.36) rafters.push([x, 2.98, -1.2]);
  instanced(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 6).rotateX(Math.PI / 2 - 0.25), wd, rafters); // 서까래
  // 양옆 날개채 (ㄷ자)
  for (const s of [-1, 1]) {
    box(room, 2.4, 0.22, 7.0, mat('#ffffff', { map: st }), s * 6.1, 0, 1.3);
    hallWall(-1.7, 4.6, s * 4.95, 0.22, 2.8, 3, -s);
    box(room, 0.1, 2.8, 6.6, mat(CT.plaster || '#f1ece2'), s * 5.15, 0, 1.45);
    curvedRoof(7.6, { d: s * 4.35, y: 2.95 }, { d: s * 7.1, y: 4.05 }, 'x', 0.4, tileM).position.z = 1.3;
    box(room, 0.3, 0.18, 7.6, mat(shade(CT.tile || '#4a4c50', -0.15)), s * 7.1, 4.0, 1.3);
    const rr = []; for (let z = -1.9; z <= 4.5; z += 0.36) rr.push([s * 4.85, 2.88, z]);
    instanced(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6).rotateZ(Math.PI / 2 + s * 0.25), wd, rr);
  }
  // 좌식 긴 상 + 꽃무늬 방석
  const tt = canvasTex(512, 128, (g, w, h) => { const r = rng(3); for (let i = 0; i < 4; i++) woodGrain(g, 0, i * 32, w, 32, P.table, r); });
  box(room, 6.9, 0.07, 1.4, mat('#ffffff', { map: tt }), 0, TABLE_TOP - 0.07, 0);
  instanced(new THREE.BoxGeometry(0.1, TABLE_TOP - 0.07 - H, 0.1).translate(0, (TABLE_TOP - 0.07 - H) / 2, 0), mat(shade(P.table, -0.12)), [[-3.2, H, -0.6], [3.2, H, -0.6], [-3.2, H, 0.6], [3.2, H, 0.6], [0, H, -0.6], [0, H, 0.6]]);
  instanced(new THREE.BoxGeometry(0.46, 0.06, 0.46), mat('#ffffff', { map: cushionTex() }), SEATS.map((s) => [s.x, H, s.z - Math.cos(s.rot) * 0.05, 1, 1, 1, s.rot]));
  // 처마 밑 등 (스스로 빛남)
  for (const x of [-2.6, 2.6]) { const em = new THREE.MeshLambertMaterial({ color: CT.lantern || '#ffd99a', emissive: CT.lantern || '#ffd99a', emissiveIntensity: 0.3 }); lamps.push(em); cyl(room, 0.17, 0.17, 0.34, em, x, 2.25, -1.25, 12); cyl(room, 0.18, 0.18, 0.03, wd, x, 2.59, -1.25, 12); cyl(room, 0.18, 0.18, 0.03, wd, x, 2.24, -1.25, 12); cyl(room, 0.008, 0.008, 0.4, wd, x, 2.6, -1.25, 4); }
  // 장독대 (돌 단 + 장독 24개, 그리기 2번)
  box(room, 1.45, 0.22, 1.75, mat('#ffffff', { map: st }), 4.0, 0, 5.3);
  const jars = [], lids = [], rj = rng(9);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) { const s = 0.8 + rj() * 0.45, x = 3.55 + i * 0.3, z = 4.6 + j * 0.27; jars.push([x, 0.22, z, s, s, s]); lids.push([x, 0.22 + 0.36 * s, z, s, 1, s]); }
  const jarGeo = new THREE.LatheGeometry([[0.03, 0], [0.1, 0.01], [0.15, 0.12], [0.13, 0.27], [0.09, 0.33], [0.095, 0.36]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
  instanced(jarGeo, mat('#6b3f26', { emissive: '#2a1408', emissiveIntensity: 0.2 }), jars);
  instanced(new THREE.CylinderGeometry(0.1, 0.105, 0.03, 10), mat('#58321e'), lids);
  // 디딤돌 길 (마당 가운데)
  const steps = []; for (let z = 2.65, k = 0; z < 6.2; z += 0.62, k++) steps.push([(k % 2 ? 0.12 : -0.1), 0.0, z, 1, 1, 1, k * 0.7]);
  instanced(new THREE.CylinderGeometry(0.3, 0.32, 0.06, 9), mat(CT.stone || '#a49c8e'), steps);
  // 돌의자와 화로
  const sc = [[0.95, 0, 2.95], [1.75, 0, 2.65], [1.55, 0, 3.4]];
  instanced(new THREE.CylinderGeometry(0.2, 0.23, 0.36, 10).translate(0, 0.18, 0), mat('#9a948a'), sc);
  const bz = lathe([[0.05, 0], [0.18, 0.05], [0.24, 0.22], [0.26, 0.3]], mat('#2e2b29'), 14); bz.position.set(1.42, 0, 3.0); room.add(bz);
  const fm = new THREE.MeshBasicMaterial({ color: '#ff9a48', transparent: true, opacity: 0.8 }); fireMats.push(fm); const ember = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), fm); ember.rotation.x = -Math.PI / 2; ember.position.set(1.42, 0.27, 3.0); room.add(ember); fireMeshes.push(ember);
  // 앞 담장 (돌담 + 기와 지붕, 가운데는 열린 문)
  const wallT = stoneT.clone(); wallT.repeat.set(3, 0.6); wallT.needsUpdate = true;
  for (const s of [-1, 1]) { box(room, 4.2, 0.85, 0.35, mat('#ffffff', { map: wallT }), s * 2.95, 0, 6.75); const cap = box(room, 4.4, 0.12, 0.6, mat(shade(CT.tile || '#4a4c50', -0.05)), s * 2.95, 0.85, 6.75); cap.material = tileM; }
  // 소나무 (왼쪽 날개채 뒤, 지붕 위로 보임)
  const pt = new THREE.Group(); pt.position.set(-7.4, 0, -0.6); room.add(pt); const bark = mat('#6a4a34'), needle = mat('#3f5a3a');
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 5.2, 8), bark); tr.position.set(0.3, 2.6, 0); tr.rotation.z = -0.12; pt.add(tr);
  for (const [x, y, z, r0] of [[0.9, 5.2, 0, 1.3], [-0.2, 4.6, 0.3, 1.0], [1.4, 4.3, -0.2, 0.9], [0.4, 5.8, -0.1, 0.8]]) { const c = new THREE.Mesh(new THREE.SphereGeometry(r0, 10, 6), needle); c.scale.y = 0.35; c.position.set(x, y, z); pt.add(c); }
  // 멀리 늦가을 산과 하늘
  courtSky = document.createElement('canvas'); courtSky.width = 1024; courtSky.height = 384;
  courtSkyTex = new THREE.CanvasTexture(courtSky); courtSkyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(56, 21), new THREE.MeshBasicMaterial({ map: courtSkyTex, toneMapped: false, fog: false })); sky.position.set(0, 4.8, -18); room.add(sky); // 달·산꼭대기가 지붕선 위(세계 높이 3~5)에 오게
  drawCourtSky();
  lampLight.position.set(0, 2.3, 0.2); lampLight.distance = 8; // 진짜 빛 3개: 하늘빛 · 해/달빛 · 마루 등
  scene.remove(fill);
}
function drawCourtSky() {
  if (!courtSky) return;
  const h = hourNow(), k = daylight(h), g = courtSky.getContext('2d'), w = courtSky.width, H = courtSky.height, r = rng(57);
  const top = k <= 0 ? '#0d1838' : k >= 1 ? '#5fa3dc' : mix('#1a2752', h < 12 ? '#86b6e2' : '#d98a5a', k), bot = k <= 0 ? '#22325e' : k >= 1 ? '#cfe5f3' : mix('#3a3a68', '#f5c48a', k);
  const gr = g.createLinearGradient(0, 0, 0, H * 0.75); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, w, H);
  if (k < 0.3) { g.fillStyle = 'rgba(255,255,235,.9)'; for (let i = 0; i < 160; i++) g.fillRect(r() * w, H * 0.3 + r() * H * 0.25, 1.6, 1.6); }
  if (k <= 0.2) { const mx = w * 0.55, my = H * 0.5; const halo = g.createRadialGradient(mx, my, 10, mx, my, 70); halo.addColorStop(0, 'rgba(255,230,150,.45)'); halo.addColorStop(1, 'rgba(255,230,150,0)'); g.fillStyle = halo; g.fillRect(mx - 80, my - 80, 160, 160); g.fillStyle = '#f6d77a'; g.beginPath(); g.arc(mx, my, 22, 0, 7); g.fill(); } // 노란 달
  else if (k > 0.2) { g.fillStyle = k < 1 ? '#ffd29a' : '#fffbe8'; g.beginPath(); g.arc(w * (0.35 + clamp((h - 6) / 13, 0, 1) * 0.3), H * 0.5, 16, 0, 7); g.fill(); }
  const mt = CT.mountains || ['#b7834f', '#9a6a3f', '#6f6a3e', '#8d5a3a'];
  [[0.58, 26, mt[0]], [0.63, 22, mt[3]], [0.68, 16, mt[1]], [0.73, 12, mt[2]]].forEach(([y, a, c], i) => { // 늦가을 산 (단풍 색 겹)
    g.fillStyle = k < 1 ? mix('#1c2238', c, 0.25 + k * 0.75) : c; g.beginPath(); g.moveTo(0, H); const ph = r() * 6;
    for (let x = 0; x <= w; x += 12) g.lineTo(x, H * y - Math.sin(x / w * (5 + i * 2) + ph) * a - Math.sin(x / w * 17 + ph * 2) * a * 0.35); g.lineTo(w, H); g.fill();
    if (k > 0.4) { g.fillStyle = 'rgba(220,120,60,.25)'; for (let n = 0; n < 60; n++) { const x = r() * w; g.beginPath(); g.arc(x, H * y + r() * 30, 3 + r() * 4, 0, 7); g.fill(); } } // 단풍 점
  });
  g.fillStyle = k < 1 ? mix('#1e2a22', '#5f7a48', k) : '#5f7a48'; g.fillRect(0, H * 0.78, w, H); // 산 밑 들
  courtSkyTex.needsUpdate = true;
  for (const m of hanjiMats) { m.emissive.set(k > 0.3 ? '#fff4dc' : '#ffcf8a'); m.emissiveIntensity = k > 0.3 ? 0.3 + k * 0.25 : 0.75; } // 밤엔 창호지에 따뜻한 빛
}

/* ---------------- 밥상 한마디 판 (벽, 쪽지만 붙음 — 글자는 눌러서 읽음) ---------------- */
let boardMesh = null; const paperMeshes = [];
const PAPER_COLORS = ['#fff6c8', '#ffe1d6', '#e3f1d8', '#dfeaf6', '#f5e3f0', '#fdebc8'];
function buildNoteBoard() {
  const nb = P.noteBoard || { x: -0.2, y: 1.3, z: ROOM.z0 + 0.04 };
  const g = new THREE.Group(); g.position.set(nb.x, nb.y, nb.z); room.add(g);
  const fm = mat(P.wall.timber || shade(P.table, -0.05));
  box(g, 1.8, 1.15, 0.05, fm, 0, 0, 0);
  boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 1.0), mat(PLACE_KEY === 'hanok' ? '#f3e8cf' : '#c9a57a')); boardMesh.position.set(0, 0.575, 0.03); g.add(boardMesh);
  const pg = new THREE.PlaneGeometry(0.3, 0.26);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(pg, mat(PAPER_COLORS[i % PAPER_COLORS.length])); const col = i % 4, row = (i / 4) | 0;
    m.position.set(-0.6 + col * 0.4 + (R() - 0.5) * 0.06, 0.92 - row * 0.32 + (R() - 0.5) * 0.04, 0.035 + i * 0.0005); m.rotation.z = (R() - 0.5) * 0.18; m.visible = false; g.add(m);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), mat('#c0583a')); pin.position.set(0, 0.1, 0.01); m.add(pin);
    paperMeshes.push(m);
  }
}
function showPapers(n) { paperMeshes.forEach((m, i) => { m.visible = i < n; }); }

/* ---------------- 요리사 (손님 = 앞치마 + 음식 별명 이름표, 자리 고정 — 걷지 않음) ---------------- */
const GEO = {
  body: new THREE.CapsuleGeometry(0.27, 0.26, 6, 14), head: new THREE.SphereGeometry(0.3, 20, 14),
  hair: new THREE.SphereGeometry(0.31, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
  bob: new THREE.SphereGeometry(0.335, 20, 12, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.68),
  fringe: new THREE.SphereGeometry(0.318, 16, 8, -1.0, 2.0, 0.42, 0.42), fringeM: new THREE.SphereGeometry(0.312, 16, 8, -0.9, 1.8, 0.5, 0.35),
  scarf: new THREE.SphereGeometry(0.322, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), bun: new THREE.SphereGeometry(0.11, 12, 8),
  gatBrim: new THREE.CylinderGeometry(0.56, 0.56, 0.012, 20), gatCrown: new THREE.CylinderGeometry(0.15, 0.17, 0.27, 12), gatStrap: new THREE.TorusGeometry(0.3, 0.007, 3, 12, Math.PI),
  binyeo: new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5), sangtu: new THREE.SphereGeometry(0.08, 8, 6),
  eye: new THREE.SphereGeometry(0.027, 8, 6), cheek: new THREE.SphereGeometry(0.045, 8, 6),
  leg: new THREE.CapsuleGeometry(0.095, 0.2, 4, 8), arm: new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), hand: new THREE.SphereGeometry(0.075, 8, 6),
  apron: new THREE.CylinderGeometry(0.283, 0.3, 0.42, 16, 1, true, -1.05, 2.1), apronShort: new THREE.CylinderGeometry(0.29, 0.31, 0.26, 16, 1, true, -1.0, 2.0), band: new THREE.TorusGeometry(0.285, 0.018, 4, 20), bib: new THREE.BoxGeometry(0.28, 0.2, 0.025), strap: new THREE.BoxGeometry(0.03, 0.22, 0.02),
  skirt: new THREE.CylinderGeometry(0.3, 0.4, 0.62, 18, 1, true), goreum: new THREE.BoxGeometry(0.05, 0.16, 0.02),
  pocket: new THREE.BoxGeometry(0.14, 0.08, 0.01),
  blade: new THREE.BoxGeometry(0.03, 0.012, 0.17), handle: new THREE.BoxGeometry(0.035, 0.03, 0.08),
  spoonStem: new THREE.CylinderGeometry(0.01, 0.012, 0.2, 6), spoonHead: new THREE.SphereGeometry(0.035, 8, 6),
  shadow: new THREE.CircleGeometry(0.4, 20), ring: new THREE.RingGeometry(0.42, 0.5, 28),
  board: new THREE.BoxGeometry(0.44, 0.03, 0.3),
  bowl: new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bowlFood: new THREE.SphereGeometry(0.12, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
};
const LOOK = {
  shirt: ['#f4c7c3', '#c9dcf0', '#f6e3a8', '#cfe5c8', '#e5d4f0', '#f2d1b3', '#d8e8ea', '#f0e0d0'],
  apron: ['#fbf7ee', '#a9b8a5', '#c98a62', '#e7c56a', '#9fb7cf', '#d9a5a0', '#f4efe2'],
  hair: ['#3b2a20', '#5a3e2b', '#2a2320', '#7a5236', '#a0764c', '#4a3b33'],
};
const SKIN = mat('#FBE2D0'), DARK = mat('#2B2422'), CHEEK = new THREE.MeshBasicMaterial({ color: '#F5A9A6', transparent: true, opacity: 0.5, depthWrite: false }), PANTS = mat('#5b5048'), STEEL = mat('#dfe2e6', { emissive: '#3a3e44', emissiveIntensity: 0.35 }), WOOD = mat('#7a5236');
const GAT_M = new THREE.MeshLambertMaterial({ color: '#141414', transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }); // 갓: 얇고 비치는 흑립 느낌
const BINYEO = mat('#d4af37', { emissive: '#3a2a08', emissiveIntensity: 0.3 });
const SHADOW_M = new THREE.MeshBasicMaterial({ color: 0x3b2a1a, transparent: true, opacity: 0.16, depthWrite: false });
const ME_RING_M = new THREE.MeshBasicMaterial({ color: 0xe08a4a, transparent: true, opacity: 0.75, depthWrite: false });

function labelTex(text, bg, color, fs = 40) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = `700 ${fs}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + fs * 1.1, h = Math.ceil(fs * 1.7); c.width = w; c.height = h;
  g.font = `700 ${fs}px ${FONT}`; g.fillStyle = bg; const r = h / 2;
  g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, h); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { t, w, h };
}
let TAG_K = 0.00042; // 이름표 크기 (화면 높이 비율 — fitCamera 에서 세로 화면이면 작게)
function screenSprite(lt, k, order = 5) { // 화면에서 늘 같은 크기
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.t, transparent: true, depthTest: false, sizeAttenuation: false }));
  sp.scale.set(lt.w * k, lt.h * k, 1); sp.renderOrder = order; return sp;
}
const bubbleTex = new Map();
function bubble(text) { if (!bubbleTex.has(text)) bubbleTex.set(text, labelTex(text, 'rgba(255,253,247,0.96)', '#8a4f25', 42)); return bubbleTex.get(text); }

// 귀여운 몸 하나 (손님·연출 캐릭터가 같이 씀). look: top · apron · apronKind · hair · hairKind · hat
function buildFigure(look, tagText, tagBg) {
  const A = { root: new THREE.Group(), chopUntil: 0, bubble: null, bubbleAt: 0, off: Math.random() * 1000, nodAt: -1e9 };
  const shirt = mat(look.top), hairM = mat(look.hair);
  const hips = new THREE.Group(); hips.position.y = 0.38; A.root.add(hips); A.hips = hips;
  const torso = new THREE.Group(); hips.add(torso); A.torso = torso;
  const body = new THREE.Mesh(GEO.body, shirt); body.position.y = 0.38; torso.add(body);
  if (look.skirt) { const sk = new THREE.Mesh(GEO.skirt, new THREE.MeshLambertMaterial({ color: look.skirt, side: THREE.DoubleSide })); sk.position.y = 0.12; torso.add(sk); } // 한복 치마 (긴)
  if (look.goreum) { const gm = mat(look.goreum); for (const [rz, dx] of [[0.2, 0.06], [-0.1, 0.1]]) { const gr = new THREE.Mesh(GEO.goreum, gm); gr.position.set(dx, 0.62, 0.255); gr.rotation.set(-0.2, 0, rz); torso.add(gr); } } // 저고리 고름
  if (look.apron) {
    const apron = new THREE.MeshLambertMaterial({ color: look.apron, side: THREE.DoubleSide });
    if (look.apronKind === 'short') { // 허리 앞치마 (짧게)
      const ap = new THREE.Mesh(GEO.apronShort, apron); ap.position.y = look.skirt ? 0.24 : 0.2; ap.scale.setScalar(look.skirt ? 1.12 : 1); torso.add(ap);
      const band = new THREE.Mesh(GEO.band, apron); band.rotation.x = Math.PI / 2; band.position.y = look.skirt ? 0.4 : 0.36; torso.add(band);
    } else {
      const ap = new THREE.Mesh(GEO.apron, apron); ap.position.y = 0.26; torso.add(ap);
      const bib = new THREE.Mesh(GEO.bib, apron); bib.position.set(0, 0.56, 0.245); bib.rotation.x = -0.12; torso.add(bib);
      for (const sx of [-1, 1]) { const st = new THREE.Mesh(GEO.strap, apron); st.position.set(sx * 0.11, 0.72, 0.19); st.rotation.set(-0.6, 0, sx * 0.25); torso.add(st); }
      const pk = new THREE.Mesh(GEO.pocket, mat(shade(look.apron, -0.08))); pk.position.set(0, 0.24, 0.3); torso.add(pk);
    }
  }
  const head = new THREE.Group(); head.position.y = 0.98; torso.add(head); A.head = head;
  head.add(new THREE.Mesh(GEO.head, SKIN));
  const hair = new THREE.Mesh(GEO.hair, hairM); hair.rotation.x = -0.25; head.add(hair);
  if (look.hairKind === 'short') head.add(new THREE.Mesh(GEO.fringeM, hairM));
  else if (look.hairKind === 'jjok') { const bn = new THREE.Mesh(GEO.bun, hairM); bn.position.set(0, -0.13, -0.27); bn.scale.set(1.1, 0.8, 0.9); head.add(bn); const pin = new THREE.Mesh(GEO.binyeo, BINYEO); pin.rotation.z = Math.PI / 2; pin.position.set(0, -0.13, -0.3); head.add(pin); } // 쪽진머리 (뒤로 낮게 묶은 쪽 + 비녀)
  else if (look.hairKind === 'sangtu') { const st = new THREE.Mesh(GEO.sangtu, hairM); st.position.set(0, 0.33, -0.02); head.add(st); } // 상투 (갓 아래)
  else if (look.hairKind === 'bun') { head.add(new THREE.Mesh(GEO.fringe, hairM)); const bn = new THREE.Mesh(GEO.bun, hairM); bn.position.set(0, 0.1, -0.29); head.add(bn); }
  else { head.add(new THREE.Mesh(GEO.bob, hairM)); head.add(new THREE.Mesh(GEO.fringe, hairM)); }
  if (look.hat === 'gat') { // 검은 갓: 반투명 재질 하나 · 조각 3개 (챙 · 대우 · 갓끈)
    const brim = new THREE.Mesh(GEO.gatBrim, GAT_M); brim.position.y = 0.2; head.add(brim);
    const crown = new THREE.Mesh(GEO.gatCrown, GAT_M); crown.position.y = 0.34; head.add(crown);
    const strap = new THREE.Mesh(GEO.gatStrap, GAT_M); strap.position.set(0, 0.0, 0.02); strap.rotation.z = Math.PI; head.add(strap);
  } else if (look.hat === 'scarf') { const sc = new THREE.Mesh(GEO.scarf, mat(look.scarf || look.apron || '#f4efe2')); sc.rotation.x = -0.35; sc.position.y = 0.02; head.add(sc); }
  else if (look.hat === 'toque') { const wm = mat('#ffffff'); cyl(head, 0.22, 0.22, 0.3, wm, 0, 0.18, -0.02, 16); sph(head, 0.27, wm, 0, 0.55, -0.02, 14, 10).scale.y = 0.6; }
  else if (look.hat === 'beret') { const b = sph(head, 0.33, mat('#3a3a48'), 0.03, 0.2, -0.02, 16, 8); b.scale.y = 0.32; b.rotation.z = 0.2; }
  else if (look.hat === 'straw') { const st = mat('#d9b56a'); cyl(head, 0.5, 0.5, 0.025, st, 0, 0.16, 0, 20); cyl(head, 0.24, 0.27, 0.17, st, 0, 0.17, 0, 16); }
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(GEO.eye, DARK); e.position.set(sx * 0.081, -0.054, 0.285); head.add(e); // 점 눈 (흰자·코·입 없음, 시안 비율)
    const ck = new THREE.Mesh(GEO.cheek, CHEEK); ck.scale.set(1, 0.53, 0.3); ck.position.set(sx * 0.135, -0.12, 0.255); head.add(ck); // 볼터치 (반투명)
  }
  const pantsM = look.pants ? mat(look.pants) : PANTS;
  A.legs = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * 0.13, 0.05, 0); hips.add(p); const m = new THREE.Mesh(GEO.leg, pantsM); m.position.y = -0.2; p.add(m); return p; });
  A.arms = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * 0.33, 0.6, 0); p.rotation.z = sx * 0.15; torso.add(p); const m = new THREE.Mesh(GEO.arm, shirt); m.position.y = -0.18; p.add(m); const hd = new THREE.Mesh(GEO.hand, SKIN); hd.position.y = -0.36; p.add(hd); return p; });
  const shadow = new THREE.Mesh(GEO.shadow, SHADOW_M); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; A.root.add(shadow);
  const lt = labelTex(tagText, tagBg, '#fff', 38);
  const tag = screenSprite(lt, TAG_K, 4); tag.position.y = look.hat === 'toque' ? 1.95 : look.hat === 'gat' ? 1.9 : look.hat === 'straw' ? 1.78 : 1.62; hips.add(tag); A.tag = tag;
  room.add(A.root);
  return A;
}

// 큰 상 자리: 뒤 줄 6 (앞을 봄) · 앞 줄 6 (등) · 양 끝 2 (양 끝은 연출 캐릭터 밥 자리)
const SEATS = [];
for (const x of [-2.7, -1.8, -0.9, 0.9, 1.8, 2.7]) SEATS.push({ x, z: -0.95, rot: 0 });
for (const x of [-2.7, -1.8, -0.9, 0.9, 1.8, 2.7]) SEATS.push({ x, z: 0.95, rot: Math.PI });
SEATS.push({ x: -3.72, z: 0, rot: Math.PI / 2, staff: true }, { x: 3.72, z: 0, rot: -Math.PI / 2, staff: true });
SEATS.push({ x: 0, z: -1.05, rot: 0, staff: true, noSetting: true }); // 14: 냄비 뒤 가운데 = 부엌 주인 쏠 자리
const ME_SEAT = 3; // 냄비 오른쪽, 얼굴이 보이는 자리 (늘 나만)
let OTHER_SEATS = [2, 4, 1, 5, 0, 8, 9, 7, 10, 6, 11]; // 다른 손님이 앉는 순서 (가운데부터)
const seatInfo = (s) => { const dx = Math.sin(s.rot), dz = Math.cos(s.rot); s.bx = s.x + dx * 0.47; s.bz = s.z + dz * 0.47; return s; };
SEATS.forEach(seatInfo);

// 자리마다 도마(요리할 때) · 밥상 차림(밥 됐어요 ~ 바퀴 끝)
const boards = [], settings = [];
function seatProps(s, top) {
  const b = new THREE.Mesh(GEO.board, mat('#e8c99a')); b.position.set(s.bx, top + 0.015, s.bz); b.rotation.y = s.rot; b.visible = false; room.add(b); boards.push(b);
  const g = new THREE.Group(); g.position.set(s.bx, top, s.bz); g.rotation.y = s.rot; g.visible = false; room.add(g); settings.push(g);
  const ML = P.meal || {}, bm = mat(P.pot.bowl);
  const dish = (x, z, r, food, deep) => { const c = new THREE.Mesh(GEO.bowl, bm); c.scale.setScalar(r / 0.13); c.scale.y *= deep ? 1 : 0.45; c.position.set(x, deep ? 0.13 * r / 0.13 : 0.06, z); c.material.side = THREE.DoubleSide; g.add(c); const f = new THREE.Mesh(GEO.bowlFood, mat(food)); f.scale.set(r / 0.13 * 0.95, 0.3, r / 0.13 * 0.95); f.position.set(x, (deep ? 0.13 * r / 0.13 : 0.06) - 0.02, z); g.add(f); };
  dish(-0.1, -0.02, 0.1, ML.rice || P.pot.food, true); dish(0.13, -0.02, 0.1, ML.soup || '#c98d4a', true); // 밥 · 국
  dish(-0.16, -0.2, 0.07, (ML.sides || ['#6fae4a'])[0], false); dish(0.02, -0.22, 0.07, (ML.sides || [, '#d9473a'])[1] || '#d9473a', false); dish(0.2, -0.2, 0.07, (ML.sides || [, , '#e8c56a'])[2] || '#e8c56a', false); // 반찬
}
const BANGSANG = P.meal && P.meal.kind === 'bangsang';
let mainSetting = null; // 놋그릇 반상 (모든 자리를 한꺼번에 — 그리기 약 12번)
function buildBoards() {
  SEATS.forEach((s, i) => { if (BANGSANG) { const b = new THREE.Mesh(GEO.board, mat('#e8c99a')); b.position.set(s.bx, TABLE_TOP + 0.015, s.bz); b.rotation.y = s.rot; b.visible = false; room.add(b); boards.push(b); settings.push(new THREE.Object3D()); } else seatProps(s, TABLE_TOP); });
  SEATS.forEach((s, i) => { if (s.noSetting) settings[i].scale.setScalar(0.0001); });
  if (BANGSANG) buildBangsang();
}
function buildBangsang() { // 놋 주발(+뚜껑) · 놋 국그릇 · 반찬 접시 5
  const ML = P.meal, seats = SEATS.filter((s) => !s.noSetting), brass = BRASS(), g = new THREE.Group(); g.visible = false; room.add(g); mainSetting = g;
  const at = (s, lx, lz) => [s.bx + lx * Math.cos(s.rot) + lz * Math.sin(s.rot), -lx * Math.sin(s.rot) + lz * Math.cos(s.rot) + s.bz];
  const im = (geo, m, list) => { const o = new THREE.Object3D(), M = new THREE.InstancedMesh(geo, m, list.length); list.forEach((v, i) => { o.position.set(v[0], v[1], v[2]); o.rotation.set(v[3] || 0, 0, v[4] || 0); o.scale.set(v[5] || 1, v[6] || 1, v[5] || 1); o.updateMatrix(); M.setMatrixAt(i, o.matrix); }); g.add(M); };
  const bowlGeo = new THREE.LatheGeometry([[0.02, 0], [0.06, 0.005], [0.085, 0.05], [0.095, 0.1]].map(([a, b]) => new THREE.Vector2(a, b)), 14);
  const plateGeo = new THREE.LatheGeometry([[0.01, 0], [0.05, 0.003], [0.065, 0.025]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
  const foodGeo = new THREE.SphereGeometry(0.085, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), sideGeo = new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const T = TABLE_TOP, bowls = [], rice = [], soup = [], lids = [], plates = [], sides = [[], [], [], [], []];
  for (const s of seats) {
    const [rx, rz] = at(s, -0.11, -0.04), [sx, sz] = at(s, 0.13, -0.04), [lx, lz] = at(s, -0.32, -0.08);
    bowls.push([rx, T, rz], [sx, T, sz]); rice.push([rx, T + 0.09, rz, 0, 0, 1, 0.55]); soup.push([sx, T + 0.07, sz, 0, 0, 1, 0.12]); lids.push([lx, T + 0.01, lz, 0, 0.35, 1, 0.45]);
    for (let k = 0; k < 5; k++) { const [px, pz] = at(s, -0.26 + k * 0.13, 0.16); plates.push([px, T, pz]); sides[k].push([px, T + 0.012, pz, 0, 0, 1, 0.5]); }
  }
  im(bowlGeo, brass, bowls); im(foodGeo, mat(ML.rice || '#fbf8f0'), rice); im(foodGeo, mat(ML.soup || '#c98d4a'), soup);
  im(new THREE.SphereGeometry(0.098, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), brass, lids); // 주발 뚜껑 (옆에 살짝 기대 둠)
  im(plateGeo, brass, plates); (ML.sides || []).slice(0, 5).forEach((c, k) => im(sideGeo, mat(c), sides[k]));
}
// 한 상이 꽉 차면 앞쪽에 상을 하나 더 폄 (방 50명 기준 최대 4상)
const extraTables = [];
function addTable() {
  if (extraTables.length >= 3) return false;
  const k = extraTables.length, z0 = 5.0 + k * 2.6, top = TABLE_TOP;
  const g = new THREE.Group(); room.add(g);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 2.6), mat(P.yard ? P.yard.color : shade(P.floor.color, 0.04))); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.001, z0); g.add(fl);
  box(g, 0.1 + 6.9, 0.08, 1.5, mat(P.table), 0, top - 0.08, z0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.1, top - 0.08, 0.1, mat(shade(P.table, -0.1)), sx * 3.25, 0, z0 + sz * 0.62);
  const first = SEATS.length;
  for (const x of [-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7]) SEATS.push(seatInfo({ x, z: z0 - 0.95, rot: 0 }));
  for (const x of [-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7]) SEATS.push(seatInfo({ x, z: z0 + 0.95, rot: Math.PI }));
  for (let i = first; i < SEATS.length; i++) { seatProps(SEATS[i], top); OTHER_SEATS.push(i); }
  extraTables.push(g); fitCamera(); notice('상이 꽉 차서 옆에 상을 하나 더 폈어요');
  return true;
}

const chefs = new Map(); // 손님 (진짜 손님만): 'me' 또는 's' + 서버 자리 번호 → 캐릭터
const seatOcc = [], jobOcc = JOBS.map((j) => (j.slots || []).map(() => null));
function makeChef(key, name, isMe, seed, job, style) { // style: 'f' 쪽 차림 · 'm' 갓 차림 (없으면 이름으로 정함)
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(seed * 7919 + h), pick = (a) => a[Math.floor(r() * a.length)];
  const f = style === 'f' ? true : style === 'm' ? false : r() < 0.55, G = P.guest || {}, tops = G.tops || LOOK.shirt, bottoms = G.bottoms || ['#5b5048'], aprons = G.aprons || LOOK.apron;
  // 장소별 옷: 한옥 = 파스텔 한복(저고리 + 치마 또는 바지) + 짧은 앞치마 · 토스카나 = 린넨 + 밀짚모자 · 파리 = 흰 제빵복 + 모자
  const look = { top: pick(tops), apron: pick(aprons), apronKind: G.outfit === 'hanbok' ? 'short' : 'front', hair: pick(LOOK.hair), hairKind: f ? 'bob' : 'short', hat: G.hat || null };
  if (G.outfit === 'hanbok') { const b = pick(bottoms); if (f) { look.skirt = b; look.hairKind = 'jjok'; } else { look.pants = b; look.hairKind = 'sangtu'; look.hat = 'gat'; } look.goreum = shade(b, -0.12); } // 한옥: 모두 한복 · 쪽진머리 또는 상투 + 갓
  else look.pants = pick(bottoms);
  const A = buildFigure(look, String(name), isMe ? 'rgba(201,120,62,0.95)' : 'rgba(59,47,37,0.8)');
  Object.assign(A, { key, name, style, isMe, job: -1, seat: null, slot: null, actUntil: 0 });
  const knife = new THREE.Group(); knife.position.set(0, -0.38, 0.04); A.arms[1].add(knife);
  const bl = new THREE.Mesh(GEO.blade, STEEL); bl.position.z = 0.13; knife.add(bl); const hd = new THREE.Mesh(GEO.handle, WOOD); hd.position.z = 0.02; knife.add(hd); A.knife = knife;
  const spoon = new THREE.Group(); spoon.position.set(0, -0.4, 0); spoon.visible = false; A.arms[1].add(spoon);
  const ss = new THREE.Mesh(GEO.spoonStem, STEEL); ss.rotation.x = Math.PI / 2; ss.position.z = 0.08; spoon.add(ss); const sh = new THREE.Mesh(GEO.spoonHead, STEEL); sh.scale.set(0.9, 0.35, 1.3); sh.position.z = 0.2; spoon.add(sh); A.spoon = spoon;
  const stool = new THREE.Group(); stool.position.set(0, 0, -0.08); stool.visible = false; A.root.add(stool); A.stool = stool; // 상에 앉을 때 의자
  cyl(stool, 0.2, 0.2, 0.05, mat(shade(P.table, 0.05)), 0, 0.25, 0, 14); for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) cyl(stool, 0.02, 0.02, 0.25, mat(shade(P.table, -0.1)), x, 0, z, 6);
  if (isMe) { const ring = new THREE.Mesh(GEO.ring, ME_RING_M); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.014; A.root.add(ring); }
  chefs.set(key, A);
  placeChef(A, job | 0);
  return A;
}
function leaveSpot(A) {
  if (A.seat != null) { seatOcc[A.seat] = null; boards[A.seat].visible = false; A.seat = null; }
  if (A.slot != null && jobOcc[A.job]) { jobOcc[A.job][A.slot] = null; A.slot = null; }
}
function placeChef(A, job) { // 일거리 자리로 바로 옮김 (걷지 않음). 자리가 모자라면 화면에 안 보이고 숫자만 셈
  if (!JOBS[job]) job = 0;
  leaveSpot(A); A.job = job; A.sitting = false;
  let x, z, rot;
  if (job === 0) {
    let seat = A.isMe && !seatOcc[ME_SEAT] ? ME_SEAT : OTHER_SEATS.find((v) => !seatOcc[v]);
    if (seat == null && addTable()) seat = OTHER_SEATS.find((v) => !seatOcc[v]);
    if (seat == null) { A.root.visible = false; refreshCounts(); return; }
    seatOcc[seat] = A.key; A.seat = seat; ({ x, z, rot } = SEATS[seat]);
  } else {
    const k = jobOcc[job].findIndex((o) => o == null);
    if (k < 0) { A.root.visible = false; refreshCounts(); return; }
    jobOcc[job][k] = A.key; A.slot = k; [x, z, rot] = JOBS[job].slots[k];
  }
  A.root.visible = true; A.root.position.set(x, job === 0 ? MARU_H : 0, z); A.root.rotation.y = rot; // 상 자리는 대청마루 위
  refreshCounts();
}
function removeChef(key) {
  const A = chefs.get(key); if (!A) return;
  leaveSpot(A); room.remove(A.root); A.tag.material.map.dispose(); A.tag.material.dispose(); chefs.delete(key); refreshCounts();
}
function say(A, g, quiet) { // 머리 위 말풍선 (+ 인사면 위쪽 알림)
  if (A.bubble) A.hips.remove(A.bubble);
  const text = typeof g === 'number' ? GREETS[g] : g;
  const sp = screenSprite(bubble(text), TAG_K * 1.15, 6); sp.position.y = A.tag.position.y + 0.33; A.hips.add(sp); A.bubble = sp; A.bubbleAt = performance.now();
  if (typeof g === 'number' && !quiet) { notice(A.isMe ? `'${text}' 하고 인사했어요` : `누군가 '${text}' 하고 인사했어요`); staffNod(); }
}
// 톡 한 번 = 그 자리 동작 한 번 + 소리 한 번
const ACT_MS = 650;
function act(A, now) {
  const job = JOBS[A.job] || JOBS[0];
  if (A.job === 0) { // 식탁: 도마 톡 → 재료가 냄비로 (요리하는 동안만)
    if (A.seat == null || phaseOf(clock()) >= CALL_AT) return;
    if (A.chopUntil > now + 200) { A.queued = Math.min(4, (A.queued || 0) + 1); return; }
    A.chopUntil = now + 560; const s = SEATS[A.seat];
    spawnFlight(new THREE.Vector3(s.bx, TABLE_TOP + 0.08, s.bz), now + 380, A.isMe);
  } else {
    if (A.actUntil > now + 150) { A.queued = Math.min(4, (A.queued || 0) + 1); return; }
    A.actUntil = now + ACT_MS;
    if (job.fx && A.root.visible) setTimeout(() => bits(job.fx.color, job.fx.at, job.act === 'fire'), 260);
    if (job.act === 'fire') fireBoost = now + 900;
  }
  if (A.isMe) audio.play(job.sound || 'tok'); else otherSound(job.sound || 'tok');
}
const chop = act;
let lastOther = 0;
function otherSound(name) { const t = performance.now(); if (t - lastOther < 900) return; lastOther = t; audio.play(name, 0, 0.18); } // 다른 손님 소리는 아주 작게
function bubbleTick(A, now) { if (A.bubble) { const a = (now - A.bubbleAt) / 2800; if (a > 1) { A.hips.remove(A.bubble); A.bubble = null; } else { A.bubble.position.y = A.tag.position.y + 0.33 + a * 0.25; A.bubble.material.opacity = a < 0.8 ? 1 : (1 - a) / 0.2; } } }
// 동작 모양: k = 0(쉬는 중)~1(톡 한 직후), a = 동작 진행 0~1
function actPose(name, k, a, t, now) {
  const sw = Math.sin(Math.PI * a) * k;
  switch (name) {
    case 'chop': return { rx: -0.95 - Math.abs(Math.sin(now / 45)) * 0.32 * k, lx: -0.75 * k, bow: 0.12 * k };
    case 'trim': return { lx: -0.75 + Math.sin(t * 12) * 0.25 * k, rx: -0.75 - Math.sin(t * 12 + 1) * 0.25 * k - 0.05 * Math.sin(t * 2), bow: 0.2 };
    case 'wash': return { lx: -0.95 + Math.sin(t * 11) * 0.3 * k, rx: -0.95 - Math.sin(t * 11) * 0.3 * k, bow: 0.4 };
    case 'scrub': return { lx: -0.9, rx: -0.95 + Math.sin(t * 13) * 0.3 * k, rz: Math.cos(t * 13) * 0.2 * k, bow: 0.2 };
    case 'fire': return { rx: -0.6 - sw * 0.8, lx: -0.25, bow: 0.35 };
    case 'pick': return { rx: -0.3 - sw * 2.4, lx: -0.7, bow: -0.05 * sw };
    case 'knead': return { lx: -0.9 - sw * 0.45, rx: -0.9 - sw * 0.45, bow: 0.2 + sw * 0.12 };
    case 'roll': return { lx: -1.0 - Math.sin(t * 10) * 0.3 * k, rx: -1.0 - Math.sin(t * 10) * 0.3 * k, bow: 0.25 };
    case 'pipe': return { rx: -1.05 - sw * 0.15, rz: Math.cos(t * 9) * 0.1 * k, lx: -0.8, bow: 0.2 };
    case 'lift': return { lx: -0.5 - sw * 1.3, rx: -0.5 - sw * 1.3, bow: 0.1 - sw * 0.1 };
    case 'hang': return { lx: -0.5 - sw * 2.1, rx: -0.5 - sw * 2.1, bow: -0.05 };
    default: return { lx: 0, rx: 0, bow: 0 };
  }
}
function updateChef(A, now, phase) {
  if (!A.root.visible) return;
  const t = (now + A.off) / 1000, job = JOBS[A.job] || JOBS[0], atTable = A.job === 0 && A.seat != null;
  const eating = atTable && phase >= MEAL_AT && phase < MEAL_END, mt = phase - MEAL_AT;
  const seated = atTable && (COURT || phase >= CALL_AT || A.sitting); // 한옥은 좌식: 상에서는 늘 방석에 앉음
  const [L, Rr] = A.arms;
  let p = { lx: Math.sin(t * 1.3) * 0.05, rx: -Math.sin(t * 1.3) * 0.05, bow: 0, rz: 0 }, bob = 0;
  A.knife.visible = atTable && phase < CALL_AT; A.spoon.visible = eating && mt > 1600;
  if (eating) {
    if (mt < 1600) p.bow = Math.sin(Math.PI * mt / 1600) * 0.45; // 잘 먹겠습니다 (꾸벅)
    else { const b = ((mt - 1600 + A.off * 3) % 1300) / 1300, up = b < 0.4 ? 0 : b < 0.6 ? (b - 0.4) / 0.2 : b < 0.8 ? 1 : 1 - (b - 0.8) / 0.2; p.rx = -0.75 - ease(up) * 1.35; p.lx = -0.45; bob = Math.abs(Math.sin(t * 5)) * 0.02; }
  } else if (atTable) {
    if (now < A.chopUntil) p = actPose('chop', 1, 0, t, now); else if (A.queued) { A.queued--; act(A, now); }
  } else {
    const on = now < A.actUntil, a = on ? 1 - (A.actUntil - now) / ACT_MS : 0;
    p = Object.assign(p, actPose(job.act, on ? 1 : 0.15, a, t, now));
    if (!on && A.queued) { A.queued--; act(A, now); }
  }
  L.rotation.x = lerp(L.rotation.x, p.lx, 0.35); Rr.rotation.x = lerp(Rr.rotation.x, p.rx, 0.35); Rr.rotation.z = lerp(Rr.rotation.z, -0.15 + (p.rz || 0), 0.3);
  A.torso.rotation.x = lerp(A.torso.rotation.x, p.bow, 0.25);
  const pose = atTable ? (seated ? 'sit' : 'stand') : job.pose || 'stand';
  A.stool.visible = atTable && seated && !COURT;
  const hy = pose === 'sit' ? (atTable ? (COURT ? MARU_SIT : 0.3) : 0.3 + (job.seatH || 0)) : pose === 'crouch' ? 0.2 : 0.38;
  A.hips.position.y = hy + bob + Math.sin(t * 2) * 0.006;
  for (const l of A.legs) l.rotation.x = lerp(l.rotation.x, pose === 'sit' ? (atTable && COURT ? -1.5 : -1.3) : pose === 'crouch' ? -1.1 : 0, 0.2);
  A.head.rotation.y = Math.sin(t * 0.4) * 0.12;
  bubbleTick(A, now);
}

// 일거리 자리 사람 수 (진짜 손님만 — 연출 캐릭터는 안 셈). 자리 위에 작게 "고추 따는 사람 3"
const jobLabels = [];
function jobCounts() { const c = JOBS.map(() => 0); for (const A of chefs.values()) if (c[A.job] != null) c[A.job]++; return c; }
function refreshCounts() {
  const c = jobCounts();
  JOBS.forEach((j, i) => {
    if (i === 0 || !j.slots) return;
    let L0 = jobLabels[i]; if (L0 && L0.n === c[i]) return;
    if (L0) { room.remove(L0.sp); L0.sp.material.map.dispose(); L0.sp.material.dispose(); jobLabels[i] = null; }
    if (!c[i]) return;
    const lt = labelTex(`${j.who} 사람 ${c[i]}`, 'rgba(255,250,240,0.92)', '#6b4425', 34), sp = screenSprite(lt, TAG_K * 0.9, 3);
    const xs = j.slots.map((s) => s[0]), zs = j.slots.map((s) => s[1]); sp.position.set(xs.reduce((a, b) => a + b) / xs.length, 2.25, zs.reduce((a, b) => a + b) / zs.length); room.add(sp);
    jobLabels[i] = { sp, n: c[i] };
  });
  if ($('jobSheet').classList.contains('on')) renderJobs();
}

// 톡 할 때 튀는 조각 (물방울·불티·고추·올리브 …)
const bitPool = [], bitGeo = new THREE.SphereGeometry(0.035, 6, 4);
let fireBoost = 0;
function bits(color, at, up) {
  const m = mat(color, up ? { emissive: color, emissiveIntensity: 0.8 } : undefined);
  for (let i = 0; i < 6; i++) {
    let b = bitPool.find((x) => !x.o.visible); if (!b) { if (bitPool.length > 40) return; b = { o: new THREE.Mesh(bitGeo, m) }; room.add(b.o); bitPool.push(b); }
    b.o.material = m; b.o.visible = true; b.t0 = performance.now(); b.x = at[0]; b.y = at[1]; b.z = at[2];
    b.vx = (Math.random() - 0.5) * 1.2; b.vz = (Math.random() - 0.5) * 1.2; b.vy = 1.2 + Math.random() * 1.2 + (up ? 0.8 : 0); b.up = up;
  }
}
function updateBits(now, dt) {
  for (const b of bitPool) {
    if (!b.o.visible) continue; const a = (now - b.t0) / 900; if (a > 1) { b.o.visible = false; continue; }
    b.vy -= (b.up ? 2 : 6) * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.o.position.set(b.x, Math.max(0.03, b.y), b.z); b.o.scale.setScalar(1 - a * 0.6);
  }
}

/* ---------------- 부엌 주인 쏠 (디자인팀 시안 1: 일자 앞머리 단발 · 점 눈 · 볼터치 · 코·입 없음 · 머리:몸 = 1:1 · 손 모은 자세 · 안경 없음) ---------------- */
// 기준 u = 머리 지름. 크기 비율은 시안 표 그대로 (눈 0.09 · 간격 0.27 · 볼 0.15×0.08 · 몸 높이 0.85 · 위 폭 0.63 · 아래 폭 0.71 · 팔 0.4×0.17 · 손 0.15 · 발 0.19×0.12)
const SOLL = { skin: '#FBE2D0', hair: '#43352F', eye: '#2B2422', cheek: '#F5A9A6', feet: '#9C7A62', pin: '#D9B45A' };
function buildSoll(look, tagText) {
  const u = 0.66, r = u / 2, bodyH = 0.85 * u, rTop = 0.315 * u, rBot = 0.355 * u, footH = 0.12 * u;
  const A = { root: new THREE.Group(), chopUntil: 0, bubble: null, bubbleAt: 0, off: Math.random() * 1000, nodAt: -1e9, hipY: footH * 0.6, handY: -(0.4 * u + 0.02) };
  const hips = new THREE.Group(); hips.position.y = A.hipY; A.root.add(hips); A.hips = hips;
  const torso = new THREE.Group(); hips.add(torso); A.torso = torso;
  if (look.skirt) { // 한복: 저고리(위) + 치마(아래, 넓게)
    cyl(torso, rTop * 0.96, rTop, bodyH * 0.45, mat(look.top), 0, bodyH * 0.55, 0, 16);
    cyl(torso, rTop * 1.02, rBot * 1.12, bodyH * 0.62, mat(look.skirt), 0, 0, 0, 16);
    const cm = mat(look.collar || '#9DB3D3'); for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.02), cm); c.position.set(sx * 0.045, bodyH * 0.86, rTop * 0.95); c.rotation.z = sx * 0.55; torso.add(c); } // 깃 (V)
    if (look.goreum) { const gm = mat(look.goreum); for (const [rz, dx] of [[0.25, 0.05], [-0.1, 0.085]]) { const g = new THREE.Mesh(GEO.goreum, gm); g.scale.set(0.8, 0.8, 1); g.position.set(dx, bodyH * 0.7, rTop * 1.0); g.rotation.set(-0.15, 0, rz); torso.add(g); } } // 고름
  } else cyl(torso, rTop, rBot, bodyH, mat(look.top), 0, 0, 0, 16);
  if (look.apron) { // 짧은 크림 앞치마 + 끈
    const am = new THREE.MeshLambertMaterial({ color: look.apron, side: THREE.DoubleSide });
    const ap = new THREE.Mesh(new THREE.CylinderGeometry(rBot * (look.skirt ? 1.08 : 1.02), rBot * (look.skirt ? 1.14 : 1.05), bodyH * 0.42, 14, 1, true, -0.95, 1.9), am); ap.position.y = bodyH * 0.27; torso.add(ap);
    const band = new THREE.Mesh(new THREE.TorusGeometry(rTop * 1.02, 0.012, 4, 20), mat(look.apronString || '#E7A496')); band.rotation.x = Math.PI / 2; band.position.y = bodyH * 0.5; torso.add(band);
  }
  if (look.scarf) { const sc = new THREE.Mesh(new THREE.TorusGeometry(rTop * 0.7, 0.03, 6, 16), mat(look.scarf)); sc.rotation.x = Math.PI / 2; sc.position.y = bodyH * 0.98; torso.add(sc); } // 작은 스카프
  const head = new THREE.Group(); head.position.y = bodyH + r * 0.92; torso.add(head); A.head = head;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat(SOLL.skin)));
  const hm = mat(SOLL.hair), sh = r * 1.04;
  if (look.hairKind === 'jjok') { // 쪽진머리: 가운데 가르마 껍질 + 뒤통수 아래 쪽 + 금색 비녀
    const cap = new THREE.Mesh(new THREE.SphereGeometry(sh, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hm); cap.rotation.x = -0.18; head.add(cap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(sh, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.62), hm); head.add(back);
    const bun = new THREE.Mesh(GEO.bun, hm); bun.scale.set(0.33 * u / 0.22, 0.27 * u / 0.22, 0.27 * u / 0.22); bun.position.set(0, -0.12 * u, -0.5 * u); head.add(bun);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5 * u, 5), mat(SOLL.pin, { emissive: '#3a2a08', emissiveIntensity: 0.3 })); pin.rotation.z = Math.PI / 2; pin.position.set(0, -0.12 * u, -0.52 * u); head.add(pin);
  } else { // 일자 앞머리 단발: 뒤·옆 껍질(끝 = 중심 아래 0.33) + 앞머리(끝 = 눈 위 0.3)
    const bobT = Math.acos(clamp(-0.33 * u / sh, -1, 1)), bangT = Math.acos(clamp((-0.09 + 0.3) * u / sh, -1, 1));
    head.add(new THREE.Mesh(new THREE.SphereGeometry(sh, 20, 12, Math.PI * 0.72, Math.PI * 1.56, 0, bobT), hm));
    head.add(new THREE.Mesh(new THREE.SphereGeometry(sh * 1.005, 16, 8, Math.PI * 0.2, Math.PI * 0.6, 0, bangT), hm));
  }
  const eyeM = mat(SOLL.eye), ckM = new THREE.MeshBasicMaterial({ color: SOLL.cheek, transparent: true, opacity: 0.5, depthWrite: false });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045 * u, 8, 6), eyeM); e.position.set(sx * 0.135 * u, -0.09 * u, r * 0.94); head.add(e);
    const ck = new THREE.Mesh(new THREE.SphereGeometry(0.075 * u, 10, 6), ckM); ck.scale.set(1, 0.53, 0.3); ck.position.set(sx * 0.22 * u, -0.2 * u, r * 0.86); head.add(ck);
  }
  if (look.hat === 'straw') { const st = mat('#EEDCB0'); cyl(head, 0.7 * u, 0.7 * u, 0.02, st, 0, r * 0.55, 0, 22); cyl(head, 0.3 * u, 0.33 * u, 0.25 * u, st, 0, r * 0.55, 0, 16); cyl(head, 0.335 * u, 0.335 * u, 0.06 * u, mat('#7A5A44'), 0, r * 0.57, 0, 16); }
  else if (look.hat === 'toque') { const wm = mat('#FFFFFF'); cyl(head, 0.36 * u, 0.36 * u, 0.32 * u, wm, 0, r * 0.45, -0.02, 16); sph(head, 0.44 * u, wm, 0, r * 0.45 + 0.42 * u, -0.02, 14, 10).scale.y = 0.6; }
  const armM = mat(look.skirt ? look.top : look.top), skinM = mat(SOLL.skin);
  A.arms = [-1, 1].map((sx) => { // 손 모은 자세 (팔을 앞으로 모음)
    const p = new THREE.Group(); p.position.set(sx * (rTop + 0.02), bodyH * 0.9, 0); p.rotation.z = sx * -0.45; torso.add(p);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * u, 0.4 * u - 0.17 * u, 4, 8), armM); m.position.y = -0.2 * u; p.add(m);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.075 * u, 8, 6), skinM); hd.position.y = -(0.4 * u); p.add(hd); return p;
  });
  A.restLX = -0.55; // 기본 팔 앞으로 (손 모음)
  A.legs = [-1, 1].map((sx) => { const p = new THREE.Group(); p.position.set(sx * 0.12 * u, 0, 0.03); hips.add(p); const f = sph(p, 0.095 * u, mat(look.feet || SOLL.feet), 0, -A.hipY + footH * 0.5, 0.02, 10, 6); f.scale.set(1, 0.63, 1.3); return p; }); // 발 (다리 없음)
  const shadow = new THREE.Mesh(GEO.shadow, SHADOW_M); shadow.scale.setScalar(0.8); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; A.root.add(shadow);
  const lt = labelTex(tagText, 'rgba(95,117,80,0.92)', '#fff', 38);
  const tag = screenSprite(lt, TAG_K, 4); tag.position.y = look.hat === 'toque' ? 1.62 : look.hat === 'straw' ? 1.42 : 1.3; hips.add(tag); A.tag = tag;
  room.add(A.root);
  return A;
}

/* ---------------- 연출 캐릭터 (그 부엌의 주인·일꾼 — 손님 아님, 사람 수에 안 셈) ---------------- */
const staff = [];
function prepTable(x, z, kind) { // 작은 작업대 + 위 소품
  const g = new THREE.Group(); g.position.set(x, 0, z); room.add(g);
  box(g, 0.7, 0.62, 0.5, mat(shade(P.table, 0.04)), 0, 0, 0); box(g, 0.74, 0.04, 0.54, P.marble ? mat('#f2efea') : mat(shade(P.table, -0.05)), 0, 0.62, 0);
  const top = 0.66;
  if (kind === 'greens') { // 나물 바구니
    const b = lathe([[0.02, 0], [0.24, 0.01], [0.27, 0.07]], mat('#b88a50'), 16); b.material.side = THREE.DoubleSide; b.position.y = top; g.add(b);
    for (let i = 0; i < 9; i++) sph(g, 0.05, mat(i % 3 ? '#6fae4a' : '#8cc35e'), (Math.random() - 0.5) * 0.3, top + 0.06, (Math.random() - 0.5) * 0.2, 8, 6);
  } else if (kind === 'dough') { const d = sph(g, 0.16, mat('#f1e2c2'), 0, top + 0.08, 0.05, 16, 10); d.scale.y = 0.55; g.userData.dough = d; }
  else if (kind === 'cake') { cyl(g, 0.2, 0.2, 0.14, mat('#f3dcc0'), 0, top, 0.05, 20); cyl(g, 0.205, 0.205, 0.03, mat('#fffaf2'), 0, top + 0.14, 0.05, 20); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; sph(g, 0.03, mat('#fffaf2'), Math.cos(a) * 0.15, top + 0.18, 0.05 + Math.sin(a) * 0.15, 8, 6); } }
  return g;
}
function holdBasket(A, kind) { // 두 손으로 드는 바구니 (올리브 · 빵)
  const g = new THREE.Group(); g.position.set(0, 0.36, 0.42); A.torso.add(g);
  const b = lathe([[0.02, 0], [0.2, 0.01], [0.24, 0.13]], mat('#b88a50'), 14); b.material.side = THREE.DoubleSide; g.add(b);
  if (kind === 'olive') for (let i = 0; i < 12; i++) sph(g, 0.035, mat(i % 3 ? '#6e7a34' : '#2e2a30'), (Math.random() - 0.5) * 0.28, 0.12, (Math.random() - 0.5) * 0.28, 6, 5);
  else for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.36, 4, 8), mat('#d49a58')); l.rotation.set(0.5, 0, 0.3 + i * 0.25); l.position.set(-0.06 + i * 0.06, 0.18, 0); g.add(l); }
}
function buildStaff() {
  for (const d of P.staff || []) {
    const A = d.owner ? buildSoll(d.look, d.role) : buildFigure(d.look, d.role, 'rgba(95,117,80,0.92)'); A.def = d; A.isStaff = true;
    const [x, z, rot] = d.at; A.x = x; A.z = z; A.root.position.set(x, 0, z); A.root.rotation.y = rot; A.dir = 1;
    const stool = new THREE.Group(); stool.position.set(0, 0, -0.08); stool.visible = false; A.root.add(stool); A.stool = stool;
    cyl(stool, 0.2, 0.2, 0.05, mat(shade(P.table, 0.05)), 0, 0.25, 0, 14); for (const [sx, sz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) cyl(stool, 0.02, 0.02, 0.25, mat(shade(P.table, -0.1)), sx, 0, sz, 6);
    if (d.prep) A.prep = prepTable(x + Math.sin(rot) * 0.52, z + Math.cos(rot) * 0.52, d.prep);
    if (d.act === 'fire') { const fan = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14, 0, Math.PI), new THREE.MeshLambertMaterial({ color: '#e9d9b5', side: THREE.DoubleSide })); fan.position.set(0, -0.42, 0.05); fan.rotation.x = Math.PI / 2; A.arms[1].add(fan); }
    if (d.act === 'host') { const ld = new THREE.Group(); ld.position.set(0, A.handY != null ? A.handY : -0.4, 0.04); A.arms[1].add(ld); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), mat('#8a6a4a')); st.rotation.x = Math.PI / 2; st.position.z = 0.12; ld.add(st); const cup = new THREE.Mesh(GEO.spoonHead, STEEL); cup.scale.set(1.6, 1.2, 1.6); cup.position.set(0, -0.03, 0.28); ld.add(cup); } // 국자
    if (d.act === 'pipe') { const bag = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 10), mat('#f4f1ea')); bag.position.set(0, -0.48, 0.05); bag.rotation.x = Math.PI; A.arms[1].add(bag); }
    if (d.act === 'basket') holdBasket(A, PLACE_KEY === 'tuscany' ? 'olive' : 'bread');
    staff.push(A);
  }
}
function staffNod() { const now = performance.now(); for (const A of staff) if (Math.random() < 0.6) A.nodAt = now + 300 + Math.random() * 900; } // 손님 인사에 가끔 끄덕
const STAFF_SEATS = [14, 12, 13]; // 주인 쏠은 냄비 뒤 가운데, 식구들은 큰 상 양 끝
function updateStaff(now, phase, dt) {
  const mt = phase - MEAL_AT;
  let si = 0;
  for (const A of staff) {
    const d = A.def, t = (now + A.off) / 1000, [L, Rr] = A.arms;
    let lx = Math.sin(t * 1.3) * 0.05, rx = -Math.sin(t * 1.3) * 0.05, bow = 0, walk = 0;
    const dine = !d.outside && si < STAFF_SEATS.length && phase >= CALL_AT; // 밥 됐어요 → 상 끝자리에 앉음 (창밖 사람은 그대로)
    const seat = !d.outside && si < STAFF_SEATS.length ? SEATS[STAFF_SEATS[si++]] : null;
    if (dine) { A.root.position.set(seat.x, MARU_H, seat.z); A.root.rotation.y = seat.rot; } else if (d.owner && liveOn) { A.root.position.set(0, 0, COURT ? 2.05 : 1.75); A.root.rotation.y = 0; } else if (d.act !== 'basket') { A.root.position.set(d.at[0], 0, d.at[1]); A.root.rotation.y = d.at[2] || 0; } // 저녁 짓는 시간엔 쏠이 부엌 가운데(식탁 앞)
    A.dining = dine; if (A.stool) A.stool.visible = dine && !COURT;
    if (dine) { if (mt >= 0 && mt < 1600) bow = Math.sin(Math.PI * mt / 1600) * 0.45; else if (mt >= 1600 && phase < MEAL_END) { const b = ((mt + A.off * 3) % 1400) / 1400; rx = -0.75 - Math.sin(b * Math.PI) * 1.2; lx = -0.45; } }
    else if (d.act === 'host') { rx = -0.7 + Math.sin(t * 1.6) * 0.25; lx = A.restLX != null ? A.restLX : -0.15; A.head.rotation.y = Math.sin(t * 0.5) * 0.4; }
    else if (d.act === 'fire') { bow = 0.3; rx = -0.75 + Math.sin(t * 7) * 0.28; lx = -0.2; }
    else if (d.act === 'greens') { bow = 0.25; lx = -0.95 + Math.sin(t * 4) * 0.12; rx = -0.95 - Math.sin(t * 4 + 1) * 0.12; }
    else if (d.act === 'knead') { const k = (Math.sin(t * 3) + 1) / 2; bow = 0.2 + k * 0.12; lx = rx = -0.9 - k * 0.35; if (A.prep && A.prep.userData.dough) A.prep.userData.dough.scale.set(1 + k * 0.12, 0.55 - k * 0.12, 1 + k * 0.08); }
    else if (d.act === 'pipe') { bow = 0.2; rx = -1.05 + Math.sin(t * 5) * 0.06; lx = -0.8; A.arms[1].rotation.z = 0.15 + Math.cos(t * 5) * 0.08; }
    else if (d.act === 'basket' || dine) { // 바구니 들고 오가기
      lx = rx = -0.95; const [x1, x2] = d.path;
      if (A.pause > now) walk = 0; else {
        if (dine) { walk = 0; } else { A.x += A.dir * 0.45 * dt; walk = 1; }
        if (A.x > x2) { A.x = x2; A.dir = -1; A.pause = now + 1500 + Math.random() * 2500; } else if (A.x < x1) { A.x = x1; A.dir = 1; A.pause = now + 1500 + Math.random() * 2500; }
      }
      if (!dine) { const want = walk ? A.dir * Math.PI / 2 : (d.at[2] || 0); A.root.rotation.y = angLerp(A.root.rotation.y, want, Math.min(1, dt * 5)); A.root.position.set(A.x, 0, d.at[1]); }
    }
    for (let i = 0; i < 2; i++) A.legs[i].rotation.x = walk ? Math.sin(t * 8 + i * Math.PI) * 0.45 : lerp(A.legs[i].rotation.x, 0, 0.2);
    L.rotation.x = lerp(L.rotation.x, lx, 0.3); Rr.rotation.x = lerp(Rr.rotation.x, rx, 0.3);
    A.torso.rotation.x = lerp(A.torso.rotation.x, bow, 0.2);
    const na = (now - A.nodAt) / 800; A.head.rotation.x = na > 0 && na < 1 ? Math.sin(na * Math.PI * 2) * 0.22 : 0; // 끄덕
    if (d.act !== 'host') A.head.rotation.y = Math.sin(t * 0.35) * 0.15;
    const sit = dine || d.pose === 'sit';
    for (const l of A.legs) if (sit) l.rotation.x = lerp(l.rotation.x, -1.3, 0.2);
    A.hips.position.y = sit ? (dine ? (COURT ? (A.hipY != null ? 0.04 : MARU_SIT) : 0.3) : 0.3 + (d.seatH || 0)) : (A.hipY != null ? A.hipY : 0.38) + (walk ? Math.abs(Math.sin(t * 8)) * 0.03 : 0);
    bubbleTick(A, now);
  }
}
function angLerp(a, b, t) { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }

/* ---------------- 재료가 냄비로 (톡 → 휙 → 퐁) ---------------- */
const ING = [
  [new THREE.ConeGeometry(0.035, 0.12, 8), mat('#ef8a3a')], [new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), mat('#6fae4a')],
  [new THREE.SphereGeometry(0.045, 10, 8), mat('#d9473a')], [new THREE.SphereGeometry(0.05, 10, 8), mat('#e3cf9a')], [new THREE.BoxGeometry(0.06, 0.06, 0.06), mat('#f4f0e6')],
];
const flights = [], flightPool = [];
let lidHop = -1e9;
function spawnFlight(from, at, mine) {
  if (flights.length > 36) return;
  const [geo, m] = ING[Math.floor(Math.random() * ING.length)];
  let o = flightPool.pop(); if (!o) { o = new THREE.Mesh(geo, m); room.add(o); } else { o.geometry = geo; o.material = m; }
  o.visible = false; o.position.copy(from);
  flights.push({ o, from: from.clone(), at, dur: 650, mine, spin: (Math.random() - 0.5) * 12 });
}
function updateFlights(now) {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i], a = (now - f.at) / f.dur;
    if (a < 0) continue;
    if (a >= 1) { f.o.visible = false; flightPool.push(f.o); flights.splice(i, 1); lidHop = now; puff(2); if (f.mine) audio.play('plop'); continue; }
    f.o.visible = true;
    const to = new THREE.Vector3(POT_POS.x + (Math.random() - 0.5) * 0.05, POT_TOP + 0.02, POT_POS.z);
    f.o.position.lerpVectors(f.from, to, a); f.o.position.y += Math.sin(a * Math.PI) * 0.75; f.o.rotation.x += f.spin * 0.016; f.o.rotation.z += f.spin * 0.01;
  }
}

/* ---------------- 김 ---------------- */
const steamTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const steam = [];
for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); steam.push({ s, t0: 0, life: 0 }); }
let steamAcc = 0;
function puff(n) { for (let i = 0; i < n; i++) { const p = steam.find((x) => !x.s.visible); if (!p) return; p.s.visible = true; p.t0 = performance.now(); p.life = 1800 + Math.random() * 1400; p.x = (Math.random() - 0.5) * 0.4; p.z = (Math.random() - 0.5) * 0.3; } }
function updateSteam(now, dt, rate) {
  steamAcc += dt * rate * (tier === 2 ? 0.5 : 1); while (steamAcc > 1) { steamAcc -= 1; puff(1); }
  for (const p of steam) {
    if (!p.s.visible) continue; const a = (now - p.t0) / p.life;
    if (a >= 1) { p.s.visible = false; continue; }
    p.s.position.set(POT_POS.x + p.x + Math.sin(a * 4 + p.z * 9) * 0.08, POT_TOP + 0.05 + a * 1.3, POT_POS.z + p.z); const sc = 0.25 + a * 0.55; p.s.scale.set(sc, sc, 1);
    p.s.material.opacity = Math.sin(a * Math.PI) * 0.5;
  }
}

/* ---------------- 미엘 (크림색 고양이, 돌아다님) ---------------- */
const miel = { root: new THREE.Group(), path: P.miel || [[-4.35, -1.2], [-4.2, 0.6], [-3.95, 1.8], [-1.5, 2.15], [1.2, 2.1], [3.95, 1.7], [4.3, 0.4], [4.35, -1.0]], i: 0, dir: 1, mode: 'walk', until: 0, x: -3.95, z: 1.8, rot: 0, bubbleAt: 0, bubble: null };
function buildMiel() {
  miel.x = miel.path[0][0]; miel.z = miel.path[0][1];
  const stripe = canvasTex(128, 64, (g, w, h) => { g.fillStyle = '#f4e6cc'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(226,170,120,.45)'; for (let x = 6; x < w; x += 16) g.fillRect(x, 0, 6, h * 0.62); });
  const fur = new THREE.MeshLambertMaterial({ map: stripe }), cream = mat('#f4e6cc'), white = mat('#fffaf1'), pink = mat('#f2b5a8'), amber = mat('#d9952e'), dark = mat('#2b2420');
  const R0 = miel.root; R0.scale.setScalar(0.85); room.add(R0);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), fur); body.scale.set(0.85, 0.8, 1.45); body.position.y = 0.26; R0.add(body); miel.body = body;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), white); chest.position.set(0, 0.24, 0.2); chest.scale.set(1, 1.1, 0.8); R0.add(chest);
  const head = new THREE.Group(); head.position.set(0, 0.42, 0.28); R0.add(head); miel.head = head;
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), cream));
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), white); muzzle.position.set(0, -0.04, 0.11); muzzle.scale.set(1.3, 0.8, 0.8); head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), pink); nose.position.set(0, -0.01, 0.165); head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.1, 4), cream); ear.position.set(s * 0.085, 0.13, 0); ear.rotation.z = -s * 0.25; head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), pink); inner.position.set(s * 0.085, 0.125, 0.018); inner.rotation.z = -s * 0.25; head.add(inner);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), amber); eye.position.set(s * 0.06, 0.03, 0.125); head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), dark); pupil.position.set(s * 0.06, 0.03, 0.15); pupil.scale.set(0.6, 1.2, 0.5); head.add(pupil);
  }
  miel.legs = [];
  for (const [x, z] of [[-0.09, 0.17], [0.09, 0.17], [-0.09, -0.17], [0.09, -0.17]]) { const p = new THREE.Group(); p.position.set(x, 0.18, z); R0.add(p); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 6), cream); l.position.y = -0.085; p.add(l); const paw = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), white); paw.position.y = -0.17; paw.scale.y = 0.6; p.add(paw); miel.legs.push(p); }
  const tail = new THREE.Group(); tail.position.set(0, 0.3, -0.27); R0.add(tail); miel.tail = tail;
  const tc = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.3, 4, 6), fur); tc.position.y = 0.15; tail.add(tc); tail.rotation.x = -0.6;
  const sh = new THREE.Mesh(GEO.shadow, SHADOW_M); sh.scale.setScalar(0.6); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; R0.add(sh);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.3; R0.add(hit); miel.hit = hit;
}
function updateMiel(now, dt) {
  const M = miel, t = now / 1000;
  if (M.mode === 'sit') {
    if (now > M.until) M.mode = 'walk';
    M.body.position.y = lerp(M.body.position.y, 0.2, 0.1); M.body.rotation.x = lerp(M.body.rotation.x, -0.35, 0.1);
    for (const l of M.legs) l.rotation.x = lerp(l.rotation.x, 0, 0.2);
    M.tail.rotation.z = Math.sin(t * 1.5) * 0.4;
  } else {
    const [tx, tz] = M.path[M.i], dx = tx - M.x, dz = tz - M.z, d = Math.hypot(dx, dz);
    if (d < 0.05) {
      if (Math.random() < 0.35) { M.mode = 'sit'; M.until = now + 3000 + Math.random() * 7000; }
      if (Math.random() < 0.2) M.dir = -M.dir;
      if (M.i + M.dir < 0 || M.i + M.dir >= M.path.length) M.dir = -M.dir; // 길 끝에서 돌아섬
      M.i += M.dir;
    } else {
      const sp = Math.min(d, 0.55 * dt); M.x += dx / d * sp; M.z += dz / d * sp;
      const want = Math.atan2(dx, dz); let dr = ((want - M.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; M.rot += dr * Math.min(1, dt * 6);
    }
    M.body.position.y = lerp(M.body.position.y, 0.26, 0.1); M.body.rotation.x = lerp(M.body.rotation.x, 0, 0.1);
    M.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 9 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.5; });
    M.tail.rotation.z = Math.sin(t * 3) * 0.25;
  }
  M.head.rotation.y = Math.sin(t * 0.7) * 0.3;
  M.root.position.set(M.x, 0, M.z); M.root.rotation.y = M.rot;
  if (M.bubble) { const a = (now - M.bubbleAt) / 2200; if (a > 1) { M.root.remove(M.bubble); M.bubble = null; } else M.bubble.position.y = 0.95 + a * 0.2; }
}
function mielMeow() {
  const M = miel; if (M.bubble) M.root.remove(M.bubble);
  const sp = screenSprite(bubble('야옹'), TAG_K * 1.15, 6); sp.position.y = 0.95; M.root.add(sp); M.bubble = sp; M.bubbleAt = performance.now();
  M.mode = 'sit'; M.until = performance.now() + 2500; audio.play('meow');
}

/* ---------------- 카메라 (조금만 돌려 볼 수 있음) ---------------- */
const cam = { yaw: 0, yawT: 0, pitch: 0.5, pitchT: 0.5, dist: 10, target: new THREE.Vector3(0, 0.95, -0.55) };
function fitCamera() {
  const a = window.innerWidth / window.innerHeight;
  camera.aspect = a; camera.fov = a < 0.8 ? 50 : 42;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * a;
  const more = extraTables.length * 1.3; // 상을 더 폈으면 조금 물러남
  const wantW = (COURT ? (a < 0.8 ? 8.0 : 16.5) : a < 0.8 ? 8.6 : 13.5) + more; // 세로 화면도 마당·일거리 자리까지 보이게
  cam.dist = clamp(wantW / 2 / half, 9.5, 24);
  cam.pitchT = cam.pitch = COURT ? (a < 0.8 ? 0.62 : 0.42) : a < 0.8 ? 0.8 : 0.66;
  TAG_K = a < 0.8 ? 0.0003 : 0.00042; // 이름표는 화면 높이 기준 크기 → 세로 화면은 작게
  if (COURT) cam.target.set(0, a < 0.8 ? 0.9 : 1.3, (a < 0.8 ? 2.4 : 1.75) + more * 1.2); else cam.target.set(0, a < 0.8 ? 0.5 : 0.8, (a < 0.8 ? 0.55 : 0.2) + more * 1.2);
  camera.updateProjectionMatrix();
}
const TMPV = new THREE.Vector3();
function updateCamera(dt) {
  cam.yaw = lerp(cam.yaw, cam.yawT, Math.min(1, dt * 6)); cam.pitch = lerp(cam.pitch, cam.pitchT, Math.min(1, dt * 6));
  const t = performance.now() / 1000, sway = Math.sin(t * 0.15) * 0.02;
  // 첫 3초: 마당을 높이서 내려다보다가 천천히 대청마루로 다가감 (들어가기 누른 뒤). 들어가기 전에는 시작 자리에서 멈춤
  const ik = cam.introAt == null ? 0 : ease(clamp((performance.now() - cam.introAt) / 3000, 0, 1));
  const tg = TMPV.set(cam.target.x, lerp(0.2, cam.target.y, ik), lerp(cam.target.z + 2.6, cam.target.z, ik)), dist = lerp(cam.dist * 1.25, cam.dist, ik);
  const y = cam.yaw + sway, p = lerp(1.22, cam.pitch, ik);
  camera.position.set(tg.x + Math.sin(y) * Math.cos(p) * dist, tg.y + Math.sin(p) * dist, tg.z + Math.cos(y) * Math.cos(p) * dist);
  camera.lookAt(tg);
}

/* ---------------- 낮·밤 빛 ---------------- */
function applyLight() {
  const k = daylight(hourNow());
  hemi.intensity = 0.75 + 0.65 * k; hemi.color.set(k > 0.5 ? '#fff6e8' : '#ffe6c4');
  sunLight.intensity = 0.15 + 0.85 * k; sunLight.color.set(k > 0.5 ? '#fff0d6' : '#9fb0e0');
  fill.intensity = 0.3 + 0.2 * k;
  for (const m of lamps) m.emissiveIntensity = 0.25 + (1 - k) * 1.1;
  lampLight.intensity = tier === 0 ? (1 - k) * 2.2 : 0; lampLight.visible = tier === 0 && k < 0.95;
  document.body.dataset.sky = k > 0.6 ? 'day' : k > 0.05 ? 'dusk' : 'night';
  if (COURT) { hemi.groundColor.set(k > 0.5 ? '#8a9a6a' : '#2a2c40'); hemi.intensity = 0.4 + 0.95 * k; hemi.color.set(k > 0.5 ? '#fff6e8' : '#a8b4e0'); sunLight.intensity = 0.2 + 0.8 * k; drawCourtSky(); } else drawOutside(); // 밤: 푸른 달빛 + 따뜻한 창빛·등
}

/* ---------------- 함께 하는 손님 (서버) — 서버가 없으면 나 혼자 + 연출 캐릭터 ---------------- */
let mode = 'solo'; // 'solo' (서버 없음·끊김) · 'online' · 'watch' (꽉 차서 구경)
let me = null;
function startNet() {
  net = createNet(SERVER_URL, {
    online() { mode = 'online'; for (const k of [...chefs.keys()]) if (k !== 'me') removeChef(k); showTogether(); },
    offline() { mode = 'solo'; for (const k of [...chefs.keys()]) if (k !== 'me') removeChef(k); showTogether(); },
    full(total) { mode = 'watch'; showTogether(total); },
    count() { showTogether(); },
    peers(list, mySeat) { // list: [[서버 자리, 불릴 이름(서버가 거름), 일거리 번호], ...] — 일거리가 바뀐 손님은 그 자리로 옮김
      const want = new Map(); for (const [ss, nm, j, st] of list) if (ss !== mySeat) { const c = checkName(String(nm || '')); want.set('s' + ss, { st: st === 'f' || st === 'm' ? st : null, nm: c.ok ? c.text : '손님', j: JOBS[j | 0] ? j | 0 : 0, ss }); }
      for (const k of [...chefs.keys()]) if (k !== 'me' && (!want.has(k) || chefs.get(k).name !== want.get(k).nm || chefs.get(k).style !== want.get(k).st)) removeChef(k);
      for (const [k, w] of want) { const A = chefs.get(k); if (!A) makeChef(k, w.nm, false, w.ss + 2, w.j, w.st); else if (A.job !== w.j || !A.root.visible) placeChef(A, w.j); }
    },
    taps(list, mySeat) { for (const [ss, c] of list) { if (ss === mySeat) continue; const A = chefs.get('s' + ss); if (!A) continue; for (let i = 0; i < Math.min(c, 6); i++) setTimeout(() => act(A, performance.now()), Math.random() * 13000); } },
    greets(list, mySeat) { for (const [ss, g] of list) { if (ss === mySeat) continue; const A = chefs.get('s' + ss); if (A && g >= 0 && g <= 2) setTimeout(() => say(A, g), Math.random() * 2500); } },
  }, PLACE_KEY);
  if (net) net.connect(myName, me ? me.job : 0, myStyle);
}
function showTogether(total) {
  const el = $('together'), bw = $('bowls');
  const n = mode === 'online' && net ? net.total : mode === 'watch' ? total || (net && net.total) : 0; // 진짜 손님 수만 (연출 캐릭터는 안 셈)
  if (n > 0) { el.textContent = mode === 'watch' ? `지금 ${n.toLocaleString('ko-KR')}명이 함께 · 부엌이 꽉 차서 구경 중이에요` : `지금 ${n.toLocaleString('ko-KR')}명이 함께`; el.hidden = false; }
  else el.hidden = true; // 서버가 없으면 숫자 문구를 숨김
  const b = net && mode !== 'solo' ? net.bowls : null;
  if (typeof b === 'number') { bw.textContent = `오늘 이 부엌에서 지은 밥 ${b.toLocaleString('ko-KR')}그릇`; bw.hidden = false; } else bw.hidden = true;
}

/* ---------------- 위쪽 알림 (누가 인사했어요) ---------------- */
const noticeQ = []; let noticeBusy = false;
function notice(t) { if (noticeQ.length > 2) noticeQ.shift(); noticeQ.push(t); if (!noticeBusy) nextNotice(); }
function nextNotice() {
  const el = $('notice'), t = noticeQ.shift();
  if (!t) { noticeBusy = false; el.classList.remove('on'); return; }
  noticeBusy = true; el.textContent = t; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); setTimeout(nextNotice, 2600);
}

/* ---------------- 도장 수첩 (하루 한 번, 솥 한 바퀴를 함께하면 그 부엌 도장 1개 — 이 휴대폰에만 저장, 비교·순위 없음) ---------------- */
const STAMP_STAY = 90000; // 솥이 다 될 때까지 이 부엌에 1분 30초 넘게 있었으면 "함께했다"
let presentMs = 0;
function stampsLoad() { try { return JSON.parse(store.get('stamps', '{}')) || {}; } catch (e) { return {}; } }
function maybeStamp() {
  if (presentMs < STAMP_STAY) return;
  const st = stampsLoad(), cur = st[PLACE_KEY] || { n: 0, last: '' }; if (cur.last === kstDay()) return;
  cur.n = (cur.n | 0) + 1; cur.last = kstDay(); st[PLACE_KEY] = cur; store.set('stamps', JSON.stringify(st));
  setTimeout(() => { toast(`오늘의 ${P.label} 도장을 받았어요`); $('stampBtn').classList.add('on'); }, 6000);
}
function renderStamps() {
  const st = stampsLoad(), box0 = $('stampList'); box0.textContent = '';
  for (const k of PLACE_ORDER) {
    const pl = PLACES[k]; if (!pl) continue; const c = st[k] || { n: 0, last: '' };
    const d = document.createElement('div'); d.className = 'stamp' + (c.n > 0 ? ' got' : '');
    const ink = document.createElement('div'); ink.className = 'ink'; ink.textContent = pl.stamp || '🍚'; if (c.n > 0) ink.style.borderColor = pl.stampColor || '#b5452f'; d.appendChild(ink);
    const b = document.createElement('b'); b.textContent = pl.label; d.appendChild(b);
    const sp = document.createElement('span'); sp.textContent = c.n > 0 ? `도장 ${c.n}개 · ${c.last === kstDay() ? '오늘 받았어요' : '오늘은 아직'}` : '아직 없어요'; d.appendChild(sp);
    if (k !== PLACE_KEY) { const a = document.createElement('a'); a.href = '?place=' + k; a.textContent = '가 보기'; d.appendChild(a); }
    box0.appendChild(d);
  }
}

/* ---------------- 사진 (지금 화면을 이미지로 — 이름표 포함) ---------------- */
async function savePhoto() {
  closeSheets();
  renderer.render(scene, camera); // 같은 순간에 바로 옮겨 그려야 빈 그림이 안 됨
  const src = renderer.domElement, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'), sky = document.body.dataset.sky;
  const gr = g.createRadialGradient(c.width / 2, 0, 10, c.width / 2, c.height * 0.3, c.height);
  const cols = sky === 'night' ? ['#3a3550', '#16152a'] : sky === 'dusk' ? ['#fbe6d2', '#b9977a'] : ['#fffaf1', '#dcc6a6'];
  gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]); g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0);
  const fl = $('flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92)); if (!blob) { toast('사진을 만들지 못했어요'); return; }
  const fname = `bab-kitchen-${PLACE_KEY}-${kstDay()}.jpg`;
  try {
    const file = new File([blob], fname, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } // 아이폰: "이미지 저장"으로 사진첩에
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('사진을 저장했어요');
}

/* ---------------- 오늘의 한 그릇 카드 ---------------- */
let CARDS = [];
import(P.cards).then((m) => { CARDS = Array.isArray(m.CARDS) ? m.CARDS : []; }).catch(() => { CARDS = []; });
function todayCard() { return CARDS.length ? CARDS[kstDayIndex() % CARDS.length] : null; }
function showCard() {
  const c = todayCard(); if (!c) return;
  // 회장님 확정(11/15) "요리이름만": 화면에는 요리 이름만. line·tip·inBook 은 데이터에만 남기고 보여 주지 않는다 (레시피는 알려 주지 않음, 책 안내 줄도 꺼 둠)
  $('cardName').textContent = c.name || '';
  $('card').classList.add('on'); clearTimeout(showCard.t); showCard.t = setTimeout(hideCard, 25000);
}
function hideCard() { $('card').classList.remove('on'); }

/* ---------------- 솥(냄비) 한 바퀴: 요리 → "밥 됐어요~~~" → 상에 모이기 30초 → 다 같이 "잘 먹겠습니다" ---------------- */
let lastPhase = -1, calledCycle = -1, mealCycle = -1, prevJob = null;
const dining = () => me && me.job === 0 && me.seat != null; // 나는 지금 상에 있나
function updateCycle(now, dt) {
  const t = clock(), phase = phaseOf(t), cycle = Math.floor(t / PERIOD);
  const cooking = phase < CALL_AT, meal = phase >= MEAL_AT && phase < MEAL_END;
  // 뚜껑: 끓는 동안 들썩 · 재료가 들어가면 톡 튐 · 밥 되면 열림 · 다음 솥 전에 닫힘
  const hop = Math.max(0, 1 - (now - lidHop) / 260), boil = Math.min(1, phase / CALL_AT);
  if (!cooking) {
    const open = phase < PERIOD - 1500 ? ease(clamp((phase - CALL_AT) / 600, 0, 1)) : 1 - ease(clamp((phase - (PERIOD - 1500)) / 1200, 0, 1));
    potLid.position.set(open * 0.55, (POT_TOP - TABLE_TOP) + open * 0.35, 0); potLid.rotation.z = -open * 0.9; potFood.visible = open > 0.1;
  } else {
    potLid.position.set(0, (POT_TOP - TABLE_TOP) + hop * 0.06 + (boil > 0.85 ? Math.abs(Math.sin(now / 70)) * 0.02 : 0), 0); potLid.rotation.z = boil > 0.85 ? Math.sin(now / 90) * 0.03 : 0; potFood.visible = false;
  }
  updateSteam(now, dt, cooking ? 0.6 + boil * 3.2 : meal ? 4 : 6);
  // 상 차림: 밥 됐어요 ~ 바퀴 끝까지 모든 자리에 밥·국·반찬 · 도마는 요리할 때 앉은 자리만
  for (let i = 0; i < SEATS.length; i++) { settings[i].visible = !cooking; boards[i].visible = cooking && !!seatOcc[i]; }
  if (mainSetting) mainSetting.visible = !cooking;
  // 1) 밥 됐어요~~~ (주인 캐릭터가 부름 + 알림 + [밥 먹으러 가기])
  if (lastPhase >= 0 && lastPhase < CALL_AT && phase >= CALL_AT && phase < MEAL_AT && calledCycle !== cycle) {
    calledCycle = cycle; audio.play('pop'); audio.play('call', 0.25); puff(8);
    const owner = staff.find((a) => a.def.owner) || staff.find((a) => !a.def.outside) || staff[0]; if (owner) say(owner, P.callLine || '밥 됐어요~~~', true);
    notice(`${owner ? owner.def.role : '주인'}: "${P.callLine || '밥 됐어요~~~'}"`);
  }
  // 2) 다 같이 잘 먹겠습니다 (상에 앉은 사람 + 연출 캐릭터만)
  if (lastPhase >= 0 && lastPhase < MEAL_AT && phase >= MEAL_AT && phase < MEAL_END && mealCycle !== cycle) {
    mealCycle = cycle; maybeStamp();
    for (const A of chefs.values()) if (A.job === 0 && A.seat != null) say(A, '잘 먹겠습니다', true);
    for (const A of staff) if (A.dining) say(A, '잘 먹겠습니다', true);
    if (dining()) { audio.play('meal'); const b = $('banner'); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); setTimeout(showCard, 1500); }
  }
  // 화면 버튼: 모이는 동안 [밥 먹으러 가기] · 다 먹으면 [일거리로 돌아가기]
  const call = $('callBox'), back = $('backBox');
  const showCall = phase >= CALL_AT && phase < MEAL_AT && !dining();
  if (call.hidden === showCall) { call.hidden = !showCall; }
  if (showCall) $('callLeft').textContent = `${Math.ceil((MEAL_AT - phase) / 1000)}초 뒤에 다 같이 "잘 먹겠습니다"`;
  const BACK_MS = 30000; // 다 먹은 뒤 다음 솥 30초까지 [일거리로 돌아가기]
  const showBack = (phase >= MEAL_END || phase < BACK_MS) && prevJob != null && dining();
  if (back.hidden === showBack) back.hidden = !showBack;
  if (prevJob != null && phase >= BACK_MS && phase < CALL_AT) prevJob = null; // 안 누르면 상에 그대로 남음
  lastPhase = phase;
  audio.simmer(cooking ? P.sound.simmer * (0.35 + 0.65 * boil) : 0.2 * P.sound.simmer);
  return phase;
}
function goEat() { if (!me) return; if (me.job !== 0) { prevJob = me.job; setJob(0, true); } me.sitting = true; $('callBox').hidden = true; toast('상에 앉았어요. 곧 다 같이 "잘 먹겠습니다"'); }
function goBack() { if (prevJob == null) return; const j = prevJob; prevJob = null; setJob(j); $('backBox').hidden = true; }
function potText(phase) {
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  if (phase < CALL_AT) return `냄비가 끓고 있어요 · ${mmss(CALL_AT - phase)}`;
  if (phase < MEAL_AT) return `밥 됐어요! 상에 모이는 중 · ${mmss(MEAL_AT - phase)}`;
  if (phase < MEAL_END) return '다 같이 먹는 중';
  return `다음 솥 준비 중 · ${mmss(PERIOD - phase)}`;
}

/* ---------------- 창밖 소리 (가끔) ---------------- */
let nextOutdoor = performance.now() + 5000;
function updateOutdoor(now) {
  if (now < nextOutdoor) return; nextOutdoor = now + 7000 + Math.random() * 12000;
  const k = daylight(hourNow()), s = k > 0.4 ? P.sound.day : P.sound.night; if (s) audio.play(s);
}

/* ---------------- 밥상 한마디 (이름 없이 나누기 · 토닥 · 한 줄 답 · 신고 · 내가 내리기) ---------------- */
const jsonStore = (k, d) => { try { return JSON.parse(store.get(k, '')) || d; } catch (e) { return d; } };
const notes = { list: [], todak: new Set(jsonStore('todak', [])), hide: new Set(jsonStore('rep', [])), hideR: new Set(jsonStore('repR', [])), mine: jsonStore('mine', {}) }; // mine: 내가 올린 글 번호 → 내리기 열쇠 (이 기기에만)
function writesToday() { const v = store.get('wday', ''); return v.startsWith(kstDay() + ':') ? parseInt(v.split(':')[1], 10) || 0 : 0; }
async function loadNotes() {
  if (!net) return;
  try { const j = await net.notes(); notes.list = Array.isArray(j && j.notes) ? j.notes : []; } catch (e) { /* 다음에 다시 */ }
  showPapers(Math.min(12, notes.list.filter((n) => !notes.hide.has(n.id)).length)); renderNotes();
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }; // 손님 글은 늘 글자로만 (HTML 아님)
function renderNotes() {
  const ul = $('noteList'); ul.textContent = '';
  const list = notes.list.filter((n) => !notes.hide.has(n.id));
  $('noteEmpty').hidden = list.length > 0; $('noteOff').hidden = !!net; $('noteWriteBtn').disabled = !net;
  for (const n of list) {
    const li = el('li'); li.style.background = PAPER_COLORS[n.id % PAPER_COLORS.length];
    li.appendChild(el('p', null, n.text)); li.appendChild(el('span', 'who', n.name ? n.name : '이름 없이'));
    const reps = el('div', 'replies');
    for (const r of n.replies || []) {
      if (notes.hideR.has(r.id)) continue;
      const d = el('div', 'reply'); d.appendChild(el('span', null, '↳ ' + r.text));
      const rr = el('button', 'report', '신고'); rr.onclick = async () => { if (!confirm('이 답을 신고할까요? 신고가 모이면 내려가요.')) return; notes.hideR.add(r.id); store.set('repR', JSON.stringify([...notes.hideR].slice(-300))); renderNotes(); try { await net.reportReply(r.id, devId); } catch (e) { /* 이 기기에서는 숨김 */ } };
      d.appendChild(rr); reps.appendChild(d);
    }
    li.appendChild(reps);
    const row = el('div', 'row');
    const did = notes.todak.has(n.id), td = el('button', 'todak' + (did ? ' did' : ''), `토닥 ${n.todak | 0}`);
    td.onclick = async () => {
      if (notes.todak.has(n.id)) return; notes.todak.add(n.id); store.set('todak', JSON.stringify([...notes.todak].slice(-300)));
      n.todak = (n.todak | 0) + 1; td.textContent = `토닥 ${n.todak}`; td.classList.add('did');
      try { const j = await net.todak(n.id, devId); if (j && typeof j.todak === 'number') { n.todak = j.todak; td.textContent = `토닥 ${n.todak}`; } } catch (e) { /* 다시 보내지 않음 */ }
    };
    const rb = el('button', 'replyBtn', '한 줄 답하기'); rb.onclick = () => openReply(li, n);
    row.appendChild(td); row.appendChild(rb);
    if (notes.mine[n.id]) { const del = el('button', 'report', '내리기'); del.onclick = async () => { if (!confirm('내가 올린 이 한마디를 내릴까요?')) return; try { await net.deleteNote(n.id, notes.mine[n.id]); delete notes.mine[n.id]; store.set('mine', JSON.stringify(notes.mine)); notes.list = notes.list.filter((x) => x.id !== n.id); renderNotes(); toast('한마디를 내렸어요'); } catch (e) { toast(NOTE_WHY.fail); } }; row.appendChild(del); }
    else { const rp = el('button', 'report', '신고'); rp.onclick = async () => { if (!confirm('이 한마디를 신고할까요? 신고가 모이면 내려가요.')) return; notes.hide.add(n.id); store.set('rep', JSON.stringify([...notes.hide].slice(-300))); renderNotes(); try { await net.report(n.id, devId); } catch (e) { /* 이 기기에서는 숨김 */ } toast('신고했어요. 이 기기에서는 바로 숨겼어요.'); }; row.appendChild(rp); }
    li.appendChild(row); ul.appendChild(li);
  }
}
function openReply(li, n) { // 한 줄 답 (50자, 같은 거르기)
  if (!net || li.querySelector('.replyBox')) return;
  const box = el('div', 'replyBox'), inp = el('input'); inp.maxLength = REPLY_MAX + 5; inp.placeholder = `한 줄로 답해 주세요 (${REPLY_MAX}자)`;
  const send = el('button', null, '보내기'), msg = el('div', 'replyMsg');
  send.onclick = async () => {
    const c = checkNote(inp.value, REPLY_MAX); if (!c.ok) { msg.textContent = NOTE_WHY[c.why]; return; }
    send.disabled = true;
    try { const j = await net.reply(n.id, c.text, devId); (n.replies = n.replies || []).push(j.reply); renderNotes(); } catch (e) { msg.textContent = NOTE_WHY[e.why] || NOTE_WHY.fail; send.disabled = false; }
  };
  box.appendChild(inp); box.appendChild(send); box.appendChild(msg); li.appendChild(box); inp.focus();
}
function openNotes() { closeSheets(); showGreets(false); $('notes').classList.add('on'); renderNotes(); loadNotes(); }
function openWrite() {
  closeSheets(); $('write').classList.add('on');
  $('writeName').textContent = myName;
  const off = !net; $('writeText').disabled = off; $('writeSend').disabled = off;
  $('writeMsg').textContent = off ? '지금은 연습 부엌이라 아직 남길 수 없어요. 부엌 문을 열면 남길 수 있어요.' : writesToday() >= NOTE_DAY_LIMIT ? NOTE_WHY.limit : '';
  updateCount(); anonChanged();
}
function anonChanged() { $('writeNameRow').hidden = $('writeAnon').checked; }
function updateCount() { $('writeCount').textContent = `${[...$('writeText').value].length} / ${NOTE_MAX}`; }
async function sendNote() {
  if (!net) return;
  if (writesToday() >= NOTE_DAY_LIMIT) { $('writeMsg').textContent = NOTE_WHY.limit; return; }
  const c = checkNote($('writeText').value); if (!c.ok) { $('writeMsg').textContent = NOTE_WHY[c.why]; return; }
  $('writeSend').disabled = true; $('writeMsg').textContent = '나누는 중…';
  try {
    const j = await net.postNote(c.text, $('writeAnon').checked ? null : myName, devId);
    store.set('wday', kstDay() + ':' + (writesToday() + 1));
    if (j && j.note) { notes.list.unshift(j.note); if (j.key) { notes.mine[j.note.id] = j.key; store.set('mine', JSON.stringify(notes.mine)); } }
    $('writeText').value = ''; closeSheets(); toast('한마디를 나눴어요'); showPapers(Math.min(12, notes.list.length));
  } catch (e) { $('writeMsg').textContent = NOTE_WHY[e.why] || NOTE_WHY.fail; }
  $('writeSend').disabled = false;
}

/* ---------------- 입장 화면 (이름만 적고 들어와 · 밥 한 끼 하고 가는 곳) ---------------- */
function bindEnter() {
  const inp = $('enterName'); inp.value = myName; inp.maxLength = 14;
  const pl = P.plate || {}; $('enterPlate').textContent = pl.title || 'SOLL KITCHEN · 쏠키친'; if (pl.sub) { const sm = el('small', null, pl.sub); $('enterPlate').appendChild(sm); }
  $('enterDice').onclick = () => { let n; do { n = randomName(); } while (n === inp.value && NAMES.length > 1); inp.value = n; $('enterMsg').textContent = ''; };
  const go = () => {
    const c = checkName(inp.value); if (!c.ok) { $('enterMsg').textContent = NOTE_WHY[c.why]; return; }
    myName = c.text; store.set('myname', myName); audio.unlock();
    $('enter').classList.add('gone'); setTimeout(() => { $('enter').hidden = true; }, 500);
    const saved = parseInt(store.get('job.' + PLACE_KEY, '0'), 10);
    me = makeChef('me', myName, true, 1, JOBS[saved] ? saved : 0, myStyle); cam.introAt = performance.now();
    $('myName').textContent = myName; showJobBtn(); document.body.classList.add('in');
    startNet(); if (net) loadNotes(); else renderNotes();
  };
  const showStyle = () => document.querySelectorAll('#enterStyle button').forEach((b) => b.classList.toggle('sel', b.dataset.s === myStyle));
  $('enterStyle').hidden = !(P.guest && P.guest.outfit === 'hanbok'); // 한옥에서만 [쪽]/[갓]
  document.querySelectorAll('#enterStyle button').forEach((b) => { b.onclick = () => { myStyle = b.dataset.s; store.set('style', myStyle); showStyle(); }; }); showStyle();
  $('enterGo').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

/* ---------------- 저녁 짓는 시간 (매일 한국 시간 저녁 7시, live.js) ---------------- */
const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
function kstMinutes() { const d = new Date(Date.now() + 9 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60; }
const LIVE_FORCE = Q.get('live') === '1';
let liveOn = false, liveStart = 0;
function updateLive() {
  const m = kstMinutes(), s0 = hm(LIVE.start), on = LIVE_FORCE || (m >= s0 && m < s0 + LIVE.minutes);
  if (on !== liveOn) { liveOn = on; liveStart = performance.now(); $('liveBox').hidden = !on; if (on) { $('liveTitle').textContent = LIVE.title; notice('다 같이 저녁 짓는 시간이에요'); } }
  if (on) { const k = Math.floor((performance.now() - liveStart) / (LIVE.lineSeconds * 1000)) % Math.max(1, LIVE.lines.length), t = LIVE.lines[k] || ''; const ln = $('liveLine'); if (ln.textContent !== t) { ln.textContent = t; ln.classList.remove('in'); void ln.offsetWidth; ln.classList.add('in'); } }
  const IL = LIVE.instaLive, showInsta = IL && (IL.dates || []).includes(kstDay()) && m >= s0 && m < hm(IL.until) || (LIVE_FORCE && Q.get('insta') === '1');
  const ib = $('instaLive'); if (ib.hidden === !!showInsta) { ib.hidden = !showInsta; ib.textContent = IL.label; ib.href = IL.url; }
}

function closeSheets() { for (const id of ['notes', 'write', 'stampSheet', 'moreSheet', 'jobSheet']) $(id).classList.remove('on'); }

/* ---------------- 화면 버튼 (인사 · 도마 톡 · 앉기 · 한마디 · 도장 · 더 보기) ---------------- */
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2400); }
function showFatal(t) { const el = $('fatal'); if (el) { el.textContent = t; el.hidden = false; } }
let lastTok = 0, lastGreet = 0;
function myTok() { // 톡: 지금 일거리 자리의 동작·소리 한 번
  const now = performance.now(); if (now - lastTok < 240) return; lastTok = now; if (!me) return;
  if (me.job === 0 && phaseOf(clock()) >= CALL_AT) { if (phaseOf(clock()) >= MEAL_AT) audio.play('clink'); return; } // 밥 먹는 동안 식탁에서는 칼질 대신 숟가락 소리
  act(me, now); if (net && net.online) net.tap();
}
function setJob(j, quiet) { // 일거리 자리로 바로 옮김
  if (!me || !JOBS[j]) return;
  placeChef(me, j); store.set('job.' + PLACE_KEY, String(j));
  if (net && net.online) net.job(j);
  showJobBtn(); closeSheets();
  if (!quiet) toast(j === 0 ? '식탁 자리로 왔어요. 화면을 톡 눌러 보세요' : `${JOBS[j].name.replace(/ \(.*\)$/, '')} 자리로 왔어요. 화면을 톡 눌러 보세요`);
}
function showJobBtn() {
  const j = JOBS[me ? me.job : 0] || JOBS[0];
  $('tokBtn').innerHTML = ''; const i = document.createElement('i'); i.textContent = j.icon || '🔪'; $('tokBtn').appendChild(i); $('tokBtn').appendChild(document.createTextNode(j.tap || '톡'));
  $('sitBtn').hidden = COURT || !(me && me.job === 0); // 한옥 상은 늘 좌식이라 앉기 버튼 없음
}
function renderJobs() { // 일거리 목록 (자리마다 사람 수)
  const ul = $('jobList'), c = jobCounts(); ul.textContent = '';
  JOBS.forEach((j, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'job' + (me && me.job === i ? ' here' : '');
    const ic = document.createElement('i'); ic.textContent = j.icon || '🔪'; b.appendChild(ic);
    const tx = document.createElement('span'); tx.textContent = j.name; b.appendChild(tx);
    const n = document.createElement('small'); n.textContent = (me && me.job === i ? '지금 여기 · ' : '') + `${j.who} 사람 ${c[i]}`; b.appendChild(n);
    b.onclick = () => setJob(i); ul.appendChild(b);
  });
}
function myGreet(g) {
  const now = performance.now(); if (now - lastGreet < 2500 || !me) return; lastGreet = now;
  say(me, g); audio.play('greet'); if (net && net.online) net.greet(g);
  showGreets(false);
  document.querySelectorAll('#greetPop button,#greetBtn').forEach((b) => { b.disabled = true; }); setTimeout(() => document.querySelectorAll('#greetPop button,#greetBtn').forEach((b) => { b.disabled = false; }), 2500);
}
function showGreets(on) { $('greetPop').hidden = !on; $('greetBtn').classList.toggle('on', on); $('greetBtn').setAttribute('aria-expanded', on ? 'true' : 'false'); }
function toggleSit() { if (!me || me.job !== 0) return; me.sitting = !me.sitting; $('sitBtn').querySelector('span').textContent = me.sitting ? '일어나기' : '앉기'; $('sitBtn').classList.toggle('on', me.sitting); }
function showSound() {
  const b = $('soundBtn'); b.textContent = audio.on ? '소리 켜짐' : '소리 꺼짐'; b.setAttribute('aria-pressed', audio.on ? 'true' : 'false'); b.classList.toggle('off', !audio.on);
  $('soundBtn2').textContent = audio.on ? '🔊 소리 끄기' : '🔈 소리 켜기';
}
function toggleSound() { audio.unlock(); audio.set(!audio.on); showSound(); }
function openSheet(id) { closeSheets(); showGreets(false); $(id).classList.add('on'); }
function bindUi() {
  audio.init(); showSound();
  document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  $('soundBtn').onclick = toggleSound; $('soundBtn2').onclick = toggleSound;
  $('tokBtn').onclick = myTok;
  document.querySelectorAll('#greetPop button').forEach((b) => { b.textContent = GREETS[+b.dataset.g]; b.onclick = () => myGreet(+b.dataset.g); });
  $('greetBtn').onclick = () => showGreets($('greetPop').hidden);
  $('sitBtn').onclick = toggleSit;
  $('jobBtn').onclick = () => { renderJobs(); openSheet('jobSheet'); };
  $('callGo').onclick = goEat; $('backGo').onclick = goBack;
  $('noteBtn').onclick = openNotes;
  $('stampBtn').onclick = () => { $('stampBtn').classList.remove('on'); renderStamps(); openSheet('stampSheet'); };
  $('moreBtn').onclick = () => openSheet('moreSheet');
  $('photoBtn').onclick = savePhoto;
  $('cardEat').onclick = () => { myGreet(2); hideCard(); };
  $('cardNote').onclick = () => { hideCard(); openWrite(); };
  $('noteWriteBtn').onclick = openWrite;
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closeSheets; });
  $('writeText').maxLength = NOTE_MAX + 10; $('writeText').oninput = updateCount; $('writeAnon').onchange = anonChanged;
  $('writeSend').onclick = sendNote;
  $('myName').textContent = myName;
  { const pl = P.plate || {}, el = $('plate'); el.dataset.style = pl.style || 'wood'; // 장소별 문패 (글자는 places.js, 모양은 디자인 시안 뒤 CSS 로)
    el.textContent = pl.title || 'SOLL KITCHEN · 쏠키친'; if (pl.sub) { const sm = document.createElement('small'); sm.textContent = pl.sub; el.appendChild(sm); }
    el.setAttribute('aria-label', (pl.title || '') + ' ' + (pl.sub || '') + ' 인스타그램'); }
  showJobBtn();
  const pl = $('placeLinks'); for (const k of PLACE_ORDER) { const p0 = PLACES[k]; if (!p0) continue; const a = document.createElement('a'); a.href = '?place=' + k; a.textContent = (p0.stamp || '') + ' ' + p0.label; if (k === PLACE_KEY) a.className = 'here'; pl.appendChild(a); }
  placeChip();
}

/* ---------------- 누르기 (돌려 보기 · 도마 · 미엘 · 한마디 판) ---------------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function bindPointer() {
  const el = renderer.domElement; let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: cam.yawT, pitch: cam.pitchT, moved: false }; });
  el.addEventListener('pointermove', (e) => {
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 8) down.moved = true;
    if (down.moved) { cam.yawT = clamp(down.yaw - dx * 0.004, -0.55, 0.55); cam.pitchT = clamp(down.pitch + dy * 0.003, 0.3, 0.95); }
  });
  const up = (e) => { if (!down) return; const d = down; down = null; if (d.moved) return; tap(e.clientX, e.clientY); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { down = null; });
}
function tap(px, py) {
  ndc.set(px / window.innerWidth * 2 - 1, -(py / window.innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([miel.hit, boardMesh], false)[0];
  if (hit && hit.object === miel.hit) mielMeow(); else if (hit && hit.object === boardMesh) openNotes(); else myTok(); // 그 밖 어디든 톡 = 내 일거리 동작
}

/* ---------------- 빛·화질 저절로 조절 ---------------- */
const perf = { acc: 0, n: 0, since: 0 };
function watchPerf(dtMs, now) {
  if (now < 2500) return; perf.acc += dtMs; perf.n++;
  if (now - perf.since < 2500) return;
  const avg = perf.acc / Math.max(1, perf.n); perf.acc = 0; perf.n = 0; perf.since = now;
  if (avg > 26 && tier < 2) { tier++; renderer.setPixelRatio(QUALITY[tier]); renderer.setSize(window.innerWidth, window.innerHeight); applyLight(); }
}

/* ---------------- 움직이지 않는 물체 합치기 (아이폰 그리기 횟수 줄이기) ----------------
   room 바로 아래의 보통 물체 중 같은 재질끼리 한 덩어리로. 도마·불·여러 개 그리기(인스턴스)·투명 물체는 그대로 */
function mergeStatic() {
  const skip = new Set([...boards, ...fireMeshes]), byMat = new Map();
  room.updateMatrixWorld(true);
  for (const o of [...room.children]) {
    if (!o.isMesh || o.isInstancedMesh || skip.has(o) || Array.isArray(o.material) || o.material.transparent || !o.visible) continue;
    const g = o.geometry; if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv) continue;
    if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(o);
  }
  let merged = 0;
  for (const [m, list] of byMat) {
    if (list.length < 2) continue;
    const parts = list.map((o) => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(o.matrixWorld); return g; });
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let k = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3); uv.set(g.attributes.uv.array, k * 2); k += g.attributes.position.count; g.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    for (const o of list) room.remove(o);
    room.add(new THREE.Mesh(geo, m)); merged += list.length;
  }
  return merged;
}

/* ---------------- 시작 ---------------- */
function build() {
  if (COURT) buildCourtyard(); else { buildRoom(); buildWindows(); buildCounter(); buildTable(); buildLamps(); }
  buildPot(); buildBoards(); buildNoteBoard();
  for (const p of P.props) if (PROPS[p]) PROPS[p]();
  buildMiel();
  buildStaff();
  for (const j of JOBS) if (j.prop && JOB_PROPS[j.prop.kind]) JOB_PROPS[j.prop.kind](j.prop);
  mergeStatic();
}
let prev = performance.now(), firstFrame = true;
function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) { prev = performance.now(); return; }
  const now = performance.now(), dtMs = Math.min(100, now - prev), dt = dtMs / 1000; prev = now;
  const phase = updateCycle(now, dt);
  for (const A of chefs.values()) updateChef(A, now, phase);
  updateStaff(now, phase, dt); updateFlights(now); updateBits(now, dt); presentMs += dtMs; updateMiel(now, dt); updateCamera(dt); updateOutdoor(now);
  const fb = now < fireBoost ? (fireBoost - now) / 900 : 0; // 불 지피기 톡 → 불이 확
  for (const m of fireMats) { m.opacity = Math.min(1, 0.65 + Math.sin(now / 90) * 0.12 + Math.sin(now / 37) * 0.06 + fb * 0.3); }
  for (const f of fireMeshes) f.scale.setScalar(1 + fb * 0.6 + Math.sin(now / 70) * 0.05);
  renderer.render(scene, camera);
  watchPerf(dtMs, now);
  if (firstFrame) { firstFrame = false; document.body.classList.add('ready'); window.__babReadyAt = performance.now(); }
}
let uiTimer = 0;
let uiN = 0;
function uiTick() { if (!me) return; const ph = phaseOf(clock()); $('potPill').textContent = potText(ph); if (++uiN % 20 === 0) placeChip(); }
window.addEventListener('resize', () => { fitCamera(); renderer.setSize(window.innerWidth, window.innerHeight); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) applyLight(); });

try {
  fitCamera(); build(); bindUi(); bindPointer(); applyLight(); updateCamera(1);
  frame(); uiTick(); uiTimer = setInterval(uiTick, 500); setInterval(applyLight, 60000);
  bindEnter(); renderNotes(); updateLive(); setInterval(updateLive, 1000);
  loadWeather(); setInterval(loadWeather, 30 * 60000);
  window.__bab = { place: PLACE_KEY, mode: () => mode, phase: () => phaseOf(clock()), tier: () => tier, chefs: () => chefs.size, staff: () => staff.length, job: () => me && me.job, setJob, act: () => myTok(), counts: jobCounts, stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }) };
} catch (e) { console.error(e); showFatal('부엌을 여는 중에 문제가 생겼어요. 새로고침해 주세요.'); }
void uiTimer;
