// =====================================================
// db.js  ->  BASE DE DATOS (SQLite)
// Aquí se crean las tablas. El archivo de la base de datos
// se guarda como "salonpro.db" en la carpeta del proyecto.
// =====================================================
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

// DB_PATH (opcional, ver rutas.js) permite guardar la base de datos en otra ruta, por ejemplo el disco de Railway
const { DB_FILE } = require('./rutas');   // dónde está la base de datos (variable DB_PATH en Railway)
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');   // más rápido y seguro
db.pragma('foreign_keys = ON');    // respeta las relaciones entre tablas

// ---------- TABLAS ----------
db.exec(`
  -- Servicios que ofrece el salón (uñas, depilación, pestañas, cabello...)
  CREATE TABLE IF NOT EXISTS services (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    price     REAL    NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1      -- 1 = visible para reservar, 0 = oculto
  );

  -- Profesionales que atienden (la tabla se llama "barbers" por herencia, pero son tus estilistas/manicuristas)
  CREATE TABLE IF NOT EXISTS barbers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1
  );

  -- Clientes (se crean solos cuando alguien reserva; el teléfono identifica al cliente)
  CREATE TABLE IF NOT EXISTS clients (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Citas. "price" guarda el precio del momento (si luego cambias el precio del servicio,
  -- las citas viejas no cambian). status: pendiente | confirmada | completada | cancelada
  CREATE TABLE IF NOT EXISTS appointments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES clients(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    barber_id  INTEGER NOT NULL REFERENCES barbers(id),
    date       TEXT NOT NULL,                 -- AAAA-MM-DD
    time       TEXT NOT NULL,                 -- HH:MM
    status     TEXT NOT NULL DEFAULT 'pendiente',
    price      REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Evita que dos personas reserven a la misma profesional a la misma hora
  -- (las citas canceladas no cuentan, así la hora queda libre otra vez)
  CREATE UNIQUE INDEX IF NOT EXISTS ux_cita_barbero_hora
    ON appointments(barber_id, date, time) WHERE status <> 'cancelada';

  -- Gastos del negocio (alquiler, productos, luz...)
  CREATE TABLE IF NOT EXISTS expenses (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    concept TEXT NOT NULL,
    amount  REAL NOT NULL,
    date    TEXT NOT NULL
  );

  -- Usuarios del panel (la contraseña se guarda encriptada, nunca en texto normal)
  -- role: 'admin' = puede todo | 'staff' = solo ve y confirma citas
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin'
  );
`);

// Si la base de datos ya existía sin la columna "role", se la agregamos
if (!db.prepare('PRAGMA table_info(admins)').all().some((c) => c.name === 'role')) {
  db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
}

// Una cita puede tener VARIOS servicios (ej: uñas + cejas). Cada servicio de la cita se guarda aquí con su precio del momento.
// (appointments.service_id guarda el primero, y appointments.price la suma de todos.)
db.exec(`
  CREATE TABLE IF NOT EXISTS appointment_services (
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    service_id     INTEGER NOT NULL REFERENCES services(id),
    price          REAL NOT NULL,
    PRIMARY KEY (appointment_id, service_id)
  );
`);

// Horario propio de cada profesional (si están vacíos, usa el horario general de config.js):
//   start_time = hora de entrada "HH:MM" | end_time = hora de salida "HH:MM"
//   days = días que trabaja, números separados por coma (0 = domingo ... 6 = sábado). Ej: "1,2,3,4,5,6"
const colsBarberos = db.prepare('PRAGMA table_info(barbers)').all().map((c) => c.name);
['start_time', 'end_time', 'days'].forEach((col) => {
  if (!colsBarberos.includes(col)) db.exec(`ALTER TABLE barbers ADD COLUMN ${col} TEXT`);
});

// ---------- AVISOS AL CLIENTE ----------
// token = clave secreta de cada cita. Va dentro del enlace que recibe el cliente para ver el estado de SU cita
// (sin ella nadie puede ver ni suscribirse a la cita de otro).
if (!db.prepare('PRAGMA table_info(appointments)').all().some((c) => c.name === 'token')) {
  db.exec('ALTER TABLE appointments ADD COLUMN token TEXT');
}
// push_subs = celulares de clientes que activaron los avisos para una cita
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    endpoint       TEXT NOT NULL,
    data           TEXT NOT NULL,          -- la suscripción completa en JSON
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(appointment_id, endpoint)
  );
