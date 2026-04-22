// Cache version — bump this string on every production deployment
// to force old service workers to clear their stale cache.
const CACHE_NAME = 'avtohisob-v3'

self.addEventListener('install', (event) => {
  // Pre-cache only the root path; actual HTML is served network-first anyway.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Delete ALL old caches from previous versions.
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // ── API calls: network-first, no caching ────────────────────────────────
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // ── HTML / navigation requests: ALWAYS network-first ────────────────────
  // This is the critical fix: after a new deploy, Vite generates new JS/CSS
  // hashes. If the browser gets a stale cached index.html it will try to load
  // old hash-named bundles that no longer exist → blank page.
  // By fetching index.html from the network every time we guarantee the user
  // always gets the bundle references that match the current server build.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Optionally update the cache with the fresh HTML
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then(c => c.put(request, clone))
          }
          return res
        })
        .catch(() =>
          // Offline fallback: serve cached HTML if available
          caches.match(request).then(c => c || caches.match('/'))
        )
    )
    return
  }

  // ── Hashed static assets (JS, CSS, images): cache-first ─────────────────
  // Vite appends content hashes to filenames (e.g. index-a1b2c3.js).
  // Once cached, a hashed asset is always the correct version — safe to
  // serve from cache without re-fetching.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(res => {
        if (res.ok && request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, clone))
        }
        return res
      })
    })
  )
})
