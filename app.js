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
    settings: { examDate: '', weekdayMinutes: [360, 180, 180, 180, 180, 180, 360] },
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
const ui = { tab: 'today', openForm: null, subjectId: null, editMaterial: null, wrongSubject: null };

async function load() {
  let saved = null;
  try {
    saved = await dbGet('state');
  } catch (e) {
    toast('저장소를 열 수 없어요. 개인정보 보호 모드인지 확인해 주세요.');
  }
  if (saved && saved.version === 2) {
    state = Object.assign(freshState(), saved);
  } else {
    state = freshState();
    if (saved) {
      // 1단계 앱 기록 옮기기
      state.logs = saved.logs || [];
      state.wrongs = saved.wrongs || [];
      state.drills = saved.drills || [];
      if (saved.exam && saved.exam.date) state.settings.examDate = saved.exam.date;
    }
    await save();
  }
}

async function save() {
  try {
    await dbSet('state', state);
  } catch (e) {
    toast('저장에 실패했어요.');
  }
}

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

function ensurePlan() {
  const t = today();
  if (state.plans[t]) return false;
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
    date: today(),
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
      id: uid(), created: Date.now(), date: today(), subject: subject ? subject.name : '',
      kind: m ? m.kind : '공부', text: `${m ? m.name : ''} ${data.note || ''}`.trim(),
      step: 0, due: addDays(today(), LOG_INTERVALS[0]),
    });
  }

  let msg = '기록했어요.';
  if (out.speed && Math.abs(out.speed.after - out.speed.before) >= 0.1) {
    msg = `${m.unit}당 예상 시간을 ${out.speed.before}분 → ${out.speed.after}분으로 조정했어요.`;
  }
  return { session, msg };
}

// ---------- 화면: 오늘 ----------

function taskForm(task) {
  const m = task.materialId ? materialById(task.materialId) : null;
  const isProblems = ['문제', '회', '지문'].includes(task.unit) && !['review', 'wrongPhoto', 'project'].includes(task.type);
  const reviewDefault = m && ['교과서', '암기', '지문'].includes(m.kind);
  if (task.type === 'review' || task.type === 'wrongPhoto') {
    return `
      <form class="inline-form" data-form="task" data-id="${task.id}">
        <div class="row">
          <div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" value="${task.minutes}" required></div>
          <div><label>시간대</label><select name="slot">${options(SLOTS, currentSlot())}</select></div>
        </div>
        <p class="sub">문제별 결과는 아래 "아침 10분" 목록에서 눌러 주세요.</p>
        <button class="btn primary" type="submit">완료</button>
      </form>`;
  }
  if (task.type === 'project') {
    return `
      <form class="inline-form" data-form="task" data-id="${task.id}">
        <div class="row">
          <div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" value="${task.minutes}" required></div>
          <div><label>시간대</label><select name="slot">${options(SLOTS, currentSlot())}</select></div>
        </div>
        <label class="inline"><input type="checkbox" name="advance" checked> 다음 단계로 넘기기</label>
        <button class="btn primary" type="submit">기록</button>
      </form>`;
  }
  return `
    <form class="inline-form" data-form="task" data-id="${task.id}">
      <div class="row">
        <div><label>실제로 한 양 (${esc(task.unit)})</label><input type="number" name="amount" min="0" step="any" value="${task.amount}" required></div>
        <div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" value="${task.minutes}" required></div>
        ${isProblems ? '<div><label>틀린 개수</label><input type="number" name="wrong" min="0" placeholder="0"></div>' : ''}
        <div><label>시간대</label><select name="slot">${options(SLOTS, currentSlot())}</select></div>
      </div>
      ${m ? `<label>다음에 시작할 곳 (선택)</label><input name="nextRange" value="${esc(m.nextRange)}" placeholder="예: 3-2 단원, 0431번, p.88">` : ''}
      <label>메모 (선택)</label><input name="note" placeholder="예: 원의 접선 조건에서 계속 막힘">
      <label class="inline"><input type="checkbox" name="addReview"${reviewDefault ? ' checked' : ''}> 간격 복습 목록에 넣기 (1·3·7·14·30일 후)</label>
      <button class="btn primary" type="submit">기록</button>
    </form>`;
}

const STATUS_LABEL = { todo: '할 일', done: '완료', partial: '일부', skipped: '건너뜀' };

