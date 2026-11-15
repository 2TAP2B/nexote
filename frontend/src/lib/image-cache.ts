"use client";

// Browser-side persistence for uploaded images. When a user uploads an image
// we store its bytes here (CacheStorage) keyed by its /api/vaults/.../images/
// URL. The service worker (public/sw.js) then serves those URLs cache-first,
// so an image survives a reload even if the note body hasn't been flushed to
// the server yet or the backend is unreachable (offline PWA).
//
// This cache name must be kept in sync with the one in public/sw.js — bump
// both together when invalidating the app shell.
const IMAGE_CACHE = "nexote-v4";

export async function cacheImage(url: string, data: Blob): Promise<void> {
  if (typeof caches === "undefined" || !url) return;
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const res = new Response(data, {
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    });
    await cache.put(new Request(url), res);
  } catch {
    // Cache writes are best-effort — ignore quota errors, unsupported
    // environments, etc. The network request still works when online.
  }
}