/* 엄마의 영양 노트 블로그 글쓰기 — 화면 코드
   흐름: 접속 코드(또는 체험) → 노트 고르기(카드+원고 한 번에) + 회장님 한마디 → [글 만들기]
        → (회사 노트가 아닌 사진이 있을 때만) ① 사진 읽기 /api/photos → ② 글쓰기 /api/write(흘려 받기)
        → 결과: [네이버 블로그로 보내기] = 본문+태그 복사 + 사진을 공유 창으로 (안 되면 사진 저장 + 전체 복사)
   글 규칙: AI 지시문은 netlify/lib/prompt.mjs, 영양소 표·금지어·규칙 검사기는 rules.js (서버와 같이 씀) */
import { checkPost, HANMADI_SLOT, DEFAULT_SOURCE, DEFAULT_TAGS } from "./rules.js";
import { DEMO } from "./demo.js";

const APP_VERSION = "1.0.0 (2026-11-11, 첫판: 노트 불러오기·네이버 블로그로 보내기)";
const $ = s => document.querySelector(s);
const K = { code: "nutri-code", mode: "nutri-mode", hist: "nutri-history-v1", set: "nutri-settings-v1" };
const MAX_PHOTOS = 10;
const READ_EDGE = 960, READ_Q = 0.8;   // AI가 카드 글자를 읽을 만큼만 줄여 보냄 (한 장 약 1,000토큰)
const SAVE_EDGE = 2048, SAVE_Q = 0.9;  // 블로그에 올릴 사진 (위치 정보 같은 숨은 정보는 빠짐)

// 영양 노트 첫 4주 (건강계정-계획.md 5장). 회사가 카드·원고를 만든 노트는 notes/notes.json 에서 불러온다.
const PLAN = [
  ["No.01", "밥 한 숟가락이 세포까지 가는 길"], ["No.02", "장벽, 몸 안과 밖을 가르는 성벽"],
  ["No.03", "장 속 균은 셋 — 유익균·유해균·눈치 보는 중간균"], ["No.04", "같은 밥, 다른 장 — 장 속 균은 지문처럼 달라요"],
  ["No.05", "식이섬유 두 종류, 장 속 유익균의 밥"], ["No.06", "장을 돕는 아침 순서"],
  ["No.07", "장은 면역세포가 배우는 교실"], ["No.08", "장과 피부, 안팎의 두 장벽"],
  ["No.09", "통째로, 꼭꼭 씹어서"], ["No.10", "배 속과 머릿속은 이어져 있어요 — 저녁밥과 잠"],
  ["No.11", "변·가스·더부룩함, 장이 보내는 신호 읽기"], ["No.12", "장을 지치게 하는 하루 + 4주 노트 한 장 정리"]
];

let NOTES = [];
let mode = null, code = "", current = null, busy = false, shrinking = 0, pid = 0, readCache = null, left = null, wake = null;
const photos = []; // { id, file, url, note: true면 회사 노트 카드(읽기 생략), desc }

