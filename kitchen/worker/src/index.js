/* 밥 짓는 집 — 실시간 서버 (Cloudflare Worker + Durable Object)
   - Lobby (하나): 방 배정(50명씩), 전체 사람 수, 하루 요청 수 → 넘치면 "구경 모드"
   - Room (방마다 하나): 웹소켓. 15초마다 묶음 한 번 보냄 (사람 수 · 자리 목록 · 톡 횟수 · 인사). 잠자기(hibernation) 방식이라 조용할 때 비용 거의 없음
   - Board (하나): 밥상 한마디 저장 (SQLite). 거르기 규칙은 화면과 같은 notes-rules.js
   받는 것: 불릴 이름(10자, 거름) · 일거리 자리 번호 · 톡 횟수 · 인사 번호 · 한마디(100자)·한 줄 답(50자). 연락처는 받지 않는다 (걸러서 막음).
   기기 번호와 IP 는 그대로 저장하지 않고, 날마다 바뀌는 소금을 섞은 해시로만 "하루 3개" 확인에 쓴다. */
import { DurableObject } from 'cloudflare:workers';
import { checkNote, checkName, NOTE_DAY_LIMIT, REPORT_HIDE, REPLY_MAX, REPLY_DAY_LIMIT, NOTE_DAYS } from '../../notes-rules.js';

const TICK_MS = 15000;
const PERIOD = 180000, MEAL_AT = 150000; // 솥 한 바퀴 · 다 같이 먹는 때 (화면 kitchen.js 와 같게)
const JOB_MAX = 12; // 일거리 자리 번호 최대
const PLACES = ['hanok', 'tuscany', 'paris']; // 장소마다 방·사람 수·밥 그릇 수를 따로 셈 (places.js PLACE_ORDER 와 같게)
const kstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function cors(env, req) {
  const o = req.headers.get('Origin') || '';
  const allow = env.ALLOWED_ORIGIN || '';
  return { 'Access-Control-Allow-Origin': allow || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin', ...(allow && o && o !== allow ? { 'x-blocked': '1' } : {}) };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(h || {}) } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    const origin = req.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ why: 'origin' }, 403, h);
    const place = PLACES.includes(url.searchParams.get('p')) ? url.searchParams.get('p') : PLACES[0];
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby-' + place));
    const meter = env.LOBBY.get(env.LOBBY.idFromName('lobby-' + PLACES[0])); // 하루 한도는 한 곳(첫 장소 로비)에서 모두 합쳐 셈

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const ok = await (await meter.fetch('https://lobby/hit')).json();
      const a = ok.ok ? await (await lobby.fetch('https://lobby/assign')).json() : { full: true, total: 0 };
      if (a.full) { // 꽉 참 → 소켓은 열되 "full" 한 번 보내고 닫음 (화면은 구경 모드 + 사람 수)
        const pair = new WebSocketPair(); pair[1].accept(); pair[1].send(JSON.stringify({ t: 'full', total: a.total, bowls: a.bowls })); pair[1].close(1000, 'full');
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      const room = env.ROOM.get(env.ROOM.idFromName('room-' + place + '-' + a.room));
      const fwd = new URL(req.url); fwd.searchParams.set('room', String(a.room)); fwd.searchParams.set('p', place);
      return room.fetch(new Request(fwd.toString(), req));
    }
    if (url.pathname === '/count') return json(await (await lobby.fetch('https://lobby/count')).json(), 200, h);

    if (url.pathname === '/notes' || url.pathname.startsWith('/notes/') || url.pathname.startsWith('/replies/')) {
      const ok = await (await meter.fetch('https://lobby/hit')).json(); // 한마디 요청도 하루 한도에 셈
      if (!ok.ok) return json({ why: 'closed' }, 503, h);
      const board = env.BOARD.get(env.BOARD.idFromName('board'));
      const ip = req.headers.get('CF-Connecting-IP') || '';
      const r = await board.fetch(new Request('https://board' + url.pathname, { method: req.method, headers: { 'content-type': 'application/json', 'x-ip': ip }, body: req.method === 'POST' ? await req.text() : undefined }));
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', ...h } });
    }
    return json({ ok: true, name: 'bab-kitchen' }, 200, h);
  },
};

