// =====================================================
// cita.js  ->  PÁGINA "MI CITA" (cita.html)
// El cliente abre su enlace privado (/cita.html?id=..&t=..) y ve si su cita
// está pendiente, confirmada o cancelada. Se actualiza sola cada 15 segundos.
// También le ofrece activar los avisos en su celular (usa push.js).
// PARA CAMBIAR LOS TEXTOS de cada estado: edita TEXTOS aquí abajo.
// =====================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const params = new URLSearchParams(location.search);
const ID = params.get('id') || '';
const TOKEN = params.get('t') || '';

const TEXTOS = {
  pendiente:  { icono: '⏳', titulo: 'Esperando confirmación', texto: 'Tu cita será revisada y se confirmará en breve.' },
  confirmada: { icono: '✅', titulo: '¡Tu cita está confirmada!', texto: 'Te esperamos. Llega unos minutos antes.' },
  completada: { icono: '✔️', titulo: 'Cita completada', texto: '¡Gracias por visitarnos!' },
  cancelada:  { icono: '❌', titulo: 'Cita cancelada', texto: 'Esta cita fue cancelada. Puedes reservar otra cuando quieras.' },
};

const fechaBonita = (f) => {
  const t = new Date(f + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hora12 = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

let ultimoEstado = null;
let temporizador = null;
let avisosDibujados = false;

function mostrarError(msg) {
  $('cargando').classList.add('hide'); $('cita').classList.add('hide');
  $('errorTxt').textContent = msg; $('error').classList.remove('hide');
}

// Caja "Avisos en tu celular": solo mientras la cita está pendiente y el servidor tiene los avisos activos
async function pintarAvisos(c) {
  const box = $('avisosBox');
  const cfg = await Push.config();
  if (!cfg.activo || c.status !== 'pendiente') { box.classList.add('hide'); return; }
  box.classList.remove('hide');
  if (avisosDibujados) return;
  avisosDibujados = true;
  let ya = false;
  try { ya = localStorage.getItem('bp_avisos_' + ID) === '1'; } catch (e) { /* sin almacenamiento */ }
  box.innerHTML = `<h2>🔔 Avisos en tu celular</h2>
    <p class="sub" style="margin-bottom:12px">Actívalos y te llegará una notificación apenas el salón confirme tu cita.</p>
    <button class="btn big" id="btnAvisos" type="button" ${ya ? 'disabled' : ''}>${ya ? '🔔 Avisos activados en este celular' : 'Avisarme cuando se confirme'}</button>
    <p class="sub" id="msgAvisos" style="margin-top:10px;font-size:13px"></p>`;
  $('btnAvisos').onclick = () => Push.activarDesdeBoton(ID, TOKEN, $('btnAvisos'), $('msgAvisos'));
}

function pintar(c) {
  const e = TEXTOS[c.status] || TEXTOS.pendiente;
  const cambio = ultimoEstado && ultimoEstado !== c.status;
  $('estado').className = 'card estado ' + c.status + (cambio ? ' flash' : '');
  $('estado').innerHTML = `<div class="icono">${e.icono}</div><h1>${e.titulo}</h1><p class="sub">${e.texto}</p>`;
  $('detalles').innerHTML = [['Servicios', c.servicio], ['Profesional', c.barbero], ['Total', 'RD$' + ' ' + Number(c.total||0).toLocaleString('es-DO')], ['Fecha', fechaBonita(c.date)], ['Hora', hora12(c.time)]]
    .map(([k, v]) => `<div class="row"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  document.title = e.titulo + ' · ' + c.negocio;
  ultimoEstado = c.status;
  $('cargando').classList.add('hide'); $('error').classList.add('hide'); $('cita').classList.remove('hide');
  pintarAvisos(c);
}

async function cargar(primera) {
  try {
    const r = await fetch(`/api/mi-cita?id=${encodeURIComponent(ID)}&t=${encodeURIComponent(TOKEN)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (primera) mostrarError(j.error || 'No se pudo cargar tu cita.'); return; }
    pintar(j);
    if (j.status === 'completada' || j.status === 'cancelada') clearInterval(temporizador);   // ya no cambia
  } catch (e) {
    if (primera) mostrarError('No hay conexión. Revisa tu internet e intenta de nuevo.');
  }
}

if (!ID || !TOKEN) {
  mostrarError('El enlace está incompleto. Ábrelo de nuevo desde donde lo recibiste.');
} else {
  Push.registrar();   // deja lista la mini-app para recibir avisos
  cargar(true);
  temporizador = setInterval(() => { if (!document.hidden) cargar(false); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(false); });
}
