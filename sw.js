const CACHE = "studypack-v4";
const FILES = [
  "./", "./index.html", "./style.css", "./app.js",
  "./lib/pdf.min.js", "./lib/pdf.worker.min.js"
];

// 1. INSTALL: save the app files into the cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES))
  );
  self.skipWaiting();
});

// 2. ACTIVATE: delete old caches from earlier versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// 3. FETCH: answer from the cache first, network second
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/ping.txt")) return; // never cache the connection check

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});