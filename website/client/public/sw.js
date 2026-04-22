// Habitica self-host service worker — Web Push handler.
//
// The server sends a JSON body: { title, message, identifier, payload }.
// We surface a system notification; clicking it focuses an existing Habitica
// window or opens a new one.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Habitica', message: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Habitica';
  const options = {
    body: data.message || '',
    icon: '/static/icons/favicon_192x192.png',
    badge: '/static/icons/favicon_192x192.png',
    tag: data.identifier || 'habitica',
    // renotify so stacked notifications with the same tag still ping
    renotify: true,
    data: { identifier: data.identifier, payload: data.payload || {} },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = allClients.find(c => c.url.includes(self.location.origin));
    if (existing) {
      await existing.focus();
      return;
    }
    await self.clients.openWindow('/');
  })());
});
