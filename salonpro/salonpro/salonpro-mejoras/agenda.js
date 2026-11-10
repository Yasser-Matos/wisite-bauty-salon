// =====================================================
// agenda.js  ->  DISPONIBILIDAD DE HORAS (con la duración de cada cita)
// Una cita ocupa desde su hora de inicio hasta (inicio + duración en minutos).
// Una hora se puede ofrecer si la cita completa cabe antes de que la profesional termine su día
// y no se cruza con otra cita de esa misma profesional.
// =====================================================
const db = require('./db');
const { horasDeBarbero, horarioBarbero, aMinutos, fechaLocal } = require('./utils');

const DURACION_POR_DEFECTO = 60;   // minutos, si no se indica otra

// Minutos transcurridos hoy (para no ofrecer horas que ya pasaron)
const minutosAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// ¿Se cruza una cita que empieza en "ini" y dura "dur" con alguna cita existente de esa profesional ese día?
// ignorarId = id de una cita que no cuenta (la que se está cambiando de hora).
function hayChoque(barberoId, fecha, ini, dur, ignorarId = 0) {
  const citas = db.prepare("SELECT time, duration FROM appointments WHERE barber_id = ? AND date = ? AND status <> 'cancelada' AND id <> ?")
    .all(barberoId, fecha, ignorarId);
  return citas.some((c) => {
    const cIni = aMinutos(c.time), cFin = cIni + (Number(c.duration) || DURACION_POR_DEFECTO);
    return ini < cFin && cIni < ini + dur;
  });
}

// ¿La cita completa cabe dentro del horario de esa profesional ese día? (hora de inicio + duración <= hora de salida)
function cabeEnHorario(barbero, hora, dur) {
  return aMinutos(hora) + dur <= aMinutos(horarioBarbero(barbero).fin);
}

// Lista de horas del día: [{ hora: "09:00", disponible: true|false }, ...]
function horasLibres(barbero, fecha, dur = DURACION_POR_DEFECTO, ignorarId = 0) {
  const hoy = fechaLocal();
  return horasDeBarbero(barbero, fecha).map((hora) => {
    const pasada = fecha < hoy || (fecha === hoy && aMinutos(hora) <= minutosAhora());
    const disponible = !pasada && cabeEnHorario(barbero, hora, dur) && !hayChoque(barbero.id, fecha, aMinutos(hora), dur, ignorarId);
    return { hora, disponible };
  });
}

module.exports = { DURACION_POR_DEFECTO, hayChoque, cabeEnHorario, horasLibres, minutosAhora };
