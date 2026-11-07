// =====================================================
// sw.js  ->  "SERVICE WORKER": recibe los avisos del celular aunque la página esté cerrada
// El servidor (notificar.js) envía un mensaje con { titulo, cuerpo, url, tag }.
// Aquí se convierte en la notificación que ve el cliente, y al tocarla se abre su cita.
// PARA CAMBIAR EL ÍCONO de la notificación: cambia las rutas /icons/... de abajo.
// =====================================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { cuerpo: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.titulo || 'Beauty Salon', {
    body: d.cuerpo || '',
    tag: d.tag,                       // la misma cita reemplaza su aviso anterior en vez de apilarlo
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'es',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    for (const v of ventanas) { if (v.url === url && 'focus' in v) return v.focus(); }
    return self.clients.openWindow(url);
  }));
});
