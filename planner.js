'use strict';

// 계획 엔진: 화면과 분리된 순수 함수만 둔다 (node로 테스트 가능)

const STAGES = ['개념', '예제', '문제풀이', '오답', '복습', '암기'];

const KINDS = ['교과서', '문제집', '오답', '암기', '모의고사', '지문', '단어', '숙제', '기출'];

// 진도 복습 간격(일)
const LOG_INTERVALS = [1, 3, 7, 14, 30];
// 오답 사진 재출제 간격(일). 틀리면 처음으로
const WRONG_INTERVALS = [2, 7, 14, 30];

const PROJECT_STAGES = ['주제', '탐구 질문', '자료조사', '분석', '결과물', '발표/제출', '완료'];

// 자료 종류별 "완료 기준" 문구
const KIND_METHOD = {
  교과서: '개념 1회독 → 책 덮고 핵심 3줄 백지 확인',
  문제집: '채점 후 틀린 문제 오답 정리',
  오답: '틀린 문제만 다시 풀기 → 또 틀리면 표시',
  암기: '빈칸 뚫고 암기 → 빈칸 테스트로 확인',
  모의고사: '시간 재고 풀기 → 채점 → 틀린 문제 원인 한 줄',
  지문: '본문 암기 → 빈칸·어법 변형 셀프 테스트',
  단어: '외우고 가리고 테스트, 틀린 단어 표시',
  숙제: '채점 후 틀린 문제 표시',
  기출: '시험 시간과 같게 재고 풀기 → 어디서 꼬였는지 기록',
};

// 요구사항 문서 5장: 과목별 관리 방식
const SUBJECT_GUIDE = [
  ['수학', '개념 이해 → 조건 확인 → 풀이 → 검산/오답 순서로 해요. 문제를 읽고 숨은 조건부터 표시하세요.'],
  ['영어', '지문·어휘·어법·문장구조를 따로 점검하세요. 내신 대비는 핵심 어휘, 연결어, 어법 변형 포인트 위주로.'],
  ['국어', '문법은 개념을 외우는 데서 멈추지 말고 "시험장에서 판별하는 기준"으로 정리하세요. 개념 이해와 문제 적용을 따로 체크.'],
  ['과학', '교과서 개념 → 예제 → 문제풀이 → 오답 → 재복습. 문제집을 끝냈다면 개념 반복보다 오답·취약 문제 중심으로.'],
  ['정보', '단원별 개념과 예제·문제풀이를 분리하세요. 범위가 많으면 남은 단원 수와 예상 시간을 먼저 확인.'],
  ['한국사', '개념 → 시대 흐름 → 사건 간 관계 → 문제풀이 → 틀린 선지 분석 → 재회독.'],
  ['사회', '교과서·PPT 빈칸 암기 후 기출 문제로 확인하고, 틀린 선지는 왜 틀렸는지 한 줄로.'],
];

// 과목별 오답 원인 분류
const TRAPS_BY_SUBJECT = [
  ['수학', ['숨은 조건 놓침', '두 단원 결합', '교과서 예제 변형', '함정 보기(ㄱㄴㄷ)', '개념 이해 부족', '계산 실수', '시간 부족']],
  ['영어', ['어휘', '어법 변형', '문장구조 해석', '지문 내용 기억', '연결어·흐름', '시간 부족']],
  ['국어', ['문법 판별 기준', '개념은 아는데 적용 실패', '선지 끝까지 안 읽음', '지문 근거 놓침', '시간 부족']],
  ['한국사', ['시대 흐름 혼동', '사건 관계 혼동', '틀린 선지 판단', '암기 부족']],
  ['', ['개념 이해 부족', '암기 부족', '자료 해석', '계산 실수', '선지 판단', '시간 부족']],
];

function trapsFor(subjectName) {
  return (TRAPS_BY_SUBJECT.find(([k]) => k && subjectName.includes(k)) || TRAPS_BY_SUBJECT[TRAPS_BY_SUBJECT.length - 1])[1];
}

