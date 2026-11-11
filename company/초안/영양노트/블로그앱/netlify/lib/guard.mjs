// 아무나 쓰지 못하게 막는 곳: 접속 코드, 하루 한도, 잘못된 코드 잠금 (다른 사람이 써서 돈이 나가지 않게)
//
// 환경 변수 (Netlify > Project configuration > Environment variables)
//   ACCESS_CODES    이름:접속코드 를 쉼표로 이어 적기. 예) mom:바다-1234-소나무 (이름 없이 코드만 적어도 됨)
//   DAILY_LIMIT     코드마다 하루에 만들 수 있는 글 수 (기본 20)
//   ALL_DAILY_LIMIT 모든 코드를 합친 하루 최대 글 수 (기본 20, 돈이 새지 않게 하는 마지막 안전줄)
// 기록은 Netlify Blobs(무료 저장소)에 숫자만 남긴다. 사진·글은 저장하지 않는다.

import crypto from "node:crypto";

const FAIL_MAX = 5;               // 이 횟수만큼 틀리면
const FAIL_WINDOW = 15 * 60e3;    // 15분 안에
const LOCK_MS = 15 * 60e3;        // 15분 잠금

let memory = null; // 내 컴퓨터 시험(dev-server.mjs)에서만 쓰는 임시 기록. 배포한 곳에서는 절대 쓰지 않는다.
const LOCAL_DEV = process.env.NUTRI_LOCAL_DEV === "1";

export const NO_STORE = { error: "no_store", message: "사용 기록 저장소에 연결하지 못해 잠시 쓸 수 없어요. 회사에 알려 주세요." };
function memStore() {
  if (!memory) {
    const m = new Map();
    memory = {
      async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
      async del(k) { m.delete(k); },
      async count(prefix) { let n = 0; for (const k of m.keys()) if (k.startsWith(prefix)) n++; return n; }
    };
  }
  return memory;
}

let storePromise = null;
export function getGuardStore() {
  if (globalThis.__NUTRI_TEST_STORE__) return Promise.resolve(globalThis.__NUTRI_TEST_STORE__);
  if (!storePromise) {
    if (LOCAL_DEV) { storePromise = Promise.resolve(memStore()); return storePromise; }
    storePromise = (async () => {
      try {
        const { getStore } = await import("@netlify/blobs");
        const s = getStore({ name: "nutri-blog-guard", consistency: "strong" });
        return {
          async get(k) { return await s.get(k, { type: "json" }); },
          async setJSON(k, v) { await s.setJSON(k, v); },
          async del(k) { await s.delete(k); },
          async count(prefix) { const r = await s.list({ prefix }); return (r && r.blobs ? r.blobs.length : 0); }
        };
      } catch (e) {
        // 배포한 곳에서 기록 저장소를 못 쓰면 한도·잠금이 사라지므로 멈춘다 (메모리로 넘어가지 않음)
        console.error("[guard] Netlify Blobs를 쓸 수 없어 멈춥니다:", e && e.message);
        storePromise = null;
        const err = new Error("no_store"); err.code = "no_store"; throw err;
      }
    })();
  }
  return storePromise;
}

export function parseCodes(raw) {
  const out = [];
  String(raw || "").split(/[,\n]/).forEach(part => {
    const t = part.trim(); if (!t) return;
    const i = t.indexOf(":");
    const shop = (i > 0 ? t.slice(0, i) : "me").trim().toLowerCase().replace(/[^a-z0-9가-힣_-]/g, "").slice(0, 30) || "me";
    const code = (i > 0 ? t.slice(i + 1) : t).trim();
    if (code.length >= 6) out.push({ shop, code });
  });
  return out;
}

function hash(s) { return crypto.createHash("sha256").update(String(s)).digest(); }
function sameCode(a, b) { return crypto.timingSafeEqual(hash(a), hash(b)); }

export function kstDate(now = Date.now()) {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
}
function ipKey(ip) { return "fail:" + hash("nutri-blog|" + (ip || "unknown")).toString("hex").slice(0, 24); }

export function limits() {
  const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : null; };
  return { daily: n(process.env.DAILY_LIMIT) || 20, all: n(process.env.ALL_DAILY_LIMIT) || 20 };
}

