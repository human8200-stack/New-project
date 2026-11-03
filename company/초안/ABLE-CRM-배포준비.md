# ABLE CRM 배포 준비 (가입 승인제 · 금고 · 복제 방지)

- 결재: 회장님 승인 11/3 (사장 전달) — 결재함 43번
- 코드: 비공개 저장소 `human8200-stack/able-crm`, 브랜치 `claude/lock-and-vault` (커밋 23bc862, 화면 표시 v4.3)
- 지금 공식 앱(main): 커밋 08992f3, v4.2 (10/11 배포판과 같음)
- 공식 주소: https://splendorous-cactus-b8c609.netlify.app
- 품질관리팀: 조건부 통과 (① 회장님 users 문서 확인 + 사람 수 비교 ② 규칙 게시 → 바로 앱 배포 → 모든 폰 앱 완전히 닫았다 다시 열기)
- 이 파일에는 회장님 이메일·UID 같은 값을 쓰지 않는다.

---

## 1장. 지금 넷리파이는 어떻게 올라가나 (운영팀 확인)

| 확인한 것 | 결과 |
|---|---|
| `netlify.toml` | 앱 = `public` 폴더, 빌드 없음, 함수 = `netlify/functions` |
| `설치가이드.md` | "Deploys 탭 맨 아래에 `public` 폴더를 끌어다 놓기" → **끌어다 놓는 방식** |
| GitHub `able-crm` main | 넷리파이 표시(커밋 상태) 0개 → **넷리파이와 아직 연결 안 됨**. 저장소가 11/3에 처음 만들어졌고 앱은 10/11에 올라감 |
| 함수 | `push-daily`(매시간 알림), `push-register`(`/api/push`), `signup-notify`(`/api/signup`, 이번에 새로 생김) |

**결론**: 끌어다 놓기로는 `public`만 올라가서 함수 3개가 안 올라가요. 새 판의 "새 가입 알림"(`/api/signup`)도 안 돌아가요.
→ **추천: 넷리파이 사이트를 GitHub `able-crm`의 main에 연결.** 그 뒤에는 main이 바뀔 때마다 넷리파이가 알아서 올려요.

### 순서를 이렇게 정한 이유

연결하는 순간 넷리파이가 main을 바로 한 번 올려요. 그래서 **연결 = 앱 배포**예요.

1. **(사장 "합쳐" → 운영팀)** `able-crm` main을 `claude/lock-and-vault`로 합쳐요 (앞으로 감기만, 충돌 없음 확인함). 넷리파이가 아직 연결 안 돼 있어서 **이때는 아무것도 안 바뀌어요.**
2. **(회장님 → 노트북 크롬 Claude, 한 번에)** 아래 2장 지시문:
   Firebase 확인 → 회장님 users 문서 → 관리자 표시 → 예전 규칙 복사 → **새 규칙 게시** → 곧바로 **넷리파이 연결 (= 새 앱 배포)**
3. **(회장님 + 파트너)** 모든 폰에서 앱 완전히 닫았다 다시 열기 → 3장 안내문

이렇게 하면 "규칙 게시 → 바로 앱 배포"가 한 자리에서 몇 분 안에 이어져요 (품질관리팀 조건 ②).

- 만약 main을 합치기 **전에** 연결하면: 옛 앱(v4.2)이 다시 올라갈 뿐이라 화면은 그대로예요. 그래도 그 경우 나중에 합치는 순간 새 앱이 올라가서 규칙 게시와 따로 놀게 되니, **합친 뒤에 연결**하는 순서로 해요.
- 규칙 게시와 앱 배포 사이 몇 분 동안: 기존 사용자는 그대로 써요 (상태 칸 없음 = 승인됨). 그 몇 분 사이 옛 앱으로 **새로 가입**하는 사람만 막혀요.

### 사장이 "합쳐" 하기 전에 운영팀이 확인할 것
- [ ] `public/index.html`(287,669바이트), `public/sw.js`(1,623), `public/vault.js`(7,036), `public/rules.js`(37,046) 비어 있지 않음 — 11/3 확인함, 합친 뒤 한 번 더
- [ ] `sw.js` 캐시 이름이 올라가 있음 (`able-crm-v13`) — 폰이 새 판을 받게
- [ ] 합친 뒤 GitHub에서 main 맨 위가 "가입 승인제·카드 정보 금고·복제 방지 표시 추가"인지

