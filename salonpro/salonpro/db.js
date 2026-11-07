// =====================================================
// db.js  ->  BASE DE DATOS (SQLite)
// Aquí se crean las tablas. El archivo de la base de datos
// se guarda como "salonpro.db" en la carpeta del proyecto.
// =====================================================
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

// DB_PATH (opcional) permite guardar la base de datos en otra ruta, por ejemplo el disco de Railway
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'salonpro.db'));
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

// ---------- DATOS INICIALES ----------
// MODIFICAR AQUÍ: servicios y profesionales que se crean la primera vez.
// (Después, cámbialos desde el panel: secciones Servicios y Profesionales.)
if (db.prepare('SELECT COUNT(*) n FROM services').get().n === 0) {
  const ins = db.prepare('INSERT INTO services(name, price) VALUES (?, ?)');
  [
    ['Manicure', 500],
    ['Pedicure', 700],
    ['Uñas acrílicas', 1500],
    ['Uñas en gel', 1200],
    ['Diseño de uñas', 300],
    ['Depilación de cejas', 300],
    ['Depilación facial', 400],
    ['Depilación de piernas', 1200],
    ['Depilación de axilas', 350],
    ['Pestañas', 1800],
    ['Corte de cabello', 800],
    ['Peinado', 700],
    ['Tinte / Color', 2500],
    ['Keratina / Alisado', 3500],
    ['Maquillaje', 1500],
  ].forEach(([n, p]) => ins.run(n, p));
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
