// 메종에델 장보기 — 페이지가 요리와 재료를 읽는 단 한 곳
// 원본은 회사 요리 목록 표와 재료 표 (주소는 이 파일에 적지 않음 — 이 파일은 공개 페이지와 같이 나감)
// 규칙: 요리 블록은 MAISON_EDEL_DISHES 에서 만든다. 순서 숫자가 클수록 위(최신 요리가 맨 위).
//       번호는 EP 번호와 같은 숫자(EP.03 → 3)이고 한 번 정하면 바꾸지 않는다. 페이지 주소 + #번호 로 열면 그 요리가 펼쳐진다.
//       쿠팡 링크가 비어 있거나 보이기가 꺼진 재료는 페이지에 보이지 않는다.
//       재료의 "요리"는 요리 목록의 "요리" 이름과 똑같아야 한다.
//       묶음: 같은 요리에서 숫자가 같은 재료끼리 "둘 중 하나"로 한 줄에 보인다 (재료 표 "또는 묶음" 칸). 없으면 따로.
// 마지막 반영: 2026-11-18 (요리 7개, 재료 27개 중 보이기 26개, 쿠팡 링크 26개, 둘 중 하나 묶음 3개)
window.MAISON_EDEL_DISHES = [
  { 번호: 7, 요리: "오븐 없이 굽는 올리브 포카치아", EP: "EP.07", 영어: "Olive Focaccia", 사진: "사진/작은-올리브포카치아.jpg", 소개: "오븐 없이 팬 하나로 굽는, 올리브를 콕콕 박은 포카치아예요.", 순서: 7 },
  { 번호: 6, 요리: "토마토 솥밥", EP: "EP.06", 영어: "Tomato Pot Rice", 사진: "사진/작은-토마토솥밥.jpg", 소개: "토마토와 곰국 블럭으로 밥을 짓고 쪽파를 얹는 솥밥이에요.", 순서: 6 },
  { 번호: 5, 요리: "크림 카레 당면", EP: "EP.05", 영어: "Cream Curry Glass Noodles", 사진: "사진/작은-크림카레당면.jpg", 소개: "넓은 당면에 고형 카레와 우유로 부드러운 크림 카레를 입혀요.", 순서: 5 },
  { 번호: 4, 요리: "에그 단호박 스타터", EP: "EP.04", 영어: "Egg Kabocha Starter", 사진: "사진/작은-에그단호박.jpg", 소개: "속을 파낸 미니 단호박에 달걀을 넣고 치즈를 얹어 쪄 내는 브런치예요.", 순서: 4 },
  { 번호: 3, 요리: "마약계란",         EP: "EP.03", 영어: "Soy Marinated Eggs",      사진: "사진/작은-마약계란.jpg", 소개: "달걀 10개와 간장·물·물엿 70ml씩이면 시작할 수 있어요.", 순서: 3 },
  { 번호: 2, 요리: "보리 버섯 리조또", EP: "EP.02", 영어: "Barley Mushroom Risotto", 사진: "사진/작은-리조또.jpg",   소개: "쌀 대신 보리로, 표고버섯 향이 깊은 리조또예요.",         순서: 2 },
  { 번호: 1, 요리: "카라멜 사과 케이크", EP: "EP.01", 영어: "Caramel Apple Cake", 사진: "사진/작은-사과케이크.jpg", 소개: "껍질째 썬 사과에 카라멜을 입혀 뒤집어 내는 케이크예요.", 순서: 1 }
];