function guideFor(subjectName) {
  const g = SUBJECT_GUIDE.find(([k]) => subjectName.includes(k));
  return g ? g[1] : '';
}

// ---------- 날짜 ----------

function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

function diffDays(fromKey, toKeyStr) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKeyStr.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// 월요일 = 0
function dayIndexMon(key) {
  return (parseKey(key).getDay() + 6) % 7;
}

function weekStart(key) {
  return addDays(key, -dayIndexMon(key));
}

// ---------- 상태 계산 ----------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

function examDateFor(state, subject) {
  return (subject && subject.examDate) || state.settings.examDate || '';
}

function daysLeftFor(state, subject, today) {
  const d = examDateFor(state, subject);
  if (!d) return null;
  const n = diffDays(today, d);
  return n >= 0 ? n : null;
}

// ---------- 공부 계획표: 책마다 역할과 기간 ----------
// 과외 선생님 순서: 교과서 개념 → 기본 문제집 → 심화(업그레이드) → 기출 → 반복(2·3회독)

const ROLES = ['concept', 'basic', 'advanced', 'past', 'review', 'weekly'];
const ROLE_LABEL = { concept: '개념', basic: '기본 문제', advanced: '심화 (업그레이드)', past: '기출', review: '오답', weekly: '매주' };

function roleOf(m) {
  if (m.role) return m.role;
  if (m.mode === 'weekly') return 'weekly';
  if (['교과서', '암기', '단어'].includes(m.kind)) return 'concept';
  if (m.kind === '기출' || m.kind === '지문') return 'past';
  if (m.kind === '오답') return 'review';
  if (/고쟁이|일품|블랙라벨|심화|최고/.test(m.name)) return 'advanced';
  return 'basic';
}

// 책의 회독별 기간. 시험일을 모르면 앞으로 4주를 한 기간으로 본다.
// 선행·방학 계획: 시험과 상관없이 기간 안에 끝낼 책 묶음
function goalOf(state, m) {
  return m.goalId ? (state.goals || []).find((g) => g.id === m.goalId) || null : null;
}

// 선행 기간 안에서 역할별로 기간을 나눈다 (개념 먼저, 문제는 조금 늦게 시작해 겹치게)
function goalWindows(goal, role, today) {
  const span = Math.max(1, diffDays(goal.start, goal.end) + 1);
  const at = (f) => addDays(goal.start, Math.round((span - 1) * f));
  const parts = { concept: [0, 0.5], basic: [0.1, 0.85], advanced: [0.55, 1], past: [0.8, 1] }[role] || [0, 1];
  let start = at(parts[0]);
  let end = at(parts[1]);
  if (end < today) end = today;
  if (start > end) start = end;
  return [{ pass: 1, start, end }];
}

function bookWindows(state, m, subject, today) {
  const goal = goalOf(state, m);
  if (goal) return goalWindows(goal, roleOf(m), today);
  const exam = examDateFor(state, subject);
  if (!exam || exam < today) return [{ pass: 1, start: today, end: addDays(today, 27) }];
  const at = (n) => addDays(exam, -n);
  const role = roleOf(m);
  const hasAdvanced = state.materials.some((x) => x.subjectId === m.subjectId && !x.archived && roleOf(x) === 'advanced');
  let list;
  if (role === 'concept') list = [[1, today, at(22)], [2, at(14), at(8)], [3, at(3), at(1)]];
  else if (role === 'basic') list = [[1, today, hasAdvanced ? at(22) : at(15)]];
  else if (role === 'advanced') list = [[1, at(21), at(11)]];
  else if (role === 'past') list = [[1, m.kind === '지문' ? at(14) : at(10), at(3)]];
  else list = [[1, today, at(1)]];
  return list.map(([pass, start, end]) => {
    const e = end < today ? today : end;
    return { pass, start: start > e ? e : start, end: e };
  });
}

