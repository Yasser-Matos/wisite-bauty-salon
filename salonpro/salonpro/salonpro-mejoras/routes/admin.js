// =====================================================
// routes/admin.js  ->  RUTAS DEL ADMINISTRADOR
// Login + todo lo que muestra el panel (dashboard, citas, clientes,
// gastos, servicios y barberos). Todas, menos /login, exigen token.
// =====================================================
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireAdmin = require('../middleware/auth');
const notificar = require('../notificar');
const limite = require('../limite');
const respaldo = require('../respaldo');
const { UPLOADS_DIR } = require('../rutas');
const { JWT_SECRET, MONEDA } = require('../config');
const { fechaLocal, horarioBarbero } = require('../utils');
const router = express.Router();

const ESTADOS = ['pendiente', 'confirmada', 'completada', 'cancelada'];
const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

// ---------- LOGIN (público) ----------
router.post('/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  // Protección: después de 5 contraseñas incorrectas seguidas, se bloquea el acceso 15 minutos
  const espera = limite.minutosBloqueado(req, usuario);
  if (espera) return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${espera} minuto${espera === 1 ? '' : 's'}.` });
  const admin = get('SELECT * FROM admins WHERE username = ?', String(usuario || ''));
  if (!admin || !bcrypt.compareSync(String(clave || ''), admin.password_hash)) {
    limite.registrarFallo(req, usuario);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  limite.limpiarFallos(req, usuario);
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
  res.json(all(`SELECT a.id, a.date, a.time, a.status, a.price, a.duration, c.name cliente, c.phone telefono,
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

// ---------- SERVICIOS (editar precios y duración, activar/desactivar) ----------
// duracion = minutos que dura el servicio (entre 15 y 480). Define cuánto tiempo bloquea en la agenda.
const leerDuracion = (v, defecto) => { if (v === undefined) return defecto; const n = Math.round(Number(v)); return n >= 15 && n <= 480 ? n : null; };
router.get('/servicios', (req, res) => res.json(all('SELECT * FROM services ORDER BY id')));

router.post('/servicios', soloAdmin, (req, res) => {
  const { nombre, precio, duracion } = req.body || {};
  const dur = leerDuracion(duracion, 60);
  if (!String(nombre || '').trim() || !(Number(precio) >= 0) || dur === null) return res.status(400).json({ error: 'Datos inválidos (la duración va de 15 a 480 minutos).' });
  db.prepare('INSERT INTO services(name, price, duration_min) VALUES (?, ?, ?)').run(String(nombre).trim().slice(0, 80), Number(precio), dur);
  res.status(201).json({ ok: true });
});

router.patch('/servicios/:id', soloAdmin, (req, res) => {
  const { nombre, precio, activo, duracion } = req.body || {};
  const s = get('SELECT * FROM services WHERE id = ?', req.params.id);
  if (!s) return res.status(404).json({ error: 'No encontrado' });
  const dur = leerDuracion(duracion, s.duration_min);
  if (dur === null) return res.status(400).json({ error: 'La duración va de 15 a 480 minutos.' });
  db.prepare('UPDATE services SET name = ?, price = ?, active = ?, duration_min = ? WHERE id = ?').run(
    nombre !== undefined ? String(nombre).trim().slice(0, 80) : s.name,
    precio !== undefined ? Number(precio) : s.price,
    activo !== undefined ? (activo ? 1 : 0) : s.active,
    dur,
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

// =====================================================
// FOTOS DE TRABAJOS (se suben desde el panel y se ven en la página de inicio)
// La página reduce cada foto antes de enviarla. Aquí se vuelve a revisar: tipo real, tamaño y cantidad.
// Los archivos se guardan en la carpeta de fotos del Volume (rutas.js), no en el código.
// =====================================================
const MAX_FOTOS = 60;
const MAX_BYTES_FOTO = 1.5 * 1024 * 1024;

// Detecta el tipo REAL de la imagen por sus primeros bytes (no se confía en lo que diga el navegador)
function tipoImagen(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

router.get('/fotos', (req, res) => {
  res.json(all('SELECT id, filename, created_at FROM photos ORDER BY id DESC').map((f) => ({ id: f.id, src: '/fotos/' + encodeURIComponent(f.filename), fecha: f.created_at.slice(0, 10) })));
});

router.post('/fotos', soloAdmin, (req, res) => {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).imagen || ''));
  if (!m) return res.status(400).json({ error: 'Imagen no válida. Usa fotos JPG, PNG o WEBP.' });
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > MAX_BYTES_FOTO) return res.status(413).json({ error: 'La foto pesa demasiado (máximo 1.5 MB).' });
  const tipo = tipoImagen(bytes);
  if (!tipo) return res.status(400).json({ error: 'El archivo no es una imagen válida.' });
  if (get('SELECT COUNT(*) n FROM photos').n >= MAX_FOTOS) return res.status(409).json({ error: `Ya tienes ${MAX_FOTOS} fotos. Borra alguna para subir otra.` });
  const nombre = crypto.randomBytes(12).toString('hex') + '.' + tipo;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), bytes);
  db.prepare('INSERT INTO photos(filename) VALUES (?)').run(nombre);
  res.status(201).json({ ok: true });
});

