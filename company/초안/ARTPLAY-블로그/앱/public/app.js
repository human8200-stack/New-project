/* ARTPLAY 블로그 글쓰기 — 독립판 화면 코드
   흐름: 접속 코드(또는 체험) → 사진·고르기 → [글 만들기] → ① 사진 읽기 /api/photos → ② 글쓰기 /api/write(흘려 받기) → 결과
   글 규칙은 서버의 netlify/lib/prompt.mjs 한 곳에 있어요. 여기에는 화면과 마지막 안전 점검만 있어요. */
(function () {
"use strict";
const APP_VERSION = "1.0.0 (2026-11-09)";
const $ = s => document.querySelector(s);
const K = { code: "artplay-code", mode: "artplay-mode", hist: "artplay-history-v1", set: "artplay-settings-v1" };
const SIDES = [
  { key: "before", label: "전", max: 6 },
  { key: "during", label: "공사 중", max: 3 },
  { key: "after", label: "후", max: 6 }
];
const MAX_EDGE = 1280, JPEG_Q = 0.82, BODY_BUDGET = 4.6e6; // base64 글자 수 합계 상한 (Netlify 6MB 안쪽)

// 고르기 버튼 (값 v는 서버로 가는 값, t는 화면 글자)
const GROUPS = {
  space: { multi: true, items: ["현관", "거실", "주방", "침실", "욕실", "전체", "상가", "기타"] },
  size: { multi: false, items: ["10평 이하", "10평대", "20평대", "30평대", "40평 이상", "모름"] },
  consent: { multi: false, keep: true, items: [{ v: "photo", t: "사진만" }, { v: "region", t: "지역까지" }, { v: "none", t: "동의 안 받음" }] },
  period: { multi: false, items: ["1주 안", "2~3주", "4~6주", "그 이상"] },
  perk: { multi: false, keep: true, items: [{ v: "none", t: "없음" }, { v: "sponsor", t: "자재 협찬" }, { v: "discount", t: "할인·무료 시공" }] },
  kind: { multi: false, keep: true, items: [{ v: "review", t: "시공 후기" }, { v: "compare", t: "전후 비교" }, { v: "tip", t: "공간 팁" }] },
  work: { multi: true, items: ["전체 리모델링", "부분 공사", "가구 제작", "조명", "도배·도장", "타일", "욕실 공사"] },
  live: { multi: false, items: [{ v: "yes", t: "예" }, { v: "no", t: "아니오" }] }
};
const DEFAULTS = { consent: "photo", perk: "none", kind: "review" };
const CONSENT_HELP = {
  photo: "사진만: 지역 이름 없이 써요.",
  region: "지역까지: 구·동 이름까지 써요. 동·호수와 단지명은 어떤 경우에도 안 써요.",
  none: "동의를 받지 않았으면 글을 만들지 않아요."
};
// 마지막 안전 점검 (AI가 실수로 넣었을 때 알려 주기). 규칙 원본은 netlify/lib/prompt.mjs
const BANNED = ["최고", "최상", "최초", "1위", "No.1", "넘버원", "유일", "독보적", "업계 최다", "최저가", "가장 싼", "최소가", "무조건", "100%", "완벽", "절대", "평생", "하자 제로", "선착순", "이번 달만", "마감 임박", "퀄리티", "소정의", "체험단"];

const sel = {}; Object.keys(GROUPS).forEach(g => { sel[g] = new Set(DEFAULTS[g] ? [DEFAULTS[g]] : []); });
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
document.querySelectorAll(".chips").forEach(box => {
  const g = box.dataset.g, G = GROUPS[g];
  G.items.forEach(it => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = txt(it); b.dataset.v = val(it);
    b.addEventListener("click", () => {
      const v = val(it);
      if (G.multi) { sel[g].has(v) ? sel[g].delete(v) : sel[g].add(v); }
      else if (sel[g].has(v) && !G.keep) sel[g].clear();
      else { sel[g].clear(); sel[g].add(v); }
      paintChips(); onChoice();
    });
    box.appendChild(b);
  });
});
function paintChips() {
  document.querySelectorAll(".chips").forEach(box => {
    const g = box.dataset.g;
    box.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", sel[g].has(c.dataset.v) ? "true" : "false"));
  });
}
const one = g => [...sel[g]][0] || "";
function onChoice() {
  $("#spaceEtc").hidden = !sel.space.has("기타");
  $("#region").hidden = one("consent") !== "region";
  $("#consentHelp").textContent = CONSENT_HELP[one("consent")] || "";
  if (sel.space.size) { $("#gSpace").classList.remove("warn"); $("#spaceWarn").hidden = true; }
  if (sel.size.size) { $("#gSize").classList.remove("warn"); $("#sizeWarn").hidden = true; }
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
        if (blob.size > 700e3) blob = await shrink(f, MAX_EDGE, 0.7);
        list.push({ id: ++pid, blob, url: URL.createObjectURL(blob) });
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
  if (mode === "demo") { s.innerHTML = "<b>체험 모드</b> · 미리 써 둔 예시 글이 나와요"; }
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
    headers: { "content-type": "application/json", "x-shop-code": code },
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
    spaces, size: one("size"), consent: one("consent") || "photo", region: $("#region").value.trim(),
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
  const tags = (sec["해시태그"] || "").replace(/\s+/g, " ").trim();
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
  const ol = $("#rOrder"); ol.textContent = "";
  (r.order || []).forEach(o => { const li = document.createElement("li"); li.textContent = o; ol.appendChild(li); });
  $("#rOrderBox").hidden = !(r.order && r.order.length);
  let body = r.body || "";
  if (contact && body.includes("{연락처}")) { body = body.split("{연락처}").join(contact); r.body = body; }
  $("#rSummary").value = r.summary || ""; $("#rBody").value = body; $("#rTags").value = r.tags || "";
  const checks = (r.checks || []).slice();
  if (body.includes("{연락처}")) checks.push("글 끝 {연락처}를 실제 연락처로 바꿔 주세요. (설정에 넣어 두면 자동으로 바뀌어요)");
  checks.push("사진 번호(📷 사진 1…) 자리에 같은 번호 사진을 넣고, 그 줄은 지워 주세요.");
  const ck = $("#rChecks"); ck.textContent = "";
  checks.forEach(c => { const li = document.createElement("li"); li.textContent = c; ck.appendChild(li); });
  stat();
  $("#fbBox").hidden = true; $("#result").hidden = false;
  requestAnimationFrame(() => { fit($("#rBody")); fit($("#rSummary")); fit($("#rTags")); });
}
function stat() {
  const n = ($("#rSummary").value + "\n\n" + $("#rBody").value).trim().length;
  $("#rStat").textContent = "본문 " + n.toLocaleString("ko-KR") + "자 (요약 칸 포함, 1,500~2,000자가 좋아요)";
}
["#rBody", "#rSummary", "#rTags"].forEach(id => $(id).addEventListener("input", e => {
  fit(e.target); stat();
  if (current) { current.summary = $("#rSummary").value; current.body = $("#rBody").value; current.tags = $("#rTags").value; saveCurrentSoon(); }
}));

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
  $("#retryBtn").hidden = ["no_key", "no_codes", "bad_code", "locked", "daily_limit", "no_consent", "key_bad", "billing"].includes(err);
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
  if (!sel.space.size) {
    $("#gSpace").classList.add("warn"); $("#spaceWarn").hidden = false;
    $("#gSpace").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
  }
  if (!sel.size.size) {
    $("#gSize").classList.add("warn"); $("#sizeWarn").hidden = false;
    $("#gSize").scrollIntoView({ behavior: "smooth", block: "center" }); return false;
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

async function runDemo() {
  const list = allPhotos(); const f = fields();
  if (list.length) { progress("사진 읽는 중… (체험)", 15); await sleep(700); }
  const sample = (window.ARTPLAY_DEMO || {})[f.kind === "compare" ? "compare" : "review"] || "";
  const info = shopInfoBlock();
  const full = sample.replace("{안내}\n\n", info ? info + "\n\n" : "");
  let shown = 0; const step = Math.ceil(full.length / 30);
  while (shown < full.length) { shown = Math.min(full.length, shown + step); progress("글 쓰는 중… " + shown.toLocaleString("ko-KR") + "자 (체험)", 20 + 80 * shown / full.length); await sleep(60); }
  const p = parse(full);
  const order = (p.body.match(/^📷 사진 \d+: .+$/gm) || []).map(l => l.replace("📷 ", "").replace(":", " —"))
    .sort((a, b) => parseInt(a.replace(/\D+/, ""), 10) - parseInt(b.replace(/\D+/, ""), 10));
  const alerts = ["체험 모드 예시 글이에요. 내 사진·메모는 들어가지 않았어요. 그대로 올리면 안 돼요."];
  if (f.kind === "tip") alerts.push("공간 팁 글은 체험 예시가 없어 시공 후기 예시를 보여 드려요.");
  const r = { id: Date.now(), date: new Date().toISOString(), space: f.spaces.join(", "), sel: 0, demo: true,
    titles: p.titles, summary: p.summary, body: p.body, tags: p.tags, checks: p.checks, alerts: alerts.concat(safety(p, f)), order };
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
      const data = []; let total = 0;
      for (const p of list) { const d = await b64(p.blob); total += d.length; data.push({ side: p.side, data: d }); }
      if (total > BODY_BUDGET) throw { error: "too_big", message: "사진이 너무 커요. 사진 몇 장을 빼고 다시 해 주세요." };
      const res = await api("/api/photos", { photos: data });
      if (!res.ok) {
        const e = await readErr(res);
        if (["no_key", "no_codes", "bad_code", "locked", "daily_limit", "key_bad", "billing"].includes(e.error)) throw e;
        alerts.push("사진 내용을 읽지 못해 사진은 순서만 넣었어요.");
      } else {
        const d = await res.json();
        if (Array.isArray(d.photos)) descs = d.photos.map((x, i) => ({ side: list[i].side, desc: x.desc, seen: x.seen || "", privacy: x.privacy || [] }));
        if (!d.read) alerts.push("사진 내용을 다 읽지 못해 일부는 순서만 넣었어요.");
        descCache = { key, descs };
      }
    }
    descs.forEach((d, i) => { if (d.privacy && d.privacy.length) alerts.unshift("사진 " + (i + 1) + "에 " + d.privacy.join("·") + "이(가) 보여요. 블로그에 올리기 전에 가려 주세요."); });

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
        else if (o.done) end = o;
        else if (o.error) err = o;
        if (o.left != null) left = o.left;
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
    const r = { id: Date.now(), date: new Date().toISOString(), space: f.spaces.join(", "), sel: 0,
      titles: p.titles.length ? p.titles : ["(제목 없음)"], summary: p.summary, body: p.body, tags: p.tags, checks: p.checks,
      alerts: alerts.concat(safety(p, f)), order };
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
  ["#spaceEtc", "#region", "#memo", "#cost", "#quote"].forEach(id => { $(id).value = ""; });
  descCache = null; current = null; $("#result").hidden = true; $("#failBox").hidden = true; $("#more").open = false;
  paintChips(); renderPhotos(); msg(""); window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- 복사 ---------- */
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
    const text = COPY[id]();
    const done = () => { b.textContent = "✓ 복사됨"; $("#fbBox").hidden = true; setTimeout(() => { b.textContent = label; }, 1500); };
    const fallback = () => { const f = $("#fbText"); f.value = text; $("#fbBox").hidden = false; fit(f); f.focus(); f.select(); try { f.setSelectionRange(0, text.length); } catch (_) {} };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (_) { fallback(); }
  });
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
paintChips(); renderPhotos(); refreshGen();
(function start() {
  const m = ls.get(K.mode, ""), c = ls.get(K.code, "");
  if (m === "demo") { enterDemo(); return; }
  if (c) { code = c; mode = "live"; show("app"); paintMode(); api("/api/check").then(async res => {
    if (res.ok) { const d = await res.json(); left = d.left; paintMode(); if (!d.ai) fail({ error: "no_key", message: "AI 연결 열쇠가 아직 설정되지 않았어요. 회사에 알려 주세요. 그동안은 체험 모드로 둘러볼 수 있어요." }); }
    else { const e = await readErr(res); if (e.error === "bad_code" || e.error === "no_codes") { ls.del(K.code); show("gate"); gateErr(e.message); } }
  }).catch(() => {}); return; }
  show("gate");
})();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
})();
