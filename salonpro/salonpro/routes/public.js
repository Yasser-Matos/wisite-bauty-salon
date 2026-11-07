// =====================================================
// routes/public.js  ->  RUTAS PARA LOS CLIENTES (sin login)
// Lo que usa la página de reservas (index.html).
// =====================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const notificar = require('../notificar');
const { horasDeBarbero, horarioBarbero, fechaLocal, aMinutos } = require('../utils');
const router = express.Router();

// Revisa que la fecha tenga formato AAAA-MM-DD
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '') && !isNaN(new Date(f + 'T00:00:00'));

// Minutos transcurridos hoy (para no ofrecer horas que ya pasaron)
const minutosAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

// ---- Lista de servicios activos (con precio) ----
router.get('/servicios', (req, res) => {
  res.json(db.prepare('SELECT id, name, price FROM services WHERE active = 1 ORDER BY id').all());
});

// ---- Lista de profesionales activas, con su horario de trabajo ----
router.get('/barberos', (req, res) => {
  const lista = db.prepare('SELECT * FROM barbers WHERE active = 1 ORDER BY id').all();
  res.json(lista.map((b) => ({ id: b.id, name: b.name, ...horarioBarbero(b) })));
});

// ---- Horas de un día para un barbero: [{hora:"09:00", disponible:true}, ...] ----
// Solo salen las horas del horario de ESE barbero. "disponible:false" = ya tomada o ya pasó.
// Si el barbero no trabaja ese día, devuelve una lista vacía.
router.get('/horas', (req, res) => {
  const { fecha, barbero_id } = req.query;
  if (!esFecha(fecha) || !barbero_id) return res.status(400).json({ error: 'Datos inválidos' });

  const barbero = db.prepare('SELECT * FROM barbers WHERE id = ? AND active = 1').get(barbero_id);
  if (!barbero) return res.status(404).json({ error: 'Profesional no encontrada' });

  const ocupadas = db
    .prepare("SELECT time FROM appointments WHERE barber_id = ? AND date = ? AND status <> 'cancelada'")
    .all(barbero.id, fecha)
    .map((r) => r.time);

  const hoy = fechaLocal();
  const horas = horasDeBarbero(barbero, fecha).map((hora) => {
    const pasada = fecha < hoy || (fecha === hoy && aMinutos(hora) <= minutosAhora());
    return { hora, disponible: !ocupadas.includes(hora) && !pasada };
  });
  res.json(horas);
});

// ---- Crear una cita (la reserva del cliente) ----
router.post('/citas', (req, res) => {
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
  const total = servicios.reduce((t, s) => t + s.price, 0);   // el precio de la cita es la suma de los servicios

  // La hora tiene que estar dentro del horario de ESE barbero ese día
  if (!horasDeBarbero(barbero, fecha).includes(hora)) {
    return res.status(400).json({ error: `${barbero.name} no atiende a esa hora o ese día. Elige otra.` });
  }
  if (fecha === fechaLocal() && aMinutos(hora) <= minutosAhora()) {
    return res.status(400).json({ error: 'Esa hora ya pasó. Elige otra.' });
  }

  try {
    // Todo se guarda junto: si algo falla, no queda nada a medias.
    // "token" = clave secreta de esta cita. Va dentro del enlace que recibe el cliente para ver el estado de SU cita.
    const token = crypto.randomBytes(16).toString('hex');
    const crear = db.transaction(() => {
      let cliente = db.prepare('SELECT id FROM clients WHERE phone = ?').get(tel);
      if (cliente) {
        db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(nom, cliente.id);
      } else {
        cliente = { id: db.prepare('INSERT INTO clients(name, phone) VALUES (?, ?)').run(nom, tel).lastInsertRowid };
      }
      const citaId = db
        .prepare('INSERT INTO appointments(client_id, service_id, barber_id, date, time, price, token) VALUES (?,?,?,?,?,?,?)')
        .run(cliente.id, servicios[0].id, barbero.id, fecha, hora, total, token).lastInsertRowid;
      const insS = db.prepare('INSERT INTO appointment_services(appointment_id, service_id, price) VALUES (?,?,?)');
      servicios.forEach((s) => insS.run(citaId, s.id, s.price));
      return citaId;
    });
    const id = crear();
    res.status(201).json({ ok: true, id, token, servicio: servicios.map((s) => s.name).join(' + '), total, barbero: barbero.name, fecha, hora });
  } catch (e) {
    // El índice único de db.js impide dos citas a la misma hora con el mismo barbero,
    // incluso si dos clientes pulsan "Reservar" en el mismo segundo.
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Esa hora acaba de ser tomada por otro cliente. Elige otra.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// =====================================================
// "MI CITA" Y AVISOS AL CELULAR DEL CLIENTE
// El cliente recibe un enlace privado (/cita.html?id=..&t=..) donde ve si su cita fue confirmada
// y puede activar los avisos en su celular. Sin el token correcto no se ve nada.
// =====================================================
const TOKEN_OK = /^[a-f0-9]{32}$/;

function citaPorToken(id, t) {
  if (!/^\d{1,10}$/.test(String(id || '')) || !TOKEN_OK.test(String(t || ''))) return null;
  return db.prepare(`SELECT a.id, a.date, a.time, a.status, a.price total, COALESCE((SELECT group_concat(s2.name, ' + ') FROM appointment_services x JOIN services s2 ON s2.id = x.service_id WHERE x.appointment_id = a.id), s.name) servicio, b.name barbero
                     FROM appointments a JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
                     WHERE a.id = ? AND a.token = ?`).get(Number(id), String(t)) || null;
}

// La página pregunta si los avisos están activos (para mostrar o no el botón "Avisarme") y trae la clave pública
router.get('/push-config', (req, res) => {
  res.json({ activo: notificar.activo, clave: notificar.activo ? notificar.clavePublica : null });
});

// Estado de una cita (solo con id + token correctos)
router.get('/mi-cita', (req, res) => {
  const c = citaPorToken(req.query.id, req.query.t);
  if (!c) return res.status(404).json({ error: 'No encontramos esa cita. Revisa que el enlace esté completo.' });
  res.json({ ...c, negocio: process.env.NEGOCIO || 'Beauty Salon' });
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
