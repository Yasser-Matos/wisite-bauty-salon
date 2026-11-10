// =====================================================
// respaldo.js  ->  COPIAS DE SEGURIDAD DE LA BASE DE DATOS
//  - Automático: una copia por día en la carpeta de respaldos (junto a la base de datos, en el Volume de Railway).
//    Se guardan las últimas 7 y las más viejas se borran.
//  - Manual: el botón "Descargar respaldo" del panel (solo administrador) baja una copia a tu computadora.
// Las fotos subidas desde el panel NO van dentro del respaldo (están en la carpeta de fotos del Volume).
// =====================================================
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { BACKUP_DIR } = require('./rutas');

const GUARDAR_ULTIMOS = 7;

// Crea una copia completa y consistente de la base de datos en "destino"
function copiarA(destino) {
  db.exec(`VACUUM INTO '${String(destino).replace(/'/g, "''")}'`);
}

function respaldoDiario() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const hoy = new Date();
    const dia = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0');
    const archivo = path.join(BACKUP_DIR, `salonpro-${dia}.db`);
    if (!fs.existsSync(archivo)) { copiarA(archivo); console.log('Respaldo creado:', archivo); }
    // Borra los más viejos
    const todos = fs.readdirSync(BACKUP_DIR).filter((f) => /^salonpro-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    todos.slice(0, Math.max(0, todos.length - GUARDAR_ULTIMOS)).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* ya no estaba */ } });
  } catch (e) {
    console.error('No se pudo crear el respaldo diario:', e.message);
  }
}

// Arranca el respaldo automático: uno poco después de encender y luego se revisa cada 6 horas
function iniciar() {
  setTimeout(respaldoDiario, 15 * 1000).unref();
  setInterval(respaldoDiario, 6 * 60 * 60 * 1000).unref();
}

module.exports = { copiarA, respaldoDiario, iniciar };
