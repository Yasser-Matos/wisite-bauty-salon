// =====================================================
// utils.js  ->  FUNCIONES DE AYUDA (fechas y horas)
// =====================================================
const { HORARIO } = require('./config');

// Devuelve una fecha local en formato AAAA-MM-DD.
// fechaLocal() = hoy, fechaLocal(1) = mañana, fechaLocal(-1) = ayer
function fechaLocal(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// "13:30" -> 810 (minutos desde la medianoche)
const aMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Genera la lista de horas entre "inicio" y "fin" (formato "HH:MM") cada HORARIO.intervaloMin minutos.
// Si no le pasas inicio/fin, usa el horario general de config.js.
// La hora de "fin" NO se ofrece (es la hora de cierre): de 09:00 a 19:00 la última cita es 18:00 si el intervalo es 60.
function generarHoras(inicio, fin) {
  const desde = inicio ? aMinutos(inicio) : HORARIO.apertura * 60;
  const hasta = fin ? aMinutos(fin) : HORARIO.cierre * 60;
  const horas = [];
  for (let min = desde; min < hasta; min += HORARIO.intervaloMin) {
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    horas.push(`${h}:${m}`);
  }
  return horas;
}

// Horario de trabajo de un barbero: { inicio: "09:00", fin: "19:00", dias: [0..6] }  (0 = domingo)
// Si el barbero no tiene horario propio, usa el de config.js y trabaja todos los días.
function horarioBarbero(b = {}) {
  const pad = (n) => String(n).padStart(2, '0') + ':00';
  const dias = (b.days == null || b.days === '' ? '0,1,2,3,4,5,6' : String(b.days))
    .split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return {
    inicio: b.start_time || pad(HORARIO.apertura),
    fin: b.end_time || pad(HORARIO.cierre),
    dias,
  };
}

// Todas las horas que ese barbero atiende en una fecha (AAAA-MM-DD). Si ese día no trabaja, devuelve [].
function horasDeBarbero(b, fecha) {
  const h = horarioBarbero(b);
  const diaSemana = new Date(fecha + 'T00:00:00').getDay();
  if (!h.dias.includes(diaSemana)) return [];
  return generarHoras(h.inicio, h.fin);
}

module.exports = { fechaLocal, generarHoras, horarioBarbero, horasDeBarbero, aMinutos };
