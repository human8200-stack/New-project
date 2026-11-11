// 글쓰기: POST /api/write  { fields: {...화면 입력값}, photos: [{side, desc, seen}] }  ← 사진 파일은 안 보냄
// 글을 흘려 보낸다 (한 줄에 JSON 하나): {"t":"글 조각"} … 마지막 {"done":true,"stop":"end_turn","left":19}
// 실패하면 {"error":"...","message":"..."} 한 줄.
import { checkCode, take, giveBack, NO_STORE } from "../lib/guard.mjs";
import { json, clientIp, hasKey, NO_KEY, callStream, MODEL, WRITE_EFFORT } from "../lib/claude.mjs";
import { systemFor, buildInput } from "../lib/prompt.mjs";

const TIME_CAP = 55e3; // Netlify 함수 60초 제한보다 조금 먼저 끊는다

export default async (req, context) => {
  try { return await handle(req, context); }
  catch (e) { if (e && e.code === "no_store") return json(503, NO_STORE); console.error(e); return json(500, { error: "server", message: "잠시 문제가 생겼어요. 다시 해 주세요." }); }
};

async function handle(req, context) {
  if (req.method !== "POST") return json(405, { error: "method", message: "잘못된 요청이에요." });
  const c = await checkCode(req.headers.get("x-shop-code"), clientIp(req, context));   // 코드 먼저
  if (!c.ok) return json(c.status, { error: c.error, message: c.message });
  if (!hasKey()) return json(503, NO_KEY);

  const raw = await req.text();
  if (raw.length > 60e3) return json(413, { error: "too_big", message: "보낸 내용이 너무 길어요." });
  let body; try { body = JSON.parse(raw); } catch (_) { return json(400, { error: "bad_input", message: "보낸 내용을 읽지 못했어요. 다시 해 주세요." }); }
  const f = (body && body.fields) || {};
  if (f.type !== "home" && f.type !== "shop") return json(400, { error: "bad_input", message: "집인지 상점인지 골라 주세요." });
  if (!Array.isArray(f.spaces) || !f.spaces.length) return json(400, { error: "bad_input", message: "공간을 하나 골라 주세요." });
  if (f.consent !== "region" && f.consent !== "photo" && f.consent !== "none") return json(400, { error: "bad_input", message: "고객 게시 동의를 골라 주세요." });
  if (f.consent === "none") return json(400, { error: "no_consent", message: "고객 게시 동의가 없어 글을 만들지 않았어요. 동의를 받은 뒤 다시 눌러 주세요." });
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 15) : [];

  const t = await take(c.shop, "posts");
  if (!t.ok) return json(t.status, { error: t.error, message: t.message });

  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const started = Date.now();
  let got = 0, cut = false;
  const stream = new ReadableStream({
    async start(sc) {
      const send = o => sc.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const timer = setInterval(() => { if (Date.now() - started > TIME_CAP) { cut = true; ctrl.abort(); } }, 1000);
      try {
        send({ hello: true, left: t.left });
        const r = await callStream({
          model: MODEL,
          max_tokens: 12000,
          output_config: { effort: WRITE_EFFORT },
          system: systemFor(f.type),
          messages: [{ role: "user", content: buildInput(f, photos) }]
        }, txt => { if (txt) { got += txt.length; send({ t: txt }); } }, ctrl.signal);
        console.log("[write]", c.shop, Math.round((Date.now() - started) / 1000) + "초", JSON.stringify(r.usage || {}));
        send({ done: true, stop: r.stop, left: t.left });
      } catch (e) {
        if (cut && got > 0) { send({ done: true, stop: "time_cut", left: t.left }); }
        else {
          // AI가 처음부터 200이 아닌 응답을 줬을 때만 되돌림 (생각만 하다 끊긴 경우는 돈이 나갔으므로 안 돌려줌)
          if (e && e.preStream) await giveBack(c.shop, "posts");
          const fr = cut ? { error: "timeout", message: "글쓰기가 너무 오래 걸렸어요. [다시 시도]를 눌러 주세요." }
                         : ((e && e.friendly) || { error: "api", message: "글을 못 만들었어요. 잠시 뒤 다시 눌러 주세요." });
          send(fr);
        }
      } finally { clearInterval(timer); sc.close(); }
    },
    cancel() { ctrl.abort(); }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export const config = { path: "/api/write", method: ["POST"] };
