// Этот файл нужен только телефонам, где раньше было включено «Юрт» с уведомлениями:
// их старая подписка привязана к этому адресу. Уведомления показываем и ведём в архив «Юрт» (./yurt/).
// Радио service worker не нужен: ничего не кэшируем.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  if (d.unread !== undefined) self.navigator.setAppBadge?.(d.unread).catch(() => {});
  e.waitUntil(self.registration.showNotification(d.title || 'Юрт', {
    body: d.body || 'Новое сообщение',
    tag: d.room_id || 'yurt',
    icon: 'yurt/icons/icon-192.png',
    data: { href: d.kind === 'invite' ? '#/friends' : d.room_id ? '#/chat/' + encodeURIComponent(d.room_id) : '#/chats' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow('./yurt/' + (e.notification.data?.href || '')));
});
