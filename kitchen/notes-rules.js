// 밥상 한마디 거르기 규칙 — 화면(kitchen.js)과 서버(worker/src/index.js)가 같은 파일을 쓴다.
// 서버가 최종 판단 (화면 검사는 미리 알려 주는 용도). 낱말을 더하려면 아래 목록에 넣는다.
export const NOTE_MAX = 100;     // 한마디 최대 글자 수
export const REPLY_MAX = 50;     // 한 줄 답하기 최대 글자 수
export const NAME_MAX = 10;      // 이 안에서 불릴 이름 최대 글자 수
export const NOTE_DAYS = 60;     // 한마디가 보이는 날 수 (지나면 서버에서 지움)
export const REPLY_DAY_LIMIT = 10; // 같은 사람 하루 답 개수
export const NOTE_DAY_LIMIT = 3; // 같은 사람 하루 개수
export const REPORT_HIDE = 3;    // 신고가 이만큼 모이면 숨김

// 쓸 수 없는 낱말 (띄어쓰기·기호를 빼고 비교)
const WORDS = [
  // 회사 금지어
  '수입', '보너스', '직급', '스폰서', '소득',
  // 광고·돈·연락처 유도
  '광고', '홍보', '판매', '구매', '할인', '쿠폰', '문의', '부업', '재택', '투자', '코인', '대출', '수익', '입금', '송금', '계좌', '통장',
  '카톡', '카카오톡', '오픈채팅', '오픈톡', '텔레그램', '디엠', '인스타', '팔로우', '맞팔', '링크', '사이트', '주소',
  // 욕설·성적인 말 (기본 목록)
  '시발', '씨발', '씨빨', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새', '새끼', '좆', '존나', 'ㅈㄴ', '지랄', '미친놈', '미친년', '꺼져', '닥쳐',
  '섹스', '야동', 'fuck', 'shit', 'bitch', 'sex',
];

const RE_LINK = /(https?:|www\.|[a-z0-9-]+\.(com|net|kr|co|me|ly|io|org|xyz|site|shop|link|app|gg|to|tv)\b)/i;
const RE_EMAIL = /[^\s@]+@[^\s@]+/;
const RE_AT = /[@＠]\s*[a-z0-9._]{2,}/i;
const RE_DIGITS = /\d[\d\s\-.]{5,}\d/;     // 숫자 7개 이상 이어짐 (전화·계좌)
const RE_KNUM = /(공일공|일공공|영일영)/;   // 숫자를 글자로 쓴 전화번호

// 결과: { ok: true, text } 또는 { ok: false, why: 'short' | 'long' | 'contact' | 'word' }
export function checkNote(raw, max = NOTE_MAX, min = 2) {
  const text = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...text].length < min) return { ok: false, why: 'short' };
  if ([...text].length > max) return { ok: false, why: max === NAME_MAX ? 'nameLong' : max === REPLY_MAX ? 'replyLong' : 'long' };
  if (RE_LINK.test(text) || RE_EMAIL.test(text) || RE_AT.test(text) || RE_DIGITS.test(text) || RE_KNUM.test(text)) return { ok: false, why: 'contact' };
  const flat = text.toLowerCase().replace(/[\s.,!?~^*_\-+=/\\|'"`:;()[\]{}<>·…♡♥]/g, '');
  for (const w of WORDS) if (flat.includes(w)) return { ok: false, why: 'word' };
  return { ok: true, text };
}
// 이름 (입장 화면): 1~10자, 한마디와 같은 거르기
export function checkName(raw) { const r = checkNote(raw, NAME_MAX, 1); if (!r.ok && r.why === 'short') r.why = 'nameShort'; return r; }

export const NOTE_WHY = {
  short: '두 글자 이상 남겨 주세요.',
  long: NOTE_MAX + '자 안으로 남겨 주세요.',
  replyLong: REPLY_MAX + '자 안으로 답해 주세요.',
  nameLong: '이름은 ' + NAME_MAX + '자 안으로 적어 주세요.',
  nameShort: '불릴 이름을 적어 주세요.',
  contact: '링크·전화번호·이메일·계좌·아이디는 남길 수 없어요.',
  word: '이 말은 남길 수 없어요. 다른 말로 남겨 주세요.',
  limit: '오늘은 한마디를 다 남기셨어요. 내일 또 남겨 주세요.',
  replyLimit: '오늘은 답을 많이 남기셨어요. 내일 또 나눠 주세요.',
  closed: '지금은 한마디를 받지 않아요. 잠시 뒤에 다시 해 주세요.',
  fail: '잠깐 연결이 안 돼요. 조금 뒤에 다시 눌러 주세요.',
};