---

## 2장. 회장님 → 노트북 크롬 Claude에 붙여 넣을 지시문

**언제**: 회사가 "main 합쳤어요, 붙여 넣으셔도 돼요"라고 말한 뒤에.
**회장님 할 일**: 노트북 크롬에서 Claude를 열고 아래 상자 안 글을 통째로 붙여 넣기. 중간에 비밀번호·인증 코드 화면이 나오면 회장님이 직접 넣기. 끝나면 Claude가 준 "회사에 보낼 보고"를 복사해서 사장에게 붙여 넣기.
**걸리는 시간**: 15~25분 / **돈**: 0원 (Firebase·넷리파이 무료 범위)

````
ABLE CRM 새 판 배포를 도와줘. 아래 순서대로 한 번에 해 줘. 순서를 바꾸지 마.

[꼭 지킬 것]
- 비밀번호, 인증 코드, 결제, 요금제(업그레이드) 화면이 나오면 멈추고 나(회장)에게 넘겨. 직접 넣지 마.
- 아무것도 지우지 마 (문서, 컬렉션, 사용자, 사이트, 배포 기록 모두).
- Firebase는 "able-crm" 프로젝트만, 넷리파이는 "splendorous-cactus-b8c609" 사이트만 건드려. 다른 프로젝트·사이트는 열지도 바꾸지도 마.
- 새 탭에서 작업해. 내가 열어 둔 탭은 건드리지 마.
- 내 이메일·UID 같은 값은 마지막 "회사에 보낼 보고"에 그대로 쓰지 마. "있음/없음", 숫자만 써.
- 아래 "멈춤"이라고 쓴 곳에서 조건이 안 맞으면 다음으로 가지 말고 멈춘 뒤 이유를 알려 줘.

[0] main 확인
- https://github.com/human8200-stack/able-crm/blob/main/public/vault.js 를 열어.
- 파일 내용이 보이면 다음으로. "404"나 "없음"이면 멈춤 (회사가 아직 main을 안 합친 것).

[1] Firebase — 내 계정 UID 찾기
- https://console.firebase.google.com 에서 "able-crm" 프로젝트를 열어.
- 왼쪽 메뉴 Build(빌드) → Authentication → Users(사용자) 탭.
- 내 계정 이메일은 나에게 물어봐. 그 줄의 "사용자 UID"를 복사해 둬 (아래에서 계속 씀).
- 이 표의 전체 사람 수도 세어 둬 (표 아래 "1–N / 전체 M" 같은 숫자). 이름·이메일은 적지 말고 숫자만.

[2] Firestore — 내 users 문서 확인
- 왼쪽 메뉴 Build → Firestore Database → 데이터 탭 → users 컬렉션.
- 문서 ID가 내 UID와 똑같은 문서가 있는지 찾아.
  - 있으면: 그 문서에 status 칸이 있는지 봐. 없으면 그대로 둬 (없음 = 승인됨). status가 "approved"가 아니면 (pending, rejected 등) 멈춤.
  - 없으면: users 컬렉션에서 "+ 문서 추가".
      문서 ID = 내 UID (자동 ID 쓰지 마. 꼭 UID를 붙여 넣어)
      필드 name (string) = 나에게 이름을 물어서 넣기
      필드 email (string) = 내 계정 이메일
      status 칸은 만들지 마.
    → 저장. 다시 목록에서 그 문서가 보이는지 확인. 못 만들었으면 멈춤.
- users 컬렉션의 문서 수도 세어 둬.

[3] Firestore — 관리자 표시 만들기
- 데이터 탭에 admins 컬렉션이 있으면 그것을 열고, 없으면 "+ 컬렉션 시작" → 컬렉션 ID = admins.
- 문서 ID = 내 UID (자동 ID 쓰지 마)
- 필드 role (string) = owner
- 저장. 이미 같은 문서가 있으면 그대로 두고 role 값만 확인해.

[4] Firestore — 예전 규칙 복사 (되돌리기용)
- Firestore Database → 규칙(Rules) 탭.
- 지금 들어 있는 규칙 전체를 이 대화창에 그대로 보여 줘 (나중에 되돌릴 때 씀). 아직 아무것도 바꾸지 마.

