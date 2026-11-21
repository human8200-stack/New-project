// 투표 추첨 (진행자 화면). 후보 이름은 진행자가 쓰고, 참가자는 투표만 한다.
// 순서: 큐알로 투표 받기(막대가 실시간으로 늘어남) → 투표 마감 → 후보 1등 발표 → 투표한 사람 중 번호 추첨
// admin.js보다 먼저 읽히지만, 여기 함수들은 admin.js가 다 읽힌 뒤에 불린다.

const isVote = () => state.detail?.event.kind === 'vote';
const voteCfg = () => state.detail.event.vote;
const candName = (id) => voteCfg().candidates.find((c) => c.id === id)?.name || '(빠진 후보)';
const barWidth = new Map(); // 막대가 처음부터 다시 그려지지 않고 늘어나게, 지난 길이를 기억

function tally() {
  const n = new Map(voteCfg().candidates.map((c) => [c.id, 0]));
  for (const v of state.detail.voters) if (n.has(v.candidate)) n.set(v.candidate, n.get(v.candidate) + 1);
  return voteCfg().candidates.map((c) => ({ ...c, votes: n.get(c.id) }));
}

// 투표한 사람 추첨에 남은 번호
function voterPool() {
  const won = new Set(state.detail.winners.map((w) => w.participantId));
  return state.detail.voters.filter((v) => !v.absent && !won.has(v.id));
}
const numberPeople = (list) => list.map((v) => ({ id: v.id, name: `${v.number}번`, note: '' }));

function voteBars(big = false) {
  const list = tally();
  const max = Math.max(1, ...list.map((c) => c.votes));
  const lead = Math.max(...list.map((c) => c.votes));
  return el('div', { class: `bars${big ? ' big' : ''}` },
    list.map((c) => {
      const w = (c.votes / max) * 100;
      const key = `${big ? 'b' : 's'}${c.id}`;
      const fill = el('div', { class: 'bar-fill', style: `width:${barWidth.get(key) ?? 0}%` });
      setTimeout(() => (fill.style.width = `${w}%`), 30);
      barWidth.set(key, w);
      return el('div', { class: `bar-row${c.votes && c.votes === lead ? ' lead' : ''}` },
        el('div', { class: 'bar-name', text: c.name }),
        el('div', { class: 'bar-track' }, fill),
        el('div', { class: 'bar-n', text: `${c.votes}표` }),
      );
    }),
  );
}

// ---------- 만들기·고치기 칸 ----------

function candidateEditor(list) {
  const rows = el('div', { class: 'prize-rows' });
  const add = (c = { name: '' }) => {
    if (rows.children.length >= 20) return toast('후보는 20개까지예요');
    const input = el('input', { class: 'input', placeholder: `후보 ${rows.children.length + 1} 이름`, value: c.name, maxlength: 30 });
    if (c.id) input.dataset.id = c.id;
    const row = el('div', { class: 'cand-row' }, input,
      el('button', { type: 'button', class: 'btn ghost', text: '✕', 'aria-label': '빼기', onclick: () => row.remove() }));
    rows.append(row);
  };
  (list.length ? list : [{ name: '' }, { name: '' }, { name: '' }]).forEach(add);
  return {
    node: el('div', {}, rows, el('button', { type: 'button', class: 'btn sm', text: '+ 후보 더하기', onclick: () => add() })),
    value: () => [...rows.querySelectorAll('input')]
      .map((i) => ({ id: i.dataset.id, name: i.value.trim() }))
      .filter((c) => c.name),
  };
}

