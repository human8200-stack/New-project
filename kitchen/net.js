/* 함께 쓰는 판 (서버 연결) — 서버 주소(config.js SERVER)가 비어 있으면 createNet() 이 null 을 돌려주고 부엌은 혼자 돈다.
   서버: kitchen/worker/ (Cloudflare Worker + Durable Object). 부엌 50명마다 방 하나.
   보내는 것 (최소 신호): 장소 이름(hanok 등) · 이 안에서 불릴 이름(10자, 서버가 다시 거름) · 한옥 차림(쪽/갓) · 일거리 자리 번호 · 15초 동안 도마 톡 횟수 · 인사 번호(0~2). 연락처·실명 같은 개인정보는 받지 않는다.
   받는 것: 15초마다 묶음 한 번 — 방 사람 수, 이 장소 전체 사람 수, 오늘 지은 밥 그릇 수, 자리 목록, 자리별 톡 횟수, 인사.
   밥상 한마디(100자)·한 줄 답(50자)도 글자를 보낸다 (서버가 다시 거름). */

const FLUSH_MS = 15000;   // 묶어서 보내는 간격
const GREET_GAP = 3000;   // 인사는 3초에 한 번까지 바로 보냄

export function createNet(server, h, place) {
  if (!server) return null;
  const base = server.replace(/\/+$/, '');
  const http = base.replace(/^ws/, 'http');
  const N = {
    online: false, offset: 0, seat: -1, roomN: 0, total: 0, bowls: null, // bowls: 오늘 이 장소에서 지은 밥 그릇 수 (서버가 셈)
    _ws: null, _taps: 0, _greet: -1, _lastSend: 0, _timer: 0, _tries: 0, _name: '', _job: 0, _style: '', _stopped: false,

    // 시계 맞추기: 서버 시각과 이 휴대폰 시각의 차이 (밀리초) — 솥 한 바퀴를 모두 같게
    now() { return Date.now() + this.offset; },

    connect(name, job, style) {
      this._name = String(name || ''); if (job != null) this._job = job | 0; if (style) this._style = style;
      let ws;
      try { ws = new WebSocket(base + '/ws?nm=' + encodeURIComponent(this._name) + '&s=' + (this._style || '') + '&j=' + (this._job | 0) + '&p=' + encodeURIComponent(place || '')); } catch (e) { this._fail(); return; }
      this._ws = ws;
      const sentAt = Date.now();
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') {
          const rtt = Date.now() - sentAt;
          if (typeof m.now === 'number') this.offset = m.now + Math.min(rtt, 4000) / 2 - Date.now();
          this.online = true; this._tries = 0; this.seat = m.seat; this.roomN = m.n | 0; this.total = m.total | 0; if (typeof m.bowls === 'number') this.bowls = m.bowls;
          h.online && h.online(this);
          if (m.peers) h.peers && h.peers(m.peers, this.seat);
        } else if (m.t === 'tick') {
          if (typeof m.now === 'number') this.offset = this.offset * 0.8 + (m.now - Date.now()) * 0.2;
          this.roomN = m.n | 0; this.total = m.total | 0; if (typeof m.bowls === 'number') this.bowls = m.bowls;
          h.count && h.count(this.roomN, this.total);
          if (m.peers) h.peers && h.peers(m.peers, this.seat);
          if (m.taps && m.taps.length) h.taps && h.taps(m.taps, this.seat);
          if (m.greets && m.greets.length) h.greets && h.greets(m.greets, this.seat);
        } else if (m.t === 'full') {
          this.total = m.total | 0; if (typeof m.bowls === 'number') this.bowls = m.bowls; this._stopped = true;
          h.full && h.full(this.total);
        }
      };
      ws.onclose = () => { const was = this.online; this.online = false; this._ws = null; if (was) h.offline && h.offline(); if (!this._stopped) this._fail(); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* 이미 닫힘 */ } };
      clearInterval(this._timer); this._timer = setInterval(() => this._flush(false), FLUSH_MS);
    },
    _fail() { // 다시 잇기: 3번까지 금방, 그 뒤로는 1분마다 (그동안은 혼자 도는 부엌)
      this._tries++;
      const wait = this._tries <= 3 ? 2000 * this._tries : 60000;
      setTimeout(() => { if (!this.online && !this._stopped && !document.hidden) this.connect(this._name, this._job); }, wait);
    },
    _flush(force) {
      if (!this.online || !this._ws) return;
      if (!force && !this._taps && this._greet < 0) return;
      const msg = {}; if (this._taps) msg.k = Math.min(this._taps, 40); if (this._greet >= 0) msg.g = this._greet;
      this._taps = 0; this._greet = -1; this._lastSend = Date.now();
      try { this._ws.send(JSON.stringify(msg)); } catch (e) { /* 끊김 — 다시 이어지면 계속 */ }
    },
    tap() { this._taps++; },
    job(j) { this._job = j | 0; if (this.online && this._ws) { try { this._ws.send(JSON.stringify({ j: this._job })); } catch (e) { /* 다시 이어지면 connect 가 보냄 */ } } }, // 일거리 자리 바꿈은 바로 보냄 (사람 수 표시)
    greet(g) { this._greet = g; if (Date.now() - this._lastSend >= GREET_GAP) this._flush(true); },

    // ---- 밥상 한마디 (서버 저장) ----
    async _api(path, body) {
      const r = await fetch(http + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      let j = null; try { j = await r.json(); } catch (e) { /* 빈 대답 */ }
      if (!r.ok) throw Object.assign(new Error('api'), { why: (j && j.why) || 'fail' });
      return j;
    },
    notes() { return this._api('/notes'); },
    postNote(text, name, dev) { return this._api('/notes', { text, name, dev }); }, // name: null 이면 이름 없이
    todak(id, dev) { return this._api('/notes/' + (id | 0) + '/todak', { dev }); },
    report(id, dev) { return this._api('/notes/' + (id | 0) + '/report', { dev }); },
    reply(id, text, dev) { return this._api('/notes/' + (id | 0) + '/reply', { text, dev }); },
    reportReply(id, dev) { return this._api('/replies/' + (id | 0) + '/report', { dev }); },
    deleteNote(id, key) { return this._api('/notes/' + (id | 0) + '/delete', { key }); }, // 내가 올린 글 내리기
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !N.online && !N._stopped && !N._ws) N.connect(N._name, N._job); });
  return N;
}
