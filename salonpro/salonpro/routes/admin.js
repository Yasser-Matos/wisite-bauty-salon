// =====================================================
// routes/admin.js  ->  RUTAS DEL ADMINISTRADOR
// Login + todo lo que muestra el panel (dashboard, citas, clientes,
// gastos, servicios y barberos). Todas, menos /login, exigen token.
// =====================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireAdmin = require('../middleware/auth');
const notificar = require('../notificar');
const { JWT_SECRET, MONEDA } = require('../config');
const { fechaLocal, horarioBarbero } = require('../utils');
const router = express.Router();

const ESTADOS = ['pendiente', 'confirmada', 'completada', 'cancelada'];
const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

// ---------- LOGIN (público) ----------
router.post('/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  const admin = get('SELECT * FROM admins WHERE username = ?', String(usuario || ''));
  if (!admin || !bcrypt.compareSync(String(clave || ''), admin.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  // El token dura 12 horas; después hay que volver a entrar.
  const token = jwt.sign({ id: admin.id, user: admin.username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, usuario: admin.username, role: admin.role });
});

// A partir de aquí, todo requiere estar logueado (administrador o empleado)
router.use(requireAdmin);

// Rutas que MODIFICAN datos usan "soloAdmin": el empleado (role "staff") recibe error 403.
// El empleado solo puede ver todo y confirmar citas pendientes.
const soloAdmin = requireAdmin.soloAdmin;

// Quién soy (el panel lo usa para ocultar los botones que el empleado no puede usar)
// negocio / codigo_pais: se usan para armar el mensaje y el enlace de WhatsApp (se cambian con las variables NEGOCIO y CODIGO_PAIS)
router.get('/yo', (req, res) => res.json({
  usuario: req.admin.user, role: req.admin.role,
  negocio: process.env.NEGOCIO || 'Beauty Salon',
  codigo_pais: process.env.CODIGO_PAIS || '1',   // 1 = República Dominicana / EE.UU.
  avisos: notificar.activo,
}));

// ---------- DASHBOARD: números de la pantalla principal ----------
router.get('/dashboard', (req, res) => {
  const hoy = fechaLocal();
  const manana = fechaLocal(1);
  const mes = hoy.slice(0, 7) + '%';   // ej: "2026-10%"

  const ingresosDia = (f) => get("SELECT COALESCE(SUM(price),0) s FROM appointments WHERE date = ? AND status = 'completada'", f).s;
  const ingresosMes = get("SELECT COALESCE(SUM(price),0) s FROM appointments WHERE date LIKE ? AND status = 'completada'", mes).s;
  const gastosMes = get('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date LIKE ?', mes).s;

  // Ingresos de los últimos 7 días (para la gráfica)
  const ultimos7 = [];
  for (let i = -6; i <= 0; i++) {
    const f = fechaLocal(i);
    const dia = new Date(f + 'T00:00:00').getDay();
    ultimos7.push({ fecha: f, dia: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dia], total: ingresosDia(f) });
  }

  // Servicios más solicitados (porcentaje sobre las citas no canceladas)
  const topRaw = all(`SELECT s.name, COUNT(*) n FROM appointment_services x JOIN appointments a ON a.id = x.appointment_id
                      JOIN services s ON s.id = x.service_id
                      WHERE a.status <> 'cancelada' GROUP BY s.id ORDER BY n DESC LIMIT 5`);
  const totalTop = get("SELECT COUNT(*) n FROM appointments WHERE status <> 'cancelada'").n || 1;
  const topServicios = topRaw.map((r) => ({ nombre: r.name, cantidad: r.n, pct: Math.round((r.n / totalTop) * 100) }));

  // Citas agrupadas por estado (para la dona)
  const porEstado = {};
  ESTADOS.forEach((e) => (porEstado[e] = 0));
  all('SELECT status, COUNT(*) n FROM appointments GROUP BY status').forEach((r) => (porEstado[r.status] = r.n));

  // Citas de hoy en orden de hora (lista "Próximas citas")
  const citasHoy = all(`SELECT a.id, a.time, a.status, c.name cliente, COALESCE((SELECT group_concat(s2.name, ' + ') FROM appointment_services x JOIN services s2 ON s2.id = x.service_id WHERE x.appointment_id = a.id), s.name) servicio, b.name barbero
                        FROM appointments a JOIN clients c ON c.id = a.client_id
                        JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
                        WHERE a.date = ? AND a.status <> 'cancelada' ORDER BY a.time`, hoy);

  res.json({
    moneda: MONEDA,
    citas_hoy: get("SELECT COUNT(*) n FROM appointments WHERE date = ? AND status <> 'cancelada'", hoy).n,
    citas_manana: get("SELECT COUNT(*) n FROM appointments WHERE date = ? AND status <> 'cancelada'", manana).n,
    clientes_total: get('SELECT COUNT(*) n FROM clients').n,
    clientes_nuevos_mes: get('SELECT COUNT(*) n FROM clients WHERE created_at LIKE ?', mes).n,
    citas_completadas: get("SELECT COUNT(*) n FROM appointments WHERE status = 'completada'").n,
    ingresos_hoy: ingresosDia(hoy),
    ingresos_mes: ingresosMes,
    gastos_mes: gastosMes,
    ganancia_mes: ingresosMes - gastosMes,
    ultimos7,
    top_servicios: topServicios,
    por_estado: porEstado,
    citas_hoy_lista: citasHoy,
  });
});

