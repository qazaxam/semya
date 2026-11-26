// Минимальный service worker: нужен только для системных уведомлений.
// Ничего не кэширует, поэтому сайт всегда свежий.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// push от рассыльщика (push-gateway): показываем уведомление и цифру на значке
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  if (d.unread !== undefined) self.navigator.setAppBadge?.(d.unread).catch(() => {});
  e.waitUntil(self.registration.showNotification(d.title || 'Юрт', {
    body: d.body || 'Новое сообщение',
    tag: d.room_id || 'yurt',
    icon: 'icons/icon-192.png',
    data: { href: d.kind === 'invite' ? '#/friends' : d.room_id ? '#/chat/' + encodeURIComponent(d.room_id) : '#/chats' },
  }));
});

// нажали на уведомление — открываем нужный чат
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const href = e.notification.data?.href || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list[0]) { list[0].postMessage({ open: href }); return list[0].focus(); }
    return self.clients.openWindow('./' + href);
  }));
});
