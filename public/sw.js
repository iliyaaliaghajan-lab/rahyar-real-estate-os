/* Rahyar service worker: precaches the app shell + static assets, then serves offline. */
const CACHE = 'rahyar-v1';
const ROUTES = ['/', '/properties/', '/properties/new/', '/properties/view/', '/properties/edit/', '/clients/', '/clients/new/',
  '/clients/view/', '/clients/edit/', '/clients/need/', '/followups/', '/followups/new/', '/assistant/', '/more/', '/search/'];
const STATIC = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set(STATIC);
  for (const url of ROUTES) {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(url, res);
      for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)>]+/g)) assets.add(m[0]);
    } catch (e) { /* ignore; runtime caching fills the gap */ }
  }
  // fonts referenced from CSS files
  for (const a of Array.from(assets)) {
    if (!a.endsWith('.css')) continue;
    try {
      const css = await (await fetch(a)).text();
      for (const m of css.matchAll(/url\((\/_next\/static\/[^)]+)\)/g)) assets.add(m[1]);
    } catch (e) { /* ignore */ }
  }
  await Promise.all(Array.from(assets).map(async (a) => {
    try { const r = await fetch(a); if (r.ok) await cache.put(a, r); } catch (e) { /* ignore */ }
  }));
}

self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE); c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }
  // static assets & everything else same-origin: cache-first, refresh in background
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: url.pathname.startsWith('/_next/') ? false : true });
    const net = fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await net) || Response.error();
  })());
});
