// 행운 추첨 서버 (Cloudflare Pages Functions + D1)
// 누구나 행사를 만들 수 있다. 만들면 그 행사의 진행자 키가 나오고(브라우저에 저장), 그 키가 있어야 고치고 추첨한다.
// 참가자: 큐알로 /join?e=<행사>를 열어 이름을 등록하고, 당첨되면 휴대폰에 바로 뜬다.
// 필요한 것: D1 데이터베이스를 DB라는 이름으로 연결하기 (표는 처음 요청 때 알아서 만든다).
// 당첨자는 서버가 뽑는다 (화면의 룰렛은 서버가 정한 사람에게 멈추는 연출).

const KEEP_DAYS = 90; // 이보다 오래된 행사는 지운다
const MAX_PARTICIPANTS = 3000;
const MAX_PRIZES = 50;
const DEVICE_RE = /^[a-z0-9]{16,40}$/;
const ID_RE = /^[a-z0-9]{4,20}$/;

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

function randomId(len) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => abc[b % abc.length]).join('');
}

// 0 이상 n 미만의 고른 난수 (치우침 없이)
function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a);
  while (a[0] >= limit);
  return a[0] % n;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
const fail = (status, error) => json({ error }, status);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanText(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanPrizes(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const p of list.slice(0, MAX_PRIZES)) {
    const name = cleanText(p?.name, 40);
    const count = Math.max(1, Math.min(999, Math.floor(Number(p?.count) || 1)));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, count });
  }
  return out;
}

// ---------- 진행자 키 ----------
// 키 자체는 저장하지 않고 해시만 저장한다.

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// 글자 비교에 걸리는 시간으로 값을 알아내지 못하게
function sameText(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function isHost(request, row) {
  const key = request.headers.get('X-Host-Key') || '';
  return !!key && sameText(await sha256(key), row.host_key);
}

// ---------- 표 만들기 (처음 한 번) ----------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, prizes TEXT NOT NULL DEFAULT '[]',
    open INTEGER NOT NULL DEFAULT 1, host_key TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    device TEXT, created_at INTEGER NOT NULL, UNIQUE (event_id, device))`,
  'CREATE INDEX IF NOT EXISTS participants_event ON participants (event_id, created_at)',
  `CREATE TABLE IF NOT EXISTS winners (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, participant_id TEXT NOT NULL,
    prize TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS winners_event ON winners (event_id, created_at)',
];
let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
  schemaReady = true;
}

// ---------- 행사 ----------

function eventRow(row) {
  return { id: row.id, name: row.name, prizes: JSON.parse(row.prizes || '[]'), open: !!row.open, createdAt: row.created_at };
}

async function getRow(env, id) {
  if (!ID_RE.test(id)) return null;
  return env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
}

async function getEvent(env, id) {
  const row = await getRow(env, id);
  return row ? eventRow(row) : null;
}

