/* ARTPLAY 블로그 글쓰기 — 독립판 화면 코드
   흐름: 접속 코드(또는 체험) → 사진·고르기 → [글 만들기] → ① 사진 읽기 /api/photos → ② 글쓰기 /api/write(흘려 받기) → 결과
   글 규칙은 서버의 netlify/lib/prompt.mjs 한 곳에 있어요. 여기에는 화면과 마지막 안전 점검만 있어요. */
(function () {
"use strict";
const APP_VERSION = "1.5.0 (2026-11-11, 사장님 AI 열쇠를 설정에 넣어 쓰기)";
// 마우스가 있는 컴퓨터인지 (컴퓨터에서만 [그림과 글 함께 복사]가 보여요. 휴대폰은 그대로)
const IS_PC = (() => { try { return matchMedia("(pointer: fine) and (hover: hover)").matches; } catch (_) { return false; } })();
const $ = s => document.querySelector(s);
const K = { code: "artplay-code", mode: "artplay-mode", hist: "artplay-history-v1", set: "artplay-settings-v1", paste: "artplay-paste", key: "artplay-ai-key" };
// 붙여 넣는 방식 기본값: "marks" = (나) 📷 사진 자리 표시 넣기, "bundle" = (가) 사진 한 묶음 + 글
// 회장님 최종 답("사진 쉽게")이 오면 여기 한 줄만 바꾼다.
const DEFAULT_PASTE = "marks";
const SIDES = [
  { key: "before", label: "전", max: 6 },
  { key: "during", label: "공사 중", max: 3 },
  { key: "after", label: "후", max: 6 }
];
const MAX_EDGE = 1280, JPEG_Q = 0.82, BODY_BUDGET = 4.2e6; // 한 번에 보내는 base64 글자 수 상한 (Netlify 요청 6MB 안쪽)

// 고르기 버튼 (값 v는 서버로 가는 값, t는 화면 글자)
const GROUPS = {
  type: { multi: false, keep: true, items: [{ v: "home", t: "집" }, { v: "shop", t: "상점" }] },
  space: { multi: true, items: [] },
  size: { multi: false, items: [] },
  consent: { multi: false, keep: true, items: [{ v: "photo", t: "사진만" }, { v: "region", t: "지역까지" }, { v: "none", t: "동의 안 받음" }] },
  period: { multi: false, items: ["1주 안", "2~3주", "4~6주", "그 이상"] },
  perk: { multi: false, keep: true, items: [{ v: "none", t: "없음" }, { v: "sponsor", t: "자재 협찬" }, { v: "discount", t: "할인·무료 시공" }] },
  kind: { multi: false, keep: true, items: [{ v: "review", t: "시공 후기" }, { v: "compare", t: "전후 비교" }, { v: "tip", t: "공간 팁" }] },
  work: { multi: true, items: [] },
  live: { multi: false, items: [] },
  nameok: { multi: false, keep: true, items: [{ v: "no", t: "동의 안 받음" }, { v: "yes", t: "사장님이 동의함" }] }
};
// 집/상점에 따라 바뀌는 버튼
const SETS = {
  home: {
    space: ["현관", "거실", "주방", "침실", "욕실", "전체", "기타"],
    size: ["10평 이하", "10평대", "20평대", "30평대", "40평 이상", "모름"],
    work: ["전체 리모델링", "부분 공사", "가구 제작", "조명", "도배·도장", "타일", "욕실 공사"],
    live: [{ v: "yes", t: "예" }, { v: "no", t: "아니오" }]
  },
  shop: {
    space: ["카페", "음식점", "매장(옷·소품)", "사무실", "병원·의원", "미용실·네일", "학원", "기타"],
    size: ["10평 이하", "10~20평", "20~40평", "40평 이상", "모름"],
    work: ["전체 시공", "부분 공사", "간판", "조명·전기", "주방 설비", "가구 제작", "도장·벽면"],
    live: [{ v: "yes", t: "영업하면서" }, { v: "no", t: "문 닫고" }, { v: "night", t: "야간 공사" }]
  }
};
const TYPE_TEXT = {
  home: { space: "공간", live: "살면서 공사했나요?", quote: "고객이 실제로 한 말 한 줄", memo: "예: 상부장 답답하다고 하심. 화이트오크 하부장, 세라믹 상판. 방수 두 번 함", etc: "예: 다용도실, 드레스룸" },
  shop: { space: "업종", live: "영업하면서 공사했나요?", quote: "사장님이 실제로 한 말 한 줄", memo: "예: 우드·라탄 동네 카페 콘셉트. 좌석 24석. 야간 공사로 오픈 날짜 맞춤. 전기 증설", etc: "예: 꽃집, 공방" }
};
const DEFAULTS = { perk: "none", kind: "review", nameok: "no" }; // 게시 동의는 기본값 없이 꼭 고르게
const CONSENT_HELP = {
  photo: "사진만: 지역 이름 없이 써요.",
  region: "지역까지: 구·동 이름까지 써요. 동·호수와 단지명은 어떤 경우에도 안 써요.",
  none: "동의를 받지 않았으면 글을 만들지 않아요."
};
// 마지막 안전 점검 (AI가 실수로 넣었을 때 알려 주기). 규칙 원본은 netlify/lib/prompt.mjs
const BANNED = ["최고", "최상", "최초", "1위", "No.1", "넘버원", "유일", "독보적", "업계 최다", "최저가", "가장 싼", "최소가", "무조건", "100%", "완벽", "절대", "평생", "하자 제로", "선착순", "이번 달만", "마감 임박", "퀄리티", "소정의", "체험단"];

const sel = {}; Object.keys(GROUPS).forEach(g => { sel[g] = new Set(DEFAULTS[g] ? [DEFAULTS[g]] : []); });
const one = g => [...sel[g]][0] || "";
const photos = { before: [], during: [], after: [] };
let mode = null, code = "", current = null, busy = false, shrinking = 0, pid = 0, descCache = null, left = null, wake = null;

/* ---------- 저장소 ---------- */
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
// 사장님 AI 열쇠 (이 브라우저 localStorage에만. 설정 JSON과 따로 둔다)
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{10,300}$/;
function aiKey() { const k = String(ls.get(K.key, "") || "").trim(); return KEY_RE.test(k) ? k : ""; }
const NO_KEY_ERR = { error: "no_key", message: "설정에서 AI 열쇠를 넣어 주세요. 그동안은 [체험 모드로 둘러보기]로 예시 글을 볼 수 있어요." };
function settings() { try { return JSON.parse(ls.get(K.set, "{}")) || {}; } catch (_) { return {}; } }

/* ---------- 고르기 버튼 ---------- */
const val = it => typeof it === "string" ? it : it.v;
const txt = it => typeof it === "string" ? it : it.t;
function buildChips(box) {
  const g = box.dataset.g, G = GROUPS[g];
  const T = one("type");
  const items = (SETS[T] && SETS[T][g]) || G.items;
  box.textContent = "";
  items.forEach(it => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = txt(it); b.dataset.v = val(it);
    b.addEventListener("click", () => {
      const v = val(it);
      if (G.multi) { sel[g].has(v) ? sel[g].delete(v) : sel[g].add(v); }
      else if (sel[g].has(v) && !G.keep) sel[g].clear();
      else { sel[g].clear(); sel[g].add(v); }
      if (g === "type") setType();
      paintChips(); onChoice();
    });
    box.appendChild(b);
  });
}
// 집/상점을 바꾸면 공간·평수·공사·영업 버튼을 새로 만든다
function setType() {
  const T = one("type");
  ["space", "size", "work", "live"].forEach(g => { sel[g].clear(); const box = document.querySelector('.chips[data-g="' + g + '"]'); if (box) buildChips(box); });
  const X = TYPE_TEXT[T] || TYPE_TEXT.home;
  $("#typeDeps").hidden = !T; $("#typeHint").hidden = !!T;
  $("#spaceLbl").textContent = X.space; $("#spaceWarn").textContent = X.space + "을 하나 골라 주세요.";
  $("#liveLbl").textContent = X.live; $("#quoteLbl").textContent = X.quote;
  $("#memo").placeholder = X.memo; $("#spaceEtc").placeholder = X.etc;
  $("#shopOnly").hidden = T !== "shop";
  $("#region").placeholder = T === "shop" ? "지역 (예: 수원 영통) — 번지·건물·층은 빼고" : "지역 (예: 수원 영통) — 동·호수, 단지명은 빼고";
  if (T) { $("#gType").classList.remove("warn"); $("#typeWarn").hidden = true; }
}
function paintChips() {
  document.querySelectorAll(".chips").forEach(box => {
    const g = box.dataset.g;
    box.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", sel[g].has(c.dataset.v) ? "true" : "false"));
  });
}
function onChoice() {
  $("#spaceEtc").hidden = !sel.space.has("기타");
  $("#region").hidden = one("consent") !== "region";
  $("#shopName").hidden = one("nameok") !== "yes";
  $("#consentHelp").textContent = CONSENT_HELP[one("consent")] || "";
  if (sel.space.size) { $("#gSpace").classList.remove("warn"); $("#spaceWarn").hidden = true; }
  if (sel.size.size) { $("#gSize").classList.remove("warn"); $("#sizeWarn").hidden = true; }
  if (sel.consent.size) { $("#gConsent").classList.remove("warn"); $("#consentWarn").hidden = true; }
  $("#beforeWarn").hidden = !(one("kind") === "compare" && photos.before.length === 0);
}

/* ---------- 사진 ---------- */
function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const i = new Image();
    i.onload = () => res(i); i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; i.src = u;
  });
}
async function shrink(file, edge, q) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch (_) { src = await loadImg(file); w = src.naturalWidth; h = src.naturalHeight; }
  const s = Math.min(1, edge / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) try { src.close(); } catch (_) {}
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("blob")), "image/jpeg", q));
}
function b64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); });
}
function msg(t) { const m = $("#photoMsg"); m.textContent = t || ""; m.hidden = !t; }
async function addFiles(side, max, files, addBtn) {
  const list = photos[side]; const arr = Array.from(files || []);
  const room = max - list.length; let failed = 0; const added = [];
  shrinking++; renderPhotos(); refreshGen();
  addBtn.classList.add("busy"); addBtn.firstChild.textContent = "줄이는 중";
  try {
    for (const f of arr.slice(0, Math.max(0, room))) {
      try {
        let blob = await shrink(f, MAX_EDGE, JPEG_Q);
        if (blob.size > 420e3) blob = await shrink(f, MAX_EDGE, 0.7);
        if (blob.size > 420e3) blob = await shrink(f, 1024, 0.7);
        list.push({ id: ++pid, blob, file: f, url: URL.createObjectURL(blob) }); added.push(f);
      } catch (_) { failed++; }
    }
  } finally { shrinking--; }
  const t = [];
  if (arr.length > room) t.push("사진은 전·후 각 6장, 공사 중 3장까지 넣을 수 있어요.");
  if (failed) t.push(failed + "장은 열 수 없었어요. 다른 사진을 골라 주세요.");
  descCache = null; renderPhotos(); msg(t.join(" ")); refreshGen();
  return added; // 실제로 줄에 들어간 파일 (폴더 가져오기가 '넣은 사진 목록'에 적는다)
}
function allPhotos() {
  const out = [];
  SIDES.forEach(S => photos[S.key].forEach(p => out.push({ ...p, side: S.label })));
  return out;
}
function renderPhotos() {
  let n = 0;
  SIDES.forEach(S => {
    const strip = $("#strip-" + S.key); strip.textContent = "";
    photos[S.key].forEach((p, i) => {
      n++;
      const d = document.createElement("div"); d.className = "ph";
      const im = document.createElement("img"); im.src = p.url; im.alt = S.label + " 사진";
      const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "사진 " + n + " 빼기");
      x.disabled = shrinking > 0 || busy;
      const xs = document.createElement("span"); xs.textContent = "×"; x.appendChild(xs);
      x.addEventListener("click", () => { URL.revokeObjectURL(p.url); photos[S.key].splice(i, 1); descCache = null; msg(""); renderPhotos(); onChoice(); });
      const num = document.createElement("div"); num.className = "num"; num.textContent = "사진 " + n;
      d.append(im, x, num); strip.appendChild(d);
    });
    if (photos[S.key].length < S.max) {
      const a = document.createElement("label"); a.className = "add"; a.setAttribute("aria-label", S.label + " 사진 넣기");
      a.appendChild(document.createTextNode("+"));
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      const off = shrinking > 0 || busy; inp.disabled = off; a.classList.toggle("off", off);
      inp.addEventListener("change", () => { addFiles(S.key, S.max, inp.files, a); });
      a.appendChild(inp); strip.appendChild(a);
    }
  });
  if (FLD_OK && !$("#fldBox").hidden) fldPaint();
  onChoice();
}

