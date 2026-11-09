// 접속 코드 확인: POST /api/check  (머리글 x-shop-code)
// 돌려주는 것: { ok, shop, left(오늘 남은 글), ai(키 연결 여부), limit }
// 코드가 틀려도 200으로 돌려준다 ({ ok:false, error, message }) — 브라우저 콘솔에 오류가 쌓이지 않게
import { checkCode, postsLeft, limits, NO_STORE } from "../lib/guard.mjs";
import { json, clientIp, hasKey } from "../lib/claude.mjs";

export default async (req, context) => {
  try { return await handle(req, context); }
  catch (e) { if (e && e.code === "no_store") return json(200, { ok: false, ...NO_STORE }); console.error(e); return json(500, { error: "server", message: "잠시 문제가 생겼어요. 다시 해 주세요." }); }
};

async function handle(req, context) {
  if (req.method !== "POST") return json(405, { error: "method", message: "잘못된 요청이에요." });
  const c = await checkCode(req.headers.get("x-shop-code"), clientIp(req, context));
  if (!c.ok) return json(200, { ok: false, error: c.error, message: c.message });
  return json(200, { ok: true, shop: c.shop, left: await postsLeft(c.shop), limit: limits().daily, ai: hasKey() });
}

export const config = { path: "/api/check", method: ["POST"] };
