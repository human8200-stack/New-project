// 내 컴퓨터에서 Netlify를 흉내 내어 시험하는 작은 서버 (배포에는 쓰이지 않음)
//   node dev-server.mjs            → http://localhost:8888
// 환경 변수는 실행할 때 앞에 붙여 넣는다. 키를 이 파일이나 저장소에 적지 않는다.
//   ACCESS_CODES=mom:시험코드-1234 node dev-server.mjs
// 하루 한도·잠금 기록은 메모리에만 남고 서버를 끄면 사라진다.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NUTRI_LOCAL_DEV = "1"; // 하루 한도·잠금 기록을 메모리에 (이 시험 서버에서만)
const here = fileURLToPath(new URL(".", import.meta.url));
const pub = join(here, "public");
const PORT = Number(process.env.PORT || 8888);
const routes = {};
for (const name of ["check", "photos", "write"]) {
  const mod = await import(new URL("./netlify/functions/" + name + ".mjs", import.meta.url));
  routes[mod.config.path] = mod.default;
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const fn = routes[url.pathname];
  if (fn) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body });
    try {
      const r = await fn(request, { ip: req.socket.remoteAddress });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); } }
      res.end();
    } catch (e) { console.error(e); res.writeHead(500); res.end("server error"); }
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (!p || p.endsWith("/")) p += "index.html";
  const file = join(pub, p);
  if (!file.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (_) { res.writeHead(404); res.end("not found"); }
}).listen(PORT, () => console.log("영양 노트 블로그 앱 시험 서버: http://localhost:" + PORT));
