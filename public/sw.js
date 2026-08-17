/* 环球新闻地球仪 Service Worker
 * 策略：大体积稳定资源（vendor/maplibre-gl、fonts）缓存优先 → 二次打开秒开；
 *      代码与数据（index/app.js/app.css/data/*）网络优先 → 改动即时生效 */
const VERSION = 'gn-v4';
const STATIC = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './vendor/maplibre-gl.js',
  './fonts/fonts.css',
  './fonts/inter-400.woff2',
  './fonts/inter-600.woff2',
  './fonts/space-grotesk-700.woff2',
  './fonts/jetbrains-mono-400.woff2',
  './data/countries.json',
  './data/countries.geo.json',
  './data/cities.json',
  './data/style-liberty.json'
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

const cachePut = (req, res) => {
  const copy = res.clone();
  caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // CDN/外部不拦截
  if (url.pathname.startsWith('/api/')) return;     // API 走网络

  // 代码与数据：网络优先（改动即时生效），失败回退缓存
  const isFresh = /\/data\//.test(url.pathname) || /(index\.html|app\.(css|js))/.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/');
  if (isFresh) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res && res.ok) cachePut(req, res); return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 稳定大资源：缓存优先（加速二次打开），后台刷新缓存
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => { if (res && res.ok) cachePut(req, res); return res; })
        .catch(() => hit);
      return hit || fresh;
    })
  );
});
