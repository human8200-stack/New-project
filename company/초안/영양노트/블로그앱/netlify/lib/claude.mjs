// Claude API 연결 (SDK 없이 fetch로). 키는 환경 변수 ANTHROPIC_API_KEY에서만 읽는다.
//   CLAUDE_MODEL  쓸 모델 (기본 claude-sonnet-5-5). 더 좋은 글이 필요하면 claude-opus-5-5
//   WRITE_EFFORT  글쓰기 생각 깊이 (기본 medium). low / medium / high

export const API_URL = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages"; // 시험할 때만 바꿈
export const API_VERSION = "2026-10-21";
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const WRITE_EFFORT = ["low", "medium", "high"].includes(process.env.WRITE_EFFORT) ? process.env.WRITE_EFFORT : "medium";

export function hasKey() { return !!(process.env.ANTHROPIC_API_KEY || "").trim(); }

export const NO_KEY = {
  error: "no_key",
  message: "아직 AI 연결 열쇠(API 키)가 설정되지 않았어요. 회사에 알려 주세요. 그동안은 [체험해 보기]로 화면을 둘러볼 수 있어요."
};

export function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(extra || {}) }
  });
}

export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "unknown";
}

// API 오류 → 회장님이 읽을 쉬운 말
export function friendlyApiError(status, type) {
  if (status === 401 || type === "authentication_error") return { error: "key_bad", message: "AI 연결 열쇠(API 키)가 맞지 않아요. 회사에 알려 주세요." };
  if (status === 402 || type === "billing_error") return { error: "billing", message: "AI 사용 요금 결제에 문제가 있어요. 회사에 알려 주세요." };
  if (status === 429 || type === "rate_limit_error") return { error: "busy", message: "AI를 너무 자주 불렀어요. 1분쯤 뒤에 다시 눌러 주세요." };
  if (status === 529 || type === "overloaded_error") return { error: "busy", message: "AI가 지금 붐벼요. 잠시 뒤 다시 눌러 주세요." };
  if (status === 413 || type === "request_too_large") return { error: "too_big", message: "사진이 너무 커요. 사진 수를 줄여 다시 해 주세요." };
  if (status === 400 && /spend|limit/i.test(type || "")) return { error: "billing", message: "이번 달 AI 사용 한도에 닿았어요. 회사에 알려 주세요." };
  return { error: "api", message: "AI가 글을 못 만들었어요. 잠시 뒤 다시 눌러 주세요." };
}

function headers() {
  return {
    "x-api-key": (process.env.ANTHROPIC_API_KEY || "").trim(),
    "anthropic-version": API_VERSION,
    "content-type": "application/json"
  };
}

// 한 번에 받기 (사진 읽기용)
// 오류에 preStream=true가 붙으면 "AI가 처음부터 200이 아닌 응답을 줬다" = 돈이 나가지 않았다는 뜻 → 한도를 돌려준다
export async function callOnce(body, signal) {
  const res = await fetch(API_URL, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const type = data && data.error && data.error.type;
    console.warn("[claude] 오류", res.status, type, data && data.error && data.error.message);
    const e = new Error("api"); e.friendly = friendlyApiError(res.status, type); e.preStream = true; throw e;
  }
  const data = await res.json().catch(() => ({}));
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, usage: data.usage || null, stop: data.stop_reason };
}

// 흘려 받기 (글쓰기용). onText(조각)을 부르고, 끝나면 {stop, usage}를 돌려준다.
export async function callStream(body, onText, signal) {
  const res = await fetch(API_URL, { method: "POST", headers: headers(), body: JSON.stringify({ ...body, stream: true }), signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const type = data && data.error && data.error.type;
    console.warn("[claude] 오류", res.status, type, data && data.error && data.error.message);
    const e = new Error("api"); e.friendly = friendlyApiError(res.status, type); e.preStream = true; throw e;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", stop = null, usage = {};
  const handle = (raw) => {
    const line = raw.split("\n").find(l => l.startsWith("data:"));
    if (!line) return;
    let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (_) { return; }
    if (ev.type === "message_start" && ev.message && ev.message.usage) Object.assign(usage, ev.message.usage);
    else if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") onText(ev.delta.text || "");
    else if (ev.type === "message_delta") { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage) Object.assign(usage, ev.usage); }
    else if (ev.type === "error") {
      const e = new Error("api"); e.friendly = friendlyApiError(0, ev.error && ev.error.type); throw e;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  return { stop, usage };
}
