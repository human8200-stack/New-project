'use strict';

// ---------- 설정값 ----------

const DEFAULT_SUBJECTS = ['공통국어', '공통수학', '공통영어', '통합사회', '통합과학', '한국사'];

// 진도 복습 간격(일): 1 → 3 → 7 → 14 → 30일 후
const LOG_INTERVALS = [1, 3, 7, 14, 30];
// 오답 재출제 간격(일): 2 → 7 → 14 → 30일 후. 틀리면 처음(2일)으로
const WRONG_INTERVALS = [2, 7, 14, 30];

// 2022 개정 공통수학2 (고1 2학기)
const SSEN_UNITS = [
  { group: '도형의 방정식', name: '평면좌표' },
  { group: '도형의 방정식', name: '직선의 방정식' },
  { group: '도형의 방정식', name: '원의 방정식' },
  { group: '도형의 방정식', name: '도형의 이동' },
  { group: '집합과 명제', name: '집합' },
  { group: '집합과 명제', name: '명제' },
  { group: '함수와 그래프', name: '함수' },
  { group: '함수와 그래프', name: '유리함수와 무리함수' },
];

// 군포고식 "꼬임" 분류
const TRAPS = [
  '숨은 조건 놓침',
  '두 단원 결합',
  '교과서 예제 변형',
  '함정 보기(ㄱㄴㄷ)',
  '개념 이해 부족',
  '계산 실수',
  '시간 부족',
];

const DB_NAME = 'study-routine';
const STORE = 'kv';

// ---------- 날짜 ----------

function today() {
  return toKey(new Date());
}

function toKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + n));
}

function diffDays(fromKey, toKeyStr) {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKeyStr.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const w = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}

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

function emptyState() {
  return {
    version: 1,
    subjects: DEFAULT_SUBJECTS.slice(),
    logs: [],
    wrongs: [],
    drills: [],
    ssen: {},
    checks: {},
    exam: { date: '', ranges: {} },
  };
}

let state = emptyState();
let currentTab = 'today';

