// 계정마다 정한 시간(한국 시간, 기본 16:30)에 "오늘 할 공부" 알림을 보낸다. Firebase 유료 요금제(Cloud Functions) 없이 돌아간다.
// - Netlify 예약 함수(netlify/functions/daily-push.mjs)가 1분마다 실행한다 (거의 정각)
// - GitHub Actions(.github/workflows/daily-push.yml)가 30분마다 한 번 더 확인한다 (Netlify가 멈췄을 때를 대비)
// 알림을 켠 계정(households 문서의 pushOn)마다, 정한 시간이 지났고 오늘 아직 안 보냈으면
// 먼저 pushSent에 오늘 날짜를 적어 "내가 보낸다"고 잡은 뒤(둘이 동시에 돌아도 한 번만), 오늘 계획을 만들어 기기들(pushSubs)로 보낸다.
// 알림은 표준 웹 푸시(VAPID)로 보낸다. 키는 처음 돌 때 서버가 만들어 Firestore에 둔다:
//   config/push     공개 키 (앱이 읽어서 알림을 구독)
//   secrets/vapid   비밀 키 (규칙상 앱에서는 못 읽고, 이 서버만 읽는다)

import P from '../planner.js'; // planner.js는 CommonJS. Node도 Netlify(esbuild)도 그대로 읽는다

const APP_URL = 'https://human8200-stack.github.io/New-project/';

export function koreaToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function koreaMinutes(now = Date.now()) {
  const d = new Date(now + 9 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// 정한 시간이 지났고(늦어도 3시간 안), 오늘 아직 안 보냈으면 보낼 때
export function isDue(data, today, nowMin) {
  const [h, m] = String(data.pushTime || '16:30').split(':').map(Number);
  const at = h * 60 + (m || 0);
  return data.pushSent !== today && nowMin >= at && nowMin - at < 180;
}

function hm(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 앱이 오늘 계획을 이미 만들었으면 그것을, 아니면 앱과 같은 방식으로 새로 만든다
export function todayTasks(state, today) {
  const plan = state.plans && state.plans[today];
  if (plan) return plan.tasks.filter((t) => t.status === 'todo');
  const available = (state.overrides || {})[today] || P.defaultAvailable(state, today);
  const { minutes } = P.effectiveBudget(state, today, available, '보통');
  return P.generatePlan(state, today, minutes);
}

export function summarize(state, today) {
  const tasks = todayTasks(state, today);
  const recall = (state.logs || []).filter((l) => l.due && l.due <= today).length
    + (state.wrongs || []).filter((w) => w.due && w.due <= today).length;
  if (!tasks.length) {
    return { title: '오늘 할 공부를 다 했어요', body: recall ? `떠올릴 카드 ${recall}장만 보면 끝이에요.` : '잘했어요! 내일도 이대로만 가요.' };
  }
  const minutes = tasks.reduce((a, t) => a + (t.minutes || 0), 0);
  const list = tasks.slice(0, 3).map((t) => `${t.title.replace(/\s*\(.*?\)/g, '')} ${t.unit === '번' ? '' : `${t.amount}${t.unit}`}`.trim());
  const more = tasks.length > 3 ? ` 외 ${tasks.length - 3}개` : '';
  return {
    title: `오늘 할 공부 ${tasks.length}개 · 약 ${hm(minutes)}`,
    body: `${list.join(', ')}${more}${recall ? ` · 떠올릴 카드 ${recall}장` : ''}`,
  };
}

// 웹 푸시 키가 없으면 만든다 (부모님이 키를 복사해 넣지 않아도 되게)
export async function ensureVapid(db, webpush) {
  const secretRef = db.collection('secrets').doc('vapid');
  const snap = await secretRef.get();
  if (snap.exists) return snap.data();
  const keys = webpush.generateVAPIDKeys();
  await secretRef.set(keys);
  await db.collection('config').doc('push').set({ publicKey: keys.publicKey });
  console.log('웹 푸시 키를 새로 만들었어요.');
  return keys;
}

// 알림 보내기: 구독(sub JSON 글자) 하나에 하나씩. 없어진 구독은 statusCode 404·410
async function deliver(webpush, subs, note) {
  const payload = JSON.stringify({ data: { title: note.title, body: note.body, link: `${APP_URL}?from=push` } });
  const results = await Promise.all(subs.map(async (raw) => {
    try {
      await webpush.sendNotification(JSON.parse(raw), payload, { TTL: 3 * 60 * 60, urgency: 'high' });
      return { ok: true };
    } catch (e) {
      return { ok: false, dead: e && (e.statusCode === 404 || e.statusCode === 410 || e instanceof SyntaxError) };
    }
  }));
  return results;
}

export async function sendAll(db, webpush, today, FieldValue, nowMin = koreaMinutes()) {
  const snap = await db.collection('households').where('pushOn', '==', true).get();
  let sent = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const subs = Array.isArray(data.pushSubs) ? data.pushSubs.filter(Boolean) : [];
    if (!subs.length || !data.state || !isDue(data, today, nowMin)) continue;
    // 동시에 도는 다른 실행과 겹치지 않게, 오늘 보낼 차례를 먼저 잡는다
    const mine = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || !isDue(fresh.data(), today, nowMin)) return false;
      tx.update(doc.ref, { pushSent: today });
      return true;
    });
    if (!mine) continue;
    let note;
    try {
      note = summarize(JSON.parse(data.state), today);
    } catch (e) {
      console.log(`${doc.id}: 기록을 읽지 못함 (${e.message})`);
      continue;
    }
    // 서비스 워커(sw.js)가 data로 알림을 띄운다 (iOS는 받은 알림을 반드시 보여 줘야 한다)
    const results = await deliver(webpush, subs, note);
    const dead = [];
    results.forEach((r, i) => {
      if (r.ok) sent += 1;
      else {
        failed += 1;
        if (r.dead) dead.push(subs[i]);
      }
    });
    if (dead.length) await doc.ref.update({ pushSubs: FieldValue.arrayRemove(...dead) });
  }
  return { sent, failed };
}

// GitHub Actions와 Netlify가 같이 쓴다
export async function runOnce() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    const msg = 'FIREBASE_SERVICE_ACCOUNT 비밀 값이 없어서 보내지 않았어요 (FIREBASE_SETUP.md 7번).';
    console.log(msg);
    return { sent: 0, failed: 0, note: msg };
  }
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const webpush = (await import('web-push')).default;
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
  const db = getFirestore();
  const keys = await ensureVapid(db, webpush);
  webpush.setVapidDetails(APP_URL, keys.publicKey, keys.privateKey);
  const today = koreaToday();
  const result = await sendAll(db, webpush, today, FieldValue);
  console.log(`${today} ${String(Math.floor(koreaMinutes() / 60)).padStart(2, '0')}:${String(koreaMinutes() % 60).padStart(2, '0')}: 보냄 ${result.sent}, 실패 ${result.failed}`);
  return result;
}

async function main() {
  await runOnce();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
