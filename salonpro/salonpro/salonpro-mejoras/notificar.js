// =====================================================
// notificar.js  ->  AVISOS AL CELULAR DEL CLIENTE (notificaciones push)
// Cuando la profesional confirma (o cancela) una cita, este archivo le envía
// la notificación al celular del cliente, si el cliente activó los avisos.
//
// Para que funcione necesitas (una sola vez):
//   1) npm install web-push
//   2) npx web-push generate-vapid-keys      -> te da una clave pública y una privada
//   3) Poner en .env (o en Variables de Railway):
//        VAPID_PUBLIC_KEY=...    VAPID_PRIVATE_KEY=...    VAPID_EMAIL=tu-correo@ejemplo.com
// Si falta algo de eso, el sistema funciona igual pero SIN notificaciones push
// (queda el botón de WhatsApp del panel).
// =====================================================
const db = require('./db');

let webpush = null;
try { webpush = require('web-push'); } catch (e) { /* web-push no está instalado */ }

const PUBLICA = process.env.VAPID_PUBLIC_KEY;
const PRIVADA = process.env.VAPID_PRIVATE_KEY;
const CORREO = process.env.VAPID_EMAIL || 'soporte@example.com';

const activo = Boolean(webpush && PUBLICA && PRIVADA);
if (activo) {
  webpush.setVapidDetails('mailto:' + CORREO.replace(/^mailto:/, ''), PUBLICA, PRIVADA);
  console.log('Notificaciones push: ACTIVAS');
} else if (PUBLICA || PRIVADA) {
  console.log('Notificaciones push: DESACTIVADAS (' + (webpush ? 'faltan claves VAPID' : 'falta ejecutar: npm install web-push') + ')');
}

// "2026-10-14" -> "miércoles, 14 de octubre"
const fechaBonita = (f) => new Date(f + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' });
// "13:30" -> "1:30 PM"
const hora12 = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
// Solo se envían avisos a los servidores oficiales de notificaciones de los navegadores
// (Chrome/Android, Firefox, Edge, Safari/iPhone). Así nadie puede registrar una dirección cualquiera
// y usar tu servidor para llamar a otros sitios.
const SERVIDORES_PUSH = ['fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];
function endpointPermitido(texto) {
  try {
    const u = new URL(texto);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    return SERVIDORES_PUSH.some((d) => h === d || h.endsWith('.' + d));
  } catch (e) { return false; }
}

const conLimite = (promesa, ms) => Promise.race([promesa, new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), ms))]);

// Envía el aviso de una cita. estado = 'confirmada' | 'cancelada' | 'recordatorio' (el de un día antes).
// Devuelve { enviados, total } (total = celulares suscritos a esa cita), o null si los avisos no están activos.
// NUNCA lanza error: si falla un envío, solo se registra en la consola.
async function avisarCita(citaId, estado) {
  if (!activo) return null;
  try {
    const c = db.prepare(`SELECT a.id, a.token, a.date, a.time, COALESCE((SELECT group_concat(s2.name, ' + ') FROM appointment_services x JOIN services s2 ON s2.id = x.service_id WHERE x.appointment_id = a.id), s.name) servicio, b.name barbero
                          FROM appointments a JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
                          WHERE a.id = ?`).get(citaId);
    if (!c) return { enviados: 0, total: 0 };
    const subs = db.prepare('SELECT id, data FROM push_subs WHERE appointment_id = ?').all(citaId);

    const detalle = `${c.servicio} con ${c.barbero} · ${fechaBonita(c.date)}, ${hora12(c.time)}`;
    const enlace = `/cita.html?id=${c.id}&t=${c.token}`;
    const avisos = {
      confirmada: { titulo: '✅ ¡Tu cita fue confirmada!', cuerpo: detalle + '. ¡Te esperamos!', url: enlace },
      recordatorio: { titulo: '⏰ Mañana tienes tu cita', cuerpo: detalle + '. ¡Te esperamos!', url: enlace },
      cancelada: { titulo: '❌ Tu cita fue cancelada', cuerpo: detalle + '. Puedes reservar otra cuando quieras.', url: '/reservar.html' },
    };
    const payload = JSON.stringify({ ...(avisos[estado] || avisos.cancelada), tag: 'cita-' + c.id });

    let enviados = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        const sub = JSON.parse(s.data);
        // Defensa extra: si por algún motivo hay una dirección que no es de un servidor oficial, se borra y no se usa
        if (!endpointPermitido(sub.endpoint)) { db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id); return; }
        await conLimite(webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 }), 8000);
        enviados++;
      } catch (e) {
        // 404/410 = el celular ya no acepta avisos (desinstaló o los bloqueó): se borra esa suscripción
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
        else console.error('No se pudo enviar el aviso push:', e.statusCode || e.message);
      }
    }));
    return { enviados, total: subs.length };
  } catch (e) {
    console.error('Error preparando aviso push:', e.message);
    return { enviados: 0, total: 0 };
  }
}

module.exports = { activo, clavePublica: PUBLICA, avisarCita, endpointPermitido };
