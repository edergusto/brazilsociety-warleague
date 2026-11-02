const STATIC_CACHE = 'cwl-static-v1';
const API_CACHE = 'cwl-api-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.png',
  './assets/cw_icon.webp',
  './assets/icone_fita_64.png',
  './assets/icone_fita_mais_64.png'
];

// Instalação: faz o pré-cache dos arquivos estáticos essenciais (App Shell)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ativação: limpa versões antigas de cache
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Interceptação de requisições:
// - Rotas /api/*: Network-First com fallback para cache (permite consulta offline do último clã)
// - Assets estáticos: Cache-First com atualização em segundo plano (Stale-While-Revalidate)
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Estratégia Network-First para chamadas à API local (/api/clan, /api/league, /api/war)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Estratégia Cache-First para App Shell e assets locais
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