// 노트북: 폴더의 사진을 전·공사 중·후 줄에 끌어다 놓기. 놓으면 [+]와 같은 addFiles를 쓴다. 이미지 아닌 파일은 무시.
function hasFiles(e) { const t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.from(t).indexOf("Files") >= 0; }
function setupDrop() {
  SIDES.forEach(S => {
    const row = $("#strip-" + S.key).closest(".prow"); let depth = 0;
    const off = () => { depth = 0; row.classList.remove("drop"); };
    row.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; row.classList.add("drop"); });
    row.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = (shrinking > 0 || busy) ? "none" : "copy"; });
    row.addEventListener("dragleave", () => { if (--depth <= 0) off(); });
    row.addEventListener("drop", e => {
      if (!hasFiles(e)) return; e.preventDefault(); off();
      if (shrinking > 0 || busy) { msg(shrinking > 0 ? "지금은 사진을 줄이는 중이에요. 잠시 뒤 다시 놓아 주세요." : "지금은 글을 만드는 중이에요. 끝난 뒤 다시 놓아 주세요."); return; }
      const all = Array.from(e.dataTransfer.files || []);
      const imgs = all.filter(f => /^image\//.test(f.type) || (!f.type && /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name)));
      if (!imgs.length) { msg("사진 파일만 넣을 수 있어요."); return; }
      const a = row.querySelector("label.add");
      if (!a) { msg(S.label + " 사진은 " + S.max + "장까지 넣을 수 있어요."); return; }
      addFiles(S.key, S.max, imgs, a);
    });
  });
  // 줄 밖에 잘못 놓아도 브라우저가 사진을 열어 버려 쓰던 내용이 사라지지 않게
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", e => { if (hasFiles(e)) e.preventDefault(); });
  if (IS_PC) $("#pcDropHint").hidden = false;
}

/* ---------- 노트북: 사진 폴더 연결 (크롬·엣지만) ----------
   폴더를 한 번 고르면 그 손잡이(handle)를 이 노트북 IndexedDB에 둔다. 다음부터 [폴더에서 새 사진 가져오기] 한 번.
   실제로 줄에 넣은 파일 목록(경로|크기|수정 시각, 최근 FLD_SEEN_MAX개)을 IndexedDB "seen"에 두고, 목록에 없는 사진만 보여 준다.
   (체크를 끈 사진·자리가 넘쳐 빠진 사진·열지 못한 사진은 목록에 안 들어가 다음에 다시 나온다) [전체 다시 보기]는 목록을 무시한다.
   고른 사진은 [+]와 같은 addFiles로 줄여 넣는다.
   전·공사 중·후 나누기는 '제안': ① 접속 코드로 쓸 때는 작게 줄인 사진(512px)을 /api/photos에 보내 AI가 kind로 나눔(저장 안 함, 30장까지)
   ② 체험·열쇠 없음·실패면 파일 시각 순 간격으로 나눔(fldByTime). 사진마다 [전][공사 중][후]로 바꾼다.
   사파리·파이어폭스·휴대폰은 버튼을 숨긴다. */
