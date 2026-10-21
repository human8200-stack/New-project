// 공부 루틴 서버 (Cloudflare Worker)
// 1) 사진 읽기: 앱이 보낸 지시문(과 사진)을 Claude에게 넘기고, 답 글자를 그대로 돌려준다.
// 2) 기기 동기화: 연결 코드마다 기록을 하나 저장한다 (아래 handleSync).
// API 키는 이 서버의 비밀 값(ANTHROPIC_API_KEY)에만 있고 앱에는 없다.
// 가족 코드(FAMILY_CODE)가 맞는 요청만 받는다.

import Anthropic from '@anthropic-ai/sdk';

const MAX_IMAGES = 6;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Family-Code',
  };
}

// ---------- 기기 동기화: 연결 코드 하나에 기록 하나 (Workers KV) ----------
// /sync/<연결 코드>          기록 (사진은 뺀 JSON 글자)
// /sync/<연결 코드>/img/<id>  오답 사진 하나
// 연결 코드는 앱이 처음 만들 때 무작위로 정하고, 가족 코드도 맞아야 읽고 쓸 수 있다.

const ID_RE = /^[a-z0-9]{12,40}$/;
const MAX_STATE = 5_000_000;
const MAX_IMAGE = 2_000_000;

async function handleSync(request, env, parts) {
  if (!env.SYNC) return reply(env, 501, { error: '동기화 저장소가 아직 없어요' });
  const [id, kind, imgId] = parts;
  if (!ID_RE.test(id || '')) return reply(env, 400, { error: '연결 코드가 잘못됐어요' });

  if (kind === 'img') {
    if (!/^[a-z0-9]{4,40}$/i.test(imgId || '')) return reply(env, 400, { error: '사진 번호가 잘못됐어요' });
    const key = `img:${id}:${imgId}`;
    if (request.method === 'GET') {
      const data = await env.SYNC.get(key);
      return data ? reply(env, 200, { data }) : reply(env, 404, { error: '사진이 없어요' });
    }
    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!body || typeof body.data !== 'string' || body.data.length > MAX_IMAGE) return reply(env, 400, { error: '사진이 너무 커요' });
      await env.SYNC.put(key, body.data);
      return reply(env, 200, { ok: true });
    }
    return reply(env, 405, { error: 'GET, PUT만 받아요' });
  }

  const key = `state:${id}`;
  if (request.method === 'GET') {
    const stored = await env.SYNC.get(key, 'json');
    return stored ? reply(env, 200, stored) : reply(env, 404, { error: '이 연결 코드의 기록이 없어요' });
  }
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.state !== 'string' || body.state.length > MAX_STATE) return reply(env, 400, { error: '기록 형식이 잘못됐어요' });
    const updatedAt = Number(body.updatedAt) || 0;
    // 더 나중에 고친 기록이 이미 있으면 덮어쓰지 않고 그 기록을 돌려준다
    const stored = await env.SYNC.get(key, 'json');
    if (stored && stored.updatedAt > updatedAt && !body.create) return reply(env, 409, stored);
    if (body.create && stored) return reply(env, 409, stored);
    const record = { state: body.state, updatedAt, by: String(body.by || '').slice(0, 40) };
    await env.SYNC.put(key, JSON.stringify(record));
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
    if (!env.FAMILY_CODE || request.headers.get('X-Family-Code') !== env.FAMILY_CODE) {
      return reply(env, 401, { error: '가족 코드가 맞지 않아요' });
    }
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'sync') return handleSync(request, env, parts.slice(1));
    if (request.method !== 'POST') return reply(env, 405, { error: 'POST만 받아요' });

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
