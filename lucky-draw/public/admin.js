// 진행자 화면 (누구나): 행사 만들기 → 큐알로 참가자 받기 → 룰렛·이름 뽑기로 선물 추첨 → 결과
const app = document.getElementById('app');

const state = {
  detail: null, // { event, participants, winners }
  tab: 'qr',
  mode: store('ld_mode') || 'wheel', // wheel | slot
  prize: null,
  busy: false, // 추첨 연출 중에는 새로 그리지 않는다
  seen: new Set(), // 큐알 화면에서 새로 들어온 사람 반짝이기
};
let pollTimer = null;

const joinUrl = (id) => `${location.origin}/join?e=${id}`;
const label = (p) => (p.note ? `${p.name} (${p.note})` : p.name);

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const box = el('div', { class: 'qr' });
  box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 8, scalable: true, alt: '참가 등록 큐알' });
  return box;
}

function qrImageUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(12, 48);
}

// null은 빼고 화면을 바꾼다
function show(...nodes) {
  app.replaceChildren(...nodes.filter(Boolean));
}

function onError(x) {
  if (x.code === 'NO_DB') return showSetup();
  if (x.status === 401) {
    toast('이 기기에는 이 행사의 진행자 키가 없어요');
    return go('');
  }
  toast(x.message);
}

// 사이트를 올린 사람이 데이터베이스를 아직 연결하지 않았을 때
function showSetup() {
  show(el('div', { class: 'card' },
    el('h2', { text: '데이터베이스를 연결해 주세요' }),
    el('p', { text: '이 사이트를 올린 분이 한 번만 하면 돼요.' }),
    el('ol', {},
      el('li', { text: 'Cloudflare → 저장소 및 데이터베이스(Storage & Databases) → D1 → 데이터베이스 만들기 (이름: lucky-draw)' }),
      el('li', { text: 'Workers & Pages → 이 Pages 프로젝트 → 설정(Settings) → 바인딩(Bindings) → 추가 → D1 데이터베이스' }),
      el('li', { text: '변수 이름은 DB, 데이터베이스는 방금 만든 lucky-draw' }),
      el('li', { text: '배포(Deployments)에서 최근 배포를 다시 시도(Retry deployment)' }),
    ),
  ));
}

// ---------- 길 ----------

