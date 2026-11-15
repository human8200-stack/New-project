// 장소 목록 — 부엌의 배경·소품·소리·카드를 여기 한 곳에서 바꾼다.
// 쓰는 장소: DEFAULT_PLACE. 다른 장소 미리보기: 주소 끝에 ?place=tuscany · ?place=paris
// 규칙: 글자·로고·상표 없음 (냄비·병·그릇 모두 무지). 진짜 장소 사진을 붙이지 않고 색과 모양으로만 그린다.
//
// 칸 설명
//  title      장소 이름 (화면에는 안 나옴. 기록용)
//  cards      오늘의 한 그릇 카드 파일 (cards/ 폴더)
//  wall       벽 · color · texture: 'plaster'(회벽) | 'stone'(돌벽) | 'tile'(흰 타일) · lower: 아래쪽 벽판 색(없으면 null) · timber: 나무 기둥·인방 색(없으면 null)
//  floor      바닥 · texture: 'maru'(넓은 나무 마루) | 'wood'(좁은 나무 마루) | 'terracotta'(붉은 타일) | 'checker'(흑백 바둑판 타일) · color: 바탕색
//  ceiling    천장 색 · beams: 들보 모양 'round'(통나무 서까래) | 'square'(네모 들보) | null · beam: 들보 색
//  table      긴 식탁 나무 색 · counter / counterTop: 벽 쪽 조리대 몸통·윗판 색 · marble: 윗판을 대리석 무늬로 (true/false)
//  window     창 · style: 'hanji'(창호지 격자 창) | 'shutter'(덧문 창) | 'arch'(아치 창) · frame: 창틀 색 · shutter: 덧문 색
//             outside: 창밖 그림 'courtyard'(장독대 마당·감나무) | 'vineyard'(포도밭·올리브 나무·사이프러스 언덕) | 'street'(골목 건물·가로등)
//  pot        가운데 큰 냄비 (로고·상표 없음) · kind: 'gamasot'(무쇠 가마솥, 나무 뚜껑) | 'stockpot'(스테인리스 큰 냄비) | 'copper'(구리 냄비)
//             body / lid / knob 색 · food: 다 됐을 때 냄비 안 음식 색 · bowl: 나눠 담는 그릇 색
//  props      소품 이름 목록 (kitchen.js 의 PROPS 에 있는 것만):
//             hearth(아궁이와 가마솥) · jangdok(장독 몇 개) · bowlShelf(그릇 선반) · garlic(마늘 엮음) · herbs(말린 허브 다발)
//             copperPans(벽에 건 구리 팬) · oliveJar(올리브기름 항아리·병) · breadBoard(빵 도마) · breadBaskets(빵 바구니)
//             cakeStand(케이크 받침) · plants(화분) · rug(깔개) · shelfJars(병 선반)
//  rug        깔개 색 (props 에 rug 가 있을 때)
//  lamp       천장 등 빛 색 · lampKind: 'paper'(한지 등) | 'iron'(쇠 등) | 'glass'(유리 등)
//  label      화면 왼쪽 위에 보이는 장소 이름 (짧게)
//  plate      문패: style(모양 — 디자인팀 시안 자리, 지금은 모두 'wood') · title(큰 글자) · sub(아래 작은 줄, 없으면 '') — 누르면 쏠 인스타그램
//  local      진짜 장소 느낌: city(도시 이름) · tz(시간대 — 현지 시각·창밖 밝기 계산) · lat/lon(날씨 — Open-Meteo, 키 없음·무료)
//  greets     인사 버튼 3개 말 (첫 번째는 장소 말). 서버는 글자가 아니라 번호(0~2)만 주고받음
//  stamp      도장 수첩 그림 (그림 문자 하나) · stampColor: 도장 색
//  staff      그 부엌의 주인·일꾼 연출 캐릭터 (손님 아님 · 사람 수에 안 셈 · 이름표 = 역할 이름)
//             role(이름표) · owner(true = 부엌 주인 쏠: 밥 되면 부름, 상 가운데 자리) · look(옷·머리 — 쏠은 시안 1 전용 몸: top · skirt · collar(깃) · goreum · apron · apronString · hairKind 'jjok'|'bob' · hat · scarf · feet) · act(정해진 동작: host 국자 들고 살피기 · fire 불 보기 | greens 나물 다듬기 | knead 반죽 치대기 | basket 바구니 들고 오가기 | pipe 크림 짜기)
//             at: [x, z, 바라보는 방향] · path: 오가는 길 [x1, x2] (basket 만) · outside: 창밖에 서 있음
//             pose: 'sit'(seatH 높이에 앉음) · prep: 앞에 작은 작업대 · 작업대 위 소품 'greens' | 'dough' | 'cake'
//             look 칸: top(윗옷) · apron(앞치마 색, null 이면 없음) · apronKind('front' 서양 앞치마 | 'hanbok' 한복 치마 앞치마) · hair · hairKind('jjok' 쪽진머리·비녀 | 'sangtu' 상투 | 'bun' 올림머리 | 'short' | 'bob') · hat('gat' 검은 갓 | 'toque' 제빵사 모자 | 'beret' | 'straw' 밀짚모자 | 'scarf' 두건 | null) · gray(흰머리)
//  yard       부엌 앞 마당 (식탁 앞쪽 땅). color: 땅 색 · null 이면 바닥 그대로
//  jobs       일거리 자리 (첫 번째는 늘 식탁 "요리하기"). 손님이 [일거리]에서 고르면 그 자리로 바로 옮김 (걷지 않음). 화면을 톡 누를 때마다 동작·소리 한 번
//             name(목록 이름) · who(사람 수 문구 "○○ 사람 3") · tap(가운데 버튼 글자) · icon · act(동작) · sound(sfx.js 소리) · pose('stand' | 'sit' | 'crouch') · seatH(앉는 높이)
//             act: chop 칼질 · trim 다듬기 · wash 씻기 · scrub 문질러 닦기 · fire 불 지피기 · pick 따기 · knead 치대기 · roll 밀대 · pipe 크림 짜기 · lift 꺼내기·들기 · hang 널기
//             prop: 자리 소품 { kind, x, z, ... } (kitchen.js JOB_PROPS) · slots: 손님이 서는 곳 [x, z, 바라보는 방향] (모자라면 화면에 안 보이고 숫자만 셈)
//             fx: 톡 할 때 튀는 조각 { color, at: [x, y, z] }
//  callLine   밥이 되면 주인 캐릭터가 부르는 말 · meal: 상 차림 색 { rice(밥·주식), soup(국), sides: [반찬 3] }
//  guest      손님 옷 (장소를 바꾸면 옷도 바뀜). outfit: 'hanbok'(저고리 + 치마 또는 바지 + 짧은 앞치마 · 쪽 차림 = 치마 + 쪽진머리, 갓 차림 = 바지 + 상투 + 갓 — 입장 화면에서 고름, 기본 무작위) | 'linen'(린넨 옷) | 'baker'(흰 제빵복)
//             tops(윗옷 색들) · bottoms(치마·바지 색들) · aprons(앞치마 색들) · hat('straw' 밀짚모자 | 'toque' 제빵사 모자 | null) — 손님마다 색이 다름
//             연출 캐릭터 look 칸도 같은 이름: skirt(긴 치마 색) · pants(바지 색) · goreum(고름 색) · apronKind('front' 가슴 앞치마 | 'short' 허리 앞치마)
//  layout     'courtyard' 이면 상자 방 대신 마당형 장면 (court: 마루 높이·색, noteBoard: 한마디 판 자리, miel: 미엘 길). 없으면 방
//  sound      simmer: 냄비 끓는 소리 크기(0~1) · day / night: 창밖 소리 'birds' | 'crickets' | null
// 둥글게 둘러앉는 자리 n개 (가운데를 봄)
function ring(cx, cz, r, n, a0 = 0) { const out = []; for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; out.push([x, z, Math.atan2(cx - x, cz - z)]); } return out; }
export const PLACES = {
  hanok: {
    title: '한옥 종갓집 부엌',
    label: '한옥 종갓집 부엌',
    guest: { outfit: 'hanbok', tops: ['#fbe3e8', '#e3f0fb', '#fdf3d6', '#e6f4e1', '#efe4f7', '#fde9dc'], bottoms: ['#f6b8c6', '#a9cbe8', '#f3d27a', '#a9d6a0', '#c9b3e6', '#f4b59a'], aprons: ['#fffaf0', '#f6f0e4'], hat: null }, plate: { style: 'wood', title: 'SOLL BUEOK', sub: '쏠키친 · 쏠의 부엌' },
    callLine: '밥 됐어요~~~', meal: { kind: 'bangsang', rice: '#fbf8f0', soup: '#c98d4a', sides: ['#6fae4a', '#d9473a', '#e8c56a', '#f1e2b0', '#8a5a3a'] }, // 놋그릇 반상: 주발(뚜껑)·국그릇·반찬 접시 5
    staff: [
      { role: '쏠', owner: true, act: 'host', at: [0, -5.15, 0], look: { top: '#E6F0DA', skirt: '#F7CFD3', collar: '#9DB3D3', goreum: '#EBA0A0', apron: '#FFF3DF', apronString: '#E7A496', hairKind: 'jjok', hat: null, feet: '#EBA0A0' } }, // 부엌 주인 (디자인팀 시안 1 · 안경 없음). 대청마루 앞 디딤돌에서 손님 맞이. "밥 됐어요~~~"를 부름
      { role: '종갓집 할머니', act: 'fire', at: [8.75, 1.95, 0.9], look: { top: '#f4efe4', skirt: '#7a3b3b', goreum: '#7a3b3b', apron: '#efe6d2', apronKind: 'short', hair: '#d9d6d0', hairKind: 'jjok', hat: null } },
      { role: '막내 며느리', act: 'greens', at: [-8.4, 1.95, 0], pose: 'sit', seatH: 0.32, look: { top: '#fdf0d6', skirt: '#a9b8a5', goreum: '#d98a6a', apron: '#fffaf0', apronKind: 'short', hair: '#2a2320', hairKind: 'jjok', hat: null } },
    ],
    local: { city: '안동', tz: 'Asia/Seoul', lat: 36.57, lon: 128.73 },
    greets: ['진지 드셨어요?', '맛있게 드세요', '잘 먹었습니다'],
    stamp: '🍚', stampColor: '#b5452f',
    cards: './cards/hanok.js',
    // 대갓집 ㄷ자 한옥 마당 (kitchen.js buildCourtyard): 세 면 모두 긴 대청마루·툇마루(좌식 긴 상·꽃무늬 방석) + 가운데 멍석·교자상 2줄 + 가장자리 일거리
    layout: 'courtyard',
    court: {
      maruH: 0.45, grass: '#7f9a55', stone: '#a49c8e', plaster: '#f1ece2', earth: '#c9ab84', wood: '#9a6a40', woodDark: '#5e3e24', tile: '#4a4c50', lantern: '#ffd99a', mountains: ['#b7834f', '#9a6a3f', '#6f6a3e', '#8d5a3a'],
      inner: 10.4, back: -9.6, mainFront: -5.9, wingDepth: 3.5, front: 10.2, // 마당 안쪽 반 폭 · 뒤 벽 z · 본채 마루 앞 z · 날개채 마루 깊이 · 앞 담장 z
      // 상: cx·cz 가운데 · axis 상이 놓인 방향 · offs 자리 간격 · floor 'maru'(마루 위) | 'ground'(멍석 위) · len 상 길이
      tables: [
        { id: 'main', cx: 0, cz: -7.75, axis: 'x', offs: [-3.6, -2.7, -1.8, -0.9, 0.9, 1.8, 2.7, 3.6], floor: 'maru', len: 8.6, pot: true },
        { id: 'left', cx: -12.15, cz: 0.6, axis: 'z', offs: [-1.8, -0.9, 0, 0.9, 1.8], floor: 'maru', len: 4.8 },
        { id: 'right', cx: 12.15, cz: 0.6, axis: 'z', offs: [-1.8, -0.9, 0, 0.9, 1.8], floor: 'maru', len: 4.8 },
        { id: 'feast1', cx: 0, cz: 0.8, axis: 'x', offs: [-1.35, -0.45, 0.45, 1.35], floor: 'ground', len: 3.9 },
        { id: 'feast2', cx: 0, cz: 3.4, axis: 'x', offs: [-1.35, -0.45, 0.45, 1.35], floor: 'ground', len: 3.9 },
      ],
      mat: { x: 0, z: 2.1, w: 7.2, d: 5.2 }, // 멍석
    },
    noteBoard: { x: 0, y: 1.0, z: -9.56 },
    miel: [[-5.5, -4.3], [0, -4.7], [5.5, -4.3], [6.2, 1.5], [5.4, 5.6], [0, 6.0], [-4.6, 5.0]],
    wall: { color: '#efe3cc', texture: 'plaster', lower: null, timber: '#7a5434' },
    floor: { texture: 'maru', color: '#c69a66' },
    ceiling: { color: '#e9dbc0', beams: null, beam: '#6e4a2c' },
    table: '#8a5a32', counter: '#cdb38a', counterTop: '#a98a60', marble: false,
    window: { style: 'hanji', frame: '#6e4a2c', shutter: null, outside: 'courtyard' },
    pot: { kind: 'gamasot', body: '#2d2b2a', lid: '#8a5e3a', knob: '#5e3e24', food: '#f6f1e4', bowl: '#c9a45a' },
    props: [],
    rug: null,
    lamp: '#ffe4b8', lampKind: 'paper',
    sound: { simmer: 0.75, day: 'birds', night: 'crickets' },
    yard: null,
    // 일거리 순서 (회장님 11/15): 전 부치기 · 파 다듬기 · 나물 다듬기 · 고추 따기 · 채소 씻기 · 밥 짓기 · 불 지피기 · 설거지 (맨 앞 '요리하기'는 대청마루 큰 상)
    jobs: [
      { id: 'table', name: '요리하기 (대청마루 큰 상)', who: '요리하는', tap: '도마 톡', icon: '🔪', act: 'chop', sound: 'tok' },
      { id: 'jeon', name: '전 부치기 (솥뚜껑 번철)', who: '전 부치는', tap: '전 부치기', icon: '🥞', act: 'flip', sound: 'sizzle', pose: 'crouch',
        prop: { kind: 'griddle', x: -6.4, z: 6.7 }, slots: ring(-6.4, 6.7, 1.0, 6, -Math.PI / 2), fx: { color: '#e9c46a', at: [-6.4, 0.6, 6.7] } },
      { id: 'pa', name: '파 다듬기 (평상)', who: '파 다듬는', tap: '파 다듬기', icon: '🧅', act: 'trim', sound: 'pluck', pose: 'sit', seatH: 0.32,
        prop: { kind: 'platform', x: -2.6, z: 8.0, item: 'pa' }, slots: [[-3.25, 8.0, Math.PI / 2], [-1.95, 8.0, -Math.PI / 2], [-2.9, 7.6, 0.4], [-2.3, 7.6, -0.4], [-2.6, 8.45, Math.PI]], fx: { color: '#9fcf6a', at: [-2.6, 0.6, 8.0] } },
      { id: 'namul', name: '나물 다듬기 (평상)', who: '나물 다듬는', tap: '다듬기', icon: '🌿', act: 'trim', sound: 'pluck', pose: 'sit', seatH: 0.32,
        prop: { kind: 'platform', x: -8.4, z: 2.4, item: 'greens' }, slots: [[-9.05, 2.4, Math.PI / 2], [-7.75, 2.4, -Math.PI / 2], [-8.4, 2.85, Math.PI], [-8.85, 2.85, 2.4], [-7.95, 2.85, -2.4]], fx: { color: '#6fae4a', at: [-8.4, 0.6, 2.4] } },
      { id: 'pepper', name: '고추 따기 (마당 텃밭)', who: '고추 따는', tap: '고추 따기', icon: '🌶️', act: 'pick', sound: 'pluck', pose: 'stand',
        prop: { kind: 'garden', x: 3.0, z: 8.0, fruit: '#d23a2a', shape: 'chili' }, slots: [[2.1, 7.1, 0], [3.0, 7.1, 0], [3.9, 7.1, 0], [2.5, 8.95, Math.PI], [3.5, 8.95, Math.PI]], fx: { color: '#d23a2a', at: [3.0, 0.7, 8.0] } },
      { id: 'wash', name: '채소 씻기 (우물가 대야)', who: '채소 씻는', tap: '씻기', icon: '🥬', act: 'wash', sound: 'splash', pose: 'crouch',
        prop: { kind: 'well', x: -8.9, z: 5.6, wellAt: [-9.6, 7.4] }, slots: [[-8.9, 5.1, 0], [-9.4, 5.6, Math.PI / 2], [-8.4, 5.6, -Math.PI / 2], [-8.9, 6.1, Math.PI]], fx: { color: '#9fd0e6', at: [-8.9, 0.3, 5.6] } },
      { id: 'rice', name: '밥 짓기 (부엌칸 쌀 씻기)', who: '밥 짓는', tap: '쌀 씻기', icon: '🍚', act: 'scrub', sound: 'splash', pose: 'stand',
        prop: { kind: 'riceStand', x: 9.0, z: 5.1 }, slots: [[8.45, 5.1, Math.PI / 2], [8.6, 5.65, 2.1], [8.6, 4.55, 1.0]], fx: { color: '#f6f1e4', at: [9.0, 0.8, 5.1] } },
      { id: 'fire', name: '불 지피기 (아궁이)', who: '불 지피는', tap: '불 지피기', icon: '🔥', act: 'fire', sound: 'crackle', pose: 'crouch',
        prop: { kind: 'hearthYard', x: 9.45, z: 3.0 }, slots: [[8.55, 2.75, Math.PI / 2], [8.55, 3.3, Math.PI / 2], [8.6, 3.85, 2.0]], fx: { color: '#ffa64a', at: [8.95, 0.3, 3.0] } },
      { id: 'dish', name: '설거지 (돌 개수대)', who: '설거지하는', tap: '뽀득뽀득', icon: '🍽️', act: 'scrub', sound: 'clink', pose: 'stand',
        prop: { kind: 'trough', x: 6.3, z: 8.3 }, slots: [[6.3, 7.8, 0], [5.7, 8.3, Math.PI / 2], [6.9, 8.3, -Math.PI / 2]], fx: { color: '#dff1f8', at: [6.3, 0.55, 8.3] } },
    ],
  },
  tuscany: {
    title: '토스카나 농가 부엌',
    label: '토스카나 농가 부엌',
    guest: { outfit: 'linen', tops: ['#ece4d4', '#e2e8d6', '#f1e6d4', '#e4ddd0', '#dde6ea', '#efe0d6'], bottoms: ['#8c8270', '#a39a86'], aprons: ['#f4efe2', '#d9c9a8', '#c8d3b8'], hat: 'straw' }, plate: { style: 'wood', title: 'SOLL KITCHEN · 쏠키친', sub: '' },
    callLine: 'A tavola~~~ 밥 됐어요!', meal: { rice: '#f2d27a', soup: '#c8553a', sides: ['#6fae4a', '#d49a58', '#f4efe2'] },
    staff: [
      { role: '쏠', owner: true, act: 'host', at: [0.35, -2.3, 0], look: { top: '#CFE0C8', apron: '#FFF3DF', apronString: '#E7A496', hairKind: 'bob', hat: 'straw' } }, // 부엌 주인 (디자인팀 시안 1 · 안경 없음). "밥 됐어요~~~"를 부름
      { role: '논나', act: 'knead', at: [-2.2, -2.5, 0], prep: 'dough', look: { top: '#3f4a63', skirt: '#3f4a63', apron: '#fbf7ee', apronKind: 'front', hair: '#d9d6d0', hairKind: 'bun', hat: null } },
      { role: '농부 아저씨', act: 'basket', at: [2.45, -4.7, 0], path: [1.7, 3.2], outside: true, look: { top: '#8a9f6a', apron: null, apronKind: 'front', hair: '#5a3e2b', hairKind: 'short', hat: 'straw' } },
    ],
    local: { city: '토스카나', tz: 'Europe/Rome', lat: 43.32, lon: 11.33 },
    greets: ['Buon appetito!', '맛있게 드세요', '잘 먹었습니다'],
    stamp: '🫒', stampColor: '#5f7550',
    cards: './cards/tuscany.js',
    wall: { color: '#e4cba2', texture: 'stone', lower: null, timber: null },
    floor: { texture: 'terracotta', color: '#b5623d' },
    ceiling: { color: '#eedfc2', beams: 'square', beam: '#5a3b24' },
    table: '#77492a', counter: '#d9c4a2', counterTop: '#b8a37f', marble: false,
    window: { style: 'shutter', frame: '#6b5034', shutter: '#5f7550', outside: 'vineyard' },
    pot: { kind: 'stockpot', body: '#c9cdd1', lid: '#bcc1c6', knob: '#2e2a27', food: '#c8553a', bowl: '#e8d9bf' },
    props: ['copperPans', 'garlic', 'herbs', 'oliveJar', 'breadBoard', 'plants'],
    rug: null,
    lamp: '#ffe2b5', lampKind: 'iron',
    sound: { simmer: 0.7, day: 'birds', night: 'crickets' },
    yard: null,
    jobs: [
      { id: 'table', name: '요리하기', who: '요리하는', tap: '도마 톡', icon: '🔪', act: 'chop', sound: 'tok' },
      { id: 'olive', name: '올리브 따기', who: '올리브 따는', tap: '올리브 따기', icon: '🫒', act: 'pick', sound: 'pluck', pose: 'stand',
        prop: { kind: 'tree', x: 3.2, z: 3.25, fruit: '#6e7a34', leaf: '#8f9f7c' }, slots: [[2.45, 2.65, 0.5], [3.95, 2.65, -0.5], [3.2, 4.0, Math.PI]], fx: { color: '#6e7a34', at: [3.2, 1.6, 3.25] } },
      { id: 'grape', name: '포도 따기', who: '포도 따는', tap: '포도 따기', icon: '🍇', act: 'pick', sound: 'pluck', pose: 'stand',
        prop: { kind: 'vine', x: -3.2, z: 3.2 }, slots: [[-3.9, 2.75, 0.3], [-2.55, 2.75, -0.3], [-3.2, 3.95, Math.PI]], fx: { color: '#6a3f7a', at: [-3.2, 1.7, 3.2] } },
      { id: 'knead', name: '반죽 치대기', who: '반죽 치대는', tap: '치대기', icon: '🫓', act: 'knead', sound: 'thump', pose: 'stand',
        prop: null, slots: [[-2.75, -1.98, Math.PI / 2], [-1.65, -1.98, -Math.PI / 2]], fx: { color: '#f1e2c2', at: [-2.2, 0.8, -1.98] } },
      { id: 'oven', name: '화덕 불 지피기', who: '화덕 불 지피는', tap: '불 지피기', icon: '🔥', act: 'fire', sound: 'crackle', pose: 'crouch',
        prop: { kind: 'oven', x: 3.95, dome: true }, slots: [[3.45, -2.4, Math.PI], [4.15, -2.4, Math.PI]], fx: { color: '#ffa64a', at: [3.95, 0.5, -2.9] } },
      { id: 'herb', name: '허브 따기 (창가 화분)', who: '허브 따는', tap: '허브 따기', icon: '🌱', act: 'pick', sound: 'pluck', pose: 'stand',
        prop: null, slots: [[-3.55, -2.8, Math.PI], [-2.95, -2.85, Math.PI]], fx: { color: '#6f9a5c', at: [-3.0, 1.45, -3.85] } },
      { id: 'pasta', name: '파스타 널기', who: '파스타 너는', tap: '널기', icon: '🍝', act: 'hang', sound: 'swish', pose: 'stand',
        prop: { kind: 'rack', x: 0, z: 3.3 }, slots: [[-0.6, 2.75, 0], [0.6, 2.75, 0], [0, 3.95, Math.PI]], fx: { color: '#f2d27a', at: [0, 1.2, 3.3] } },
    ],
  },
  paris: {
    title: '파리 골목 빵집 부엌',
    label: '파리 골목 빵집',
    guest: { outfit: 'baker', tops: ['#fbfbf7', '#f7f5ef'], bottoms: ['#5b5f6a', '#3f4a52'], aprons: ['#fbfbf7', '#f3dfe4', '#dfe9f3', '#f1ead8'], hat: 'toque' }, plate: { style: 'wood', title: 'SOLL KITCHEN · 쏠키친', sub: '' },
    callLine: '빵 나왔어요~~~', meal: { rice: '#e9b46a', soup: '#f3dcc0', sides: ['#d8344a', '#f4efe2', '#c98a4a'] },
    staff: [
      { role: '쏠', owner: true, act: 'host', at: [0.35, -2.3, 0], look: { top: '#CFE0C8', apron: '#FFF3DF', apronString: '#E7A496', hairKind: 'bob', hat: 'toque', scarf: '#E59A93' } }, // 부엌 주인 (디자인팀 시안 1 · 안경 없음). "밥 됐어요~~~"를 부름
      { role: '파티시에', act: 'pipe', at: [-2.2, -2.5, 0], prep: 'cake', look: { top: '#fbfbf7', apron: '#fbfbf7', apronKind: 'front', hair: '#7a5236', hairKind: 'short', hat: 'toque' } },
      { role: '빵집 견습생', act: 'basket', at: [0.8, -3.05, 0], path: [-1.2, 3.0], look: { top: '#f4efe4', apron: '#8a6a4a', apronKind: 'front', hair: '#a0764c', hairKind: 'bob', hat: 'beret' } },
    ],
    local: { city: '파리', tz: 'Europe/Paris', lat: 48.86, lon: 2.35 },
    greets: ['Bon appétit!', '맛있게 드세요', '잘 먹었습니다'],
    stamp: '🥐', stampColor: '#3f5a8a',
    cards: './cards/paris.js',
    wall: { color: '#f4efe6', texture: 'tile', lower: null, timber: null },
    floor: { texture: 'checker', color: '#efeae0' },
    ceiling: { color: '#f6f1e8', beams: null, beam: '#6b5a4a' },
    table: '#9a6b45', counter: '#e9e4dc', counterTop: '#f2efea', marble: true,
    window: { style: 'arch', frame: '#3f4a52', shutter: null, outside: 'street' },
    pot: { kind: 'copper', body: '#c27a4a', lid: '#c98656', knob: '#3a2a22', food: '#f1d49a', bowl: '#f4f1ea' },
    props: ['breadBaskets', 'cakeStand', 'copperPans', 'shelfJars', 'plants'],
    rug: null,
    lamp: '#fff0d4', lampKind: 'glass',
    sound: { simmer: 0.6, day: 'birds', night: null },
    yard: null,
    jobs: [
      { id: 'table', name: '요리하기', who: '요리하는', tap: '도마 톡', icon: '🔪', act: 'chop', sound: 'tok' },
      { id: 'roll', name: '반죽 밀기 (대리석 작업대)', who: '반죽 미는', tap: '밀기', icon: '🥖', act: 'roll', sound: 'thump', pose: 'stand',
        prop: { kind: 'rollingPin', x: -3.7 }, slots: [[-4.15, -2.8, Math.PI], [-3.45, -2.8, Math.PI]], fx: { color: '#f1e2c2', at: [-3.7, 1.0, -3.6] } },
      { id: 'cream', name: '크림 짜기', who: '크림 짜는', tap: '크림 짜기', icon: '🍰', act: 'pipe', sound: 'swish', pose: 'stand',
        prop: null, slots: [[-2.75, -1.98, Math.PI / 2], [-1.65, -1.98, -Math.PI / 2]], fx: { color: '#fffaf2', at: [-2.2, 0.9, -1.93] } },
      { id: 'oven', name: '오븐에서 빵 꺼내기', who: '빵 꺼내는', tap: '꺼내기', icon: '🥐', act: 'lift', sound: 'pop', pose: 'stand',
        prop: { kind: 'oven', x: 3.95, dome: false }, slots: [[3.45, -2.45, Math.PI], [4.25, -2.45, Math.PI]], fx: { color: '#d49a58', at: [3.95, 0.9, -2.9] } },
      { id: 'fruit', name: '과일 씻기', who: '과일 씻는', tap: '씻기', icon: '🍓', act: 'wash', sound: 'splash', pose: 'stand',
        prop: { kind: 'standBasin', x: -3.1, z: 3.1, fruit: '#d8344a' }, slots: [[-3.1, 2.6, 0], [-3.7, 3.1, Math.PI / 2], [-2.5, 3.1, -Math.PI / 2]], fx: { color: '#9fd0e6', at: [-3.1, 0.9, 3.1] } },
      { id: 'dish', name: '그릇 닦기', who: '그릇 닦는', tap: '뽀득뽀득', icon: '🍽️', act: 'scrub', sound: 'clink', pose: 'stand',
        prop: { kind: 'dishTable', x: 0, z: 3.2 }, slots: [[-0.55, 2.7, 0], [0.55, 2.7, 0], [0, 3.8, Math.PI]], fx: { color: '#f4f1ea', at: [0, 0.9, 3.2] } },
      { id: 'basket', name: '빵 바구니 나르기', who: '바구니 나르는', tap: '나르기', icon: '🧺', act: 'lift', sound: 'thump', pose: 'stand',
        prop: { kind: 'basketStand', x: 3.1, z: 3.2 }, slots: [[2.45, 2.7, 0.4], [3.75, 2.7, -0.4], [3.1, 3.85, Math.PI]], fx: { color: '#d49a58', at: [3.1, 0.9, 3.2] } },
    ],
  },
};
export const DEFAULT_PLACE = 'hanok';
export const PLACE_ORDER = ['hanok', 'tuscany', 'paris']; // 도장 수첩·다른 부엌 목록 순서 (worker/src/index.js 의 PLACES 와 같게)