function currentWindow(state, m, subject, today) {
  const wins = bookWindows(state, m, subject, today);
  const w = wins[Math.min((m.pass || 1), wins.length) - 1];
  // 앞 회독을 일찍 끝냈으면 다음 회독은 바로 시작한다
  const start = (m.pass || 1) > 1 && m.passStarted && m.passStarted < w.start ? m.passStarted : w.start;
  return { ...w, start, last: (m.pass || 1) >= wins.length };
}

function isActive(state, m, today) {
  if (m.archived) return false;
  const subject = state.subjects.find((s) => s.id === m.subjectId);
  const goal = goalOf(state, m);
  const w = currentWindow(state, m, subject, today);
  if (goal) return today >= goal.start && today >= w.start && today <= addDays(goal.end, 7);
  const exam = examDateFor(state, subject);
  return today >= w.start && (!exam || today <= exam);
}

function doneThisWeek(state, materialId, today) {
  const start = weekStart(today);
  return state.sessions
    .filter((s) => s.materialId === materialId && s.date >= start && s.date <= today)
    .reduce((a, s) => a + (s.amount || 0), 0);
}

// 남은 분량. 총량을 모르면 null
function remaining(state, m, today) {
  if (m.mode === 'weekly') return Math.max(0, (m.weekly || 0) - doneThisWeek(state, m.id, today));
  if (m.total == null || m.total === '') return null;
  return Math.max(0, m.total - (m.done || 0));
}

function needMinutes(state, m, today) {
  const r = remaining(state, m, today);
  return r == null ? null : r * m.minPerUnit;
}

// 최근 7일 계획 대비 실제 수행률 (0.6~1.0). 데이터가 없으면 1
function completionFactor(state, today) {
  const rates = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, -i);
    const plan = state.plans[d];
    if (!plan) continue;
    const planned = plan.tasks.reduce((a, t) => a + t.minutes, 0);
    if (!planned) continue;
    const actual = state.sessions.filter((s) => s.date === d).reduce((a, s) => a + (s.minutes || 0), 0);
    rates.push(Math.min(1, actual / planned));
  }
  if (!rates.length) return 1;
  return round1(clamp(rates.reduce((a, b) => a + b, 0) / rates.length, 0.6, 1));
}

const CONDITION = { 좋음: 1, 보통: 0.85, 피곤: 0.7 };

function effectiveBudget(state, today, available, condition) {
  const f = completionFactor(state, today);
  return { minutes: Math.round(available * (CONDITION[condition] || 1) * f), factor: f };
}

// 방학처럼 하루 공부 시간을 따로 정한 선행 기간이면 그 시간을 쓴다
function defaultAvailable(state, today) {
  const base = state.settings.weekdayMinutes[parseKey(today).getDay()] || 0;
  const vacation = (state.goals || []).filter((g) => g.minutes && today >= g.start && today <= g.end);
  return vacation.length ? Math.max(base, ...vacation.map((g) => g.minutes)) : base;
}

function daysSince(key, today) {
  return key ? diffDays(key, today) : null;
}

// ---------- 오늘 계획 생성 ----------

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 이 책을 며칠 안에 끝내야 하나. 문제집·교과서 1회독은 시험 22일 전까지(1단계),
// 기출·오답·암기는 시험 전날까지. 시험이 가까우면 이틀은 여유로 남긴다.
// 지금 회독을 끝내야 하는 날까지 남은 날수 (늦었으면 이틀 안에 따라잡기)
function deadlineDays(state, m, subject, today) {
  const w = currentWindow(state, m, subject, today);
  return Math.max(today > w.end ? 2 : 1, diffDays(today, w.end) + 1);
}