/* ---------- 저장소 ---------- */
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};
function settings() { try { return JSON.parse(ls.get(K.set, "{}")) || {}; } catch (_) { return {}; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => (n < 10 ? "0" : "") + n;

/* ---------- 노트 고르기 ---------- */
async function loadNotes() {
  try { const r = await fetch("notes/notes.json", { cache: "no-cache" }); const d = await r.json(); NOTES = Array.isArray(d.notes) ? d.notes : []; }
  catch (_) { NOTES = []; }
  const s = $("#noteSel"); s.textContent = "";
  const add = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); };
  add("", "노트를 골라 주세요");
  PLAN.forEach(([no, title]) => {
    const n = NOTES.find(x => x.no === no);
    add(n ? "note:" + n.id : "plan:" + no, no + " " + title + (n ? " ✓ 카드·원고 있음" : ""));
  });
  NOTES.filter(n => !PLAN.some(p => p[0] === n.no)).forEach(n => add("note:" + n.id, n.no + " " + n.title + " ✓ 카드·원고 있음"));
  add("free", "직접 쓰기 (자유 주제)");
  const first = NOTES[0]; if (first) { s.value = "note:" + first.id; await pickNote(); }
}
function topicText() {
  const v = $("#noteSel").value;
  if (v === "free") return $("#freeTopic").value.trim();
  if (v.startsWith("note:")) { const n = NOTES.find(x => "note:" + x.id === v); return n ? "영양 노트 " + n.no + " " + n.title + (n.toc ? " (" + n.toc + ")" : "") : ""; }
  if (v.startsWith("plan:")) { const p = PLAN.find(x => "plan:" + x[0] === v); return p ? "영양 노트 " + p[0] + " " + p[1] : ""; }
  return "";
}
function nextOf(no) { const i = PLAN.findIndex(p => p[0] === no); return i >= 0 && PLAN[i + 1] ? PLAN[i + 1][0] + " " + PLAN[i + 1][1] : ""; }
async function pickNote() {
  const v = $("#noteSel").value;
  $("#freeTopic").hidden = v !== "free";
  // 지난 노트에서 불러온 카드는 뺀다 (회장님이 직접 넣은 사진은 남김)
  for (let i = photos.length - 1; i >= 0; i--) if (photos[i].note) { URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); }
  readCache = null;
  const info = $("#noteInfo");
  if (v.startsWith("note:")) {
    const n = NOTES.find(x => "note:" + x.id === v);
    $("#manuscript").value = n.manuscript || ""; $("#nextNote").value = n.next || nextOf(n.no);
    info.textContent = "카드 불러오는 중…"; renderPhotos(); refreshGen();
    shrinking++; refreshGen();
    let got = 0;
    try {
      const cards = [];
      for (const c of (n.cards || []).slice(0, MAX_PHOTOS)) {
        try {
          const r = await fetch(c.file); if (!r.ok) continue;
          const b = await r.blob();
          const name = c.file.split("/").pop();
          const f = new File([b], name, { type: b.type || "image/png" });
          cards.push({ id: ++pid, file: f, url: URL.createObjectURL(b), note: true, desc: c.desc || name }); got++;
        } catch (_) {}
      }
      photos.unshift(...cards); photos.splice(MAX_PHOTOS);
    } finally { shrinking--; }
    info.textContent = "✓ " + n.no + " 카드 " + got + "장과 원고를 불러왔어요. 한마디만 넣고 [글 만들기]를 누르세요.";
  } else if (v.startsWith("plan:")) {
    $("#manuscript").value = ""; $("#nextNote").value = nextOf(v.slice(5));
    info.textContent = "이 노트는 아직 회사 카드·원고가 없어요. 원고 없이 쓰면 사실 확인이 더 필요해요.";
  } else if (v === "free") {
    $("#manuscript").value = ""; $("#nextNote").value = "";
    info.textContent = "주제를 한 줄로 적어 주세요. 사진·원고는 [더 넣기]에서 넣을 수 있어요.";
  } else info.textContent = "";
  renderPhotos(); refreshGen();
}
$("#noteSel").addEventListener("change", pickNote);

/* ---------- 사진 ---------- */
function loadImg(file) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => res(i); i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; i.src = u; });
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
function b64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(blob); }); }
function msg(t) { const m = $("#photoMsg"); m.textContent = t || ""; m.hidden = !t; }
async function addFiles(files) {
  const arr = Array.from(files || []); const room = MAX_PHOTOS - photos.length; let failed = 0;
  shrinking++; renderPhotos(); refreshGen();
  try {
    for (const f of arr.slice(0, Math.max(0, room))) {
      try { const prev = await shrink(f, 400, 0.7); photos.push({ id: ++pid, file: f, url: URL.createObjectURL(prev), note: false }); }
      catch (_) { failed++; }
    }
  } finally { shrinking--; }
  const t = [];
  if (arr.length > room) t.push("사진은 10장까지 넣을 수 있어요.");
  if (failed) t.push(failed + "장은 열 수 없었어요.");
  readCache = null; renderPhotos(); msg(t.join(" ")); refreshGen();
}
function renderPhotos() {
  const strip = $("#strip"); strip.textContent = "";
  photos.forEach((p, i) => {
    const d = document.createElement("div"); d.className = "ph";
    const im = document.createElement("img"); im.src = p.url; im.alt = "사진 " + (i + 1);
    const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "사진 " + (i + 1) + " 빼기");
    x.disabled = shrinking > 0 || busy;
    const xs = document.createElement("span"); xs.textContent = "×"; x.appendChild(xs);
    x.addEventListener("click", () => { URL.revokeObjectURL(p.url); photos.splice(i, 1); readCache = null; msg(""); renderPhotos(); });
    const num = document.createElement("div"); num.className = "num"; num.textContent = pad2(i + 1);
    d.append(im, x, num); strip.appendChild(d);
  });
  if (photos.length < MAX_PHOTOS) {
    const a = document.createElement("label"); a.className = "add"; a.setAttribute("aria-label", "사진 넣기");
    a.appendChild(document.createTextNode("+"));
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    const off = shrinking > 0 || busy; inp.disabled = off; a.classList.toggle("off", off);
    inp.addEventListener("change", () => addFiles(inp.files));
    a.appendChild(inp); strip.appendChild(a);
  }
}