function voteFields(v = {}) {
  const cands = candidateEditor(v.candidates || []);
  const topPrize = el('input', { class: 'input', placeholder: '예: 꽃다발', value: v.topPrize || '', maxlength: 40 });
  const topCount = el('input', { class: 'input', type: 'number', min: 1, max: 10, value: v.topCount ?? 1, 'aria-label': '후보 1등 인원' });
  const voterPrize = el('input', { class: 'input', placeholder: '예: 커피 기프티콘', value: v.voterPrize || '', maxlength: 40 });
  const voterCount = el('input', { class: 'input', type: 'number', min: 0, max: 50, value: v.voterCount ?? 2, 'aria-label': '투표한 사람 추첨 인원' });
  return {
    nodes: [
      el('div', { class: 'field' }, el('span', {}, '후보 이름 ', el('small', { class: 'muted', text: '(2~20개 · 참가자는 이 중에서 고르기만 해요)' })), cands.node),
      el('div', { class: 'field' }, el('span', { text: '① 표를 가장 많이 받은 후보 — 선물과 인원(명)' }),
        el('div', { class: 'prize-row' }, topPrize, topCount, el('span'))),
      el('div', { class: 'field' }, el('span', { text: '② 투표한 사람 중 추첨 — 선물과 인원(명)' }),
        el('div', { class: 'prize-row' }, voterPrize, voterCount, el('span'))),
    ],
    value: () => ({
      candidates: cands.value(),
      topPrize: topPrize.value.trim(),
      topCount: Number(topCount.value) || 1,
      voterPrize: voterPrize.value.trim(),
      voterCount: Math.max(0, Number(voterCount.value) || 0),
    }),
  };
}

// ---------- 📱 큐알 투표 ----------

function voteQrTab() {
  const { event, voters } = state.detail;
  const url = joinUrl(event.id);
  const toggle = el('button', {
    class: `btn ${event.open ? 'primary' : ''}`,
    text: event.open ? '투표 마감' : '투표 다시 받기',
    onclick: async () => {
      if (event.open && !confirm('투표를 마감할까요? 마감하면 더는 투표할 수 없어요.')) return;
      if (!event.open && event.vote.top && !confirm('투표를 다시 받으면 발표한 1등 결과가 지워져요. 계속할까요?')) return;
      try { await updateEvent({ open: !event.open }); await loadDetail(event.id); render(); } catch (x) { onError(x); }
    },
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
      el('p', { class: 'muted', style: 'margin-top:16px', text: event.open ? '🟢 투표 받는 중' : '🔒 투표 마감 (더는 투표 못 해요)' }),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'row' },
        el('div', { class: 'grow' }, el('div', { class: 'muted small', text: '투표한 사람' }), el('div', { class: 'count-big', text: `${voters.length}명` })),
        toggle,
      ),
      voteBars(),
      event.open
        ? el('p', { class: 'muted small', text: '막대는 몇 초마다 저절로 늘어나요. 다 모이면 투표 마감을 눌러 주세요.' })
        : el('button', { class: 'btn primary', style: 'margin-top:12px', text: '발표·추첨하러 가기 →', onclick: () => go(`#e/${event.id}/draw`) }),
    ),
  );
}

// ---------- 🏆 발표·추첨 ----------

