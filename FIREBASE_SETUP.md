# 아이패드 · 휴대폰 동기화 설정 (Firebase, 무료)

한 번만 하면 됩니다. **휴대폰 Safari로 10분**이면 됩니다. 무료 요금제(Spark)로 충분하고, 카드 등록은 필요 없습니다.
설정을 마치면 아이는 앱에서 **아이디·비밀번호**를 만들고, 다른 기기에서 같은 아이디로 로그인하면 기록이 저절로 맞춰집니다.

## 1. 프로젝트 만들기

1. https://console.firebase.google.com 에 부모님 Google 계정으로 들어갑니다.
2. **프로젝트 만들기** → 이름을 `study-routine`처럼 정합니다.
3. Google 애널리틱스는 **사용 안 함**으로 두고 만듭니다.

## 2. 아이디·비밀번호 로그인 켜기

1. 메뉴(☰) → **빌드 → Authentication → 시작하기**.
2. **로그인 방법** 탭 → **이메일/비밀번호** → 첫 번째 스위치(**사용 설정**)만 켜고 **저장**.
   (아래의 "이메일 링크"는 켜지 않습니다. 앱이 아이디를 이메일 모양으로 바꿔 쓰는 것이라 실제 메일은 가지 않습니다.)
3. **설정** 탭 → **승인된 도메인 → 도메인 추가** → `human8200-stack.github.io` 추가.
4. **템플릿** 탭 → 아래쪽 **템플릿 언어**를 **한국어**로 바꿉니다. 비밀번호 찾기·이메일 인증 메일이 한국어로 갑니다.

## 3. 데이터베이스 만들기

1. 메뉴 → **빌드 → Firestore Database → 데이터베이스 만들기**.
2. 위치는 **asia-northeast3 (서울)**.
3. **프로덕션 모드**로 시작합니다.

## 4. 보안 규칙 넣기

1. Firestore Database → **규칙** 탭.
2. 들어 있는 내용을 모두 지우고 아래를 그대로 붙여 넣은 뒤 **게시**.

```
rules_version = '2';

// households/<uid>: 계정마다 기록 문서 하나. 자기 계정의 기록만 읽고 쓸 수 있다.
// ids/<아이디>: 아이디 → 계정(uid)과 비밀번호 찾기용 이메일. 아이디를 알아야만 하나씩 읽을 수 있고 목록은 볼 수 없다.
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /images/{imageId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }

    match /ids/{id} {
      allow get: if true;
      allow create: if request.auth != null && request.resource.data.uid == request.auth.uid
        && id.matches('^[a-z0-9_]{3,20}$');
      allow update: if request.auth != null && resource.data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid;
    }
  }
}
```

이 규칙 때문에 각자 자기 계정의 기록만 읽고 쓸 수 있습니다. (저장소의 [`firestore.rules`](firestore.rules)와 같은 내용)

## 5. 앱 설정값 보내기

1. 왼쪽 위 톱니바퀴 → **프로젝트 설정** → 아래쪽 **내 앱** → 웹 아이콘 **`</>`**.
2. 앱 닉네임을 넣고 **앱 등록** (Hosting 체크는 하지 않습니다).
3. 화면에 나오는 `const firebaseConfig = { ... }` 부분을 복사해서 Claude에게 보냅니다. `firebase-config.js`에 넣어 드립니다.

```js
apiKey: "...",
authDomain: "....firebaseapp.com",
projectId: "...",
storageBucket: "...",
messagingSenderId: "...",
appId: "..."
```

이 값은 공개돼도 괜찮습니다. 비밀번호가 아니라 "어느 Firebase 프로젝트인지"를 알려 주는 주소 같은 값이고, 실제 접근은 4번 규칙이 막습니다.

## 6. 기기마다 로그인하기

1. **아이패드**: 앱 → 설정(톱니바퀴) → **아이패드 · 휴대폰 동기화 → 처음이에요 → 계정 만들기**.
   아이디(영어 소문자·숫자)와 비밀번호(6자 이상)를 정하면 이 기기 기록이 올라갑니다.
2. **휴대폰**: 같은 아이디·비밀번호로 **로그인**하면 아이패드 기록이 내려오고, 그다음부터는 고칠 때마다 바로 맞춰집니다.
3. **부모님**: 아이 기록을 보고 싶으면 부모님 휴대폰에서도 아이 아이디로 로그인하면 됩니다.
4. **친구**: 같은 앱 주소에서 자기 아이디로 계정을 만들면 됩니다. 기록은 계정마다 따로라 섞이지 않습니다.

## 알아 두기

- 각 기기는 인터넷이 없어도 계속 쓸 수 있고, 연결되면 맞춰집니다.
- 두 기기에서 **동시에** 고치면 더 나중에 고친 쪽이 남습니다.
- **한 번 로그인하면 계속 로그인된 채로** 열립니다. 로그아웃을 누르거나 비밀번호가 바뀌었을 때만 다시 로그인합니다.
- **비밀번호 찾기**: 계정을 만들 때(또는 나중에 설정에서) **부모님 이메일**을 등록하고, 그 메일로 온 **인증 링크를 눌러 두면** 됩니다.
  잊었을 때 로그인 화면의 **비밀번호를 잊었어요**에 아이디를 넣으면 부모님 메일로 재설정 링크가 갑니다. 메일이 안 보이면 스팸함을 확인해 주세요 (`noreply@프로젝트이름.firebaseapp.com`에서 옵니다).
- 이메일을 등록하지 않았다면 로그인된 다른 기기의 설정 → **비밀번호 바꾸기**를 쓰거나, Firebase → Authentication → 사용자에서 그 계정의 비밀번호를 초기화할 수 있습니다 (Claude에게 부탁해도 됩니다).
- 친구 기록도 이 Firebase 프로젝트에 저장됩니다. 프로젝트를 만든 부모님은 Firebase 화면에서 저장된 기록을 열어볼 수 있으니 친구네에 미리 알려 주세요.
- 오답 사진은 기록과 따로 저장되고, 다른 기기에서는 처음 열 때 내려받습니다.
