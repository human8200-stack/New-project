// 엄마의 영양 노트 블로그 — 글 규칙 한 곳 (화면의 규칙 검사기와 서버의 AI 지시문이 같이 씀)
//
// 기준: company/초안/건강계정-계획.md 7장, company/초안/블로그-계획.md 5장 4번·7번, company/회장님.md 영양 노트 줄들
// 여기 표를 고치면 AI 지시문(netlify/lib/prompt.mjs)과 화면 검사기(app.js)가 같이 바뀌어요.
// 주의: 아래 글 안에 ` (백틱) 글자를 쓰지 마세요.
//
// ★ 영양소 표: 식약처 고시형 건강기능식품 기능성 문장을 "~해요" 말끝으로만 바꿔 적은 것.
//   - 질병 이름이 들어간 문장(예: 비타민D·칼슘의 "골다공증발생 위험 감소")은 일부러 넣지 않았어요 (병 이름·예방 단정 금지 규칙).
//   - 표 전체는 품질관리팀이 식약처 원문(건강기능식품 기능성 원료 고시)과 한 번 대조해야 해요.
//   - 표에 없는 영양소는 글에 쓰면 "확인 필요"로 빨갛게 표시돼요.

export const RULES_VERSION = "1.0 (2026-11-11)";

export const DISCLAIMER = "진단·치료를 대신하지 않아요. 치료 중이면 담당 의사와 먼저.";
export const FOOD_FIRST = "음식으로 골고루 먼저 챙겨요. 개인차가 있어요. 약을 드시는 중이면 의사·약사와 먼저 상담해요.";
export const BETA = "베타카로틴으로 챙기면 좋아요. 몸이 필요한 만큼 비타민A로 바꿔서 써요. 그래서 비타민A가 몸에 쌓일 걱정이 적어요.";
export const SMOKER = "흡연 중이면 베타카로틴 영양제는 의사·약사와 먼저 상담해요.";
export const WARFARIN = "피를 묽게 하는 약(와파린 등)을 드시는 분은 비타민K 음식·영양제의 양을 갑자기 바꾸지 말고 담당 의사·약사와 먼저 상담해요.";
export const OMEGA_NOTE = "피를 묽게 하는 약이나 혈압약을 드시는 중이면 의사·약사와 먼저 상담해요.";
export const SAVE_LINE = "저장해 두고 필요할 때 꺼내 보세요. 오늘도 한 장씩, 같이 공부해요.";
export const HANMADI_SLOT = "[회장님 한 줄]";
export const DEFAULT_SOURCE = "건강 강의를 공부하며 정리한 노트";
export const DEFAULT_TAGS = "#엄마의영양노트 #영양노트";