function materialCandidate(state, m, subject, today) {
  const rem = remaining(state, m, today);
  if (rem === 0) return null;
  const goal = goalOf(state, m);
  const examLeft = daysLeftFor(state, subject, today);
  const left = goal ? Math.max(0, diffDays(today, goal.end)) : examLeft;
  const mpu = m.minPerUnit;
  const reasons = [];
  if (goal) reasons.push(`${goal.name}`);

  // 오늘 분량
  let units;
  if (m.mode === 'weekly') {
    const daysInWeek = 7 - dayIndexMon(today);
    units = Math.ceil(rem / daysInWeek);
  } else if (rem != null && left != null) {
    units = Math.ceil(rem / deadlineDays(state, m, subject, today));
  } else {
    units = Math.round(45 / mpu); // 총량이나 시험일을 모르면 45분 분량
  }
  // 한 번 앉으면 최소 30분, 최대 90분
  let minutes = clamp(units * mpu, 30, 90);
  units = Math.max(1, Math.floor(minutes / mpu));
  if (rem != null) units = Math.min(units, rem);
  minutes = Math.round(units * mpu);

  // 우선순위 점수
  const need = rem == null ? null : rem * mpu;
  let urgency = 0;
  let closeness = 0;
  if (left != null) {
    closeness = left <= 21 ? (21 - left) / 21 : 0;
    if (need != null) urgency = clamp(need / 60 / Math.max(1, left - 2), 0, 1.5);
    if (!goal) reasons.push(`시험 D-${left}`);
    if (need != null && need >= 60) reasons.push(`남은 약 ${Math.round(need / 60)}시간`);
  }

  let weak;
  if (['교과서'].includes(m.kind)) {
    weak = (5 - subject.concept) / 4;
    if (subject.concept <= 2) reasons.push(`개념 이해도 ${subject.concept}/5`);
  } else if (['암기', '단어'].includes(m.kind)) {
    weak = (5 - subject.memory) / 4;
    if (subject.memory <= 2) reasons.push(`암기 ${subject.memory}/5`);
  } else {
    const acc = m.accuracy != null ? m.accuracy : subject.accuracy;
    weak = acc == null ? 0.3 : 1 - acc;
    if (acc != null && acc < 0.75) reasons.push(`정확도 ${Math.round(acc * 100)}%`);
  }

  const since = daysSince(subject.lastStudied, today);
  const gap = since == null ? 0.5 : clamp(since / 7, 0, 1);
  if (since != null && since >= 3) reasons.push(`${since}일째 안 함`);

  let behind = 0;
  if (m.mode === 'weekly' && m.weekly) {
    const doneW = m.weekly - rem;
    const expected = (m.weekly * (dayIndexMon(today) + 1)) / 7;
    behind = clamp((expected - doneW) / m.weekly, 0, 1);
    reasons.push(`이번 주 ${doneW}/${m.weekly}${m.unit}`);
  }

  let stageFit = 1;
  // 오답 단계인 과목은 새 진도보다 오답 쪽으로
  if (subject.stage === '오답' && !['오답', '기출'].includes(m.kind)) stageFit = 0.7;
  if (subject.stage === '암기' && ['암기', '단어'].includes(m.kind)) stageFit = 1.2;

  const importance = 0.6 + subject.importance * 0.2;
  // 시험이 3주 안이면 선행은 뒤로 미룬다
  const goalFactor = goal ? (examLeft != null && examLeft <= 21 ? 0.4 : 0.8) : 1;
  const score = goalFactor * importance * stageFit * (1 + 2 * urgency + closeness + 1.2 * weak + 0.8 * gap + behind);

  const range = m.nextRange ? ` (${m.nextRange}부터)` : '';
  return {
    id: makeId(),
    type: 'material',
    materialId: m.id,
    subjectId: subject.id,
    title: `${subject.name} · ${m.name}`,
    amount: units,
    unit: m.unit,
    minutes,
    detail: `${units}${m.unit}${range} + ${KIND_METHOD[m.kind] || ''}`,
    unknownTotal: rem == null,
    reasons,
    score,
    status: 'todo',
  };
}