function voteDrawTab() {
  const { event, voters, winners } = state.detail;
  const v = event.vote;
  if (event.open) {
    return el('div', { class: 'card' },
      el('h2', { text: '먼저 투표를 마감해 주세요' }),
      el('p', { class: 'muted', text: `지금 ${voters.length}명이 투표했어요. 마감한 뒤에 1등 발표와 번호 추첨을 해요.` }),
      el('button', {
        class: 'btn primary', text: '투표 마감', disabled: !voters.length,
        onclick: async () => {
          if (!confirm('투표를 마감할까요? 마감하면 더는 투표할 수 없어요.')) return;
          try { await updateEvent({ open: false }); await loadDetail(event.id); render(); } catch (x) { onError(x); }
        },
      }),
    );
  }

  // 1단계: 후보 1등
  const top = v.top;
  const topTitle = v.topCount > 1 ? `① 후보 ${v.topCount}등까지 발표` : '① 후보 1등 발표';
  const topCard = el('div', { class: 'card' },
    el('h2', { text: topTitle }),
    el('div', { class: 'muted small', text: `🎁 ${v.topPrize || '선물'} · 표가 가장 많은 후보` }),
    top
      ? el('div', {},
          el('ol', { class: 'top-list' }, sortedTop(top).map((w) => el('li', {}, el('b', { text: `${rankText(w, top)} ${candName(w.candidateId)}` }), el('span', { class: 'muted', text: ` ${w.votes}표${w.drawn ? ' · 동점 추첨' : ''}` })))),
          el('div', { class: 'row', style: 'margin-top:8px' },
            el('button', { class: 'btn sm', text: '발표 다시 보기', onclick: () => revealTop(top) }),
            el('button', {
              class: 'btn sm ghost', text: '발표 지우기',
              onclick: async () => {
                if (!confirm('발표한 1등 결과를 지울까요? 다시 발표하면 동점일 때는 새로 뽑아요.')) return;
                try { await api(`events/${event.id}/top`, { method: 'DELETE' }); await loadDetail(event.id); render(); } catch (x) { onError(x); }
              },
            }),
          ),
        )
      : el('button', { class: 'btn primary big', style: 'margin-top:12px;width:100%', text: '🥇 1등 발표', disabled: !voters.length, onclick: (e) => announce(e.currentTarget) }),
  );

  // 2단계: 투표한 사람 중 번호 추첨
  const left = voterPool();
  const remain = v.voterCount - winners.length;
  const modeBox = el('div', { class: 'mode' },
    [['wheel', '🎡 룰렛'], ['slot', '🎰 번호 뽑기']].map(([k, t]) => el('button', {
      class: state.mode === k ? 'on' : null, text: t,
      onclick: () => { state.mode = k; store('ld_mode', k); render(); },
    })),
  );
  const canDraw = remain > 0 && left.length > 0;
  const drawBtn = el('button', { class: 'btn primary big', text: '번호 뽑기!', disabled: !canDraw, onclick: () => runVoteDraw(stage, drawBtn) });
  const stage = el('div', { class: 'card stage' },
    el('div', { class: 'now-prize', text: `② 투표한 사람 추첨 · 🎁 ${v.voterPrize || '선물'}` }),
  );
  if (state.mode === 'wheel') {
    const canvas = el('canvas');
    stage.append(el('div', { class: 'wheel-wrap' }, el('div', { class: 'pointer' }), canvas), el('div', { class: 'wheel-name', text: left.length ? `${left.length}명 중 한 명` : '' }));
    requestAnimationFrame(() => drawWheel(canvas, numberPeople(left).map((p) => p.name), wheelRotation));
  } else {
    stage.append(el('div', { class: 'slot' }, el('div', { class: 'name', text: '?' }), el('div', { class: 'note', text: left.length ? `${left.length}명 중 한 명` : '' })));
  }
  stage.append(drawBtn);
  if (v.voterCount <= 0) stage.append(el('p', { class: 'muted', text: '투표한 사람 추첨 인원이 0명이에요. 설정에서 바꿀 수 있어요.' }));
  else if (remain <= 0) stage.append(el('p', { class: 'muted', text: `${v.voterCount}명을 다 뽑았어요!` }));
  else if (!left.length) stage.append(el('p', { class: 'muted', text: '뽑을 번호가 없어요.' }));

  const fullBtn = el('button', { class: 'btn sm', id: 'fullBtn', text: '⛶ 큰 화면', onclick: () => toggleFull(stage, fullBtn) });
  return el('div', { class: 'draw-layout' },
    el('div', {},
      topCard,
      el('div', { class: 'card' },
        el('h2', { text: '② 투표한 사람 추첨' }),
        el('div', { class: 'muted small', text: `🎁 ${v.voterPrize || '선물'} · ${Math.max(0, remain)}/${v.voterCount}명 남음` }),
        winners.length ? el('ol', { class: 'top-list' }, winners.map((w) => el('li', {}, el('b', { text: `${w.number ?? '?'}번` })))) : null,
        el('div', { class: 'muted small', style: 'margin-top:8px', text: '뽑는 방법' }), modeBox,
        el('p', { class: 'muted small', text: `남은 번호 ${left.length}개 · 뽑힌 휴대폰에는 당첨 화면이 바로 떠요` }),
        fullBtn,
      ),
    ),
    stage,
  );
}