[5] Firestore — 새 규칙 게시
- 규칙 칸의 글을 모두 지우고, 아래 "새 규칙" 상자 안 글 전체로 바꿔 (첫 줄 rules_version부터 마지막 } 까지).
- "게시(Publish)"를 눌러. 빨간 오류 표시가 나오면 게시하지 말고, [4]에서 복사한 예전 규칙으로 그대로 되돌려 놓고 멈춤.
- 게시됐으면 시각을 기억해 두고, 쉬지 말고 바로 [6]으로.

----- 새 규칙 시작 -----
rules_version = '2';
// ABLE CRM Firestore 보안 규칙 (2026-11-03)
// 쓰는 법: Firebase 화면 → Firestore Database → 규칙 → 이 글 전체를 붙여 넣고 [게시]
//
// 칸 설명
//   admins/{uid}            관리자 표시. 문서가 있으면 관리자. Firebase 화면에서만 만들 수 있어요(앱에서는 못 만듦).
//   users/{uid}             사람 정보: name, email, createdAt, status
//                             status 칸이 없으면 = 승인됨 (11/3 전에 가입한 분들. 따로 정리할 필요 없음)
//                             'pending' 승인 대기 · 'approved' 승인됨 · 'rejected' 거절
//   users/{uid}/...         그 사람의 고객·설정·보낸 기록 (승인된 본인만)
//   vaults/{uid}            그 사람의 금고(감싼 열쇠). 알아볼 수 없는 글자만 있음 (승인된 본인만)
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }
    function isAdmin() { return signedIn() && exists(/databases/$(database)/documents/admins/$(request.auth.uid)); }
    function userPath(uid) { return /databases/$(database)/documents/users/$(uid); }
    // 상태 칸이 없는 예전 문서는 승인된 것으로 봄
    function isApproved(uid) {
      return exists(userPath(uid)) && get(userPath(uid)).data.get('status', 'approved') == 'approved';
    }
    function approvedOwner(uid) { return isOwner(uid) && isApproved(uid); }
    // 관리자만 바꿀 수 있는 칸
    function statusKeys() { return ['status', 'decidedAt', 'decidedBy']; }

    // 관리자 표시: 본인 것만 "내가 관리자인가" 확인용으로 읽기. 쓰기는 Firebase 화면에서만
    match /admins/{uid} {
      allow get: if isOwner(uid);
      allow list, create, update, delete: if false;
    }

    match /users/{uid} {
      // 본인은 승인 대기여도 자기 상태를 볼 수 있음 (대기 화면을 보여 주려고). 관리자는 모두 봄
      allow get: if isOwner(uid) || isAdmin();
      allow list: if isAdmin();
      // 새 가입: 본인이, 승인 대기 상태로만 만들 수 있음
      allow create: if isOwner(uid)
        && request.resource.data.keys().hasOnly(['name', 'email', 'createdAt', 'status'])
        && request.resource.data.status == 'pending'
        && request.resource.data.email == request.auth.token.get('email', '')
        && request.resource.data.name is string && request.resource.data.name.size() <= 40;
      // 본인(승인된 사람): 이름 등은 고칠 수 있지만 상태 칸은 못 바꿈 (지우기도 안 됨)
      // 관리자: 상태 칸만 바꿀 수 있음
      allow update: if (approvedOwner(uid)
          && !request.resource.data.diff(resource.data).affectedKeys().hasAny(statusKeys()))
        || (isAdmin()
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(statusKeys())
          && request.resource.data.status in ['approved', 'rejected', 'pending']);
      allow delete: if false;
    }

    // 고객·설정·프로모션·보낸 기록 등 그 아래 모든 칸: 승인된 본인만
    // ({coll}을 넣어서 users/{uid} 문서 자체에는 이 규칙이 닿지 않게 함)
    match /users/{uid}/{coll}/{document=**} {
      allow read, write: if approvedOwner(uid);
    }

    // 금고: 승인된 본인만. 한 번 만든 금고를 다른 금고로 덮어쓰거나 지울 수 없음
    // (덮어쓰면 예전 열쇠로 잠근 카드 정보를 못 열게 되니까)
    match /vaults/{uid} {
      allow get: if approvedOwner(uid);
      allow create: if approvedOwner(uid)
        && request.resource.data.v == 1 && request.resource.data.vid is string;
      allow update: if approvedOwner(uid)
        && request.resource.data.vid == resource.data.vid
        && request.resource.data.rec == resource.data.rec;
      allow list, delete: if false;
    }

    // 그 밖의 칸은 모두 막음
  }
}
----- 새 규칙 끝 -----

