const PWA_CACHE = "teras-laundry-pwa-v1";
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== PWA_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (request.url.startsWith("ws:") || request.url.startsWith("wss:")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  const isStatic = STATIC_DESTINATIONS.has(request.destination);
  if (!isNavigation && !isStatic) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) {
        const cache = await caches.open(PWA_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (isNavigation) {
        const fallback = await caches.match("/customer");
        if (fallback) return fallback;
      }
      throw new Error("Network unavailable");
    }
  })());
});

