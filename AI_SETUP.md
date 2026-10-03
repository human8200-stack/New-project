# 사진 읽기 AI 연결 (Claude 밖에서 쓸 때)

앱을 **Claude 안에서 열면** 따로 설정할 필요가 없습니다. Claude가 사진을 읽습니다.

GitHub 주소(https://human8200-stack.github.io/New-project/)처럼 **Claude 밖에서 열 때** 사진을 읽으려면,
우리 집 전용 작은 서버가 하나 필요합니다. 이 서버가 Claude API 키를 대신 들고 있어서, 앱에는 키가 남지 않습니다.

## 비용

- Claude API는 쓴 만큼 냅니다. 사진 몇 장을 한 번 정리하는 데 보통 수십 원 정도입니다.
- 서버(Cloudflare Workers)는 이 정도 사용량이면 무료입니다.

## 1. Claude API 키 만들기

1. https://platform.claude.com 에 가입하고 결제 수단을 등록합니다. 월 사용 한도를 낮게(예: 5달러) 정해 두면 안심입니다.
2. **API Keys → Create Key**로 키를 만들고 복사해 둡니다. 이 키는 비밀번호처럼 다른 사람에게 보여 주지 마세요.

## 2. 서버 올리기 (컴퓨터에서 한 번)

컴퓨터에 Node.js가 있어야 합니다.

```bash
cd worker
npm install
npx wrangler login                       # Cloudflare 계정으로 로그인 (없으면 무료 가입)
npx wrangler secret put ANTHROPIC_API_KEY   # 1번에서 복사한 키 붙여넣기
npx wrangler secret put FAMILY_CODE         # 우리 집만 아는 코드 (예: 아무 영어+숫자 12자리)
npx wrangler deploy
```

마지막 줄이 끝나면 `https://study-ai.○○○.workers.dev` 같은 주소가 나옵니다.

## 3. 앱에 넣기

앱 → 더보기 → 설정 → **AI 연결**에 2번에서 나온 주소와 가족 코드를 넣고 저장합니다.
(동기화를 켰다면 다른 기기에도 함께 들어갑니다.)

## 안전

- 가족 코드가 맞지 않는 요청은 서버가 거절합니다.
- `worker/wrangler.toml`의 `ALLOWED_ORIGIN`이 앱 주소만 허용합니다.
- 사진은 정리하는 데만 쓰이고 서버에 저장되지 않습니다.
