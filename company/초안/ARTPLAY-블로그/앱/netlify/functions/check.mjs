// 접속 코드 확인: POST /api/check  (머리글 x-shop-code)
// 돌려주는 것: { ok, shop, left(오늘 남은 글), ai(키 연결 여부), limit }
import { checkCode, postsLeft, limits } from "../lib/guard.mjs";
import { json, clientIp, hasKey } from "../lib/claude.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method", message: "잘못된 요청이에요." });
  const c = await checkCode(req.headers.get("x-shop-code"), clientIp(req, context));
  if (!c.ok) return json(c.status, { error: c.error, message: c.message });
  return json(200, { ok: true, shop: c.shop, left: await postsLeft(c.shop), limit: limits().daily, ai: hasKey() });
};

export const config = { path: "/api/check", method: ["POST"] };
