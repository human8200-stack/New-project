// 공부 루틴 서버 (Cloudflare Worker)
// 1) 사진 읽기: 앱이 보낸 지시문(과 사진)을 Claude에게 넘기고, 답 글자를 그대로 돌려준다.
// 2) 계정과 기기 동기화: 아이디·비밀번호로 로그인하면 기기마다 같은 기록 (아래 handleAuth, handleMe).
// API 키는 이 서버의 비밀 값(ANTHROPIC_API_KEY)에만 있고 앱에는 없다.
// 가족 코드(FAMILY_CODE)가 맞는 요청만 받는다.

import Anthropic from '@anthropic-ai/sdk';

const MAX_IMAGES = 6;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Family-Code, Authorization',
  };
}

// ---------- 계정과 기기 동기화 (Workers KV) ----------
// 아이디·비밀번호로 로그인하면 어느 기기에서든 같은 기록을 본다.
// user:<아이디>        비밀번호 해시와 기록 칸 번호
// tok:<토큰>           로그인한 기기 (1년)
// state:<칸 번호>      기록 (사진은 뺀 JSON 글자)
// img:<칸 번호>:<id>   오답 사진 하나
// 계정을 새로 만들 때만 가족 코드(FAMILY_CODE)가 필요하다. 아무나 계정을 만들지 못하게.

const USER_RE = /^[a-z0-9_]{3,20}$/;
const MAX_STATE = 5_000_000;
const MAX_IMAGE = 2_000_000;
const PBKDF2_ITERATIONS = 100_000; // Workers가 허용하는 최대
const TOKEN_TTL = 60 * 60 * 24 * 365;
const LOCK_AFTER = 10; // 비밀번호를 연달아 틀리면 15분 잠근다

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return hex(a);
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}

// 글자 비교에 걸리는 시간으로 비밀번호를 알아내지 못하게
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function issueToken(env, id) {
  const token = randomHex(32);
  await env.SYNC.put(`tok:${token}`, JSON.stringify({ id, at: Date.now() }), { expirationTtl: TOKEN_TTL });
  return token;
}

async function userFromToken(request, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const tok = await env.SYNC.get(`tok:${m[1]}`, 'json');
  if (!tok) return null;
  const user = await env.SYNC.get(`user:${tok.id}`, 'json');
  return user ? { ...user, id: tok.id, token: m[1] } : null;
}

async function readJson(request) {
  return request.json().catch(() => null);
}

