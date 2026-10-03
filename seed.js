'use strict';

// 처음 실행할 때 들어가는 과목과 교재. 총량(total)이 null인 자료는 과목 탭에서 입력하면 계획이 정확해진다.
// minPerUnit은 첫 추정치이고, 기록이 쌓이면 실제 속도로 자동 보정된다.

const SEED_SUBJECTS = [
  { key: 'kor', name: '국어', importance: 3 },
  { key: 'math', name: '수학', importance: 5 },
  { key: 'eng', name: '영어', importance: 4 },
  { key: 'soc', name: '통합사회', importance: 3 },
  { key: 'sci', name: '통합과학', importance: 3 },
  { key: 'his', name: '한국사', importance: 3 },
  { key: 'info', name: '정보', importance: 2 },
];

// mode: 'range' = 끝이 있는 분량, 'weekly' = 매주 해야 하는 할당량
// activeBeforeExam: 시험 N일 전부터만 계획에 넣음 (0이면 항상)
const SEED_MATERIALS = [
  { s: 'kor', name: '교과서·학습지', kind: '교과서', unit: '쪽', minPerUnit: 5 },
  { s: 'kor', name: '모의고사', kind: '모의고사', unit: '회', mode: 'weekly', weekly: 2, minPerUnit: 80 },
  { s: 'kor', name: '학원 숙제', kind: '숙제', unit: '문제', mode: 'weekly', weekly: 250, minPerUnit: 1.2 },

  { s: 'math', name: '교과서 개념', kind: '교과서', unit: '쪽', minPerUnit: 6 },
  { s: 'math', name: '쎈 (좋은책신사고)', kind: '문제집', unit: '문제', minPerUnit: 3 },
  { s: 'math', name: '마플시너지 (오답만)', kind: '오답', unit: '문제', minPerUnit: 6 },
  { s: 'math', name: '고쟁이 (이투스북)', kind: '문제집', unit: '문제', minPerUnit: 6 },
  { s: 'math', name: '족보닷컴 군포고 기출', kind: '기출', unit: '회', minPerUnit: 50, activeBeforeExam: 21 },

  { s: 'eng', name: '지문 암기', kind: '지문', unit: '지문', mode: 'weekly', weekly: 7, minPerUnit: 20 },
  { s: 'eng', name: '학원 단어', kind: '단어', unit: '회', mode: 'weekly', weekly: 3, minPerUnit: 20 },
  { s: 'eng', name: '워드마스터', kind: '단어', unit: 'Day', minPerUnit: 20 },
  { s: 'eng', name: '시험 범위 지문 전체 분석', kind: '지문', unit: '지문', total: 20, minPerUnit: 25, activeBeforeExam: 14 },

  { s: 'soc', name: '교과서·PPT 빈칸 암기', kind: '암기', unit: '쪽', minPerUnit: 4 },
  { s: 'soc', name: '기출픽 공통사회2 (비상)', kind: '문제집', unit: '문제', minPerUnit: 1.5 },
  { s: 'soc', name: '족보닷컴 기출', kind: '기출', unit: '회', minPerUnit: 40, activeBeforeExam: 21 },

  { s: 'sci', name: '교과서 빈칸 암기', kind: '암기', unit: '쪽', minPerUnit: 4 },
  { s: 'sci', name: '기출픽 공통과학2 (비상)', kind: '문제집', unit: '문제', minPerUnit: 1.5 },
  { s: 'sci', name: '족보닷컴 기출', kind: '기출', unit: '회', minPerUnit: 40, activeBeforeExam: 21 },

  { s: 'his', name: '교과서 빈칸 암기', kind: '암기', unit: '쪽', minPerUnit: 4 },
  { s: 'his', name: '기출픽 한국사2 (비상)', kind: '문제집', unit: '문제', minPerUnit: 1.5 },
  { s: 'his', name: '족보닷컴 기출', kind: '기출', unit: '회', minPerUnit: 40, activeBeforeExam: 21 },

  { s: 'info', name: '교과서 개념', kind: '교과서', unit: '쪽', minPerUnit: 5 },
  { s: 'info', name: '단권화 노트', kind: '암기', unit: '단원', minPerUnit: 40 },
  { s: 'info', name: '평가문제집 (삼양미디어)', kind: '문제집', unit: '문제', minPerUnit: 2 },
];

function seedState(today, uid) {
  const ids = {};
  const subjects = SEED_SUBJECTS.map((s) => {
    ids[s.key] = uid();
    return {
      id: ids[s.key], name: s.name, importance: s.importance,
      concept: 3, memory: 3, stage: '개념', accuracy: null,
      wrongPending: 0, lastStudied: '', examDate: '', weakNotes: '',
    };
  });
  const materials = SEED_MATERIALS.map((m) => ({
    id: uid(), subjectId: ids[m.s], name: m.name, kind: m.kind, unit: m.unit,
    mode: m.mode || 'range', total: m.total ?? null, done: 0, weekly: m.weekly || 0,
    minPerUnit: m.minPerUnit, activeBeforeExam: m.activeBeforeExam || 0,
    nextRange: '', accuracy: null, archived: false, created: today,
  }));
  return { subjects, materials };
}

if (typeof module !== 'undefined') module.exports = { seedState };
