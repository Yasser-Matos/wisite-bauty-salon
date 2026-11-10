// =====================================================
// routes/public.js  ->  RUTAS PARA LOS CLIENTES (sin login)
// Lo que usan la página de inicio (index.html), la de reservas (reservar.html) y "Mi cita" (cita.html).
// =====================================================
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const notificar = require('../notificar');
const limite = require('../limite');
const agenda = require('../agenda');
const { horasDeBarbero, horarioBarbero, fechaLocal, aMinutos } = require('../utils');
const { UPLOADS_DIR } = require('../rutas');
const router = express.Router();

// Revisa que la fecha tenga formato AAAA-MM-DD
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '') && !isNaN(new Date(f + 'T00:00:00'));

// Una clienta puede cambiar o cancelar su cita en línea hasta X horas antes (si falta menos, debe llamar al salón).
// PARA CAMBIARLO: variable HORAS_ANTES_CANCELAR (por defecto 2).
const HORAS_ANTES = Number(process.env.HORAS_ANTES_CANCELAR ?? 2);

// ---- Lista de servicios activos (con precio y duración en minutos) ----
router.get('/servicios', (req, res) => {
  res.json(db.prepare('SELECT id, name, price, duration_min duracion FROM services WHERE active = 1 ORDER BY id').all());
});

// ---- Fotos de los trabajos ----
// Son las que subes desde el panel (sección Fotos) más las que pongas en la carpeta public/fotos.
router.get('/fotos', (req, res) => {
  const subidas = db.prepare('SELECT filename FROM photos ORDER BY id DESC LIMIT 60').all()
    .filter((f) => fs.existsSync(path.join(UPLOADS_DIR, f.filename)))
    .map((f) => ({ src: '/fotos/' + encodeURIComponent(f.filename) }));
  let enCarpeta = [];
  try {
    enCarpeta = fs.readdirSync(path.join(__dirname, '..', 'public', 'fotos'))
      .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .sort((x, y) => x.localeCompare(y, 'es', { numeric: true }))
      .map((f) => ({ src: '/fotos/' + encodeURIComponent(f) }));
  } catch (e) { /* la carpeta no existe: no hay fotos ahí */ }
  res.json([...subidas, ...enCarpeta].slice(0, 60));
});

// ---- Promociones activas (página de inicio) ----
router.get('/promociones', (req, res) => {
  res.json(db.prepare('SELECT id, title, description, price_text FROM promotions WHERE active = 1 ORDER BY id DESC LIMIT 12').all());
});

// ---- Reseñas publicadas (página de inicio) y su promedio ----
router.get('/resenas', (req, res) => {
  const lista = db.prepare("SELECT name, rating, text, substr(created_at,1,10) fecha FROM reviews WHERE status = 'publicada' ORDER BY id DESC LIMIT 12").all();
  const r = db.prepare("SELECT COUNT(*) n, COALESCE(AVG(rating),0) prom FROM reviews WHERE status = 'publicada'").get();
  res.json({ lista, total: r.n, promedio: Math.round(r.prom * 10) / 10 });
});

// ---- Lista de profesionales activas, con su horario de trabajo ----
router.get('/barberos', (req, res) => {
  const lista = db.prepare('SELECT * FROM barbers WHERE active = 1 ORDER BY id').all();
  res.json(lista.map((b) => ({ id: b.id, name: b.name, ...horarioBarbero(b) })));
});

// Duración (minutos) que pide la página: entre 15 y 600, por defecto 60
const leerDuracion = (v) => { const n = Math.round(Number(v)); return n >= 15 && n <= 600 ? n : agenda.DURACION_POR_DEFECTO; };

// ---- Horas de un día para una profesional: [{hora:"09:00", disponible:true}, ...] ----
// "duracion" = minutos que dura lo que la clienta eligió. Una hora solo está disponible si TODA la cita cabe
// (sin cruzarse con otra cita ni pasar de la hora de salida de la profesional).
router.get('/horas', (req, res) => {
  const { fecha, barbero_id } = req.query;
  if (!esFecha(fecha) || !barbero_id) return res.status(400).json({ error: 'Datos inválidos' });
  const barbero = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barbero_id);
  if (!barbero) return res.status(404).json({ error: 'Profesional no encontrada' });
  res.json(agenda.horasLibres(barbero, fecha, leerDuracion(req.query.duracion)));
});

