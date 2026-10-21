// 오프라인에서도 열리도록 앱 파일을 캐시한다 (네트워크 우선)
// app.js의 APP_VERSION과 같이 올린다
const CACHE = 'study-routine-v22';
const FILES = ['./', 'index.html', 'style.css', 'planner.js', 'seed.js', 'app.js', 'firebase-config.js', 'sync.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

// 새 버전은 기다리지 않고 바로 자리를 잡는다 (앱이 이를 보고 한 번 새로 연다)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  // 같은 주소의 앱 파일만 캐시한다. Firebase 통신은 건드리지 않는다
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // no-cache: GitHub Pages가 10분 동안 옛 파일을 주지 않게 매번 새 버전인지 확인한다
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