function route() {
  // 다른 기기에서 진행자 링크로 열었을 때: #host/<행사>/<키>
  const h = location.hash.match(/^#host\/([a-z0-9]+)\/([a-z0-9]+)/);
  if (h) {
    hosts.put({ id: h[1], key: h[2], at: Date.now() });
    history.replaceState(null, '', `#e/${h[1]}/qr`);
  }
  const m = location.hash.match(/^#e\/([a-z0-9]+)(?:\/(\w+))?/);
  stopPoll();
  if (m) {
    state.tab = m[2] || 'qr';
    openEvent(m[1]);
  } else {
    state.detail = null;
    showList();
  }
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function stopPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- 행사 목록 ----------

function showList() {
  const mine = hosts.list();
  show(
    el('div', { class: 'join-hero' },
      el('div', { class: 'emoji', text: '🎁' }),
      el('h1', { text: '행운 추첨' }),
      el('p', { class: 'muted', text: '선물과 인원을 정하고, 큐알로 참가자를 받고, 룰렛으로 뽑아요. 가입 없이 누구나 써요.' }),
    ),
    mine.length ? el('h2', { text: '내가 만든 행사' }) : null,
    mine.length
      ? el('div', { class: 'events', style: 'margin-bottom:16px' },
          mine.map((e) => el('button', { class: 'card event-item', onclick: () => go(`#e/${e.id}/qr`) },
            el('b', { text: e.name || '(이름 없음)' }),
            el('div', { class: 'muted small', text: new Date(e.at).toLocaleDateString('ko-KR') }),
          )))
      : null,
    newEventCard(),
  );
}

function prizeEditor(prizes) {
  const rows = el('div', { class: 'prize-rows' });
  const add = (p = { name: '', count: 1 }) => {
    const row = el('div', { class: 'prize-row' },
      el('input', { class: 'input', placeholder: '선물 이름 (예: 치킨 기프티콘)', value: p.name, maxlength: 40 }),
      el('input', { class: 'input', type: 'number', min: 1, max: 999, value: p.count, 'aria-label': '당첨 인원' }),
      el('button', { type: 'button', class: 'btn ghost', text: '✕', 'aria-label': '빼기', onclick: () => row.remove() }),
    );
    rows.append(row);
  };
  (prizes.length ? prizes : [{ name: '', count: 1 }]).forEach(add);
  return {
    node: el('div', {}, rows, el('button', { type: 'button', class: 'btn sm', text: '+ 선물 더하기', onclick: () => add() })),
    value: () => [...rows.children]
      .map((r) => ({ name: r.children[0].value.trim(), count: Number(r.children[1].value) || 1 }))
      .filter((p) => p.name),
  };
}

function newEventCard() {
  const name = el('input', { class: 'input', placeholder: '예: 2026 송년회', maxlength: 60, required: true });
  const prizes = prizeEditor([]);
  const err = el('p', { class: 'error' });
  const form = el('form', { class: 'card' },
    el('h2', { text: '새 행사 만들기' }),
    el('label', { class: 'field' }, el('span', { text: '행사 이름' }), name),
    el('div', { class: 'field' }, el('span', { text: '선물과 당첨 인원(명)' }), prizes.node),
    el('button', { class: 'btn primary', text: '만들기' }),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { event, key } = await api('events', { method: 'POST', body: { name: name.value, prizes: prizes.value() } });
      hosts.put({ id: event.id, key, name: event.name, at: event.createdAt });
      go(`#e/${event.id}/qr`);
    } catch (x) {
      if (x.code === 'NO_DB') return showSetup();
      err.textContent = x.message;
    }
  });
  return form;
}

// ---------- 행사 하나 ----------

async function loadDetail(id) {
  state.detail = await api(`events/${id}`);
  if (hosts.get(id)?.name !== state.detail.event.name) hosts.put({ id, name: state.detail.event.name });
  const { prizes } = state.detail.event;
  // 고른 선물이 다 나갔으면 다음 남은 선물로
  const picked = prizes.find((p) => p.name === state.prize);
  if (!picked || remaining(picked) <= 0) state.prize = (prizes.find((p) => remaining(p) > 0) || picked || prizes[0])?.name || null;
}

async function openEvent(id) {
  try {
    if (state.detail?.event.id !== id) state.seen = new Set();
    await loadDetail(id);
  } catch (x) {
    if (x.status === 404) { hosts.remove(id); toast(x.message); return go(''); }
    return onError(x);
  }
  render();
  // 큐알·추첨 화면에서는 새로 들어온 사람을 계속 받아 온다
  pollTimer = setInterval(async () => {
    if (state.busy || document.hidden || !['qr', 'draw'].includes(state.tab)) return;
    try {
      const before = state.detail.participants.length + ':' + state.detail.winners.length;
      await loadDetail(id);
      if (before !== state.detail.participants.length + ':' + state.detail.winners.length && !state.busy) render();
    } catch {}
  }, 2500);
}

function winnerOf(pid) {
  return state.detail.winners.find((w) => w.participantId === pid);
}
function remaining(prize) {
  return prize.count - state.detail.winners.filter((w) => w.prize === prize.name).length;
}
function pool() {
  const won = new Set(state.detail.winners.map((w) => w.participantId));
  return state.detail.participants.filter((p) => !won.has(p.id));
}

function render() {
  const { event } = state.detail;
  const tabs = [['qr', '📱 큐알 등록'], ['draw', '🎡 추첨'], ['results', '🏆 결과'], ['settings', '⚙️ 설정']];
  show(
    el('div', { class: 'row' },
      el('button', { class: 'btn sm ghost', text: '← 행사 목록', onclick: () => go('') }),
    ),
    el('h1', { text: event.name }),
    el('div', { class: 'tabs' }, tabs.map(([k, t]) => el('button', { class: `tab${state.tab === k ? ' on' : ''}`, text: t, onclick: () => go(`#e/${event.id}/${k}`) }))),
    ({ qr: qrTab, draw: drawTab, results: resultsTab, settings: settingsTab }[state.tab] || qrTab)(),
  );
}

async function updateEvent(patch) {
  const { event } = await api(`events/${state.detail.event.id}`, { method: 'PUT', body: patch });
  state.detail.event = event;
}

// ---------- 큐알 등록 ----------

function qrTab() {
  const { event, participants } = state.detail;
  const url = joinUrl(event.id);
  const names = new Map();
  participants.forEach((p) => names.set(p.name, (names.get(p.name) || 0) + 1));

  const list = el('ul', { class: 'people' },
    participants.slice().reverse().map((p, i) => {
      const fresh = state.seen.size && !state.seen.has(p.id);
      return el('li', { class: fresh ? 'new' : null },
        el('span', { class: 'n', text: participants.length - i }),
        el('span', { class: 'who', text: label(p) }),
        names.get(p.name) > 1 && !p.note ? el('span', { class: 'tag dup', text: '같은 이름' }) : null,
        winnerOf(p.id) ? el('span', { class: 'tag', text: `🎁 ${winnerOf(p.id).prize}` }) : null,
        el('button', { class: 'btn sm ghost danger', text: '빼기', onclick: () => removePerson(p) }),
      );
    }),
  );
  participants.forEach((p) => state.seen.add(p.id));

  const addName = el('input', { class: 'input grow', placeholder: '휴대폰 없는 사람 이름', maxlength: 30 });
  const addForm = el('form', { class: 'row', style: 'margin-top:12px' }, addName, el('button', { class: 'btn', text: '직접 넣기' }));
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!addName.value.trim()) return;
    try {
      await api(`events/${event.id}/participants`, { method: 'POST', body: { name: addName.value } });
      await loadDetail(event.id);
      render();
      app.querySelector('.qr-layout form input')?.focus();
    } catch (x) { onError(x); }
  });

  const openToggle = el('input', { type: 'checkbox', checked: event.open });
  openToggle.addEventListener('change', async () => {
    try { await updateEvent({ open: openToggle.checked }); render(); } catch (x) { onError(x); }
  });

  return el('div', { class: 'qr-layout' },
    el('div', { class: 'card qr-box' },
      qrSvg(url),
      el('p', { class: 'link' }, el('a', { href: url, target: '_blank', rel: 'noopener', text: url })),
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn primary', text: '큰 화면으로 띄우기', onclick: () => bigQr(event, url) }),
        el('button', { class: 'btn', text: '주소 복사', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('주소를 복사했어요')) }),
        el('a', { class: 'btn', href: qrImageUrl(url), download: `${event.name} 큐알.gif`, text: '큐알 이미지 저장' }),
      ),
      el('p', { style: 'margin-top:16px' }, el('label', { class: 'switch' }, openToggle, event.open ? '등록 받는 중' : '등록 마감 (새로 등록 못 해요)')),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'row' },
        el('div', { class: 'grow' }, el('div', { class: 'muted small', text: '참가자' }), el('div', { class: 'count-big', text: `${participants.length}명` })),
        el('button', { class: 'btn primary', text: '추첨하러 가기 →', onclick: () => go(`#e/${event.id}/draw`), disabled: !participants.length }),
      ),
      addForm,
      participants.length ? list : el('p', { class: 'muted', text: '아직 아무도 없어요. 큐알을 찍으면 여기에 바로 나와요.' }),
    ),
  );
}

