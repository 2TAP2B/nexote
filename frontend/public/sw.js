// Nexote service worker — caches the app shell for offline launch.
// Uploaded images are cached too (see the /images/ handler below) so they
// survive reloads and offline use without needing the backend.
const CACHE = "nexote-v2";
const SHELL = ["/", "/m", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// Matches image URLs stored in note bodies (/api/vaults/<id>/images/<path>).
const IMAGE_PATH = /^\/api\/vaults\/[^/]+\/images\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache Next.js HMR chunks.
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  // Images are seeded into the cache when they're uploaded. Serve them
  // cache-first so a just-uploaded image is still visible after a reload /
  // offline, with a network backfill for images that were never cached.
  if (IMAGE_PATH.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Other API calls need the live backend — never cache them.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for navigation requests, fall back to cache for offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/m"))),
    );
    return;
  }

  // Cache-first for static assets (_next/static, icons, etc).
  if (url.pathname.startsWith("/_next/static") || url.pathname.match(/\.(svg|png|ico|woff2?|css)$/)) {
    e.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          }),
      ),
    );
  }
});