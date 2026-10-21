# 우리 집 서버: 사진 읽기 + 아이패드·휴대폰 동기화

GitHub 주소(https://human8200-stack.github.io/New-project/)로 쓰는 앱이 **사진을 읽고, 기기끼리 기록을 맞추려면**
우리 집 전용 작은 서버가 하나 필요합니다. 이 서버가 Claude API 키를 대신 들고 있어서 앱에는 키가 남지 않고,
기록은 연결 코드마다 따로 저장됩니다. 이 서버를 쓰면 Firebase 설정은 하지 않아도 됩니다.

**컴퓨터 없이 휴대폰 Safari로 할 수 있습니다.** 약 15분, 한 번만 하면 됩니다.

## 비용

- Claude API는 쓴 만큼 냅니다. 사진 몇 장을 한 번 정리하는 데 보통 수십 원입니다.
- 서버(Cloudflare Workers)와 GitHub는 이 정도 사용량이면 무료입니다.

## 1. Claude API 키 만들기

1. https://platform.claude.com 에 가입하고 **Billing**에서 결제 수단을 등록합니다.
2. **Limits**에서 월 사용 한도를 낮게(예: 10달러) 정해 두면 안심입니다.
3. **API Keys → Create Key**로 키를 만들고 복사해 메모장에 붙여 둡니다. `sk-ant-`로 시작합니다.
   이 키는 비밀번호처럼 다른 사람에게 보여 주지 마세요.

## 2. Cloudflare 가입하고 열쇠 두 개 받기

1. https://dash.cloudflare.com/sign-up 에서 무료로 가입합니다.
2. 왼쪽 메뉴(☰) → **Workers & Pages**를 한 번 엽니다. 처음이면 서버 주소에 쓸 이름(서브도메인)을 정하라고 나옵니다. 아무 영어 이름이나 정합니다.
3. **계정 ID**: Workers & Pages 화면 오른쪽(휴대폰은 아래쪽)에 있는 **Account ID**를 복사해 둡니다.
4. **API 토큰**: 오른쪽 위 사람 아이콘 → **My Profile → API Tokens → Create Token** →
   **Edit Cloudflare Workers** 옆 **Use template** → 맨 아래 **Continue to summary → Create Token** → 나온 토큰을 복사해 둡니다.

## 3. GitHub에 비밀 값 네 개 넣기

Safari 주소창에 직접 입력합니다 (링크를 누르면 GitHub 앱이 열릴 수 있어요):

`github.com/human8200-stack/New-project/settings/secrets/actions`

**New repository secret**을 눌러 아래 네 개를 하나씩 넣습니다. 이름은 글자 그대로 씁니다.

| Name | Secret |
|---|---|
| `ANTHROPIC_API_KEY` | 1번의 Claude API 키 |
| `CLOUDFLARE_API_TOKEN` | 2번의 API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 2번의 계정 ID |
| `FAMILY_CODE` | 우리 집만 아는 코드. 영어+숫자 12자리쯤 (예: `gunpo2026study`) |

비밀 값은 넣은 뒤에는 누구도(저장소 주인도) 다시 볼 수 없고, 서버를 올릴 때만 쓰입니다.

## 4. 서버 올리기

1. Safari에서 `github.com/human8200-stack/New-project/actions/workflows/deploy-ai.yml` 을 엽니다.
2. **Run workflow → Run workflow**를 누릅니다. 1~2분 걸립니다.
3. 초록 체크가 뜨면 눌러서 요약에 나온 **서버 주소**(`https://study-ai.○○○.workers.dev`)를 확인합니다.

Claude에게 "AI 서버 올렸어"라고 하면 주소를 앱에 넣어 드립니다. 그러면 각 기기에서는 가족 코드만 넣으면 됩니다.

## 5. 앱에 넣기

1. **첫 기기(아이패드)**: 앱 → 설정(톱니바퀴) → **AI 연결**에 가족 코드를 넣고 저장합니다.
   위쪽 **아이패드 · 휴대폰 동기화**에 연결 코드(예: `p5v9-kq7k-5cvx-y69w`)가 생깁니다.
2. **둘째 기기(휴대폰)**: 같은 가족 코드를 넣고 저장 → 동기화 칸의 **다른 기기의 코드 넣기**에 1번의 연결 코드를 넣고 **연결**.
   이제 두 기기 기록이 같습니다. 다른 기기에서 고친 것은 앱을 열 때와 켜 둔 동안 2분마다 받아 옵니다.
3. **친구**: 가족 코드만 알려 주면 됩니다. 친구 기기에는 친구 것 연결 코드가 따로 생겨서 기록이 섞이지 않습니다.

## 안전

- 가족 코드가 맞지 않는 요청은 서버가 거절합니다. 친구에게는 가족 코드를 알려 주면 되고, 그 사용료도 이 API 키로 나갑니다.
- `worker/wrangler.toml`의 `ALLOWED_ORIGIN`이 앱 주소만 허용합니다.
- AI에 보낸 사진은 정리하는 데만 쓰이고 저장되지 않습니다. 오답 사진은 기기끼리 맞추려고 그 연결 코드의 기록에만 저장됩니다.
- 연결 코드를 아는 사람만 그 기록을 볼 수 있으니, 가족 밖으로 보내지 마세요.
- 키를 바꾸려면 3번에서 값을 고치고 4번을 다시 누르면 됩니다.

## 컴퓨터로 올리기 (Node.js가 있을 때)

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FAMILY_CODE
npx wrangler deploy
```
