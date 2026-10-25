# 행운 추첨 🎁

큐알로 참가자 명단을 받고, 룰렛이나 이름 뽑기로 선물을 나눠 주는 웹앱입니다.
**가입·비밀번호 없이 누구나** 사이트에 들어와 자기 행사를 만들고 추첨합니다.
Cloudflare Pages(무료) + D1 데이터베이스에서 돌아갑니다.

## 쓰는 법

1. **행사 만들기** — 사이트에 들어가 행사 이름과 선물·당첨 인원을 넣습니다. 예: 치킨 기프티콘 3명, 에어팟 1명.
   - 만든 브라우저에 그 행사의 **진행자 키**가 저장됩니다. 키가 없는 사람은 명단을 보거나 추첨할 수 없습니다.
   - 다른 기기에서 진행하려면 ⚙️ 설정 → **진행자 링크 복사**를 그 기기에서 엽니다.
2. **📱 큐알 등록** — 큐알을 **큰 화면으로 띄우기**(빔프로젝터)하거나 **큐알 이미지 저장**으로 인쇄합니다.
   - 참가자는 휴대폰 카메라로 찍고 이름(같은 이름이 있으면 반·소속 같은 구분)만 넣습니다.
   - 명단이 진행자 화면에 바로바로 늘어납니다. 같은 휴대폰은 한 번만 등록됩니다.
   - 휴대폰 없는 사람은 **직접 넣기**. 다 모이면 **등록 마감**.
3. **🎡 추첨** — 선물을 고르고 **🎡 룰렛** 또는 **🎰 이름 뽑기**로 **뽑기!**
   - 당첨자는 서버가 공정하게(암호용 난수) 뽑고, 화면은 그 사람에게 멈추는 연출입니다.
   - 한 번 당첨된 사람은 다시 뽑히지 않습니다. 정한 인원이 다 차면 다음 선물로 넘어갑니다.
   - 당첨자가 자리에 없으면 **자리에 없음 · 명단에서 빼기** 뒤 다시 뽑습니다.
   - 당첨된 참가자의 휴대폰에는 "🎉 당첨!" 화면이 바로 뜹니다.
4. **🏆 결과** — 선물별 당첨자, 당첨자·참가자 명단을 엑셀(CSV)로 받습니다.

90일이 지난 행사는 자동으로 지워집니다.

## 배포하기 (Cloudflare 화면에서, 비밀 값 없이)

**1. 데이터베이스 만들기**
Cloudflare → **Storage & Databases → D1 → Create** → 이름 `lucky-draw`. (표는 앱이 알아서 만듭니다.)

**2. Pages 프로젝트를 GitHub에 연결**
**Workers & Pages → Create → Pages → Connect to Git** → 이 저장소 선택 →

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | (비워 두기) |
| Build output directory | `public` |
| Root directory (Advanced) | `lucky-draw` |

**3. 데이터베이스 연결**
그 Pages 프로젝트 → **Settings → Bindings → Add → D1 database** → Variable name `DB`, 데이터베이스 `lucky-draw`.
그다음 **Deployments**에서 최근 배포의 **Retry deployment**를 누르면 끝입니다.
이후로는 main에 올라가는 대로 자동 배포됩니다.

> 이미 GitHub 연결 없이 만든 Pages 프로젝트(예: `lucky-draw`)는 나중에 GitHub로 바꿀 수 없어서, 새 프로젝트를 만들어야 합니다.
> 그 주소를 그대로 쓰려면 아래 GitHub Actions 방법을 씁니다.

### 다른 방법: GitHub Actions로 올리기

저장소 **Settings → Secrets and variables → Actions**에 `CLOUDFLARE_API_TOKEN`(권한: Cloudflare Pages 편집, D1 편집)과
`CLOUDFLARE_ACCOUNT_ID`를 넣고 **Actions → "행운 추첨 올리기" → Run workflow**.
데이터베이스 만들기, 연결, 올리기를 한 번에 합니다. 기존 GitHub 연결 없는 프로젝트(`lucky-draw`)에도 올라갑니다.

## 내 컴퓨터에서 해 보기

```sh
cd lucky-draw
npm install
npm run dev   # http://localhost:8788 (로컬 데이터베이스를 알아서 씀)
```

## 파일

| 파일 | 내용 |
|---|---|
| `public/admin.html`, `admin.js` | 진행자 화면 (행사·큐알·추첨·결과·설정). `/`, `/login`도 여기로 옵니다 |
| `public/join.html`, `join.js` | 참가자 등록 화면 (큐알로 여는 곳) |
| `public/common.js`, `style.css` | 같이 쓰는 도구, 진행자 키 보관, 꽃가루, 소리, 디자인 |
| `public/vendor/qrcode.js` | 큐알 만들기 ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT) |
| `functions/api/[[path]].js` | 서버 (행사, 등록, 추첨, 표 만들기) |
