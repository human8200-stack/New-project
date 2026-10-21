# 사진 읽기(AI)와 아이패드·휴대폰 동기화

둘은 따로입니다.

| | 누가 | 돈 |
|---|---|---|
| **사진 읽기·핵심 카드 (AI)** | 쓰는 집마다 각자 Claude API 키 | 각자 쓴 만큼 (사진 몇 장 정리에 보통 수십 원) |
| **기기 동기화** | 한 집(부모님)이 서버를 한 번 올리면 친구도 같이 씀 | 무료 (Cloudflare 무료 사용량 안) |

## A. 사진 읽기: 각자 API 키 넣기 (5분)

Claude API 계정은 만 18세 이상만 만들 수 있어서, 각 집 부모님이 만듭니다.

1. https://platform.claude.com 에 가입하고 **Billing**에서 결제 수단을 등록하거나 충전합니다.
2. **Limits**에서 월 사용 한도를 낮게(예: 10달러) 정해 두면 안심입니다.
3. **API Keys → Create Key**로 키를 만들고 복사합니다. `sk-ant-`로 시작합니다.
4. 아이 기기에서 앱 → 설정(톱니바퀴) → **AI 연결**에 붙여 넣고 **저장**.
   아이패드와 휴대폰에 각각 넣습니다. 키는 그 기기에만 저장되고, 동기화 서버로도 넘어가지 않습니다.

키가 새어 나가면 platform.claude.com → API Keys에서 그 키를 지우고 새로 만들면 됩니다.

## B. 기기 동기화: 서버 한 번 올리기 (부모님 한 집만, 10분)

컴퓨터 없이 휴대폰 Safari로 할 수 있습니다. 링크는 누르지 말고 Safari 주소창에 직접 입력하세요 (누르면 GitHub 앱이 열릴 수 있어요).

1. https://dash.cloudflare.com/sign-up 에서 무료로 가입합니다.
2. 메뉴(☰) → **Workers & Pages**를 한 번 엽니다. 처음이면 서버 주소에 쓸 영어 이름을 정하라고 나옵니다.
3. 같은 화면의 **Account ID**를 복사해 둡니다.
4. 사람 아이콘 → **My Profile → API Tokens → Create Token** → **Edit Cloudflare Workers** 옆 **Use template** →
   **Continue to summary → Create Token** → 나온 토큰을 복사해 둡니다.
5. `github.com/human8200-stack/New-project/settings/secrets/actions` → **New repository secret**으로 세 개를 넣습니다.

   | Name | Secret |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 4번의 토큰 |
   | `CLOUDFLARE_ACCOUNT_ID` | 3번의 Account ID |
   | `FAMILY_CODE` | 앱을 쓰는 사람들만 아는 코드. 영어+숫자 12자리쯤 (예: `gunpo2026study`) |

6. Claude에게 "넣었어"라고 하면 서버를 올리고 주소를 앱에 넣어 드립니다.
   직접 하려면 `github.com/human8200-stack/New-project/actions/workflows/deploy-ai.yml` → **Run workflow**.

### 기기 연결

1. **첫 기기(아이패드)**: 설정 → **아이패드 · 휴대폰 동기화**에 가족 코드를 넣고 저장 → 연결 코드(예: `p5v9-kq7k-5cvx-y69w`)가 생깁니다.
2. **둘째 기기(휴대폰)**: 같은 가족 코드를 넣고 저장 → **다른 기기의 코드 넣기**에 1번의 연결 코드 → **연결**.
   다른 기기에서 고친 것은 앱을 열 때, 그리고 켜 둔 동안 2분마다 받아 옵니다.
3. **친구**: 가족 코드만 알려 주면 됩니다. 친구 기기에는 친구 것 연결 코드가 따로 생겨서 기록이 섞이지 않습니다.

## 안전

- 가족 코드가 맞지 않는 요청은 서버가 거절합니다. `worker/wrangler.toml`의 `ALLOWED_ORIGIN`이 앱 주소만 허용합니다.
- 연결 코드를 아는 사람만 그 기록을 볼 수 있으니, 가족 밖으로 보내지 마세요.
- 오답 사진은 기기끼리 맞추려고 그 연결 코드의 기록에만 저장됩니다.

## (선택) 서버가 AI도 맡게 하기

각자 키를 넣지 않고 서버 키 하나로 모두 쓰게 하려면, 5번에 `ANTHROPIC_API_KEY`(Claude API 키)도 넣고 서버를 다시 올립니다.
그러면 키를 넣지 않은 기기는 서버의 AI를 쓰고, 그 사용료는 서버 키 계정으로 나갑니다.

## 컴퓨터로 올리기 (Node.js가 있을 때)

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create study-ai-sync   # 나온 id를 wrangler.toml의 SYNC_NAMESPACE_ID 자리에
npx wrangler secret put FAMILY_CODE
npx wrangler deploy
```

`vendor/anthropic-sdk.mjs`는 앱이 브라우저에서 Claude API를 부를 때 쓰는 `@anthropic-ai/sdk` 묶음입니다. SDK를 올렸으면 `cd worker && npm run build:sdk`로 다시 만듭니다.
