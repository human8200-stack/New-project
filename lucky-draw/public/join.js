// 참가자 화면: 큐알로 열고 이름을 등록한다. 등록 뒤에는 당첨되면 바로 보인다.
const eventId = new URLSearchParams(location.search).get('e') || '';
const view = document.getElementById('view');
const title = document.getElementById('title');
const sub = document.getElementById('sub');

// 휴대폰마다 하나씩 (같은 휴대폰으로 두 번 등록되지 않게)
function deviceId() {
  let id = store('ld_device');
  if (!/^[a-z0-9]{16,40}$/.test(id || '')) {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    id = Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
    store('ld_device', id);
  }
  return id;
}
const device = deviceId();

let last = null;
let editing = false;
let celebrated = new Set(JSON.parse(store(`ld_won_${eventId}`) || '[]'));

function render(info) {
  last = info;
  title.textContent = info.event.name;
  view.replaceChildren();

  if (!info.me || editing) {
    sub.textContent = info.event.open || info.me ? '이름을 등록하면 추첨에 들어가요' : '';
    if (!info.event.open && !info.me) {
      view.append(el('div', { class: 'card ticket' }, el('h2', { text: '등록이 마감됐어요' }), el('p', { class: 'muted', text: '진행자에게 물어봐 주세요.' })));
      return;
    }
    const name = el('input', { class: 'input', id: 'name', maxlength: 30, autocomplete: 'name', required: true, value: info.me?.name || store('ld_name') || '' });
    const note = el('input', { class: 'input', id: 'note', maxlength: 30, value: info.me?.note || store('ld_note') || '', placeholder: '예: 2반, 영업팀, 1234' });
    const err = el('p', { class: 'error' });
    const btn = el('button', { class: 'btn primary', style: 'width:100%', text: info.me ? '고치기' : '등록하기' });
    const form = el('form', { class: 'card' },
      el('label', { class: 'field' }, el('span', { text: '이름' }), name),
      el('label', { class: 'field' }, el('span', {}, '구분 ', el('small', { class: 'muted', text: '(선택 · 같은 이름이 있을 때)' })), note),
      btn, err,
      info.me ? el('button', { type: 'button', class: 'btn ghost', style: 'width:100%;margin-top:8px', text: '그대로 두기', onclick: () => { editing = false; render(last); } }) : null,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      try {
        store('ld_name', name.value.trim());
        store('ld_note', note.value.trim());
        const res = await api(`join/${eventId}`, { method: 'POST', body: { name: name.value, note: note.value, device } });
        editing = false;
        render(res);
        if (!info.me) confetti(1500);
      } catch (x) {
        err.textContent = x.message;
        btn.disabled = false;
      }
    });
    view.append(form);
    if (!info.me) name.focus();
    return;
  }

  sub.textContent = '';
  if (info.won.length) {
    view.append(el('div', { class: 'card won' },
      el('div', { style: 'font-size:56px', text: '🎉' }),
      el('div', { style: 'font-size:20px;font-weight:700', text: `${info.me.name}님 당첨!` }),
      info.won.map((p) => el('div', { class: 'prize', text: `🎁 ${p}` })),
      el('p', { text: '진행자에게 이 화면을 보여 주세요' }),
    ));
    const fresh = info.won.filter((p) => !celebrated.has(p));
    if (fresh.length) {
      fresh.forEach((p) => celebrated.add(p));
      store(`ld_won_${eventId}`, JSON.stringify([...celebrated]));
      confetti();
      sound.win();
      navigator.vibrate?.([200, 100, 200]);
    }
  }
  view.append(el('div', { class: 'card ticket' },
    el('div', { class: 'muted', text: '등록 완료' }),
    el('div', { class: 'name', text: info.me.name }),
    info.me.note ? el('div', { class: 'muted', text: info.me.note }) : null,
    info.won.length ? null : el('p', {}, '추첨을 기다려 주세요 ', el('span', { class: 'waiting-dot', text: '●' })),
    el('p', { class: 'muted small', text: '이 화면을 열어 두면 당첨됐을 때 바로 알려 드려요.' }),
    el('button', { class: 'btn sm', text: '이름 고치기', onclick: () => { editing = true; render(last); } }),
  ));
}

async function load() {
  try {
    const info = await api(`join/${eventId}?device=${device}`);
    if (!editing) render(info);
  } catch (x) {
    title.textContent = '행운 추첨';
    sub.textContent = '';
    view.replaceChildren(el('div', { class: 'card ticket' }, el('h2', { text: x.status === 404 ? '행사를 찾을 수 없어요' : '연결이 안 돼요' }), el('p', { class: 'muted', text: x.status === 404 ? '큐알을 다시 찍어 주세요.' : '잠시 뒤에 다시 열어 주세요.' })));
  }
}

if (!/^[a-z0-9]{4,20}$/.test(eventId)) {
  sub.textContent = '';
  view.append(el('div', { class: 'card ticket' }, el('h2', { text: '큐알을 다시 찍어 주세요' })));
} else {
  load();
  // 등록한 뒤에는 당첨됐는지 계속 본다
  setInterval(() => { if (last?.me && !document.hidden) load(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && last?.me) load(); });
}
