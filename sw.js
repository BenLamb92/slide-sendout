// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = "gp-sendout-v3";
const FILES = ["./", "index.html", "styles.css", "app.js", "logo.png", "manifest.webmanifest",
               "vendor/zxing-reader.js", "vendor/zxing_reader.wasm",
               "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// network first (so updates show up right away), cache when offline
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
