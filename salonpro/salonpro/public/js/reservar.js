// =====================================================
// reservar.js  ->  LÓGICA DE LA PÁGINA DE RESERVAS (index.html)
// Pide servicios, profesionales y horas al servidor, y envía la cita.
// Las horas que se muestran son las del horario de la profesional elegida.
// =====================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Cambia "RD$" si usas otra moneda
const MONEDA = 'RD$';   // moneda que se muestra
const DIAS_NOM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

let servicios = [];
let barberos = [];
let seleccion = new Set();   // ids de los servicios elegidos (puede ser más de uno)
let horaElegida = null;  // hora elegida

// Convierte "13:30" en "1:30 PM"
function formatoHora(t) {
  const [h, m] = t.split(':').map(Number);
  return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}

// Fecha de hoy en formato AAAA-MM-DD (hora local del dispositivo)
function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- Dibuja la lista de servicios ----------
function pintarServicios() {
  $('servicios').innerHTML = servicios.map((s) =>
    `<div class="svc ${seleccion.has(s.id) ? 'sel' : ''}" data-id="${s.id}" role="checkbox" aria-checked="${seleccion.has(s.id)}">
       <span class="nom"><span class="chk">${seleccion.has(s.id) ? '✓' : ''}</span>${esc(s.name)}</span>
       <span class="price">${MONEDA} ${Number(s.price).toLocaleString('es-DO')}</span>
     </div>`).join('');
  document.querySelectorAll('.svc').forEach((el) => {
    el.onclick = () => {
      const id = Number(el.dataset.id);
      if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
      pintarServicios();
    };
  });
  // Total = suma de los precios de los servicios elegidos
  const total = servicios.filter((s) => seleccion.has(s.id)).reduce((t, s) => t + Number(s.price), 0);
  $('total').textContent = seleccion.size ? `${MONEDA} ${total.toLocaleString('es-DO')}` : '—';
}

// ---------- Texto con el horario de la profesional elegida ----------
function pintarHorarioBarbero() {
  const b = barberos.find((x) => String(x.id) === $('barbero').value);
  if (!b) { $('horarioBarbero').textContent = ''; return; }
  const dias = b.dias.length === 7 ? 'todos los días' : b.dias.map((d) => DIAS_NOM[d]).join(', ');
  $('horarioBarbero').textContent = `Horario de ${b.name}: ${dias}, de ${formatoHora(b.inicio)} a ${formatoHora(b.fin)}`;
}

// ---------- Pide y dibuja las horas del día para la profesional elegida ----------
async function cargarHoras(avisarSiSeOcupo) {
  const fecha = $('fecha').value, barbero = $('barbero').value;
  if (!fecha || !barbero) return;
  let horas;
  try {
    const r = await fetch(`/api/horas?fecha=${encodeURIComponent(fecha)}&barbero_id=${encodeURIComponent(barbero)}`);
    if (!r.ok) return;
    horas = await r.json();
  } catch (e) { return; }   // sin internet: se deja lo que había

  const libres = horas.filter((h) => h.disponible).map((h) => h.hora);

  // Si la hora que el cliente había elegido se la acaban de llevar, se lo avisamos
  if (horaElegida && !libres.includes(horaElegida)) {
    horaElegida = null;
    if (avisarSiSeOcupo) $('resultado').innerHTML = '<p class="msg-err">La hora que elegiste acaba de ser tomada. Elige otra.</p>';
  }

  if (!horas.length) {
    $('horas').innerHTML = '<p class="sub" style="grid-column:1/-1">Esta profesional no trabaja ese día. Elige otra fecha u otra profesional.</p>';
    return;
  }
  const aviso = libres.length ? '' : '<p class="sub" style="grid-column:1/-1">Ya no quedan horas libres ese día con esta profesional.</p>';
  $('horas').innerHTML = aviso + horas.map((h) =>
    `<div class="slot ${h.disponible ? '' : 'off'} ${h.hora === horaElegida ? 'sel' : ''}" data-h="${h.hora}">${formatoHora(h.hora)}</div>`).join('');
  document.querySelectorAll('.slot:not(.off)').forEach((el) => {
    el.onclick = () => { horaElegida = el.dataset.h; $('resultado').innerHTML = ''; cargarHoras(); };
  });
}

