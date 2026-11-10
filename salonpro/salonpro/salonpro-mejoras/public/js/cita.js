// =====================================================
// cita.js  ->  PÁGINA "MI CITA" (cita.html)
// El cliente abre su enlace privado (/cita.html?id=..&t=..) y ve si su cita
// está pendiente, confirmada o cancelada. Se actualiza sola cada 15 segundos.
// También le ofrece activar los avisos en su celular (usa push.js), cambiar la fecha/hora, cancelar
// y, cuando la cita está completada, dejar una reseña.
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
const durTxt = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : ''); };
const hora12 = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

let ultimoEstado = null;
let temporizador = null;
let avisosDibujados = false;
let accionesClave = null;   // para dibujar los botones de cambiar/cancelar solo cuando algo cambia (así no se borra lo que la clienta está escribiendo)
let resenaClave = null;
let estrellas = 0;

const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const contacto = () => (typeof NEGOCIO_INFO !== 'undefined' ? NEGOCIO_INFO : {});
const lleno = (v) => typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('[');

// Pide algo al servidor y devuelve { ok, j }
async function enviar(url, cuerpo) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { ok: r.ok, j: await r.json().catch(() => ({})) };
  } catch (e) { return { ok: false, j: { error: 'No hay conexión. Intenta de nuevo.' } }; }
}

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
  $('detalles').innerHTML = [['Servicios', c.servicio], ['Duración', durTxt(c.duration)], ['Profesional', c.barbero], ['Total', 'RD$' + ' ' + Number(c.total||0).toLocaleString('es-DO')], ['Fecha', fechaBonita(c.date)], ['Hora', hora12(c.time)]]
    .map(([k, v]) => `<div class="row"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  document.title = e.titulo + ' · ' + c.negocio;
  ultimoEstado = c.status;
  $('cargando').classList.add('hide'); $('error').classList.add('hide'); $('cita').classList.remove('hide');
  pintarAvisos(c);
  pintarAcciones(c);
  pintarResena(c);
}

// ---------- Cambiar fecha/hora o cancelar ----------
function pintarAcciones(c) {
  const box = $('accionesBox');
  const clave = [c.status, c.date, c.time, c.puede_cambiar].join('|');
  if (clave === accionesClave) return;
  accionesClave = clave;
  if (c.status !== 'pendiente' && c.status !== 'confirmada') { box.classList.add('hide'); return; }
  box.classList.remove('hide');

  if (!c.puede_cambiar) {
    const n = contacto();
    const wa = lleno(n.whatsapp) ? `<a class="btn wa sm" style="text-decoration:none;margin-top:10px;display:inline-block" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(n.whatsapp.replace(/\D/g, ''))}">Escribir por WhatsApp</a>` : '';
    const tel = lleno(n.telefono) ? ` o llama al <b>${esc(n.telefono)}</b>` : '';
    box.innerHTML = `<h2>¿Necesitas cambiar tu cita?</h2><p class="sub">Faltan menos de ${c.horas_antes} horas para tu cita, así que ya no se puede cambiar desde aquí. Comunícate con el salón${tel}.</p>${wa}`;
    return;
  }
  box.innerHTML = `<h2>¿Cambió tu plan?</h2>
    <p class="sub" style="margin-bottom:12px">Puedes cambiar o cancelar tu cita hasta ${c.horas_antes} horas antes.</p>
    <div class="acts">
      <button class="btn ghost" id="btnCambiar" type="button">Cambiar fecha u hora</button>
      <button class="btn ghost" id="btnCancelar" type="button">Cancelar mi cita</button>
    </div>
    <div id="panelCambio" class="hide" style="margin-top:14px">
      <label for="nuevaFecha">Nueva fecha</label>
      <input type="date" id="nuevaFecha" min="${hoyISO()}" value="${esc(c.date)}">
      <label>Hora disponible</label>
      <div class="slots" id="nuevasHoras"></div>
      <div class="mt"><button class="btn big" id="btnGuardarCambio" type="button" disabled>Confirmar el cambio</button></div>
      <p class="sub" style="font-size:13px;margin-top:8px">Al cambiarla, el salón tendrá que confirmarla otra vez.</p>
    </div>
    <p id="msgAcciones" class="msg-err" role="alert"></p>`;

  let horaNueva = null;
  const msg = (t) => { $('msgAcciones').textContent = t || ''; };

  async function cargarNuevasHoras() {
    const f = $('nuevaFecha').value;
    horaNueva = null; $('btnGuardarCambio').disabled = true;
    if (!f) return;
    $('nuevasHoras').innerHTML = '<p class="sub" style="grid-column:1/-1">Buscando horas…</p>';
    let horas = [];
    try { const r = await fetch(`/api/mi-cita/horas?id=${encodeURIComponent(ID)}&t=${encodeURIComponent(TOKEN)}&fecha=${encodeURIComponent(f)}`); horas = r.ok ? await r.json() : []; } catch (e) { /* sin conexión */ }
    if (!horas.length) { $('nuevasHoras').innerHTML = '<p class="sub" style="grid-column:1/-1">Esa profesional no trabaja ese día. Elige otra fecha.</p>'; return; }
    $('nuevasHoras').innerHTML = horas.map((h) => `<div class="slot ${h.disponible ? '' : 'off'} ${h.hora === horaNueva ? 'sel' : ''}" data-h="${h.hora}">${hora12(h.hora)}</div>`).join('');
    document.querySelectorAll('#nuevasHoras .slot:not(.off)').forEach((el) => {
      el.onclick = () => {
        horaNueva = el.dataset.h; msg('');
        document.querySelectorAll('#nuevasHoras .slot').forEach((s) => s.classList.toggle('sel', s === el));
        $('btnGuardarCambio').disabled = false;
      };
    });
  }

  $('btnCambiar').onclick = () => { $('panelCambio').classList.toggle('hide'); if (!$('panelCambio').classList.contains('hide')) cargarNuevasHoras(); };
  $('nuevaFecha').onchange = cargarNuevasHoras;
  $('btnGuardarCambio').onclick = async () => {
    msg(''); $('btnGuardarCambio').disabled = true;
    const r = await enviar('/api/mi-cita/reprogramar', { id: ID, t: TOKEN, fecha: $('nuevaFecha').value, hora: horaNueva });
    if (!r.ok) { msg(r.j.error || 'No se pudo cambiar la cita.'); cargarNuevasHoras(); return; }
    accionesClave = null; cargar(false);   // se vuelve a pedir la cita y se dibuja con la nueva fecha
  };
  $('btnCancelar').onclick = async () => {
    if (!confirm('¿Seguro que quieres cancelar tu cita?')) return;
    msg('');
    const r = await enviar('/api/mi-cita/cancelar', { id: ID, t: TOKEN });
    if (!r.ok) { msg(r.j.error || 'No se pudo cancelar la cita.'); return; }
    accionesClave = null; cargar(false);
  };
}

