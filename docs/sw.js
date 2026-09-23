const ARCHIVE_CACHES = ["zamis-ipad-", "nava-ipad-"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => ARCHIVE_CACHES.some((prefix) => key.startsWith(prefix)))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim()),
  );
});