/* ---------- Lobby: 방 배정 · 전체 수 · 하루 한도 ---------- */
export class Lobby extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.rooms = new Map(); this.day = null; this.hits = 0; this.bowls = 0; this.loaded = false; }
  async load() { if (this.loaded) return; this.loaded = true; const d = await this.ctx.storage.get('day'); if (d && d.day === kstDay()) { this.day = d.day; this.hits = d.hits | 0; this.bowls = d.bowls | 0; } else { this.day = kstDay(); this.hits = 0; this.bowls = 0; } }
  newDay() { const today = kstDay(); if (this.day !== today) { this.day = today; this.hits = 0; this.bowls = 0; } }
  async hit(n = 1) {
    await this.load(); this.newDay();
    this.hits += n; if (this.hits % 50 < n) await this.ctx.storage.put('day', { day: this.day, hits: this.hits, bowls: this.bowls }); // 저장은 50번에 한 번
    return this.hits <= num(this.env.DAILY_LIMIT, 60000);
  }
  total() { const now = Date.now(); let t = 0; for (const [id, r] of this.rooms) { if (now - r.at > 45000) { this.rooms.delete(id); continue; } t += r.n; } return t; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/assign') {
      await this.load(); this.newDay();
      const total = this.total(), size = num(this.env.ROOM_SIZE, 50);
      if (total >= num(this.env.MAX_TOTAL, 3000)) return json({ full: true, total, bowls: this.bowls });
      let pick = null; for (const [id, r] of this.rooms) if (r.n < size && (pick == null || r.n > this.rooms.get(pick).n)) pick = id; // 가장 많이 찬 빈자리 방부터 (같이 있는 느낌)
      if (pick == null) { pick = 1; while (this.rooms.has(pick)) pick++; this.rooms.set(pick, { n: 0, at: Date.now() }); }
      const r = this.rooms.get(pick); r.n++; r.at = Date.now();
      return json({ room: pick, total: total + 1, bowls: this.bowls });
    }
    if (url.pathname === '/report') { // 방이 15초마다 알려 줌: 사람 수 · 받은 메시지 수 · (솥이 다 됐으면) 그때 있던 사람 수
      const b = await req.json(); const room = num(b.room, 0); if (room > 0) { if (b.n > 0) this.rooms.set(room, { n: b.n | 0, at: Date.now() }); else this.rooms.delete(room); }
      await this.load(); this.newDay();
      const served = Math.max(0, Math.min(num(this.env.ROOM_SIZE, 50), b.served | 0)); // 오늘 지은 밥 = 솥 한 바퀴 때 있던 사람 수만큼 더함
      if (served) { this.bowls += served; await this.ctx.storage.put('day', { day: this.day, hits: this.hits, bowls: this.bowls }); }
      await this.hit(1 + Math.ceil((b.msgs | 0) / 20)); // 웹소켓 메시지는 20개를 요청 1번으로 셈 (Cloudflare 요금 방식)
      return json({ total: this.total(), bowls: this.bowls });
    }
    if (url.pathname === '/hit') return json({ ok: await this.hit(1) });
    if (url.pathname === '/count') { await this.load(); this.newDay(); return json({ total: this.total(), bowls: this.bowls }); }
    return json({}, 404);
  }
}

