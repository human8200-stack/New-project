// 계정마다 정한 시간(한국 시간, 기본 16:30)에 "오늘 할 공부" 알림을 보낸다.
// GitHub Actions(.github/workflows/daily-push.yml)가 30분마다 실행한다. Firebase 유료 요금제(Cloud Functions) 없이 돌아간다.
// 알림을 켠 계정(households 문서의 pushOn)마다, 정한 시간이 지났고 오늘 아직 안 보냈으면
// 기록에서 오늘 계획을 만들어 그 계정의 기기들(pushTokens)로 보내고 pushSent에 오늘 날짜를 적는다.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const P = require('../planner.js');

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

const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

export async function sendAll(db, messaging, today, FieldValue, nowMin = koreaMinutes()) {
  const snap = await db.collection('households').where('pushOn', '==', true).get();
  let sent = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const tokens = Array.isArray(data.pushTokens) ? data.pushTokens.filter(Boolean) : [];
    if (!tokens.length || !data.state || !isDue(data, today, nowMin)) continue;
    let note;
    try {
      note = summarize(JSON.parse(data.state), today);
    } catch (e) {
      console.log(`${doc.id}: 기록을 읽지 못함 (${e.message})`);
      continue;
    }
    // 서비스 워커(sw.js)가 data로 알림을 띄운다 (iOS는 받은 알림을 반드시 보여 줘야 한다)
    const res = await messaging.sendEach(tokens.map((token) => ({
      token,
      data: { title: note.title, body: note.body, link: `${APP_URL}?from=push` },
      webpush: { headers: { Urgency: 'high', TTL: String(3 * 60 * 60) } },
    })));
    const dead = [];
    res.responses.forEach((r, i) => {
      if (r.success) sent += 1;
      else {
        failed += 1;
        if (r.error && DEAD.has(r.error.code)) dead.push(tokens[i]);
      }
    });
    const update = { pushSent: today };
    if (dead.length) update.pushTokens = FieldValue.arrayRemove(...dead);
    await doc.ref.update(update);
  }
  return { sent, failed };
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log('FIREBASE_SERVICE_ACCOUNT 비밀 값이 없어서 보내지 않았어요 (FIREBASE_SETUP.md 7번).');
    return;
  }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  initializeApp({ credential: cert(JSON.parse(raw)) });
  const today = koreaToday();
  const { sent, failed } = await sendAll(getFirestore(), getMessaging(), today, FieldValue);
  console.log(`${today}: 보냄 ${sent}, 실패 ${failed}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
