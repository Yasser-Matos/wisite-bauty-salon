// =====================================================
// rutas.js  ->  DÓNDE SE GUARDAN LOS ARCHIVOS DEL SISTEMA
// Todo lo que se crea mientras el sistema funciona (base de datos, fotos que subes desde el panel
// y respaldos) se guarda junto a la base de datos. En Railway, con DB_PATH=/data/salonpro.db,
// queda todo en el Volume (/data) y no se pierde al actualizar.
// =====================================================
const path = require('path');
require('dotenv').config();

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'salonpro.db');
const DATA_DIR = path.dirname(DB_FILE);

module.exports = {
  DB_FILE,
  DATA_DIR,
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join(DATA_DIR, 'fotos'),   // fotos subidas desde el panel
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(DATA_DIR, 'respaldos'), // respaldos automáticos diarios
};
