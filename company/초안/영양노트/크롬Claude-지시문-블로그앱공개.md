# 크롬 Claude 지시문 — 블로그 글쓰기 앱 넷리파이에 공개 (회장님 11/11 "일단 한번 써보자")

너는 회장님 크롬에서 일하는 Claude야. app.netlify.com 에서 **새 사이트 1개만** 만든다. 기존 사이트(maison-edel 등)는 건드리지 않는다. 결제·유료 요금제 버튼은 누르지 않는다(무료 Starter 그대로). 로그인 화면이 나오면 멈추고 회장님께 묻는다. **비밀 값(API 키)은 네가 넣지 않는다** — 그 칸에서 멈추고 회장님께 넘긴다.

## 1. 새 사이트 만들기
- app.netlify.com → "Add new site" → "Import an existing project" → GitHub → 저장소 **human8200-stack/New-project** 선택(목록에 없으면 "Configure the Netlify app on GitHub"에서 이 저장소 허용 — 회장님 GitHub 화면이면 멈추고 회장님께 "허용 눌러 주세요").
- Branch to deploy: `claude/focus-90days`
- Base directory: `company/초안/영양노트/블로그앱`
- Build command: 비움 / Publish directory: `public` (README·netlify.toml에 적힌 값이 다르면 netlify.toml 값 그대로) / Functions directory: `netlify/functions`
- Site name(주소): `noma-note` (안 되면 `noma-blog`) → 주소 noma-note.netlify.app
- "Deploy" 누르기.

## 2. 환경 변수 (Site configuration → Environment variables)
- `ACCESS_CODES` = 회장님이 정한 접속 코드(회장님께 직접 입력 부탁. 채팅에 쓰지 말라고 안내)
- `ANTHROPIC_API_KEY` = 회장님이 console.anthropic.com 에서 만든 키(회장님께 직접 붙여 넣기 부탁)
- 둘 다 넣은 뒤 "Deploys" → "Trigger deploy" → "Deploy site".

## 끝나면
- 회장님께: "블로그 앱 주소: https://(사이트이름).netlify.app" 한 줄. 막힌 곳이 있으면 어디서 멈췄는지.