function wrongPendingCandidate(state, subject, today) {
  if (!subject.wrongPending) return null;
  const mpu = subject.name.includes('수학') ? 5 : 2.5;
  const units = Math.min(subject.wrongPending, Math.max(1, Math.floor(45 / mpu)));
  const importance = 0.6 + subject.importance * 0.2;
  const left = daysLeftFor(state, subject, today);
  const closeness = left != null && left <= 21 ? (21 - left) / 21 : 0;
  const pile = clamp(subject.wrongPending / 20, 0, 1);
  return {
    id: makeId(),
    type: 'wrongPending',
    subjectId: subject.id,
    title: `${subject.name} · 쌓인 오답 정리`,
    amount: units,
    unit: '문제',
    minutes: Math.round(units * mpu),
    detail: `${units}문제 다시 풀기 → 또 틀리면 원인 한 줄 기록`,
    reasons: [`쌓인 오답 ${subject.wrongPending}개`],
    score: importance * (1 + 2 * pile + closeness + 0.5),
    status: 'todo',
  };
}

// "오늘 떠올릴 것" 카드(복습·오답 사진)에 쓸 시간. 할 공부 목록에는 따로 넣지 않고 시간만 비워 둔다
function recallMinutes(state, today) {
  const logs = state.logs.filter((l) => l.due && l.due <= today).length;
  const wrongs = state.wrongs.filter((w) => w.due && w.due <= today).length;
  return Math.min(30, logs * 2 + wrongs * 5);
}

function fixedTasks(state, today) {
  const tasks = [];
  state.projects.forEach((p) => {
    if (p.stage >= PROJECT_STAGES.length - 1 || !p.due) return;
    const left = diffDays(today, p.due);
    if (left < 0 || left > 7) return;
    const subject = state.subjects.find((s) => s.id === p.subjectId);
    tasks.push({
      id: makeId(), type: 'project', projectId: p.id, subjectId: p.subjectId,
      title: `수행평가 · ${p.title}`, amount: 1, unit: '단계',
      minutes: left <= 2 ? 60 : 40,
      detail: `다음 단계: ${PROJECT_STAGES[p.stage + 1] || PROJECT_STAGES[p.stage]}${subject ? ` (${subject.name})` : ''}`,
      reasons: [`마감 D-${left}`], status: 'todo',
    });
  });
  return tasks;
}

// opts.exclude: 오늘 이미 끝냈거나 진행한 자료 id (재계획할 때)
function generatePlan(state, today, budget, opts = {}) {
  const exclude = new Set(opts.exclude || []);
  const tasks = [];
  let left = budget - (opts.skipFixed ? 0 : recallMinutes(state, today));

  const fixed = opts.skipFixed ? [] : fixedTasks(state, today);
  for (const t of fixed) {
    if (left < 10) break;
    t.minutes = Math.min(t.minutes, left);
    tasks.push(t);
    left -= t.minutes;
  }

  const candidates = [];
  state.subjects.forEach((s) => {
    const w = wrongPendingCandidate(state, s, today);
    if (w && !exclude.has(`wrong:${s.id}`)) candidates.push(w);
  });
  state.materials.forEach((m) => {
    if (exclude.has(m.id) || !isActive(state, m, today)) return;
    const subject = state.subjects.find((s) => s.id === m.subjectId);
    if (!subject) return;
    const c = materialCandidate(state, m, subject, today);
    if (c) candidates.push(c);
  });
  candidates.sort((a, b) => b.score - a.score);

  const perSubject = {};
  for (const c of candidates) {
    if (left < 15) break;
    if ((perSubject[c.subjectId] || 0) >= 2) continue;
    if (c.minutes > left) {
      const material = state.materials.find((m) => m.id === c.materialId);
      const mpu = material ? material.minPerUnit : c.minutes / c.amount;
      const units = Math.floor(left / mpu);
      if (units < 1) continue;
      c.amount = units;
      c.minutes = Math.round(units * mpu);
      c.detail = c.detail.replace(/^\d+/, String(units));
    }
    tasks.push(c);
    left -= c.minutes;
    perSubject[c.subjectId] = (perSubject[c.subjectId] || 0) + 1;
  }
  return tasks;
}