window.MAISON_EDEL_SHOP = [
  { 요리: "오븐 없이 굽는 올리브 포카치아", 이름: "유기농 통밀 강력분", 링크: "https://link.coupang.com/a/iLHxoJejjE", 보이기: true, 순서: 1 },
  { 요리: "오븐 없이 굽는 올리브 포카치아", 이름: "씨 없는 올리브", 링크: "https://link.coupang.com/a/iLHBSQ0b6W", 보이기: true, 순서: 2 },
  { 요리: "오븐 없이 굽는 올리브 포카치아", 이름: "생 로즈마리", 링크: "https://link.coupang.com/a/iLHDKuwpuE", 보이기: true, 순서: 3 },
  { 요리: "오븐 없이 굽는 올리브 포카치아", 이름: "드라이 이스트", 링크: "https://link.coupang.com/a/iLHLvMMRHg", 보이기: true, 순서: 4 },
  { 요리: "토마토 솥밥", 이름: "토마토", 링크: "https://link.coupang.com/a/iw5ZuTd8o0", 보이기: true, 순서: 1 },
  { 요리: "토마토 솥밥", 이름: "유기농 호주산 소고기 다짐", 링크: "https://link.coupang.com/a/iw52lbAdX2", 보이기: true, 순서: 2 },
  { 요리: "크림 카레 당면", 이름: "넓은 당면", 링크: "https://link.coupang.com/a/iw5yyYuIAS", 보이기: true, 순서: 1 },
  { 요리: "크림 카레 당면", 이름: "고형 카레", 링크: "https://link.coupang.com/a/iw5CO6OrS0", 보이기: true, 순서: 2 },
  { 요리: "크림 카레 당면", 이름: "독일 수제 비엔나", 링크: "https://link.coupang.com/a/iw5OYScYnI", 보이기: true, 순서: 3 },
  { 요리: "에그 단호박 스타터", 이름: "미니 단호박", 링크: "https://link.coupang.com/a/istqpP7ZhQ", 보이기: true, 순서: 1 },
  { 요리: "에그 단호박 스타터", 이름: "달걀", 링크: "https://link.coupang.com/a/ilZ4Rb8p7Q", 보이기: true, 순서: 2 },
  { 요리: "에그 단호박 스타터", 이름: "피자치즈", 링크: "https://link.coupang.com/a/istGroiSbs", 보이기: true, 순서: 3 },
  { 요리: "에그 단호박 스타터", 이름: "바질가루", 링크: "https://link.coupang.com/a/istZqSoNCm", 보이기: true, 순서: 4 },
  { 요리: "마약계란", 이름: "달걀", 링크: "https://link.coupang.com/a/ilZ4Rb8p7Q", 보이기: true, 순서: 1 },
  { 요리: "마약계란", 이름: "간장", 링크: "", 보이기: false, 순서: 2 },
  { 요리: "마약계란", 이름: "물엿", 링크: "https://link.coupang.com/a/il3Wbr8fQW", 보이기: true, 순서: 3, 묶음: 2 },
  { 요리: "마약계란", 이름: "알룰로스", 링크: "https://link.coupang.com/a/il3Yuq8C9Q", 보이기: true, 순서: 3, 묶음: 2 },
  { 요리: "보리 버섯 리조또", 이름: "보리쌀", 링크: "https://link.coupang.com/a/il4bpUGMP6", 보이기: true, 순서: 1 },
  { 요리: "보리 버섯 리조또", 이름: "표고버섯", 링크: "https://link.coupang.com/a/il4iJkpoHc", 보이기: true, 순서: 2 },
  { 요리: "보리 버섯 리조또", 이름: "생크림", 링크: "https://link.coupang.com/a/imxAD0C1AG", 보이기: true, 순서: 3 },
  { 요리: "보리 버섯 리조또", 이름: "파마산 치즈", 링크: "https://link.coupang.com/a/imxgPRpYLQ", 보이기: true, 순서: 4 },
  { 요리: "카라멜 사과 케이크", 이름: "사과", 링크: "https://link.coupang.com/a/il3uyUeQLI", 보이기: true, 순서: 1 },
  { 요리: "카라멜 사과 케이크", 이름: "무염버터", 링크: "https://link.coupang.com/a/il3Muxy25Q", 보이기: true, 순서: 2 },
  { 요리: "카라멜 사과 케이크", 이름: "박력분", 링크: "https://link.coupang.com/a/il2Zk8W03E", 보이기: true, 순서: 3, 묶음: 1 },
  { 요리: "카라멜 사과 케이크", 이름: "박력 쌀가루", 링크: "https://link.coupang.com/a/il3k1Dn9YO", 보이기: true, 순서: 3, 묶음: 1 },
  { 요리: "카라멜 사과 케이크", 이름: "설탕", 링크: "https://link.coupang.com/a/imwa69tpKu", 보이기: true, 순서: 4, 묶음: 4 },
  { 요리: "카라멜 사과 케이크", 이름: "알룰로스", 링크: "https://link.coupang.com/a/imwkMfIaXI", 보이기: true, 순서: 4, 묶음: 4 }
];