function taskCard(task, highlight) {
  const reasons = (task.reasons || []).map((r) => `<span class="tag">${esc(r)}</span>`).join('');
  const actual = task.actual ? `<div class="meta">실제: ${task.actual.amount != null ? `${task.actual.amount}${esc(task.unit)} · ` : ''}${hm(task.actual.minutes)}${task.amount && task.actual.amount != null ? ` (계획의 ${Math.round((task.actual.amount / task.amount) * 100)}%)` : ''}</div>` : '';
  return `
    <li class="task ${task.status}${highlight ? ' first' : ''}">
      <div class="task-head">
        <div>
          <div class="task-title">${esc(task.title)} <span class="status s-${task.status}">${STATUS_LABEL[task.status]}</span></div>
          <div>${esc(task.detail)}</div>
          <div class="meta">예상 ${hm(task.minutes)}${task.unknownTotal ? ' · <span class="warn-text">총량 미입력 (과목 탭에서 입력하면 더 정확해져요)</span>' : ''}</div>
          ${actual}
          <div class="reasons">${reasons}</div>
        </div>
        ${task.status === 'todo' ? `
        <div class="actions">
          <button class="btn small primary" data-action="open-task" data-id="${task.id}">기록</button>
          <button class="btn small" data-action="skip-task" data-id="${task.id}">건너뛰기</button>
        </div>` : ''}
      </div>
      ${ui.openForm === task.id ? taskForm(task) : ''}
    </li>`;
}