// name: 글에 쓰는 이름 / alias: 글에서 찾을 이름 / say: 쓸 수 있는 문장(이것만) / foods: 많은 음식 / must: 같이 꼭 넣을 문장
export const NUTRIENTS = [
  { name: "비타민A (베타카로틴)", alias: ["비타민A", "비타민 A", "베타카로틴"], say: ["어두운 곳에서 시각 적응을 위해 필요해요.", "피부와 점막을 형성하고 기능을 유지하는 데 필요해요.", "상피세포의 성장과 발달에 필요해요."], foods: "당근·단호박·시금치·고구마(베타카로틴), 달걀노른자", must: [BETA, SMOKER] },
  { name: "비타민D", alias: ["비타민D", "비타민 D"], say: ["칼슘과 인이 흡수되고 이용되는 데 필요해요.", "뼈의 형성과 유지에 필요해요."], foods: "고등어·연어 같은 생선, 달걀노른자, 햇볕에 말린 버섯" },
  { name: "비타민E", alias: ["비타민E", "비타민 E"], say: ["항산화 작용을 하여 유해산소로부터 세포를 보호하는 데 필요해요."], foods: "견과·씨앗, 식물성 기름" },
  { name: "비타민K", alias: ["비타민K", "비타민 K"], say: ["정상적인 혈액응고에 필요해요.", "뼈의 구성에 필요해요."], foods: "시금치·브로콜리·깻잎 같은 푸른 잎채소, 청국장", must: [WARFARIN] },
  { name: "비타민B1", alias: ["비타민B1", "비타민 B1", "티아민"], say: ["탄수화물과 에너지 대사에 필요해요."], foods: "돼지고기, 통곡물, 콩" },
  { name: "비타민B2", alias: ["비타민B2", "비타민 B2", "리보플라빈"], say: ["체내 에너지 생성에 필요해요."], foods: "우유, 달걀, 버섯" },
  { name: "나이아신", alias: ["나이아신", "비타민B3", "비타민 B3"], say: ["체내 에너지 생성에 필요해요."], foods: "닭고기, 생선, 땅콩" },
  { name: "판토텐산", alias: ["판토텐산", "비타민B5", "비타민 B5"], say: ["지방, 탄수화물, 단백질 대사와 에너지 생성에 필요해요."], foods: "달걀, 버섯, 통곡물" },
  { name: "비타민B6", alias: ["비타민B6", "비타민 B6"], say: ["단백질 및 아미노산 이용에 필요해요.", "혈액의 호모시스테인 수준을 정상으로 유지하는 데 필요해요."], foods: "생선, 닭고기, 바나나, 감자" },
  { name: "비오틴", alias: ["비오틴", "비타민B7", "비타민 B7"], say: ["지방, 탄수화물, 단백질 대사와 에너지 생성에 필요해요."], foods: "달걀노른자, 견과, 콩" },
  { name: "엽산", alias: ["엽산", "비타민B9", "비타민 B9"], say: ["세포와 혈액 생성에 필요해요.", "태아 신경관의 정상 발달에 필요해요.", "혈액의 호모시스테인 수준을 정상으로 유지하는 데 필요해요."], foods: "시금치 같은 푸른 잎채소, 콩, 브로콜리" },
  { name: "비타민B12", alias: ["비타민B12", "비타민 B12"], say: ["정상적인 엽산 대사에 필요해요."], foods: "생선, 조개, 달걀, 고기" },
  { name: "비타민C", alias: ["비타민C", "비타민 C"], say: ["결합조직 형성과 기능유지에 필요해요.", "철의 흡수에 필요해요.", "항산화 작용을 하여 유해산소로부터 세포를 보호하는 데 필요해요."], foods: "파프리카, 브로콜리, 귤, 키위" },
  { name: "칼슘", alias: ["칼슘"], say: ["뼈와 치아 형성에 필요해요.", "신경과 근육 기능 유지에 필요해요.", "정상적인 혈액응고에 필요해요."], foods: "우유·치즈, 멸치, 두부, 푸른 잎채소" },
  { name: "마그네슘", alias: ["마그네슘"], say: ["에너지 이용에 필요해요.", "신경과 근육 기능 유지에 필요해요."], foods: "견과, 콩, 통곡물, 푸른 잎채소" },
  { name: "철", alias: ["철분", "철"], say: ["체내 산소운반과 혈액생성에 필요해요.", "에너지 생성에 필요해요."], foods: "붉은 살코기, 조개, 콩, 시금치" },
  { name: "아연", alias: ["아연"], say: ["정상적인 면역기능에 필요해요.", "정상적인 세포분열에 필요해요."], foods: "굴, 소고기, 콩, 견과" },
  { name: "구리", alias: ["구리"], say: ["철의 운반과 이용에 필요해요.", "유해산소로부터 세포를 보호하는 데 필요해요."], foods: "견과, 콩, 통곡물" },
  { name: "셀레늄", alias: ["셀레늄", "셀렌"], say: ["유해산소로부터 세포를 보호하는 데 필요해요."], foods: "생선, 달걀, 통곡물" },
  { name: "요오드", alias: ["요오드"], say: ["갑상선 호르몬의 합성에 필요해요.", "에너지 생성에 필요해요.", "신경 발달에 필요해요."], foods: "미역, 다시마, 김" },
  { name: "망간", alias: ["망간"], say: ["뼈 형성에 필요해요.", "에너지 이용에 필요해요.", "유해산소로부터 세포를 보호하는 데 필요해요."], foods: "통곡물, 견과, 콩" },
  { name: "몰리브덴", alias: ["몰리브덴"], say: ["산화·환원 효소의 활성에 필요해요."], foods: "콩, 통곡물" },
  { name: "칼륨", alias: ["칼륨"], say: ["체내의 물과 전해질 균형에 필요해요."], foods: "바나나, 감자, 시금치, 콩" },
  { name: "크롬", alias: ["크롬"], say: ["체내 탄수화물, 지방, 단백질 대사에 관여해요."], foods: "통곡물, 브로콜리, 고기" },
  { name: "식이섬유", alias: ["식이섬유"], say: ["배변활동 원활에 도움을 줄 수 있어요."], foods: "채소, 통곡물, 콩, 해조류" },
  { name: "단백질", alias: ["단백질"], say: ["근육, 결합조직 등 신체조직의 구성성분이에요.", "효소, 호르몬, 항체의 구성에 필요해요.", "체내 필수 영양성분이나 활성물질의 운반과 저장에 필요해요.", "체액, 산-염기의 균형 유지에 필요해요.", "에너지, 포도당, 지질의 합성에 필요해요."], foods: "생선, 달걀, 두부, 살코기" },
  { name: "프로바이오틱스", alias: ["프로바이오틱스"], say: ["유산균 증식과 유해균 억제, 배변활동 원활, 장 건강에 도움을 줄 수 있어요."], foods: "김치·요구르트 같은 발효 음식" },
  { name: "프락토올리고당", alias: ["프락토올리고당"], say: ["장내 유익균의 증식과 배변활동 원활에 도움을 줄 수 있어요."], foods: "양파, 마늘, 우엉, 바나나" },
  { name: "오메가3 (EPA·DHA)", alias: ["오메가3", "오메가 3", "오메가-3", "EPA", "DHA"], say: ["혈중 중성지질 개선과 혈행 개선에 도움을 줄 수 있어요.", "건조한 눈을 개선하여 눈 건강에 도움을 줄 수 있어요."], foods: "고등어·연어 같은 등푸른 생선", must: [OMEGA_NOTE] },
  { name: "루테인", alias: ["루테인"], say: ["노화로 인해 감소될 수 있는 황반색소밀도를 유지하여 눈 건강에 도움을 줄 수 있어요."], foods: "시금치·케일 같은 푸른 잎채소, 달걀노른자" }
];

