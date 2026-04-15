const CACHE_NAME = 'qc-dashboard-v1'; // Incremented version to force update
const ASSETS = [
  './',                // Use relative path
  'index.html',        // Removed leading slash
  'manifest.json',     // Removed leading slash
  'src/index.css'      // Added your CSS so the app works offline
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Using cache.addAll is strict; if one file fails, the whole SW fails.
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle local requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