/* ---------- Room: 부엌 한 칸 (50명) ---------- */
export class Room extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.batch = { taps: new Map(), greets: [] }; this.msgs = 0; this.dirty = true; this.total = 0; this.bowls = 0; this.roomId = 0; this.place = ''; this.tickN = 0; this.lastCycle = Math.floor((Date.now() - MEAL_AT) / PERIOD); }
  peers() { const out = []; for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a) out.push([a.seat, a.n, a.j | 0]); } return out; }
  async fetch(req) {
    const url = new URL(req.url);
    this.roomId = num(url.searchParams.get('room'), this.roomId) || this.roomId;
    const p = url.searchParams.get('p'); if (PLACES.includes(p)) this.place = p;
    if (this.roomId && this.place) await this.ctx.storage.put('room', { id: this.roomId, place: this.place }); else await this.restore();
    const socks = this.ctx.getWebSockets(), size = num(this.env.ROOM_SIZE, 50);
    const pair = new WebSocketPair(), [client, server] = [pair[0], pair[1]];
    if (socks.length >= size) { server.accept(); server.send(JSON.stringify({ t: 'full', total: this.total })); server.close(1000, 'full'); return new Response(null, { status: 101, webSocket: client }); }
    const used = new Set(socks.map((w) => (w.deserializeAttachment() || {}).seat)); let seat = 0; while (used.has(seat)) seat++;
    const nc = checkName(url.searchParams.get('nm') || ''); const n = nc.ok ? nc.text : '손님'; // 이 안에서 불릴 이름 (10자, 거른 뒤). 안 맞으면 '손님'
    const j = Math.max(0, Math.min(JOB_MAX, num(url.searchParams.get('j'), 0)));
    this.ctx.acceptWebSocket(server); server.serializeAttachment({ seat, n, j, last: 0, jAt: 0 });
    this.dirty = true;
    server.send(JSON.stringify({ t: 'hello', seat, now: Date.now(), n: socks.length + 1, total: Math.max(this.total, socks.length + 1), bowls: this.bowls, peers: this.peers() }));
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    this.msgs++;
    if (typeof msg !== 'string' || msg.length > 100) return;
    const a = ws.deserializeAttachment(); if (!a) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    const now = Date.now();
    if (m.j != null && now - (a.jAt || 0) > 800) { a.j = Math.max(0, Math.min(JOB_MAX, num(m.j, 0))); a.jAt = now; ws.serializeAttachment(a); this.dirty = true; } // 일거리 자리 바꿈 (다음 묶음에 자리 목록으로 알림)
    if (m.k == null && m.g == null) return;
    if (now - (a.last || 0) < 2500) return; // 너무 잦은 신호는 버림
    a.last = now; ws.serializeAttachment(a);
    const k = Math.max(0, Math.min(40, num(m.k, 0))); if (k) this.batch.taps.set(a.seat, (this.batch.taps.get(a.seat) || 0) + k);
    const g = num(m.g, -1); if (g >= 0 && g <= 2 && this.batch.greets.length < 60) this.batch.greets.push([a.seat, g]);
  }
  async restore() { const r = await this.ctx.storage.get('room'); if (r && typeof r === 'object') { this.roomId = this.roomId || r.id | 0; this.place = this.place || r.place || ''; } }
  async webSocketClose(ws) { this.dirty = true; try { ws.close(); } catch (e) { /* 이미 닫힘 */ } }
  async webSocketError(ws) { this.dirty = true; try { ws.close(); } catch (e) { /* 이미 닫힘 */ } }
  async alarm() {
    const socks = this.ctx.getWebSockets();
    if (!this.roomId || !this.place) await this.restore();
    const cyc = Math.floor((Date.now() - MEAL_AT) / PERIOD), served = cyc > this.lastCycle ? socks.length : 0; this.lastCycle = cyc; // 지난 15초 사이에 솥이 다 됐으면 지금 있는 사람 수
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby-' + (this.place || PLACES[0])));
    try { const r = await lobby.fetch('https://lobby/report', { method: 'POST', body: JSON.stringify({ room: this.roomId, n: socks.length, msgs: this.msgs, served }) }); const j = await r.json(); this.total = j.total | 0; this.bowls = j.bowls | 0; } catch (e) { /* 다음 번에 */ }
    this.msgs = 0;
    if (!socks.length) return; // 아무도 없으면 알람을 멈춤 (잠자기)
    this.tickN++;
    const out = { t: 'tick', now: Date.now(), n: socks.length, total: Math.max(this.total, socks.length), bowls: this.bowls };
    if (this.dirty || this.tickN % 4 === 0) { out.peers = this.peers(); this.dirty = false; }
    if (this.batch.taps.size) out.taps = [...this.batch.taps];
    if (this.batch.greets.length) out.greets = this.batch.greets;
    this.batch = { taps: new Map(), greets: [] };
    const s = JSON.stringify(out);
    for (const ws of socks) { try { ws.send(s); } catch (e) { /* 끊긴 소켓 */ } }
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }
}

