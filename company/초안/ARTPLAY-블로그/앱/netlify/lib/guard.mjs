// 아무나 쓰지 못하게 막는 곳: 가게 접속 코드, 하루 한도, 잘못된 코드 잠금
//
// 환경 변수 (Netlify > Project configuration > Environment variables)
//   SHOP_CODES      가게이름:접속코드 를 쉼표로 이어 적기. 예) artplay:바다-1234-소나무
//   DAILY_LIMIT     가게마다 하루에 만들 수 있는 글 수 (기본 20)
//   ALL_DAILY_LIMIT 모든 가게를 합친 하루 최대 글 수 (기본 60, 돈이 새지 않게 하는 마지막 안전줄)
// 기록은 Netlify Blobs(무료 저장소)에 숫자만 남긴다. 사진·글·고객 정보는 저장하지 않는다.

import crypto from "node:crypto";

const FAIL_MAX = 5;               // 이 횟수만큼 틀리면
const FAIL_WINDOW = 15 * 60e3;    // 15분 안에
const LOCK_MS = 15 * 60e3;        // 15분 잠금

let memory = null; // 로컬 시험용 (Blobs를 못 쓸 때)
function memStore() {
  if (!memory) {
    const m = new Map();
    memory = {
      async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); }
    };
  }
  return memory;
}

let storePromise = null;
export function getGuardStore() {
  if (globalThis.__ARTPLAY_TEST_STORE__) return Promise.resolve(globalThis.__ARTPLAY_TEST_STORE__);
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const { getStore } = await import("@netlify/blobs");
        const s = getStore({ name: "artplay-guard", consistency: "strong" });
        return {
          async get(k) { return await s.get(k, { type: "json" }); },
          async setJSON(k, v) { await s.setJSON(k, v); }
        };
      } catch (e) {
        console.warn("[guard] Netlify Blobs를 쓸 수 없어 임시 메모리를 씁니다:", e && e.message);
        return memStore();
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
    const shop = (i > 0 ? t.slice(0, i) : "shop").trim().toLowerCase().replace(/[^a-z0-9가-힣_-]/g, "").slice(0, 30) || "shop";
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
function ipKey(ip) { return "fail:" + hash("artplay|" + (ip || "unknown")).toString("hex").slice(0, 24); }

export function limits() {
  const n = v => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : null; };
  return { daily: n(process.env.DAILY_LIMIT) || 20, all: n(process.env.ALL_DAILY_LIMIT) || 60 };
}

// 코드 확인. 성공하면 {ok:true, shop}, 실패하면 {ok:false, status, error, message}
export async function checkCode(code, ip) {
  const codes = parseCodes(process.env.SHOP_CODES);
  if (!codes.length) return { ok: false, status: 503, error: "no_codes", message: "아직 가게 접속 코드가 설정되지 않았어요. 회사에 알려 주세요. 지금은 [체험해 보기]로 둘러볼 수 있어요." };
  const store = await getGuardStore();
  const key = ipKey(ip);
  const now = Date.now();
  let f = (await store.get(key)) || { n: 0, first: now, until: 0 };
  if (f.until && f.until > now) {
    const min = Math.ceil((f.until - now) / 60e3);
    return { ok: false, status: 423, error: "locked", message: "코드를 여러 번 틀려서 " + min + "분 동안 잠겼어요. 잠시 뒤 다시 해 주세요." };
  }
  const given = String(code || "").trim();
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
export async function usage(shop) {
  const store = await getGuardStore();
  const day = kstDate();
  const u = (await store.get("day:" + day + ":" + shop)) || { posts: 0, photos: 0 };
  const all = (await store.get("day:" + day + ":_all")) || { posts: 0, photos: 0 };
  return { day, u, all };
}

export async function take(shop, kind) {
  const L = limits();
  const cap = kind === "photos" ? L.daily * 4 : L.daily;   // 사진은 한 글에 두 번까지 나눠 보낼 수 있음
  const capAll = kind === "photos" ? L.all * 4 : L.all;
  const store = await getGuardStore();
  const { day, u, all } = await usage(shop);
  if ((u[kind] || 0) >= cap || (all[kind] || 0) >= capAll) {
    return { ok: false, status: 429, error: "daily_limit", message: "오늘 만들 수 있는 글을 다 썼어요 (하루 " + L.daily + "편). 내일 다시 쓸 수 있어요." };
  }
  u[kind] = (u[kind] || 0) + 1; all[kind] = (all[kind] || 0) + 1;
  await store.setJSON("day:" + day + ":" + shop, u);
  await store.setJSON("day:" + day + ":_all", all);
  return { ok: true, left: Math.max(0, L.daily - (u.posts || 0)) };
}

// 글을 하나도 못 받았을 때 되돌려 준다
export async function giveBack(shop, kind) {
  try {
    const store = await getGuardStore();
    const { day, u, all } = await usage(shop);
    if (u[kind] > 0) u[kind] -= 1;
    if (all[kind] > 0) all[kind] -= 1;
    await store.setJSON("day:" + day + ":" + shop, u);
    await store.setJSON("day:" + day + ":_all", all);
  } catch (_) { /* 되돌리기 실패는 무시 */ }
}

export async function postsLeft(shop) {
  const { u } = await usage(shop);
  return Math.max(0, limits().daily - (u.posts || 0));
}