const FLD_OK = IS_PC && typeof window.showDirectoryPicker === "function" && window.isSecureContext !== false;
const FLD_EXT = /\.(jpe?g|png|heic|heif|webp)$/i, FLD_MAX = 400, FLD_SEEN_MAX = 2000;
const FLD_AI_MAX = 30, FLD_GAP = 6 * 3600e3; // AI로 보는 최대 장수(묶고 추린 대표 사진), 다른 날 묶음으로 보는 간격(6시간)
let fldDir = null, fldSeen = [], fldItems = [], fldUrls = [], fldBusy = false, fldHow = "time";
const fldKey = (path, f) => path + "|" + f.size + "|" + f.lastModified;
function idb(op, key, val) {
  return new Promise((res, rej) => {
    let rq; try { rq = indexedDB.open("artplay-folder", 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => {
      const db = rq.result; let r;
      try { const st = db.transaction("kv", op === "get" ? "readonly" : "readwrite").objectStore("kv"); r = op === "get" ? st.get(key) : st.put(val, key); }
      catch (e) { db.close(); rej(e); return; }
      r.onsuccess = () => { res(r.result); db.close(); }; r.onerror = () => { rej(r.error); db.close(); };
    };
  });
}
async function idbGet(k) { try { return await idb("get", k); } catch (_) { return undefined; } }
async function idbSet(k, v) { try { await idb("put", k, v); } catch (_) {} }
function fldInfo(t) { $("#fldInfo").textContent = t || ""; }
function fldPaint() {
  $("#fldGet").textContent = fldDir ? "폴더에서 새 사진 가져오기" : "사진 폴더 연결하기";
  $("#fldPick").hidden = !fldDir; $("#fldAll").hidden = !fldDir;
  $("#fldAiNote").hidden = !(mode === "live" && code && aiKey());
  const off = shrinking > 0 || busy || fldBusy; $("#fldGet").disabled = off; $("#fldPick").disabled = off; $("#fldAll").disabled = off;
  if (!$("#fldInfo").textContent) fldInfo(fldDir ? "연결된 폴더: " + fldDir.name + (fldSeen.length ? " · 아직 넣지 않은 사진만 보여요." : "")
    : "현장 사진을 모아 두는 폴더를 한 번 정해 두면, 다음부터 새 사진만 골라 가져와요.");
}
async function fldChoose() {
  try { fldDir = await window.showDirectoryPicker({ id: "artplay-photos", mode: "read" }); }
  catch (e) { if (e && e.name !== "AbortError") fldInfo("폴더를 열 수 없었어요. 다른 폴더를 골라 주세요."); return false; }
  fldSeen = []; await idbSet("dir", fldDir); await idbSet("seen", []); fldInfo(""); fldPaint(); return true;
}
async function fldAllowed() {
  const o = { mode: "read" };
  try {
    if (!fldDir.queryPermission || (await fldDir.queryPermission(o)) === "granted") return true;
    return (await fldDir.requestPermission(o)) === "granted";
  } catch (_) { return false; }
}
async function fldScan(all) {
  const out = [], seen = new Set(all ? [] : fldSeen);
  const walk = async (dir, path, depth) => {
    for await (const h of dir.values()) {
      if (h.kind === "file" && FLD_EXT.test(h.name)) {
        try { const f = await h.getFile(), p = path + h.name; if (!seen.has(fldKey(p, f))) out.push({ f, path: p }); } catch (_) {}
      } else if (h.kind === "directory" && depth < 1 && !h.name.startsWith(".")) await walk(h, path + h.name + "/", depth + 1);
    }
  };
  await walk(fldDir, "", 0);
  out.sort((a, b) => a.f.lastModified - b.f.lastModified);
  return out;
}
// 파일 시각으로 나누기: 6시간 넘게 떨어지면 다른 묶음. 묶음이 3개 이상이면 첫 묶음 전, 끝 묶음 후, 가운데 공사 중.
// 묶음이 1~2개면 가장 긴 간격(보통 공사 기간)을 기준으로 앞 = 전, 뒤 = 후. (규칙을 바꾸려면 이 함수만 고친다)
function fldByTime(list) {
  const n = list.length, t = list.map(x => x.f.lastModified); if (!n) return [];
  const groups = [0]; for (let i = 1; i < n; i++) groups.push(groups[i - 1] + (t[i] - t[i - 1] > FLD_GAP ? 1 : 0));
  const last = groups[n - 1];
  if (last >= 2) return groups.map(g => g === 0 ? "before" : g === last ? "after" : "during");
  if (n === 1) return ["before"];
  let k = 0; for (let i = 1; i < n; i++) if (t[i] - t[i - 1] > t[k + 1] - t[k]) k = i - 1;
  return list.map((_, i) => i <= k ? "before" : "after");
}
const FLD_KIND = { "전": "before", "공사 중": "during", "후": "after" };
/* ---------- 폴더 골라내기 (1.5.0, 회장님 지시: 비슷한 사진 수십 장·안 넣어도 될 사진) ----------
   모든 결과는 '제안'이고, 사장님이 체크로 넣고 뺀다.
   ① 비슷한 사진 묶기: 사진을 64px로 줄여 dHash(차이 해시 64칸)를 만들고, 다른 칸이 FLD_HASH_DIST 이하 + 6시간 안 + 같은 단계면 한 묶음.
      묶음마다 선명도 점수(128px 라플라시안 분산 × 밝기 보정 — 흔들림·어두움은 낮게)가 가장 높은 1장만 체크.
   ② 흐린 사진: 점수가 전체 가운데값의 FLD_BLUR배보다 낮으면 체크하지 않음.
   ③ 그래도 줄의 남은 자리보다 많으면 추리기:
      AI 열쇠가 있으면 /api/photos 응답의 use(쓸만함 1~5)·shot(전체/가까이)·room(공간)으로 공간마다 전체 컷 + 가까운 컷을 고루.
      열쇠가 없으면 시간 순으로 자리 수만큼 나눈 구간마다 가장 선명한 1장 (시간이 고루 퍼지게).
   ④ AI가 얼굴·번호판·주소 등을 본 사진은 '확인 필요'로 표시하고 자동 체크하지 않음.
   사진 수백 장도 화면이 멈추지 않게 몇 장마다 쉬어 가며 진행 표시를 한다. */
const FLD_HASH_DIST = 10, FLD_BLUR = 0.35;
const fldTick = () => new Promise(r => setTimeout(r, 0));
let fldGroups = [], fldSum = "";
const fldCv = document.createElement("canvas");
const fldCtx = fldCv.getContext("2d", { willReadFrequently: true });
function fldGray(w, h) {
  const d = fldCtx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return g;
}
// 사진 한 장 살펴보기 → { hash: 64칸(0/1) 또는 null, score: 선명도 또는 null }
async function fldLook(f) {
  if (/\.(heic|heif)$/i.test(f.name)) return { hash: null, score: null };
  let bmp;
  try { bmp = await createImageBitmap(f, { resizeWidth: 128, resizeQuality: "low", imageOrientation: "from-image" }); }
  catch (_) { return { hash: null, score: null }; }
  try {
    // 선명도: 128px 회색에서 라플라시안 분산, 너무 어둡거나 하얗게 날아가면 낮춤
    const w = bmp.width, h = Math.max(3, Math.min(256, bmp.height));
    fldCv.width = w; fldCv.height = h; fldCtx.drawImage(bmp, 0, 0, w, h);
    const g = fldGray(w, h); let sum = 0, sq = 0, n = 0, mean = 0;
    for (let i = 0; i < g.length; i++) mean += g[i];
    mean /= g.length;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v; sq += v * v; n++;
    }
    const lap = n ? sq / n - (sum / n) * (sum / n) : 0;
    const light = mean < 45 ? Math.max(0.1, mean / 45) : mean > 230 ? Math.max(0.1, (255 - mean) / 25) : 1;
    // dHash: 64px로 줄인 뒤 9×8로 더 줄여 옆 칸보다 밝은지
    fldCv.width = 64; fldCv.height = 64; fldCtx.drawImage(bmp, 0, 0, 64, 64);
    fldCtx.drawImage(fldCv, 0, 0, 64, 64, 0, 0, 9, 8);
    const s = fldGray(9, 8), hash = new Uint8Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash[y * 8 + x] = s[y * 9 + x] > s[y * 9 + x + 1] ? 1 : 0;
    return { hash, score: lap * light };
  } catch (_) { return { hash: null, score: null }; }
  finally { try { bmp.close(); } catch (_) {} }
}
function fldHam(a, b) { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; }
// 비슷한 사진 묶기 (items는 시간 순). 묶음 = { items, rep(고른 1장), open }
function fldGroup(items) {
  let groups = [];
  items.forEach(it => {
    // 닮은 사진이 있는 묶음을 모두 찾아 하나로 합친다 (A~B, B~C면 A·B·C 한 묶음)
    const hit = !it.hash ? [] : groups.filter(C => C.side === it.side &&
      C.items.some(m => m.hash && Math.abs(m.f.lastModified - it.f.lastModified) <= FLD_GAP && fldHam(m.hash, it.hash) <= FLD_HASH_DIST));
    let G = hit[0];
    if (!G) { G = { items: [], side: it.side, open: false }; groups.push(G); }
    for (const C of hit.slice(1)) { G.items.push(...C.items); groups = groups.filter(x => x !== C); }
    G.items.push(it);
  });
  groups.forEach(G => { G.items.sort((a, b) => a.f.lastModified - b.f.lastModified); G.items.forEach(m => { m.g = G; }); });
  const sc = x => x.score == null ? -1 : x.score;
  groups.forEach(G => { G.rep = G.items.reduce((a, b) => sc(b) > sc(a) ? b : a, G.items[0]); });
  return groups;
}
// 시간이 고루 퍼지게: 시간 순으로 k구간 나눠 구간마다 가장 선명한 1장
function fldSpread(pool, k) {
  const L = pool.slice().sort((a, b) => a.f.lastModified - b.f.lastModified), out = [];
  if (k <= 0) return out;
  const sc = x => x.score == null ? -1 : x.score;
  for (let b = 0; b < k; b++) {
    const part = L.slice(Math.floor(b * L.length / k), Math.floor((b + 1) * L.length / k));
    if (part.length) out.push(part.reduce((a, c) => sc(c) > sc(a) ? c : a, part[0]));
  }
  return out;
}
// AI 점수로 추리기: 공간마다 전체 컷 → 가까운 컷 → 남은 자리는 공간을 돌아가며 쓸만함 높은 순
function fldPickAI(pool, k) {
  const sc = x => x.score == null ? -1 : x.score;
  const cmp = (a, b) => ((b.use || 0) - (a.use || 0)) || (sc(b) - sc(a));
  const rooms = new Map();
  pool.forEach(r => { const key = r.room || "?"; if (!rooms.has(key)) rooms.set(key, []); rooms.get(key).push(r); });
  const lists = [...rooms.values()].map(a => a.sort(cmp)).sort((a, b) => cmp(a[0], b[0]));
  const out = [], used = new Set();
  const take = r => { if (r && !used.has(r) && out.length < k) { used.add(r); out.push(r); } };
  for (const shot of ["전체", "가까이"]) for (const L of lists) take(L.find(r => r.shot === shot && !used.has(r)));
  let more = true;
  while (out.length < k && more) { more = false; for (const L of lists) { const r = L.find(x => !used.has(x)); if (r) { take(r); more = true; } } }
  return out;
}
// AI로 나누기·점수: 성공하면 [{side, use, shot, room, privacy} 또는 null...], 안 되면 null
async function fldByAI(list) {
  if (mode !== "live" || !code || !aiKey() || !list.length || list.length > FLD_AI_MAX) return null;
  const small = [];
  for (let i = 0; i < list.length; i++) {
    fldInfo("AI에게 보낼 사진 줄이는 중… " + (i + 1) + "/" + list.length);
    try { small.push(await b64(await shrink(list[i].f, 512, 0.6))); } catch (_) { small.push(null); }
  }
  const idx = small.map((d, i) => d ? i : -1).filter(i => i >= 0); if (!idx.length) return null;
  const packs = []; for (let i = 0; i < idx.length; i += 15) packs.push(idx.slice(i, i + 15));
  let type = "home"; try { type = fields().type === "shop" ? "shop" : "home"; } catch (_) {}
  const out = list.map(() => null); let ok = false;
  fldInfo("AI가 전·공사 중·후를 나누고 쓸 만한 사진을 보는 중… (10~20초)");
  for (const pk of packs) {
    try {
      const res = await api("/api/photos", { type, photos: pk.map(i => ({ side: "모름", data: small[i] })) });
      if (!res.ok) { const e = await readErr(res); if (["daily_limit", "all_limit", "no_key", "bad_code", "locked", "no_codes", "key_bad", "billing", "no_store"].includes(e.error)) break; continue; }
      const d = await res.json();
      (d.photos || []).forEach((x, k) => {
        if (!x || pk[k] == null) return;
        out[pk[k]] = { side: FLD_KIND[x.kind] || null, use: Number(x.use) || 0, shot: x.shot || "", room: x.room || "", privacy: Array.isArray(x.privacy) ? x.privacy : [] };
        ok = true;
      });
    } catch (_) {}
  }
  return ok ? out : null;
}
function fldRelease() { fldUrls.forEach(u => URL.revokeObjectURL(u)); fldUrls = []; }
function fldRow(it, member) {
  const row = document.createElement("label"); row.className = "frow" + (it.on ? "" : " offrow") + (member ? " fmem" : "");
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = it.on;
  cb.addEventListener("change", () => { it.on = cb.checked; row.classList.toggle("offrow", !it.on); fldCount(); });
  let th;
  if (/\.(heic|heif)$/i.test(it.f.name)) { th = document.createElement("div"); th.className = "noimg"; th.textContent = "HEIC"; }
  else { th = document.createElement("img"); const u = URL.createObjectURL(it.f); fldUrls.push(u); th.src = u; th.alt = ""; th.loading = "lazy"; }
  const meta = document.createElement("div"); meta.className = "fmeta";
  const b = document.createElement("b"); b.textContent = it.path;
  const sp = document.createElement("span"); sp.className = "small"; sp.textContent = new Date(it.f.lastModified).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  meta.append(b, sp);
  if (it.privacy && it.privacy.length) { const w = document.createElement("span"); w.className = "fwarn"; w.textContent = "확인 필요: " + it.privacy.join("·") + " — 올리기 전에 가리거나 빼 주세요"; meta.appendChild(w); }
  else if (it.why) { const w = document.createElement("span"); w.className = "fwhy small"; w.textContent = it.why; meta.appendChild(w); }
  const sw = document.createElement("div"); sw.className = "fside"; sw.setAttribute("role", "group"); sw.setAttribute("aria-label", it.path + " 넣을 줄");
  SIDES.forEach(S => {
    const bt = document.createElement("button"); bt.type = "button"; bt.className = "chip"; bt.textContent = S.label; bt.dataset.side = S.key;
    bt.setAttribute("aria-pressed", String(it.side === S.key));
    bt.addEventListener("click", e => { e.preventDefault(); it.side = S.key; sw.querySelectorAll("button").forEach(z => z.setAttribute("aria-pressed", String(z.dataset.side === S.key))); fldCount(); });
    sw.appendChild(bt);
  });
  meta.appendChild(sw);
  row.append(cb, th, meta);
  return row;
}
function fldRender() {
  const box = $("#fldList"); box.textContent = ""; fldRelease();
  $("#fldSum").textContent = fldSum; $("#fldSum").hidden = !fldSum;
  fldGroups.forEach(G => {
    box.appendChild(fldRow(G.rep, false));
    const rest = G.items.filter(x => x !== G.rep);
    if (!rest.length) return;
    const line = document.createElement("div"); line.className = "fgrp";
    const t = document.createElement("span"); t.className = "small";
    t.textContent = G.rep.on ? "비슷한 사진 " + G.items.length + "장 중 1장 골랐어요" : "비슷한 사진 " + G.items.length + "장 묶음";
    const bt = document.createElement("button"); bt.type = "button"; bt.className = "ghost"; bt.setAttribute("aria-expanded", String(G.open));
    bt.textContent = G.open ? "접기" : "펼쳐 보기";
    const wrap = document.createElement("div"); wrap.className = "fmembers"; wrap.hidden = !G.open;
    const fill = () => { if (!wrap.childNodes.length) rest.forEach(m => wrap.appendChild(fldRow(m, true))); };
    if (G.open) fill();
    bt.addEventListener("click", () => { G.open = !G.open; if (G.open) fill(); wrap.hidden = !G.open; bt.textContent = G.open ? "접기" : "펼쳐 보기"; bt.setAttribute("aria-expanded", String(G.open)); });
    line.append(t, bt); box.append(line, wrap);
  });
  fldCount();
}
function fldCount() {
  const on = fldItems.filter(x => x.on);
  const c = {}; SIDES.forEach(S => { c[S.key] = on.filter(x => x.side === S.key).length; });
  const over = SIDES.filter(S => c[S.key] > S.max - photos[S.key].length).map(S => S.label + " " + (S.max - photos[S.key].length) + "장");
  $("#fldPut").disabled = !on.length;
  $("#fldPut").textContent = on.length ? "고른 사진 " + on.length + "장 넣기 (" + SIDES.map(S => S.label + " " + c[S.key]).join(" · ") + ")" : "넣을 사진을 골라 주세요";
  $("#fldHow").textContent = fldHow === "ai" ? "AI가 나눴어요 — 틀린 것만 눌러 바꿔 주세요" : "파일 날짜로 나눴어요 — 카톡·MYBOX에서 받은 사진은 날짜가 틀릴 수 있어요. 틀린 것만 바꿔 주세요";
  $("#fldHead").textContent = over.length ? "남은 자리: " + over.join(", ") + ". 넘치는 사진은 빠져요." : "";
}
// 살펴보기 → 묶기 → (AI) → 추리기. 체크(on)와 이유(why)를 정한다.
async function fldCurate(list) {
  const byTime = fldByTime(list);
  const items = list.map((x, i) => ({ ...x, side: byTime[i], on: false, hash: null, score: null, why: "", privacy: [], blur: false }));
  for (let i = 0; i < items.length; i++) {
    if (i % 4 === 0) { fldInfo("사진 살펴보는 중… " + i + "/" + items.length + " (비슷한 사진·흐린 사진 찾기)"); await fldTick(); }
    Object.assign(items[i], await fldLook(items[i].f));
  }
  const groups = fldGroup(items);
  const reps = groups.map(G => G.rep);
  const scores = reps.map(r => r.score).filter(v => v != null).sort((a, b) => a - b);
  const med = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
  reps.forEach(r => { if (r.score != null && med > 0 && r.score < FLD_BLUR * med) { r.blur = true; r.why = "흐리거나 어두워 보여서 뺐어요"; } });
  // AI: 흐리지 않은 대표 사진만, 많으면 시간이 고루 퍼지게 FLD_AI_MAX장까지
  let aiUsed = false;
  if (mode === "live" && code && aiKey()) {
    const cand = reps.filter(r => !r.blur);
    const send = cand.length > FLD_AI_MAX ? fldSpread(cand, FLD_AI_MAX) : cand;
    const info = await fldByAI(send);
    if (info) {
      aiUsed = true;
      send.forEach((r, k) => {
        const x = info[k]; if (!x) return;
        if (x.side) r.g.items.forEach(m => { m.side = x.side; });   // 같은 묶음은 같은 단계
        r.use = x.use; r.shot = x.shot; r.room = x.room; r.privacy = x.privacy;
      });
    }
  }
  reps.forEach(r => { if (r.privacy && r.privacy.length) r.why = ""; });
  SIDES.forEach(S => {
    const room = Math.max(0, S.max - photos[S.key].length);
    const pool = reps.filter(r => r.side === S.key && !r.blur && !(r.privacy && r.privacy.length));
    const pick = pool.length <= room ? pool : (aiUsed ? fldPickAI(pool, room) : fldSpread(pool, room));
    pick.forEach(r => { r.on = true; });
    pool.forEach(r => { if (!r.on) r.why = room ? "자리(" + S.label + " " + room + "장)보다 많아 뺐어요" : S.label + " 줄에 자리가 없어요"; });
  });
  const on = items.filter(x => x.on).length;
  const sim = items.length - groups.length, blur = reps.filter(r => r.blur).length, priv = reps.filter(r => r.privacy && r.privacy.length).length;
  const why = []; if (sim) why.push("비슷한 사진"); if (blur) why.push("흐린 사진");
  fldSum = items.length > on
    ? items.length + "장 중 " + (why.length ? why.join("·") + "을 빼고 " : "") + on + "장을 골랐어요 — 바꾸려면 체크를 눌러 주세요" + (priv ? " (확인 필요 " + priv + "장은 넣지 않았어요)" : "")
    : "";
  fldGroups = groups; fldItems = items;
  return aiUsed;
}
async function fldOpen(all) {
  all = all === true;
  if (shrinking > 0 || busy || fldBusy) return;
  fldBusy = true; fldPaint(); // 폴더 고르기·살펴보기·AI 나누기 동안 버튼을 다시 못 누르게
  try {
    if (!fldDir) { if (!(await fldChoose())) return; }
    else if (!(await fldAllowed())) { fldInfo("폴더를 볼 수 있게 허용해 주세요. (주소창 옆 창에서 [허용]) 안 되면 [폴더 바꾸기]로 다시 골라 주세요."); return; }
    fldInfo("폴더를 살펴보는 중…");
    let list;
    try { list = await fldScan(all); } catch (_) { fldInfo("폴더를 읽지 못했어요. [폴더 바꾸기]로 다시 골라 주세요."); return; }
    if (!list.length) { fldInfo(all ? "폴더에 사진이 없어요." : "새 사진이 없어요. (아직 넣지 않은 사진만 보여요 — 넣었던 사진까지 보려면 [전체 다시 보기])"); return; }
    const more = list.length > FLD_MAX; if (more) list = list.slice(-FLD_MAX);
    fldHow = (await fldCurate(list)) ? "ai" : "time";
    fldInfo(more ? "사진이 많아서 가장 최근 " + FLD_MAX + "장만 보여요." : "");
    $("#fldTitle").textContent = all ? "폴더의 모든 사진" : "폴더의 새 사진";
    fldRender(); openSheet("#fldSheet");
  } finally { fldBusy = false; fldPaint(); }
}
async function fldPut() {
  const on = fldItems.filter(x => x.on); if (!on.length) return;
  closeSheets();
  const done = [];
  for (const S of SIDES) {
    const items = on.filter(x => x.side === S.key); if (!items.length) continue;
    const a = $("#strip-" + S.key + " label.add");
    if (!a) { msg(S.label + " 사진은 " + S.max + "장까지 넣을 수 있어요."); continue; }
    const added = (await addFiles(S.key, S.max, items.map(x => x.f), a)) || [];
    items.forEach(x => { if (added.indexOf(x.f) >= 0) done.push(fldKey(x.path, x.f)); });
  }
  // 실제로 넣은 사진만 목록에 적는다 (빼 둔 사진·넘쳐 빠진 사진은 다음에 다시 나온다). 최근 FLD_SEEN_MAX개까지.
  if (done.length) {
    const add = new Set(done);
    fldSeen = fldSeen.filter(k => !add.has(k)).concat(done).slice(-FLD_SEEN_MAX);
    await idbSet("seen", fldSeen);
  }
  fldItems = []; fldGroups = []; fldSum = ""; fldInfo(""); fldPaint();
}
async function setupFolder() {
  if (!FLD_OK) return;
  $("#fldBox").hidden = false;
  const d = await idbGet("dir"); if (d && d.kind === "directory") { fldDir = d; const sv = await idbGet("seen"); fldSeen = Array.isArray(sv) ? sv : []; }
  fldPaint();
  $("#fldGet").addEventListener("click", () => fldOpen(false));
  $("#fldAll").addEventListener("click", () => fldOpen(true));
  $("#fldPick").addEventListener("click", async () => { if (await fldChoose()) fldOpen(); });
  $("#fldPut").addEventListener("click", fldPut);
  $("#fldAllOn").addEventListener("click", () => { fldItems.forEach(x => { x.on = true; }); fldRender(); });
  $("#fldAllRep").addEventListener("click", () => { fldGroups.forEach(G => { G.items.forEach(x => { x.on = false; }); G.rep.on = true; }); fldRender(); });
  $("#fldAllOff").addEventListener("click", () => { fldItems.forEach(x => { x.on = false; }); fldRender(); });
}

/* ---------- 화면 바꾸기 ---------- */
function show(which) {
  $("#gate").hidden = which !== "gate"; $("#app").hidden = which !== "app"; $("#topBtns").hidden = which !== "app";
  if (which === "gate") {
    const ios = /iP(hone|od|ad)/.test(navigator.userAgent) && !window.navigator.standalone;
    $("#a2hs").hidden = !ios;
  }
}
function paintMode() {
  const bar = $("#modeBar"); bar.textContent = ""; bar.className = "modebar" + (mode === "demo" ? " demo" : "");
  if (FLD_OK && !$("#fldBox").hidden) fldPaint(); // 접속 코드일 때만 'AI에 작게 보내요' 안내
  const s = document.createElement("span");
  if (mode === "demo") { s.innerHTML = "<b>체험 모드</b> · 예시 문장에 고른 값만 넣었어요 (실제는 AI가 사진을 보고 새로 써요)"; }
  else { s.textContent = left == null ? "접속됨" : "오늘 남은 글 " + left + "편"; }
  bar.appendChild(s);
  const st = settings();
  if (!st.contact && !st.area && !st.warranty) {
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.textContent = "처음 설정";
    b.addEventListener("click", openSet); bar.appendChild(b);
  } else if (mode === "live" && !aiKey()) {
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.textContent = "AI 열쇠 넣기";
    b.addEventListener("click", openSet); bar.appendChild(b);
  }
  $("#modeSwitch").textContent = mode === "demo" ? "체험 끝내고 코드 넣기" : "체험 모드로 보기";
}
function gateErr(t) { const e = $("#gateErr"); e.textContent = t || ""; e.hidden = !t; }

// 열쇠는 AI를 부르는 두 곳(/api/photos, /api/write)에만 보낸다
function apiHeaders(path) {
  const h = { "content-type": "application/json", "x-shop-code": encodeURIComponent(code) }; // 머리글에는 한글이 못 들어가서 바꿔 보냄
  if (path === "/api/photos" || path === "/api/write") { const k = aiKey(); if (k) h["x-user-key"] = k; }
  return h;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: apiHeaders(path),
    body: body ? JSON.stringify(body) : "{}"
  });
  return res;
}
async function readErr(res) {
  let d = null; try { d = await res.json(); } catch (_) {}
  return { status: res.status, error: (d && d.error) || "http", message: (d && d.message) || "연결이 잘 안 됐어요. 인터넷을 확인하고 다시 해 주세요." };
}