/* ---------- 화면 바꾸기 ---------- */
function show(which) {
  $("#gate").hidden = which !== "gate"; $("#app").hidden = which !== "app"; $("#topBtns").hidden = which !== "app";
  if (which === "gate") $("#a2hs").hidden = !(/iP(hone|od|ad)/.test(navigator.userAgent) && !window.navigator.standalone);
}
function paintMode() {
  const bar = $("#modeBar"); bar.textContent = ""; bar.className = "modebar" + (mode === "demo" ? " demo" : "");
  const s = document.createElement("span");
  if (mode === "demo") s.innerHTML = "<b>체험 모드</b> · 예시 글을 보여 줘요 (돈이 들지 않아요)";
  else s.textContent = left == null ? "접속됨" : "오늘 남은 글 " + left + "편";
  bar.appendChild(s);
  $("#modeSwitch").textContent = mode === "demo" ? "체험 끝내고 코드 넣기" : "체험 모드로 보기";
}
function gateErr(t) { const e = $("#gateErr"); e.textContent = t || ""; e.hidden = !t; }
function api(path, body) {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-access-code": encodeURIComponent(code) }, body: body ? JSON.stringify(body) : "{}" });
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
    if (!res.ok) { gateErr((await readErr(res)).message); return; }
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
  return { topic: topicText(), hanmadi: $("#hanmadi").value.trim(), manuscript: $("#manuscript").value.trim(), next: $("#nextNote").value.trim(), source: st.source || DEFAULT_SOURCE, tags: st.tags || DEFAULT_TAGS };
}

/* ---------- 결과 나누기 ---------- */
function parse(t) {
  t = String(t || "").replace(/\*\*(\[(?:제목|본문|태그|해시태그|확인할 점)\])\*\*/g, "$1");
  const re = /\[(제목|본문|태그|해시태그|확인할 점)\]/g, marks = [], sec = {}; let m;
  while ((m = re.exec(t))) marks.push({ k: m[1] === "해시태그" ? "태그" : m[1], i: m.index, e: re.lastIndex });
  marks.forEach((mk, j) => { if (sec[mk.k] == null) sec[mk.k] = t.slice(mk.e, j + 1 < marks.length ? marks[j + 1].i : t.length).replace(/^\s*\n/, "").replace(/\s+$/, ""); });
  const titles = (sec["제목"] || "").split("\n").map(s => s.replace(/^\s*\d+\s*[.)]\s*/, "").trim()).filter(Boolean).slice(0, 3);
  const body = (sec["본문"] || "").replace(/^\s*\n/, "").trim();
  const tags = (sec["태그"] || "").replace(/\s+/g, " ").trim();
  const checks = (sec["확인할 점"] || "").split("\n").map(s => s.replace(/^\s*[-•·]\s*/, "").trim()).filter(s => s && s !== "없음");
  return { titles, body, tags, checks, ok: marks.length > 0 && titles.length > 0 && !!body };
}

