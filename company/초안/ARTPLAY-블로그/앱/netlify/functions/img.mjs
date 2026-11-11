// 붙여 넣기용 사진 잠깐 올려 두기 (노트북 [그림과 글 함께 복사]용)
//   POST /api/img            몸통 = 사진 1장 (image/jpeg, 1.5MB까지)  → { ok, id, path: "/api/img/<id>.jpg", left }
//   GET  /api/img/<id>.jpg   그 사진 (image/jpeg, 캐시 1일)
// 왜: 네이버 블로그 PC 편집기는 data: 그림을 "허용되지 않는 사진"으로 막는다. https 주소 그림은 받아 준다.
// 사진은 24시간 뒤 지운다 (올릴 때 10분마다 한 번 오래된 것 정리 + 열 때 24시간 지났으면 지우고 없음).
// 접속 코드가 없어도(체험 모드) 쓸 수 있지만 같은 IP 하루 60장, 앱 전체 하루 1500장까지. 비밀 값은 쓰지 않는다.
import crypto from "node:crypto";
import { getGuardStore, kstDate, NO_STORE } from "../lib/guard.mjs";
import { json, clientIp } from "../lib/claude.mjs";

export const MAX_BYTES = 1.5e6;        // 한 장 최대 1.5MB
export const KEEP_MS = 24 * 3600e3;    // 하루 동안만
export const IP_DAILY = 60;            // 같은 IP 하루 60장
export const ALL_DAILY = 1500;         // 앱 전체 하루 1500장 (마지막 안전줄)
const CLEAN_EVERY = 10 * 60e3;
const ID_RE = /^([0-9a-z]{6,11})-([A-Za-z0-9_-]{22})$/;

let memImg = null; // 내 컴퓨터 시험(dev-server.mjs)에서만 쓰는 임시 사진 보관
function memImgStore() {
  if (!memImg) {
    const m = new Map();
    memImg = {
      async set(k, buf) { m.set(k, Buffer.from(buf)); },
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async delete(k) { m.delete(k); },
      async keys() { return [...m.keys()]; }
    };
  }
  return memImg;
}
let imgStorePromise = null;
function getImgStore() {
  if (globalThis.__ARTPLAY_TEST_IMG_STORE__) return Promise.resolve(globalThis.__ARTPLAY_TEST_IMG_STORE__);
  if (process.env.ARTPLAY_LOCAL_DEV === "1") return Promise.resolve(memImgStore());
  if (!imgStorePromise) {
    imgStorePromise = (async () => {
      try {
        const { getStore } = await import("@netlify/blobs");
        const s = getStore({ name: "artplay-img" });
        return {
          async set(k, buf) { await s.set(k, new Blob([buf], { type: "image/jpeg" })); },
          async get(k) { const v = await s.get(k, { type: "arrayBuffer" }); return v ? Buffer.from(v) : null; },
          async delete(k) { await s.delete(k); },
          async keys() { const r = await s.list(); return (r.blobs || []).map(b => b.key); }
        };
      } catch (e) {
        console.error("[img] Netlify Blobs를 쓸 수 없어요:", e && e.message);
        imgStorePromise = null;
        const err = new Error("no_store"); err.code = "no_store"; throw err;
      }
    })();
  }
  return imgStorePromise;
}

// id = 올린 시각(36진수) + "-" + 무작위 22글자. 시각이 들어 있어 사진을 열어 보지 않고도 오래된 것을 고를 수 있다.
export function newId(now = Date.now()) { return now.toString(36) + "-" + crypto.randomBytes(16).toString("base64url"); }
export function idTime(id) { const m = ID_RE.exec(String(id || "")); return m ? parseInt(m[1], 36) : NaN; }
export function isJpeg(buf) { return !!buf && buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff; }
function ipKey(ip) { return crypto.createHash("sha256").update("artplay-img|" + (ip || "unknown")).digest("hex").slice(0, 24); }

let lastClean = 0;
export async function cleanOld(store, now = Date.now()) {
  lastClean = now;
  let n = 0;
  for (const k of await store.keys()) {
    const t = idTime(k);
    if (!Number.isFinite(t) || now - t > KEEP_MS) { try { await store.delete(k); n++; } catch (_) {} }
    if (n >= 300) break; // 한 번에 너무 오래 걸리지 않게
  }
  return n;
}

export default async (req, context) => {
  try { return await handle(req, context); }
  catch (e) { if (e && e.code === "no_store") return json(503, NO_STORE); console.error(e); return json(500, { error: "server", message: "잠시 문제가 생겼어요. 다시 해 주세요." }); }
};

async function handle(req, context) {
  const url = new URL(req.url);
  if (req.method === "GET") return serve(url.pathname);
  if (req.method !== "POST" || !/^\/api\/img\/?$/.test(url.pathname)) return json(405, { error: "method", message: "잘못된 요청이에요." });

  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg") return json(415, { error: "bad_type", message: "JPEG 사진만 올릴 수 있어요." });
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return json(413, { error: "too_big", message: "사진 한 장이 너무 커요 (1.5MB까지)." });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_BYTES) return json(413, { error: "too_big", message: "사진 한 장이 너무 커요 (1.5MB까지)." });
  if (!isJpeg(buf)) return json(415, { error: "bad_type", message: "JPEG 사진만 올릴 수 있어요." });

  // 하루 한도 (같은 IP, 앱 전체) — 숫자만 기록
  const guard = await getGuardStore();
  const day = kstDate();
  const kIp = "img:" + day + ":" + ipKey(clientIp(req, context)), kAll = "img:" + day + ":_all";
  const ipN = Number(((await guard.get(kIp)) || {}).n) || 0;
  const allN = Number(((await guard.get(kAll)) || {}).n) || 0;
  if (ipN >= IP_DAILY) return json(429, { error: "img_limit", message: "오늘 올릴 수 있는 사진(" + IP_DAILY + "장)을 다 썼어요. 내일 다시 해 주세요. 지금은 한 칸씩 복사를 써 주세요." });
  if (allN >= ALL_DAILY) return json(429, { error: "img_all_limit", message: "오늘은 사진 올리기가 많아 잠시 멈췄어요. 한 칸씩 복사를 써 주세요." });
  await guard.setJSON(kIp, { n: ipN + 1 });
  await guard.setJSON(kAll, { n: allN + 1 });

  const store = await getImgStore();
  const now = Date.now();
  if (now - lastClean > CLEAN_EVERY) { try { await cleanOld(store, now); } catch (e) { console.warn("[img] 정리 실패", e && e.message); } }
  const id = newId(now);
  await store.set(id, buf);
  return json(200, { ok: true, id, path: "/api/img/" + id + ".jpg", left: Math.max(0, IP_DAILY - ipN - 1) });
}

async function serve(pathname) {
  const m = /^\/api\/img\/([^/]+)\.jpg$/.exec(pathname);
  const id = m && m[1];
  const t = idTime(id);
  const gone = () => new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!Number.isFinite(t)) return gone();
  const store = await getImgStore();
  if (Date.now() - t > KEEP_MS) { try { await store.delete(id); } catch (_) {} return gone(); }
  const buf = await store.get(id);
  if (!buf) return gone();
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(buf.length),
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin"
    }
  });
}

export const config = { path: ["/api/img", "/api/img/*"], method: ["GET", "POST"] };
