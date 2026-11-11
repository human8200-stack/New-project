// 카드·사진 읽기: POST /api/photos  { photos: [{ data: base64 JPEG }] }  (최대 10장)
// 사진마다 짧은 설명·카드 글자·가려야 할 것을 돌려준다. 사진은 저장하지 않는다 (메모리에서만 쓰고 버림).
// 회사가 만든 노트(카드+원고)를 불러온 경우에는 화면이 이 함수를 부르지 않는다 (원고에 카드 글이 다 있어서, 돈 아낌).
import { checkCode, take, giveBack, NO_STORE } from "../lib/guard.mjs";
import { json, clientIp, hasKey, NO_KEY, callOnce, MODEL } from "../lib/claude.mjs";
import { photoPrompt } from "../lib/prompt.mjs";

const MAX_PHOTOS = 10;
const MAX_ONE = 1.0e6;   // 사진 한 장 base64 글자 수 상한 (화면에서 긴 변 960px로 줄여 보내므로 보통 0.1~0.3MB)
const MAX_BODY = 5.5e6;  // Netlify 요청 6MB 제한 안쪽

export default async (req, context) => {
  try { return await handle(req, context); }
  catch (e) { if (e && e.code === "no_store") return json(503, NO_STORE); console.error(e); return json(500, { error: "server", message: "잠시 문제가 생겼어요. 다시 해 주세요." }); }
};

async function handle(req, context) {
  if (req.method !== "POST") return json(405, { error: "method", message: "잘못된 요청이에요." });
  const c = await checkCode(req.headers.get("x-access-code"), clientIp(req, context));   // 코드 먼저
  if (!c.ok) return json(c.status, { error: c.error, message: c.message });
  if (!hasKey()) return json(503, NO_KEY);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_big", message: "사진이 너무 커요. 사진 수를 줄여 다시 해 주세요." });
  let body; try { body = JSON.parse(raw); } catch (_) { return json(400, { error: "bad_input", message: "보낸 내용을 읽지 못했어요. 다시 해 주세요." }); }
  const list = Array.isArray(body && body.photos) ? body.photos : [];
  if (!list.length || list.length > MAX_PHOTOS) return json(400, { error: "bad_input", message: "사진은 1장에서 10장까지 보낼 수 있어요." });
  for (const p of list) {
    if (!p || typeof p.data !== "string" || p.data.length > MAX_ONE || !/^[A-Za-z0-9+/=]+$/.test(p.data.slice(0, 200))) {
      return json(400, { error: "bad_input", message: "사진 하나를 읽지 못했어요. 그 사진을 빼고 다시 해 주세요." });
    }
  }

  const t = await take(c.shop, "photos");
  if (!t.ok) return json(t.status, { error: t.error, message: t.message });

  const content = [];
  list.forEach((p, i) => {
    content.push({ type: "text", text: "이미지 " + (i + 1) });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.data } });
  });
  content.push({ type: "text", text: photoPrompt(list.length) });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50e3);
  try {
    const r = await callOnce({
      model: MODEL,
      max_tokens: 5000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content }]
    }, ctrl.signal);
    const out = list.map((p, i) => ({ n: i + 1, kind: "photo", desc: "사진 " + (i + 1), text: "", privacy: [] }));
    let parsed = null;
    const m = r.text.match(/\[[\s\S]*\]/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; } }
    if (Array.isArray(parsed)) parsed.forEach(x => {
      const n = Number(x && x.n); if (!(n >= 1 && n <= out.length)) return;
      const o = out[n - 1];
      if (x.kind === "card") o.kind = "card";
      if (x.desc) o.desc = String(x.desc).slice(0, 60);
      if (x.text) o.text = String(x.text).slice(0, 400);
      if (Array.isArray(x.privacy)) o.privacy = x.privacy.map(String).filter(Boolean).slice(0, 5);
    });
    console.log("[photos]", c.shop, list.length + "장", JSON.stringify(r.usage || {}));
    return json(200, { ok: true, photos: out, read: Array.isArray(parsed) });
  } catch (e) {
    if (e && e.preStream) await giveBack(c.shop, "photos");   // AI가 처음부터 거절했을 때만 되돌림
    if (e && e.name === "AbortError") return json(504, { error: "timeout", message: "사진 읽기가 너무 오래 걸렸어요. 사진 수를 줄여 다시 해 주세요." });
    return json(502, (e && e.friendly) || { error: "api", message: "사진을 읽지 못했어요. 잠시 뒤 다시 해 주세요." });
  } finally { clearTimeout(timer); }
}

export const config = { path: "/api/photos", method: ["POST"] };