router.delete('/fotos/:id', soloAdmin, (req, res) => {
  const f = get('SELECT * FROM photos WHERE id = ?', req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  db.prepare('DELETE FROM photos WHERE id = ?').run(f.id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, f.filename)); } catch (e) { /* el archivo ya no estaba */ }
  res.json({ ok: true });
});

// =====================================================
// PROMOCIONES Y PAQUETES (se ven en la página de inicio)
// =====================================================
router.get('/promociones', (req, res) => res.json(all('SELECT * FROM promotions ORDER BY id DESC')));

router.post('/promociones', soloAdmin, (req, res) => {
  const b = req.body || {};
  const titulo = String(b.titulo || '').trim().slice(0, 80);
  if (!titulo) return res.status(400).json({ error: 'Escribe un título para la promoción.' });
  db.prepare('INSERT INTO promotions(title, description, price_text) VALUES (?,?,?)')
    .run(titulo, String(b.descripcion || '').trim().slice(0, 300), String(b.precio || '').trim().slice(0, 60));
  res.status(201).json({ ok: true });
});

router.patch('/promociones/:id', soloAdmin, (req, res) => {
  const p = get('SELECT * FROM promotions WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrada' });
  db.prepare('UPDATE promotions SET active = ? WHERE id = ?').run((req.body || {}).activo ? 1 : 0, p.id);
  res.json({ ok: true });
});

router.delete('/promociones/:id', soloAdmin, (req, res) => {
  db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// =====================================================
// RESEÑAS (las clientas las escriben desde "Mi cita"; tú decides cuáles se publican)
// =====================================================
router.get('/resenas', (req, res) => {
  res.json(all(`SELECT r.id, r.name, r.rating, r.text, r.status, substr(r.created_at,1,10) fecha
                FROM reviews r ORDER BY CASE r.status WHEN 'pendiente' THEN 0 ELSE 1 END, r.id DESC LIMIT 200`));
});

router.patch('/resenas/:id', soloAdmin, (req, res) => {
  const estado = (req.body || {}).status;
  if (!['publicada', 'oculta', 'pendiente'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  if (!get('SELECT id FROM reviews WHERE id = ?', req.params.id)) return res.status(404).json({ error: 'No encontrada' });
  db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(estado, req.params.id);
  res.json({ ok: true });
});

router.delete('/resenas/:id', soloAdmin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// =====================================================
// RESPALDO: descarga una copia completa de la base de datos (solo administrador)
// =====================================================
router.get('/respaldo', soloAdmin, (req, res) => {
  const temporal = path.join(os.tmpdir(), 'respaldo-' + crypto.randomBytes(6).toString('hex') + '.db');
  try {
    respaldo.copiarA(temporal);
    const datos = fs.readFileSync(temporal);
    const d = new Date();
    const nombre = `respaldo-salon-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.end(datos);
  } catch (e) {
    console.error('Error creando respaldo:', e.message);
    res.status(500).json({ error: 'No se pudo crear el respaldo.' });
  } finally { try { fs.unlinkSync(temporal); } catch (e) { /* no existía */ } }
});

module.exports = router;