// 코드 확인. 성공하면 {ok:true, shop}, 실패하면 {ok:false, status, error, message}
export async function checkCode(code, ip) {
  const codes = parseCodes(process.env.ACCESS_CODES);
  if (!codes.length) return { ok: false, status: 503, error: "no_codes", message: "아직 접속 코드가 설정되지 않았어요. 회사에 알려 주세요. 지금은 [체험해 보기]로 둘러볼 수 있어요." };
  const store = await getGuardStore();
  const key = ipKey(ip);
  const now = Date.now();
  let f = (await store.get(key)) || { n: 0, first: now, until: 0 };
  if (f.until && f.until > now) {
    const min = Math.ceil((f.until - now) / 60e3);
    return { ok: false, status: 423, error: "locked", message: "코드를 여러 번 틀려서 " + min + "분 동안 잠겼어요. 잠시 뒤 다시 해 주세요." };
  }
  let given = String(code || "").trim();
  try { given = decodeURIComponent(given); } catch (_) { /* 이미 풀린 값 */ }
  given = given.trim();
  const hit = given && codes.find(c => sameCode(c.code, given));
  if (hit) {
    if (f.n) await store.setJSON(key, { n: 0, first: now, until: 0 });
    return { ok: true, shop: hit.shop };
  }
  if (now - f.first > FAIL_WINDOW) f = { n: 0, first: now, until: 0 };
  f.n += 1;
  if (f.n >= FAIL_MAX) { f.until = now + LOCK_MS; f.n = 0; f.first = now; }
  await store.setJSON(key, f);
  if (f.until) return { ok: false, status: 423, error: "locked", message: "코드를 여러 번 틀려서 15분 동안 잠겼어요. 잠시 뒤 다시 해 주세요." };
  return { ok: false, status: 401, error: "bad_code", message: "접속 코드가 맞지 않아요. 다시 확인해 주세요. (" + (FAIL_MAX - f.n) + "번 더 틀리면 잠시 잠겨요)" };
}

// 하루 사용량. kind: "posts"(글) | "photos"(사진 읽기)
// 동시에 두 요청이 와도 한도를 넘지 않게: 숫자 하나를 고쳐 쓰지 않고, 쓸 때마다 "표 한 장"(따로 된 기록)을 먼저 남긴 뒤
// 표 수를 센다. 한도를 넘었으면 내 표를 지우고 거절한다. (동시에 오면 둘 다 거절될 수는 있어도, 한도를 넘겨 쓰지는 않음)
function prefixFor(day, kind, shop) { return "use:" + day + ":" + kind + ":" + (shop ? shop + ":" : ""); }

export async function take(shop, kind) {
  const L = limits();
  const cap = kind === "photos" ? L.daily * 2 : L.daily;   // 사진 읽기는 글 수의 2배까지
  const capAll = kind === "photos" ? L.all * 2 : L.all;
  const store = await getGuardStore();
  const day = kstDate();
  const ticket = prefixFor(day, kind, shop) + Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
  await store.setJSON(ticket, { t: Date.now() });
  const mine = await store.count(prefixFor(day, kind, shop));
  const all = await store.count(prefixFor(day, kind));
  if (mine > cap) {
    await store.del(ticket);
    return { ok: false, status: 429, error: "daily_limit", message: "오늘 만들 수 있는 글을 다 썼어요 (하루 " + L.daily + "편). 내일 다시 쓸 수 있어요." };
  }
  if (all > capAll) {
    await store.del(ticket);
    return { ok: false, status: 429, error: "all_limit", message: "오늘은 앱 전체 사용량이 많아 잠시 멈췄어요. 내일 다시 쓸 수 있어요. 급하면 회사에 알려 주세요." };
  }
  const posts = kind === "posts" ? mine : await store.count(prefixFor(day, "posts", shop));
  return { ok: true, left: Math.max(0, L.daily - posts), ticket };
}

// AI가 처음부터 거절해 돈이 나가지 않았을 때 표를 돌려준다
export async function giveBack(shop, kind, ticket) {
  try { if (ticket) { const store = await getGuardStore(); await store.del(ticket); } }
  catch (_) { /* 되돌리기 실패는 무시 */ }
}

export async function postsLeft(shop) {
  const store = await getGuardStore();
  return Math.max(0, limits().daily - await store.count(prefixFor(kstDate(), "posts", shop)));
}
