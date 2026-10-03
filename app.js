'use strict';

/* global STAGES, KINDS, PROJECT_STAGES, LOG_INTERVALS, WRONG_INTERVALS, toKey, addDays, diffDays,
   remaining, needMinutes, completionFactor, effectiveBudget, defaultAvailable, generatePlan,
   applySession, subjectSnapshot, recommend, trapsFor, isActive, seedState */

const DB_NAME = 'study-routine';
const STORE = 'kv';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const SLOTS = ['아침', '오후', '저녁', '밤'];

// ---------- 저장 (IndexedDB) ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function freshState() {
  const { subjects, materials } = seedState(today(), uid);
  return {
    version: 2,
    setupDone: false,
    updatedAt: 0, // 마지막으로 사람이 바꾼 시각. 기기 간 동기화에서 더 최근 쪽이 이긴다
    settings: { examDate: '', weekdayMinutes: [360, 180, 180, 180, 180, 180, 360], aiUrl: '', aiCode: '' },
    subjects,
    materials,
    sessions: [],
    plans: {},
    logs: [],
    wrongs: [],
    drills: [],
    projects: [],
  };
}

let state;
const ui = { revealed: null, tab: 'today', openForm: null, openBook: null, setup: false };

async function load() {
  let saved = null;
  try {
    saved = await dbGet('state');
  } catch (e) {
    toast('저장소를 열 수 없어요. 개인정보 보호 모드인지 확인해 주세요.');
  }
  if (saved && saved.version === 2) {
    state = Object.assign(freshState(), saved);
    if (saved.setupDone === undefined) state.setupDone = (saved.sessions || []).length > 0;
  } else {
    state = freshState();
    if (saved) {
      // 1단계 앱 기록 옮기기
      state.logs = saved.logs || [];
      state.wrongs = saved.wrongs || [];
      state.drills = saved.drills || [];
      if (saved.exam && saved.exam.date) state.settings.examDate = saved.exam.date;
    }
    await save({ touch: false });
  }
}

// touch: 사람이 바꾼 내용이면 true (동기화 대상). 자동 생성된 계획 등은 false
async function save({ touch = true } = {}) {
  if (touch) state.updatedAt = Date.now();
  // 오래된 계획은 지워서 동기화 문서를 작게 유지한다 (분석은 최근 2주만 사용)
  const cutoff = addDays(today(), -45);
  Object.keys(state.plans).forEach((d) => { if (d < cutoff) delete state.plans[d]; });
  try {
    await dbSet('state', state);
  } catch (e) {
    toast('저장에 실패했어요.');
  }
  if (touch && window.cloud) window.cloud.schedulePush();
}

// 다른 기기에서 온 기록으로 바꾼다. 오답 사진은 이 기기에 있던 것을 유지한다
async function applyRemote(remote) {
  const localImgs = {};
  (state.wrongs || []).forEach((w) => { if (w.img) localImgs[w.id] = w.img; });
  state = Object.assign(freshState(), remote);
  state.wrongs.forEach((w) => { if (!w.img && localImgs[w.id]) w.img = localImgs[w.id]; });
  await save({ touch: false });
  renderWhenIdle();
}

// 입력 중일 때 화면을 다시 그리면 쓰던 내용이 날아가므로 입력이 끝난 뒤에 그린다
let pendingRender = false;
function renderWhenIdle() {
  const active = document.activeElement;
  if (active && active.closest('#view') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
    pendingRender = true;
    return;
  }
  render();
}

document.addEventListener('focusout', () => {
  if (!pendingRender) return;
  setTimeout(() => {
    if (pendingRender) {
      pendingRender = false;
      renderWhenIdle();
    }
  }, 300);
});

// ---------- 유틸 ----------

