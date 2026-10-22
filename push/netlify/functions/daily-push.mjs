// Netlify 예약 함수: 1분마다 "오늘 할 공부" 알림을 보낼 계정이 있는지 보고 보낸다 (push/send.mjs)
// 필요한 환경 변수: FIREBASE_SERVICE_ACCOUNT (FIREBASE_SETUP.md 7번)
import { runOnce } from '../../send.mjs';

export default async () => {
  const result = await runOnce();
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '* * * * *' };
