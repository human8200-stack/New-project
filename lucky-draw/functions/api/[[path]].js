// 행운 추첨 서버 (Cloudflare Pages Functions + D1)
// 진행자: /login에서 비밀번호(ADMIN_PASSWORD)로 들어와 행사·선물을 만들고 추첨한다.
// 참가자: 큐알로 /join?e=<행사>를 열어 이름을 등록하고, 당첨되면 휴대폰에 바로 뜬다.
// 당첨자는 서버가 뽑는다 (화면의 룰렛은 서버가 정한 사람에게 멈추는 연출).

const COOKIE = 'ld_session';
const SESSION_TTL = 60 * 60 * 24 * 30;
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

// ---------- 진행자 로그인 ----------
// 쿠키 = 만료시각.서명. 비밀번호를 바꾸면 전에 로그인한 기기는 모두 풀린다.

async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`lucky-draw:${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// 글자 비교에 걸리는 시간으로 값을 알아내지 못하게
function sameText(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function isAdmin(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9]+)\\.([0-9a-f]{64})`));
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return sameText(m[2], await sign(env, m[1]));
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function login(request, env) {
  const { password } = await body(request);
  // 틀린 비밀번호를 빨리 여러 번 넣어 보지 못하게 조금 기다린다
  await new Promise((r) => setTimeout(r, 400));
  if (typeof password !== 'string' || !sameText(password, env.ADMIN_PASSWORD)) return fail(401, '비밀번호가 맞지 않아요');
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(`${exp}.${await sign(env, exp)}`, SESSION_TTL) });
}

// ---------- 행사 ----------

function eventRow(row) {
  return { id: row.id, name: row.name, prizes: JSON.parse(row.prizes || '[]'), open: !!row.open, createdAt: row.created_at };
}

async function getEvent(env, id) {
  if (!ID_RE.test(id)) return null;
  const row = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  return row ? eventRow(row) : null;
}

async function listEvents(env) {
  const { results } = await env.DB.prepare(
    `SELECT e.*, (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS people,
            (SELECT COUNT(*) FROM winners w WHERE w.event_id = e.id) AS drawn
     FROM events e ORDER BY e.created_at DESC LIMIT 100`,
  ).all();
  return json({ events: results.map((r) => ({ ...eventRow(r), people: r.people, drawn: r.drawn })) });
}

async function createEvent(request, env) {
  const b = await body(request);
  const name = cleanText(b.name, 60);
  if (!name) return fail(400, '행사 이름을 넣어 주세요');
  const id = randomId(8);
  await env.DB.prepare('INSERT INTO events (id, name, prizes, open, created_at) VALUES (?, ?, ?, 1, ?)')
    .bind(id, name, JSON.stringify(cleanPrizes(b.prizes)), Date.now())
    .run();
  return json({ event: await getEvent(env, id) });
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
  if (!env.DB) return fail(500, '데이터베이스(DB)가 연결되지 않았어요');
  if (!env.ADMIN_PASSWORD) return fail(500, '진행자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았어요');

  const parts = [].concat(params.path || []);
  const method = request.method;
  const url = new URL(request.url);

  // 다른 사이트에서 몰래 보내는 요청 막기 (쓰기 요청은 같은 주소에서 온 것만)
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return fail(403, '허용되지 않은 요청이에요');
  }

  try {
    const [a, b, c, d] = parts;

    if (a === 'join' && b) {
      const ev = await getEvent(env, b);
      if (!ev) return fail(404, '행사를 찾을 수 없어요');
      if (method === 'GET') return joinInfo(env, ev, url.searchParams.get('device'));
      if (method === 'POST') return join(request, env, ev);
    }

    if (a === 'login' && method === 'POST') return login(request, env);
    if (a === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });

    if (!(await isAdmin(request, env))) return fail(401, '로그인해 주세요');

    if (a === 'me') return json({ ok: true });

    if (a === 'events' && !b) {
      if (method === 'GET') return listEvents(env);
      if (method === 'POST') return createEvent(request, env);
    }

    if (a === 'events' && b) {
      const ev = await getEvent(env, b);
      if (!ev) return fail(404, '행사를 찾을 수 없어요');
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
