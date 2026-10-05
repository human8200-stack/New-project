// 오프라인에서도 열리도록 앱 파일을 캐시한다 (네트워크 우선)
const CACHE = 'study-routine-v10';
const FILES = ['./', 'index.html', 'style.css', 'planner.js', 'seed.js', 'app.js', 'firebase-config.js', 'sync.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  // 같은 주소의 앱 파일만 캐시한다. Firebase 통신은 건드리지 않는다
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