// 오래된 행사 치우기 (행사를 만들 때 가끔)
async function cleanup(env) {
  const before = Date.now() - KEEP_DAYS * 86400_000;
  const old = 'SELECT id FROM events WHERE created_at < ?';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM winners WHERE event_id IN (${old})`).bind(before),
    env.DB.prepare(`DELETE FROM participants WHERE event_id IN (${old})`).bind(before),
    env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(before),
  ]);
}

async function createEvent(request, env) {
  const b = await body(request);
  const name = cleanText(b.name, 60);
  if (!name) return fail(400, '행사 이름을 넣어 주세요');
  const id = randomId(8);
  const key = randomId(24);
  await env.DB.prepare('INSERT INTO events (id, name, prizes, open, host_key, created_at) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, name, JSON.stringify(cleanPrizes(b.prizes)), await sha256(key), Date.now())
    .run();
  if (Math.random() < 0.1) await cleanup(env).catch(() => {});
  return json({ event: await getEvent(env, id), key });
}

async function updateEvent(request, env, ev) {
  const b = await body(request);
  const name = b.name === undefined ? ev.name : cleanText(b.name, 60);
  if (!name) return fail(400, '행사 이름을 넣어 주세요');
  const prizes = b.prizes === undefined ? ev.prizes : cleanPrizes(b.prizes);
  const open = b.open === undefined ? ev.open : !!b.open;
  await env.DB.prepare('UPDATE events SET name = ?, prizes = ?, open = ? WHERE id = ?')
    .bind(name, JSON.stringify(prizes), open ? 1 : 0, ev.id)
    .run();
  return json({ event: await getEvent(env, ev.id) });
}

async function deleteEvent(env, ev) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM winners WHERE event_id = ?').bind(ev.id),
    env.DB.prepare('DELETE FROM participants WHERE event_id = ?').bind(ev.id),
    env.DB.prepare('DELETE FROM events WHERE id = ?').bind(ev.id),
  ]);
  return json({ ok: true });
}

async function eventDetail(env, ev) {
  const [p, w] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, note, created_at FROM participants WHERE event_id = ? ORDER BY created_at').bind(ev.id),
    env.DB.prepare('SELECT id, participant_id, prize, created_at FROM winners WHERE event_id = ? ORDER BY created_at').bind(ev.id),
  ]);
  return json({
    event: ev,
    participants: p.results.map((r) => ({ id: r.id, name: r.name, note: r.note, at: r.created_at })),
    winners: w.results.map((r) => ({ id: r.id, participantId: r.participant_id, prize: r.prize, at: r.created_at })),
  });
}

async function countParticipants(env, eventId) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?').bind(eventId).first();
  return row.n;
}

async function addParticipant(request, env, ev) {
  const b = await body(request);
  const name = cleanText(b.name, 30);
  if (!name) return fail(400, '이름을 넣어 주세요');
  if ((await countParticipants(env, ev.id)) >= MAX_PARTICIPANTS) return fail(400, '참가자가 너무 많아요');
  await env.DB.prepare('INSERT INTO participants (id, event_id, name, note, device, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
    .bind(randomId(10), ev.id, name, cleanText(b.note, 30), Date.now())
    .run();
  return json({ ok: true });
}

async function removeParticipant(env, ev, pid) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM winners WHERE event_id = ? AND participant_id = ?').bind(ev.id, pid),
    env.DB.prepare('DELETE FROM participants WHERE event_id = ? AND id = ?').bind(ev.id, pid),
  ]);
  return json({ ok: true });
}

// 선물 하나를 걸고 한 명 뽑는다. 이미 당첨된 사람은 다시 뽑히지 않는다.
async function draw(request, env, ev) {
  const { prize } = await body(request);
  const item = ev.prizes.find((p) => p.name === prize);
  if (!item) return fail(400, '선물을 골라 주세요');
  const [given, pool] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM winners WHERE event_id = ? AND prize = ?').bind(ev.id, item.name),
    env.DB.prepare(
      `SELECT id, name, note FROM participants WHERE event_id = ?
       AND id NOT IN (SELECT participant_id FROM winners WHERE event_id = ?) ORDER BY created_at`,
    ).bind(ev.id, ev.id),
  ]);
  if (given.results[0].n >= item.count) return fail(400, `${item.name}은(는) 다 나갔어요`);
  if (!pool.results.length) return fail(400, '뽑을 사람이 없어요');
  const pick = pool.results[randomInt(pool.results.length)];
  const winner = { id: randomId(10), participantId: pick.id, prize: item.name, at: Date.now() };
  await env.DB.prepare('INSERT INTO winners (id, event_id, participant_id, prize, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(winner.id, ev.id, winner.participantId, winner.prize, winner.at)
    .run();
  return json({ winner, pool: pool.results.map((r) => r.id) });
}

async function cancelWinner(env, ev, wid) {
  await env.DB.prepare('DELETE FROM winners WHERE event_id = ? AND id = ?').bind(ev.id, wid).run();
  return json({ ok: true });
}

async function resetWinners(env, ev) {
  await env.DB.prepare('DELETE FROM winners WHERE event_id = ?').bind(ev.id).run();
  return json({ ok: true });
}

// ---------- 참가자 (로그인 없이) ----------

async function joinInfo(env, ev, device) {
  const out = { event: { name: ev.name, open: ev.open }, me: null, won: [] };
  if (DEVICE_RE.test(device || '')) {
    const me = await env.DB.prepare('SELECT id, name, note FROM participants WHERE event_id = ? AND device = ?').bind(ev.id, device).first();
    if (me) {
      out.me = { name: me.name, note: me.note };
      const { results } = await env.DB.prepare('SELECT prize FROM winners WHERE event_id = ? AND participant_id = ?').bind(ev.id, me.id).all();
      out.won = results.map((r) => r.prize);
    }
  }
  return json(out);
}

async function join(request, env, ev) {
  const b = await body(request);
  const name = cleanText(b.name, 30);
  const note = cleanText(b.note, 30);
  if (!name) return fail(400, '이름을 넣어 주세요');
  if (!DEVICE_RE.test(b.device || '')) return fail(400, '페이지를 새로 열어 주세요');
  const mine = await env.DB.prepare('SELECT id FROM participants WHERE event_id = ? AND device = ?').bind(ev.id, b.device).first();
  if (mine) {
    // 같은 휴대폰이면 새로 만들지 않고 이름만 고친다
    await env.DB.prepare('UPDATE participants SET name = ?, note = ? WHERE id = ?').bind(name, note, mine.id).run();
    return joinInfo(env, ev, b.device);
  }
  if (!ev.open) return fail(403, '등록이 마감됐어요');
  if ((await countParticipants(env, ev.id)) >= MAX_PARTICIPANTS) return fail(400, '참가자가 너무 많아요');
  await env.DB.prepare('INSERT OR IGNORE INTO participants (id, event_id, name, note, device, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomId(10), ev.id, name, note, b.device, Date.now())
    .run();
  return joinInfo(env, ev, b.device);
}

// ---------- 길 찾기 ----------

export async function onRequest({ request, env, params }) {
  if (!env.DB) return fail(503, 'NO_DB');

  const parts = [].concat(params.path || []);
  const method = request.method;
  const url = new URL(request.url);

  // 다른 사이트에서 몰래 보내는 요청 막기 (쓰기 요청은 같은 주소에서 온 것만)
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail(403, '허용되지 않은 요청이에요');
  }

  try {
    await ensureSchema(env);
    const [a, b, c, d] = parts;

    if (a === 'join' && b) {
      const ev = await getEvent(env, b);
      if (!ev) return fail(404, '행사를 찾을 수 없어요');
      if (method === 'GET') return joinInfo(env, ev, url.searchParams.get('device'));
      if (method === 'POST') return join(request, env, ev);
    }

    if (a === 'events' && !b && method === 'POST') return createEvent(request, env);

    if (a === 'events' && b) {
      const row = await getRow(env, b);
      if (!row) return fail(404, '행사를 찾을 수 없어요');
      if (!(await isHost(request, row))) return fail(401, '이 행사의 진행자 키가 없어요');
      const ev = eventRow(row);
      if (!c) {
        if (method === 'GET') return eventDetail(env, ev);
        if (method === 'PUT') return updateEvent(request, env, ev);
        if (method === 'DELETE') return deleteEvent(env, ev);
      }
      if (c === 'participants' && !d && method === 'POST') return addParticipant(request, env, ev);
      if (c === 'participants' && d && method === 'DELETE') return removeParticipant(env, ev, d);
      if (c === 'draw' && method === 'POST') return draw(request, env, ev);
      if (c === 'winners' && !d && method === 'DELETE') return resetWinners(env, ev);
      if (c === 'winners' && d && method === 'DELETE') return cancelWinner(env, ev, d);
    }

    return fail(404, '없는 주소예요');
  } catch (e) {
    return fail(500, `서버 오류: ${e.message}`);
  }
}