/* ---------- 결과 그리기 ---------- */
function fit(t) { t.style.height = "auto"; t.style.height = (t.scrollHeight + 4) + "px"; }
function renderResult(r) {
  current = r;
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
  $("#rBody").value = r.body || ""; $("#rTags").value = r.tags || "";
  $("#fbBox").hidden = true; $("#result").hidden = false;
  runChecks(); paintSend();
  requestAnimationFrame(() => { fit($("#rBody")); fit($("#rTags")); });
}
// 규칙 검사기 (rules.js) + AI가 적은 확인할 점
function runChecks() {
  if (!current) return;
  const res = checkPost({ titles: current.titles, body: $("#rBody").value, tags: $("#rTags").value });
  const box = $("#rChecks"); box.textContent = "";
  const block = (head, items, red) => {
    if (!items.length) return;
    const h = document.createElement("p"); h.className = "ck-head" + (red ? " red" : ""); h.textContent = head; box.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "ck" + (red ? " ck-red" : "");
    items.forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }); box.appendChild(ul);
  };
  block("꼭 고칠 것 (" + res.red.length + ")", res.red, true);
  block("한 번 더 볼 것", res.check.concat(current.checks || []), false);
  if (!res.red.length) { const p = document.createElement("p"); p.className = "ok"; p.textContent = "✓ 금지어·단정 표현 검사 통과"; box.prepend(p); }
  const n = $("#rBody").value.trim().length;
  $("#rStat").textContent = "본문 " + n.toLocaleString("ko-KR") + "자 (1,500~2,200자가 좋아요)";
}
let ckT = null;
["#rBody", "#rTags"].forEach(id => $(id).addEventListener("input", e => {
  fit(e.target);
  if (!current) return;
  current.body = $("#rBody").value; current.tags = $("#rTags").value;
  clearTimeout(ckT); ckT = setTimeout(() => { runChecks(); saveCurrent(); }, 500);
}));