// ---------- Inicio: carga servicios y profesionales ----------
async function iniciar() {
  Push.registrar();   // deja lista la mini-app (app instalable y avisos)
  servicios = await (await fetch('/api/servicios')).json();
  pintarServicios();

  barberos = await (await fetch('/api/barberos')).json();
  $('barbero').innerHTML = barberos.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  pintarHorarioBarbero();

  $('fecha').value = hoy();
  $('fecha').min = hoy();
  $('barbero').onchange = () => { horaElegida = null; $('resultado').innerHTML = ''; pintarHorarioBarbero(); cargarHoras(); };
  $('fecha').onchange = () => { horaElegida = null; $('resultado').innerHTML = ''; cargarHoras(); };
  cargarHoras();

  // Cada 30 segundos se refrescan las horas, por si otro cliente tomó alguna mientras tanto
  setInterval(() => cargarHoras(true), 30000);
}

// ---------- Después de reservar: enlace a "Mi cita" y botón para activar los avisos en el celular ----------
async function ofrecerAvisos(j) {
  const enlace = `cita.html?id=${encodeURIComponent(j.id)}&t=${encodeURIComponent(j.token)}`;
  const cfg = await Push.config();
  $('resultado').insertAdjacentHTML('beforeend',
    `<div class="msg-ok" style="margin-top:10px">Tu cita queda <b>pendiente</b> hasta que el salón la confirme.<br>
       Guarda este enlace para ver cuándo la confirmen: <a href="${enlace}" style="font-weight:700">Ver el estado de mi cita</a>
       ${cfg.activo ? `<div style="margin-top:12px"><button class="btn" id="btnAvisos" type="button">🔔 Avisarme en mi celular cuando se confirme</button>
       <p id="msgAvisos" class="sub" style="margin-top:8px;font-size:13px"></p></div>` : ''}
     </div>`);
  if (cfg.activo) $('btnAvisos').onclick = () => Push.activarDesdeBoton(j.id, j.token, $('btnAvisos'), $('msgAvisos'));
}

// ---------- Botón "Reservar cita" ----------
$('reservar').onclick = async () => {
  const out = $('resultado');
  const datos = {
    nombre: $('nombre').value.trim(),
    telefono: $('telefono').value.trim(),
    servicios_ids: [...seleccion],
    barbero_id: Number($('barbero').value),
    fecha: $('fecha').value,
    hora: horaElegida,
  };
  if (!datos.servicios_ids.length || !datos.nombre || !datos.telefono || !datos.hora) {
    out.innerHTML = '<p class="msg-err">Elige al menos un servicio, una hora y completa tu nombre y teléfono.</p>';
    return;
  }
  $('reservar').disabled = true;
  try {
    const r = await fetch('/api/citas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo reservar');
    out.innerHTML = `<div class="msg-ok">✅ ¡Cita reservada!<br>${esc(j.servicio)} con ${esc(j.barbero)}<br>Total: ${MONEDA} ${Number(j.total).toLocaleString('es-DO')}<br>${esc(j.fecha)} a las ${formatoHora(j.hora)}</div>`;
    horaElegida = null; seleccion.clear(); pintarServicios(); $('nombre').value = ''; $('telefono').value = '';
    ofrecerAvisos(j);
  } catch (e) {
    horaElegida = null;   // si falló (por ejemplo, la hora ya la tomaron), que elija de nuevo
    out.innerHTML = `<p class="msg-err">${esc(e.message)}</p>`;
  } finally {
    $('reservar').disabled = false;
    cargarHoras();   // refresca para que la hora tomada aparezca tachada
  }
};

iniciar();