function bigQr(event, url) {
  const count = el('div', { class: 'count-big' });
  const update = () => (count.textContent = `${state.detail.participants.length}명 등록`);
  update();
  const timer = setInterval(update, 1000);
  const close = () => { clearInterval(timer); layer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  const layer = el('div', { class: 'stage-full' },
    el('button', { class: 'btn close', text: '닫기 ✕', onclick: close }),
    el('h1', { text: event.name }),
    qrSvg(url),
    el('div', { style: 'font-size:clamp(20px,3vw,32px);font-weight:700', text: '📱 휴대폰 카메라로 찍고 이름을 넣어 주세요' }),
    count,
  );
  document.addEventListener('keydown', onKey);
  document.body.append(layer);
}

async function removePerson(p) {
  const w = winnerOf(p.id);
  if (!confirm(`${label(p)}을(를) 명단에서 뺄까요?${w ? `\n당첨(${w.prize})도 같이 취소돼요.` : ''}`)) return;
  try {
    await api(`events/${state.detail.event.id}/participants/${p.id}`, { method: 'DELETE' });
    await loadDetail(state.detail.event.id);
    render();
  } catch (x) { onError(x); }
}

// ---------- 추첨 ----------

const COLORS = ['#ff5a3c', '#ffb800', '#2ec4b6', '#7b61ff', '#ff6fb5', '#1f9d61', '#3a86ff', '#fb8500'];

function drawWheel(canvas, names, rotation) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth * dpr;
  if (!size) return;
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(r, r);
  if (!names.length) {
    ctx.fillStyle = '#ddd';
    ctx.beginPath(); ctx.arc(0, 0, r - 4 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  const seg = (Math.PI * 2) / names.length;
  const showText = seg > 0.05;
  const fontPx = Math.max(10 * dpr, Math.min(26 * dpr, seg * r * 0.55));
  names.forEach((name, i) => {
    const a0 = rotation + i * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 4 * dpr, a0, a0 + seg);
    ctx.closePath();
    // 개수가 색 개수의 배수+1이면 첫 칸과 끝 칸이 같은 색이 되지 않게
    let c = i % COLORS.length;
    if (i === names.length - 1 && names.length > 1 && c === 0) c = 1;
    ctx.fillStyle = COLORS[c];
    ctx.fill();
    if (names.length <= 120) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(); }
    if (showText) {
      ctx.save();
      const mid = a0 + seg / 2;
      // 왼쪽 절반은 글자가 뒤집히지 않게 돌려 쓴다
      const flip = Math.cos(mid) < 0;
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${fontPx}px sans-serif`;
      ctx.textAlign = flip ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const text = name.length > 9 ? name.slice(0, 8) + '…' : name;
      ctx.fillText(text, flip ? -(r - 18 * dpr) : r - 18 * dpr, 0);
      ctx.restore();
    }
  });
  // 가운데 단추
  ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 4 * dpr; ctx.strokeStyle = '#2b2118'; ctx.stroke();
  ctx.restore();
}

function indexAt(rotation, n) {
  const seg = (Math.PI * 2) / n;
  const a = (((-rotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(n - 1, Math.floor(a / seg));
}

let wheelRotation = 0;

function drawTab() {
  const { event, participants } = state.detail;
  const left = pool();

  if (!event.prizes.length) {
    return el('div', { class: 'card' }, el('p', { text: '선물이 없어요. 설정에서 선물을 넣어 주세요.' }), el('button', { class: 'btn primary', text: '설정으로', onclick: () => go(`#e/${event.id}/settings`) }));
  }

  const prizeList = el('div', { class: 'prize-pick' },
    event.prizes.map((p) => {
      const n = remaining(p);
      return el('button', {
        class: `btn prize-btn${state.prize === p.name ? ' on' : ''}`,
        disabled: n <= 0,
        onclick: () => { state.prize = p.name; render(); },
      }, el('span', { text: `🎁 ${p.name}` }), el('span', { class: 'left', text: n > 0 ? `${n}/${p.count} 남음` : '다 나감' }));
    }),
  );

  const modeBox = el('div', { class: 'mode' },
    [['wheel', '🎡 룰렛'], ['slot', '🎰 이름 뽑기']].map(([k, t]) => el('button', {
      class: state.mode === k ? 'on' : null, text: t,
      onclick: () => { state.mode = k; store('ld_mode', k); render(); },
    })),
  );

  const current = event.prizes.find((p) => p.name === state.prize);
  const canDraw = current && remaining(current) > 0 && left.length > 0;
  const drawBtn = el('button', { class: 'btn primary big', text: '뽑기!', disabled: !canDraw, onclick: () => runDraw(stage, drawBtn) });

  const stage = el('div', { class: 'card stage' },
    el('div', { class: 'now-prize', text: current ? `🎁 ${current.name}` : '' }),
  );
  if (state.mode === 'wheel') {
    const canvas = el('canvas');
    const nameLine = el('div', { class: 'wheel-name', text: left.length ? `${left.length}명 중 한 명` : '' });
    stage.append(el('div', { class: 'wheel-wrap' }, el('div', { class: 'pointer' }), canvas), nameLine);
    requestAnimationFrame(() => drawWheel(canvas, left.map((p) => p.name), wheelRotation));
  } else {
    stage.append(el('div', { class: 'slot' }, el('div', { class: 'name', text: '?' }), el('div', { class: 'note', text: left.length ? `${left.length}명 중 한 명` : '' })));
  }
  stage.append(drawBtn);
  if (!left.length) stage.append(el('p', { class: 'muted', text: participants.length ? '모두 당첨됐어요!' : '아직 참가자가 없어요. 큐알 등록부터 해 주세요.' }));

  const fullBtn = el('button', { class: 'btn sm', text: '⛶ 큰 화면', onclick: () => toggleFull(stage, fullBtn) });

  return el('div', { class: 'draw-layout' },
    el('div', {},
      el('div', { class: 'card' },
        el('h2', { text: '선물 고르기' }),
        prizeList,
      ),
      el('div', { class: 'card' },
        el('div', { class: 'muted small', text: '뽑는 방법' }), modeBox,
        el('p', { class: 'muted small', text: `남은 사람 ${left.length}명 · 당첨된 사람은 다시 안 뽑혀요` }),
        fullBtn,
      ),
    ),
    stage,
  );
}

function toggleFull(stage, btn) {
  const full = stage.classList.toggle('full');
  if (btn) btn.textContent = full ? '⛶ 작은 화면' : '⛶ 큰 화면';
  let closer = stage.querySelector('.close');
  if (full && !closer) {
    closer = el('button', { class: 'btn close', style: 'position:absolute;top:16px;right:16px', text: '닫기 ✕', onclick: () => toggleFull(stage, btn) });
    stage.append(closer);
  } else if (!full && closer) closer.remove();
  const canvas = stage.querySelector('canvas');
  if (canvas) requestAnimationFrame(() => drawWheel(canvas, pool().map((p) => p.name), wheelRotation));
}

async function runDraw(stage, btn) {
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true;
  sound.get(); // 누른 순간에 소리를 켜 둔다 (휴대폰·사파리)
  const id = state.detail.event.id;
  let res;
  try {
    res = await api(`events/${id}/draw`, { method: 'POST', body: { prize: state.prize } });
    if (res.pool.some((pid) => !state.detail.participants.find((p) => p.id === pid))) await loadDetail(id);
  } catch (x) {
    state.busy = false;
    btn.disabled = false;
    return onError(x);
  }
  const people = res.pool.map((pid) => state.detail.participants.find((p) => p.id === pid)).filter(Boolean);
  const winner = state.detail.participants.find((p) => p.id === res.winner.participantId);
  const k = people.findIndex((p) => p.id === winner.id);

  if (stage.querySelector('canvas')) await spinWheel(stage, people, k);
  else await shuffleNames(stage, people, k);

  sound.win();
  confetti();
  state.detail.winners.push(res.winner);
  showWinner(winner, res.winner, stage);
}

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function spinWheel(stage, people, k) {
  const canvas = stage.querySelector('canvas');
  const nameLine = stage.querySelector('.wheel-name');
  const names = people.map((p) => p.name);
  const n = names.length;
  const seg = (Math.PI * 2) / n;
  const f = 0.15 + Math.random() * 0.7; // 칸 가장자리에 걸치지 않게
  const turns = 7 + Math.floor(Math.random() * 3);
  const start = wheelRotation;
  const base = Math.ceil(start / (Math.PI * 2)) * Math.PI * 2;
  const end = base + turns * Math.PI * 2 - (k + f) * seg;
  const duration = 6500;
  const t0 = performance.now();
  let lastIdx = -1;
  let lastTick = 0;
  return new Promise((resolve) => {
    (function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      wheelRotation = start + (end - start) * easeOut(t);
      drawWheel(canvas, names, wheelRotation);
      const idx = indexAt(wheelRotation, n);
      if (idx !== lastIdx) {
        lastIdx = idx;
        nameLine.textContent = label(people[idx]);
        if (now - lastTick > 45) { sound.tick(); lastTick = now; }
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        wheelRotation %= Math.PI * 2;
        resolve();
      }
    })(t0);
  });
}

function shuffleNames(stage, people, k) {
  const box = stage.querySelector('.slot');
  const nameEl = box.querySelector('.name');
  const noteEl = box.querySelector('.note');
  box.classList.remove('done');
  const duration = 4800;
  const t0 = performance.now();
  let prev = -1;
  return new Promise((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / duration;
      if (t >= 1) {
        nameEl.textContent = people[k].name;
        noteEl.textContent = people[k].note || '';
        box.classList.add('done');
        return setTimeout(resolve, 350);
      }
      let i = Math.floor(Math.random() * people.length);
      if (people.length > 1 && i === prev) i = (i + 1) % people.length;
      prev = i;
      nameEl.textContent = people[i].name;
      noteEl.textContent = people[i].note || '';
      sound.tick();
      // 처음엔 빠르게, 끝으로 갈수록 천천히
      setTimeout(step, 40 + Math.pow(t, 3) * 420);
    };
    step();
  });
}

