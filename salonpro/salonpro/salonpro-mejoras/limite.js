// =====================================================
// limite.js  ->  PROTECCIÓN CONTRA ABUSOS (intentos de contraseña y reservas en masa)
// Todo se guarda en la memoria del servidor (se reinicia al actualizar, y no hace falta más).
//  - Login: 5 contraseñas incorrectas seguidas desde la misma conexión -> bloqueo de 15 minutos.
//  - Reservas / cancelaciones / reseñas: máximo de acciones por hora desde una misma conexión.
// PARA CAMBIAR LOS NÚMEROS: edita las constantes de abajo.
// =====================================================
const MAX_FALLOS_LOGIN = 5;
const BLOQUEO_LOGIN_MS = 15 * 60 * 1000;

// IP de quien llama. Detrás del proxy de Railway se toma la ÚLTIMA dirección de X-Forwarded-For
// (la que agrega el proxy; las anteriores las puede inventar cualquiera).
function ipDe(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket && req.socket.remoteAddress) || 'desconocida';
}

// ---------- Login ----------
const fallos = new Map();   // clave -> { n, hasta }
const claveLogin = (req, usuario) => ipDe(req) + '|' + String(usuario || '').toLowerCase().slice(0, 60);

// Devuelve los minutos que faltan para poder intentar otra vez (0 = puede intentar)
function minutosBloqueado(req, usuario) {
  const f = fallos.get(claveLogin(req, usuario));
  if (!f || !f.hasta || f.hasta <= Date.now()) return 0;
  return Math.ceil((f.hasta - Date.now()) / 60000);
}
function registrarFallo(req, usuario) {
  const k = claveLogin(req, usuario);
  const f = fallos.get(k) || { n: 0, hasta: 0 };
  if (f.hasta && f.hasta <= Date.now()) { f.n = 0; f.hasta = 0; }   // el bloqueo anterior ya venció
  f.n++;
  if (f.n >= MAX_FALLOS_LOGIN) { f.hasta = Date.now() + BLOQUEO_LOGIN_MS; f.n = 0; }
  fallos.set(k, f);
}
function limpiarFallos(req, usuario) { fallos.delete(claveLogin(req, usuario)); }

// ---------- Acciones por hora (reservar, cancelar, reseñas...) ----------
const contadores = new Map();   // "nombre|ip" -> { n, desde }
// Devuelve true si todavía puede hacer la acción; false si ya llegó al máximo en la última hora.
function permitir(nombre, req, max, ventanaMs = 60 * 60 * 1000) {
  const k = nombre + '|' + ipDe(req);
  const ahora = Date.now();
  let c = contadores.get(k);
  if (!c || ahora - c.desde > ventanaMs) { c = { n: 0, desde: ahora }; contadores.set(k, c); }
  c.n++;
  return c.n <= max;
}

// Limpieza cada 30 minutos para que la memoria no crezca
setInterval(() => {
  const ahora = Date.now();
  for (const [k, f] of fallos) if (!f.hasta || f.hasta <= ahora) { if (f.n === 0) fallos.delete(k); }
  for (const [k, c] of contadores) if (ahora - c.desde > 60 * 60 * 1000) contadores.delete(k);
}, 30 * 60 * 1000).unref();

module.exports = { ipDe, minutosBloqueado, registrarFallo, limpiarFallos, permitir };