// ---------- CITAS ----------
// /api/admin/citas?filtro=hoy | manana | todas
router.get('/citas', (req, res) => {
  const filtro = req.query.filtro || 'hoy';
  let where = '1=1', params = [];
  if (filtro === 'hoy') { where = 'a.date = ?'; params = [fechaLocal()]; }
  if (filtro === 'manana') { where = 'a.date = ?'; params = [fechaLocal(1)]; }
  res.json(all(`SELECT a.id, a.date, a.time, a.status, a.price, c.name cliente, c.phone telefono,
                       COALESCE((SELECT group_concat(s2.name, ' + ') FROM appointment_services x JOIN services s2 ON s2.id = x.service_id WHERE x.appointment_id = a.id), s.name) servicio, b.name barbero,
                       (SELECT COUNT(*) FROM push_subs p WHERE p.appointment_id = a.id) avisos
                FROM appointments a JOIN clients c ON c.id = a.client_id
                JOIN services s ON s.id = a.service_id JOIN barbers b ON b.id = a.barber_id
                WHERE ${where} ORDER BY a.date DESC, a.time ASC LIMIT 500`, ...params));
});

// Cambiar el estado de una cita (confirmar, completar, cancelar)
// El administrador puede todo. El empleado SOLO puede confirmar una cita que esté pendiente.
router.patch('/citas/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!ESTADOS.includes(status)) return res.status(400).json({ error: 'Estado inválido' });

    const cita = get('SELECT id, status FROM appointments WHERE id = ?', req.params.id);
    if (!cita) return res.status(404).json({ error: 'Cita no encontrada' });

    if (req.admin.role !== 'admin' && !(status === 'confirmada' && cita.status === 'pendiente')) {
      return res.status(403).json({ error: 'Tu usuario solo puede confirmar citas pendientes.' });
    }
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, cita.id);

    // AVISO AL CLIENTE: si la cita pasó a "confirmada" o "cancelada" se le envía la notificación a su celular
    // (solo si él activó los avisos). aviso = { enviados, total }, o null si los avisos push no están activos.
    let aviso = null;
    if (cita.status !== status && (status === 'confirmada' || status === 'cancelada')) {
      aviso = await notificar.avisarCita(cita.id, status);
    }
    res.json({ ok: true, aviso });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ---------- CLIENTES ----------
router.get('/clientes', (req, res) => {
  res.json(all(`SELECT c.id, c.name, c.phone, c.created_at,
                       COUNT(a.id) citas,
                       COALESCE(SUM(CASE WHEN a.status = 'completada' THEN a.price END), 0) gastado
                FROM clients c LEFT JOIN appointments a ON a.client_id = c.id
                GROUP BY c.id ORDER BY c.created_at DESC`));
});

// ---------- GASTOS ----------
router.get('/gastos', (req, res) => {
  const mes = fechaLocal().slice(0, 7) + '%';
  res.json({
    lista: all('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 300'),
    gastos_mes: get('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date LIKE ?', mes).s,
    ingresos_mes: get("SELECT COALESCE(SUM(price),0) s FROM appointments WHERE date LIKE ? AND status = 'completada'", mes).s,
  });
});