async function enterCode(c) {
  code = c.trim(); gateErr("");
  if (!code) { gateErr("접속 코드를 넣어 주세요."); return; }
  const btn = $("#codeGo"); btn.disabled = true; btn.textContent = "확인 중…";
  try {
    const res = await api("/api/check");
    if (!res.ok) { const e = await readErr(res); gateErr(e.message); return; }
    const d = await res.json();
    if (!d.ok) { gateErr(d.message || "접속 코드를 확인해 주세요."); return; }
    ls.set(K.code, code); ls.set(K.mode, "live"); mode = "live"; left = d.left;
    show("app"); paintMode();
    if (!aiKey()) fail(NO_KEY_ERR);
  } catch (_) { gateErr("연결이 잘 안 됐어요. 인터넷을 확인하고 다시 해 주세요."); }
  finally { btn.disabled = false; btn.textContent = "시작하기"; }
}
function enterDemo() { mode = "demo"; ls.set(K.mode, "demo"); show("app"); paintMode(); $("#failBox").hidden = true; }

$("#codeGo").addEventListener("click", () => enterCode($("#codeIn").value));
$("#codeIn").addEventListener("keydown", e => { if (e.key === "Enter") enterCode($("#codeIn").value); });
$("#demoGo").addEventListener("click", enterDemo);

/* ---------- 입력 모으기 ---------- */
function fields() {
  const st = settings();
  const spaces = [...sel.space].map(v => v === "기타" ? ($("#spaceEtc").value.trim() || "기타 공간") : v);
  return {
    type: one("type"), spaces, size: one("size"), nameOk: one("nameok"), shopName: $("#shopName").value.trim(), seats: $("#seats").value.trim(), consent: one("consent"), region: $("#region").value.trim(),
    period: one("period"), memo: $("#memo").value.trim(), kind: one("kind") || "review", perk: one("perk") || "none",
    works: [...sel.work], liveIn: one("live"), cost: $("#cost").value.trim(), quote: $("#quote").value.trim(),
    shop: { area: st.area || "", direct: st.direct || "", warranty: st.warranty || "", license: st.license || "", prep: st.prep || "", tags: st.tags || "" }
  };
}

/* ---------- 결과 나누기 ---------- */
function parse(t) {
  t = String(t || "").replace(/\*\*(\[(?:제목|본문|해시태그|확인할 점)\])\*\*/g, "$1");
  const re = /\[(제목|본문|해시태그|확인할 점)\]/g, marks = [], sec = {}; let m;
  while ((m = re.exec(t))) marks.push({ k: m[1], i: m.index, e: re.lastIndex });
  marks.forEach((mk, j) => { if (sec[mk.k] == null) sec[mk.k] = t.slice(mk.e, j + 1 < marks.length ? marks[j + 1].i : t.length).replace(/^\s*\n/, "").replace(/\s+$/, ""); });
  const titles = (sec["제목"] || "").split("\n").map(s => s.replace(/^\s*\d+\s*[.)]\s*/, "").trim()).filter(Boolean).slice(0, 3);
  const bl = (sec["본문"] || "").split("\n");
  let i = 0; while (i < bl.length && !bl[i].trim()) i++;
  const top = []; let j = i, sawRow = false;
  while (j < bl.length) {
    const L = bl[j].trim();
    if (/^[^|]{1,10}\s\|\s*\S/.test(L)) { top.push(L); sawRow = true; j++; continue; }
    if (!sawRow && /^\(.+\)$/.test(L)) { top.push(L); j++; continue; }
    if (!L && !sawRow) { j++; continue; }
    break;
  }
  let summary = "", body = bl.slice(i).join("\n").trim();
  if (sawRow) { summary = top.join("\n"); body = bl.slice(j).join("\n").replace(/^\s+/, "").trim(); }
  const seenTag = new Set(); // 같은 해시태그는 한 번만
  const tags = (sec["해시태그"] || "").replace(/\s+/g, " ").trim().split(" ").filter(w => { if (w === "#") return false; if (!w.startsWith("#")) return true; const k = w.toLowerCase(); if (seenTag.has(k)) return false; seenTag.add(k); return true; }).join(" ");
  const checks = (sec["확인할 점"] || "").split("\n").map(s => s.replace(/^\s*[-•·]\s*/, "").trim()).filter(s => s && s !== "없음");
  return { titles, summary, body, tags, checks, ok: marks.length > 0 && (titles.length > 0 || checks.length > 0) };
}
function shopInfoBlock() {
  const st = settings();
  const rows = [["상담 지역", st.area], ["시공 방식", st.direct], ["하자보수", st.warranty], ["업체 등록", st.license], ["상담 준비물", st.prep]].filter(r => r[1]);
  return rows.length ? "【ARTPLAY 안내】\n\n" + rows.map(r => r[0] + " | " + r[1]).join("\n") : "";
}
// 마지막 안전 점검: 금지 표현, 협찬 표시, 연락처, 제목 길이
function safety(r, f) {
  const out = [];
  const all = [r.titles.join(" "), r.summary, r.body].join("\n");
  const hit = BANNED.filter(w => all.includes(w));
  if (hit.length) out.push("글에 \"" + hit.join("\", \"") + "\" 표현이 있어요. 근거가 없으면 빼 주세요 (과장 광고).");
  if (f && f.perk && f.perk !== "none") {
    const first = (r.summary.split("\n")[0] || "") + (r.titles[0] || "");
    if (!/협찬|할인/.test(first)) out.push("협찬·할인 표시가 제목 맨 앞과 본문 첫 줄에 있는지 꼭 확인해 주세요 (법으로 정해진 표시).");
  }
  if (/고마워요/.test(all)) out.push("\"고마워요 ○○\"처럼 협찬을 흐리는 말이 있어요. 협찬이면 \"(협찬)\"으로 분명히 써 주세요.");
  const long = r.titles.filter(t => t.replace(/\s*\[art\.play\]\s*$/i, "").length > 30).length;
  if (long) out.push("30자가 넘는 제목이 " + long + "개 있어요. 휴대폰 검색에서 뒤가 잘릴 수 있어요.");
  return out;
}