function showWinner(person, win, stage) {
  const id = state.detail.event.id;
  const done = async (fn) => {
    layer.remove();
    try { await fn?.(); } catch (x) { onError(x); }
    await loadDetail(id).catch(() => {});
    state.busy = false;
    const wasFull = stage.classList.contains('full');
    render();
    if (wasFull) toggleFull(app.querySelector('.stage'), app.querySelector('.draw-layout .btn.sm'));
  };
  const layer = el('div', { class: 'winner-pop' },
    el('div', { class: 'box' },
      el('div', { style: 'font-size:56px', text: '🎉' }),
      el('div', { class: 'prize', text: `🎁 ${win.prize}` }),
      el('div', { class: 'name', text: person.name }),
      el('div', { class: 'note', text: person.note || '' }),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' },
        el('button', { class: 'btn primary big', text: '축하해요!', onclick: () => done() }),
      ),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        el('button', { class: 'btn sm ghost', text: '당첨 취소', onclick: () => done(() => api(`events/${id}/winners/${win.id}`, { method: 'DELETE' })) }),
        el('button', {
          class: 'btn sm ghost danger', text: '자리에 없음 · 명단에서 빼기',
          onclick: () => done(() => api(`events/${id}/participants/${person.id}`, { method: 'DELETE' })),
        }),
      ),
    ),
  );
  document.body.append(layer);
}