function today() {
  return toKey(new Date());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function options(list, selected) {
  return list.map((v) => {
    const [value, label] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

function hm(min) {
  min = Math.round(min || 0);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function pct(v) {
  return v == null ? '-' : `${Math.round(v * 100)}%`;
}

function currentSlot() {
  const h = new Date().getHours();
  if (h < 9) return '아침';
  if (h < 18) return '오후';
  if (h < 21) return '저녁';
  return '밤';
}

function subjectById(id) {
  return state.subjects.find((s) => s.id === id);
}

function materialById(id) {
  return state.materials.find((m) => m.id === id);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// 사진을 긴 변 1400px JPEG로 줄여 저장 공간을 아낀다
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없어요'));
    };
    img.src = url;
  });
}

// ---------- 계획 ----------

// 지난 날 계획에서 "못 했어요"를 누르지 않은 공부는 다 한 것으로 기록한다 (최근 7일)
function autoClosePastDays() {
  const t = today();
  let closed = 0;
  Object.keys(state.plans).filter((d) => d < t && d >= addDays(t, -7)).sort().forEach((d) => {
    state.plans[d].tasks.forEach((task) => {
      if (task.status !== 'todo' || task.type === 'project') return;
      completeTask(task, { amount: task.amount, minutes: task.minutes, auto: true, date: d });
      task.auto = true;
      closed += 1;
    });
  });
  return closed;
}

function ensurePlan() {
  const t = today();
  if (state.plans[t] || !state.setupDone) return false;
  autoClosePastDays();
  autoDiagnose();
  const available = defaultAvailable(state, t);
  const condition = '보통';
  const { minutes, factor } = effectiveBudget(state, t, available, condition);
  state.plans[t] = { available, condition, factor, budget: minutes, tasks: generatePlan(state, t, minutes) };
  return true;
}

// 아직 아무것도 시작하지 않은 오늘 계획은 상태가 바뀌면 새로 짠다
function refreshUntouchedPlan() {
  const t = today();
  const plan = state.plans[t];
  if (!plan || plan.tasks.some((x) => x.status !== 'todo')) return;
  const { minutes, factor } = effectiveBudget(state, t, plan.available, plan.condition);
  Object.assign(plan, { factor, budget: minutes, tasks: generatePlan(state, t, minutes) });
}

// 끝냈거나 진행한 과제는 남기고 나머지를 남은 시간으로 다시 짠다
function replan(remainingMinutes, condition) {
  const t = today();
  const plan = state.plans[t];
  const kept = plan.tasks.filter((x) => x.status !== 'todo');
  const exclude = [];
  kept.forEach((x) => {
    if (x.materialId) exclude.push(x.materialId);
    if (x.type === 'wrongPending') exclude.push(`wrong:${x.subjectId}`);
  });
  const keptFixed = kept.some((x) => ['review', 'wrongPhoto', 'project'].includes(x.type));
  const factor = completionFactor(state, t);
  const budget = Math.round(remainingMinutes * ({ 좋음: 1, 보통: 0.85, 피곤: 0.7 }[condition] || 1) * factor);
  const fresh = generatePlan(state, t, budget, { exclude, skipFixed: keptFixed });
  plan.tasks = kept.concat(fresh);
  plan.condition = condition;
  plan.available = kept.reduce((a, x) => a + ((x.actual && x.actual.minutes) || 0), 0) + remainingMinutes;
  plan.factor = factor;
  plan.budget = kept.reduce((a, x) => a + x.minutes, 0) + budget;
}

function recordSession(data) {
  const session = {
    id: uid(),
    date: data.date || today(),
    auto: !!data.auto,
    slot: data.slot || currentSlot(),
    type: data.type || 'material',
    materialId: data.materialId || null,
    subjectId: data.subjectId || null,
    taskId: data.taskId || null,
    planned: data.planned || null,
    amount: data.amount,
    minutes: data.minutes,
    wrong: data.wrong,
    note: data.note || '',
  };
  state.sessions.push(session);
  const out = applySession(state, session);

  const m = session.materialId ? materialById(session.materialId) : null;
  if (m && data.nextRange) m.nextRange = data.nextRange;
  if (data.addReview) {
    const subject = subjectById(session.subjectId);
    state.logs.push({
      id: uid(), created: Date.now(), date: session.date, subject: subject ? subject.name : '',
      kind: m ? m.kind : '공부', text: (data.reviewText || `${m ? m.name : ''} ${data.note || ''}`).trim(),
      step: 0, due: addDays(session.date, LOG_INTERVALS[0]),
    });
  }

  let msg = '기록했어요.';
  if (out.speed && out.speed.after > out.speed.before * 1.05) msg = '생각보다 오래 걸렸네요. 다음엔 이 교재 양을 조금 줄일게요.';
  else if (out.speed && out.speed.after < out.speed.before * 0.95) msg = '생각보다 빨랐어요. 다음엔 이 교재 양을 조금 늘릴게요.';
  return { session, msg };
}

// 할 공부 하나를 끝냈을 때. 교과서·암기·지문은 복습 카드도 자동으로 만든다
function completeTask(task, { amount, minutes, wrong = null, nextRange = '', advance: advanceStage = true, auto = false, date }) {
  if (task.type === 'project') {
    recordSession({ type: 'project', subjectId: task.subjectId, minutes, amount: 0, taskId: task.id });
    task.actual = { amount: null, minutes };
    task.status = 'done';
    const p = state.projects.find((x) => x.id === task.projectId);
    if (p && advanceStage) p.stage = Math.min(PROJECT_STAGES.length - 1, p.stage + 1);
    return '기록했어요.';
  }
  const m = task.materialId ? materialById(task.materialId) : null;
  const { what } = taskLines(task);
  const res = recordSession({
    type: task.type,
    materialId: task.materialId,
    subjectId: task.subjectId,
    taskId: task.id,
    planned: { amount: task.amount, minutes: task.minutes },
    amount,
    minutes,
    wrong,
    nextRange,
    auto,
    date,
    addReview: !!m && ['교과서', '암기', '지문'].includes(m.kind) && amount > 0,
    reviewText: m ? `${m.name} ${what}` : '',
  });
  task.actual = { amount, minutes };
  task.status = amount >= task.amount ? 'done' : amount > 0 ? 'partial' : 'skipped';
  let msg = res.msg;
  if (task.status === 'partial') msg += ' 남은 양은 다음 계획에 다시 들어가요.';
  return msg;
}

// ---------- 화면: 오늘 ----------

// 오늘 떠올릴 것: 복습할 진도 → 다시 풀 오답 순서로 한 장씩
function recallItems() {
  const t = today();
  const logs = state.logs.filter((l) => l.due && l.due <= t).sort((a, b) => a.due.localeCompare(b.due)).map((l) => ({ kind: 'log', item: l }));
  const wrongs = state.wrongs.filter((w) => w.due && w.due <= t).sort((a, b) => a.due.localeCompare(b.due)).map((w) => ({ kind: 'wrong', item: w }));
  return logs.concat(wrongs);
}

function daysAgoText(key) {
  const n = diffDays(key, today());
  if (n <= 0) return '오늘';
  if (n === 1) return '어제';
  return `${n}일 전`;
}

function recallSection() {
  const items = recallItems();
  if (!items.length) {
    return `
    <section class="recall done-all">
      <h2>오늘 떠올릴 것</h2>
      <p>다 봤어요. 다음 복습 날짜가 되면 여기에 다시 나와요.</p>
    </section>`;
  }
  const { kind, item } = items[0];
  const revealed = ui.revealed === item.id;
  let meta;
  let question;
  let extra = '';
  let answer;
  let buttons;
  if (kind === 'log') {
    meta = `${esc(item.subject)} · ${daysAgoText(item.date)} 공부한 것 · ${item.step + 1}번째 복습`;
    question = item.q ? esc(item.q) : esc(item.text);
    if (!item.q) extra = '<p class="recall-hint">책을 덮고, 이 범위의 핵심 내용 3가지를 소리 내어 말해 보세요.</p>';
    answer = item.a ? esc(item.a) : '책을 펴서 떠올린 내용이 맞는지 확인해 보세요.';
    buttons = `
      <button class="btn big good" data-action="log-ok" data-id="${item.id}">기억났어요</button>
      <button class="btn big bad" data-action="log-miss" data-id="${item.id}">헷갈려요</button>`;
  } else {
    meta = `${esc(item.subject)}${item.unit ? ` · ${esc(item.unit)}` : ''} · ${daysAgoText(item.date)} 틀린 문제`;
    question = '이 문제를 다시 풀어 보세요.';
    extra = item.img ? `<img class="wrong-img" src="${item.img}" alt="다시 풀 오답 문제">` : '';
    answer = item.note ? `지난번에 꼬인 곳: ${esc(item.note)}` : '풀이를 확인해 보세요.';
    buttons = `
      <button class="btn big good" data-action="wrong-ok" data-id="${item.id}">맞혔어요</button>
      <button class="btn big bad" data-action="wrong-miss" data-id="${item.id}">또 틀렸어요</button>`;
  }
  return `
    <section class="recall">
      <div class="recall-top">
        <h2>오늘 떠올릴 것</h2>
        <span class="recall-count">${items.length}개 남음</span>
      </div>
      <div class="recall-card">
        <div class="recall-meta">${meta}</div>
        <div class="recall-q">${question}</div>
        ${extra}
        ${revealed
    ? `<div class="recall-a">${answer}</div><div class="recall-buttons">${buttons}</div>`
    : `<button class="btn big primary wide" data-action="reveal" data-id="${item.id}">${kind === 'log' ? '답 보기' : '다 풀었어요 · 확인하기'}</button>`}
      </div>
    </section>`;
}

// 할 공부 한 줄: 무엇을 얼마나 + 어떻게
function taskLines(task) {
  const m = task.materialId ? materialById(task.materialId) : null;
  if (task.type === 'project') return { what: task.detail, how: '' };
  if (task.type === 'wrongPending') return { what: `쌓인 오답 ${task.amount}문제`, how: '다시 풀기 → 또 틀리면 원인 한 줄' };
  const start = m && m.nextRange ? `${m.nextRange}부터 ` : '';
  return { what: `${start}${task.amount}${task.unit}`, how: m ? KIND_METHOD[m.kind] || '' : '' };
}

function taskForm(task) {
  const isProblems = ['문제', '회', '지문'].includes(task.unit) && task.type !== 'project';
  const m = task.materialId ? materialById(task.materialId) : null;
  if (task.type === 'project') {
    return `
      <form class="inline-form" data-form="task" data-id="${task.id}">
        <div class="row"><div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" value="${task.minutes}" required></div></div>
        <label class="inline"><input type="checkbox" name="advance" checked> 다음 단계로 넘기기</label>
        <button class="btn primary" type="submit">저장</button>
      </form>`;
  }
  return `
    <form class="inline-form" data-form="task" data-id="${task.id}">
      <div class="row">
        <div><label>실제로 한 양 (${esc(task.unit)})</label><input type="number" name="amount" min="0" step="any" value="${task.amount}" required></div>
        <div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" value="${task.minutes}" required></div>
        ${isProblems ? '<div><label>틀린 개수 (선택)</label><input type="number" name="wrong" min="0"></div>' : ''}
      </div>
      ${m ? `<label>다음에 시작할 곳 (선택)</label><input name="nextRange" value="${esc(m.nextRange)}" placeholder="예: 3-2 단원, 0431번, p.88">` : ''}
      <button class="btn primary" type="submit">저장</button>
    </form>`;
}

function taskRow(task, index, isFirst) {
  const { what, how } = taskLines(task);
  const done = task.status !== 'todo';
  const actual = done && task.actual && task.actual.amount != null && task.actual.amount < task.amount
    ? ` · ${task.actual.amount}${esc(task.unit)}만 함 (남은 건 다음에 다시 나와요)` : task.auto ? ' · 자동 완료' : '';
  const why = isFirst && task.reasons && task.reasons.length ? `<div class="todo-why">먼저 하는 이유: ${esc(task.reasons.slice(0, 2).join(', '))}</div>` : '';
  return `
    <li class="todo-item ${task.status}${isFirst ? ' first' : ''}">
      ${done
    ? `<span class="todo-check on ${task.status}" aria-label="${task.status === 'done' ? '완료' : '일부만 함'}">${task.status === 'done' ? '✓' : '−'}</span>`
    : `<button class="todo-check" data-action="done-task" data-id="${task.id}" aria-label="다 했어요"></button>`}
      <div class="todo-body">
        <div class="todo-title"><span class="todo-num">${index + 1}</span>${esc(task.title)}</div>
        <div class="todo-what">${esc(what)}${task.status === 'skipped' ? ' · 못 함 (다음에 다시 나와요)' : actual}</div>
        ${!done ? `<div class="todo-how">${how ? `${esc(how)} · ` : ''}${hm(task.minutes)}</div>${why}
        <div class="todo-miss">
          <button class="miss-btn" data-action="miss-task" data-id="${task.id}">못 했어요</button>
          ${task.type !== 'project' ? `<button class="miss-btn" data-action="half-task" data-id="${task.id}">절반쯤 했어요</button>` : ''}
          <button class="linklike small" data-action="open-task" data-id="${task.id}">${ui.openForm === task.id ? '닫기' : '직접 입력'}</button>
        </div>` : ''}
        ${ui.openForm === task.id ? taskForm(task) : ''}
      </div>
    </li>`;
}

// ---------- 한눈에 보기 ----------
// 시험까지 남은 날, 전체 진도와 계획상 와 있어야 할 진도, 걱정되는 과목만 보여준다

function overallProgress() {
  let total = 0;
  let done = 0;
  let target = 0;
  const t = today();
  state.subjects.forEach((s) => {
    const snap = subjectSnapshot(state, s, t);
    if (snap.progress == null) return;
    const mats = state.materials.filter((m) => m.subjectId === s.id && !m.archived && m.mode === 'range' && m.total && isActive(state, m, t));
    const w = mats.reduce((a, m) => a + m.total * m.minPerUnit, 0);
    total += w;
    done += w * snap.progress;
    target += w * (snap.targetProgress ?? snap.progress);
  });
  if (!total) return null;
  return { progress: done / total, target: target / total };
}

function glanceCard() {
  const t = today();
  const exam = state.settings.examDate;
  const left = exam ? diffDays(t, exam) : null;
  const overall = overallProgress();
  const worry = state.subjects
    .map((s) => ({ s, snap: subjectSnapshot(state, s, t) }))
    .filter((x) => x.snap.status === '위험')
    .map((x) => x.s.name);
  const weekStartKey = addDays(t, -6);
  const week = state.sessions.filter((x) => x.date >= weekStartKey && x.date <= t).reduce((a, x) => a + (x.minutes || 0), 0);

  let pace = '';
  if (overall) {
    const gap = Math.round((overall.progress - overall.target) * 100);
    pace = Math.abs(gap) <= 2 ? '<span class="good-text">계획대로 가고 있어요</span>'
      : gap > 0 ? `<span class="good-text">계획보다 ${gap}% 앞서요</span>` : `<span class="warn-text">계획보다 ${-gap}% 늦어요</span>`;
  }
  return `
    <section class="glance">
      <div class="glance-item"><span>시험까지</span><strong>${left != null && left >= 0 ? `D-${left || 'Day'}` : '미정'}</strong></div>
      <div class="glance-item"><span>전체 진도</span><strong>${overall ? pct(overall.progress) : '-'}</strong>${overall ? `<small>${pace}</small>` : ''}</div>
      <div class="glance-item"><span>최근 7일</span><strong>${hm(week)}</strong></div>
      ${worry.length ? `<button class="glance-worry" data-action="go-tab" data-id="plan">신경 쓸 과목: ${esc(worry.join(', '))} →</button>` : ''}
    </section>`;
}

// ---------- 자동 진단 ----------
// 복습 카드 결과로 암기 상태를, 문제 정답률로 이해도를 매긴다. 직접 고친 과목은 2주 동안 손대지 않는다.

function scoreOf(rate) {
  if (rate >= 0.9) return 5;
  if (rate >= 0.75) return 4;
  if (rate >= 0.6) return 3;
  if (rate >= 0.4) return 2;
  return 1;
}

function autoDiagnose() {
  const t = today();
  const since = addDays(t, -30);
  state.subjects.forEach((s) => {
    if (s.manualUntil && s.manualUntil > t) return;
    const recalls = [];
    state.logs.concat(state.wrongs).filter((x) => x.subject === s.name).forEach((x) => {
      (x.history || []).forEach((h) => { if (h.date >= since) recalls.push(h.ok); });
    });
    if (recalls.length >= 5) s.memory = scoreOf(recalls.filter(Boolean).length / recalls.length);
    const graded = state.sessions.filter((x) => x.subjectId === s.id && x.date >= since && x.wrong != null).length;
    if (graded >= 3 && s.accuracy != null) s.concept = scoreOf(s.accuracy);
  });
}

// ---------- 사진 한 장으로 알아서 정리 ----------
// 배운 곳, 푼 문제, 틀린 문제, 시험 공지, 책 표지·목차 무엇이든 올리면 종류를 알아서 나눠 기록한다.
// Claude 안에서 열면 Claude가 읽고, 그 밖에서는 설정의 "AI 연결" 주소(우리 집 전용 서버)로 보낸다.

const ai = { sample: null, maxImages: 6, busy: false, report: null, undo: null, error: '' };

async function initAi() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  const sample = await window.claude.use('sample').catch(() => null);
  if (!sample) return;
  const limits = await sample.limits().catch(() => null);
  if (!limits || !limits.images) return;
  ai.sample = sample;
  ai.maxImages = limits.images.maxCount;
  renderWhenIdle();
}

function aiReady() {
  return !!ai.sample || !!(state.settings.aiUrl && state.settings.aiCode);
}

const AI_ERRORS = {
  not_granted: 'Claude 사용을 허용하지 않아서 사진을 읽지 못했어요.',
  rate_limited: '지금은 요청이 많아요. 잠시 뒤에 다시 올려 주세요.',
  image_rejected: '이 사진은 읽을 수 없어요. 다른 사진으로 올려 주세요.',
  invalid_json: '정리 결과를 읽지 못했어요. 한 번 더 올려 주세요.',
  session_expired: 'Claude에 다시 로그인해 주세요.',
  bad_code: 'AI 연결의 가족 코드가 맞지 않아요. 설정에서 확인해 주세요.',
  network: 'AI 서버에 연결하지 못했어요. 인터넷과 설정의 AI 연결 주소를 확인해 주세요.',
};

function photoPrompt(count) {
  const books = state.subjects.map((s) => {
    const names = state.materials.filter((m) => m.subjectId === s.id && !m.archived).map((m) => m.name);
    return `- ${s.name}: ${names.join(', ') || '(없음)'}`;
  }).join('\n');
  return `당신은 고등학교 1학년 학생의 공부를 도와주는 과외 선생님입니다. 학생이 사진 ${count}장을 올렸습니다. 오늘은 ${today()}입니다.
사진마다 무엇인지 판단해서 정리해 주세요. 사진 번호는 1부터 셉니다.

과목 목록: ${state.subjects.map((s) => s.name).join(', ')}
과목별 책:
${books}

사진 종류와 뽑을 내용:
1. "lesson" 교과서·필기·학습지 내용 (오늘 배운 곳)
   {"type":"lesson","photo":번호,"subject":과목,"pages":"p.58~61","endPage":61,"topic":"단원·주제 한 줄","cards":[{"q":"책을 덮고 답할 수 있는 구체적인 복습 질문","a":"1~2문장 답"}]}  (cards 2~3개, 사진 내용만 근거로)
2. "solved" 학생이 풀고 채점한 문제집·학습지 쪽
   {"type":"solved","photo":번호,"subject":과목,"book":"위 책 목록에서 가장 가까운 이름 (없으면 표지에 보이는 이름)","solved":푼 문제 수,"wrong":틀린 문제 수,"last":마지막 문제 번호 숫자}
3. "wrong" 틀린 문제 하나를 크게 찍은 것
   {"type":"wrong","photo":번호,"subject":과목,"unit":"단원","why":"이 문제에서 놓치기 쉬운 점 한 줄"}
4. "exam" 시험 범위·시험 시간표 공지
   {"type":"exam","photo":번호,"exams":[{"subject":과목,"date":"YYYY-MM-DD 또는 null","range":"범위 한 줄","endPage":교과서 마지막 쪽 숫자 또는 null}]}
5. "book" 책 표지·목차·맨 뒤쪽
   {"type":"book","photo":번호,"subject":과목,"book":"책 이름","unit":"문제" 또는 "쪽","total":전체 문제 수 또는 쪽 수 (모르면 null)}
6. 알 수 없으면 {"type":"other","photo":번호}

과목은 반드시 위 과목 목록의 글자 그대로 씁니다. 숫자를 읽을 수 없으면 null로 둡니다.
JSON 하나로만 답하세요: {"items":[...]}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.slice(5).split(';')[0] });
}

// 우리 집 전용 AI 서버(worker/)로 보낸다
async function askEndpoint(prompt, jpegs) {
  const images = await Promise.all(jpegs.map(async (d) => ({ media_type: 'image/jpeg', data: await blobToBase64(dataUrlToBlob(d)) })));
  let res;
  try {
    res = await fetch(state.settings.aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Family-Code': state.settings.aiCode },
      body: JSON.stringify({ prompt, images }),
    });
  } catch (e) {
    throw { code: 'network' };
  }
  if (res.status === 401) throw { code: 'bad_code' };
  if (!res.ok) throw { code: 'upstream_error' };
  const body = await res.json();
  const text = String(body.text || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw { code: 'invalid_json' };
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw { code: 'invalid_json' };
  }
}

async function runPhotos(files) {
  const list = Array.from(files).slice(0, ai.maxImages);
  if (!list.length || !aiReady()) return;
  ai.busy = true;
  ai.error = '';
  ai.report = null;
  render();
  try {
    const jpegs = await Promise.all(list.map((f) => compressImage(f)));
    const prompt = photoPrompt(list.length);
    const data = ai.sample ? await ai.sample.json(prompt, { images: list }) : await askEndpoint(prompt, jpegs);
    const items = data && Array.isArray(data.items) ? data.items : [];
    ai.undo = JSON.stringify(state);
    ai.report = applyPhotoItems(items, jpegs);
    if (!ai.report.length) {
      ai.undo = null;
      ai.error = '사진에서 정리할 내용을 찾지 못했어요. 글자와 쪽 번호가 잘 보이게 다시 찍어 주세요.';
    } else {
      await save();
    }
  } catch (e) {
    ai.error = AI_ERRORS[e && e.code] || '사진을 정리하지 못했어요. 잠시 뒤에 다시 올려 주세요.';
    if (e && ['not_granted', 'sampling_disabled', 'images_unavailable', 'capability_disabled'].includes(e.code)) ai.sample = null;
  }
  ai.busy = false;
  render();
}

function subjectByName(name) {
  return state.subjects.find((s) => s.name === name);
}

// 책 이름이 조금 달라도 같은 책으로 찾는다 (공백·괄호 무시, 앞부분 일치)
function findBook(subject, name) {
  if (!name) return null;
  const norm = (x) => String(x).replace(/\(.*?\)|\s/g, '').toLowerCase();
  const n = norm(name);
  const mats = state.materials.filter((m) => m.subjectId === subject.id && !m.archived);
  return mats.find((m) => norm(m.name) === n) || mats.find((m) => norm(m.name).includes(n) || n.includes(norm(m.name))) || null;
}

function pageMaterial(subjectId) {
  return state.materials.find((m) => m.subjectId === subjectId && !m.archived && m.unit === '쪽' && ['교과서', '암기'].includes(m.kind));
}

function guessKind(name) {
  if (/교과서|ppt|빈칸|단권화/i.test(name)) return /교과서/.test(name) && !/빈칸|암기/.test(name) ? '교과서' : '암기';
  if (/단어|워드|voca/i.test(name)) return '단어';
  if (/기출|족보/.test(name)) return '기출';
  if (/모의/.test(name)) return '모의고사';
  if (/지문/.test(name)) return '지문';
  return '문제집';
}

const DEFAULT_TOTAL = { 문제: 500, 쪽: 150, 회: 5, Day: 40, 단원: 6, 지문: 20 };
const DEFAULT_SPEED = { 문제집: 3, 오답: 5, 기출: 50, 교과서: 5, 암기: 4, 단어: 20, 모의고사: 80, 지문: 20, 숙제: 1.5 };

function addBook(subject, name, unit, total) {
  const kind = guessKind(name);
  const u = unit || (['교과서', '암기'].includes(kind) ? '쪽' : kind === '기출' || kind === '모의고사' ? '회' : kind === '단어' ? 'Day' : '문제');
  const m = {
    id: uid(), subjectId: subject.id, name, kind, unit: u, mode: 'range',
    total: total || DEFAULT_TOTAL[u] || 100, approxTotal: !total, done: 0, startDone: 0, weekly: 0,
    minPerUnit: DEFAULT_SPEED[kind] || 3, activeBeforeExam: kind === '기출' ? 21 : 0,
    nextRange: '', accuracy: null, archived: false, created: today(),
  };
  state.materials.push(m);
  return m;
}

function applyPhotoItems(items, jpegs) {
  const t = today();
  const lines = [];
  const plan = state.plans[t];
  items.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const s = subjectByName(x.subject);
    if (x.type === 'lesson' && s) {
      const label = [x.topic, x.pages].filter(Boolean).join(' ');
      const cards = (Array.isArray(x.cards) ? x.cards : []).filter((c) => c && c.q).slice(0, 3);
      (cards.length ? cards : [{ q: '', a: '' }]).forEach((c) => {
        state.logs.push({ id: uid(), created: Date.now(), date: t, subject: s.name, kind: '수업', text: label, q: String(c.q || ''), a: String(c.a || ''), step: 0, due: addDays(t, LOG_INTERVALS[0]), history: [] });
      });
      const m = pageMaterial(s.id);
      const end = Number(x.endPage);
      if (m && end > 0) {
        m.done = Math.max(m.done || 0, end);
        m.nextRange = `p.${end + 1}`;
        if (m.total && m.done > m.total) m.total = m.done;
      }
      s.lastStudied = t;
      lines.push(`${s.name} · ${label || '오늘 배운 곳'} → 복습 카드 ${Math.max(1, cards.length)}장`);
    } else if (x.type === 'solved' && s) {
      const solved = Math.max(0, Math.round(Number(x.solved) || 0));
      if (!solved) return;
      const wrong = x.wrong == null ? null : Math.max(0, Math.min(solved, Math.round(Number(x.wrong) || 0)));
      const m = findBook(s, x.book) || addBook(s, String(x.book || `${s.name} 문제집`), '문제', null);
      const task = plan && plan.tasks.find((k) => k.materialId === m.id && k.status === 'todo');
      if (task) {
        completeTask(task, { amount: solved, minutes: Math.round(solved * m.minPerUnit), wrong, auto: true });
      } else {
        recordSession({ materialId: m.id, subjectId: s.id, amount: solved, minutes: Math.round(solved * m.minPerUnit), wrong, auto: true });
      }
      if (Number(x.last) > 0) m.nextRange = `${Math.round(Number(x.last)) + 1}번`;
      lines.push(`${s.name} · ${m.name} ${solved}문제${wrong != null ? ` (틀림 ${wrong})` : ''} → 진도에 반영`);
    } else if (x.type === 'wrong' && s) {
      const img = jpegs[(Number(x.photo) || 1) - 1] || '';
      state.wrongs.push({ id: uid(), date: t, subject: s.name, unit: String(x.unit || ''), trap: '', note: String(x.why || ''), img, step: 0, due: addDays(t, WRONG_INTERVALS[0]), history: [] });
      lines.push(`${s.name} · 틀린 문제 → 2일 뒤 다시 풀기로 저장`);
    } else if (x.type === 'exam') {
      const exams = Array.isArray(x.exams) ? x.exams : [];
      const dates = [];
      exams.forEach((e) => {
        const es = subjectByName(e && e.subject);
        if (!es) return;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.date))) {
          es.examDate = e.date;
          dates.push(e.date);
        }
        if (e.range) es.examRange = String(e.range);
        const m = pageMaterial(es.id);
        if (m && Number(e.endPage) > 0) {
          m.total = Number(e.endPage);
          m.approxTotal = false;
        }
        lines.push(`시험 · ${es.name}${es.examDate ? ` ${prettyDate(es.examDate)}` : ''}${e.range ? ` · ${e.range}` : ''}`);
      });
      if (dates.length) state.settings.examDate = dates.sort()[0];
    } else if (x.type === 'book' && s && x.book) {
      const total = Number(x.total) > 0 ? Math.round(Number(x.total)) : null;
      let m = findBook(s, x.book);
      if (m) {
        if (total) {
          m.total = total;
          m.approxTotal = false;
        }
      } else {
        m = addBook(s, String(x.book), x.unit === '쪽' ? '쪽' : x.unit === '문제' ? '문제' : null, total);
      }
      lines.push(`${s.name} · ${m.name}${total ? ` 전체 ${total}${m.unit}` : ''} → 내 책에 반영`);
    }
  });
  if (lines.length) refreshUntouchedPlan();
  return lines;
}

// 어느 화면에서나 같은 사진 버튼
function photoCard(compact) {
  if (ai.busy) return '<section class="card photo-card"><p class="ai-busy">사진을 읽고 정리하는 중이에요… (30초쯤 걸려요)</p></section>';
  if (ai.report) {
    return `
      <section class="card photo-card done">
        <h2>이렇게 정리했어요</h2>
        <ul class="report">${ai.report.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="recall-buttons">
          <button class="btn big primary" data-action="ai-ok">좋아요</button>
          <button class="btn big" data-action="ai-undo">되돌리기</button>
        </div>
      </section>`;
  }
  if (!aiReady()) {
    return compact ? '' : `
      <section class="card photo-card off">
        <strong>사진으로 자동 기록</strong>
        <p class="sub" style="margin:4px 0 0">사진을 읽으려면 AI 연결이 필요해요. Claude 안에서 열거나, 더보기 → 설정 → AI 연결을 해 주세요.</p>
      </section>`;
  }
  return `
    <section class="card photo-card">
      <label class="btn big primary wide photo-pick">사진 올리기<input type="file" accept="image/*" multiple hidden data-action="ai-photos"></label>
      <p class="sub" style="margin:8px 0 0">${compact ? '책 표지나 목차, 시험 공지를 찍어 올리면 알아서 채워져요.' : '오늘 배운 곳 · 채점한 문제 · 틀린 문제 · 시험 공지, 뭐든 찍어서 한 번에 올리세요. 알아서 나눠서 기록해요.'}</p>
      ${ai.error ? `<p class="warn-text" style="margin:8px 0 0">${esc(ai.error)}</p>` : ''}
    </section>`;
}

// ---------- 처음 한 번: 버튼만 눌러서 끝내기 ----------

const PROGRESS_CHOICES = [[0, '아직 안 함'], [0.2, '조금 했어요'], [0.5, '절반쯤'], [0.85, '거의 다']];
const WEEKDAY_CHOICES = [[60, '1시간'], [120, '2시간'], [180, '3시간'], [240, '4시간 이상']];
const WEEKEND_CHOICES = [[120, '2시간'], [240, '4시간'], [360, '6시간'], [480, '8시간 이상']];

function chips(name, choices, selected) {
  return `<div class="chips">${choices.map(([v, label]) => `
    <label class="chip"><input type="radio" name="${name}" value="${v}"${String(v) === String(selected) ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>`;
}

function nearest(choices, value) {
  return choices.reduce((best, [v]) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), choices[0][0]);
}

function renderSetup() {
  const wd = state.settings.weekdayMinutes;
  const groups = state.subjects.map((s) => {
    const mats = state.materials.filter((m) => m.subjectId === s.id);
    const books = mats.map((m) => {
      const ratio = m.mode === 'weekly' || !m.total ? 0 : (m.done || 0) / m.total;
      return `
        <div class="setup-book">
          <label class="book-toggle"><input type="checkbox" name="use-${m.id}"${m.archived ? '' : ' checked'}><span>${esc(m.name)}</span></label>
          ${m.mode === 'weekly'
    ? `<span class="meta">매주 ${m.weekly}${esc(m.unit)}</span>`
    : chips(`prog-${m.id}`, PROGRESS_CHOICES, nearest(PROGRESS_CHOICES, ratio))}
        </div>`;
    }).join('');
    return `
      <fieldset class="setup-group">
        <legend>${esc(s.name)}</legend>
        ${books}
        <input class="add-book" name="add-${s.id}" placeholder="+ 다른 책 이름 (있으면)">
      </fieldset>`;
  }).join('');
  return `
    <section class="card setup">
      <h2>처음 한 번만 골라 주세요</h2>
      <p class="sub">숫자를 쓸 필요는 없어요. 버튼만 고르면 시험까지의 공부 계획을 바로 만들어요. 쓰지 않는 책은 체크를 끄세요.</p>
      <form data-form="setup">
        <fieldset class="setup-group">
          <legend>다음 시험</legend>
          <div class="setup-row"><input type="date" name="examDate" value="${esc(state.settings.examDate)}"><span class="meta">시험 첫날. 과목별 날짜는 나중에 시간표 사진으로 넣어도 돼요.</span></div>
        </fieldset>
        <fieldset class="setup-group">
          <legend>학교·학원 끝나고 공부할 수 있는 시간</legend>
          <div class="setup-row"><span class="setup-label">평일</span>${chips('weekday', WEEKDAY_CHOICES, nearest(WEEKDAY_CHOICES, wd[1]))}</div>
          <div class="setup-row"><span class="setup-label">주말</span>${chips('weekend', WEEKEND_CHOICES, nearest(WEEKEND_CHOICES, wd[0]))}</div>
        </fieldset>
        <p class="sub">공부하는 책과, 지금 어디까지 했는지 골라 주세요.</p>
        ${groups}
        <button class="btn big primary wide" type="submit">계획 만들기</button>
      </form>
    </section>`;
}

// ---------- 오늘 ----------

function renderToday() {
  if (!state.setupDone || ui.setup) return renderSetup();
  const t = today();
  const plan = state.plans[t];
  const planned = plan.tasks.reduce((a, x) => a + x.minutes, 0);
  const doneCount = plan.tasks.filter((x) => x.status !== 'todo').length;
  const todo = plan.tasks.filter((x) => x.status === 'todo');
  const rate = plan.tasks.length ? Math.round((doneCount / plan.tasks.length) * 100) : 0;
  const firstTodo = todo[0];

  return `
    ${glanceCard()}
    ${photoCard(false)}
    ${recallSection()}

    <section class="card plan-card">
      <div class="plan-top">
        <h2>오늘 할 공부</h2>
        <span class="meta">${doneCount}/${plan.tasks.length} · 약 ${hm(planned)}</span>
      </div>
      <div class="progress"><div style="width:${rate}%"></div></div>
      <p class="sub">다 하면 그냥 두세요. 하루가 지나면 다 한 것으로 자동 기록해요. <strong>못 한 것만</strong> 알려 주세요. 채점한 쪽을 사진으로 올리면 맞은 개수까지 알아서 기록돼요.</p>
      <ol class="todo">${plan.tasks.map((x, i) => taskRow(x, i, x === firstTodo)).join('') || '<li class="empty">오늘 배정할 공부가 없어요.</li>'}</ol>
    </section>

    <details class="card fold">
      <summary>오늘 시간이 부족해요</summary>
      <form data-form="replan" class="inline-form">
        <label>지금부터 쓸 수 있는 시간</label>
        ${chips('minutes', [[30, '30분'], [60, '1시간'], [90, '1시간 30분'], [120, '2시간'], [180, '3시간']], 60)}
        <button class="btn primary" type="submit" style="margin-top:8px">남은 시간에 맞춰 다시 짜기</button>
      </form>
    </details>`;
}

// ---------- 계획: 과외 선생님이 짜 준 이번 시험 계획 ----------

function phasesFor(examDate) {
  const t = today();
  const left = diffDays(t, examDate);
  const at = (n) => addDays(examDate, -n);
  const phases = [
    { name: '1단계 · 진도 끝내기', from: t, to: at(22), desc: '교과서 개념을 끝내고, 문제집을 한 번 다 풀어요. 틀린 문제는 사진으로 올려 두세요.' },
    { name: '2단계 · 기출과 약점', from: at(21), to: at(8), desc: '족보닷컴 군포고 기출을 풀고, 자주 틀리는 유형만 다시 봐요. 영어는 시험 범위 지문 전체를 분석해요.' },
    { name: '3단계 · 마무리', from: at(7), to: at(1), desc: '새 문제집은 시작하지 않아요. 오답과 암기만 반복하고, 시험 시간에 맞춰 기출을 한 번 더 풀어요.' },
  ];
  return phases.filter((p) => p.to >= p.from || p === phases[phases.length - 1]).map((p) => ({
    ...p,
    now: t >= p.from && t <= p.to,
    past: t > p.to,
    from: p.from < t ? t : p.from,
  })).filter((p) => !p.past || left < 0);
}

// 이번 주(7일)에 이 책을 얼마나 하면 되는지
function weeklyGoal(m, subject) {
  const t = today();
  if (m.mode === 'weekly') return { text: `매주 ${m.weekly}${m.unit}` };
  const rem = remaining(state, m, t);
  if (!rem) return { text: '다 했어요', done: true };
  const left = daysLeftFor(state, subject, t);
  const days = left == null ? 28 : deadlineDays(m, left);
  const perWeek = Math.min(rem, Math.ceil((rem / days) * 7));
  const from = m.done || 0;
  return { text: `${perWeek}${m.unit}`, sub: m.approxTotal ? '' : `${from} → ${from + perWeek} / ${m.total}` };
}

// 과목별 선생님 한마디: 기록에서 보이는 가장 중요한 한 가지
function teacherNote(s) {
  const t = today();
  const mats = state.materials.filter((m) => m.subjectId === s.id && !m.archived);
  if (s.accuracy != null && s.accuracy < 0.7) return `정답률이 ${pct(s.accuracy)}예요. 새 문제를 늘리기보다 틀린 문제를 다시 푸는 게 먼저예요.`;
  if ((s.wrongPending || 0) >= 15) return `다시 볼 틀린 문제가 ${s.wrongPending}개 쌓였어요. 이번 주는 오답부터 줄여요.`;
  const problemBooks = mats.filter((m) => ['문제집', '숙제'].includes(m.kind) && m.mode === 'range');
  if (problemBooks.length && problemBooks.every((m) => remaining(state, m, t) === 0)) return '문제집을 다 풀었어요. 이제 틀린 유형과 기출 위주로 바꿔요.';
  const since = s.lastStudied ? diffDays(s.lastStudied, t) : null;
  if (since != null && since >= 5) return `${since}일째 안 봤어요. 이번 주에 꼭 한 번은 봐요.`;
  return guideFor(s.name) || '';
}

function renderPlan() {
  const t = today();
  const exam = state.settings.examDate;
  const left = exam ? diffDays(t, exam) : null;

  const examRows = state.subjects.map((s) => `
    <div class="exam-row">
      <span class="exam-subject">${esc(s.name)}</span>
      <input type="date" value="${esc(s.examDate || exam || '')}" data-action="exam-date" data-id="${s.id}" aria-label="${esc(s.name)} 시험일">
      ${s.examRange ? `<span class="meta exam-range">${esc(s.examRange)}</span>` : ''}
    </div>`).join('');

  const phases = exam && left >= 0 ? phasesFor(exam).map((p) => `
    <li class="phase-item${p.now ? ' now' : ''}">
      <div class="phase-name">${esc(p.name)}${p.now ? ' <span class="tag">지금</span>' : ''}</div>
      <div class="meta">${prettyDate(p.from)} ~ ${prettyDate(p.to)}</div>
      <div>${esc(p.desc)}</div>
    </li>`).join('') : '';

  const subjects = state.subjects.map((s) => {
    const mats = state.materials.filter((m) => m.subjectId === s.id && !m.archived && isActive(state, m, t));
    if (!mats.length) return '';
    const goals = mats.map((m) => {
      const g = weeklyGoal(m, s);
      return `<li><span>${esc(m.name)}</span><strong>${esc(g.text)}</strong>${g.sub ? `<span class="meta">${esc(g.sub)}</span>` : ''}</li>`;
    }).join('');
    const note = teacherNote(s);
    const snap = subjectSnapshot(state, s, t);
    return `
      <div class="subject-plan">
        <div class="subject-plan-head"><strong>${esc(s.name)}</strong>${snap.status !== '안정' ? `<span class="badge ${snap.status === '위험' ? 'risk' : 'caution'}">${snap.status === '위험' ? '신경 쓰기' : '조금 주의'}</span>` : ''}</div>
        <ul class="goals">${goals}</ul>
        ${note ? `<p class="teacher-note">${esc(note)}</p>` : ''}
      </div>`;
  }).join('');

  const totalNeed = state.subjects.reduce((a, s) => a + subjectSnapshot(state, s, t).need, 0);
  let avail = 0;
  if (left != null && left > 0) {
    const f = completionFactor(state, t);
    for (let i = 0; i < left; i++) avail += defaultAvailable(state, addDays(t, i)) * f;
  }
  const enough = left != null && left > 0
    ? (totalNeed <= avail
      ? `<p class="good-text">지금 계획대로 하면 시험 전에 다 끝낼 수 있어요. (남은 공부 약 ${hm(totalNeed)}, 쓸 수 있는 시간 약 ${hm(avail)})</p>`
      : `<p class="warn-text">시간이 약 ${hm(totalNeed - avail)} 모자라요. 매일 계획은 중요한 과목과 약한 부분부터 채워요.</p>`)
    : '';

  return `
    <section class="card">
      <h2>${left != null && left >= 0 ? `이번 시험까지 ${left}일` : '이번 시험 공부 계획'}</h2>
      ${enough}
      ${phases ? `<ol class="phases">${phases}</ol>` : '<p class="sub">시험 날짜를 넣으면 시험까지 단계별 계획을 보여드려요.</p>'}
    </section>

    <section class="card">
      <h2>이번 주 목표</h2>
      <p class="sub">매일 할 양은 오늘 화면에 알아서 나눠져요. 여기서는 큰 그림만 보세요.</p>
      ${subjects}
    </section>

    <section class="card">
      <h2>시험 날짜</h2>
      <p class="sub">과목마다 날짜가 다르면 고쳐 주세요. 시험 시간표나 범위 공지를 사진으로 올리면 알아서 채워져요.</p>
      ${examRows}
    </section>
    ${photoCard(true)}`;
}

// ---------- 내 책 ----------

function bookRow(m) {
  const t = today();
  const open = ui.openBook === m.id;
  let bar = '';
  let line;
  if (m.mode === 'weekly') {
    const doneW = m.weekly - remaining(state, m, t);
    bar = `<div class="progress thin"><div style="width:${m.weekly ? Math.min(100, (doneW / m.weekly) * 100) : 0}%"></div></div>`;
    line = `이번 주 ${doneW}/${m.weekly}${m.unit}`;
  } else {
    const ratio = m.total ? Math.min(1, (m.done || 0) / m.total) : 0;
    bar = `<div class="progress thin"><div style="width:${ratio * 100}%"></div></div>`;
    line = `${pct(ratio)}${m.nextRange ? ` · 다음: ${esc(m.nextRange)}` : ''}`;
  }
  const controls = open ? `
    <div class="book-controls">
      ${m.mode === 'weekly' ? '' : `
      <div class="meta">지금 어디까지 했어요?</div>
      <div class="chips">${[[0, '처음'], [0.2, '조금'], [0.5, '절반'], [0.85, '거의 다'], [1, '다 함']].map(([v, l]) => `<button class="chip-btn" data-action="book-progress" data-id="${m.id}" data-v="${v}">${l}</button>`).join('')}</div>
      <form data-form="book-exact" data-id="${m.id}" class="exact">
        <label>정확히 알면: 지금까지 <input type="number" name="done" min="0" value="${m.done || 0}"></label>
        <label>/ 전체 <input type="number" name="total" min="1" value="${m.total || ''}"></label>
        <span class="meta">${esc(m.unit)}</span>
        <button class="btn small" type="submit">저장</button>
      </form>`}
      <button class="linklike small" data-action="book-remove" data-id="${m.id}">이 책은 안 써요</button>
    </div>` : '';
  return `
    <li class="book${open ? ' open' : ''}">
      <button class="book-head" data-action="book-open" data-id="${m.id}">
        <span class="book-name">${esc(m.name)}${m.activeBeforeExam && !isActive(state, m, t) ? ` <span class="meta">· 시험 ${m.activeBeforeExam}일 전부터</span>` : ''}</span>
        <span class="book-line">${line}</span>
      </button>
      ${bar}
      ${controls}
    </li>`;
}

function renderBooks() {
  const groups = state.subjects.map((s) => {
    const mats = state.materials.filter((m) => m.subjectId === s.id && !m.archived);
    return `
      <section class="card">
        <h2>${esc(s.name)}</h2>
        <ul class="books">${mats.map(bookRow).join('') || '<li class="empty">책이 없어요.</li>'}</ul>
        <form data-form="add-book" data-id="${s.id}" class="add-book-form">
          <input name="name" placeholder="+ 책 추가 (이름만)" aria-label="${esc(s.name)} 책 추가">
          <button class="btn small" type="submit">추가</button>
        </form>
      </section>`;
  }).join('');
  const approx = state.materials.some((m) => !m.archived && m.approxTotal);
  return `
    <p class="sub">진도는 공부를 끝낸 날과 사진으로 알아서 올라가요. 틀린 데가 있을 때만 책을 눌러 고쳐 주세요.${approx ? ' 전체 분량을 모르는 책은 보통 분량으로 잡아 두었어요. 목차나 맨 뒤쪽을 사진으로 올리면 정확해져요.' : ''}</p>
    ${photoCard(true)}
    ${groups}`;
}

// ---------- 더보기 ----------

function renderMore() {
  const links = [
    ['wrongs', '틀린 문제 모음', `다시 풀 문제 ${state.wrongs.filter((w) => w.due).length}개`],
    ['cards', '복습 카드 모음', `카드 ${state.logs.length}장`],
    ['projects', '수행평가', '마감 7일 전부터 오늘 할 공부에 자동으로 들어가요.'],
    ['analysis', '공부 기록', '계획한 시간과 실제 시간, 과목별 기록'],
    ['settings', '설정', '공부 시간, 기기 동기화, AI 연결, 백업'],
  ];
  return links.map(([tab, name, desc]) => `
    <button class="card subject-card" data-action="go-tab" data-id="${tab}">
      <strong>${name}</strong>
      <div class="meta">${desc}</div>
    </button>`).join('') + `
    <button class="card subject-card" data-action="redo-setup">
      <strong>책과 시작 위치 다시 고르기</strong>
      <div class="meta">처음 화면을 다시 열어요. 지금까지 기록은 그대로예요.</div>
    </button>`;
}

function renderWrongs() {
  const list = state.wrongs.slice().sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const items = list.map((w) => `
    <li class="item" style="display:block">
      <div><span class="tag">${esc(w.subject)}</span>${w.unit ? `<span class="tag">${esc(w.unit)}</span>` : ''}<span class="meta">${w.due ? `다시 풀 날 ${prettyDate(w.due)}` : '다 맞혀서 졸업'}</span></div>
      ${w.img ? `<img class="wrong-img" src="${w.img}" alt="틀린 문제">` : ''}
      ${w.note ? `<div class="meta">${esc(w.note)}</div>` : ''}
    </li>`).join('');
  return `
    <section class="card">
      <h2>틀린 문제 모음</h2>
      <p class="sub">틀린 문제를 사진으로 올리면 여기에 모이고, 2일 → 7일 → 14일 → 30일 뒤 "오늘 떠올릴 것"에 다시 나와요.</p>
      ${photoCard(true)}
      <ul class="list">${items || '<li class="empty">아직 없어요.</li>'}</ul>
    </section>`;
}

function renderCards() {
  const list = state.logs.slice().sort((a, b) => b.created - a.created).slice(0, 60);
  const items = list.map((l) => `
    <li class="item">
      <div><span class="tag">${esc(l.subject)}</span>${esc(l.q || l.text)}<div class="meta">${esc(l.q ? l.text : '')} · ${l.due ? `다음 복습 ${prettyDate(l.due)}` : '외웠어요'}</div></div>
      <div class="actions"><button class="btn small" data-action="log-del" data-id="${l.id}">지우기</button></div>
    </li>`).join('');
  return `
    <section class="card">
      <h2>복습 카드 모음</h2>
      <p class="sub">오늘 배운 곳을 사진으로 올리면 카드가 자동으로 만들어져요. 직접 만들고 싶을 때만 아래에 쓰세요.</p>
      <form data-form="log">
        <div class="row">
          <div><label>과목</label><select name="subject">${options(state.subjects.map((s) => s.name))}</select></div>
          <div style="flex:3 1 260px"><label>질문</label><input name="q" placeholder="예: 원과 직선이 두 점에서 만나는 조건은?" required></div>
        </div>
        <label>답</label><input name="a" placeholder="예: 중심과 직선 사이 거리 < 반지름">
        <div style="margin-top:12px"><button class="btn primary" type="submit">카드 만들기</button></div>
      </form>
      <ul class="list" style="margin-top:12px">${items || '<li class="empty">아직 없어요.</li>'}</ul>
    </section>`;
}

function renderSettings() {
  const wd = state.settings.weekdayMinutes;
  return `
    <section class="card">
      <h2>공부할 수 있는 시간</h2>
      <form data-form="time">
        <div class="setup-row"><span class="setup-label">평일</span>${chips('weekday', WEEKDAY_CHOICES, nearest(WEEKDAY_CHOICES, wd[1]))}</div>
        <div class="setup-row"><span class="setup-label">주말</span>${chips('weekend', WEEKEND_CHOICES, nearest(WEEKEND_CHOICES, wd[0]))}</div>
        <button class="btn primary" type="submit">저장</button>
      </form>
    </section>
    ${syncCard()}
    <section class="card">
      <h2>AI 연결 (사진 읽기)</h2>
      <p class="sub">${ai.sample ? 'Claude 안에서 열어서 지금은 Claude가 사진을 읽어요. 따로 설정하지 않아도 돼요.' : 'Claude 밖에서 사진을 읽으려면 우리 집 전용 AI 서버 주소와 가족 코드가 필요해요. 저장소의 AI_SETUP.md 순서대로 만들 수 있어요.'}</p>
      <form data-form="ai">
        <label>AI 서버 주소</label><input name="aiUrl" value="${esc(state.settings.aiUrl || '')}" placeholder="https://study-ai.○○○.workers.dev">
        <label>가족 코드</label><input name="aiCode" value="${esc(state.settings.aiCode || '')}" placeholder="서버를 만들 때 정한 코드">
        <div style="margin-top:12px"><button class="btn primary" type="submit">저장</button></div>
      </form>
    </section>
    <section class="card">
      <h2>백업</h2>
      <div class="row">
        <button class="btn" data-action="export">백업 파일 받기</button>
        <label class="btn" style="margin:0;text-align:center;color:var(--text)">백업 불러오기<input type="file" accept="application/json" data-action="import" hidden></label>
      </div>
    </section>
    <section class="card">
      <h2>처음부터 다시</h2>
      <p class="sub">모든 기록을 지우고 처음 화면으로 돌아가요.</p>
      <button class="btn bad" data-action="reset">모두 지우기</button>
    </section>`;
}

// ---------- 화면: 수행평가 ----------

function projectCard(p) {
  const subject = subjectById(p.subjectId);
  const left = p.due ? diffDays(today(), p.due) : null;
  const steps = PROJECT_STAGES.map((name, i) => `<span class="step${i < p.stage ? ' past' : ''}${i === p.stage ? ' now' : ''}">${esc(name)}</span>`).join('');
  const versions = ['자료조사', '초안', '수정', '최종본'].map((v) => `
    <label class="inline"><input type="checkbox" data-action="proj-version" data-id="${p.id}" data-v="${v}"${p.versions[v] ? ' checked' : ''}> ${v}</label>`).join('');
  const field = (key, label, ph) => `<label>${label}</label><textarea data-action="proj-field" data-id="${p.id}" data-field="${key}" placeholder="${esc(ph)}">${esc(p[key])}</textarea>`;
  return `
    <div class="card">
      <div class="row between">
        <div><h2>${esc(p.title)}</h2><div class="meta">${subject ? esc(subject.name) : ''}${p.due ? ` · 마감 ${prettyDate(p.due)}${left != null && left >= 0 ? ` (D-${left})` : ''}` : ''}</div></div>
        <div class="actions">
          <button class="btn small" data-action="proj-stage" data-id="${p.id}" data-d="-1">◀</button>
          <button class="btn small primary" data-action="proj-stage" data-id="${p.id}" data-d="1">다음 단계 ▶</button>
        </div>
      </div>
      <div class="steps">${steps}</div>
      <div class="versions">${versions}</div>
      <details>
        <summary>탐구 기록 열기</summary>
        ${field('question', '탐구 질문', '무엇이 궁금했나')}
        ${field('role', '내가 실제로 한 역할과 탐구 과정', '자료를 어디서 찾고, 무엇을 분석했나')}
        ${field('limits', '한계 · 반론 · 추가 질문', '결과가 틀릴 수 있는 이유, 반대 의견')}
        ${field('nextQuestion', '다음 탐구로 이어질 질문', '이번에 새로 생긴 궁금증 (억지로 연결하지 않아도 돼요)')}
        ${field('memo', '자료 링크 · 메모', '')}
        <div style="margin-top:12px"><button class="btn small" data-action="proj-del" data-id="${p.id}">삭제</button></div>
      </details>
    </div>`;
}

function renderProjects() {
  const active = state.projects.filter((p) => p.stage < PROJECT_STAGES.length - 1).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = state.projects.filter((p) => p.stage >= PROJECT_STAGES.length - 1);
  const ideas = state.projects.filter((p) => p.nextQuestion).map((p) => `<li><span class="meta">${esc(p.title)} →</span> ${esc(p.nextQuestion)}</li>`).join('');
  return `
    <div class="card">
      <h2>수행평가 추가</h2>
      <p class="sub">마감 7일 이내가 되면 오늘 계획에 자동으로 들어가요.</p>
      <form data-form="project">
        <div class="row">
          <div style="flex:2 1 220px"><label>제목</label><input name="title" required></div>
          <div><label>과목</label><select name="subjectId">${options(state.subjects.map((s) => [s.id, s.name]))}</select></div>
          <div><label>마감일</label><input type="date" name="due"></div>
        </div>
        <div style="margin-top:12px"><button class="btn primary" type="submit">추가</button></div>
      </form>
      ${ideas ? `<h3>이전 탐구에서 생긴 질문</h3><ul class="tips">${ideas}</ul>` : ''}
    </div>
    ${active.map(projectCard).join('') || '<p class="empty">진행 중인 수행평가가 없어요.</p>'}
    ${done.length ? `<h3>완료</h3>${done.map(projectCard).join('')}` : ''}`;
}

// ---------- 화면: 분석 ----------

function renderAnalysis() {
  const t = today();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(t, -i));

  const dayRows = days.map((d) => {
    const plan = state.plans[d];
    const planned = plan ? plan.tasks.reduce((a, x) => a + x.minutes, 0) : 0;
    const actual = state.sessions.filter((s) => s.date === d).reduce((a, s) => a + (s.minutes || 0), 0);
    return { d, planned, actual };
  }).filter((r) => r.planned || r.actual);

  const maxMin = Math.max(1, ...dayRows.map((r) => Math.max(r.planned, r.actual)));
  const trend = dayRows.length ? dayRows.map((r) => `
    <div class="bar2">
      <span class="name">${prettyDate(r.d)}</span>
      <span class="tracks">
        <span class="plan" style="width:${(r.planned / maxMin) * 100}%"></span>
        <span class="act" style="width:${(r.actual / maxMin) * 100}%"></span>
      </span>
      <span class="num">${r.planned ? `${Math.round((r.actual / r.planned) * 100)}%` : '-'}</span>
    </div>`).join('') : '<div class="empty">기록이 쌓이면 보여 줘요.</div>';

  // 계획 과제 단위 달성률: 과목별, 시간대별
  const from = days[0];
  const planned = [];
  Object.keys(state.plans).filter((d) => d >= from && d < t).forEach((d) => {
    state.plans[d].tasks.forEach((x) => planned.push({ d, x }));
  });
  const bySubject = {};
  planned.forEach(({ x }) => {
    if (!x.subjectId || !x.amount) return;
    const k = x.subjectId;
    bySubject[k] = bySubject[k] || { plan: 0, act: 0 };
    bySubject[k].plan += 1;
    bySubject[k].act += x.actual && x.actual.amount != null ? Math.min(1, x.actual.amount / x.amount) : 0;
  });
  const subjRows = state.subjects.map((s) => {
    const r = bySubject[s.id];
    const minutes = state.sessions.filter((x) => x.subjectId === s.id && x.date >= from).reduce((a, x) => a + (x.minutes || 0), 0);
    return `<tr><td>${esc(s.name)}</td><td>${r ? pct(r.act / r.plan) : '-'}</td><td>${hm(minutes)}</td></tr>`;
  }).join('');

  const bySlot = {};
  state.sessions.filter((s) => s.date >= from && s.planned && s.planned.amount).forEach((s) => {
    bySlot[s.slot] = bySlot[s.slot] || { n: 0, sum: 0 };
    bySlot[s.slot].n += 1;
    bySlot[s.slot].sum += Math.min(1, (s.amount || 0) / s.planned.amount);
  });
  const slotText = SLOTS.filter((k) => bySlot[k]).map((k) => `${k} ${pct(bySlot[k].sum / bySlot[k].n)}`).join(' · ') || '-';

  const speedRows = state.materials.filter((m) => state.sessions.some((s) => s.materialId === m.id)).map((m) => {
    const subject = subjectById(m.subjectId);
    return `<tr><td>${esc(subject ? subject.name : '')}</td><td>${esc(m.name)}</td><td>${m.minPerUnit}분 / ${esc(m.unit)}</td><td>${pct(m.accuracy)}</td></tr>`;
  }).join('');

  const worst = Object.entries(bySubject).filter(([, r]) => r.plan >= 3).sort((a, b) => a[1].act / a[1].plan - b[1].act / b[1].plan)[0];
  const worstText = worst && worst[1].act / worst[1].plan < 0.7
    ? `<p class="warn-text">${esc(subjectById(worst[0]).name)} 계획이 자주 밀려요 (달성 ${pct(worst[1].act / worst[1].plan)}). 그 과목은 한 번에 배정하는 양이 실제 속도에 맞춰 줄어들고 있어요. 시간대도 바꿔 보세요.</p>`
    : '';

  return `
    <div class="card">
      <h2>계획 시간 vs 실제 시간 (최근 2주)</h2>
      <p class="sub"><span class="key plan"></span> 계획 <span class="key act"></span> 실제 · 오른쪽은 달성률</p>
      ${trend}
      <p class="meta">최근 7일 수행률 ${Math.round(completionFactor(state, t) * 100)}% → 다음 계획 양에 반영돼요.</p>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>과목별 계획 달성률</h2>
        ${worstText}
        <table class="dash"><thead><tr><th>과목</th><th>달성률</th><th>공부 시간</th></tr></thead><tbody>${subjRows}</tbody></table>
        <p class="meta">시간대별 달성률: ${slotText}</p>
      </div>
      <div class="card">
        <h2>교재별 실제 속도</h2>
        <p class="sub">기록할 때마다 자동 보정돼요.</p>
        ${speedRows ? `<table class="dash"><thead><tr><th>과목</th><th>교재</th><th>속도</th><th>정확도</th></tr></thead><tbody>${speedRows}</tbody></table>` : '<div class="empty">아직 기록이 없어요.</div>'}
      </div>
    </div>`;
}

// ---------- 기기 동기화 카드 ----------

function syncCard() {
  const c = window.cloud;
  if (!c || c.status === 'unconfigured') {
    return `
    <div class="card">
      <h2>아이패드 · 휴대폰 동기화</h2>
      <p class="sub" style="margin:0">아직 Firebase 설정이 들어가지 않았어요. 저장소의 FIREBASE_SETUP.md 순서대로 설정하면 Google 로그인으로 모든 기기의 기록이 맞춰져요.</p>
    </div>`;
  }
  const members = (c.members || []).map((m) => `
    <li class="item"><div>${esc(m)}${m === c.email ? ' <span class="tag">나</span>' : ''}</div>
    ${m === c.ownerEmail ? '<div class="meta">처음 만든 계정</div>' : m !== c.email ? `<div class="actions"><button class="btn small" data-action="cloud-remove" data-email="${esc(m)}">빼기</button></div>` : ''}</li>`).join('');
  const body = c.email
    ? `
      <p class="sub">${esc(c.email)}로 로그인됨 · ${esc(c.statusText())}</p>
      <h3>함께 보는 가족</h3>
      <ul class="list">${members}</ul>
      <form data-form="member" class="row" style="margin-top:8px">
        <div style="flex:3 1 220px"><input type="email" name="email" placeholder="가족의 Google 이메일 (예: 부모님 Gmail)" required></div>
        <div><button class="btn primary" type="submit">추가</button></div>
      </form>
      <p class="meta">추가한 사람이 같은 주소에서 그 Google 계정으로 로그인하면 같은 기록을 보고 고칠 수 있어요.</p>
      <div style="margin-top:12px"><button class="btn" data-action="cloud-signout">로그아웃</button></div>`
    : `
      <p class="sub">${esc(c.statusText())}</p>
      <p class="sub">아이패드와 휴대폰에서 같은 Google 계정으로 로그인하면 기록이 자동으로 맞춰져요. 부모님은 아이 기기에서 가족으로 추가된 뒤 본인 Google 계정으로 로그인하면 돼요.</p>
      <button class="btn primary" data-action="cloud-signin">Google로 로그인</button>`;
  return `
    <div class="card">
      <h2>아이패드 · 휴대폰 동기화</h2>
      ${body}
    </div>`;
}

// ---------- 렌더링 ----------

const VIEWS = {
  today: renderToday, plan: renderPlan, books: renderBooks, more: renderMore,
  wrongs: renderWrongs, cards: renderCards, projects: renderProjects, analysis: renderAnalysis, settings: renderSettings,
};
const MORE_TABS = ['wrongs', 'cards', 'projects', 'analysis', 'settings'];

async function render() {
  if (!state) return; // 아직 불러오는 중
  if (ensurePlan()) await save({ touch: false });
  if (!VIEWS[ui.tab]) ui.tab = 'today';
  document.getElementById('view').innerHTML = VIEWS[ui.tab]();
  const navTab = MORE_TABS.includes(ui.tab) ? 'more' : ui.tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === navTab));
  if (MORE_TABS.includes(ui.tab)) {
    document.getElementById('view').insertAdjacentHTML('afterbegin', '<button class="btn small back" data-action="go-tab" data-id="more">← 더보기</button>');
  }
  const exam = state.settings.examDate;
  const left = exam ? diffDays(today(), exam) : null;
  const dday = document.getElementById('dday');
  dday.hidden = left == null || left < 0;
  if (!dday.hidden) dday.textContent = left === 0 ? 'D-Day' : `D-${left}`;
  renderSyncBadge();
}