/* ---------- 결과 그리기 ---------- */
function fit(t) { t.style.height = "auto"; t.style.height = (t.scrollHeight + 4) + "px"; }
function renderResult(r) {
  current = r;
  const contact = settings().contact;
  const al = $("#rAlerts"); al.textContent = "";
  (r.alerts || []).forEach(a => { const p = document.createElement("p"); p.className = "alert"; p.textContent = a; al.appendChild(p); });
  const tw = $("#rTitles"); tw.textContent = "";
  r.titles.forEach((t, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "tcard"; b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", i === r.sel ? "true" : "false");
    const d = document.createElement("span"); d.className = "dot"; const s = document.createElement("span"); s.textContent = t;
    b.append(d, s);
    b.addEventListener("click", () => { r.sel = i; tw.querySelectorAll(".tcard").forEach((c, k) => c.setAttribute("aria-checked", k === i ? "true" : "false")); saveCurrent(); });
    tw.appendChild(b);
  });
  if (contact && r.body && r.body.includes("{연락처}")) r.body = r.body.split("{연락처}").join(contact);
  if (contact && r.bodyBundle && r.bodyBundle.includes("{연락처}")) r.bodyBundle = r.bodyBundle.split("{연락처}").join(contact);
  $("#rSummary").value = r.summary || ""; $("#rTags").value = r.tags || "";
  $("#demoWarn").hidden = !r.demo; $("#demoWarn").textContent = DEMO_WARN;
  paintPaste();
  $("#fbBox").hidden = true;
  $("#result").hidden = false;
  requestAnimationFrame(() => { fit($("#rBody")); fit($("#rSummary")); fit($("#rTags")); });
}
function stat() {
  const n = ($("#rSummary").value + "\n\n" + $("#rBody").value).trim().length;
  $("#rStat").textContent = "본문 " + n.toLocaleString("ko-KR") + "자 (요약 칸 포함, 1,500~2,000자가 좋아요)";
}
["#rBody", "#rSummary", "#rTags"].forEach(id => $(id).addEventListener("input", e => {
  fit(e.target); stat();
  if (current) {
    current.summary = $("#rSummary").value; current.tags = $("#rTags").value;
    if (pasteMode() === "bundle") current.bodyBundle = $("#rBody").value;
    else { current.body = $("#rBody").value; current.bodyBundle = null; }
    saveCurrentSoon(); paintPc();
  }
}));

