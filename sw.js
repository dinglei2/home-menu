const CACHE_NAME = 'home-menu-v5';
const APP_VERSION = 'v4.1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-256.png',
  './icon-384.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

/* 前端「检查更新」点击后发来 SKIP_WAITING 消息，立即接管 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Upstash Redis 请求：永远走网络，不缓存
  if (url.hostname.endsWith('.upstash.io')) {
    event.respondWith(fetch(request));
    return;
  }

  // 非 GET 请求直接走网络
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // 缓存同源静态资源
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // 离线且没有缓存时返回首页兜底
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