/* ---------- Board: 밥상 한마디 (이름 없이 나누기 · 60일 · 한 줄 답 · 토닥 · 신고 · 내가 내리기) ---------- */
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join(''); }
const DAY_MS = 86400e3;
export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // name: 이름 없이 나누기면 NULL · dk/ik: 그날만 쓰는 해시 (하루 개수 확인용, 다음 날 지움) · kh: 내리기 열쇠의 해시
    this.sql.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, day TEXT, text TEXT, name TEXT, dk TEXT, ik TEXT, kh TEXT, todak INTEGER DEFAULT 0, reports INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY AUTOINCREMENT, note INTEGER, at INTEGER, day TEXT, text TEXT, dk TEXT, reports INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reacts (note INTEGER, who TEXT, kind TEXT, PRIMARY KEY (note, who, kind))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS notes_day ON notes(day)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS replies_note ON replies(note)`);
  }
  tidy(day) { // 60일 지난 글 지우기 + 지난 날 해시 지우기
    const old = Date.now() - NOTE_DAYS * DAY_MS;
    this.sql.exec(`DELETE FROM replies WHERE note IN (SELECT id FROM notes WHERE at < ?)`, old);
    this.sql.exec(`DELETE FROM notes WHERE at < ?`, old);
    this.sql.exec(`UPDATE notes SET dk = NULL, ik = NULL WHERE day < ? AND dk IS NOT NULL`, day);
    this.sql.exec(`UPDATE replies SET dk = NULL WHERE day < ? AND dk IS NOT NULL`, day);
  }
  list() {
    const notes = this.sql.exec(`SELECT id, text, name, at, todak FROM notes WHERE hidden = 0 AND at >= ? ORDER BY id DESC LIMIT 60`, Date.now() - NOTE_DAYS * DAY_MS).toArray();
    if (!notes.length) return [];
    const ids = notes.map((n) => n.id), rs = this.sql.exec(`SELECT id, note, text, at FROM replies WHERE hidden = 0 AND note IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids).toArray();
    for (const n of notes) n.replies = rs.filter((r) => r.note === n.id).slice(-20).map((r) => ({ id: r.id, text: r.text, at: r.at }));
    return notes;
  }
  async fetch(req) {
    const url = new URL(req.url), day = kstDay(), ip = req.headers.get('x-ip') || '';
    if (req.method === 'GET' && url.pathname === '/notes') return json({ notes: this.list() });
    if (req.method !== 'POST') return json({ why: 'fail' }, 405);
    let b = {}; try { b = await req.json(); } catch (e) { return json({ why: 'fail' }, 400); }
    this.tidy(day);
    const dev = String(b.dev || '');
    const devOk = /^[a-z0-9]{16,40}$/.test(dev);
    const dk = devOk ? await sha('d|' + day + '|' + dev) : '', ik = await sha('i|' + day + '|' + ip); // 날마다 바뀌는 해시 (원래 값은 저장 안 함)
    if (url.pathname === '/notes') { // 새 한마디
      if (!devOk) return json({ why: 'fail' }, 400);
      const c = checkNote(b.text); if (!c.ok) return json({ why: c.why }, 400);
      let name = null; if (b.name != null && b.name !== '') { const nc = checkName(b.name); if (!nc.ok) return json({ why: nc.why }, 400); name = nc.text; }
      const all = this.sql.exec(`SELECT COUNT(*) AS c FROM notes WHERE day = ?`, day).one().c;
      if (all >= num(this.env.NOTES_DAY_MAX, 500)) return json({ why: 'closed' }, 429);
      const mine = this.sql.exec(`SELECT COUNT(*) AS c FROM notes WHERE day = ? AND dk = ?`, day, dk).one().c;
      const sameIp = ip ? this.sql.exec(`SELECT COUNT(*) AS c FROM notes WHERE day = ? AND ik = ?`, day, ik).one().c : 0;
      if (mine >= NOTE_DAY_LIMIT || sameIp >= NOTE_DAY_LIMIT * 4) return json({ why: 'limit' }, 429); // 같은 사람 3개 · 같은 인터넷 연결 12개
      const key = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''), at = Date.now();
      const id = this.sql.exec(`INSERT INTO notes (at, day, text, name, dk, ik, kh) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, at, day, c.text, name, dk, ik, await sha('k|' + key)).one().id;
      return json({ note: { id, text: c.text, name, at, todak: 0, replies: [] }, key }); // key: 이 기기만 아는 "내리기 열쇠"
    }
    let m = url.pathname.match(/^\/notes\/(\d+)\/(todak|report|reply|delete)$/);
    if (m) {
      const id = num(m[1], 0), kind = m[2];
      const row = this.sql.exec(`SELECT id, kh FROM notes WHERE id = ?`, id).toArray()[0]; if (!row) return json({ why: 'fail' }, 404);
      if (kind === 'delete') { // 내가 올린 글 내리기 (열쇠가 맞을 때만)
        if (!b.key || (await sha('k|' + String(b.key))) !== row.kh) return json({ why: 'fail' }, 403);
        this.sql.exec(`DELETE FROM replies WHERE note = ?`, id); this.sql.exec(`DELETE FROM reacts WHERE note = ?`, id); this.sql.exec(`DELETE FROM notes WHERE id = ?`, id);
        return json({ ok: true });
      }
      if (!devOk) return json({ why: 'fail' }, 400);
      if (kind === 'reply') { // 한 줄 답하기 (50자, 같은 거르기)
        const c = checkNote(b.text, REPLY_MAX); if (!c.ok) return json({ why: c.why }, 400);
        const mine = this.sql.exec(`SELECT COUNT(*) AS c FROM replies WHERE day = ? AND dk = ?`, day, dk).one().c;
        if (mine >= REPLY_DAY_LIMIT) return json({ why: 'replyLimit' }, 429);
        const cnt = this.sql.exec(`SELECT COUNT(*) AS c FROM replies WHERE note = ?`, id).one().c; if (cnt >= 50) return json({ why: 'closed' }, 429);
        const at = Date.now(), rid = this.sql.exec(`INSERT INTO replies (note, at, day, text, dk) VALUES (?, ?, ?, ?, ?) RETURNING id`, id, at, day, c.text, dk).one().id;
        return json({ reply: { id: rid, text: c.text, at } });
      }
      const who = await sha('w|' + dev); // 토닥·신고는 한 사람 한 번
      const ins = this.sql.exec(`INSERT OR IGNORE INTO reacts (note, who, kind) VALUES (?, ?, ?)`, id, who, kind).rowsWritten;
      if (ins) {
        if (kind === 'todak') this.sql.exec(`UPDATE notes SET todak = todak + 1 WHERE id = ?`, id);
        else this.sql.exec(`UPDATE notes SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?`, REPORT_HIDE, id);
      }
      const t = this.sql.exec(`SELECT todak FROM notes WHERE id = ?`, id).one().todak;
      return json({ ok: true, todak: t });
    }
    m = url.pathname.match(/^\/replies\/(\d+)\/report$/);
    if (m) { // 답 신고 (3번이면 숨김)
      if (!devOk) return json({ why: 'fail' }, 400);
      const id = num(m[1], 0), who = await sha('w|' + dev);
      const ins = this.sql.exec(`INSERT OR IGNORE INTO reacts (note, who, kind) VALUES (?, ?, 'rreport')`, -id, who).rowsWritten;
      if (ins) this.sql.exec(`UPDATE replies SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?`, REPORT_HIDE, id);
      return json({ ok: true });
    }
    return json({ why: 'fail' }, 404);
  }
}
