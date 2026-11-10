// =====================================================
// push.js  ->  AVISOS EN EL CELULAR DEL CLIENTE (parte del navegador)
// Lo usan reservar.html (justo después de reservar) y cita.html ("Mi cita").
// Hace tres cosas: registra la mini-app (sw.js), pide permiso para notificar
// y le manda al servidor la "dirección" del celular de este cliente para su cita.
// Si el servidor no tiene los avisos activos, no se muestra ningún botón.
// =====================================================
const Push = (() => {
  let _cfg = null;

  // ¿Están activos los avisos en el servidor?  ->  { activo, clave }
  async function config() {
    if (_cfg) return _cfg;
    try { _cfg = await (await fetch('/api/push-config')).json(); } catch (e) { _cfg = { activo: false, clave: null }; }
    return _cfg;
  }

  const soportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // La clave pública viene en texto (base64); el navegador la pide en bytes
  function aBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  const igual = (buf, bytes) => {
    if (!buf) return false;
    const a = new Uint8Array(buf);
    return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
  };

  // Registra sw.js: el programita que recibe los avisos aunque la página esté cerrada
  async function registrar() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/sw.js'); } catch (e) { return null; }
  }

  // Activa los avisos de una cita.  ->  { ok: true }  o  { ok: false, mensaje: '...' }
  async function activar(id, token) {
    const cfg = await config();
    if (!cfg.activo) return { ok: false, mensaje: 'Los avisos no están disponibles por ahora.' };
    if (!soportado()) {
      return { ok: false, mensaje: esIOS() && !instalada()
        ? 'En iPhone primero instala la página: toca el botón Compartir y elige "Agregar a pantalla de inicio". Ábrela desde ese ícono y activa los avisos.'
        : 'Este navegador no permite avisos. Guarda el enlace de tu cita para ver si ya fue confirmada.' };
    }
    if (Notification.permission === 'denied') {
      return { ok: false, mensaje: 'Tienes los avisos bloqueados en este navegador. Actívalos en los ajustes del sitio y vuelve a intentar.' };
    }
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') return { ok: false, mensaje: 'No diste permiso para los avisos.' };
      if (!(await registrar())) return { ok: false, mensaje: 'No se pudo preparar los avisos en este navegador.' };
      const reg = await navigator.serviceWorker.ready;

      const clave = aBytes(cfg.clave);
      let sub = await reg.pushManager.getSubscription();
      // Si el celular quedó suscrito con otra clave (por ejemplo, se cambiaron las claves del servidor), se renueva
      if (sub && !igual(sub.options && sub.options.applicationServerKey, clave)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });

      const r = await fetch('/api/mi-cita/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, t: token, subscription: sub.toJSON() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, mensaje: j.error || 'No se pudo activar el aviso.' };
      return { ok: true };
    } catch (e) {
      return { ok: false, mensaje: 'No se pudo activar el aviso en este dispositivo.' };
    }
  }

  // Conecta un botón con la activación y muestra el resultado en un texto
  async function activarDesdeBoton(id, token, boton, texto) {
    boton.disabled = true; texto.textContent = 'Activando…';
    const r = await activar(id, token);
    if (r.ok) {
      boton.textContent = '🔔 Avisos activados en este celular';
      texto.textContent = 'Listo: te llegará una notificación cuando el salón confirme tu cita.';
      try { localStorage.setItem('bp_avisos_' + id, '1'); } catch (e) { /* sin almacenamiento: no pasa nada */ }
    } else {
      boton.disabled = false; texto.textContent = r.mensaje;
    }
  }

  return { config, soportado, esIOS, instalada, registrar, activar, activarDesdeBoton };
})();