async function handleAuth(request, env, action) {
  if (request.method !== 'POST') return reply(env, 405, { error: 'POST만 받아요' });
  const body = (await readJson(request)) || {};
  const id = String(body.id || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (action === 'signup') {
    if (env.FAMILY_CODE && body.invite !== env.FAMILY_CODE) return reply(env, 403, { error: '가족 코드가 맞지 않아요' });
    if (!USER_RE.test(id)) return reply(env, 400, { error: '아이디는 영어 소문자·숫자 3~20자로 정해 주세요' });
    if (password.length < 6) return reply(env, 400, { error: '비밀번호는 6자 이상으로 정해 주세요' });
    if (await env.SYNC.get(`user:${id}`)) return reply(env, 409, { error: '이미 있는 아이디예요. 다른 아이디로 정하거나 로그인해 주세요' });
    const salt = randomHex(16);
    const user = { salt, hash: await hashPassword(password, salt), box: randomHex(16), created: Date.now() };
    await env.SYNC.put(`user:${id}`, JSON.stringify(user));
    return reply(env, 200, { token: await issueToken(env, id), id });
  }

  if (action === 'login') {
    const user = await env.SYNC.get(`user:${id}`, 'json');
    const lockKey = `fail:${id}`;
    const fails = Number(await env.SYNC.get(lockKey)) || 0;
    if (fails >= LOCK_AFTER) return reply(env, 429, { error: '비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 해 주세요' });
    if (!user || !sameText(await hashPassword(password, user.salt), user.hash)) {
      if (user) await env.SYNC.put(lockKey, String(fails + 1), { expirationTtl: 15 * 60 });
      return reply(env, 401, { error: '아이디나 비밀번호가 맞지 않아요' });
    }
    return reply(env, 200, { token: await issueToken(env, id), id });
  }

  const me = await userFromToken(request, env);
  if (!me) return reply(env, 401, { error: '다시 로그인해 주세요' });

  if (action === 'password') {
    if (!sameText(await hashPassword(String(body.old || ''), me.salt), me.hash)) return reply(env, 401, { error: '지금 비밀번호가 맞지 않아요' });
    const next = String(body.password || '');
    if (next.length < 6) return reply(env, 400, { error: '비밀번호는 6자 이상으로 정해 주세요' });
    const salt = randomHex(16);
    await env.SYNC.put(`user:${me.id}`, JSON.stringify({ salt, hash: await hashPassword(next, salt), box: me.box, created: me.created }));
    return reply(env, 200, { ok: true });
  }

  if (action === 'logout') {
    await env.SYNC.delete(`tok:${me.token}`);
    return reply(env, 200, { ok: true });
  }

  return reply(env, 404, { error: '없는 주소예요' });
}

// /me/state, /me/img/<id>: 로그인한 사람의 기록 칸
async function handleMe(request, env, parts) {
  const me = await userFromToken(request, env);
  if (!me) return reply(env, 401, { error: '다시 로그인해 주세요' });
  const [kind, imgId] = parts;

  if (kind === 'img') {
    if (!/^[a-z0-9]{4,40}$/i.test(imgId || '')) return reply(env, 400, { error: '사진 번호가 잘못됐어요' });
    const key = `img:${me.box}:${imgId}`;
    if (request.method === 'GET') {
      const data = await env.SYNC.get(key);
      return data ? reply(env, 200, { data }) : reply(env, 404, { error: '사진이 없어요' });
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      if (!body || typeof body.data !== 'string' || body.data.length > MAX_IMAGE) return reply(env, 400, { error: '사진이 너무 커요' });
      await env.SYNC.put(key, body.data);
      return reply(env, 200, { ok: true });
    }
    return reply(env, 405, { error: 'GET, PUT만 받아요' });
  }

  if (kind !== 'state') return reply(env, 404, { error: '없는 주소예요' });
  const key = `state:${me.box}`;
  if (request.method === 'GET') {
    const stored = await env.SYNC.get(key, 'json');
    return stored ? reply(env, 200, stored) : reply(env, 404, { error: '아직 올린 기록이 없어요' });
  }
  if (request.method === 'PUT') {
    const body = await readJson(request);
    if (!body || typeof body.state !== 'string' || body.state.length > MAX_STATE) return reply(env, 400, { error: '기록 형식이 잘못됐어요' });
    const updatedAt = Number(body.updatedAt) || 0;
    // 더 나중에 고친 기록이 이미 있으면 덮어쓰지 않고 그 기록을 돌려준다 (force: 로그인할 때 이 기기 기록을 쓰기로 고른 경우)
    const stored = await env.SYNC.get(key, 'json');
    if (stored && stored.updatedAt > updatedAt && !body.force) return reply(env, 409, stored);
    await env.SYNC.put(key, JSON.stringify({ state: body.state, updatedAt, by: String(body.by || '').slice(0, 40) }));
    return reply(env, 200, { ok: true, updatedAt });
  }
  return reply(env, 405, { error: 'GET, PUT만 받아요' });
}

function reply(env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'auth' || parts[0] === 'me') {
      if (!env.SYNC) return reply(env, 501, { error: '동기화 저장소가 아직 없어요' });
      return parts[0] === 'auth' ? handleAuth(request, env, parts[1]) : handleMe(request, env, parts.slice(1));
    }
    // 서버 AI는 가족 코드가 맞아야 쓴다 (사용료가 서버 키로 나가므로)
    if (!env.FAMILY_CODE || request.headers.get('X-Family-Code') !== env.FAMILY_CODE) {
      return reply(env, 401, { error: '가족 코드가 맞지 않아요' });
    }
    if (request.method !== 'POST') return reply(env, 405, { error: 'POST만 받아요' });
    // 사진 읽기는 각자 자기 API 키로 앱에서 바로 할 수 있어서, 서버 키는 넣어도 되고 안 넣어도 된다
    if (!env.ANTHROPIC_API_KEY) return reply(env, 501, { error: '이 서버에는 AI 키가 없어요. 앱 설정에 각자 API 키를 넣어 주세요' });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return reply(env, 400, { error: '요청 형식이 잘못됐어요' });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 20000) : '';
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    if (!prompt) return reply(env, 400, { error: '지시문이 필요해요' });

    const content = images
      .filter((img) => img && typeof img.data === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(img.media_type))
      .map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }));
    content.push({ type: 'text', text: prompt });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content }],
      });
      if (response.stop_reason === 'refusal') return reply(env, 422, { error: '이 사진은 정리할 수 없어요' });
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return reply(env, 200, { text });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return reply(env, 429, { error: '잠시 뒤에 다시 시도해 주세요' });
      if (e instanceof Anthropic.APIError) return reply(env, 502, { error: 'AI 서버 오류' });
      return reply(env, 500, { error: '알 수 없는 오류' });
    }
  },
};