function morningSection() {
  const t = today();
  const dueLogs = state.logs.filter((l) => l.due && l.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const dueWrongs = state.wrongs.filter((w) => w.due && w.due <= t).sort((a, b) => a.due.localeCompare(b.due));

  const logItems = dueLogs.length ? dueLogs.map((l) => `
    <li class="item">
      <div>
        <span class="tag">${esc(l.subject)}</span>
        <div>${esc(l.text)}</div>
        <div class="meta">${prettyDate(l.date)}에 공부 · ${l.step + 1}번째 복습</div>
      </div>
      <div class="actions">
        <button class="btn small good" data-action="log-ok" data-id="${l.id}">떠올렸어요</button>
        <button class="btn small bad" data-action="log-miss" data-id="${l.id}">기억 안 나요</button>
      </div>
    </li>`).join('') : '<li class="empty">오늘 다시 볼 진도가 없어요.</li>';

  const wrongItems = dueWrongs.length ? dueWrongs.map((w) => `
    <li class="item" style="display:block">
      <div><span class="tag">${esc(w.subject)}</span>${w.unit ? `<span class="tag">${esc(w.unit)}</span>` : ''}${w.trap ? `<span class="tag warn">${esc(w.trap)}</span>` : ''}</div>
      ${w.img ? `<img class="wrong-img" src="${w.img}" alt="오답 문제 사진">` : ''}
      ${w.note ? `<details><summary class="meta">지난번 꼬인 지점 (먼저 풀고 열기)</summary><div>${esc(w.note)}</div></details>` : ''}
      <div class="actions" style="margin-top:8px">
        <button class="btn small good" data-action="wrong-ok" data-id="${w.id}">맞혔어요</button>
        <button class="btn small bad" data-action="wrong-miss" data-id="${w.id}">또 틀렸어요</button>
      </div>
    </li>`).join('') : '<li class="empty">오늘 다시 풀 오답 사진이 없어요.</li>';

  return `
    <div class="card">
      <h2>아침 10분</h2>
      <p class="sub">등교 전에 이 두 목록만 보고 가요. 책을 펴기 전에 먼저 떠올려 보고 버튼을 누르세요.</p>
      <h3>다시 볼 진도 (${dueLogs.length})</h3>
      <ul class="list">${logItems}</ul>
      <h3>다시 풀 오답 (${dueWrongs.length})</h3>
      <ul class="list">${wrongItems}</ul>
    </div>`;
}

function renderToday() {
  const t = today();
  const plan = state.plans[t];
  const planned = plan.tasks.reduce((a, x) => a + x.minutes, 0);
  const actual = state.sessions.filter((s) => s.date === t).reduce((a, s) => a + (s.minutes || 0), 0);
  const doneCount = plan.tasks.filter((x) => x.status === 'done').length;
  const todo = plan.tasks.filter((x) => x.status === 'todo');
  const first = todo[0];
  const rate = planned ? Math.min(100, Math.round((actual / planned) * 100)) : 0;

  const firstCard = first ? `
    <div class="card hero">
      <div class="sub" style="margin:0">지금 가장 먼저 할 공부</div>
      <div class="hero-title">${esc(first.title)}</div>
      <div>${esc(first.detail)} · ${hm(first.minutes)}</div>
    </div>` : `
    <div class="card hero"><div class="hero-title">오늘 계획을 모두 처리했어요</div><div class="sub" style="margin:0">시간이 남으면 "남은 시간으로 다시 계획"을 눌러요.</div></div>`;

  const materialOptions = state.subjects.map((s) => {
    const mats = state.materials.filter((m) => m.subjectId === s.id && !m.archived);
    return `<optgroup label="${esc(s.name)}">${mats.map((m) => `<option value="${m.id}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</optgroup>`;
  }).join('');

  return `
    ${firstCard}
    <div class="card">
      <div class="row between">
        <div>
          <h2>오늘의 공부 ${prettyDate(t)}</h2>
          <p class="sub" style="margin:0">확보 시간 ${hm(plan.available)} × 컨디션(${esc(plan.condition)}) × 최근 수행률 ${Math.round(plan.factor * 100)}% → 계획 ${hm(planned)}</p>
        </div>
        <div class="rate"><strong>${rate}%</strong><span>${hm(actual)} / ${hm(planned)} · 완료 ${doneCount}/${plan.tasks.length}</span></div>
      </div>
      <div class="progress"><div style="width:${rate}%"></div></div>
      <ul class="tasks">${plan.tasks.map((x) => taskCard(x, x === first)).join('') || '<li class="empty">오늘 배정할 공부가 없어요. 과목 탭에서 교재 분량을 확인해 주세요.</li>'}</ul>
      <details class="replan">
        <summary>계획이 틀어졌어요 → 남은 시간으로 다시 계획</summary>
        <form data-form="replan" class="inline-form">
          <div class="row">
            <div><label>지금부터 쓸 수 있는 시간(분)</label><input type="number" name="minutes" min="0" value="${Math.max(0, todo.reduce((a, x) => a + x.minutes, 0))}" required></div>
            <div><label>컨디션</label><select name="condition">${options(['좋음', '보통', '피곤'], plan.condition)}</select></div>
          </div>
          <p class="sub">끝낸 과제는 그대로 두고, 나머지를 남은 양·시험일·취약도로 다시 배치해요. 못 한 분량은 내일 계획에 자동으로 넘어가요.</p>
          <button class="btn primary" type="submit">다시 계획</button>
        </form>
      </details>
    </div>

    ${morningSection()}

    <div class="card">
      <h2>계획에 없던 공부 기록</h2>
      <p class="sub">학원 숙제처럼 따로 한 공부도 넣어야 실제 속도와 남은 양이 정확해져요.</p>
      <form data-form="extra">
        <label>교재</label><select name="materialId">${materialOptions}</select>
        <div class="row">
          <div><label>한 양</label><input type="number" name="amount" min="0" step="any" required></div>
          <div><label>걸린 시간(분)</label><input type="number" name="minutes" min="0" required></div>
          <div><label>틀린 개수</label><input type="number" name="wrong" min="0" placeholder="0"></div>
        </div>
        <div style="margin-top:12px"><button class="btn primary" type="submit">기록</button></div>
      </form>
    </div>`;
}

// ---------- 화면: 과목 ----------

function needText(snap) {
  if (!snap.need && snap.unknown) return '<span class="warn-text">총량 미입력</span>';
  return `${hm(snap.need)}${snap.unknown ? '+' : ''}`;
}

const STATUS_CLASS = { 위험: 'risk', 주의: 'caution', 안정: 'stable' };

function rating(subject, field, label) {
  return `<div><label>${label}</label><select data-action="subj-field" data-id="${subject.id}" data-field="${field}">${options([1, 2, 3, 4, 5].map((n) => [n, `${n} / 5`]), subject[field])}</select></div>`;
}

function materialRow(m) {
  const t = today();
  const rem = remaining(state, m, t);
  const active = isActive(state, m, t);
  let amount;
  if (m.mode === 'weekly') amount = `매주 ${m.weekly}${m.unit} · 이번 주 남은 ${rem}${m.unit}`;
  else if (m.total == null) amount = `<span class="warn-text">총량 미입력</span> · 한 양 ${m.done}${m.unit}`;
  else amount = `${m.done}/${m.total}${m.unit} (${Math.round((Math.min(m.done, m.total) / m.total) * 100)}%)`;
  const editing = ui.editMaterial === m.id;
  return `
    <li class="item${m.archived ? ' muted' : ''}">
      <div>
        <div><strong>${esc(m.name)}</strong> <span class="tag">${esc(m.kind)}</span>${!active && !m.archived ? `<span class="tag">시험 ${m.activeBeforeExam}일 전부터</span>` : ''}${m.archived ? '<span class="tag">보관</span>' : ''}</div>
        <div class="meta">${amount} · ${m.unit}당 ${m.minPerUnit}분${m.accuracy != null ? ` · 정확도 ${pct(m.accuracy)}` : ''}${m.nextRange ? ` · 다음: ${esc(m.nextRange)}` : ''}</div>
      </div>
      <div class="actions"><button class="btn small" data-action="edit-material" data-id="${m.id}">${editing ? '닫기' : '수정'}</button></div>
      ${editing ? materialForm(m) : ''}
    </li>`;
}

function materialForm(m) {
  const isNew = !m.id;
  return `
    <form class="inline-form full" data-form="material" data-id="${m.id || ''}">
      <div class="row">
        <div><label>이름</label><input name="name" value="${esc(m.name)}" required></div>
        <div><label>종류</label><select name="kind">${options(KINDS, m.kind)}</select></div>
        <div><label>단위</label><input name="unit" value="${esc(m.unit)}" placeholder="문제, 쪽, 회, 지문" required></div>
      </div>
      <div class="row">
        <div><label>방식</label><select name="mode">${options([['range', '끝이 있는 분량'], ['weekly', '매주 할당량']], m.mode)}</select></div>
        <div><label>총량 (끝이 있는 분량)</label><input type="number" name="total" min="0" value="${m.total ?? ''}" placeholder="모르면 비워 두기"></div>
        <div><label>이미 한 양</label><input type="number" name="done" min="0" step="any" value="${m.done || 0}"></div>
        <div><label>주간 할당량</label><input type="number" name="weekly" min="0" value="${m.weekly || 0}"></div>
      </div>
      <div class="row">
        <div><label>${esc(m.unit || '단위')}당 예상 시간(분)</label><input type="number" name="minPerUnit" min="0.1" step="0.1" value="${m.minPerUnit}" required></div>
        <div><label>시험 며칠 전부터 (0 = 항상)</label><input type="number" name="activeBeforeExam" min="0" value="${m.activeBeforeExam || 0}"></div>
        <div><label>다음에 시작할 곳</label><input name="nextRange" value="${esc(m.nextRange)}"></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button>
        ${isNew ? '' : `<button class="btn" type="button" data-action="archive-material" data-id="${m.id}">${m.archived ? '보관 해제' : '보관 (계획에서 빼기)'}</button>`}
      </div>
    </form>`;
}

function subjectDetail(s) {
  const t = today();
  const snap = subjectSnapshot(state, s, t);
  const mats = state.materials.filter((m) => m.subjectId === s.id);
  const tips = recommend(state, s, t).map((x) => `<li>${esc(x)}</li>`).join('');
  const newMat = { id: '', subjectId: s.id, name: '', kind: '문제집', unit: '문제', mode: 'range', total: null, done: 0, weekly: 0, minPerUnit: 2, activeBeforeExam: 0, nextRange: '' };
  return `
    <button class="btn small" data-action="subject-back">← 전체 과목</button>
    <div class="card" style="margin-top:12px">
      <div class="row between">
        <h2>${esc(s.name)}</h2>
        <span class="badge ${STATUS_CLASS[snap.status]}">${snap.status}</span>
      </div>
      <div class="stats">
        <div><span>정확도</span><strong>${pct(s.accuracy)}</strong></div>
        <div><span>쌓인 오답</span><strong>${s.wrongPending || 0}</strong></div>
        <div><span>최근 학습</span><strong>${s.lastStudied ? prettyDate(s.lastStudied) : '-'}</strong></div>
        <div><span>남은 예상 시간</span><strong>${needText(snap)}</strong></div>
        <div><span>시험까지</span><strong>${snap.daysLeft != null ? `D-${snap.daysLeft}` : '-'}</strong></div>
        <div><span>가장 부족한 단계</span><strong>${snap.weakest}</strong></div>
      </div>
      <h3>지금 이렇게 공부하세요</h3>
      <ul class="tips">${tips}</ul>
    </div>

    <div class="card">
      <h2>현재 상태 진단</h2>
      <p class="sub">일주일에 한 번, 또는 시험·단원평가 뒤에 솔직하게 고쳐 주세요. 계획 우선순위에 바로 반영돼요.</p>
      <div class="row">
        ${rating(s, 'concept', '개념 이해도')}
        ${rating(s, 'memory', '암기 상태')}
        ${rating(s, 'importance', '중요도')}
        <div><label>현재 학습 단계</label><select data-action="subj-field" data-id="${s.id}" data-field="stage">${options(STAGES, s.stage)}</select></div>
      </div>
      <div class="row">
        <div><label>쌓인 오답 수</label><input type="number" min="0" data-action="subj-field" data-id="${s.id}" data-field="wrongPending" value="${s.wrongPending || 0}"></div>
        <div><label>이 과목 시험일 (비우면 전체 시험일)</label><input type="date" data-action="subj-field" data-id="${s.id}" data-field="examDate" value="${esc(s.examDate)}"></div>
      </div>
      <label>취약 개념 메모</label>
      <textarea data-action="subj-field" data-id="${s.id}" data-field="weakNotes" placeholder="${s.name.includes('수학') ? '예: 원의 접선, 점대칭, 부등식 영역' : '예: 어법 변형, 시대 흐름'}">${esc(s.weakNotes)}</textarea>
    </div>

    <div class="card">
      <h2>교재와 범위</h2>
      <ul class="list">${mats.map(materialRow).join('')}</ul>
      <h3>교재 추가</h3>
      ${materialForm(newMat)}
    </div>`;
}

function renderSubjects() {
  if (ui.subjectId) {
    const s = subjectById(ui.subjectId);
    if (s) return subjectDetail(s);
  }
  const t = today();
  const cards = state.subjects.map((s) => {
    const snap = subjectSnapshot(state, s, t);
    return `
      <button class="card subject-card" data-action="open-subject" data-id="${s.id}">
        <div class="row between"><strong>${esc(s.name)}</strong><span class="badge ${STATUS_CLASS[snap.status]}">${snap.status}</span></div>
        <div class="mini">
          <span>개념 ${s.concept}/5</span><span>암기 ${s.memory}/5</span><span>정확도 ${pct(s.accuracy)}</span><span>오답 ${s.wrongPending || 0}</span>
        </div>
        <div class="meta">단계: ${esc(s.stage)} · 부족: ${snap.weakest} · 남은 ${needText(snap)}</div>
      </button>`;
  }).join('');
  return `
    <p class="sub">과목을 눌러 상태를 진단하고 교재 분량을 입력하세요. 총량을 넣은 교재부터 계획이 정확해져요.</p>
    <div class="grid2">${cards}</div>`;
}

// ---------- 화면: 시험 ----------

function renderExam() {
  const t = today();
  const exam = state.settings.examDate;
  const left = exam ? diffDays(t, exam) : null;
  const factor = completionFactor(state, t);
  let avail = 0;
  if (left != null && left > 0) {
    for (let i = 0; i < left; i++) {
      avail += defaultAvailable(state, addDays(t, i)) * factor;
    }
  }
  const rows = state.subjects.map((s) => ({ s, snap: subjectSnapshot(state, s, t) }));
  const order = { 위험: 0, 주의: 1, 안정: 2 };
  rows.sort((a, b) => order[a.snap.status] - order[b.snap.status]);
  const totalNeed = rows.reduce((a, r) => a + r.snap.need, 0);

  const table = rows.map(({ s, snap }) => `
    <tr>
      <td><button class="linklike" data-action="open-subject-tab" data-id="${s.id}">${esc(s.name)}</button></td>
      <td><span class="badge ${STATUS_CLASS[snap.status]}">${snap.status}</span></td>
      <td>${snap.progress == null ? '-' : `${pct(snap.progress)}${snap.targetProgress != null ? ` <span class="meta">/ 목표 ${pct(snap.targetProgress)}</span>` : ''}`}</td>
      <td>${needText(snap)}</td>
      <td>${snap.recentDaily ? hm(snap.recentDaily) : '<span class="meta">기록 없음</span>'}</td>
      <td>${snap.daysLeft != null ? `D-${snap.daysLeft}` : '-'}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2>시험 일정</h2>
      <form data-form="exam" class="row">
        <div><label>시험 첫날</label><input type="date" name="examDate" value="${esc(exam)}"></div>
        <div style="align-self:end"><button class="btn primary" type="submit">저장</button></div>
      </form>
      <p class="sub" style="margin-top:8px">과목별로 시험일이 다르면 과목 탭에서 따로 넣을 수 있어요. 시험 범위가 공지되면 각 교재의 총량을 범위에 맞게 고쳐 주세요.</p>
    </div>
    ${left != null && left >= 0 ? `
    <div class="card">
      <div class="row between">
        <h2>D-${left || 'Day'}</h2>
        <div class="rate"><strong>${hm(totalNeed)}</strong><span>남은 예상 학습량</span></div>
      </div>
      <p class="sub">시험 전까지 쓸 수 있는 시간(최근 수행률 반영): <strong>${hm(avail)}</strong>${totalNeed > avail ? ' · <span class="warn-text">시간이 부족해요. 위험 과목부터, 중요도가 낮은 교재는 보관을 고려하세요.</span>' : ''}</p>
      <div class="table-wrap">
        <table class="dash">
          <thead><tr><th>과목</th><th>상태</th><th>진도</th><th>남은 시간</th><th>최근 하루 평균</th><th>시험</th></tr></thead>
          <tbody>${table}</tbody>
        </table>
      </div>
      <p class="meta">위험: 최근 7일 공부 속도로는 시험 전에 남은 양을 못 끝내거나 정확도가 60% 미만. 주의: 빠듯하거나, 오답·암기가 쌓였거나, 최근 기록이 없어 속도를 아직 모름. "+"는 총량을 입력하지 않은 교재가 더 있다는 뜻이에요.</p>
    </div>` : ''}`;
}

// ---------- 화면: 복습·오답 ----------

function renderReview() {
  const subjectNames = state.subjects.map((s) => s.name);
  const ws = ui.wrongSubject || subjectNames.find((n) => n.includes('수학')) || subjectNames[0];
  const traps = trapsFor(ws);

  const counts = {};
  state.wrongs.filter((w) => w.subject === ws).forEach((w) => { if (w.trap) counts[w.trap] = (counts[w.trap] || 0) + 1; });
  const maxCount = Math.max(1, ...Object.values(counts));
  const trapBars = Object.keys(counts).length
    ? Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((k) => `
      <div class="bar"><span class="name">${esc(k)}</span><span class="track"><span class="fill" style="width:${(counts[k] / maxCount) * 100}%"></span></span><span class="num">${counts[k]}</span></div>`).join('')
    : '<div class="empty">오답을 등록하면 어디서 자주 틀리는지 보여 줘요.</div>';

  const recentLogs = state.logs.slice().sort((a, b) => b.created - a.created).slice(0, 15).map((l) => `
    <li class="item">
      <div><span class="tag">${esc(l.subject)}</span>${esc(l.text)}<div class="meta">${prettyDate(l.date)} · ${l.due ? `다음 복습 ${prettyDate(l.due)}` : '복습 완료'}</div></div>
      <div class="actions"><button class="btn small" data-action="log-del" data-id="${l.id}">삭제</button></div>
    </li>`).join('') || '<li class="empty">아직 기록이 없어요.</li>';

  const recentDrills = state.drills.slice(-5).reverse().map((d) => `
    <li class="item"><div><span class="tag">${esc(d.unit)}</span> 조건 ${esc(d.conds)}개 · 숨은 조건: ${esc(d.hidden || '없음')}<div class="meta">${prettyDate(d.date)}</div></div></li>`).join('');
  const drillsToday = state.drills.filter((d) => d.date === today()).length;

  return `
    <div class="card">
      <h2>오답 사진 등록</h2>
      <p class="sub">틀린 문제를 찍어 올리면 2일 → 7일 → 14일 → 30일 후에 아침 목록에 다시 나와요. 또 틀리면 처음부터.</p>
      <form data-form="wrong">
        <label>문제 사진</label>
        <input type="file" name="img" accept="image/*">
        <div class="row">
          <div><label>과목</label><select name="subject" data-action="wrong-subject">${options(subjectNames, ws)}</select></div>
          <div><label>단원</label><input name="unit" placeholder="예: 원의 방정식"></div>
          <div><label>틀린 원인</label><select name="trap">${options(traps)}</select></div>
        </div>
        <label>어디서 꼬였나 (한 줄)</label>
        <input name="note" placeholder="예: x가 정수라는 조건을 문제 끝에서 놓침">
        <div style="margin-top:12px"><button class="btn primary" type="submit">오답 등록</button></div>
      </form>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>${esc(ws)} · 어디서 틀리나</h2>
        <p class="sub">가장 긴 막대부터 대비하세요.</p>
        ${trapBars}
      </div>
      <div class="card">
        <h2>수학 조건 해석 훈련 (${drillsToday}/3)</h2>
        <p class="sub">하루 3문제. 풀지 말고 읽기만 하고 칸을 채워요. 군포고식 꼬인 문제 대비.</p>
        <form data-form="drill">
          <div class="row">
            <div><label>단원</label><input name="unit" placeholder="예: 명제" required></div>
            <div><label>주어진 조건 수</label><input type="number" name="conds" min="0" max="20" required></div>
          </div>
          <label>숨은 조건 (정수, 양수, 정의역, "서로 다른" 등)</label>
          <input name="hidden" placeholder="예: a, b는 자연수 / x ≠ 0">
          <div style="margin-top:12px"><button class="btn primary" type="submit">기록</button></div>
        </form>
        <ul class="list" style="margin-top:8px">${recentDrills}</ul>
      </div>
    </div>

    <div class="card">
      <h2>진도 직접 기록</h2>
      <p class="sub">수업에서 나간 범위를 남기면 1·3·7·14·30일 후 아침 목록에 나와요.</p>
      <form data-form="log">
        <div class="row">
          <div><label>과목</label><select name="subject">${options(subjectNames)}</select></div>
          <div style="flex:3 1 260px"><label>범위 / 내용</label><input name="text" placeholder="예: 교과서 p.58~61 원의 방정식" required></div>
        </div>
        <div style="margin-top:12px"><button class="btn primary" type="submit">기록</button></div>
      </form>
      <h3>최근 복습 목록</h3>
      <ul class="list">${recentLogs}</ul>
    </div>`;
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

// ---------- 화면: 설정 ----------

function renderSettings() {
  const inputs = WEEKDAYS.map((w, i) => `<div><label>${w}요일</label><input type="number" name="d${i}" min="0" step="10" value="${state.settings.weekdayMinutes[i]}"></div>`).join('');
  return `
    <div class="card">
      <h2>요일별 공부 가능 시간 (분)</h2>
      <p class="sub">학교·학원·이동 시간을 빼고 실제로 책상에 앉을 수 있는 시간이에요. 오늘 계획은 이 값에서 시작해요.</p>
      <form data-form="weekdays"><div class="row seven">${inputs}</div><div style="margin-top:12px"><button class="btn primary" type="submit">저장</button></div></form>
    </div>
    <div class="card">
      <h2>백업</h2>
      <p class="sub">기록은 이 아이패드 브라우저 안에만 저장돼요. 일주일에 한 번 백업 파일을 받아 두세요.</p>
      <div class="row">
        <button class="btn" data-action="export">백업 파일 받기</button>
        <label class="btn" style="margin:0;text-align:center;color:var(--text)">백업 불러오기<input type="file" accept="application/json" data-action="import" hidden></label>
      </div>
    </div>
    <div class="card">
      <h2>홈 화면에 추가</h2>
      <p class="sub" style="margin:0">Safari 공유 버튼 → "홈 화면에 추가"를 누르면 앱처럼 열려요.</p>
    </div>
    <div class="card">
      <h2>처음부터 다시</h2>
      <p class="sub">모든 기록을 지우고 기본 교재 목록으로 되돌려요.</p>
      <button class="btn bad" data-action="reset">초기화</button>
    </div>`;
}

// ---------- 렌더링 ----------

const VIEWS = {
  today: renderToday, subjects: renderSubjects, exam: renderExam, review: renderReview,
  projects: renderProjects, analysis: renderAnalysis, settings: renderSettings,
};

async function render() {
  if (ensurePlan()) await save();
  document.getElementById('view').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  const exam = state.settings.examDate;
  const left = exam ? diffDays(today(), exam) : null;
  const dday = document.getElementById('dday');
  dday.hidden = left == null || left < 0;
  if (!dday.hidden) dday.textContent = left === 0 ? 'D-Day' : `D-${left}`;
}

// ---------- 동작 ----------

function advance(item, intervals, ok) {
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
    await render();
    window.scrollTo(0, 0);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const { action, id } = el.dataset;
  let changed = true;

  switch (action) {
    case 'open-task':
      ui.openForm = ui.openForm === id ? null : id;
      changed = false;
      break;
    case 'skip-task': {
      const task = findTask(id);
      if (task) task.status = 'skipped';
      toast('건너뛰었어요. 남은 양은 다음 계획에 다시 배정돼요.');
      break;
    }
    case 'log-ok':
    case 'log-miss': {
      const l = state.logs.find((x) => x.id === id);
      if (l) advance(l, LOG_INTERVALS, action === 'log-ok');
      break;
    }
    case 'wrong-ok':
    case 'wrong-miss': {
      const w = state.wrongs.find((x) => x.id === id);
      if (w) {
        w.history.push({ date: today(), ok: action === 'wrong-ok' });
        advance(w, WRONG_INTERVALS, action === 'wrong-ok');
      }
      toast(action === 'wrong-ok' ? '좋아요! 간격을 늘렸어요.' : '2일 후에 다시 나와요.');
      break;
    }
    case 'log-del':
      if (!confirm('이 복습 기록을 삭제할까요?')) return;
      state.logs = state.logs.filter((x) => x.id !== id);
      break;
    case 'open-subject':
      ui.subjectId = id;
      ui.editMaterial = null;
      changed = false;
      window.scrollTo(0, 0);
      break;
    case 'open-subject-tab':
      ui.tab = 'subjects';
      ui.subjectId = id;
      changed = false;
      window.scrollTo(0, 0);
      break;
    case 'subject-back':
      ui.subjectId = null;
      changed = false;
      break;
    case 'edit-material':
      ui.editMaterial = ui.editMaterial === id ? null : id;
      changed = false;
      break;
    case 'archive-material': {
      const m = materialById(id);
      if (m) m.archived = !m.archived;
      ui.editMaterial = null;
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

  if (action === 'subj-field') {
    const s = subjectById(el.dataset.id);
    if (!s) return;
    const f = el.dataset.field;
    s[f] = ['concept', 'memory', 'importance', 'wrongPending'].includes(f) ? num(el.value) : el.value;
    if (f !== 'weakNotes') refreshUntouchedPlan();
    await save();
    if (f !== 'weakNotes') await render();
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
  if (action === 'wrong-subject') {
    ui.wrongSubject = el.value;
    await render();
    return;
  }
  if (action === 'import') {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.logs)) throw new Error('형식 오류');
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요?')) return;
      if (data.version === 2) {
        state = Object.assign(freshState(), data);
      } else {
        state = freshState();
        state.logs = data.logs || [];
        state.wrongs = data.wrongs || [];
        state.drills = data.drills || [];
      }
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

  if (kind === 'task') {
    const task = findTask(form.dataset.id);
    if (!task) return;
    const minutes = num(f.get('minutes'));
    const slot = f.get('slot');
    if (task.type === 'review' || task.type === 'wrongPhoto') {
      recordSession({ type: task.type, minutes, amount: 0, slot, taskId: task.id });
      task.actual = { amount: null, minutes };
      task.status = 'done';
    } else if (task.type === 'project') {
      recordSession({ type: 'project', subjectId: task.subjectId, minutes, amount: 0, slot, taskId: task.id });
      task.actual = { amount: null, minutes };
      task.status = 'done';
      const p = state.projects.find((x) => x.id === task.projectId);
      if (p && f.get('advance')) p.stage = Math.min(PROJECT_STAGES.length - 1, p.stage + 1);
    } else {
      const amount = num(f.get('amount'));
      const wrongRaw = f.get('wrong');
      const res = recordSession({
        type: task.type,
        materialId: task.materialId,
        subjectId: task.subjectId,
        taskId: task.id,
        planned: { amount: task.amount, minutes: task.minutes },
        amount,
        minutes,
        wrong: wrongRaw === null || wrongRaw === '' ? null : num(wrongRaw),
        slot,
        note: (f.get('note') || '').trim(),
        nextRange: (f.get('nextRange') || '').trim(),
        addReview: !!f.get('addReview'),
      });
      task.actual = { amount, minutes };
      task.status = amount >= task.amount ? 'done' : amount > 0 ? 'partial' : 'skipped';
      msg = res.msg;
      if (task.status === 'partial') msg += ` 계획의 ${Math.round((amount / task.amount) * 100)}%를 했어요. 남은 양은 다시 배정돼요.`;
    }
    ui.openForm = null;
  } else if (kind === 'replan') {
    replan(num(f.get('minutes')), f.get('condition'));
    msg = '남은 시간에 맞춰 다시 계획했어요.';
  } else if (kind === 'extra') {
    const m = materialById(f.get('materialId'));
    if (!m) return;
    const wrongRaw = f.get('wrong');
    msg = recordSession({
      materialId: m.id, subjectId: m.subjectId, amount: num(f.get('amount')), minutes: num(f.get('minutes')),
      wrong: wrongRaw === '' ? null : num(wrongRaw),
    }).msg;
  } else if (kind === 'material') {
    const id = form.dataset.id;
    const totalRaw = f.get('total');
    const data = {
      name: f.get('name').trim(),
      kind: f.get('kind'),
      unit: f.get('unit').trim(),
      mode: f.get('mode'),
      total: totalRaw === '' ? null : num(totalRaw),
      done: num(f.get('done')),
      weekly: num(f.get('weekly')),
      minPerUnit: Math.max(0.1, num(f.get('minPerUnit'), 1)),
      activeBeforeExam: num(f.get('activeBeforeExam')),
      nextRange: f.get('nextRange').trim(),
    };
    if (id) {
      Object.assign(materialById(id), data);
    } else {
      state.materials.push(Object.assign({ id: uid(), subjectId: ui.subjectId, accuracy: null, archived: false, created: t }, data));
      msg = '교재를 추가했어요.';
    }
    ui.editMaterial = null;
  } else if (kind === 'exam') {
    state.settings.examDate = f.get('examDate');
  } else if (kind === 'wrong') {
    const file = f.get('img');
    let img = '';
    if (file && file.size) {
      try {
        img = await compressImage(file);
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    const note = f.get('note').trim();
    if (!img && !note) {
      toast('사진이나 메모 중 하나는 있어야 해요.');
      return;
    }
    const subjectName = f.get('subject');
    state.wrongs.push({
      id: uid(), date: t, subject: subjectName, unit: f.get('unit').trim(), trap: f.get('trap'),
      note, img, step: 0, due: addDays(t, WRONG_INTERVALS[0]), history: [],
    });
    msg = '오답을 등록했어요. 2일 후에 다시 나와요.';
  } else if (kind === 'drill') {
    state.drills.push({ id: uid(), date: t, unit: f.get('unit').trim(), conds: f.get('conds'), hidden: f.get('hidden').trim() });
    const n = state.drills.filter((d) => d.date === t).length;
    msg = n >= 3 ? '오늘 훈련 완료!' : `오늘 ${n}/3`;
  } else if (kind === 'log') {
    state.logs.push({
      id: uid(), created: Date.now(), date: t, subject: f.get('subject'), kind: '수업',
      text: f.get('text').trim(), step: 0, due: addDays(t, LOG_INTERVALS[0]),
    });
    msg = '기록했어요. 내일 아침 목록에 나와요.';
  } else if (kind === 'project') {
    state.projects.push({
      id: uid(), title: f.get('title').trim(), subjectId: f.get('subjectId'), due: f.get('due'), stage: 0,
      versions: {}, question: '', role: '', limits: '', nextQuestion: '', memo: '',
    });
    msg = '추가했어요.';
  } else if (kind === 'weekdays') {
    state.settings.weekdayMinutes = WEEKDAYS.map((_, i) => num(f.get(`d${i}`)));
    const plan = state.plans[t];
    if (plan && plan.tasks.every((x) => x.status === 'todo')) delete state.plans[t];
  } else {
    return;
  }
  if (['material', 'exam', 'project'].includes(kind)) refreshUntouchedPlan();
  await save();
  toast(msg);
  await render();
});

// ---------- 시작 ----------

(async () => {
  await load();
  await render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