// ---------- 기록 반영 ----------

// 실제 수행량을 반영하고, 속도·정확도 갱신 결과를 돌려준다
function applySession(state, session) {
  const out = {};
  const subject = state.subjects.find((s) => s.id === session.subjectId);
  const m = session.materialId ? state.materials.find((x) => x.id === session.materialId) : null;

  if (m) {
    if (m.mode === 'range') m.done = (m.done || 0) + (session.amount || 0);
    // 자동으로 완료 처리한 기록은 실제 걸린 시간을 모르므로 속도 보정에 쓰지 않는다
    if (!session.auto && session.amount > 0 && session.minutes > 0) {
      // 한 번의 기록으로 너무 크게 흔들리지 않게 이전 값의 0.5~2배로 제한
      const observed = clamp(session.minutes / session.amount, m.minPerUnit * 0.5, m.minPerUnit * 2);
      const before = m.minPerUnit;
      m.minPerUnit = Math.round((0.7 * before + 0.3 * observed) * 10) / 10;
      out.speed = { before, after: m.minPerUnit, unit: m.unit };
    }
  }

  if (session.wrong != null && session.amount > 0) {
    const acc = clamp((session.amount - session.wrong) / session.amount, 0, 1);
    if (m) m.accuracy = m.accuracy == null ? acc : round2(0.7 * m.accuracy + 0.3 * acc);
    if (subject) subject.accuracy = subject.accuracy == null ? acc : round2(0.7 * subject.accuracy + 0.3 * acc);
    out.accuracy = acc;
  }

  if (subject) {
    subject.lastStudied = session.date > (subject.lastStudied || '') ? session.date : subject.lastStudied;
    if (session.type === 'wrongPending') {
      subject.wrongPending = Math.max(0, (subject.wrongPending || 0) - (session.amount || 0) + (session.wrong || 0));
    } else if (session.wrong) {
      subject.wrongPending = (subject.wrongPending || 0) + session.wrong;
    }
  }
  return out;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// ---------- 진단 ----------

function subjectSnapshot(state, subject, today) {
  // 시험 판단에는 선행 책을 넣지 않는다
  const mats = state.materials.filter((m) => m.subjectId === subject.id && !m.archived && !m.goalId);
  let need = 0;
  let unknown = 0;
  let total = 0;
  let done = 0;
  let target = 0;
  mats.forEach((m) => {
    // 시험 직전용 자료는 아직 진도율에 넣지 않고 남은 시간에만 더한다
    if (!isActive(state, m, today)) {
      need += needMinutes(state, m, today) || 0;
      return;
    }
    if (m.mode === 'weekly') {
      need += needMinutes(state, m, today) || 0;
      return;
    }
    if (m.total == null || m.total === '') {
      unknown += 1;
      return;
    }
    need += needMinutes(state, m, today);
    total += m.total;
    done += Math.min(m.total, m.done || 0);
    const exam = examDateFor(state, subject);
    if (exam && m.created) {
      const span = Math.max(1, diffDays(m.created, exam));
      // 처음 넣었을 때 이미 해 둔 양(startDone)에서 시작해 시험 날 100%가 되는 직선
      const start = Math.min(m.total, m.startDone || 0);
      target += start + (m.total - start) * clamp(diffDays(m.created, today) / span, 0, 1);
    }
  });

  const left = daysLeftFor(state, subject, today);
  // 기록을 시작한 지 7일이 안 됐으면 그 날수로 나눈다 (첫날부터 '위험'이 뜨지 않게)
  const first = state.sessions.reduce((a, s) => (!a || s.date < a ? s.date : a), '');
  const spanDays = first ? clamp(diffDays(first, today) + 1, 1, 7) : 7;
  const recent = state.sessions
    .filter((s) => s.subjectId === subject.id && s.date > addDays(today, -7) && s.date <= today)
    .reduce((a, s) => a + (s.minutes || 0), 0) / spanDays;

  let status = '안정';
  let ratio = null;
  // 기록이 3일 미만이면 속도를 아직 모르니 판단하지 않는다
  if (left != null && need > 0 && spanDays >= 3) {
    if (recent > 0) {
      ratio = need / (recent * Math.max(1, left));
      if (ratio > 1.2) status = '위험';
      else if (ratio > 0.8) status = '주의';
    } else {
      status = '주의'; // 최근 7일 기록이 없어 속도를 아직 모름
    }
  }
  if (subject.accuracy != null && subject.accuracy < 0.6) status = '위험';
  else if (status === '안정' && (subject.wrongPending >= 20 || (left != null && left <= 14 && subject.memory <= 2))) status = '주의';

  return {
    need: Math.round(need),
    unknown,
    progress: total ? done / total : null,
    targetProgress: total && target ? target / total : null,
    recentDaily: Math.round(recent),
    daysLeft: left,
    ratio,
    status,
    weakest: weakestStage(state, subject, mats, today),
  };
}

function weakestStage(state, subject, mats, today) {
  const problemMats = mats.filter((m) => ['문제집', '숙제', '기출', '모의고사'].includes(m.kind) && m.mode === 'range');
  const problemsDone = problemMats.length > 0 && problemMats.every((m) => remaining(state, m, today) === 0);
  const scores = [
    ['개념', (5 - subject.concept) / 4],
    ['문제풀이', subject.accuracy == null ? 0.3 : 1 - subject.accuracy],
    ['오답', clamp((subject.wrongPending || 0) / 20, 0, 1) + (problemsDone ? 0.3 : 0)],
    ['암기', (5 - subject.memory) / 4],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][0];
}

// 지금 상태에 맞는 공부 방법
function recommend(state, subject, today) {
  const mats = state.materials.filter((m) => m.subjectId === subject.id && !m.archived);
  const tips = [];
  const left = daysLeftFor(state, subject, today);
  const problemMats = mats.filter((m) => ['문제집', '숙제'].includes(m.kind) && m.mode === 'range' && m.total);
  const allProblemsDone = problemMats.length > 0 && problemMats.every((m) => remaining(state, m, today) === 0);

  if (subject.accuracy != null && subject.accuracy < 0.6 && subject.concept <= 3) {
    tips.push('정확도가 낮아요. 문제를 더 풀기 전에 틀린 단원의 교과서 개념을 다시 보고 백지에 설명해 보세요.');
  }
  if ((subject.wrongPending || 0) >= 15) {
    tips.push(`쌓인 오답이 ${subject.wrongPending}개예요. 새 문제보다 오답부터 줄이세요.`);
  }
  if (allProblemsDone) {
    tips.push('문제집을 끝냈어요. 개념 반복이나 같은 문제집 재회독 대신 오답·취약 유형 중심으로 바꾸세요.');
  }
  if (left != null && left <= 14 && subject.memory <= 3) {
    tips.push('시험 2주 이내인데 암기가 불안해요. 빈칸 암기 회독 횟수를 늘리세요.');
  }
  if (subject.concept <= 2 && !tips.length) {
    tips.push('개념 이해도가 낮아요. 문제풀이 비중을 줄이고 교과서 개념 → 예제 순서로 가세요.');
  }
  const guide = guideFor(subject.name);
  if (guide) tips.push(guide);
  return tips;
}

if (typeof module !== 'undefined') {
  module.exports = {
    STAGES, KINDS, PROJECT_STAGES, LOG_INTERVALS, WRONG_INTERVALS,
    toKey, addDays, diffDays, weekStart, dayIndexMon,
    remaining, needMinutes, recallMinutes, deadlineDays, goalOf, roleOf, bookWindows, currentWindow, ROLES, ROLE_LABEL, daysLeftFor, guideFor, KIND_METHOD, completionFactor, effectiveBudget, defaultAvailable,
    generatePlan, applySession, subjectSnapshot, recommend, trapsFor, isActive,
  };
}