const rankText = (w, top) => `${top.winners.filter((x) => x.rank === w.rank).length > 1 ? '공동 ' : ''}${w.rank}등`;
const sortedTop = (top) => top.winners.slice().sort((a, b) => a.rank - b.rank);

async function announce(btn) {
  if (state.busy) return;
  btn.disabled = true;
  sound.get(); // 누른 순간에 소리를 켜 둔다 (휴대폰·사파리)
  try {
    const { top } = await api(`events/${state.detail.event.id}/top`, { method: 'POST', body: {} });
    state.detail.event.vote.top = top;
    await revealTop(top);
  } catch (x) {
    btn.disabled = false;
    onError(x);
  }
}

// 두근두근 발표: 동점이면 룰렛으로 먼저 정하고, 아래 등수부터 하나씩 공개한다
async function revealTop(top) {
  state.busy = true;
  const body = el('div', { class: 'reveal-body' });
  const layer = el('div', { class: 'stage-full reveal' },
    el('button', { class: 'btn close', text: '닫기 ✕', onclick: () => finish() }),
    el('div', { class: 'now-prize', text: `🎁 ${top.prize || voteCfg().topPrize || '선물'}` }),
    body,
  );
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    layer.remove();
    state.busy = false;
    render();
  };
  document.body.append(layer);
  const wait = (label) => new Promise((resolve) => body.append(el('button', { class: 'btn primary big', style: 'margin-top:20px', text: label, onclick: resolve })));

  if (top.tie) {
    const picks = top.tie.picks.slice();
    let left = top.tie.candidates.slice();
    body.replaceChildren(
      el('h1', { text: '동점이에요!' }),
      el('p', { class: 'reveal-sub', text: `${top.tie.votes}표로 ${top.tie.candidates.map(candName).join(', ')}이(가) 같아요. 룰렛으로 정해요.` }),
    );
    await wait('🎡 룰렛 돌리기');
    for (const pick of picks) {
      if (closed) return;
      const people = left.map((id) => ({ id, name: candName(id), note: '' }));
      const canvas = el('canvas');
      const wrap = el('div', { class: 'reveal-wheel' }, el('div', { class: 'wheel-wrap' }, el('div', { class: 'pointer' }), canvas), el('div', { class: 'wheel-name' }));
      body.replaceChildren(el('h1', { text: '동점 룰렛' }), wrap);
      wheelRotation = 0;
      await new Promise((r) => requestAnimationFrame(r));
      drawWheel(canvas, people.map((p) => p.name), 0);
      await spinWheel(wrap, people, people.findIndex((p) => p.id === pick));
      sound.win();
      body.append(el('p', { class: 'reveal-sub', text: `🎉 ${candName(pick)}!` }));
      left = left.filter((id) => id !== pick);
      if (pick !== picks[picks.length - 1]) await wait('다음 룰렛');
    }
    await wait('이제 발표할게요 →');
  }

  // 아래 등수부터 (3등 → 2등 → 1등). 같은 등수는 한 번에
  const ranks = [...new Set(top.winners.map((w) => w.rank))].sort((a, b) => b - a);
  for (const [i, rank] of ranks.entries()) {
    if (closed) return;
    const same = top.winners.filter((w) => w.rank === rank);
    const title = `${same.length > 1 ? '공동 ' : ''}${rank}등은…`;
    const drum = el('div', { class: 'drum', text: '두근두근' });
    body.replaceChildren(el('div', { class: 'reveal-rank', text: title }), drum);
    await drumroll(drum, 2600);
    if (closed) return;
    body.replaceChildren(
      el('div', { class: 'reveal-rank', text: title.replace('…', '') }),
      ...same.map((w) => el('div', { class: 'reveal-name', text: candName(w.candidateId) })),
      el('div', { class: 'reveal-sub', text: `${same[0].votes}표` }),
    );
    sound.win();
    confetti();
    if (i < ranks.length - 1) await wait(`다음 (${ranks[i + 1]}등 발표)`);
  }
  if (closed) return;
  await wait('축하해요!');
  finish();
}

