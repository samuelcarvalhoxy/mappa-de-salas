const CACHE = "mappa-v4";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
async function cacheOfflineShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const page = await cache.match("/");
  const html = await page.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^" ]+)"/g)].map((match) => match[1]))];
  await cache.addAll(assets);
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    Promise.all([
      cacheOfflineShell(),
      self.skipWaiting(),
    ]),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key !== CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin ||
    new URL(event.request.url).pathname.startsWith("/api/")
  )
    return;
  if (new URL(event.request.url).pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(event.request,response.clone());
      return response;
    })));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || (event.request.mode === "navigate" ? caches.match("/") : Response.error())),
      ),
  );
});
self.addEventListener("push", (event) => {
  const data = event.data?.json?.() || {};
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Mappa de Salas", {
        body: data.body || "Há uma atualização na agenda de salas.",
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: data.tag || "mappa-update",
        data: { url: data.url || "/" },
      }),
      (data.tag === "request-auto-rejection" || data.tag === "request-auto-result")
        ? self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
            windows.forEach((client) => client.postMessage({ type: "request-auto-rejection" }));
          })
        : Promise.resolve(),
      (data.tag === "booking-request" || data.tag?.startsWith("urgent-request-") || data.tag === "pending-request-reminder")
        ? self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
            windows.forEach((client) => client.postMessage({ type: "booking-requests-changed" }));
          })
        : Promise.resolve(),
    ]),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find((client) => "focus" in client);
        const target = event.notification.data?.url || "/";
        return existing
          ? existing.navigate(target).then((client) => client?.focus())
          : clients.openWindow(target);
      }),
  );
});
