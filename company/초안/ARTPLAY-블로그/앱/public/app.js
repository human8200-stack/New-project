/* ARTPLAY 블로그 글쓰기 — 독립판 화면 코드
   흐름: 접속 코드(또는 체험) → 사진·고르기 → [글 만들기] → ① 사진 읽기 /api/photos → ② 글쓰기 /api/write(흘려 받기) → 결과
   글 규칙은 서버의 netlify/lib/prompt.mjs 한 곳에 있어요. 여기에는 화면과 마지막 안전 점검만 있어요. */
(function () {
"use strict";
const APP_VERSION = "1.3.1 (2026-11-11, 체험 글 사진 자리 맞추기·체험 경고)";
// 마우스가 있는 컴퓨터인지 (컴퓨터에서만 [그림과 글 함께 복사]가 보여요. 휴대폰은 그대로)
const IS_PC = (() => { try { return matchMedia("(pointer: fine) and (hover: hover)").matches; } catch (_) { return false; } })();
const $ = s => document.querySelector(s);
const K = { code: "artplay-code", mode: "artplay-mode", hist: "artplay-history-v1", set: "artplay-settings-v1", paste: "artplay-paste" };
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
  const room = max - list.length; let failed = 0;
  shrinking++; renderPhotos(); refreshGen();
  addBtn.classList.add("busy"); addBtn.firstChild.textContent = "줄이는 중";
  try {
    for (const f of arr.slice(0, Math.max(0, room))) {
      try {
        let blob = await shrink(f, MAX_EDGE, JPEG_Q);
        if (blob.size > 420e3) blob = await shrink(f, MAX_EDGE, 0.7);
        if (blob.size > 420e3) blob = await shrink(f, 1024, 0.7);
        list.push({ id: ++pid, blob, file: f, url: URL.createObjectURL(blob) });
      } catch (_) { failed++; }
    }
  } finally { shrinking--; }
  const t = [];
  if (arr.length > room) t.push("사진은 전·후 각 6장, 공사 중 3장까지 넣을 수 있어요.");
  if (failed) t.push(failed + "장은 열 수 없었어요. 다른 사진을 골라 주세요.");
  descCache = null; renderPhotos(); msg(t.join(" ")); refreshGen();
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
  onChoice();
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
  const s = document.createElement("span");
  if (mode === "demo") { s.innerHTML = "<b>체험 모드</b> · 예시 문장에 고른 값만 넣었어요 (실제는 AI가 사진을 보고 새로 써요)"; }
  else { s.textContent = left == null ? "접속됨" : "오늘 남은 글 " + left + "편"; }
  bar.appendChild(s);
  const st = settings();
  if (!st.contact && !st.area && !st.warranty) {
    const b = document.createElement("button"); b.type = "button"; b.className = "ghost"; b.textContent = "처음 설정";
    b.addEventListener("click", openSet); bar.appendChild(b);
  }
  $("#modeSwitch").textContent = mode === "demo" ? "체험 끝내고 코드 넣기" : "체험 모드로 보기";
}
function gateErr(t) { const e = $("#gateErr"); e.textContent = t || ""; e.hidden = !t; }

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shop-code": encodeURIComponent(code) }, // 머리글에는 한글이 못 들어가서 바꿔 보냄
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
    if (!d.ai) fail({ error: "no_key", message: "접속은 됐지만 AI 연결 열쇠가 아직 설정되지 않았어요. 회사에 알려 주세요. 그동안은 체험 모드로 둘러볼 수 있어요." });
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
const MARK_RE = /^\s*📷\s*사진\s*(\d+)(?!\d)/;
const PC_EDGE = 1280, PC_Q = 0.82; // 붙여 넣을 사진 크기 (긴 변 1280px JPEG)
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PC_HOWTO = ["크롬에서 네이버 블로그 → 글쓰기", "[제목만]을 눌러 제목 칸에 붙여넣기(Ctrl+V)", "본문 칸을 누르고 [그림과 글 함께 복사] → 붙여넣기(Ctrl+V)", "사진 순서·{연락처}를 한 번 보고 발행"];
let pcJob = null, piecesKey = "";
function isLive() { return !!(current && current.photoKey && allPhotos().length && current.photoKey === photoKey()); }
function imgOf(k) { if (!isLive() || !pcJob || pcJob.key !== current.photoKey) return null; return pcJob.items[k - 1] || null; }
function toDataUrl(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
function preparePc() {
  const key = current.photoKey;
  if (pcJob && pcJob.key === key) return;
  const list = allPhotos(), job = { key, items: [], ready: false };
  pcJob = job;
  (async () => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      try {
        let b; try { b = p.file ? await shrink(p.file, PC_EDGE, PC_Q) : p.blob; } catch (_) { b = p.blob; }
        job.items[i] = { blob: b, url: await toDataUrl(b), alt: p.side + " 사진 " + (i + 1) };
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
  const b = $("#pcAll");
  b.disabled = !!waiting;
  b.textContent = waiting ? "그림 준비 중…" : n ? "그림과 글 함께 복사" : "블로그에 붙여 넣을 글 복사";
  $("#pcNote").textContent = waiting ? "" : n
    ? (pasteMode() === "bundle" ? "사진 " + n + "장이 글 맨 위에 순서대로 들어가요. 이 방식은 사진 밑에 글이 오지 않아요." : "사진 " + n + "장이 글 사이 제자리에 들어가요. 설명 문장은 사진 바로 아래에 붙어요.")
    : "사진은 방금 만든 글에서만 함께 복사돼요. 지금은 글만 복사돼요.";
  paintPieces();
}
$("#pcAll").addEventListener("click", async () => {
  const b = $("#pcAll");
  if (!current || b.disabled) return;
  const text = warnText(plainText()), n = buildPieces().filter(p => p.kind === "img").length;
  const how = await copyHtml(warnHtml(buildHtml()), text);
  if (how === "html") { b.textContent = n ? "✓ 그림 " + n + "장과 글 복사됨" : "✓ 복사됨"; $("#fbBox").hidden = true; }
  else if (how === "text") { b.textContent = "✓ 글만 복사됨 (사진은 한 칸씩 복사로)"; }
  else { b.textContent = "복사가 안 됐어요"; showFb(text); }
  setTimeout(() => paintPc(), 2500);
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
function closeSheets() { $("#shade").hidden = true; $("#histSheet").hidden = true; $("#setSheet").hidden = true; }
function openSet() {
  const s = settings();
  $("#contactIn").value = s.contact || ""; $("#sArea").value = s.area || ""; $("#sDirect").value = s.direct || "";
  $("#sWarranty").value = s.warranty || ""; $("#sLicense").value = s.license || ""; $("#sPrep").value = s.prep || "";
  $("#sTags").value = s.tags || ""; $("#setInfo").textContent = "";
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
$("#modeSwitch").addEventListener("click", () => {
  closeSheets();
  if (mode === "demo") { ls.set(K.mode, "live"); const c = ls.get(K.code, ""); if (c) { $("#codeIn").value = ""; enterCode(c); } else show("gate"); }
  else enterDemo();
});
$("#codeReset").addEventListener("click", () => { closeSheets(); ls.del(K.code); code = ""; $("#codeIn").value = ""; gateErr(""); show("gate"); });
$("#verInfo").textContent = "앱 버전 " + APP_VERSION;

/* ---------- 시작 ---------- */
document.querySelectorAll(".chips").forEach(buildChips); setType();
paintChips(); renderPhotos(); refreshGen();
(function start() {
  const m = ls.get(K.mode, ""), c = ls.get(K.code, "");
  if (m === "demo") { enterDemo(); return; }
  if (c) { code = c; mode = "live"; show("app"); paintMode(); api("/api/check").then(async res => {
    const d = res.ok ? await res.json() : null;
    if (d && !d.ok) { if (d.error === "bad_code" || d.error === "no_codes") { ls.del(K.code); show("gate"); gateErr(d.message); } return; }
    if (d) { left = d.left; paintMode(); if (!d.ai) fail({ error: "no_key", message: "AI 연결 열쇠가 아직 설정되지 않았어요. 회사에 알려 주세요. 그동안은 체험 모드로 둘러볼 수 있어요." }); }
  }).catch(() => {}); return; }
  show("gate");
})();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
})();