function drumroll(node, ms) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / ms;
      if (t >= 1) return resolve();
      sound.tick();
      node.style.transform = `scale(${1 + 0.06 * Math.sin(t * 40)})`;
      setTimeout(step, 70);
    };
    step();
  });
}

async function runVoteDraw(stage, btn) {
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true;
  sound.get();
  const id = state.detail.event.id;
  let res;
  try {
    res = await api(`events/${id}/draw`, { method: 'POST', body: {} });
  } catch (x) {
    state.busy = false;
    btn.disabled = false;
    return onError(x);
  }
  const people = numberPeople(res.pool);
  const k = people.findIndex((p) => p.id === res.winner.participantId);
  if (stage.querySelector('canvas')) await spinWheel(stage, people, k);
  else await shuffleNames(stage, people, k);
  sound.win();
  confetti();
  state.detail.winners.push(res.winner);
  showVoterWinner(res.winner, stage);
}

function showVoterWinner(win, stage) {
  const id = state.detail.event.id;
  const done = async (fn, again) => {
    layer.remove();
    try { await fn?.(); } catch (x) { onError(x); }
    await loadDetail(id).catch(() => {});
    state.busy = false;
    const wasFull = stage.classList.contains('full');
    render();
    const s = app.querySelector('.stage');
    if (wasFull) toggleFull(s, document.getElementById('fullBtn'));
    if (again) {
      const b = s?.querySelector('.btn.big');
      if (b && !b.disabled) runVoteDraw(s, b);
    }
  };
  const layer = el('div', { class: 'winner-pop' },
    el('div', { class: 'box' },
      el('div', { style: 'font-size:56px', text: '🎉' }),
      el('div', { class: 'prize', text: `🎁 ${win.prize}` }),
      el('div', { class: 'name', text: `${win.number}번` }),
      el('div', { class: 'note', text: '휴대폰에 뜬 당첨 화면을 확인해 주세요' }),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' },
        el('button', { class: 'btn primary big', text: '축하해요!', onclick: () => done() }),
      ),
      el('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        el('button', {
          class: 'btn sm', text: '자리에 없음 · 다시 뽑기',
          onclick: () => done(() => api(`events/${id}/winners/${win.id}/absent`, { method: 'POST', body: {} }), true),
        }),
        el('button', { class: 'btn sm ghost', text: '당첨 취소', onclick: () => done(() => api(`events/${id}/winners/${win.id}`, { method: 'DELETE' })) }),
      ),
    ),
  );
  document.body.append(layer);
}

// ---------- 📋 결과 ----------