// ---------- Reseña (cita completada) ----------
function pintarResena(c) {
  const box = $('resenaBox');
  const clave = c.status + '|' + (c.resena || '');
  if (clave === resenaClave) return;
  resenaClave = clave;
  if (c.status !== 'completada') { box.classList.add('hide'); return; }
  box.classList.remove('hide');
  if (c.resena) {
    box.innerHTML = `<h2>¡Gracias por tu reseña!</h2><p class="sub">${c.resena === 'publicada' ? 'Ya está publicada en nuestra página.' : 'La revisaremos y la publicaremos pronto.'}</p>`;
    return;
  }
  estrellas = 0;
  box.innerHTML = `<h2>¿Cómo te fue?</h2>
    <p class="sub" style="margin-bottom:10px">Tu opinión nos ayuda a mejorar y a que otras clientas nos conozcan.</p>
    <div class="estrellas" role="radiogroup" aria-label="Calificación">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="estrella" data-n="${n}" role="radio" aria-checked="false" aria-label="${n} de 5 estrellas">★</button>`).join('')}</div>
    <label for="resenaTxt">Cuéntanos (opcional)</label>
    <textarea id="resenaTxt" maxlength="400" rows="3" placeholder="Ej: Me encantó mi manicure, muy buena atención"></textarea>
    <div class="mt"><button class="btn big" id="btnResena" type="button" disabled>Enviar reseña</button></div>
    <p id="msgResena" class="msg-err" role="alert"></p>`;
  document.querySelectorAll('.estrella').forEach((b) => {
    b.onclick = () => {
      estrellas = Number(b.dataset.n);
      document.querySelectorAll('.estrella').forEach((x) => { const on = Number(x.dataset.n) <= estrellas; x.classList.toggle('on', on); x.setAttribute('aria-checked', Number(x.dataset.n) === estrellas ? 'true' : 'false'); });
      $('btnResena').disabled = false;
    };
  });
  $('btnResena').onclick = async () => {
    $('btnResena').disabled = true;
    const r = await enviar('/api/mi-cita/resena', { id: ID, t: TOKEN, rating: estrellas, texto: $('resenaTxt').value });
    if (!r.ok) { $('msgResena').textContent = r.j.error || 'No se pudo enviar la reseña.'; $('btnResena').disabled = false; return; }
    resenaClave = null; cargar(false);
  };
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