/* ---------- 붙여 넣는 방식 · 사진 순서 저장 ---------- */
function pasteMode() { const v = ls.get(K.paste, DEFAULT_PASTE); return v === "bundle" ? "bundle" : "marks"; }
// (가) 방식: "📷 사진 n" 줄과 바로 아래 사진 설명 한 줄을 뺀다
function stripMarks(body) {
  const L = String(body || "").split("\n"), out = [];
  for (let i = 0; i < L.length; i++) {
    if (/^\s*📷\s*사진\s*\d+/.test(L[i])) {
      const nx = L[i + 1];
      if (nx != null && nx.trim() && !/^\s*(【|Q\.|A\.|📷)/.test(nx)) i++;
      continue;
    }
    out.push(L[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
// 글에 나온 순서대로 사진 번호 (빠진 사진은 뒤에 붙임)
function saveOrder(r, count) {
  const seen = [];
  (String(r.body || "").match(/📷\s*사진\s*(\d+)/g) || []).forEach(m => { const n = parseInt(m.replace(/\D+/g, ""), 10); if (n >= 1 && n <= count && !seen.includes(n)) seen.push(n); });
  for (let n = 1; n <= count; n++) if (!seen.includes(n)) seen.push(n);
  return seen;
}
function photoKey() { return allPhotos().map(p => p.id).join(","); }
const pad2 = n => (n < 10 ? "0" : "") + n;
const HOWTO = {
  bundle: ["사진 버튼 → 01부터 순서대로 모두 선택", "사진 아래에 길게 눌러 붙여 넣기", "올리기"],
  marks: ["글쓰기 화면에서 길게 눌러 붙여 넣기", "\"📷 사진 1\" 자리마다 같은 번호 사진을 넣고 그 줄은 지우기", "올리기"]
};
function paintPaste() {
  const r = current; if (!r) return;
  const m = pasteMode();
  document.querySelectorAll("#pasteMode .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.v === m ? "true" : "false"));
  $("#pasteHelp").textContent = m === "bundle"
    ? "사진을 글 맨 위에 한 번에 넣고, 글은 아래에 붙여요. 가장 쉬워요." + (IS_PC ? " 컴퓨터에서 이 방식은 사진 밑에 글이 오지 않아요. 사진 밑 설명이 필요하면 (나)를 골라 주세요." : "")
    : "글 사이사이에 사진 자리를 표시해요. 손은 더 가지만 검색에 조금 유리해요.";
  const body = m === "bundle" ? (r.bodyBundle != null ? r.bodyBundle : stripMarks(r.body)) : (r.body || "");
  $("#rBody").value = body;
  // 사진 순서: 글에 나온 순서 = 저장되는 순서
  const live = allPhotos();
  const hasPhotos = r.photoKey && r.photoKey === photoKey() && live.length > 0;
  const desc = {}; (r.order || []).forEach(o => { const n = parseInt((o.match(/사진\s*(\d+)/) || [])[1], 10); if (n) desc[n] = o.replace(/^사진\s*\d+\s*—\s*/, ""); });
  const count = hasPhotos ? live.length : Math.max(0, ...Object.keys(desc).map(Number));
  const ord = saveOrder(r, count);
  const ol = $("#rOrder"); ol.textContent = "";
  ord.forEach((n, i) => { const li = document.createElement("li"); li.textContent = pad2(i + 1) + " — 사진 " + n + (desc[n] ? " (" + desc[n] + ")" : ""); ol.appendChild(li); });
  $("#rOrderBox").hidden = !ord.length;
  const sb = $("#saveBtn");
  sb.hidden = !hasPhotos;
  $("#saveNote").textContent = hasPhotos
    ? "글에 나오는 순서대로 01, 02… 번호를 붙여 사진 앱에 한 번에 저장해요. 공유 창이 뜨면 [이미지 " + live.length + "개 저장]을 누르세요."
    : (ord.length ? "사진 저장은 방금 만든 글에서만 할 수 있어요. (사진은 휴대폰에 따로 보관하지 않아요)" : "");
  if (hasPhotos) prepareSave(r, ord);
  const how = $("#howTo"); how.textContent = "";
  HOWTO[m].forEach(s => { const li = document.createElement("li"); li.textContent = s; how.appendChild(li); });
  const checks = (r.checks || []).slice();
  if (body.includes("{연락처}")) checks.push("글 끝 {연락처}를 실제 연락처로 바꿔 주세요. (설정에 넣어 두면 자동으로 바뀌어요)");
  if (IS_PC && hasPhotos) checks.push(m === "bundle" ? "[그림과 글 함께 복사]를 쓰면 사진이 글 맨 위에 01부터 순서대로 들어가요." : "[그림과 글 함께 복사]를 쓰면 사진이 \"📷 사진 n\" 자리에 들어가요. 붙여 넣은 뒤 사진 순서만 한 번 봐 주세요.");
  else checks.push(m === "bundle" ? "사진은 글 맨 위에 01부터 순서대로 한 번에 넣어요." : "사진 번호(📷 사진 1…) 자리에 같은 번호 사진을 넣고, 그 줄은 지워 주세요.");
  const ck = $("#rChecks"); ck.textContent = "";
  checks.forEach(c => { const li = document.createElement("li"); li.textContent = c; ck.appendChild(li); });
  stat(); requestAnimationFrame(() => fit($("#rBody")));
  paintPc();
}
document.querySelectorAll("#pasteMode .chip").forEach(c => c.addEventListener("click", () => { ls.set(K.paste, c.dataset.v); paintPaste(); }));

// 저장할 사진: 원본에서 긴 변 2048px JPEG로 다시 만든다 (위치 정보 같은 숨은 정보가 빠짐)
let saveJob = null;
function prepareSave(r, ord) {
  const key = r.photoKey + "|" + ord.join(",");
  if (saveJob && saveJob.key === key) { paintSaveBtn(); return; }
  const live = allPhotos();
  saveJob = { key, files: null };
  const job = saveJob; paintSaveBtn();
  (async () => {
    const files = [];
    for (let i = 0; i < ord.length; i++) {
      const p = live[ord[i] - 1]; if (!p) continue;
      let blob; try { blob = await shrink(p.file || p.blob, 2048, 0.9); } catch (_) { blob = p.blob; }
      const side = p.side === "전" ? "before" : p.side === "후" ? "after" : "during"; // 파일 이름은 영문 (한글 이름이 깨지는 기기가 있음)
      files.push(new File([blob], pad2(i + 1) + "_" + side + ".jpg", { type: "image/jpeg", lastModified: Date.now() + i }));
    }
    if (saveJob === job) { job.files = files; paintSaveBtn(); }
  })();
}
function paintSaveBtn() {
  const b = $("#saveBtn"); const ready = saveJob && saveJob.files;
  b.disabled = !ready; b.textContent = ready ? "사진 순서대로 저장 (" + saveJob.files.length + "장)" : "사진 준비 중…";
}
$("#saveBtn").addEventListener("click", async () => {
  if (!saveJob || !saveJob.files) return;
  const files = saveJob.files, b = $("#saveBtn");
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files }); // 아이폰: [이미지 N개 저장]
      b.textContent = "✓ 저장 창을 열었어요"; setTimeout(paintSaveBtn, 2000); return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  // 공유가 안 되는 곳(컴퓨터 등): 파일로 내려받기
  for (const f of files) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
    await sleep(250);
  }
  b.textContent = "✓ 내려받기 시작"; setTimeout(paintSaveBtn, 2000);
});

/* ---------- 글 만들기 ---------- */
function refreshGen() {
  const b = $("#genBtn");
  b.disabled = busy || shrinking > 0;
  b.textContent = busy ? "만드는 중…" : shrinking > 0 ? "사진 줄이는 중…" : "글 만들기";
  $("#regenBtn").disabled = b.disabled; $("#retryBtn").disabled = b.disabled;
}
function progress(text, pct) {
  $("#prog").hidden = text == null;
  if (text != null) { $("#progText").textContent = text; $("#progBar").style.width = Math.max(3, Math.min(100, pct || 0)) + "%"; }
}
function fail(e) {
  $("#failMsg").textContent = (e && e.message) || "글을 못 만들었어요.";
  const err = e && e.error;
  $("#failDemo").hidden = !(err === "no_key" || err === "no_codes") || mode === "demo";
  $("#failCode").hidden = !(err === "bad_code");
  $("#failSet").hidden = !(err === "no_key" || err === "key_bad" || err === "billing") || mode === "demo";
  $("#retryBtn").hidden = ["no_key", "no_codes", "bad_code", "locked", "daily_limit", "all_limit", "no_store", "no_consent", "key_bad", "billing"].includes(err);
  $("#failBox").hidden = false;
  $("#failBox").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wake = await navigator.wakeLock.request("screen");
    else if (!on && wake) { await wake.release(); wake = null; }
  } catch (_) { wake = null; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function validate() {
  if (!sel.type.size) {
    $("#gType").classList.add("warn"); $("#typeWarn").hidden = false;
    $("#gType").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
  }
  if (!sel.space.size) {
    $("#gSpace").classList.add("warn"); $("#spaceWarn").hidden = false;
    $("#gSpace").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
  }
  if (!sel.size.size) {
    $("#gSize").classList.add("warn"); $("#sizeWarn").hidden = false;
    $("#gSize").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
  }
  if (!sel.consent.size) {
    $("#gConsent").classList.add("warn"); $("#consentWarn").hidden = false;
    $("#gConsent").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
  }
  if (one("consent") === "none") { fail({ error: "no_consent", message: "고객 게시 동의가 없어 글을 만들지 않았어요. 동의를 받은 뒤 다시 눌러 주세요." }); return false; }
  return true;
}

async function generate() {
  if (busy || shrinking > 0) return;
  $("#failBox").hidden = true;
  if (!validate()) return;
  busy = true; refreshGen(); renderPhotos(); keepAwake(true);
  try {
    if (mode === "demo") await runDemo(); else await runLive();
  } finally { busy = false; progress(null); refreshGen(); renderPhotos(); keepAwake(false); }
}

// 체험 예시 글(틀)에 고른 값을 끼워 넣는다. 틀 표시는 demo.js 위쪽 설명 참고
const PERIOD_TEXT = { "1주 안": "1주", "2~3주": "2~3주", "4~6주": "4~6주", "그 이상": "6주 이상" };
function fillDemo(tpl, f) {
  const region = f.consent === "region" ? f.region : "";
  const size = f.size && f.size !== "모름" ? f.size : "";
  const space = f.spaces.slice(0, 2).join("·") || "공간";
  const first = (f.spaces[0] || "").split("·")[0].replace(/\(.*\)/, "").replace(/\s+/g, "");
  const V = {
    "{지역 }": region ? region + " " : "", "{평수 }": size ? size + " " : "", "{공간}": space,
    "{기간}": PERIOD_TEXT[f.period] || null, "{메모}": f.memo ? f.memo.replace(/\s+/g, " ").slice(0, 120) : null,
    "{사진만}": f.consent === "photo" ? "" : null, "{지역동의}": f.consent === "region" && region ? "" : null,
    "{#지역}": region ? "#" + region.replace(/\s+/g, "") + "인테리어 " : "",
    "{#평수}": size.replace(/\s+/g, "").replace(/~\d+평/, "평대"), "{#공간}": first,
    "{하자안내}": f.shop && f.shop.warranty ? "" : null
  };
  const plain = space.replace(/\s*\([^)]*\)/g, ""); // 제목에는 괄호 업종명 대신 "매장"처럼
  const keys = Object.keys(V);
  const lines = []; let inTitle = false;
  tpl.split("\n").forEach(line => {
    if (/^\[(제목|본문|해시태그|확인할 점)\]$/.test(line.trim())) inTitle = line.trim() === "[제목]";
    const alt = line.split("||").find(a => keys.every(k => !a.includes(k) || V[k] !== null));
    if (alt == null) return; // 값이 없으면 그 줄을 뺀다
    const T = inTitle ? alt.split("{공간}").join(plain) : alt;
    lines.push(keys.reduce((s, k) => s.split(k).join(V[k] || ""), T).replace(/ {2,}/g, " "));
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// 체험 글의 사진 자리를 넣은 사진에 맞춘다 (2026-11-11 품질관리팀 반려).
// 예시 자리의 구분(전·공사 중·후)대로 실제 사진을 앞에서부터 짝지어 번호를 다시 붙이고,
// 짝 없는 자리는 자리 줄 + 바로 밑 설명 줄을 함께 빼고, 남는 사진은 그 구분 마지막 자리 뒤(없으면 【자주 묻는 질문】 앞)에 붙인다.
// 돌려주는 map: 예시 번호 → 새 번호 (빠진 자리는 없음)
const DEMO_MARK = /^📷 사진 (\d+): (전|공사 중|후) - (.*)$/;
const DEMO_SIDES = ["전", "공사 중", "후"];
const EXTRA_CAP = { "전": "공사 전 모습이에요.", "공사 중": "공사하는 중의 모습이에요.", "후": "시공 후 모습이에요." };
function fitDemoPhotos(body, list) {
  const cnt = { "전": 0, "공사 중": 0, "후": 0 }; list.forEach(p => { if (p.side in cnt) cnt[p.side]++; });
  const base = { "전": 0, "공사 중": cnt["전"], "후": cnt["전"] + cnt["공사 중"] };
  const L = String(body || "").split("\n"), slots = {};
  L.forEach((l, i) => { const m = l.match(DEMO_MARK); if (m) slots[i] = { n: +m[1], side: m[2], desc: m[3] }; });
  DEMO_SIDES.forEach(sd => Object.values(slots).filter(x => x.side === sd).sort((a, b) => a.n - b.n).forEach((x, k) => { x.k = k; }));
  const isCap = t => t != null && !!t.trim() && !/^\s*(【|Q\.|A\.|📷)/.test(t);
  const out = [], after = {}, used = { "전": 0, "공사 중": 0, "후": 0 }, map = {};
  for (let i = 0; i < L.length; i++) {
    const s = slots[i];
    if (!s) { out.push(L[i]); continue; }
    const cap = isCap(L[i + 1]);
    if (s.k < cnt[s.side]) {
      const n = base[s.side] + s.k + 1; map[s.n] = n; used[s.side]++;
      out.push("📷 사진 " + n + ": " + s.side + " - " + s.desc);
      if (cap) { out.push(L[i + 1]); i++; }
      after[s.side] = out.length;
    } else if (cap) i++;
  }
  const end = (() => { const k = out.findIndex(l => /^【자주 묻는 질문】/.test(l.trim())); if (k >= 0) return k; const c = out.findIndex(l => /^📞/.test(l.trim())); return c >= 0 ? c : out.length; })();
  const ins = {};
  DEMO_SIDES.forEach(sd => {
    for (let k = used[sd]; k < cnt[sd]; k++) {
      const pos = after[sd] != null ? after[sd] : end;
      (ins[pos] = ins[pos] || []).push("", "📷 사진 " + (base[sd] + k + 1) + ": " + sd + " - 추가 사진", EXTRA_CAP[sd]);
    }
  });
  Object.keys(ins).map(Number).sort((a, b) => b - a).forEach(pos => {
    const add = ins[pos].slice(); if (pos === end && pos < out.length) add.push("");
    out.splice(pos, 0, ...add);
  });
  return { body: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), map };
}
// 확인할 점의 "사진 n(…)" 번호도 새 번호로 (빠진 사진 이야기는 뺀다)
function fitDemoChecks(checks, map) {
  return checks.filter(c => { const m = c.match(/사진 (\d+)\(/); return !m || map[m[1]]; })
    .map(c => c.replace(/사진 (\d+)\(/g, (a, n) => "사진 " + map[n] + "("));
}

async function runDemo() {
  const list = allPhotos(); const f = fields();
  if (list.length) { progress("사진 읽는 중… (체험)", 15); await sleep(700); }
  const which = f.type === "shop" ? "shop" : (f.kind === "compare" ? "compare" : "review");
  const sample = fillDemo((window.ARTPLAY_DEMO || {})[which] || "", f);
  const info = shopInfoBlock();
  const full = sample.replace("{안내}\n\n", info ? info + "\n\n" : "");
  let shown = 0; const step = Math.ceil(full.length / 30);
  while (shown < full.length) { shown = Math.min(full.length, shown + step); progress("글 쓰는 중… " + shown.toLocaleString("ko-KR") + "자 (체험)", 20 + 80 * shown / full.length); await sleep(60); }
  const p = parse(full);
  const fitted = fitDemoPhotos(p.body, list); p.body = fitted.body; p.checks = fitDemoChecks(p.checks, fitted.map);
  const order = (p.body.match(/^📷 사진 \d+: .+$/gm) || []).map(l => l.replace("📷 ", "").replace(":", " —"))
    .sort((a, b) => parseInt(a.replace(/\D+/, ""), 10) - parseInt(b.replace(/\D+/, ""), 10));
  const alerts = ["체험 모드 — 예시 문장에 고른 값만 넣었어요 (실제는 AI가 사진을 보고 새로 써요). 그대로 올리면 안 돼요."];
  if (f.type === "shop") { if (f.kind !== "review") alerts.push("상점 체험 예시는 시공 후기 한 편만 있어요. 실제로는 고른 글 종류대로 써요."); }
  else if (f.kind === "tip") alerts.push("공간 팁 글은 체험 예시가 없어 시공 후기 예시를 보여 드려요.");
  const r = { id: Date.now(), date: new Date().toISOString(), space: (f.type === "shop" ? "상점 · " : "집 · ") + f.spaces.join(", "), sel: 0, demo: true,
    titles: p.titles, summary: p.summary, body: p.body, tags: p.tags, checks: p.checks, alerts: alerts.concat(safety(p, f)), order, photoKey: photoKey() };
  renderResult(r); addHistory(r);
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runLive() {
  if (!aiKey()) { fail(NO_KEY_ERR); return; }   // 열쇠가 없으면 서버에 보내지 않는다
  const list = allPhotos(); const f = fields();
  const alerts = [];
  let descs = list.map((p, i) => ({ side: p.side, desc: p.side + " 사진 " + (i + 1), seen: "", privacy: [] }));
  const key = list.map(p => p.id).join(",");
  try {
    // ① 사진 읽기 (같은 사진이면 지난 결과를 다시 써서 돈을 아낌)
    if (list.length && descCache && descCache.key === key) { descs = descCache.descs; }
    else if (list.length) {
      progress("사진 " + list.length + "장 읽는 중… (10~20초)", 10);
      const data = [];
      for (const p of list) data.push({ side: p.side, data: await b64(p.blob) });
      // 6MB 제한 안에 들게 두 묶음까지 나눠서 동시에 보낸다
      const packs = []; let cur = [], size = 0;
      data.forEach((d, i) => {
        if (cur.length && (size + d.data.length > BODY_BUDGET || cur.length >= 8)) { packs.push(cur); cur = []; size = 0; }
        cur.push({ i, d }); size += d.data.length;
      });
      if (cur.length) packs.push(cur);
      if (packs.length > 2) throw { error: "too_big", message: "사진이 너무 커요. 사진 몇 장을 빼고 다시 해 주세요." };
      const results = await Promise.all(packs.map(async pk => {
        const res = await api("/api/photos", { type: f.type, photos: pk.map(x => x.d) });
        if (!res.ok) return { pk, err: await readErr(res) };
        return { pk, d: await res.json() };
      }));
      let readAll = true, anyOk = false;
      for (const r of results) {
        if (r.err) {
          if (["no_key", "no_codes", "bad_code", "locked", "daily_limit", "all_limit", "no_store", "key_bad", "billing"].includes(r.err.error)) throw r.err;
          readAll = false; continue;
        }
        anyOk = true; if (!r.d.read) readAll = false;
        (r.d.photos || []).forEach((x, k) => { const i = r.pk[k] && r.pk[k].i; if (i == null) return; descs[i] = { side: list[i].side, desc: x.desc || descs[i].desc, seen: x.seen || "", privacy: x.privacy || [] }; });
      }
      if (!anyOk) alerts.push("사진 내용을 읽지 못해 사진은 순서만 넣었어요.");
      else if (!readAll) alerts.push("사진 일부는 내용을 읽지 못해 순서만 넣었어요.");
      if (anyOk) descCache = { key, descs };
    }
    descs.forEach((d, i) => { if (d.privacy && d.privacy.length) alerts.unshift("사진 " + (i + 1) + "에서 보이는 것: " + d.privacy.join("·") + ". 블로그에 올리기 전에 가려 주세요."); });

    // ② 글쓰기 (흘려 받기)
    progress("글 쓰는 중… (30초~1분)", 25);
    const res = await api("/api/write", { fields: f, photos: descs.map(d => ({ side: d.side, desc: d.desc, seen: d.seen })) });
    if (!res.ok) throw await readErr(res);
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = "", text = "", end = null, err = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch (_) { continue; }
        if (o.t) { text += o.t; progress("글 쓰는 중… " + text.length.toLocaleString("ko-KR") + "자", 25 + Math.min(70, text.length / 30)); }
        else if (o.done) { end = o; if (o.left != null) left = o.left; }
        else if (o.error) err = o;
      }
    }
    paintMode();
    if (err && !text) throw err;
    if (!end && !text) throw { error: "cut", message: "연결이 끊겼어요. 화면을 켠 채로 [다시 시도]를 눌러 주세요." };
    if (!end || end.stop === "max_tokens" || end.stop === "time_cut") alerts.unshift("글이 끝까지 오지 않았어요. 본문 끝부분을 확인하거나 [다시 만들기]를 눌러 주세요.");
    const p = parse(text);
    if (!p.ok) throw { error: "bad_format", message: "글 모양이 이상하게 왔어요. [다시 시도]를 눌러 주세요." };
    if (!p.titles.length && !p.body) throw { error: "no_consent", message: p.checks.join(" ") || "글을 못 만들었어요." };
    const order = list.map((ph, i) => "사진 " + (i + 1) + " — " + ph.side + ": " + descs[i].desc);
    const r = { id: Date.now(), date: new Date().toISOString(), space: (f.type === "shop" ? "상점 · " : "집 · ") + f.spaces.join(", "), sel: 0,
      titles: p.titles.length ? p.titles : ["(제목 없음)"], summary: p.summary, body: p.body, tags: p.tags, checks: p.checks,
      alerts: alerts.concat(safety(p, f)), order, photoKey: photoKey() };
    renderResult(r); addHistory(r);
    $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (e && e.error === "bad_code") { ls.del(K.code); }
    fail(e && e.message ? e : { message: "연결이 잘 안 됐어요. 인터넷을 확인하고 [다시 시도]를 눌러 주세요." });
  }
}
$("#genBtn").addEventListener("click", generate);
$("#retryBtn").addEventListener("click", generate);
$("#regenBtn").addEventListener("click", generate);
$("#failDemo").addEventListener("click", enterDemo);
$("#failCode").addEventListener("click", () => { ls.del(K.code); code = ""; show("gate"); });
$("#failSet").addEventListener("click", () => { openSet(); const k = $("#keyIn"); if (k) k.focus(); });
$("#newBtn").addEventListener("click", () => {
  SIDES.forEach(S => { photos[S.key].forEach(p => URL.revokeObjectURL(p.url)); photos[S.key] = []; });
  Object.keys(GROUPS).forEach(g => { sel[g] = new Set(DEFAULTS[g] ? [DEFAULTS[g]] : []); });
  ["#spaceEtc", "#region", "#memo", "#cost", "#quote", "#shopName", "#seats"].forEach(id => { $(id).value = ""; });
  setType();
  descCache = null; current = null; $("#result").hidden = true; $("#failBox").hidden = true; $("#more").open = false;
  paintChips(); renderPhotos(); msg(""); window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- 복사 ---------- */
// 체험 글은 진짜 후기처럼 올라가지 않게, 모든 복사 맨 첫 줄에 경고를 넣는다
const DEMO_WARN = "[체험 예시 글 — 실제 현장이 아니에요. 그대로 올리지 마세요]";
const isDemo = () => !!(current && current.demo);
const warnText = t => isDemo() ? DEMO_WARN + "\n\n" + t : t;
const warnHtml = h => isDemo() ? "<p>" + esc(DEMO_WARN) + "</p><p><br></p>" + h : h;
function full() { const r = current; return [r.titles[r.sel] || "", $("#rSummary").value.trim(), $("#rBody").value.trim(), $("#rTags").value.trim()].filter(Boolean).join("\n\n"); }
const COPY = {
  cpAll: () => full(),
  cpTitle: () => current.titles[current.sel] || "",
  cpBody: () => [$("#rSummary").value.trim(), $("#rBody").value.trim()].filter(Boolean).join("\n\n"),
  cpTags: () => $("#rTags").value.trim()
};
Object.keys(COPY).forEach(id => {
  const b = $("#" + id), label = b.textContent;
  b.addEventListener("click", () => {
    if (!current) return;
    const text = warnText(COPY[id]());
    const done = () => { b.textContent = "✓ 복사됨"; $("#fbBox").hidden = true; setTimeout(() => { b.textContent = label; }, 1500); };
    const fallback = () => { const f = $("#fbText"); f.value = text; $("#fbBox").hidden = false; fit(f); f.focus(); f.select(); try { f.setSelectionRange(0, text.length); } catch (_) {} };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (_) { fallback(); }
  });
});

/* ---------- 컴퓨터: 그림과 글 함께 복사 ---------- */
// 마우스가 있는 컴퓨터(IS_PC)에서만 보인다. 휴대폰은 위 복사 버튼·사진 순서 저장 그대로.
// 본문의 "📷 사진 n: …" 줄 자리에 사진 n(넣은 순서: 전 → 공사 중 → 후)을 넣고, 바로 아래 설명 1문장이 이어진다.
// 사진은 방금 만든 글에서만 들어간다 (지난 글에는 사진이 없어 글만 복사).
// 네이버 블로그 PC 편집기에 붙이면 사진+글이 섞여 들어가는 것을 회장님이 확인함 (2026-11-11, 영양 노트 앱).
// 네이버는 data: 그림을 "허용되지 않는 사진"으로 막는다 → 누르면 사진을 먼저 /api/img 에 올리고(하루 뒤 지움)
// https 주소로 <img>를 넣어 복사한다. 올리기에 실패하면 data: 로 복사하지 않고 "한 칸씩 복사"를 안내한다.
const MARK_RE = /^\s*📷\s*사진\s*(\d+)(?!\d)/;
const PC_EDGE = 1280, PC_Q = 0.82; // 붙여 넣을 사진 크기 (긴 변 1280px JPEG)
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PC_HOWTO = ["크롬에서 네이버 블로그 → 글쓰기", "[제목만]을 눌러 제목 칸에 붙여넣기(Ctrl+V)", "본문 칸을 누르고 [그림과 글 함께 복사] → 붙여넣기(Ctrl+V)", "사진 순서·{연락처}를 한 번 보고 발행"];
const UP_KEEP = 23 * 3600e3; // 서버는 24시간 뒤 지우므로, 23시간 지난 주소는 다시 올린다
let pcJob = null, piecesKey = "", pcBusy = "";
function isLive() { return !!(current && current.photoKey && allPhotos().length && current.photoKey === photoKey()); }
function imgOf(k) { if (!isLive() || !pcJob || pcJob.key !== current.photoKey) return null; return pcJob.items[k - 1] || null; }
function preparePc() {
  const key = current.photoKey;
  if (pcJob && pcJob.key === key) return;
  const list = allPhotos(), job = { key, items: [], ready: false };
  pcJob = job; if (pcBusy !== "up") pcBusy = "";
  (async () => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        let b; try { b = p.file ? await shrink(p.file, PC_EDGE, PC_Q) : p.blob; } catch (_) { b = p.blob; }
        if (b && b.size > 1.4e6 && p.file) { try { b = await shrink(p.file, PC_EDGE, 0.7); } catch (_) {} } // 서버 한도 1.5MB 안쪽으로
        job.items[i] = { blob: b, url: "", upAt: 0, alt: p.side + " 사진 " + (i + 1) };
      } catch (_) {}
    }
    job.ready = true;
    if (pcJob === job) paintPc();
  })();
}
// 붙여 넣을 줄: 요약 칸(협찬 표시 줄 포함) → 본문 (해시태그는 따로 끝에)
function pcLines() {
  const s = $("#rSummary").value.replace(/\r/g, "").trim(), b = $("#rBody").value.replace(/\r/g, "");
  return (s ? s.split("\n").concat([""]) : []).concat(b.split("\n"));
}
function lineHtml(line) { return /^【.+】$/.test(line) ? "<p><b>" + esc(line) + "</b></p>" : "<p>" + esc(line) + "</p>"; }
function linesToHtml(lines) {
  const out = []; let blank = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (out.length && !blank) { out.push("<p><br></p>"); blank = true; } continue; }
    blank = false; out.push(lineHtml(line));
  }
  while (out.length && out[out.length - 1] === "<p><br></p>") out.pop();
  return out.join("");
}
// 글을 "📷 사진 n" 줄로 잘라 [글][사진][글]… 순서로. 사진이 없으면 그 줄은 글로 남긴다. 자리 없는 사진은 맨 앞.
function buildPieces() {
  const n = current && current.photoKey ? current.photoKey.split(",").filter(Boolean).length : 0, used = new Set(), pieces = [];
  let buf = [];
  const flush = () => { const t = buf.join("\n").replace(/\n{3,}/g, "\n\n").trim(); if (t) pieces.push({ kind: "text", lines: buf.slice(), text: t }); buf = []; };
  for (const raw of pcLines()) {
    const m = raw.trim().match(MARK_RE);
    if (m) { const k = Number(m[1]); if (k >= 1 && k <= n && !used.has(k) && imgOf(k)) { flush(); used.add(k); pieces.push({ kind: "img", k }); continue; } }
    buf.push(raw);
  }
  const tags = $("#rTags").value.trim();
  if (tags) buf.push("", tags);
  flush();
  const top = [];
  for (let k = 1; k <= n; k++) if (!used.has(k) && imgOf(k)) top.push({ kind: "img", k });
  return top.concat(pieces);
}
// 사진 올리기: 아직 안 올렸거나 오래된 것만 올린다. 3장씩 동시에. 하나라도 실패하면 오류(쉬운 문구)
const upFresh = im => !!(im && im.url && Date.now() - im.upAt < UP_KEEP);
function needUpload() { return buildPieces().filter(p => p.kind === "img").map(p => imgOf(p.k)).filter(im => im && !upFresh(im)); }
// 사진 올리기에는 접속 코드가 필요하다. 코드를 넣고 시작했다가 (열쇠가 없어) 체험으로 간 경우에도 저장된 코드를 보낸다.
const upCode = () => (code || ls.get(K.code, "") || "").trim();
const NO_CODE_UP = "접속 코드를 넣으면 사진까지 한 번에 붙여져요. 지금은 [한 칸씩 복사]를 써 주세요.";
async function uploadOne(im) {
  let res;
  try { res = await fetch("/api/img", { method: "POST", headers: { "content-type": "image/jpeg", "x-shop-code": encodeURIComponent(upCode()) }, body: im.blob }); }
  catch (_) { throw new Error("인터넷 연결을 확인해 주세요."); }
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || !d.ok || !d.path) throw new Error((d && d.message) || "사진을 올리지 못했어요.");
  im.url = new URL(d.path, location.href).href; im.upAt = Date.now();
}
async function uploadAll(onStep) {
  const list = needUpload(), total = list.length;
  let done = 0, next = 0, err = null;
  onStep(0, total);
  const worker = async () => {
    while (!err && next < list.length) {
      const im = list[next++];
      try { await uploadOne(im); done++; onStep(done, total); } catch (e) { err = e; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (err) throw err;
}
function imgHtml(k) { const im = imgOf(k); return '<p><img src="' + esc(im.url) + '" alt="' + esc(im.alt) + '" style="max-width:100%;height:auto"></p>'; }
function buildHtml() {
  // 사진 바로 아래에 설명 문장이 붙도록, 사진 뒤에는 빈 줄을 넣지 않는다
  const out = []; let prev = null;
  buildPieces().forEach(pc => {
    if (prev && prev.kind !== "img") out.push("<p><br></p>");
    out.push(pc.kind === "img" ? imgHtml(pc.k) : linesToHtml(pc.lines));
    prev = pc;
  });
  return out.join("");
}
function plainText() { return [$("#rSummary").value.trim(), $("#rBody").value.trim(), $("#rTags").value.trim()].filter(Boolean).join("\n\n"); }
function copyText(text) { try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false); } catch (_) {} return Promise.resolve(false); }
function execCopyHtml(html, text) {
  const d = document.createElement("div");
  d.contentEditable = "true"; d.setAttribute("aria-hidden", "true");
  d.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;white-space:normal";
  d.innerHTML = html; document.body.appendChild(d);
  const onCopy = e => { try { e.clipboardData.setData("text/html", html); e.clipboardData.setData("text/plain", text); e.preventDefault(); } catch (_) {} };
  document.addEventListener("copy", onCopy);
  let ok = false;
  try { const s = window.getSelection(), r = document.createRange(); r.selectNodeContents(d); s.removeAllRanges(); s.addRange(r); ok = document.execCommand("copy"); s.removeAllRanges(); } catch (_) { ok = false; }
  document.removeEventListener("copy", onCopy); d.remove();
  return ok;
}
// HTML + 글 함께: ① ClipboardItem ② 숨은 칸 + execCommand ③ 글만
function copyHtml(html, text) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      const item = new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) });
      return navigator.clipboard.write([item]).then(() => "html", () => execCopyHtml(html, text) ? "html" : copyText(text).then(ok => ok ? "text" : ""));
    }
  } catch (_) {}
  if (execCopyHtml(html, text)) return Promise.resolve("html");
  return copyText(text).then(ok => ok ? "text" : "");
}
// 크롬 클립보드는 그림을 image/png로만 받는다 → canvas로 PNG 변환
async function pngBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  if (bmp.close) try { bmp.close(); } catch (_) {}
  return await new Promise((res, rej) => c.toBlob(x => x ? res(x) : rej(new Error("png")), "image/png"));
}
function copyImage(blob) {
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)
      return navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob(blob) })]).then(() => true, () => false);
  } catch (_) {}
  return Promise.resolve(false);
}
function showFb(text) { const f = $("#fbText"); f.value = text; $("#fbBox").hidden = false; fit(f); f.focus(); f.select(); try { f.setSelectionRange(0, text.length); } catch (_) {} }
function paintPieces() {
  const box = $("#pcPieces"), list = $("#pcList");
  const pieces = buildPieces();
  const key = JSON.stringify(pieces) + "|" + current.id + "|" + (pcJob && pcJob.ready);
  if (key === piecesKey) return; // 내용이 같으면 그대로 (누른 ✓ 유지)
  piecesKey = key;
  box.hidden = pieces.length < 2; list.textContent = "";
  if (box.hidden) return;
  let ti = 0, ii = 0;
  pieces.forEach(pc => {
    const b = document.createElement("button"); b.type = "button"; b.className = "mid piece";
    const label = pc.kind === "text" ? "글 " + (++ti) + " 복사" : "사진 " + (++ii) + " 복사";
    b.textContent = label;
    b.addEventListener("click", async () => {
      const im = pc.kind === "img" ? imgOf(pc.k) : null;
      const ok = pc.kind === "text" ? !!(await copyHtml(warnHtml(linesToHtml(pc.lines)), warnText(pc.text))) : (im ? await copyImage(im.blob) : false);
      if (ok) { b.textContent = "✓ " + label; b.classList.add("done"); }
      else { b.textContent = label + " — 다시 눌러 주세요"; if (pc.kind === "text") showFb(warnText(pc.text)); }
    });
    list.appendChild(b);
  });
}
function paintPc() {
  if (!IS_PC || !current) return;
  $("#pcBox").hidden = false;
  $("#cpAll").className = "mid";
  $("#howLbl").textContent = "노트북 크롬 → 네이버 블로그 PC 글쓰기에서";
  const how = $("#howTo"); how.textContent = "";
  PC_HOWTO.forEach(s => { const li = document.createElement("li"); li.textContent = s; how.appendChild(li); });
  const live = isLive();
  if (live) preparePc();
  const waiting = live && pcJob && !pcJob.ready;
  const n = buildPieces().filter(p => p.kind === "img").length;
  $("#pcCloud").hidden = !n || !upCode(); // 코드 없이 체험이면 사진을 올리지 않으므로 안내도 숨김
  paintPieces();
  if (pcBusy) return; // 사진 올리는 중이거나 "한 번 더 누르세요" 상태는 그대로 둔다
  const b = $("#pcAll");
  b.disabled = !!waiting;
  b.textContent = waiting ? "그림 준비 중…" : n ? "그림과 글 함께 복사" : "블로그에 붙여 넣을 글 복사";
  $("#pcNote").textContent = waiting ? "" : n
    ? (!upCode() && needUpload().length ? NO_CODE_UP : pasteMode() === "bundle" ? "사진 " + n + "장이 글 맨 위에 순서대로 들어가요. 이 방식은 사진 밑에 글이 오지 않아요." : "사진 " + n + "장이 글 사이 제자리에 들어가요. 설명 문장은 사진 바로 아래에 붙어요.")
    : "사진은 방금 만든 글에서만 함께 복사돼요. 지금은 글만 복사돼요.";
}
function pcDone(how, n, text) {
  const b = $("#pcAll");
  if (how === "html") { b.textContent = n ? "✓ 그림 " + n + "장과 글 복사됨" : "✓ 복사됨"; $("#fbBox").hidden = true; }
  else if (how === "text") { b.textContent = "✓ 글만 복사됨 (사진은 한 칸씩 복사로)"; }
  else { b.textContent = "복사가 안 됐어요"; showFb(text); }
  pcBusy = "shown"; b.disabled = false;
  setTimeout(() => { pcBusy = ""; paintPc(); }, 2500);
}
function upFail(e) {
  const b = $("#pcAll");
  pcBusy = "shown"; b.disabled = false;
  b.textContent = "사진을 올리지 못했어요 — 아래 한 칸씩 복사를 써 주세요";
  $("#pcNote").textContent = ((e && e.message) || "사진을 올리지 못했어요.") + " 아래 [한 칸씩 복사]로 글과 사진을 차례로 붙여 넣어 주세요.";
  setTimeout(() => { if (pcBusy === "shown") { pcBusy = ""; paintPc(); } }, 6000);
}
$("#pcAll").addEventListener("click", async () => {
  const b = $("#pcAll");
  if (!current || b.disabled || pcBusy === "up") return;
  const text = warnText(plainText()), n = buildPieces().filter(p => p.kind === "img").length;
  // 사진이 없거나 이미 다 올렸으면 (또는 "한 번 더 누르세요" 뒤) 바로 복사
  if (!n || !needUpload().length) { pcBusy = ""; pcDone(await copyHtml(warnHtml(buildHtml()), text), n, text); return; }
  // 코드 없이 [체험해 보기]만 한 경우: 사진은 올리지 않고 한 칸씩 복사를 안내
  if (!upCode()) {
    pcBusy = "shown"; b.disabled = false;
    b.textContent = "체험에서는 사진을 함께 복사하지 않아요";
    $("#pcNote").textContent = NO_CODE_UP;
    setTimeout(() => { if (pcBusy === "shown") { pcBusy = ""; paintPc(); } }, 6000);
    return;
  }
  pcBusy = "up"; b.disabled = true;
  const up = uploadAll((d, t) => { b.textContent = "사진 올리는 중 " + d + "/" + t; });
  up.catch(() => {}); // 오류는 아래에서 받는다
  // ① 크롬: 누른 순간 클립보드에 "곧 채울 내용"을 넘겨 두면, 올리기가 끝난 뒤 한 번에 복사된다
  let wrote = null;
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write && (!ClipboardItem.supports || ClipboardItem.supports("text/html"))) {
      const htmlP = up.then(() => new Blob([warnHtml(buildHtml())], { type: "text/html" }));
      const textP = up.then(() => new Blob([text], { type: "text/plain" }));
      wrote = navigator.clipboard.write([new ClipboardItem({ "text/html": htmlP, "text/plain": textP })]).then(() => true, () => false);
    }
  } catch (_) { wrote = null; }
  try { await up; } catch (e) { pcBusy = ""; upFail(e); return; }
  const ok = wrote ? await wrote : false;
  if (ok) { pcBusy = ""; pcDone("html", n, text); return; }
  // ② 한 번에 안 되는 브라우저: 올리기는 끝났으니 한 번 더 누르면 바로 복사
  pcBusy = "again"; b.disabled = false;
  b.textContent = "복사 준비 됐어요 — 한 번 더 누르세요";
});