// ---------- 결과 ----------

function csv(rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

function download(name, text) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function resultsTab() {
  const { event, participants, winners } = state.detail;
  const byId = new Map(participants.map((p) => [p.id, p]));
  const id = event.id;
  const cards = event.prizes.map((prize) => {
    const list = winners.filter((w) => w.prize === prize.name);
    return el('div', { class: 'card' },
      el('h2', { text: `🎁 ${prize.name}` }),
      el('div', { class: 'muted small', text: `${list.length}/${prize.count}명` }),
      list.length
        ? el('ol', {}, list.map((w) => el('li', {},
            el('span', { text: byId.get(w.participantId) ? label(byId.get(w.participantId)) : '(빠진 사람)' }),
            el('button', {
              class: 'btn sm ghost', text: '취소',
              onclick: async () => {
                if (!confirm('이 당첨을 취소할까요? 그 사람은 다시 뽑힐 수 있어요.')) return;
                try { await api(`events/${id}/winners/${w.id}`, { method: 'DELETE' }); await loadDetail(id); render(); } catch (x) { onError(x); }
              },
            }),
          )))
        : el('p', { class: 'muted', text: '아직 없어요' }),
    );
  });
  // 설정에서 지운 선물로 뽑힌 사람도 보이게
  const orphan = winners.filter((w) => !event.prizes.some((p) => p.name === w.prize));
  if (orphan.length) cards.push(el('div', { class: 'card' }, el('h2', { text: '그 밖의 선물' }), el('ol', {}, orphan.map((w) => el('li', {}, el('span', { text: `${byId.get(w.participantId)?.name || '?'} — ${w.prize}` }))))));

  return el('div', {},
    el('div', { class: 'row', style: 'margin-bottom:16px' },
      el('div', { class: 'grow muted', text: `참가 ${participants.length}명 · 당첨 ${winners.length}명` }),
      el('button', {
        class: 'btn', text: '당첨자 엑셀(CSV)',
        onclick: () => download(`${event.name} 당첨자.csv`, csv([['선물', '이름', '구분', '뽑은 시각'],
          ...winners.map((w) => { const p = byId.get(w.participantId) || {}; return [w.prize, p.name, p.note, new Date(w.at).toLocaleString('ko-KR')]; })])),
      }),
      el('button', {
        class: 'btn', text: '참가자 엑셀(CSV)',
        onclick: () => download(`${event.name} 참가자.csv`, csv([['번호', '이름', '구분', '등록 시각', '당첨'],
          ...participants.map((p, i) => [i + 1, p.name, p.note, new Date(p.at).toLocaleString('ko-KR'), winnerOf(p.id)?.prize || ''])])),
      }),
    ),
    el('div', { class: 'results' }, cards),
  );
}

// ---------- 설정 ----------

function settingsTab() {
  const { event, winners } = state.detail;
  const id = event.id;
  const name = el('input', { class: 'input', value: event.name, maxlength: 60, required: true });
  const prizes = prizeEditor(event.prizes);
  const err = el('p', { class: 'error' });
  const form = el('form', { class: 'card' },
    el('h2', { text: '행사 고치기' }),
    el('label', { class: 'field' }, el('span', { text: '행사 이름' }), name),
    el('div', { class: 'field' }, el('span', { text: '선물과 당첨 인원(명)' }), prizes.node),
    el('p', { class: 'muted small', text: '선물 이름을 바꾸면 이미 뽑힌 당첨은 결과의 "그 밖의 선물"로 옮겨져요.' }),
    el('button', { class: 'btn primary', text: '저장' }),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await updateEvent({ name: name.value, prizes: prizes.value() });
      await loadDetail(id);
      toast('저장했어요');
      render();
    } catch (x) {
      if (x.status === 401) return onError(x);
      err.textContent = x.message;
    }
  });

  const hostLink = `${location.origin}/admin#host/${id}/${hosts.get(id)?.key || ''}`;
  return el('div', {},
    form,
    el('div', { class: 'card' },
      el('h2', { text: '다른 기기에서 진행하기' }),
      el('p', { class: 'muted small', text: '진행자 키는 이 브라우저에만 저장돼 있어요. 이 링크를 열면 다른 기기(노트북·태블릿)에서도 이 행사를 진행할 수 있어요. 링크가 있으면 누구나 추첨을 할 수 있으니 참가자에게는 보내지 마세요.' }),
      el('button', { class: 'btn', text: '진행자 링크 복사', onclick: () => navigator.clipboard?.writeText(hostLink).then(() => toast('진행자 링크를 복사했어요')) }),
    ),
    el('div', { class: 'card' },
      el('h2', { text: '다시 하기' }),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn', text: `당첨 모두 지우기 (${winners.length}명)`, disabled: !winners.length,
          onclick: async () => {
            if (!confirm('당첨 기록을 모두 지울까요? 참가자 명단은 그대로 남아요.')) return;
            try { await api(`events/${id}/winners`, { method: 'DELETE' }); await loadDetail(id); toast('당첨을 모두 지웠어요'); render(); } catch (x) { onError(x); }
          },
        }),
        el('button', {
          class: 'btn danger', text: '행사 지우기',
          onclick: async () => {
            if (prompt(`행사와 참가자·당첨 기록이 모두 지워져요.\n지우려면 행사 이름(${event.name})을 똑같이 써 주세요.`) !== event.name) return;
            try { await api(`events/${id}`, { method: 'DELETE' }); hosts.remove(id); toast('지웠어요'); go(''); } catch (x) { onError(x); }
          },
        }),
      ),
    ),
  );
}

// ---------- 시작 ----------

const soundBtn = document.getElementById('soundBtn');
const paintSound = () => (soundBtn.textContent = sound.on ? '🔊 소리 켬' : '🔇 소리 끔');
soundBtn.addEventListener('click', () => { sound.on = !sound.on; store('ld_sound', sound.on ? 'on' : 'off'); paintSound(); });
paintSound();


window.addEventListener('hashchange', route);
window.addEventListener('resize', () => {
  const canvas = app.querySelector('canvas');
  if (canvas && state.detail && !state.busy) drawWheel(canvas, pool().map((p) => p.name), wheelRotation);
});

route();