[6] 넷리파이 — GitHub 저장소 연결 (= 새 앱 배포)
- https://app.netlify.com → 사이트 목록에서 splendorous-cactus-b8c609 열기.
- Site configuration → Build & deploy → Continuous deployment.
  - "Repository"가 이미 다른 저장소에 연결돼 있으면 멈춤 (저장소 이름만 알려 줘).
  - 연결 안 돼 있으면 "Link repository" (또는 "Link to Git").
- GitHub 선택. GitHub 로그인·비밀번호·인증 코드 화면이 나오면 멈추고 나에게 넘겨.
- 저장소 목록에 human8200-stack/able-crm 이 안 보이면: "Configure the Netlify app on GitHub" 링크 → Repository access에서 "Only select repositories" 상태 그대로 able-crm 만 더하고 Save. ("All repositories"로 바꾸지 마.) 이 화면에서 비밀번호를 물으면 멈추고 나에게 넘겨.
- human8200-stack/able-crm 선택 후 설정:
    Branch to deploy: main
    Base directory: 비워 둠
    Build command: 비워 둠
    Publish directory: public
    Functions directory: netlify/functions
  (저장소의 netlify.toml에 같은 값이 있어서 화면에 미리 채워져 있을 수 있어. 그대로 둬.)
- 환경 변수(Environment variables)는 추가하지 마.
- "Deploy" (또는 "Save"/"Link") 누르기.
- Deploys 탭에서 맨 위 배포가 "Published"가 될 때까지 기다려 (보통 1~3분). "Failed"면 멈추고 실패 화면의 마지막 빨간 줄을 알려 줘.

[7] 배포 확인
- Deploys 맨 위 배포를 눌러서, 커밋 이름이 "가입 승인제·카드 정보 금고·복제 방지 표시 추가"인지 봐.
- 같은 화면(또는 Logs → Functions)에 함수가 몇 개 올라갔는지 봐. push-daily, push-register, signup-notify 3개면 정상.
- Site configuration → Environment variables 에 VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY 가 각각 있는지 "있음/없음"만 봐. 값은 열지도 적지도 마. 없어도 추가하지 마.
- 새 탭에서 https://splendorous-cactus-b8c609.netlify.app 를 열어. 로그인 화면이 나오면 정상. "공식 주소가 아니에요" 같은 안내만 나오면 알려 줘. 로그인은 하지 마.

[8] 나에게 할 말
- "이제 휴대폰에서 ABLE CRM을 완전히 닫았다가 다시 열어 보세요. 첫 화면이 '가입 신청을 받았어요'면 바로 저에게 말해 주세요. 앱이 열리면 더보기 탭에 '관리자'가 보이는지 봐 주세요."

[9] 회사에 보낼 보고 (이 모양 그대로, 값 대신 있음/없음과 숫자만)
[크롬 Claude 보고] ABLE CRM 배포
- main 새 판 확인: 됨 / 안 됨
- 회장님 users 문서: 원래 있음 / 없어서 만듦 / 못 만듦
- 회장님 users 문서 status 칸: 없음 / approved / 그 밖 (값)
- Authentication 사람 수: ○명 / users 문서 수: ○개
- admins 회장님 문서(role=owner): 만듦 / 원래 있음 / 못 만듦
- 예전 규칙 복사: 대화창에 보여 드림 / 못 함
- 새 규칙 게시: 됨 (시각 ○○:○○) / 오류로 되돌림 / 안 함
- 넷리파이 연결 전 상태: 연결 안 됨 / 다른 저장소 연결돼 있었음 (저장소 이름)
- 넷리파이 연결: 됨 (main) / 멈춤 (이유)
- 배포: Published (시각 ○○:○○) / Failed (마지막 빨간 줄)
- 배포 커밋 이름 맞음: 예 / 아니오
- 함수 개수: ○개 (이름)
- VAPID 3개: 모두 있음 / 없는 것 (이름만)
- 공식 주소 로그인 화면: 보임 / 안 보임
- 멈춘 곳: 없음 / [번호] 이유
````

