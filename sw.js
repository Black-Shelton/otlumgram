const CACHE_NAME = 'otlumgram-v2';
const OFFLINE_URL = 'offline.html';
const STATIC_ASSETS = [
    '/',
    'index.html',
    'style.css',
    'script.js',
    'manifest.json',
    'offline.html',
    'icon-192.png',
    'icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .catch(err => console.log('[SW] Cache error:', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names => Promise.all(
            names.map(name => { if (name !== CACHE_NAME) return caches.delete(name); })
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Не кэшируем API запросы
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (!response || response.status !== 200 || response.type !== 'basic') return response;
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                if (event.request.mode === 'navigate') return caches.match(OFFLINE_URL);
                return new Response('Нет подключения', { status: 503, statusText: 'Service Unavailable' });
            });
        })
    );
});
