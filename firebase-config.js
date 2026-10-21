// Firebase 웹 앱 설정. FIREBASE_SETUP.md 6번에서 복사한 값을 넣는다.
// 이 값은 공개돼도 괜찮다 (접근 권한은 firestore.rules가 지킨다).
// null이면 동기화 없이 이 기기에만 저장한다.
window.FIREBASE_CONFIG = null;

// 사진 읽기 AI 서버 주소 (AI_SETUP.md). 넣어 두면 앱에서는 가족 코드만 넣으면 된다.
// 주소만으로는 쓸 수 없다 (가족 코드가 맞아야 서버가 받는다).
window.AI_URL = window.AI_URL || '';
