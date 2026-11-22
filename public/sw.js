// Минимальный service worker: нужен только для системных уведомлений.
// Ничего не кэширует, поэтому сайт всегда свежий.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./'))));
});