### 문제가 생기면 (회장님이 "되돌려"라고 할 때만)
- 회장님 폰이 "가입 신청을 받았어요"에서 안 넘어가면: 먼저 회사에 알려 주세요. 대부분 [2]의 문서 ID가 UID와 다를 때예요 → 회사가 크롬 Claude에 고칠 문장을 드려요.
- 앱 되돌리기: 넷리파이 Deploys → 연결 전 마지막 배포(끌어다 놓은 것) → "Publish deploy".
- 규칙 되돌리기: Firestore 규칙 탭 → 왼쪽 예전 기록 목록 → 게시 전 판 → 되돌리기 (또는 [4]에서 복사한 글을 붙여 넣고 게시).

### 크롬 Claude 보고를 받은 뒤 사장이 볼 것
- Authentication 사람 수 > users 문서 수 이면: 그 차이만큼의 사람은 새 앱을 열 때 "가입 신청" 상태가 돼요. 회장님이 **더보기 > 관리자 > 가입 승인**에서 ✅ 승인하면 돼요 (고객 정보는 그대로). 사람 수를 회장님께 미리 말씀드린다.
- VAPID가 없으면: 앱은 잘 돌아가지만 아침 알림·새 가입 알림이 안 와요. 값은 회장님 노트북 Claude Code 쪽에 있을 가능성 → 따로 결재(로그인·설정)로 올린다.
- 함수가 3개가 아니면: 개발팀에 넘긴다.

---

## 3장. 파트너분들께 보낼 카톡 안내문

**보내는 때**: 회장님 폰에서 새 판이 열리는 것을 확인한 뒤. **보내는 사람**: 회장님 (회장님 카톡).
개발팀 초안 3줄은 회사 파일에서 찾지 못해서, `설치가이드.md`의 금고 설명과 앱 화면 문구를 기준으로 새로 썼어요.

```
[ABLE CRM 업데이트 안내]

파트너님, ABLE CRM이 더 안전해졌어요 🙂
카드번호·암웨이 비밀번호 같은 정보를 '금고'에 잠가 두는 기능이 생겼어요.
딱 3가지만 해 주세요.

1️⃣ 앱을 완전히 닫았다가 다시 열기
- 아이폰: 화면 맨 아래에서 위로 천천히 밀어 올리기 → ABLE CRM 화면을 위로 휙 밀어서 닫기 → 다시 열기
- 갤럭시: 아래 왼쪽 ||| 버튼 → ABLE CRM 화면을 위로 밀어서 닫기 → 다시 열기

2️⃣ 금고 비밀번호 숫자 6자리 정하기
- 다시 열면 '금고 만들기' 창이 떠요
- 생일·전화번호 말고, 나만 아는 숫자로 정해 주세요
- 이 폰에서는 처음 한 번만 물어요

3️⃣ 복구 코드 12자리 꼭 캡처하기
- 금고를 만들면 복구 코드가 나와요. 바로 화면 캡처해 주세요
- 금고 비밀번호를 잊었을 때 쓰는 유일한 방법이에요
- 복구 코드까지 잃어버리면 저도 열어 드릴 수 없어요

📌 폰과 PC를 같이 쓰시면 금고는 한 번만 만들고, 다른 기기에서는 같은 비밀번호로 열어 주세요
📌 고객 이름·연락처·카톡 보내기·주문 기록은 예전 그대로예요

막히는 게 있으면 편하게 카톡 주세요!
```

- 금지어 점검: 수입·보너스·직급·스폰서 없음. 권유 말투 없음.
- 앱 실제 문구와 맞춘 것: "금고 만들기", "숫자 6자리", "이 폰에서는 처음 한 번만", "복구 코드 12자리", 금고는 다른 기기에서 이미 만들었으면 그 비밀번호로 열기.
- 새로 가입하는 분께는 따로: "가입하신 뒤 '가입 신청을 받았어요' 화면이 나오면, 승인해 드릴 때까지 잠시 기다려 주세요."

---

## 4장. 남은 일 (순서)

1. 품질관리팀 — 이 파일 검수 (지시문의 규칙 전문이 `able-crm/firestore.rules`와 같은지 포함)
2. 사장 "합쳐" → 운영팀이 `able-crm` main 앞으로 감기 + 1장 체크 → 회장님께 "붙여 넣으셔도 돼요"
3. 회장님 → 크롬 Claude (2장) → 보고를 사장에게
4. 회장님 폰 확인 → 파트너 안내문 (3장)
