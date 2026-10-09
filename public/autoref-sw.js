/* 自動裁判 PWA service worker：加到主畫面後可離線開啟 /autoref 底下的頁面。
 * 頁面用「先網路、失敗才用快取」；靜態資源（/_next/static）用「先快取」。
 * 不快取 API，也不碰 /autoref 以外的路徑。 */
const CACHE = "autoref-v1";
const PRECACHE = ["/autoref", "/autoref/battle", "/autoref/calibrate", "/autoref/replay", "/autoref/settings", "/autoref/manifest.webmanifest", "/autoref/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  if (url.pathname.startsWith("/autoref")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/autoref")))
    );
  }
});