/* ---------- 지난 글 (이 휴대폰에만, 10개) ---------- */
function loadHist() { try { const v = JSON.parse(ls.get(K.hist, "[]")); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveHist(h) { return ls.set(K.hist, JSON.stringify(h.slice(0, 10))); }
function addHistory(r) { const h = loadHist().filter(x => x.id !== r.id); h.unshift(r); saveHist(h); }
function saveCurrent() { if (!current) return; const h = loadHist(); const i = h.findIndex(x => x.id === current.id); if (i >= 0) { h[i] = current; saveHist(h); } }
let st = null; function saveCurrentSoon() { clearTimeout(st); st = setTimeout(saveCurrent, 600); }
function fmtDate(iso) { try { const d = new Date(iso); return (d.getMonth() + 1) + "월 " + d.getDate() + "일"; } catch (_) { return ""; } }
function renderHist() {
  const box = $("#hList"); box.textContent = ""; const h = loadHist();
  if (!h.length) { const p = document.createElement("p"); p.className = "small"; p.textContent = "아직 만든 글이 없어요. 글을 만들면 여기에 남아요."; box.appendChild(p); return; }
  h.forEach(r => {
    const row = document.createElement("div"); row.className = "hrow";
    const o = document.createElement("button"); o.type = "button"; o.className = "hopen";
    const b = document.createElement("b"); b.textContent = r.titles[r.sel] || "(제목 없음)";
    const s = document.createElement("span"); s.textContent = fmtDate(r.date) + " · " + (r.space || "") + (r.demo ? " · 체험" : "");
    o.append(b, s);
    o.addEventListener("click", () => { closeSheets(); renderResult(r); $("#result").scrollIntoView({ behavior: "smooth", block: "start" }); });
    const del = document.createElement("button"); del.type = "button"; del.className = "hdel"; del.textContent = "지우기";
    let armed = false;
    del.addEventListener("click", () => {
      if (!armed) { armed = true; del.textContent = "정말?"; setTimeout(() => { armed = false; del.textContent = "지우기"; }, 2500); return; }
      saveHist(loadHist().filter(x => x.id !== r.id)); renderHist();
    });
    row.append(o, del); box.appendChild(row);
  });
}

/* ---------- 판 열고 닫기 ---------- */
function openSheet(id) { $("#shade").hidden = false; $(id).hidden = false; const c = $(id).querySelector("[data-close]"); if (c) c.focus(); }
function closeSheets() { $("#shade").hidden = true; $("#histSheet").hidden = true; $("#setSheet").hidden = true; $("#fldSheet").hidden = true; fldRelease(); }
function openSet() {
  const s = settings();
  $("#contactIn").value = s.contact || ""; $("#sArea").value = s.area || ""; $("#sDirect").value = s.direct || "";
  $("#sWarranty").value = s.warranty || ""; $("#sLicense").value = s.license || ""; $("#sPrep").value = s.prep || "";
  $("#sTags").value = s.tags || ""; $("#setInfo").textContent = "";
  paintKey(); $("#keyIn").value = ""; $("#keyIn").type = "password"; $("#keyShow").textContent = "보기"; $("#keyShow").setAttribute("aria-pressed", "false"); $("#keyInfo").textContent = "";
  openSheet("#setSheet");
}
$("#histBtn").addEventListener("click", () => { renderHist(); openSheet("#histSheet"); });
$("#setBtn").addEventListener("click", openSet);
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheets));
$("#shade").addEventListener("click", closeSheets);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
$("#setSave").addEventListener("click", () => {
  const s = {
    contact: $("#contactIn").value.trim(), area: $("#sArea").value.trim(), direct: $("#sDirect").value.trim(),
    warranty: $("#sWarranty").value.trim(), license: $("#sLicense").value.trim(), prep: $("#sPrep").value.trim(), tags: $("#sTags").value.trim()
  };
  $("#setInfo").textContent = ls.set(K.set, JSON.stringify(s)) ? "✓ 저장했어요. 다음 글부터 들어가요." : "저장하지 못했어요. 사파리 개인정보 보호 모드를 꺼 주세요.";
  paintMode();
});
/* ---------- AI 열쇠 (설정) ---------- */
// 저장한 열쇠는 화면에 다시 보여 주지 않는다 (앞 10글자 + 끝 4글자만)
function paintKey() {
  const k = aiKey();
  $("#keyNow").textContent = k ? "지금 넣어 둔 열쇠: " + k.slice(0, 10) + "…" + k.slice(-4) : "아직 넣은 열쇠가 없어요.";
  $("#keyDel").hidden = !k;
}
$("#keyShow").addEventListener("click", () => {
  const i = $("#keyIn"), on = i.type === "password";
  i.type = on ? "text" : "password"; $("#keyShow").textContent = on ? "가리기" : "보기"; $("#keyShow").setAttribute("aria-pressed", on ? "true" : "false");
});
$("#keySave").addEventListener("click", () => {
  const v = $("#keyIn").value.replace(/\s+/g, "");
  const info = $("#keyInfo");
  if (!v) { info.textContent = "열쇠를 붙여 넣어 주세요."; return; }
  if (!v.startsWith("sk-ant-")) { info.textContent = "열쇠는 sk-ant- 로 시작해요. console.anthropic.com에서 복사한 것을 그대로 붙여 넣어 주세요."; return; }
  if (!KEY_RE.test(v)) { info.textContent = "열쇠 모양이 이상해요. 빠진 글자 없이 다시 복사해 주세요."; return; }
  if (!ls.set(K.key, v)) { info.textContent = "저장하지 못했어요. 사파리 개인정보 보호 모드를 꺼 주세요."; return; }
  $("#keyIn").value = ""; $("#keyIn").type = "password"; $("#keyShow").textContent = "보기";
  info.textContent = "✓ 저장했어요. 이제 글 만들기에 이 열쇠를 써요.";
  paintKey(); paintMode();
  if (mode === "live") $("#failBox").hidden = true;
});
$("#keyDel").addEventListener("click", () => {
  ls.del(K.key); $("#keyIn").value = "";
  $("#keyInfo").textContent = "✓ 이 노트북에서 열쇠를 지웠어요.";
  paintKey(); paintMode();
});
$("#modeSwitch").addEventListener("click", () => {
  closeSheets();
  if (mode === "demo") { ls.set(K.mode, "live"); const c = ls.get(K.code, ""); if (c) { $("#codeIn").value = ""; enterCode(c); } else show("gate"); }
  else enterDemo();
});
$("#codeReset").addEventListener("click", () => { closeSheets(); ls.del(K.code); code = ""; $("#codeIn").value = ""; gateErr(""); show("gate"); });
$("#verInfo").textContent = "앱 버전 " + APP_VERSION;

/* ---------- 시작 ---------- */
document.querySelectorAll(".chips").forEach(buildChips); setType();
paintChips(); renderPhotos(); refreshGen(); setupDrop(); setupFolder();
(function start() {
  const m = ls.get(K.mode, ""), c = ls.get(K.code, "");
  if (m === "demo") { enterDemo(); return; }
  if (c) { code = c; mode = "live"; show("app"); paintMode(); api("/api/check").then(async res => {
    const d = res.ok ? await res.json() : null;
    if (d && !d.ok) { if (d.error === "bad_code" || d.error === "no_codes") { ls.del(K.code); show("gate"); gateErr(d.message); } return; }
    if (d) { left = d.left; paintMode(); if (!aiKey()) fail(NO_KEY_ERR); }
  }).catch(() => {}); return; }
  show("gate");
})();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
})();
