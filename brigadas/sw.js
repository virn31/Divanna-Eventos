const CACHE_NAME = 'dima-brigadas-v9';
const APP_SHELL = [
  '/brigadas/',
  '/brigadas/index.html',
  '/brigadas/manifest.json',
  '/brigadas/icon-192.png',
  '/brigadas/icon-512.png',
  '/brigadas/alertas.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Nunca cachear llamadas a la API: siempre deben ir a la red.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---------- Alertas push (emergencias y seguridad) ----------
// Suenan y vibran aunque la app esté cerrada o el teléfono bloqueado. El
// sonido es el de notificaciones del teléfono; requireInteraction hace que
// la alerta se quede en pantalla hasta que alguien la toque.
self.addEventListener('push', (event) => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch (e) { datos = { cuerpo: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(datos.titulo || 'Alerta del equipo', {
      body: datos.cuerpo || '',
      icon: '/brigadas/icon-192.png',
      badge: '/brigadas/icon-192.png',
      vibrate: [600, 200, 600, 200, 600, 200, 600],
      requireInteraction: true,
      renotify: true,
      tag: 'alerta-' + Date.now(),
      data: { url: datos.url || '/brigadas/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/brigadas/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      // Un link externo (el mapa de la emergencia) se abre aparte; la app, en su ventana.
      if (!url.startsWith('/')) return self.clients.openWindow(url);
      const abierta = ventanas.find((v) => v.url.includes('/brigadas/'));
      if (abierta) { abierta.navigate(url).catch(() => {}); return abierta.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