/* ---------- 네이버 블로그로 보내기 ---------- */
// 보낼 글 = 본문 + 태그 (제목은 따로: 블로그 제목 칸에 붙여 넣음). 네이버 블로그는 본문 속 #태그를 태그로 받아요.
function sendText() { return [$("#rBody").value.trim(), $("#rTags").value.trim()].filter(Boolean).join("\n\n"); }
function photoKey() { return photos.map(p => p.id).join(","); }
let saveJob = null, copiedForSend = false;
function hasLivePhotos() { return !!(current && current.photoKey && current.photoKey === photoKey() && photos.length); }
function canShareFiles(files) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: files || [new File([new Blob(["x"], { type: "image/jpeg" })], "t.jpg", { type: "image/jpeg" })] })); }
  catch (_) { return false; }
}
function paintSend() {
  const live = hasLivePhotos();
  if (live) prepareSave(); else saveJob = null;
  const share = canShareFiles();
  const note = $("#sendNote");
  copiedForSend = false;
  if (!live) {
    $("#sendBtn").textContent = "글 복사하기";
    note.textContent = photos.length ? "사진은 방금 만든 글에서만 보낼 수 있어요. 지금은 글만 복사돼요." : "사진이 없어 글만 복사돼요. 네이버 블로그 앱 글쓰기 칸에 붙여 넣으세요.";
  } else if (!share) {
    $("#sendBtn").textContent = "글 복사 + 사진 저장";
    note.textContent = "이 휴대폰(브라우저)은 바로 보내기가 안 돼요. 글을 복사하고 사진을 01, 02… 순서로 저장해요. 블로그 앱에서 사진 버튼 → 01부터 순서대로 고르고, 글 칸에 붙여 넣으세요.";
  } else {
    $("#sendBtn").textContent = "네이버 블로그로 보내기";
    note.textContent = "사진 " + photos.length + "장이 글 맨 위에 순서대로 들어가요.";
  }
  paintSaveBtn();
}
function prepareSave() {
  const key = current.photoKey;
  if (saveJob && saveJob.key === key) { paintSaveBtn(); return; }
  saveJob = { key, files: null };
  const job = saveJob; paintSaveBtn();
  (async () => {
    const files = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i]; let blob;
      try { blob = await shrink(p.file, SAVE_EDGE, SAVE_Q); } catch (_) { blob = p.file; }
      files.push(new File([blob], "nutri_" + pad2(i + 1) + ".jpg", { type: "image/jpeg", lastModified: Date.now() + i }));
    }
    if (saveJob === job) { job.files = files; paintSaveBtn(); }
  })();
}
function paintSaveBtn() {
  const b = $("#saveBtn"), s = $("#sendBtn");
  const live = hasLivePhotos(), ready = !!(saveJob && saveJob.files);
  b.hidden = !live;
  b.disabled = !ready; b.textContent = ready ? "사진 순서대로 저장 (" + saveJob.files.length + "장)" : "사진 준비 중…";
  $("#saveNote").textContent = live ? "01, 02… 순서대로 사진 앱에 저장해요. 공유 창이 뜨면 [이미지 " + photos.length + "개 저장]을 누르세요." : "";
  s.disabled = live && !ready;
  if (live && !ready) s.textContent = "사진 준비 중…";
}
function copyText(text) {
  // 누른 그 순간에 바로 부른다 (아이폰은 누른 직후에만 복사·공유를 허락함)
  try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false); } catch (_) {}
  return Promise.resolve(false);
}
function showFallback(text) { const f = $("#fbText"); f.value = text; $("#fbBox").hidden = false; fit(f); f.focus(); f.select(); try { f.setSelectionRange(0, text.length); } catch (_) {} }
async function downloadFiles(files) {
  for (const f of files) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000);
    await sleep(250);
  }
}
$("#sendBtn").addEventListener("click", async () => {
  if (!current) return;
  const b = $("#sendBtn"), text = sendText();
  const live = hasLivePhotos(), files = saveJob && saveJob.files;
  // 1) 글 복사 (두 번째 누를 때는 이미 복사됐으면 건너뜀 — 공유 창만 다시)
  const copyP = copiedForSend ? Promise.resolve(true) : copyText(text);
  // 2) 사진 공유 창 (복사와 같은 순간에 부른다)
  let shareP = null;
  if (live && files && canShareFiles(files)) {
    try { shareP = navigator.share({ files }); } catch (e) { shareP = Promise.reject(e); }
  }
  const copied = await copyP;
  if (copied) copiedForSend = true; else showFallback(text);
  if (shareP) {
    try { await shareP; b.textContent = "✓ 보냈어요. 블로그 글 칸에 붙여 넣으세요"; }
    catch (e) {
      if (e && e.name === "AbortError") b.textContent = copied ? "✓ 글은 복사됐어요. 다시 누르면 사진 창이 떠요" : "다시 눌러 주세요";
      else b.textContent = "한 번 더 눌러 주세요 (사진 창 열기)";
    }
  } else if (live && files) {
    await downloadFiles(files); // 공유가 안 되는 곳: 사진은 파일로 저장
    b.textContent = copied ? "✓ 글 복사 + 사진 저장 시작" : "사진 저장 시작 (글은 아래에서 길게 눌러 복사)";
  } else {
    b.textContent = copied ? "✓ 글을 복사했어요" : "아래 글을 길게 눌러 복사해 주세요";
  }
  setTimeout(paintSend, 5000);
});
$("#saveBtn").addEventListener("click", async () => {
  if (!saveJob || !saveJob.files) return;
  const files = saveJob.files, b = $("#saveBtn");
  try {
    if (canShareFiles(files)) { await navigator.share({ files }); b.textContent = "✓ 저장 창을 열었어요"; setTimeout(paintSaveBtn, 2000); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  await downloadFiles(files);
  b.textContent = "✓ 내려받기 시작"; setTimeout(paintSaveBtn, 2000);
});

/* ---------- 복사 버튼 ---------- */
const COPY = {
  cpTitle: () => current.titles[current.sel] || "",
  cpBody: () => $("#rBody").value.trim(),
  cpTags: () => $("#rTags").value.trim(),
  cpAll: () => [current.titles[current.sel] || "", $("#rBody").value.trim(), $("#rTags").value.trim()].filter(Boolean).join("\n\n")
};
Object.keys(COPY).forEach(id => {
  const b = $("#" + id), label = b.textContent;
  b.addEventListener("click", async () => {
    if (!current) return;
    const text = COPY[id]();
    if (await copyText(text)) { b.textContent = "✓ 복사됨"; $("#fbBox").hidden = true; setTimeout(() => { b.textContent = label; }, 1500); }
    else showFallback(text);
  });
});

/* ---------- 글 만들기 ---------- */
function refreshGen() {
  const b = $("#genBtn");
  b.disabled = busy || shrinking > 0;
  b.textContent = busy ? "만드는 중…" : shrinking > 0 ? "사진 준비 중…" : "글 만들기";
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
  $("#failCode").hidden = err !== "bad_code";
  $("#retryBtn").hidden = ["no_key", "no_codes", "bad_code", "locked", "daily_limit", "all_limit", "no_store", "key_bad", "billing", "no_topic"].includes(err);
  $("#failBox").hidden = false;
  $("#failBox").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function keepAwake(on) {
  try { if (on && "wakeLock" in navigator) wake = await navigator.wakeLock.request("screen"); else if (!on && wake) { await wake.release(); wake = null; } }
  catch (_) { wake = null; }
}
async function generate() {
  if (busy || shrinking > 0) return;
  $("#failBox").hidden = true;
  if (!topicText()) { fail({ error: "no_topic", message: $("#noteSel").value === "free" ? "주제를 한 줄 적어 주세요." : "노트를 먼저 골라 주세요." }); return; }
  busy = true; refreshGen(); renderPhotos(); keepAwake(true);
  try { if (mode === "demo") await runDemo(); else await runLive(); }
  finally { busy = false; progress(null); refreshGen(); renderPhotos(); keepAwake(false); }
}
function finish(p, alerts, f) {
  const r = { id: Date.now(), date: new Date().toISOString(), topic: f.topic, sel: 0, demo: mode === "demo",
    titles: p.titles, body: p.body, tags: p.tags, checks: p.checks, alerts, photoKey: photoKey() };
  renderResult(r); addHistory(r);
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function runDemo() {
  const f = fields();
  const full = DEMO.replace("{한마디}", f.hanmadi || HANMADI_SLOT)
    .replace("{다음}", f.next || "No.02 장벽, 몸 안과 밖을 가르는 성벽")
    .replace("{출처}", f.source).replace("{고정태그}", f.tags);
  for (let i = 1; i <= 20; i++) { progress("글 쓰는 중… (체험)", i * 5); await sleep(50); }
  const alerts = ["체험 모드 — 미리 써 둔 No.01 예시 글이에요. 실제로는 AI가 고른 노트와 한마디를 보고 새로 써요."];
  if (!/No\.01/.test(f.topic)) alerts.push("체험 예시는 No.01 한 편만 있어요.");
  finish(parse(full), alerts, f);
}
async function runLive() {
  const f = fields(); const alerts = [];
  const key = photoKey();
  // 회사 노트 카드는 원고에 글이 다 있어서 읽지 않는다 (돈 아낌). 회장님이 직접 넣은 사진만 읽는다.
  let descs = photos.map((p, i) => ({ desc: p.note ? p.desc : "사진 " + (i + 1), text: "", privacy: [] }));
  try {
    const need = photos.map((p, i) => ({ p, i })).filter(x => !x.p.note);
    if (need.length && readCache && readCache.key === key) descs = readCache.descs;
    else if (need.length) {
      progress("사진 " + need.length + "장 읽는 중… (10~20초)", 10);
      const data = [];
      for (const x of need) data.push({ data: await b64(await shrink(x.p.file, READ_EDGE, READ_Q)) });
      const res = await api("/api/photos", { photos: data });
      if (!res.ok) {
        const e = await readErr(res);
        if (["no_key", "no_codes", "bad_code", "locked", "daily_limit", "all_limit", "no_store", "key_bad", "billing"].includes(e.error)) throw e;
        alerts.push("사진 내용을 읽지 못해 사진은 순서만 넣었어요.");
      } else {
        const d = await res.json();
        (d.photos || []).forEach((x, k) => { const i = need[k] && need[k].i; if (i == null) return; descs[i] = { desc: x.desc || descs[i].desc, text: x.text || "", privacy: x.privacy || [] }; });
        if (!d.read) alerts.push("사진 일부는 내용을 읽지 못했어요.");
        readCache = { key, descs };
      }
    }
    descs.forEach((d, i) => { if (d.privacy && d.privacy.length) alerts.unshift("사진 " + (i + 1) + "에 " + d.privacy.join("·") + "이(가) 보여요. 올리기 전에 빼거나 가려 주세요."); });

    progress("글 쓰는 중… (30초~1분)", 25);
    const res = await api("/api/write", { fields: f, photos: descs.map(d => ({ desc: d.desc, text: d.text })) });
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
        if (o.t) { text += o.t; progress("글 쓰는 중… " + text.length.toLocaleString("ko-KR") + "자", 25 + Math.min(70, text.length / 35)); }
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
    finish(p, alerts, f);
  } catch (e) {
    if (e && e.error === "bad_code") ls.del(K.code);
    fail(e && e.message ? e : { message: "연결이 잘 안 됐어요. 인터넷을 확인하고 [다시 시도]를 눌러 주세요." });
  }
}
$("#genBtn").addEventListener("click", generate);
$("#retryBtn").addEventListener("click", generate);
$("#regenBtn").addEventListener("click", generate);
$("#failDemo").addEventListener("click", enterDemo);
$("#failCode").addEventListener("click", () => { ls.del(K.code); code = ""; show("gate"); });
$("#newBtn").addEventListener("click", async () => {
  photos.forEach(p => URL.revokeObjectURL(p.url)); photos.length = 0;
  ["#hanmadi", "#manuscript", "#nextNote", "#freeTopic"].forEach(id => { $(id).value = ""; });
  readCache = null; current = null; $("#result").hidden = true; $("#failBox").hidden = true; $("#more").open = false;
  $("#noteSel").value = ""; await pickNote(); msg(""); window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------- 지난 글 (이 휴대폰에만, 10개) ---------- */
function loadHist() { try { const v = JSON.parse(ls.get(K.hist, "[]")); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveHist(h) { return ls.set(K.hist, JSON.stringify(h.slice(0, 10))); }
function addHistory(r) { const h = loadHist().filter(x => x.id !== r.id); h.unshift(r); saveHist(h); }
function saveCurrent() { if (!current) return; const h = loadHist(); const i = h.findIndex(x => x.id === current.id); if (i >= 0) { h[i] = current; saveHist(h); } }
function fmtDate(iso) { try { const d = new Date(iso); return (d.getMonth() + 1) + "월 " + d.getDate() + "일"; } catch (_) { return ""; } }
function renderHist() {
  const box = $("#hList"); box.textContent = ""; const h = loadHist();
  if (!h.length) { const p = document.createElement("p"); p.className = "small"; p.textContent = "아직 만든 글이 없어요. 글을 만들면 여기에 남아요."; box.appendChild(p); return; }
  h.forEach(r => {
    const row = document.createElement("div"); row.className = "hrow";
    const o = document.createElement("button"); o.type = "button"; o.className = "hopen";
    const b = document.createElement("b"); b.textContent = r.titles[r.sel] || "(제목 없음)";
    const s = document.createElement("span"); s.textContent = fmtDate(r.date) + (r.demo ? " · 체험" : "");
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
function openSet() { const s = settings(); $("#sTags").value = s.tags || ""; $("#sSource").value = s.source || ""; $("#setInfo").textContent = ""; openSheet("#setSheet"); }
$("#histBtn").addEventListener("click", () => { renderHist(); openSheet("#histSheet"); });
$("#setBtn").addEventListener("click", openSet);
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheets));
$("#shade").addEventListener("click", closeSheets);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
$("#setSave").addEventListener("click", () => {
  const s = { tags: $("#sTags").value.trim(), source: $("#sSource").value.trim() };
  $("#setInfo").textContent = ls.set(K.set, JSON.stringify(s)) ? "✓ 저장했어요. 다음 글부터 들어가요." : "저장하지 못했어요. 사파리 개인정보 보호 모드를 꺼 주세요.";
});
$("#modeSwitch").addEventListener("click", () => {
  closeSheets();
  if (mode === "demo") { ls.set(K.mode, "live"); const c = ls.get(K.code, ""); if (c) enterCode(c); else show("gate"); }
  else enterDemo();
});
$("#codeReset").addEventListener("click", () => { closeSheets(); ls.del(K.code); code = ""; $("#codeIn").value = ""; gateErr(""); show("gate"); });
$("#verInfo").textContent = "앱 버전 " + APP_VERSION;

/* ---------- 시작 ---------- */
renderPhotos(); refreshGen(); loadNotes();
(function start() {
  const m = ls.get(K.mode, ""), c = ls.get(K.code, "");
  if (m === "demo") { enterDemo(); return; }
  if (c) {
    code = c; mode = "live"; show("app"); paintMode();
    api("/api/check").then(async res => {
      const d = res.ok ? await res.json() : null;
      if (d && !d.ok) { if (d.error === "bad_code" || d.error === "no_codes") { ls.del(K.code); show("gate"); gateErr(d.message); } return; }
      if (d) { left = d.left; paintMode(); if (!d.ai) fail({ error: "no_key", message: "AI 연결 열쇠가 아직 설정되지 않았어요. 회사에 알려 주세요. 그동안은 체험 모드로 둘러볼 수 있어요." }); }
    }).catch(() => {});
    return;
  }
  show("gate");
})();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
