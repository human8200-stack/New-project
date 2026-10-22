// Firebase 웹 앱 설정 (FIREBASE_SETUP.md 5번에서 복사한 값).
// 이 값은 공개돼도 괜찮다 (접근 권한은 firestore.rules가 지킨다).
// null이면 동기화 없이 이 기기에만 저장한다.
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBAH91ftRNbKFjvFTnasDMMovRYDo4fXNA',
  authDomain: 'study-routine-d4885.firebaseapp.com',
  projectId: 'study-routine-d4885',
  storageBucket: 'study-routine-d4885.firebasestorage.app',
  messagingSenderId: '937614194042',
  appId: '1:937614194042:web:123ac6b0dd5dc5a3b692c3',
};

// 매일 4시 반 알림용 웹 푸시 공개 키 (FIREBASE_SETUP.md 7번: 클라우드 메시징 → 웹 푸시 인증서). 공개돼도 괜찮다
window.FIREBASE_VAPID = '';

// 사진 읽기 AI 서버 주소 (AI_SETUP.md). 넣어 두면 앱에서는 가족 코드만 넣으면 된다.
// 주소만으로는 쓸 수 없다 (가족 코드가 맞아야 서버가 받는다).
window.AI_URL = window.AI_URL || '';
