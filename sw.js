/*
 * Cozé Club service worker.
 * It exists for one job: showing notifications for the member card and opening the card when one is tapped.
 * It caches nothing on purpose, so the demo never serves a stale page.
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = data.url || new URL('club/#notes', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf('/club/') !== -1 && 'focus' in client) {
          client.postMessage({ type: 'open-notes' });
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    })
  );
});
