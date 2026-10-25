# 행운 추첨 🎁

큐알로 참가자 명단을 받고, 룰렛이나 이름 뽑기로 선물을 나눠 주는 웹앱입니다.
Cloudflare Pages(무료) + D1 데이터베이스에서 돌아갑니다.

## 쓰는 법

1. **진행자 로그인** — `https://<주소>.pages.dev/login`에서 진행자 비밀번호로 들어갑니다.
2. **행사 만들기** — 행사 이름과 선물(이름·개수)을 넣습니다. 예: 치킨 기프티콘 3개, 에어팟 1개.
3. **📱 큐알 등록** — 큐알을 **큰 화면으로 띄우기**(빔프로젝터)하거나 **큐알 이미지 저장**으로 인쇄합니다.
   - 참가자는 휴대폰 카메라로 찍고 이름(같은 이름이 있으면 반·소속 같은 구분)만 넣으면 됩니다. 로그인은 없습니다.
   - 명단은 진행자 화면에 바로바로 늘어납니다. 같은 휴대폰은 한 번만 등록되고, 다시 넣으면 이름만 고쳐집니다.
   - 휴대폰 없는 사람은 **직접 넣기**로 넣습니다. 다 모이면 **등록 마감**을 켭니다.
4. **🎡 추첨** — 선물을 고르고 **🎡 룰렛** 또는 **🎰 이름 뽑기**로 **뽑기!**
   - 당첨자는 서버가 공정하게(암호용 난수) 뽑고, 화면은 그 사람에게 멈추는 연출입니다.
   - 한 번 당첨된 사람은 다시 뽑히지 않습니다. 선물이 다 나가면 다음 선물로 넘어갑니다.
   - 당첨자가 자리에 없으면 **자리에 없음 · 명단에서 빼기** 뒤 다시 뽑습니다.
   - 당첨된 참가자의 휴대폰에는 "🎉 당첨!" 화면이 바로 뜹니다 (등록 화면을 열어 두면).
5. **🏆 결과** — 선물별 당첨자, 당첨자·참가자 명단을 엑셀(CSV)로 받습니다.

## 올리기 (휴대폰만으로)

저장소 **Settings → Secrets and variables → Actions**에 넣습니다.

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 토큰 (권한: **Cloudflare Pages 편집**, **D1 편집**) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 ID |
| `LUCKY_DRAW_PASSWORD` | 진행자 비밀번호 (길게) |

그다음 **Actions → "행운 추첨 올리기" → Run workflow**. 프로젝트 이름은 기본 `lucky-draw`
(주소 `lucky-draw-4s7.pages.dev`의 프로젝트)입니다. 데이터베이스 만들기, 표 만들기, 비밀번호 넣기, 올리기를 한 번에 합니다.

> 이미 있는 `lucky-draw` 프로젝트가 GitHub와 연결된(Git 연동) 프로젝트라면 직접 올리기가 거절됩니다.
> 그때는 Run workflow에서 프로젝트 이름을 새로 정하면(예: `lucky-draw-app`) 새 주소로 올라갑니다.

## 내 컴퓨터에서 해 보기

```sh
cd lucky-draw
npm install
echo 'ADMIN_PASSWORD=test1234' > .dev.vars
npm run db    # 로컬 데이터베이스에 표 만들기
npm run dev   # http://localhost:8788/login
```

## 파일

| 파일 | 내용 |
|---|---|
| `public/login.html` | 진행자 로그인 |
| `public/admin.html`, `admin.js` | 진행자 화면 (행사·큐알·추첨·결과·설정) |
| `public/join.html`, `join.js` | 참가자 등록 화면 (큐알로 여는 곳) |
| `public/common.js`, `style.css` | 같이 쓰는 도구, 꽃가루, 소리, 디자인 |
| `public/vendor/qrcode.js` | 큐알 만들기 ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT) |
| `functions/api/[[path]].js` | 서버 (로그인, 행사, 등록, 추첨) |
| `schema.sql` | 데이터베이스 표 |
