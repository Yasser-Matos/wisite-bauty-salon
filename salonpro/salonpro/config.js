// =====================================================
// config.js  ->  AJUSTES GENERALES DEL NEGOCIO
// Aquí cambias el horario, la moneda y la configuración básica.
// =====================================================
require('dotenv').config(); // lee el archivo .env

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'cambia-esto',

  // Horario de atención. Las citas se ofrecen cada "intervaloMin" minutos.
  // Ejemplo: apertura 9 y cierre 19 => de 9:00 AM a 7:00 PM
  HORARIO: { apertura: 9, cierre: 19, intervaloMin: 60 },

  // Texto de moneda que se muestra en el panel
  MONEDA: 'RD$',
};
