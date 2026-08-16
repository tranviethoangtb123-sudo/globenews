/* 环球新闻地球仪 Service Worker：静态资源网络优先 + 缓存兜底，API 不缓存 */
const VERSION = 'gn-v1';
const STATIC = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './data/countries.json',
  './data/countries.geo.json',
  './data/cities.json',
  './data/style-liberty.json',
  './data/meta.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // CDN 资源不拦截
  if (url.pathname.startsWith('/api/')) return;     // API 走网络

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});