async function load() {
  try {
    const saved = await dbGet('state');
    if (saved) state = Object.assign(emptyState(), saved);
  } catch (e) {
    toast('저장소를 열 수 없어요. 개인정보 보호 모드인지 확인해 주세요.');
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

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function options(list, selected) {
  return list.map((v) => `<option${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// 사진을 긴 변 1400px JPEG로 줄여 저장 공간을 아낀다
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
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

// ---------- 시험 모드 ----------

function examInfo() {
  const date = state.exam.date;
  if (!date) return null;
  const left = diffDays(today(), date);
  if (left < 0) return null;
  let phase;
  if (left > 21) phase = { key: 'normal', name: '평소 루틴', desc: '수업 진도 따라가기와 당일 복습에 집중하세요.' };
  else if (left > 7) phase = { key: 'round', name: '회독 기간 (D-21 ~ D-8)', desc: '시험 범위 교과서 2회독, 쎈 B단계 오답 0개 만들기, 군포고 기출 1세트.' };
  else if (left > 0) phase = { key: 'final', name: '마무리 기간 (D-7 ~ D-1)', desc: '기출·변형 문제를 시간 재고 풀기, 오답만 다시, 새 문제집 시작 금지.' };
  else phase = { key: 'day', name: '시험 당일', desc: '오답 카드와 공식만 훑어보고 컨디션 관리.' };
  return { date, left, phase };
}

function blocksFor(info) {
  const mode = info ? info.phase.key : 'normal';
  if (mode === 'round') {
    return [
      { id: 'b1', t: '당일 복습 (30분)', d: '오늘 배운 과목, 책 덮고 핵심 3줄 쓰기' },
      { id: 'b2', t: '수학 (80분)', d: '시험 범위 쎈 B단계 오답 다시 → C단계 선별 → 군포고 기출' },
      { id: 'b3', t: '시험 범위 회독 (50분)', d: '시험 모드 탭의 과목별 범위를 한 과목씩 2회독' },
      { id: 'b4', t: '자기 전 백지 복습 (5분)', d: '오늘 본 범위에서 기억나는 것 모두 쓰기' },
    ];
  }
  if (mode === 'final' || mode === 'day') {
    return [
      { id: 'b1', t: '수학 실전 (60분)', d: '군포고 기출/변형 1세트를 시험 시간과 같게 재고 풀기' },
      { id: 'b2', t: '오답만 다시 (40분)', d: '오답 다시 풀기 목록 전부, 꼬임 메모 확인' },
      { id: 'b3', t: '내일 시험 과목 총정리 (60분)', d: '교과서 밑줄, 선생님 강조 부분, 학습지' },
      { id: 'b4', t: '자기 전 백지 복습 (5분)', d: '공식과 핵심 개념만' },
    ];
  }
  return [
    { id: 'b1', t: '진도 기록 (2분)', d: '진도 기록 탭에 오늘 수업에서 나간 페이지 입력' },
    { id: 'b2', t: '당일 복습 (40분)', d: '오늘 배운 과목마다 책 덮고 핵심 3줄 → 확인' },
    { id: 'b3', t: '수학 (70분)', d: '백지 설명 15분 · 쎈 진도 35분 · 오답 재출제 10분 · 조건 해석 10분' },
    { id: 'b4', t: '다른 과목 문제집과 간격 복습 (40분)', d: '영어·국어 문제집 진도, 아래 "다시 볼 진도"' },
    { id: 'b5', t: '자기 전 백지 복습 (5분)', d: '오늘 배운 것 떠올려 쓰기' },
  ];
}

// ---------- 화면: 오늘 ----------

function renderToday() {
  const t = today();
  const info = examInfo();
  const dueLogs = state.logs.filter((l) => l.due && l.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const dueWrongs = state.wrongs.filter((w) => w.due && w.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const checks = state.checks[t] || {};
  const drillsToday = state.drills.filter((d) => d.date === t).length;

  const blocks = blocksFor(info).map((b) => `
    <label class="check${checks[b.id] ? ' done' : ''}">
      <input type="checkbox" data-action="check" data-id="${b.id}"${checks[b.id] ? ' checked' : ''}>
      <span><span class="t">${esc(b.t)}</span><br><span class="d">${esc(b.d)}</span></span>
    </label>`).join('');

  const logItems = dueLogs.length ? dueLogs.map((l) => `
    <li class="item">
      <div>
        <span class="tag">${esc(l.subject)}</span>${l.kind !== '수업' ? `<span class="tag">${esc(l.kind)}</span>` : ''}
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
      ${w.note ? `<details><summary class="meta">지난번 꼬인 지점 보기 (먼저 풀고 열기)</summary><div>${esc(w.note)}</div></details>` : ''}
      <div class="actions" style="margin-top:8px">
        <button class="btn small good" data-action="wrong-ok" data-id="${w.id}">맞혔어요</button>
        <button class="btn small bad" data-action="wrong-miss" data-id="${w.id}">또 틀렸어요</button>
      </div>
    </li>`).join('') : '<li class="empty">오늘 다시 풀 오답이 없어요.</li>';

  return `
    ${info ? `<div class="card"><h2>${esc(info.phase.name)}</h2><p class="sub" style="margin:0">${esc(info.phase.desc)}</p></div>` : ''}
    <div class="card">
      <h2>아침 10분</h2>
      <p class="sub">${prettyDate(t)} · 등교 전에 아래 두 목록만 보고 가요.</p>
      <h3>다시 볼 진도 (${dueLogs.length})</h3>
      <p class="sub">책을 펴기 전에 그 범위 내용을 먼저 떠올려 보고 버튼을 누르세요.</p>
      <ul class="list">${logItems}</ul>
      <h3>다시 풀 오답 (${dueWrongs.length})</h3>
      <ul class="list">${wrongItems}</ul>
    </div>
    <div class="card">
      <h2>방과 후</h2>
      <p class="sub">끝낸 블록을 체크하세요. 수학 조건 해석 훈련: 오늘 ${drillsToday}/3문제</p>
      ${blocks}
    </div>`;
}

// ---------- 화면: 진도 기록 ----------

function renderLog() {
  const recent = state.logs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created).slice(0, 40);
  const items = recent.length ? recent.map((l) => `
    <li class="item">
      <div>
        <span class="tag">${esc(l.subject)}</span><span class="tag">${esc(l.kind)}</span>
        <div>${esc(l.text)}</div>
        <div class="meta">${prettyDate(l.date)} · ${l.due ? `다음 복습 ${prettyDate(l.due)}` : '복습 완료'}</div>
      </div>
      <div class="actions"><button class="btn small" data-action="log-del" data-id="${l.id}">삭제</button></div>
    </li>`).join('') : '<li class="empty">아직 기록이 없어요.</li>';

  return `
    <div class="card">
      <h2>오늘 나간 진도</h2>
      <p class="sub">시험 범위가 미리 안 나오니 매일 수업 진도를 남겨 두세요. 이 기록이 그대로 복습 일정과 시험 범위가 됩니다.</p>
      <form id="log-form">
        <div class="row">
          <div><label>날짜</label><input type="date" name="date" value="${today()}" required></div>
          <div><label>과목</label><select name="subject">${options(state.subjects)}</select></div>
          <div><label>종류</label><select name="kind">${options(['수업', '문제집', '학습지', '모의고사'])}</select></div>
        </div>
        <label>범위 / 내용</label>
        <input name="text" placeholder="예: 교과서 p.58~61 원의 방정식 / 쎈 B단계 0412~0430" required>
        <div style="margin-top:12px"><button class="btn primary" type="submit">기록하기</button></div>
      </form>
    </div>
    <div class="card">
      <h2>최근 기록</h2>
      <ul class="list">${items}</ul>
    </div>`;
}

// ---------- 화면: 수학 ----------

function renderMath() {
  const units = SSEN_UNITS.map((u) => u.name);
  const ssenRows = SSEN_UNITS.map((u) => {
    const s = state.ssen[u.name] || {};
    const cell = (lv) => `<td><input type="checkbox" data-action="ssen" data-unit="${esc(u.name)}" data-lv="${lv}"${s[lv] ? ' checked' : ''}></td>`;
    return `<tr><td>${esc(u.name)}<div class="meta">${esc(u.group)}</div></td>${cell('A')}${cell('B')}${cell('B오답0')}${cell('C')}</tr>`;
  }).join('');

  const counts = {};
  state.wrongs.forEach((w) => { if (w.trap) counts[w.trap] = (counts[w.trap] || 0) + 1; });
  const maxCount = Math.max(1, ...Object.values(counts));
  const trapBars = Object.keys(counts).length
    ? TRAPS.filter((t) => counts[t]).sort((a, b) => counts[b] - counts[a]).map((t) => `
      <div class="bar"><span class="name">${esc(t)}</span><span class="track"><span class="fill" style="width:${(counts[t] / maxCount) * 100}%;display:block"></span></span><span class="num">${counts[t]}</span></div>`).join('')
    : '<div class="empty">오답을 등록하면 어떤 식으로 꼬인 문제에 약한지 보여 줘요.</div>';

  const activeWrongs = state.wrongs.filter((w) => w.due).length;
  const doneWrongs = state.wrongs.length - activeWrongs;

  const recentDrills = state.drills.slice(-5).reverse().map((d) => `
    <li class="item"><div><span class="tag">${esc(d.unit)}</span> 조건 ${esc(d.conds)}개 · 숨은 조건: ${esc(d.hidden || '없음')}<div class="meta">${prettyDate(d.date)}</div></div></li>`).join('');

  return `
    <div class="card">
      <h2>오답 등록</h2>
      <p class="sub">틀린 문제를 아이패드로 찍어 올리면 2일 → 7일 → 14일 → 30일 후에 다시 나와요. 또 틀리면 2일 후부터 다시 시작해요.</p>
      <form id="wrong-form">
        <label>문제 사진</label>
        <input type="file" name="img" accept="image/*" capture="environment">
        <div class="row">
          <div><label>과목</label><select name="subject">${options(state.subjects, '공통수학')}</select></div>
          <div><label>단원</label><select name="unit"><option value="">선택 안 함</option>${options(units)}</select></div>
          <div><label>어떻게 틀렸나</label><select name="trap">${options(TRAPS)}</select></div>
        </div>
        <label>어디서 꼬였나 (한 줄)</label>
        <input name="note" placeholder="예: x가 정수라는 조건을 문제 끝에서 놓침">
        <div style="margin-top:12px"><button class="btn primary" type="submit">오답 등록</button></div>
      </form>
      <p class="meta" style="margin-top:12px">반복 중 ${activeWrongs}문제 · 졸업 ${doneWrongs}문제</p>
    </div>

    <div class="grid2">
      <div class="card">
        <h2>나는 어디서 꼬이나</h2>
        <p class="sub">가장 긴 막대부터 대비하세요.</p>
        ${trapBars}
      </div>
      <div class="card">
        <h2>조건 해석 훈련</h2>
        <p class="sub">하루 3문제. 풀지 말고 읽기만 하고 아래 세 칸을 채워요.</p>
        <form id="drill-form">
          <div class="row">
            <div><label>단원</label><select name="unit">${options(units)}</select></div>
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
      <h2>쎈 진도 (공통수학2)</h2>
      <p class="sub">A → B → B단계 오답 0개 → C 순서로 올라가요. B단계 오답이 남아 있으면 C로 넘어가지 마세요.</p>
      <table class="ssen">
        <thead><tr><th>단원</th><th>A</th><th>B</th><th>B 오답0</th><th>C</th></tr></thead>
        <tbody>${ssenRows}</tbody>
      </table>
    </div>`;
}

// ---------- 화면: 시험 모드 ----------

function renderExam() {
  const info = examInfo();
  const ranges = state.exam.ranges || {};
  const rangeInputs = state.subjects.map((s) => `
    <label>${esc(s)}</label>
    <input name="range-${esc(s)}" value="${esc(ranges[s] || '')}" placeholder="범위 공지되면 입력 (예: p.40~112, 학습지 1~6)">`).join('');

  let summary = '';
  if (info) {
    const from = addDays(state.exam.date, -84);
    const perSubject = state.subjects.map((s) => {
      const n = state.logs.filter((l) => l.subject === s && l.date >= from && l.date <= state.exam.date).length;
      return `<li class="item"><div><span class="tag">${esc(s)}</span> 최근 12주 진도 기록 ${n}개${ranges[s] ? ` · 범위: ${esc(ranges[s])}` : ''}</div></li>`;
    }).join('');
    summary = `
      <div class="card">
        <h2>D-${info.left === 0 ? 'Day' : info.left} · ${prettyDate(info.date)}</h2>
        <div class="phase"><strong>${esc(info.phase.name)}</strong><br>${esc(info.phase.desc)}</div>
        <ul class="list">${perSubject}</ul>
      </div>`;
  }

  return `
    ${summary}
    <div class="card">
      <h2>시험 정보</h2>
      <p class="sub">시험 3주 전부터 "오늘" 화면의 방과 후 블록이 시험 대비용으로 바뀌어요.</p>
      <form id="exam-form">
        <label>시험 첫날</label>
        <input type="date" name="date" value="${esc(state.exam.date)}">
        ${rangeInputs}
        <div class="row" style="margin-top:12px">
          <button class="btn primary" type="submit">저장</button>
          <button class="btn" type="button" data-action="exam-clear">시험 끝 (초기화)</button>
        </div>
      </form>
    </div>`;
}

// ---------- 화면: 설정 ----------

function renderSettings() {
  return `
    <div class="card">
      <h2>과목</h2>
      <p class="sub">쉼표로 구분해요.</p>
      <form id="subjects-form">
        <input name="subjects" value="${esc(state.subjects.join(', '))}">
        <div style="margin-top:12px"><button class="btn primary" type="submit">저장</button></div>
      </form>
    </div>
    <div class="card">
      <h2>백업</h2>
      <p class="sub">기록은 이 아이패드의 브라우저 안에만 저장돼요. 일주일에 한 번 백업 파일을 받아 두세요. 기기를 바꿀 때도 이 파일로 옮겨요.</p>
      <div class="row">
        <button class="btn" data-action="export">백업 파일 받기</button>
        <label class="btn" style="margin:0;text-align:center;color:var(--text)">백업 불러오기<input type="file" accept="application/json" data-action="import" hidden></label>
      </div>
    </div>
    <div class="card">
      <h2>홈 화면에 추가</h2>
      <p class="sub" style="margin:0">Safari 공유 버튼 → "홈 화면에 추가"를 누르면 앱처럼 열 수 있어요.</p>
    </div>`;
}

// ---------- 렌더링 ----------

const VIEWS = { today: renderToday, log: renderLog, math: renderMath, exam: renderExam, settings: renderSettings };

function render() {
  document.getElementById('view').innerHTML = VIEWS[currentTab]();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  const info = examInfo();
  const dday = document.getElementById('dday');
  dday.hidden = !info;
  if (info) dday.textContent = info.left === 0 ? 'D-Day' : `D-${info.left}`;
}

// ---------- 동작 ----------

function advanceLog(l, ok) {
  if (ok) {
    l.step += 1;
    l.due = l.step < LOG_INTERVALS.length ? addDays(today(), LOG_INTERVALS[l.step]) : null;
  } else {
    l.step = 0;
    l.due = addDays(today(), LOG_INTERVALS[0]);
  }
}

function advanceWrong(w, ok) {
  w.history.push({ date: today(), ok });
  if (ok) {
    w.step += 1;
    w.due = w.step < WRONG_INTERVALS.length ? addDays(today(), WRONG_INTERVALS[w.step]) : null;
  } else {
    w.step = 0;
    w.due = addDays(today(), WRONG_INTERVALS[0]);
  }
}

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('.tabs button');
  if (tab) {
    currentTab = tab.dataset.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action, id } = el.dataset;

  if (action === 'log-ok' || action === 'log-miss') {
    const l = state.logs.find((x) => x.id === id);
    if (l) advanceLog(l, action === 'log-ok');
  } else if (action === 'wrong-ok' || action === 'wrong-miss') {
    const w = state.wrongs.find((x) => x.id === id);
    if (w) advanceWrong(w, action === 'wrong-ok');
    toast(action === 'wrong-ok' ? '좋아요! 간격을 늘렸어요.' : '2일 후에 다시 나와요.');
  } else if (action === 'log-del') {
    if (!confirm('이 기록을 삭제할까요?')) return;
    state.logs = state.logs.filter((x) => x.id !== id);
  } else if (action === 'exam-clear') {
    if (!confirm('시험 정보를 지울까요? (진도 기록과 오답은 그대로 남아요)')) return;
    state.exam = { date: '', ranges: {} };
  } else if (action === 'export') {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `공부루틴-백업-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  } else {
    return;
  }
  await save();
  render();
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const action = el.dataset.action;

  if (action === 'check') {
    const t = today();
    state.checks[t] = state.checks[t] || {};
    state.checks[t][el.dataset.id] = el.checked;
  } else if (action === 'ssen') {
    const u = el.dataset.unit;
    state.ssen[u] = state.ssen[u] || {};
    state.ssen[u][el.dataset.lv] = el.checked;
  } else if (action === 'import') {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.logs)) throw new Error('형식 오류');
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요?')) return;
      state = Object.assign(emptyState(), data);
      toast('불러왔어요.');
    } catch (err) {
      toast('백업 파일을 읽을 수 없어요.');
      return;
    }
  } else {
    return;
  }
  await save();
  render();
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);

  if (form.id === 'log-form') {
    const date = f.get('date') || today();
    // 지난 날짜로 기록해도 첫 복습은 기록한 날 기준으로 잡는다
    const base = date > today() ? date : today();
    state.logs.push({
      id: uid(),
      created: Date.now(),
      date,
      subject: f.get('subject'),
      kind: f.get('kind'),
      text: f.get('text').trim(),
      step: 0,
      due: addDays(base, LOG_INTERVALS[0]),
    });
    toast('기록했어요. 내일 아침 복습 목록에 나와요.');
  } else if (form.id === 'wrong-form') {
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
    state.wrongs.push({
      id: uid(),
      date: today(),
      subject: f.get('subject'),
      unit: f.get('unit'),
      trap: f.get('trap'),
      note,
      img,
      step: 0,
      due: addDays(today(), WRONG_INTERVALS[0]),
      history: [],
    });
    toast('오답을 등록했어요. 2일 후에 다시 나와요.');
  } else if (form.id === 'drill-form') {
    state.drills.push({
      id: uid(),
      date: today(),
      unit: f.get('unit'),
      conds: f.get('conds'),
      hidden: f.get('hidden').trim(),
    });
    const n = state.drills.filter((d) => d.date === today()).length;
    toast(n >= 3 ? '오늘 훈련 완료!' : `오늘 ${n}/3`);
  } else if (form.id === 'exam-form') {
    state.exam.date = f.get('date');
    state.exam.ranges = {};
    state.subjects.forEach((s) => {
      const v = (f.get(`range-${s}`) || '').trim();
      if (v) state.exam.ranges[s] = v;
    });
    toast('저장했어요.');
  } else if (form.id === 'subjects-form') {
    const list = f.get('subjects').split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    state.subjects = list;
    toast('저장했어요.');
  } else {
    return;
  }
  await save();
  render();
});

// ---------- 시작 ----------

(async () => {
  await load();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
