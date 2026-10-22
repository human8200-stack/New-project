'use strict';
/* global addDays, toKey, uid, freshState */
// 체험판용 예시 데이터. 실제 학생 기록이 아니라 화면을 둘러보기 위한 가상의 값이다.

// 체험판: 로그인·알림은 실제로 연결하지 않고 화면만 보여 준다
window.timeLabel = (time) => { const [h, m] = String(time).split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`; };
window.maskEmail = (e) => { const [n, d] = String(e).split('@'); return `${n.slice(0, 2)}${'*'.repeat(Math.max(1, n.length - 2))}@${d}`; };
window.cloud = {
  mode: 'login', needsInvite: false, canRecover: true, status: 'synced', userId: 'minji2026', lastSync: Date.now(), error: '',
  recoveryEmail: 'minji.study@gmail.com', recoveryVerified: true, pushOn: true, pushTime: '16:30',
  statusText() { return '동기화됨 (아이패드·휴대폰)'; },
  badge() { return '동기화됨'; },
  schedulePush() {},
  note() { window.app.toast('체험판이라 실제로 연결하지는 않아요.'); return Promise.resolve(false); },
  signUp() { return this.note(); }, logIn() { return this.note(); }, logOut() { return this.note(); },
  changePassword() { return this.note(); }, sendReset() { return this.note(); }, setRecovery() { return this.note(); },
  enablePush() { return this.note(); }, disablePush() { return this.note(); },
  setPushTime(time) { this.pushTime = time; window.app.toast(`체험판: 매일 ${window.timeLabel(time)}쯤 알려 드리는 것으로 바꿨어요.`); return Promise.resolve(true); },
};

function demoProblemImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300">
  <rect width="640" height="300" fill="#ffffff"/>
  <text x="24" y="44" font-family="sans-serif" font-size="22" fill="#222">12. 원 x² + y² − 4x + 2y = k 와 직선 y = x − 1 이</text>
  <text x="24" y="80" font-family="sans-serif" font-size="22" fill="#222">서로 다른 두 점에서 만나도록 하는 정수 k 의</text>
  <text x="24" y="116" font-family="sans-serif" font-size="22" fill="#222">최솟값을 구하시오. (단, 주어진 방정식은 원을 나타낸다.)</text>
  <text x="24" y="190" font-family="sans-serif" font-size="20" fill="#b5532a">내 답: −4  ✗   (정답: −2)</text>
  <text x="24" y="230" font-family="sans-serif" font-size="18" fill="#666">예시 문제 (체험용)</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

window.DEMO_STATE = function buildDemo(base) {
  const t = toKey(new Date());
  const S = {};
  base.subjects.forEach((s) => { S[s.name] = s; });
  const M = (subject, prefix) => base.materials.find((m) => m.subjectId === S[subject].id && m.name.startsWith(prefix));

  base.settings.examDate = addDays(t, 45);
  // 학원: 월·수·금 (1시간 30분), 학원 없는 평일 4시간, 주말 6시간
  Object.assign(base.settings, { academyDays: [1, 3, 5], academyMinutes: 90, freeMinutes: 240, weekendMinutes: 360 });
  base.settings.weekdayMinutes = [360, 90, 240, 90, 240, 90, 360];

  Object.assign(S['수학'], { weak: true, importance: 5, concept: 2, memory: 3, stage: '문제풀이', accuracy: 0.66, wrongPending: 18, weakNotes: '원의 접선 조건, 점대칭 이동, 부등식의 영역' });
  Object.assign(S['영어'], { importance: 4, concept: 3, memory: 3, stage: '암기', accuracy: 0.81, wrongPending: 4, weakNotes: '어법 변형 (관계사, 분사), 연결어' });
  Object.assign(S['국어'], { concept: 3, memory: 3, stage: '문제풀이', accuracy: 0.74, wrongPending: 7, weakNotes: '문법: 음운 변동 판별 기준' });
  Object.assign(S['통합사회'], { concept: 4, memory: 2, stage: '암기', accuracy: 0.78 });
  Object.assign(S['통합과학'], { concept: 4, memory: 3, stage: '오답', accuracy: 0.84, wrongPending: 12 });
  Object.assign(S['한국사'], { concept: 3, memory: 2, stage: '개념', accuracy: 0.7 });
  Object.assign(S['정보'], { concept: 1, memory: 1, stage: '개념' });

  const set = (m, v) => Object.assign(m, v, { created: addDays(t, -10), startDone: Math.round((v.done || 0) * 0.8) });
  set(M('수학', '쎈'), { total: 900, done: 310, minPerUnit: 3.4, accuracy: 0.66, nextRange: '원의 방정식 0512번' });
  set(M('수학', '마플'), { total: 120, done: 40, minPerUnit: 6 });
  set(M('수학', '고쟁이'), { total: 300, done: 80, minPerUnit: 6 });
  set(M('수학', '족보'), { total: 6, done: 0 });
  set(M('영어', '워드마스터'), { total: 40, done: 12 });
  set(M('통합사회', '교과서'), { total: 120, done: 40, nextRange: '3단원 p.88' });
  set(M('통합사회', '기출픽'), { total: 400, done: 150, minPerUnit: 1.6 });
  set(M('통합과학', '교과서'), { total: 140, done: 70 });
  set(M('통합과학', '기출픽'), { total: 380, done: 380, accuracy: 0.84 }); // 끝낸 문제집 예시
  set(M('한국사', '교과서'), { total: 110, done: 20 });
  set(M('한국사', '기출픽'), { total: 350, done: 90 });
  set(M('정보', '교과서'), { total: 130, done: 10 });
  set(M('정보', '평가문제집'), { total: 150, done: 0 });
  set(M('정보', '단권화'), { total: 6, done: 0 });
  base.materials.forEach((m) => { if (!m.created) m.created = addDays(t, -30); });
  // 시험 범위 (예시)
  const range = (subject, prefix, from, to, done) => Object.assign(M(subject, prefix), { rangeFrom: from, total: to - from + 1, done, startDone: Math.round(done * 0.8) });
  range('수학', '쎈', 1, 640, 310);
  range('수학', '교과서', 10, 96, 48);
  range('국어', '교과서', 14, 120, 35);
  range('통합사회', '교과서', 12, 131, 40);
  range('통합과학', '교과서', 10, 149, 70);
  range('한국사', '교과서', 60, 169, 20);
  range('정보', '교과서', 8, 137, 10);
  const ex = [['국어', 0, '문학 3~4단원, 문법 음운 변동, 학습지 1~5'], ['수학', 0, '교과서 p.10~96 (도형의 방정식 ~ 집합과 명제)'], ['영어', 1, '3~5과 본문, 모의고사 2회분'], ['통합사회', 1, '교과서 p.12~131'], ['통합과학', 2, '교과서 p.10~149'], ['한국사', 2, '교과서 p.60~169'], ['정보', 3, '교과서 p.8~137']];
  ex.forEach(([name, plus, r]) => Object.assign(S[name], { examDate: addDays(t, 45 + plus), examRange: r }));

  // 지난 10일 계획과 실제 기록
  const plan = [
    ['수학', '쎈', 30, 90], ['영어', '지문', 3, 60], ['국어', '학원', 40, 50], ['통합사회', '교과서', 10, 40], ['한국사', '기출픽', 30, 45],
  ];
  const rates = [1, 0.6, 1, 0.8, 0.5, 1, 0.9, 0.7, 1, 0.8];
  const slots = ['오후', '저녁', '저녁', '밤', '저녁'];
  for (let i = 10; i >= 1; i--) {
    const d = addDays(t, -i);
    const rate = rates[i - 1];
    const tasks = plan.map(([subject, prefix, amount, minutes], k) => {
      const m = M(subject, prefix);
      const done = k < 3 ? Math.round(amount * rate) : (i % 2 ? Math.round(amount * rate) : 0);
      const used = done ? Math.round((minutes * done) / amount * 1.1) : 0;
      if (done) {
        base.sessions.push({
          id: uid(), date: d, slot: slots[k], type: 'material', materialId: m.id, subjectId: m.subjectId,
          planned: { amount, minutes }, amount: done, minutes: used,
          wrong: m.unit === '문제' ? Math.round(done * 0.25) : null, note: '',
        });
      }
      return {
        id: uid(), type: 'material', materialId: m.id, subjectId: m.subjectId, title: `${subject} · ${m.name}`,
        amount, unit: m.unit, minutes, detail: `${amount}${m.unit}`, reasons: [],
        status: done >= amount ? 'done' : done ? 'partial' : 'skipped', actual: { amount: done, minutes: used },
      };
    });
    base.plans[d] = { available: 180, condition: '보통', factor: 1, budget: 285, tasks };
  }
  Object.values(S).forEach((s) => { s.lastStudied = addDays(t, s.name === '정보' ? -9 : s.name === '통합과학' ? -4 : -1); });

  base.logs.push(
    { id: uid(), created: 1, date: addDays(t, -1), subject: '수학', kind: '수업', text: '교과서 p.58~61 원과 직선의 위치 관계',
      q: '원과 직선이 서로 다른 두 점에서 만나는 조건은?', a: '원의 중심과 직선 사이의 거리 < 반지름. 직선을 원의 방정식에 대입하면 판별식 D > 0', step: 0, due: t },
    { id: uid(), created: 2, date: addDays(t, -3), subject: '한국사', kind: '암기', text: '고려 후기 원 간섭기 (교과서 p.72~75)',
      q: '원 간섭기에 고려에 설치된 기구와, 이를 없앤 왕은?', a: '정동행성 이문소 · 쌍성총관부 → 공민왕이 반원 개혁으로 폐지·수복', step: 1, due: t },
    { id: uid(), created: 3, date: addDays(t, -7), subject: '영어', kind: '지문', text: '3과 본문 지문 2',
      q: '지문 2에서 시험에 나올 어법 변형 포인트 2가지는?', a: '① 관계대명사 what / which 구분 ② 분사구문 (Having finished …) 능동·수동', step: 2, due: t },
    { id: uid(), created: 4, date: addDays(t, -2), subject: '통합과학', kind: '수업', text: '화학 반응과 에너지 출입', step: 0, due: addDays(t, 1) },
  );
  base.wrongs.push(
    { id: uid(), date: addDays(t, -2), subject: '수학', unit: '원의 방정식', trap: '숨은 조건 놓침', note: '"원을 나타낸다" 조건(반지름² > 0)을 빼먹어서 k 범위가 틀림', cause: '개념', basic: '완전제곱식으로 고쳐 원의 중심·반지름 읽기 (중3 완전제곱식)', checks: [{ q: 'x² + 6x를 (x + □)² − □ 꼴로 고치세요.', a: '(x + 3)² − 9' }, { q: '(x − 1)² + (y + 2)² = 4의 중심과 반지름은?', a: '중심 (1, −2), 반지름 2' }], img: demoProblemImage(), step: 0, due: t, history: [] },
    { id: uid(), date: addDays(t, -9), subject: '수학', unit: '명제', trap: '함정 보기(ㄱㄴㄷ)', note: 'ㄷ의 역과 대우를 헷갈림', cause: '개념', basic: '역 · 이 · 대우 만드는 법', img: '', step: 1, due: addDays(t, 3), history: [{ date: addDays(t, -7), ok: true }] },
    { id: uid(), date: addDays(t, -5), subject: '수학', unit: '도형의 이동', trap: '숨은 조건 놓침', note: '점대칭 후 다시 평행이동하는 순서', cause: '적용', basic: '이동은 쓰인 순서대로 하나씩', img: '', step: 0, due: addDays(t, 1), history: [] },
    { id: uid(), date: addDays(t, -6), subject: '수학', unit: '평면좌표', trap: '계산 실수', note: '내분점 좌표 부호', cause: '계산', basic: '', img: '', step: 0, due: addDays(t, 2), history: [] },
    { id: uid(), date: addDays(t, -4), subject: '영어', unit: '3과', trap: '어법 변형', note: 'which → what 바뀐 것 못 찾음', cause: '개념', basic: '관계대명사 what = the thing which', img: '', step: 0, due: addDays(t, 2), history: [] },
  );
  base.drills.push(
    { id: uid(), date: addDays(t, -1), unit: '원의 방정식', conds: '3', hidden: 'k는 정수, 원이 존재 (r² > 0)' },
    { id: uid(), date: addDays(t, -1), unit: '명제', conds: '2', hidden: 'x, y는 실수' },
  );
  base.projects.push({
    id: uid(), title: '기후 위기와 에너지 전환 정책 비교', subjectId: S['통합사회'].id, due: addDays(t, 5), stage: 2,
    versions: { 자료조사: true }, question: '탄소중립 정책이 지역 일자리에 어떤 영향을 줄까?',
    role: '독일·한국 재생에너지 비율 자료 조사', limits: '', nextQuestion: '', memo: '',
  });
  // 예상 시험 문제 예시 (AI 없이도 화면을 볼 수 있게)
  base.mocks = [{
    id: 'demo-mock', subject: '수학', date: addDays(t, -1), range: '교과서 p.81~160',
    questions: [
      { type: '객관식', topic: '나머지정리', q: 'x³ − 2x + 5를 x − 1로 나눈 나머지는?', choices: ['2', '3', '4', '5', '6'], answer: 3, explain: '나머지정리: x = 1을 대입하면 1 − 2 + 5 = 4.', point: '나머지정리 대입형은 해마다 첫 페이지에 나와요', picked: null, result: null },
      { type: '객관식', topic: '이차방정식', q: '이차방정식 x² − 4x + k = 0이 서로 다른 두 실근을 가질 때, 정수 k의 최댓값은?', choices: ['1', '2', '3', '4', '5'], answer: 3, explain: '판별식 D/4 = 4 − k > 0 이므로 k < 4. 정수 k의 최댓값은 3.', point: '판별식 조건은 객관식·서술형 모두 단골', picked: null, result: null },
      { type: '서술형', topic: '인수분해', q: 'x⁴ − 5x² + 4를 인수분해하고, 그 과정을 쓰시오.', answer: '(x − 1)(x + 1)(x − 2)(x + 2)', explain: 'x² = t로 치환하면 t² − 5t + 4 = (t − 1)(t − 4). 다시 x²를 넣고 합차 공식으로 한 번 더 인수분해.', point: '치환 인수분해는 서술형 단골', picked: null, result: null },
    ],
  }];
  base.setupDone = true;
  base.updatedAt = 0;
  return base;
};

window.demoReset = async () => {
  await window.app.applyRemote(window.DEMO_STATE(freshState()));
  window.app.toast('예시 데이터로 되돌렸어요.');
};