router.post('/gastos', soloAdmin, (req, res) => {
  const { concepto, monto, fecha } = req.body || {};
  const m = Number(monto);
  if (!String(concepto || '').trim() || !(m > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) {
    return res.status(400).json({ error: 'Completa concepto, monto y fecha' });
  }
  db.prepare('INSERT INTO expenses(concept, amount, date) VALUES (?,?,?)').run(String(concepto).trim().slice(0, 120), m, fecha);
  res.status(201).json({ ok: true });
});

router.delete('/gastos/:id', soloAdmin, (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- SERVICIOS (editar precios, activar/desactivar) ----------
router.get('/servicios', (req, res) => res.json(all('SELECT * FROM services ORDER BY id')));

router.post('/servicios', soloAdmin, (req, res) => {
  const { nombre, precio } = req.body || {};
  if (!String(nombre || '').trim() || !(Number(precio) >= 0)) return res.status(400).json({ error: 'Datos inválidos' });
  db.prepare('INSERT INTO services(name, price) VALUES (?, ?)').run(String(nombre).trim().slice(0, 80), Number(precio));
  res.status(201).json({ ok: true });
});

router.patch('/servicios/:id', soloAdmin, (req, res) => {
  const { nombre, precio, activo } = req.body || {};
  const s = get('SELECT * FROM services WHERE id = ?', req.params.id);
  if (!s) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('UPDATE services SET name = ?, price = ?, active = ? WHERE id = ?').run(
    nombre !== undefined ? String(nombre).trim().slice(0, 80) : s.name,
    precio !== undefined ? Number(precio) : s.price,
    activo !== undefined ? (activo ? 1 : 0) : s.active,
    s.id
  );
  res.json({ ok: true });
});

// ---------- BARBEROS (y el horario de cada uno) ----------
// Cada barbero tiene su entrada, su salida y los días que trabaja.
// Si no tiene horario propio, usa el general de config.js.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const aMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Lee y valida { inicio, fin, dias } del cuerpo de la petición. Lo que no venga se toma del barbero actual.
function leerHorario(body, actual = {}) {
  const base = horarioBarbero(actual);
  const inicio = body.inicio === undefined ? base.inicio : String(body.inicio);
  const fin = body.fin === undefined ? base.fin : String(body.fin);
  const dias = body.dias === undefined ? base.dias : (Array.isArray(body.dias) ? body.dias.map(Number) : []);
  if (!HHMM.test(inicio) || !HHMM.test(fin) || aMin(inicio) >= aMin(fin)) {
    return { error: 'La hora de salida debe ser después de la hora de entrada.' };
  }
  if (!dias.length || dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { error: 'Elige al menos un día de trabajo.' };
  }
  return { inicio, fin, dias: [...new Set(dias)].sort((a, b) => a - b) };
}

router.get('/barberos', (req, res) => {
  res.json(all('SELECT * FROM barbers ORDER BY id').map((b) => ({ ...b, ...horarioBarbero(b) })));
});

router.post('/barberos', soloAdmin, (req, res) => {
  const nombre = String((req.body || {}).nombre || '').trim().slice(0, 60);
  if (!nombre) return res.status(400).json({ error: 'Escribe un nombre' });
  const hor = leerHorario(req.body || {});
  if (hor.error) return res.status(400).json({ error: hor.error });
  db.prepare('INSERT INTO barbers(name, start_time, end_time, days) VALUES (?,?,?,?)')
    .run(nombre, hor.inicio, hor.fin, hor.dias.join(','));
  res.status(201).json({ ok: true });
});

// Activar/desactivar un barbero y/o cambiar su horario
router.patch('/barberos/:id', soloAdmin, (req, res) => {
  const b = get('SELECT * FROM barbers WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'No encontrado' });
  const body = req.body || {};

  const traeHorario = ['inicio', 'fin', 'dias'].some((k) => body[k] !== undefined);
  const hor = traeHorario ? leerHorario(body, b) : null;
  if (hor && hor.error) return res.status(400).json({ error: hor.error });

  db.prepare('UPDATE barbers SET active = ?, start_time = ?, end_time = ?, days = ? WHERE id = ?').run(
    body.activo === undefined ? b.active : (body.activo ? 1 : 0),
    hor ? hor.inicio : b.start_time,
    hor ? hor.fin : b.end_time,
    hor ? hor.dias.join(',') : b.days,
    b.id
  );
  res.json({ ok: true });
});

module.exports = router;
