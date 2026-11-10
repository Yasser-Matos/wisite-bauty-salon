// =====================================================
// recordatorios.js  ->  RECORDATORIO AUTOMÁTICO UN DÍA ANTES
// Cada 10 minutos revisa las citas CONFIRMADAS de mañana. Cuando ya pasó la hora de envío del día
// anterior (por defecto las 5:00 PM), le manda una notificación al celular del cliente
// (solo si activó los avisos) y marca la cita para no repetirlo.
// Para quien no tiene los avisos activados, en el panel (Citas -> Mañana) sale el botón
// "Recordar" que abre WhatsApp con el mensaje listo.
// PARA CAMBIAR LA HORA: variable RECORDATORIO_HORA (0 a 23). Ej: RECORDATORIO_HORA=18 -> 6:00 PM.
// =====================================================
const db = require('./db');
const notificar = require('./notificar');
const { fechaLocal } = require('./utils');

const HORA_ENVIO = Math.min(23, Math.max(0, Number(process.env.RECORDATORIO_HORA ?? 17)));
let ocupado = false;

async function enviarPendientes() {
  if (ocupado || new Date().getHours() < HORA_ENVIO) return;
  ocupado = true;
  try {
    const citas = db.prepare("SELECT id FROM appointments WHERE date = ? AND status = 'confirmada' AND reminded = 0").all(fechaLocal(1));
    for (const c of citas) {
      await notificar.avisarCita(c.id, 'recordatorio');   // nunca lanza error
      db.prepare('UPDATE appointments SET reminded = 1 WHERE id = ?').run(c.id);
    }
  } catch (e) {
    console.error('Error en recordatorios:', e.message);
  } finally { ocupado = false; }
}

function iniciar() {
  setTimeout(enviarPendientes, 20 * 1000).unref();
  setInterval(enviarPendientes, 10 * 60 * 1000).unref();
}

module.exports = { iniciar, enviarPendientes };