function voteResultsTab() {
  const { event, voters, winners } = state.detail;
  const v = event.vote;
  const top = v.top;
  const topRank = new Map((top?.winners || []).map((w) => [w.candidateId, w]));
  const list = tally().sort((a, b) => b.votes - a.votes);
  const byVote = new Map(voters.map((x) => [x.id, x]));

  const rows = [['구분', '후보 / 번호', '표 수', '당첨', '선물']];
  list.forEach((c) => {
    const w = topRank.get(c.id);
    rows.push(['후보', c.name, c.votes, w ? `${rankText(w, top)}${w.drawn ? ' (동점 추첨)' : ''}` : '', w ? top.prize || v.topPrize : '']);
  });
  winners.forEach((w) => rows.push(['투표한 사람 추첨', `${w.number ?? '?'}번`, '', '당첨', w.prize]));

  return el('div', {},
    el('div', { class: 'row', style: 'margin-bottom:16px' },
      el('div', { class: 'grow muted', text: `투표 ${voters.length}명 · 후보 ${v.candidates.length}개` }),
      el('button', { class: 'btn', text: '결과 엑셀(CSV)', onclick: () => download(`${event.name} 투표 결과.csv`, csv(rows)) }),
      el('button', {
        class: 'btn', text: '투표 번호 엑셀(CSV)',
        onclick: () => download(`${event.name} 투표 번호.csv`, csv([['번호', '고른 후보', '투표 시각', '당첨', '자리에 없음'],
          ...voters.map((x) => [x.number, candName(x.candidate), new Date(x.at).toLocaleString('ko-KR'), winners.find((w) => w.participantId === x.id)?.prize || '', x.absent ? '예' : ''])])),
      }),
    ),
    el('div', { class: 'results' },
      el('div', { class: 'card' },
        el('h2', { text: '📊 후보별 표' }),
        el('ol', {}, list.map((c) => el('li', {}, el('span', { text: c.name }), el('b', { text: `${c.votes}표` })))),
      ),
      el('div', { class: 'card' },
        el('h2', { text: `🥇 후보 1등 · ${v.topPrize || '선물'}` }),
        top
          ? el('ol', {}, sortedTop(top).map((w) => el('li', {}, el('span', { text: `${rankText(w, top)} ${candName(w.candidateId)}` }), el('span', { class: 'muted', text: `${w.votes}표${w.drawn ? ' · 동점 추첨' : ''}` }))))
          : el('p', { class: 'muted', text: '아직 발표 전이에요' }),
      ),
      el('div', { class: 'card' },
        el('h2', { text: `🎟️ 투표한 사람 추첨 · ${v.voterPrize || '선물'}` }),
        el('div', { class: 'muted small', text: `${winners.length}/${v.voterCount}명` }),
        winners.length
          ? el('ol', {}, winners.map((w) => el('li', {},
              el('span', { text: `${w.number ?? '?'}번${byVote.get(w.participantId) ? ` (${candName(byVote.get(w.participantId).candidate)}에 투표)` : ''}` }),
              el('button', {
                class: 'btn sm ghost', text: '취소',
                onclick: async () => {
                  if (!confirm('이 당첨을 취소할까요? 그 번호는 다시 뽑힐 수 있어요.')) return;
                  try { await api(`events/${event.id}/winners/${w.id}`, { method: 'DELETE' }); await loadDetail(event.id); render(); } catch (x) { onError(x); }
                },
              }),
            )))
          : el('p', { class: 'muted', text: '아직 없어요' }),
      ),
    ),
  );
}

// ---------- ⚙️ 설정 (행사 고치기 칸) ----------

function voteSettingsForm() {
  const { event } = state.detail;
  const name = el('input', { class: 'input', value: event.name, maxlength: 60, required: true });
  const f = voteFields(event.vote);
  const err = el('p', { class: 'error' });
  const form = el('form', { class: 'card' },
    el('h2', { text: '행사 고치기' }),
    el('label', { class: 'field' }, el('span', { text: '행사 이름' }), name),
    ...f.nodes,
    el('p', { class: 'muted small', text: '표를 받은 후보는 뺄 수 없어요(이름 고치기는 돼요). 후보나 1등 인원을 바꾸면 발표한 1등은 지워져요.' }),
    el('button', { class: 'btn primary', text: '저장' }),
    err,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await updateEvent({ name: name.value, ...f.value() });
      await loadDetail(event.id);
      toast('저장했어요');
      render();
    } catch (x) {
      if (x.status === 401) return onError(x);
      err.textContent = x.message;
    }
  });
  return form;
}
