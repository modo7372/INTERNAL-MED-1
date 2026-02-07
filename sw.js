const CACHE_NAME = 'medquiz-v3.9'; // هام: قم بتغيير هذا الرقم عند كل تحديث
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './config.js',
  './js/ui.js',
  './js/data.js',
  './js/game.js',
  './questions_list.json'
];

self.addEventListener('install', e => {
  // إجبار الـ Service Worker الجديد على التفعيل فوراً
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  // السيطرة الفورية على الصفحات المفتوحة
  e.waitUntil(clients.claim());
  
  // حذف الكاش القديم
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (!key.includes(CACHE_NAME)) return caches.delete(key);
      })
    ))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
