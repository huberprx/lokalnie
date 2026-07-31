/* Lokalnie PWA — przy publikacji podbij CACHE (zgodnie z APP_VERSION w app.js). */
const CACHE = "lokalnie-shell-v1.0.143";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./api.js",
  "./data.js",
  "./simulator.js",
  "./calendar.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function networkFirst(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        // Fallback na shell tylko dla nawigacji — JS/CSS nigdy nie może dostać HTML-a.
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(function (cached) {
    const network = fetch(request)
      .then(function (response) {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return cached;
      });
    return cached || network;
  });
}

function isCodeAsset(url) {
  return /\.(?:js|css|webmanifest)$/i.test(url.pathname);
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML + JS/CSS: najpierw sieć, żeby podgląd/dev nie trzymał starego UI.
  if (event.request.mode === "navigate" || isCodeAsset(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
