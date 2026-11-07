// =====================================================
// seed.js  ->  DATOS DE PRUEBA (opcional)
// Llena la base con clientes, citas y gastos falsos para que el
// dashboard no se vea vacío mientras pruebas.
// Uso:  npm run seed      (solo funciona si aún no hay citas)
// Cuando ya uses el sistema de verdad, NO lo ejecutes.
// =====================================================
const db = require('./db');
const { fechaLocal, generarHoras } = require('./utils');

if (db.prepare('SELECT COUNT(*) n FROM appointments').get().n > 0) {
  console.log('Ya hay citas en la base de datos. No se agregó nada.');
  process.exit(0);
}

const servicios = db.prepare('SELECT id, price FROM services').all();
const barberos = db.prepare('SELECT id FROM barbers').all();
const nombres = ['María Pérez', 'Carla Gómez', 'Luisa Martínez', 'Patricia Santos', 'Yaneris Reyes', 'Josefina Mota',
  'Rosa Peña', 'Andrea Cruz', 'Mariela Núñez', 'Daniela Rosario', 'Stephanie Díaz', 'Katherine Frías'];
const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];

const insCliente = db.prepare('INSERT INTO clients(name, phone) VALUES (?, ?)');
const clientes = nombres.map((n, i) => insCliente.run(n, '80955501' + String(10 + i)).lastInsertRowid);

const insCita = db.prepare(
  'INSERT INTO appointments(client_id, service_id, barber_id, date, time, status, price) VALUES (?,?,?,?,?,?,?)'
);
const insServ = db.prepare('INSERT INTO appointment_services(appointment_id, service_id, price) VALUES (?,?,?)');
const usadas = new Set();   // evita repetir barbero + fecha + hora
const horas = generarHoras();

for (let off = -10; off <= 1; off++) {
  const cuantas = off === 0 ? 6 : 3 + Math.floor(Math.random() * 4);
  for (let k = 0; k < cuantas; k++) {
    const fecha = fechaLocal(off), hora = elegir(horas), barbero = elegir(barberos).id;
    const clave = `${barbero}|${fecha}|${hora}`;
    if (usadas.has(clave)) continue;
    usadas.add(clave);
    const s = elegir(servicios);
    let estado;
    if (off < 0) estado = Math.random() < 0.9 ? 'completada' : 'cancelada';
    else estado = elegir(['pendiente', 'confirmada', 'confirmada']);
    const id = insCita.run(elegir(clientes), s.id, barbero, fecha, hora, estado, s.price).lastInsertRowid;
    insServ.run(id, s.id, s.price);
  }
}

const insGasto = db.prepare('INSERT INTO expenses(concept, amount, date) VALUES (?,?,?)');
insGasto.run('Compra de productos', 3500, fechaLocal(-2));
insGasto.run('Alquiler del local', 12000, fechaLocal(-5));
insGasto.run('Luz y agua', 2200, fechaLocal(-1));

console.log('Datos de prueba creados.');