// ---- Crear una cita (la reserva del cliente) ----
router.post('/citas', (req, res) => {
  if (!limite.permitir('reservar', req, 20)) return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' });
  // servicios_ids = lista de servicios elegidos (ej: [1,6]). Por compatibilidad también se acepta servicio_id (uno solo).
  const { nombre, telefono, servicios_ids, servicio_id, barbero_id, fecha, hora } = req.body || {};
  const nom = String(nombre || '').trim().slice(0, 80);
  const tel = String(telefono || '').replace(/\D/g, '');   // solo números, para identificar al cliente

  if (!nom || tel.length < 7) return res.status(400).json({ error: 'Escribe tu nombre y un teléfono válido.' });
  if (!esFecha(fecha) || fecha < fechaLocal()) return res.status(400).json({ error: 'Fecha inválida.' });

  // Servicios elegidos: sin repetidos, entre 1 y 6, todos activos
  const ids = [...new Set((Array.isArray(servicios_ids) ? servicios_ids : [servicio_id]).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length || ids.length > 6) return res.status(400).json({ error: 'Elige entre 1 y 6 servicios.' });
  const servicios = ids.map((i) => db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(i));
  const barbero = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barbero_id);
  if (servicios.some((s) => !s) || !barbero) return res.status(400).json({ error: 'Servicio o profesional inválido.' });
  const total = servicios.reduce((t, s) => t + s.price, 0);                          // el precio de la cita es la suma de los servicios
  const duracion = servicios.reduce((t, s) => t + (Number(s.duration_min) || 60), 0);   // la duración también (la calcula el servidor)

  // La hora tiene que estar dentro del horario de ESA profesional ese día
  if (!horasDeBarbero(barbero, fecha).includes(hora)) {
    return res.status(400).json({ error: `${barbero.name} no atiende a esa hora o ese día. Elige otra.` });
  }
  if (fecha === fechaLocal() && aMinutos(hora) <= agenda.minutosAhora()) {
    return res.status(400).json({ error: 'Esa hora ya pasó. Elige otra.' });
  }
  if (!agenda.cabeEnHorario(barbero, hora, duracion)) {
    return res.status(400).json({ error: 'Tus servicios duran más de lo que queda de día con esa profesional. Elige una hora más temprano.' });
  }

  try {
    // Todo se guarda junto: si algo falla, no queda nada a medias.
    // "token" = clave secreta de esta cita. Va dentro del enlace que recibe el cliente para ver el estado de SU cita.
    const token = crypto.randomBytes(16).toString('hex');
    const crear = db.transaction(() => {
      // Revisión de cruces dentro de la misma operación, para que dos reservas simultáneas no se pisen
      if (agenda.hayChoque(barbero.id, fecha, aMinutos(hora), duracion)) { const e = new Error('choque'); e.code = 'SQLITE_CONSTRAINT_CHOQUE'; throw e; }
      let cliente = db.prepare('SELECT id FROM clients WHERE phone = ?').get(tel);
      if (cliente) {
        db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(nom, cliente.id);
      } else {
        cliente = { id: db.prepare('INSERT INTO clients(name, phone) VALUES (?, ?)').run(nom, tel).lastInsertRowid };
      }
      const citaId = db
        .prepare('INSERT INTO appointments(client_id, service_id, barber_id, date, time, price, token, duration) VALUES (?,?,?,?,?,?,?,?)')
        .run(cliente.id, servicios[0].id, barbero.id, fecha, hora, total, token, duracion).lastInsertRowid;
      const insS = db.prepare('INSERT INTO appointment_services(appointment_id, service_id, price) VALUES (?,?,?)');
      servicios.forEach((s) => insS.run(citaId, s.id, s.price));
      return citaId;
    });
    const id = crear();
    res.status(201).json({ ok: true, id, token, servicio: servicios.map((s) => s.name).join(' + '), total, duracion, barbero: barbero.name, fecha, hora });
  } catch (e) {
    // El índice único de db.js y la revisión de cruces impiden dos citas a la misma hora con la misma profesional,
    // incluso si dos clientes pulsan "Reservar" en el mismo segundo.
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Esa hora acaba de ser tomada por otro cliente. Elige otra.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// =====================================================
// "MI CITA": VER, CAMBIAR, CANCELAR Y DEJAR RESEÑA
// La clienta recibe un enlace privado (/cita.html?id=..&t=..). Sin el token correcto no se ve ni se cambia nada.
// =====================================================
const TOKEN_OK = /^[a-f0-9]{32}$/;

function citaPorToken(id, t) {
  if (!/^\d{1,10}$/.test(String(id || '')) || !TOKEN_OK.test(String(t || ''))) return null;
  return db.prepare(`SELECT a.id, a.date, a.time, a.status, a.price total, a.duration, a.barber_id,
                            COALESCE((SELECT group_concat(s2.name, ' + ') FROM appointment_services x JOIN services s2 ON s2.id = x.service_id WHERE x.appointment_id = a.id), s.name) servicio,
                            b.name barbero, c.name cliente,
                            (SELECT status FROM reviews r WHERE r.appointment_id = a.id) resena
                     FROM appointments a JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id JOIN clients c ON c.id = a.client_id
                     WHERE a.id = ? AND a.token = ?`).get(Number(id), String(t)) || null;
}

// ¿Todavía se puede cambiar o cancelar en línea? (cita activa y falta al menos HORAS_ANTES horas)
function sePuedeCambiar(c) {
  if (c.status !== 'pendiente' && c.status !== 'confirmada') return false;
  const inicio = new Date(`${c.date}T${c.time}:00`).getTime();
  return inicio - Date.now() >= HORAS_ANTES * 3600 * 1000;
}

// La página pregunta si los avisos están activos (para mostrar o no el botón "Avisarme") y trae la clave pública
router.get('/push-config', (req, res) => {
  res.json({ activo: notificar.activo, clave: notificar.activo ? notificar.clavePublica : null });
});

// Estado de una cita (solo con id + token correctos)
router.get('/mi-cita', (req, res) => {
  const c = citaPorToken(req.query.id, req.query.t);
  if (!c) return res.status(404).json({ error: 'No encontramos esa cita. Revisa que el enlace esté completo.' });
  const { barber_id, cliente, resena, ...pub } = c;
  res.json({ ...pub, negocio: process.env.NEGOCIO || 'Beauty Salon', puede_cambiar: sePuedeCambiar(c), horas_antes: HORAS_ANTES, resena: resena || null });
});

// Horas libres para cambiar esta cita de fecha u hora (misma profesional y misma duración; la propia cita no cuenta como ocupada)
router.get('/mi-cita/horas', (req, res) => {
  const c = citaPorToken(req.query.id, req.query.t);
  if (!c) return res.status(404).json({ error: 'Cita no encontrada.' });
  if (!esFecha(req.query.fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
  const barbero = db.prepare('SELECT * FROM barbers WHERE id = ?').get(c.barber_id);
  res.json(agenda.horasLibres(barbero, req.query.fecha, c.duration, c.id));
});

// Cancelar la cita
router.post('/mi-cita/cancelar', (req, res) => {
  if (!limite.permitir('cambiar-cita', req, 30)) return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const c = citaPorToken((req.body || {}).id, (req.body || {}).t);
  if (!c) return res.status(404).json({ error: 'Cita no encontrada.' });
  if (!sePuedeCambiar(c)) return res.status(409).json({ error: `Ya no se puede cancelar en línea (faltan menos de ${HORAS_ANTES} horas o la cita ya no está activa). Comunícate con el salón.` });
  db.prepare("UPDATE appointments SET status = 'cancelada' WHERE id = ?").run(c.id);
  res.json({ ok: true });
});

// Cambiar fecha y/o hora. La cita vuelve a "pendiente" para que el salón la confirme de nuevo.
router.post('/mi-cita/reprogramar', (req, res) => {
  if (!limite.permitir('cambiar-cita', req, 30)) return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const { id, t, fecha, hora } = req.body || {};
  const c = citaPorToken(id, t);
  if (!c) return res.status(404).json({ error: 'Cita no encontrada.' });
  if (!sePuedeCambiar(c)) return res.status(409).json({ error: `Ya no se puede cambiar en línea (faltan menos de ${HORAS_ANTES} horas o la cita ya no está activa). Comunícate con el salón.` });
  if (!esFecha(fecha) || fecha < fechaLocal()) return res.status(400).json({ error: 'Fecha inválida.' });

  const barbero = db.prepare('SELECT * FROM barbers WHERE id = ?').get(c.barber_id);
  if (!horasDeBarbero(barbero, fecha).includes(hora)) return res.status(400).json({ error: `${barbero.name} no atiende a esa hora o ese día. Elige otra.` });
  if (new Date(`${fecha}T${hora}:00`).getTime() - Date.now() < HORAS_ANTES * 3600 * 1000) {
    return res.status(400).json({ error: `Elige una hora con al menos ${HORAS_ANTES} horas de anticipación.` });
  }
  if (!agenda.cabeEnHorario(barbero, hora, c.duration)) return res.status(400).json({ error: 'Esa hora no alcanza para la duración de tu cita. Elige una más temprano.' });

  try {
    db.transaction(() => {
      if (agenda.hayChoque(barbero.id, fecha, aMinutos(hora), c.duration, c.id)) { const e = new Error('choque'); e.code = 'SQLITE_CONSTRAINT_CHOQUE'; throw e; }
      db.prepare("UPDATE appointments SET date = ?, time = ?, status = 'pendiente', reminded = 0 WHERE id = ?").run(fecha, hora, c.id);
    })();
    res.json({ ok: true });
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Esa hora acaba de ser tomada por otra clienta. Elige otra.' });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Dejar una reseña (solo cuando la cita está COMPLETADA y solo una vez). Queda pendiente hasta que la apruebes en el panel.
router.post('/mi-cita/resena', (req, res) => {
  if (!limite.permitir('resena', req, 10)) return res.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
  const { id, t, rating, texto } = req.body || {};
  const c = citaPorToken(id, t);
  if (!c) return res.status(404).json({ error: 'Cita no encontrada.' });
  if (c.status !== 'completada') return res.status(409).json({ error: 'Podrás dejar tu reseña cuando tu cita esté completada.' });
  if (c.resena) return res.status(409).json({ error: 'Ya dejaste tu reseña. ¡Gracias!' });
  const estrellas = Number(rating);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) return res.status(400).json({ error: 'Elige de 1 a 5 estrellas.' });
  const nombre = String(c.cliente).trim().split(/\s+/)[0].slice(0, 30) || 'Clienta';   // solo el primer nombre, por privacidad
  db.prepare('INSERT INTO reviews(appointment_id, name, rating, text) VALUES (?,?,?,?)').run(c.id, nombre, estrellas, String(texto || '').trim().slice(0, 400));
  res.status(201).json({ ok: true });
});

// El celular del cliente se suscribe a los avisos de SU cita
router.post('/mi-cita/push', (req, res) => {
  if (!notificar.activo) return res.status(503).json({ error: 'Los avisos no están activos en este momento.' });
  const { id, t, subscription: s } = req.body || {};
  const c = citaPorToken(id, t);
  if (!c) return res.status(404).json({ error: 'Cita no encontrada.' });
  if (c.status === 'cancelada' || c.status === 'completada') {
    return res.status(409).json({ error: 'Esta cita ya no necesita avisos.' });
  }
  const valida = s && typeof s.endpoint === 'string' && s.endpoint.length <= 1000 &&
    s.keys && /^[A-Za-z0-9_-]{20,200}$/.test(String(s.keys.p256dh || '')) && /^[A-Za-z0-9_-]{8,100}$/.test(String(s.keys.auth || ''));
  if (!valida || !notificar.endpointPermitido(s.endpoint)) return res.status(400).json({ error: 'Suscripción no válida.' });

  const ya = db.prepare('SELECT 1 x FROM push_subs WHERE appointment_id = ? AND endpoint = ?').get(c.id, s.endpoint);
  if (!ya) {
    const n = db.prepare('SELECT COUNT(*) n FROM push_subs WHERE appointment_id = ?').get(c.id).n;
    if (n >= 5) return res.status(409).json({ error: 'Esta cita ya tiene demasiados dispositivos con avisos.' });
    db.prepare('INSERT INTO push_subs(appointment_id, endpoint, data) VALUES (?,?,?)')
      .run(c.id, s.endpoint, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }));
  }
  res.json({ ok: true });
});

module.exports = router;