`);

// ---------- NUEVAS FUNCIONES: duración, recordatorios, fotos, reseñas y promociones ----------
// (Si la base de datos ya existía, estas columnas y tablas se agregan solas al arrancar.)
const tieneCol = (tabla, col) => db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === col);
// Cada servicio dura "duration_min" minutos (por defecto 60). La cita guarda "duration" = suma de sus servicios.
if (!tieneCol('services', 'duration_min')) db.exec('ALTER TABLE services ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 60');
if (!tieneCol('appointments', 'duration')) db.exec('ALTER TABLE appointments ADD COLUMN duration INTEGER NOT NULL DEFAULT 60');
// reminded = 1 cuando ya se envió el recordatorio de un día antes
if (!tieneCol('appointments', 'reminded')) db.exec('ALTER TABLE appointments ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0');

db.exec(`
  -- Fotos de trabajos subidas desde el panel (el archivo está en la carpeta de fotos; aquí solo su nombre)
  CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Reseñas de clientas. Solo se puede dejar una por cita COMPLETADA.
  -- status: pendiente (esperando que la apruebes) | publicada (se ve en la página de inicio) | oculta
  CREATE TABLE IF NOT EXISTS reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    rating         INTEGER NOT NULL,
    text           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pendiente',
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Promociones y paquetes que se muestran en la página de inicio
  CREATE TABLE IF NOT EXISTS promotions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_text  TEXT NOT NULL DEFAULT '',     -- texto libre: "RD$ 1,200" o "20% de descuento"
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// ---------- DATOS INICIALES ----------
// MODIFICAR AQUÍ: servicios y profesionales que se crean la primera vez.
// (Después, cámbialos desde el panel: secciones Servicios y Profesionales.)
if (db.prepare('SELECT COUNT(*) n FROM services').get().n === 0) {
  const ins = db.prepare('INSERT INTO services(name, price, duration_min) VALUES (?, ?, ?)');
  [
    // [nombre, precio, duración en minutos]
    ['Manicure', 500, 60],
    ['Pedicure', 700, 60],
    ['Uñas acrílicas', 1500, 120],
    ['Uñas en gel', 1200, 90],
    ['Diseño de uñas', 300, 30],
    ['Depilación de cejas', 300, 30],
    ['Depilación facial', 400, 30],
    ['Depilación de piernas', 1200, 60],
    ['Depilación de axilas', 350, 30],
    ['Pestañas', 1800, 120],
    ['Corte de cabello', 800, 60],
    ['Peinado', 700, 60],
    ['Tinte / Color', 2500, 120],
    ['Keratina / Alisado', 3500, 180],
    ['Maquillaje', 1500, 60],
  ].forEach(([n, p, d]) => ins.run(n, p, d));
}
if (db.prepare('SELECT COUNT(*) n FROM barbers').get().n === 0) {
  const ins = db.prepare('INSERT INTO barbers(name) VALUES (?)');
  ['Ana', 'Laura', 'Marta'].forEach((n) => ins.run(n));
}

// ---------- USUARIOS DEL PANEL ----------
// Se crean o actualizan cada vez que arranca el sistema, con los datos de .env / variables de Railway:
//   ADMIN_USER / ADMIN_PASSWORD  -> administrador (puede todo)
//   STAFF_USER / STAFF_PASSWORD  -> empleado (solo ve y confirma citas). Es opcional.
// Para cambiar una contraseña, cambia la variable y reinicia. Los usuarios que ya no estén en las variables se eliminan.
function sincronizarUsuario(user, pass, role) {
  const actual = db.prepare('SELECT * FROM admins WHERE username = ?').get(user);
  if (!actual) {
    db.prepare('INSERT INTO admins(username, password_hash, role) VALUES (?, ?, ?)').run(user, bcrypt.hashSync(pass, 10), role);
    console.log(`Usuario creado: "${user}" (${role})`);
  } else if (actual.role !== role || !bcrypt.compareSync(pass, actual.password_hash)) {
    db.prepare('UPDATE admins SET password_hash = ?, role = ? WHERE id = ?').run(bcrypt.hashSync(pass, 10), role, actual.id);
    console.log(`Usuario actualizado: "${user}" (${role})`);
  }
}

const adminUser = process.env.ADMIN_USER || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
const permitidos = [adminUser];
sincronizarUsuario(adminUser, adminPass, 'admin');

const staffUser = process.env.STAFF_USER;
const staffPass = process.env.STAFF_PASSWORD;
if (staffUser && staffPass && staffUser !== adminUser) {
  sincronizarUsuario(staffUser, staffPass, 'staff');
  permitidos.push(staffUser);
}

// Elimina cualquier otro usuario que ya no esté en las variables
db.prepare(`DELETE FROM admins WHERE username NOT IN (${permitidos.map(() => '?').join(',')})`).run(...permitidos);

module.exports = db;
