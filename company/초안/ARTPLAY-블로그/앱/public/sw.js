// ARTPLAY 블로그 글쓰기 — 오프라인용 화면 저장 (글 만들기 /api/ 는 저장하지 않음)
// 화면 파일을 고치면 CACHE 버전을 하나 올린다.
const CACHE = "artplay-blog-v9";
const SHELL = ["./", "index.html", "app.css", "app.js", "demo.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // 화면 파일: 인터넷이 되면 새것, 안 되면 저장해 둔 것
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