// 표에 없는 이름이라 쓰면 "확인 필요"로 보여 줄 것들 (자주 나오는 이름만)
const UNLISTED = ["비타민B군", "비타민 B군", "비타민U", "비타민 U", "콜라겐", "글루타치온", "코엔자임", "코큐텐", "NMN", "커큐민", "강황", "폴리페놀", "안토시아닌", "라이코펜", "효소제", "소화효소", "발효효소", "효소 음료", "포스트바이오틱스", "프리바이오틱스", "MSM", "글루코사민", "히알루론산", "감마리놀렌산", "밀크씨슬", "홍삼", "쏘팔메토", "크릴오일", "엘라스틴", "케르세틴", "아스타잔틴", "알로에"];

// 빨간 글: 꼭 고칠 것
const RED = [
  { re: /낫는|나아요|나았|낫게|낫습니다|낫는다|완치|예방|치료|특효|병이 사라|병을 이기/g, why: "병이 낫는다·막는다는 단정이에요 (식약처 기능성 문장까지만)" },
  { re: /막아|막는|막을 수|없어져|없어집|없애|사라져|사라집|면역력을?\s?(높|지켜|키워|올려)|낮춰 ?줘|낮춰 ?줍|낮춰요|녹여 ?줘|청소해/g, why: "몸·병을 막거나 없앤다는 단정이에요 (식약처 기능성 문장까지만)" },
  { re: /약\s?(을\s?)?끊|약\s?안\s?먹|이것만 (먹|드시)|의사도 놀란|의사들도 놀란|기적/g, why: "치료 단정·과장 표현이에요" },
  { re: /[가-힣]{1,8}(병|암|염|증)에\s?(효과|좋|특효|도움)/g, why: "\"○○병에 효과\" 같은 병 효과 표현이에요" },
  { re: /효과/g, why: "\"효과\"는 몸·병에 대한 단정으로 읽혀요. 식약처 문장(\"도움을 줄 수 있어요\")으로 바꿔 주세요" },
  { re: /자가\s?진단|진단해/g, why: "\"자가진단\" 대신 \"생활 점검표\"라고 써요" },
  { re: /먹었더니|먹고 나서 (좋아|나아|사라)|끊었더니|효과를 봤|효과 봤|좋아졌어요|사라졌어요/g, why: "치료 체험담처럼 읽혀요 (의료법 56조). 생활 이야기까지만" },
  { re: /영양제|건강기능식품|보충제|부족하면|챙겨 드세요|드셔 보세요|드셔보세요|추천해요|추천드려요|추천합니다|강력 추천|구매|구입|할인/g, why: "영양제·구매 권유로 읽혀요. \"음식으로 골고루 먼저 챙겨요\"로" },
  { re: /https?:\/\/|www\.|\.com|\.kr\b|쿠팡|스마트스토어|네이버쇼핑|쇼핑|링크|최저가/g, why: "링크·쇼핑 이야기는 쓰지 않아요" },
  { re: /암웨이|amway|뉴트리라이트|nutrilite|더블엑스|바디키|아티스트리|에이블팀|able team|에이블/gi, why: "회사·제품 이름이에요" },
  { re: /종근당|고려은단|뉴트리원|센트룸|솔가|나우푸드|얼라이브|GNC|락토핏|정관장|한국인삼공사|유한양행|대웅제약|일양약품|한미약품|동국제약|광동제약|세노비스|뉴트리코어|닥터스베스트|오쏘몰|비타500|요플레|야쿠르트|덴마크우유|매일유업|남양유업|풀무원|CJ|오뚜기|청정원/g, why: "제품·회사·브랜드 이름이에요" },
  { re: /사업|직급|소득|수입|보너스|스폰서|부업|돈 버는|돈을 버는|파트너 모집|다이아몬드|플래티넘/g, why: "사업 이야기·금지어예요" },
  { re: /최고|최상|1위|No\.1|넘버원|100%|무조건|완벽|놀라운|반드시 드/g, why: "과장 표현이에요" },
  { re: /알아보겠습니다|알아볼게요|살펴보겠습니다|살펴볼게요|결론적으로|요약하자면|다양한|에\s?대해|에\s?대한|다음과 같습니다|중요합니다|라고 할 수 있습니다|효과적인|최적의|소개해 드리려고|소개해드리려고/g, why: "AI가 쓴 티가 나는 말이에요" }
];
// 병 이름 (본문은 확인, 제목·태그는 빨간 글)
const DISEASE_RE = /당뇨|고혈압|위암|대장암|유방암|아토피|비염|장누수|과민성|크론|우울증|치매|골다공증|관절염|역류성|위염|장염|변비|비만|지방간|갑상선\s?질환|고지혈|빈혈/g;
// 검은 글: 한 번 더 확인할 것
const CHECK = [
  { re: /좋아져|좋아집|좋아지|개선|강화|높여|높이는|해독|디톡스|정화|나아지/g, why: "몸이 좋아진다는 말처럼 읽힐 수 있어요. 단정이 아닌지 확인해 주세요" },
  { re: DISEASE_RE, why: "병 이름이 있어요. 병이 낫는다·막는다는 뜻으로 읽히지 않는지 확인해 주세요" }
];

