const CACHE = "studypack-v5";
const FILES = [
  "./", "./index.html", "./style.css", "./app.js",
  "./lib/pdf.min.js", "./lib/pdf.worker.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/ping.txt")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});