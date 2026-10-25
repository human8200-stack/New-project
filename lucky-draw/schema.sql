-- 추첨 앱 데이터베이스 (Cloudflare D1). 여러 번 실행해도 괜찮다.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prizes TEXT NOT NULL DEFAULT '[]',   -- [{"name":"치킨","count":3}]
  open INTEGER NOT NULL DEFAULT 1,     -- 1이면 큐알로 등록 받는 중
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',       -- 반·소속·전화 뒷자리처럼 같은 이름을 구분하는 말
  device TEXT,                         -- 같은 휴대폰으로 두 번 등록하지 못하게
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, device)
);
CREATE INDEX IF NOT EXISTS participants_event ON participants (event_id, created_at);

CREATE TABLE IF NOT EXISTS winners (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS winners_event ON winners (event_id, created_at);
