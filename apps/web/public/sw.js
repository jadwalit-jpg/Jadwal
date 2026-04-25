/**
 * Jadwal Service Worker — handles push notifications.
 * This file MUST be in /public/ (served from root /).
 *
 * SECURITY:
 * - Only processes push events (no fetch interception, no caching)
 * - Notification click only navigates to relative URLs (no open redirect)
 * - No sensitive data in push payload (enforced by backend)
 */

/* eslint-disable no-restricted-globals */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return; // Malformed payload — ignore silently
  }

  const title = data.title || 'Jadwal';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-72.png',
    data: { url: data.url || '/' },
    tag: data.tag || 'jadwal-notification', // Group similar notifications
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  // Security: only navigate to relative paths (no external URLs)
  if (!url.startsWith('/')) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    }),
  );
});
