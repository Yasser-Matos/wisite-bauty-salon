// =====================================================
// server.js  ->  ARRANCA EL SERVIDOR (punto de entrada)
// Aquí se conecta todo: la base de datos, la página web (carpeta "public")
// y las rutas de la API. Para iniciar:  npm start
// =====================================================
const express = require('express');
const path = require('path');
const { PORT } = require('./config');
require('./db'); // crea las tablas si no existen

const app = express();

app.use(express.json());                                    // permite leer JSON enviado por la página
app.use(express.static(path.join(__dirname, 'public')));    // sirve index.html y admin.html

// Rutas que usan los CLIENTES (reservar): /api/servicios, /api/horas, /api/citas ...
app.use('/api', require('./routes/public'));
// Rutas del ADMINISTRADOR (requieren login): /api/admin/...
app.use('/api/admin', require('./routes/admin'));

// Respuesta si piden una ruta de la API que no existe
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(PORT, () => {
  console.log(`Salón listo -> http://localhost:${PORT}`);
  console.log(`Panel admin      -> http://localhost:${PORT}/admin.html`);
});
