// =====================================================
// middleware/auth.js  ->  PROTEGE LAS RUTAS DEL PANEL
//  - requireAdmin:            exige estar logueado (administrador o empleado)
//  - requireAdmin.soloAdmin:  además exige ser administrador (el empleado solo puede ver)
// El rol se lee SIEMPRE de la base de datos, no del navegador, así no se puede falsificar.
// =====================================================
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config');

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let usuario = null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    usuario = db.prepare('SELECT id, username, role FROM admins WHERE id = ?').get(payload.id);
  } catch (e) { /* token inválido o vencido */ }

  if (!usuario) return res.status(401).json({ error: 'No autorizado' });
  req.admin = { id: usuario.id, user: usuario.username, role: usuario.role };
  next();
}

// Úsalo en las rutas que modifican datos: solo el administrador pasa
requireAdmin.soloAdmin = function soloAdmin(req, res, next) {
  if (req.admin && req.admin.role === 'admin') return next();
  res.status(403).json({ error: 'Tu usuario es solo de consulta: no tienes permiso para modificar.' });
};

module.exports = requireAdmin;