// 영양소 이름 옆에 오면 효능 단정이 되는 말 (칸 밖 문장 검사용)
const EFFECT_RE = /도와|도움|돕|좋아|좋은|좋게|지켜|높여|높이|낮춰|낮추|막아|막는|없애|없어|살려|튼튼|깨끗|효과|강하게|채워|빼 ?줘|태워|녹여|청소/;
const SAFE_SENTENCES = [DISCLAIMER, FOOD_FIRST, BETA, SMOKER, WARFARIN, OMEGA_NOTE, SAVE_LINE];

export function norm(s) { return String(s || "").replace(/[\s·,.、!?()（）"'“”‘’\-—–:~*#]/g, ""); }
function core(s) { return norm(s).replace(/(이에요|예요|해요|있어요|있음|요)$/, ""); }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// 글에서 영양소 이름 찾기 (긴 이름 먼저: 비타민B12가 비타민B1으로 잡히지 않게)
const ALIASES = NUTRIENTS.flatMap(n => n.alias.map(a => ({ a, n }))).sort((x, y) => y.a.length - x.a.length);
export function findNutrient(text) {
  const t = String(text || "");
  for (const { a, n } of ALIASES) {
    const re = a === "철" ? /(^|[^가-힣])철(분)?([^가-힣]|$)/ : new RegExp(esc(a) + "(?![0-9])", "i");
    if (re.test(t)) return n;
  }
  return null;
}

// AI 지시문에 넣는 표
export function nutrientTableText() {
  return NUTRIENTS.map(n => "- " + n.name + " | 쓸 수 있는 문장: " + n.say.join(" / ") + " | 많은 음식: " + n.foods + (n.must ? " | 같이 꼭 넣을 문장: " + n.must.join(" / ") : "")).join("\n");
}

function hits(text, list) {
  const out = [];
  list.forEach(r => {
    const found = [...new Set((String(text).match(r.re) || []).map(s => s.trim()).filter(Boolean))];
    if (found.length) out.push("\"" + found.slice(0, 4).join("\", \"") + "\" — " + r.why);
  });
  return out;
}

// 본문에서 【이름】 칸 하나 꺼내기
export function section(body, name) {
  const L = String(body || "").split("\n");
  let i = L.findIndex(l => l.trim().startsWith("【") && l.includes(name));
  if (i < 0) return "";
  const out = [];
  for (i = i + 1; i < L.length; i++) { if (L[i].trim().startsWith("【")) break; out.push(L[i]); }
  return out.join("\n");
}

// 규칙 검사기. post = { titles:[], body:"", tags:"" }, opt = { hanmadi:"" }
// 돌려줌: { red:[꼭 고칠 것], check:[확인할 것] }
export function checkPost(post, opt) {
  opt = opt || {};
  const red = [], check = [];
  const body = String(post.body || "");
  const tags = String(post.tags || "");
  const titles = (post.titles || []).filter(Boolean);
  // 안내 문장(고정 문구)은 빼고 금지어를 찾는다 ("치료 중이면", "영양제" 같은 말이 들어 있어서)
  let scan = [titles.join("\n"), body, tags].join("\n");
  SAFE_SENTENCES.forEach(s => { scan = scan.split(s).join(" "); });
  scan = scan.replace(/진단·치료를 대신하지 않아요\.?/g, " ").replace(/치료 중이면 담당 의사와 먼저[^\n]*/g, " ");
  NUTRIENTS.forEach(n => n.say.forEach(s => { scan = scan.split(s).join(" "); }));
  red.push(...hits(scan, RED));
  const tt = (titles.join(" ") + " " + tags).match(DISEASE_RE);
  if (tt) red.push("\"" + [...new Set(tt)].join("\", \"") + "\" — 제목·태그에는 병 이름을 넣지 않아요");
  check.push(...hits(scan, CHECK));

  // 꼭 들어갈 것
  if (!norm(body).includes(norm(DISCLAIMER))) red.push("안내 문구가 없어요: \"" + DISCLAIMER + "\"");
  if (!/출처\s*[:：]/.test(body)) red.push("출처 한 줄이 없어요 (\"출처: …\")");

  // 챙겨 볼 영양소
  const sec = section(body, "챙겨 볼 영양소");
  if (!sec.trim()) red.push("【챙겨 볼 영양소】 칸이 없어요");
  else {
    if (!norm(sec).includes(norm(FOOD_FIRST))) red.push("영양소 칸 끝에 이 문장이 없어요: \"" + FOOD_FIRST + "\"");
    const used = new Set();
    sec.split("\n").forEach(raw => {
      const line = raw.trim();
      if (!line || /^많은 음식/.test(line) || SAFE_SENTENCES.some(s => norm(line).includes(norm(s)))) return;
      const m = line.match(/^\d+\s*[.)]\s*(.+?)\s*[—–]{1,2}\s*(.+)$/) || line.match(/^\d+\s*[.)]\s*(.+?)\s+-{1,2}\s+(.+)$/);
      if (!m) {
        const n = findNutrient(line);
        if (n) red.push("\"" + line.slice(0, 40) + "\" — 영양소 줄 모양이 달라 식약처 문장인지 확인 못 했어요. \"번호. 이름 — 식약처 문장\" 모양으로 써 주세요");
        return;
      }
      const name = m[1], said = m[2];
      if (/확인 필요/.test(said)) { red.push("\"" + name + "\" — 식약처 문장 표에 없어 확인 필요라고 나왔어요. 확인 전에는 빼 주세요"); return; }
      const n = findNutrient(name);
      if (!n || UNLISTED.some(u => name.replace(/\s/g, "").includes(u.replace(/\s/g, "")))) { red.push("\"" + name + "\" — 앱의 식약처 문장 표에 없는 이름이에요. 확인 필요"); return; }
      used.add(n.name);
      let rest = norm(said);
      let ok = false;
      n.say.forEach(s => { const c = core(s); if (rest.includes(c)) { ok = true; rest = rest.split(c).join(""); } });
      rest = rest.replace(/이에요|예요|해요|있어요|요|또|그리고|에도/g, "");
      if (!ok) red.push("\"" + n.name + "\" 설명이 식약처 문장과 달라요: \"" + said.slice(0, 40) + "\" → 쓸 수 있는 문장: " + n.say.join(" / "));
      else if (rest.length > 4) red.push("\"" + n.name + "\" 줄에 식약처 문장 말고 다른 말이 섞였어요: \"" + said.slice(0, 50) + "\"");
    });
    NUTRIENTS.forEach(n => {
      if (!used.has(n.name)) return;
      (n.must || []).forEach(s => { if (!norm(body).includes(norm(s))) red.push(n.name + "를 쓰면 이 문장을 꼭 넣어요: \"" + s + "\""); });
    });
  }
  // 【챙겨 볼 영양소】 칸 밖에서 영양소 이름과 효능 말이 한 문장에 같이 나오면 빨간 글
  let outside = body;
  if (sec) outside = outside.split(sec).join("\n");
  SAFE_SENTENCES.forEach(x => { outside = outside.split(x).join(" "); });
  outside.split(/(?<=[.!?。])\s+|\n+/).forEach(sent => {
    const n = findNutrient(sent);
    if (n && EFFECT_RE.test(sent)) red.push("\"" + sent.trim().slice(0, 45) + "\" — 영양소 효능은 【챙겨 볼 영양소】 칸의 식약처 문장으로만 써요");
  });
  UNLISTED.forEach(u => { if (scan.includes(u) && !red.some(r => r.includes(u))) check.push("\"" + u + "\" — 앱의 식약처 문장 표에 없는 이름이에요. 기능성 설명을 붙였다면 확인 필요"); });

  // 모양
  if (body.includes(HANMADI_SLOT)) check.push("\"" + HANMADI_SLOT + "\" 자리에 회장님 문장을 한 줄 넣어 주세요 (꾸며 쓰지 않으려고 비워 뒀어요)");
  const n = body.replace(/\s+$/, "").length;
  if (n && (n < 1500 || n > 2400)) check.push("본문이 " + n.toLocaleString("ko-KR") + "자예요 (1,500~2,200자가 좋아요)");
  const long = titles.filter(t => t.length > 30).length;
  if (long) check.push("30자가 넘는 제목이 " + long + "개 있어요 (검색에서 뒤가 잘려요)");
  if (/#비타민\s?B(군|\b|(?![0-9]))/i.test(tags) || /비타민\s?B군/.test(tags)) red.push("태그에 \"비타민B·비타민B군\" 묶음이 있어요. #비타민B1처럼 낱개로 써 주세요");
  const tagN = (tags.match(/#[^\s#]+/g) || []).length;
  if (tags && tagN !== 10) check.push("태그가 " + tagN + "개예요 (10개가 좋아요)");
  const emo = (body.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emo > 1) check.push("이모지가 " + emo + "개 있어요. 회장님 글은 이모지를 거의 쓰지 않아요");
  return { red, check };
}
