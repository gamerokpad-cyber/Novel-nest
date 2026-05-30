const V = 'nn-v11';
const APP_SHELL = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => c.addAll(CDN).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase → network เสมอ
  if (url.hostname.includes('supabase.co')) return;

  // CDN (pdf.js, fonts) → cache-first (ไม่เปลี่ยน)
  const isCDN = url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('fonts.gstatic.com');
  if (isCDN) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(V).then(c => c.put(request, clone)); }
          return res;
        });
      })
    );
    return;
  }

  // App shell (HTML/CSS/JS) → network-first → เห็นเวอร์ชันใหม่ทันที
  const isShell = url.origin === self.location.origin;
  if (isShell) {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(V).then(c => c.put(request, clone)); }
          return res;
        })
        .catch(() => caches.match(request).then(c => c || caches.match('./index.html')))
    );
    return;
  }
});
