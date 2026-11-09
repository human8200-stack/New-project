// 사진 읽기: POST /api/photos  { type: "home"|"shop", photos: [{ side: "전"|"공사 중"|"후", data: base64 JPEG }] }
// 사진마다 짧은 설명과 가려야 할 것을 돌려준다. 사진은 저장하지 않는다 (메모리에서만 쓰고 버림).
import { checkCode, take, giveBack } from "../lib/guard.mjs";
import { json, clientIp, hasKey, NO_KEY, callOnce, MODEL } from "../lib/claude.mjs";
import { photoPrompt } from "../lib/prompt.mjs";

const MAX_PHOTOS = 15; // 전 6 + 후 6 + 공사 중 3
const MAX_ONE = 1.6e6;   // 사진 한 장 base64 글자 수 상한 (약 1.2MB)
const MAX_BODY = 5.5e6;  // Netlify 요청 6MB 제한 안쪽

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method", message: "잘못된 요청이에요." });
  if (!hasKey()) return json(503, NO_KEY);
  const c = await checkCode(req.headers.get("x-shop-code"), clientIp(req, context));
  if (!c.ok) return json(c.status, { error: c.error, message: c.message });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_big", message: "사진이 너무 커요. 사진 수를 줄여 다시 해 주세요." });
  let body; try { body = JSON.parse(raw); } catch (_) { return json(400, { error: "bad_input", message: "보낸 내용을 읽지 못했어요. 다시 해 주세요." }); }
  const list = Array.isArray(body && body.photos) ? body.photos : [];
  if (!list.length || list.length > MAX_PHOTOS) return json(400, { error: "bad_input", message: "사진은 1장에서 15장까지 보낼 수 있어요." });
  for (const p of list) {
    if (!p || typeof p.data !== "string" || p.data.length > MAX_ONE || !/^[A-Za-z0-9+/=]+$/.test(p.data.slice(0, 200))) {
      return json(400, { error: "bad_input", message: "사진 하나를 읽지 못했어요. 그 사진을 빼고 다시 해 주세요." });
    }
  }
  const photos = list.map(p => ({ side: p.side === "후" ? "후" : p.side === "공사 중" ? "공사 중" : "전", data: p.data }));

  const t = await take(c.shop, "photos");
  if (!t.ok) return json(t.status, { error: t.error, message: t.message });

  const content = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: "이미지 " + (i + 1) + " (" + p.side + " 사진)" });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.data } });
  });
  content.push({ type: "text", text: photoPrompt(photos, body.type === "shop" ? "shop" : "home") });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50e3);
  try {
    const r = await callOnce({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content }]
    }, ctrl.signal);
    const out = photos.map((p, i) => ({ n: i + 1, side: p.side, desc: p.side + " 사진 " + (i + 1), seen: "", privacy: [] }));
    let parsed = null;
    const m = r.text.match(/\[[\s\S]*\]/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; } }
    if (Array.isArray(parsed)) parsed.forEach(x => {
      const n = Number(x && x.n); if (!(n >= 1 && n <= out.length)) return;
      const o = out[n - 1];
      if (x.desc) o.desc = String(x.desc).slice(0, 60);
      if (x.seen) o.seen = String(x.seen).slice(0, 120);
      if (Array.isArray(x.privacy)) o.privacy = x.privacy.map(String).filter(Boolean).slice(0, 5);
    });
    console.log("[photos]", c.shop, photos.length + "장", JSON.stringify(r.usage || {}));
    return json(200, { ok: true, photos: out, read: Array.isArray(parsed) });
  } catch (e) {
    await giveBack(c.shop, "photos");
    if (e && e.name === "AbortError") return json(504, { error: "timeout", message: "사진 읽기가 너무 오래 걸렸어요. 사진 수를 줄여 다시 해 주세요." });
    return json(502, (e && e.friendly) || { error: "api", message: "사진을 읽지 못했어요. 잠시 뒤 다시 해 주세요." });
  } finally { clearTimeout(timer); }
};

export const config = { path: "/api/photos", method: ["POST"] };
