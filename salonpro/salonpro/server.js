// =====================================================
// server.js  ->  ARRANCA EL SERVIDOR (punto de entrada)
// Aquí se conecta todo: la base de datos, la página web (carpeta "public")
// y las rutas de la API. Para iniciar:  npm start
// =====================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const { PORT } = require('./config');
const { UPLOADS_DIR } = require('./rutas');
require('./db'); // crea las tablas si no existen

const app = express();

// Las fotos se envían como texto desde el panel: solo esa ruta admite cuerpos grandes (hasta 3 MB).
// El resto de la API se queda con el límite normal, para que nadie pueda saturar el servidor con envíos enormes.
app.use('/api/admin/fotos', express.json({ limit: '3mb' }));
app.use(express.json());                                    // permite leer JSON enviado por la página

// Dirección real desde donde te visitan (ej: https://tusalon.com). Se usa en robots, sitemap y la vista previa al compartir.
const baseUrl = (req) => `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()}://${req.headers.host}`;

// Página de inicio: se envía con la dirección real en las etiquetas de vista previa (WhatsApp, Facebook...),
// que exigen una dirección completa para mostrar la imagen del salón.
const enviarInicio = (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').split('__BASE__').join(baseUrl(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
};
app.get('/', enviarInicio);
app.get('/index.html', enviarInicio);

// Fotos subidas desde el panel (están en el Volume, fuera del código)
app.use('/fotos', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));    // sirve reservar.html, admin.html, cita.html...

// ---- Para que Google encuentre tu página ----
// robots.txt: les dice a los buscadores qué NO deben listar (el panel y los enlaces privados de cada cita).
// sitemap.xml: la lista de páginas públicas.
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`User-agent: *\nDisallow: /admin.html\nDisallow: /cita.html\nDisallow: /api/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${b}/</loc></url>\n  <url><loc>${b}/reservar.html</loc></url>\n</urlset>\n`);
});

// Rutas que usan los CLIENTES (reservar): /api/servicios, /api/horas, /api/citas ...
app.use('/api', require('./routes/public'));
// Rutas del ADMINISTRADOR (requieren login): /api/admin/...
app.use('/api/admin', require('./routes/admin'));

// Respuesta si piden una ruta de la API que no existe
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(PORT, () => {
  console.log(`Salón listo -> http://localhost:${PORT}`);
  console.log(`Panel admin      -> http://localhost:${PORT}/admin.html`);
  require('./respaldo').iniciar();        // copia de seguridad automática diaria
  require('./recordatorios').iniciar();   // recordatorio automático un día antes
});
