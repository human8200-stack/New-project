// 공부 루틴 사진 읽기 서버 (Cloudflare Worker)
// 앱이 보낸 사진과 지시문을 Claude에게 넘기고, 답 글자를 그대로 돌려준다.
// API 키는 이 서버의 비밀 값(ANTHROPIC_API_KEY)에만 있고 앱에는 없다.
// 가족 코드(FAMILY_CODE)가 맞는 요청만 받는다.

import Anthropic from '@anthropic-ai/sdk';

const MAX_IMAGES = 6;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Family-Code',
  };
}

function reply(env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (request.method !== 'POST') return reply(env, 405, { error: 'POST만 받아요' });
    if (!env.FAMILY_CODE || request.headers.get('X-Family-Code') !== env.FAMILY_CODE) {
      return reply(env, 401, { error: '가족 코드가 맞지 않아요' });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return reply(env, 400, { error: '요청 형식이 잘못됐어요' });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 20000) : '';
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    if (!prompt || !images.length) return reply(env, 400, { error: '사진과 지시문이 필요해요' });

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