function renderSyncBadge() {
  const sync = document.getElementById('sync');
  const c = window.cloud;
  sync.hidden = !c || c.status === 'unconfigured';
  if (!sync.hidden) {
    sync.textContent = c.badge();
    sync.className = `sync ${c.status}`;
  }
}

// sync.js가 쓰는 연결점. ready는 이 기기 기록을 다 불러온 뒤 끝난다
let markReady;
// 동기화 상태만 바뀌었을 때: 머리글 표시만 고치고, 설정 탭을 보고 있을 때만 화면을 다시 그린다
function syncChanged() {
  renderSyncBadge();
  if (ui.tab === 'settings') renderWhenIdle();
}

window.app = { getState: () => state, applyRemote, render, syncChanged, toast, ready: new Promise((r) => { markReady = r; }) };

// ---------- 동작 ----------

function advance(item, intervals, ok) {
  item.history = (item.history || []).concat({ date: today(), ok });
  if (ok) {
    item.step += 1;
    item.due = item.step < intervals.length ? addDays(today(), intervals[item.step]) : null;
  } else {
    item.step = 0;
    item.due = addDays(today(), intervals[0]);
  }
}

function findTask(id) {
  return state.plans[today()].tasks.find((x) => x.id === id);
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('.tabs button');
  if (tab) {
    ui.tab = tab.dataset.tab;
    ui.openForm = null;
    ui.setup = false;
    await render();
    window.scrollTo(0, 0);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const { action, id } = el.dataset;
  let changed = true;

  switch (action) {
    case 'go-tab':
      ui.tab = id;
      changed = false;
      window.scrollTo(0, 0);
      break;
    case 'redo-setup':
      ui.setup = true;
      ui.tab = 'today';
      changed = false;
      window.scrollTo(0, 0);
      break;
    case 'reveal':
      ui.revealed = id;
      changed = false;
      break;
    case 'open-task':
      ui.openForm = ui.openForm === id ? null : id;
      changed = false;
      break;
    case 'done-task': {
      const task = findTask(id);
      if (!task) return;
      completeTask(task, { amount: task.amount, minutes: task.minutes });
      toast('잘했어요!');
      break;
    }
    case 'miss-task': {
      const task = findTask(id);
      if (!task) return;
      task.status = 'skipped';
      toast('괜찮아요. 내일 계획에 다시 넣을게요.');
      break;
    }
    case 'half-task': {
      const task = findTask(id);
      if (!task) return;
      completeTask(task, { amount: Math.max(1, Math.floor(task.amount / 2)), minutes: Math.round(task.minutes / 2), auto: true });
      toast('절반만 기록했어요. 나머지는 다음 계획에 다시 들어가요.');
      break;
    }
    case 'log-ok':
    case 'log-miss': {
      const l = state.logs.find((x) => x.id === id);
      if (l) advance(l, LOG_INTERVALS, action === 'log-ok');
      ui.revealed = null;
      break;
    }
    case 'wrong-ok':
    case 'wrong-miss': {
      const w = state.wrongs.find((x) => x.id === id);
      if (w) advance(w, WRONG_INTERVALS, action === 'wrong-ok');
      ui.revealed = null;
      toast(action === 'wrong-ok' ? '좋아요! 다음엔 더 나중에 나와요.' : '2일 뒤에 다시 나와요.');
      break;
    }
    case 'log-del':
      if (!confirm('이 카드를 지울까요?')) return;
      state.logs = state.logs.filter((x) => x.id !== id);
      break;
    case 'ai-ok':
      ai.report = null;
      ai.undo = null;
      changed = false;
      break;
    case 'ai-undo':
      if (ai.undo) state = Object.assign(freshState(), JSON.parse(ai.undo));
      ai.report = null;
      ai.undo = null;
      toast('사진으로 정리한 내용을 되돌렸어요.');
      break;
    case 'book-open':
      ui.openBook = ui.openBook === id ? null : id;
      changed = false;
      break;
    case 'book-progress': {
      const m = materialById(id);
      if (!m) return;
      m.done = Math.round((m.total || 0) * Number(el.dataset.v));
      ui.openBook = null;
      refreshUntouchedPlan();
      toast('진도를 고쳤어요.');
      break;
    }
    case 'book-remove': {
      const m = materialById(id);
      if (!m || !confirm(`${m.name}을(를) 목록에서 뺄까요? 기록은 남아요.`)) return;
      m.archived = true;
      ui.openBook = null;
      refreshUntouchedPlan();
      break;
    }
    case 'proj-stage': {
      const p = state.projects.find((x) => x.id === id);
      if (p) p.stage = Math.min(PROJECT_STAGES.length - 1, Math.max(0, p.stage + Number(el.dataset.d)));
      break;
    }
    case 'proj-del':
      if (!confirm('이 수행평가를 삭제할까요?')) return;
      state.projects = state.projects.filter((x) => x.id !== id);
      break;
    case 'cloud-signin':
      if (window.cloud) window.cloud.signIn();
      return;
    case 'cloud-signout':
      if (window.cloud && confirm('로그아웃할까요? 이 기기의 기록은 그대로 남아요.')) window.cloud.signOut();
      return;
    case 'cloud-remove':
      if (window.cloud && confirm(`${el.dataset.email}을(를) 가족에서 뺄까요?`)) window.cloud.removeMember(el.dataset.email);
      return;
    case 'export': {
      const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `공부루틴-백업-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    case 'reset':
      if (!confirm('정말 모든 기록을 지울까요? 먼저 백업 파일을 받아 두는 걸 권해요.')) return;
      state = freshState();
      ui.tab = 'today';
      break;
    default:
      return;
  }
  if (changed) await save();
  await render();
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const action = el.dataset.action;
  if (!action) return;

  if (action === 'ai-photos') {
    if (el.files && el.files.length) runPhotos(el.files);
    return;
  }
  if (action === 'exam-date') {
    const s = subjectById(el.dataset.id);
    if (!s) return;
    s.examDate = el.value;
    const dates = state.subjects.map((x) => x.examDate).filter(Boolean).sort();
    if (dates.length) state.settings.examDate = dates[0];
    refreshUntouchedPlan();
    await save();
    renderWhenIdle();
    return;
  }
  if (action === 'proj-field') {
    const p = state.projects.find((x) => x.id === el.dataset.id);
    if (p) p[el.dataset.field] = el.value;
    await save();
    return;
  }
  if (action === 'proj-version') {
    const p = state.projects.find((x) => x.id === el.dataset.id);
    if (p) p.versions[el.dataset.v] = el.checked;
    await save();
    return;
  }
  if (action === 'import') {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.logs)) throw new Error('형식 오류');
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요?')) return;
      state = Object.assign(freshState(), data);
      await save();
      toast('불러왔어요.');
    } catch (err) {
      toast('백업 파일을 읽을 수 없어요.');
      return;
    }
    await render();
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const kind = form.dataset.form;
  const t = today();
  let msg = '저장했어요.';

  if (kind === 'setup') {
    state.settings.examDate = f.get('examDate') || state.settings.examDate || '';
    const wdMin = num(f.get('weekday'), 180);
    const weMin = num(f.get('weekend'), 360);
    state.settings.weekdayMinutes = [weMin, wdMin, wdMin, wdMin, wdMin, wdMin, weMin];
    state.materials.forEach((m) => {
      m.archived = !f.get(`use-${m.id}`);
      if (m.mode === 'weekly') return;
      if (!m.total) {
        m.total = DEFAULT_TOTAL[m.unit] || 100;
        m.approxTotal = true;
      }
      const prog = f.get(`prog-${m.id}`);
      if (prog !== null) m.done = Math.round(m.total * num(prog));
      m.startDone = m.done || 0;
      m.created = t;
    });
    state.subjects.forEach((s) => {
      const name = (f.get(`add-${s.id}`) || '').trim();
      if (name) addBook(s, name, null, null);
    });
    state.setupDone = true;
    ui.setup = false;
    delete state.plans[t];
    ui.tab = 'plan';
    msg = '계획을 만들었어요. 이번 시험은 이렇게 공부하면 돼요.';
    window.scrollTo(0, 0);
  } else if (kind === 'task') {
    const task = findTask(form.dataset.id);
    if (!task) return;
    const wrongRaw = f.get('wrong');
    msg = completeTask(task, {
      amount: task.type === 'project' ? 1 : num(f.get('amount')),
      minutes: num(f.get('minutes')),
      wrong: wrongRaw === null || wrongRaw === '' ? null : num(wrongRaw),
      nextRange: (f.get('nextRange') || '').trim(),
      advance: !!f.get('advance'),
    });
    ui.openForm = null;
  } else if (kind === 'replan') {
    replan(num(f.get('minutes'), 60), state.plans[t].condition || '보통');
    msg = '남은 시간에 맞춰 다시 짰어요.';
  } else if (kind === 'book-exact') {
    const m = materialById(form.dataset.id);
    if (!m) return;
    const total = num(f.get('total'), 0);
    if (total > 0) {
      m.total = total;
      m.approxTotal = false;
    }
    m.done = Math.max(0, num(f.get('done')));
    ui.openBook = null;
    refreshUntouchedPlan();
  } else if (kind === 'add-book') {
    const name = (f.get('name') || '').trim();
    const s = subjectById(form.dataset.id);
    if (!name || !s) return;
    addBook(s, name, null, null);
    refreshUntouchedPlan();
    msg = `${name}을(를) 추가했어요. 표지나 목차를 사진으로 올리면 분량도 맞춰져요.`;
  } else if (kind === 'log') {
    state.logs.push({
      id: uid(), created: Date.now(), date: t, subject: f.get('subject'), kind: '수업', text: '',
      q: (f.get('q') || '').trim(), a: (f.get('a') || '').trim(), step: 0, due: addDays(t, LOG_INTERVALS[0]), history: [],
    });
    msg = '카드를 만들었어요. 내일 "오늘 떠올릴 것"에 나와요.';
  } else if (kind === 'project') {
    state.projects.push({
      id: uid(), title: f.get('title').trim(), subjectId: f.get('subjectId'), due: f.get('due'), stage: 0,
      versions: {}, question: '', role: '', limits: '', nextQuestion: '', memo: '',
    });
    refreshUntouchedPlan();
    msg = '추가했어요.';
  } else if (kind === 'time') {
    const wdMin = num(f.get('weekday'), 180);
    const weMin = num(f.get('weekend'), 360);
    state.settings.weekdayMinutes = [weMin, wdMin, wdMin, wdMin, wdMin, wdMin, weMin];
    refreshUntouchedPlan();
  } else if (kind === 'ai') {
    state.settings.aiUrl = (f.get('aiUrl') || '').trim();
    state.settings.aiCode = (f.get('aiCode') || '').trim();
  } else if (kind === 'member') {
    if (window.cloud) await window.cloud.addMember(f.get('email'));
    return;
  } else {
    return;
  }
  await save();
  toast(msg);
  await render();
});

// ---------- 시작 ----------

(async () => {
  await load();
  markReady();
  await render();
  initAi();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
