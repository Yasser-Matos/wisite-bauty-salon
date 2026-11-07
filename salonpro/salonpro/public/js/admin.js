// =====================================================
// admin.js  ->  LÓGICA DEL PANEL DE ADMINISTRADOR (admin.html)
// Está dividido en partes. Cada parte dice qué hace.
// =====================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let MONEDA = 'RD$';
let ROL = 'admin';                       // 'admin' = puede todo | 'staff' = solo ve y confirma citas
const esAdmin = () => ROL === 'admin';
const DIAS_NOM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
let NEGOCIO = 'Beauty Salon';              // nombre que sale en el mensaje de WhatsApp (variable NEGOCIO del servidor)
let CODIGO_PAIS = '1';                   // código de país para WhatsApp (variable CODIGO_PAIS; 1 = Rep. Dominicana / EE.UU.)
const textoDias = (d) => (d.length === 7 ? 'Todos los días' : d.map((x) => DIAS_NOM[x]).join(', '));
const money = (n) => MONEDA + ' ' + Number(n || 0).toLocaleString('es-DO');
const hora12 = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// ---------------------------------------------------------------
// PARTE 1: COMUNICACIÓN CON EL SERVIDOR
// api('/ruta') llama al servidor enviando el token de sesión.
// ---------------------------------------------------------------
let token = localStorage.getItem('bp_token');

async function api(ruta, opts = {}) {
  const r = await fetch('/api/admin' + ruta, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { cerrarSesion(); throw new Error('Sesión vencida'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error');
  return data;
}

// ---------------------------------------------------------------
// PARTE 2: LOGIN Y CERRAR SESIÓN
// ---------------------------------------------------------------
async function entrar() {
  $('loginErr').textContent = '';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: $('usuario').value, clave: $('clave').value }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error');
    token = j.token; localStorage.setItem('bp_token', token);
    $('clave').value = '';
    mostrarApp();
  } catch (e) { $('loginErr').textContent = e.message; }
}
function cerrarSesion() {
  token = null; localStorage.removeItem('bp_token');
  $('app').classList.add('hide'); $('login').classList.remove('hide');
}
$('entrar').onclick = entrar;
$('clave').onkeydown = (e) => { if (e.key === 'Enter') entrar(); };
$('salir').onclick = cerrarSesion;

// ---------------------------------------------------------------
// PARTE 3: MENÚ (cambiar de sección)
// ---------------------------------------------------------------
const CARGAR = { dashboard: cargarDashboard, citas: cargarCitas, clientes: cargarClientes, gastos: cargarGastos, servicios: cargarServicios, barberos: cargarBarberos };

function irA(vista) {
  document.querySelectorAll('.nav[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === vista));
  Object.keys(CARGAR).forEach((v) => $('v-' + v).classList.toggle('hide', v !== vista));
  CARGAR[vista]().catch((e) => alert(e.message));
}
document.querySelectorAll('.nav[data-v]').forEach((b) => (b.onclick = () => irA(b.dataset.v)));

async function mostrarApp() {
  $('login').classList.add('hide'); $('app').classList.remove('hide');
  try { const yo = await api('/yo'); ROL = yo.role; NEGOCIO = yo.negocio; CODIGO_PAIS = yo.codigo_pais; } catch (e) { return; }   // pregunta al servidor qué rol tiene este usuario
  document.body.classList.toggle('staff', !esAdmin());           // el CSS oculta los formularios del administrador
  $('rolInfo').textContent = esAdmin() ? '' : 'Usuario de consulta: puedes ver todo y confirmar citas pendientes. Para cambiar algo, usa el usuario administrador.';
  $('rolInfo').classList.toggle('hide', esAdmin());
  irA('dashboard');
}

// ---------------------------------------------------------------
// PARTE 4: DASHBOARD
// Dibuja tarjetas, resumen, gráfica de 7 días, top de servicios,
// dona de estados y próximas citas.
// ---------------------------------------------------------------
const kpi = (titulo, valor, extra = '') => `<div class="card kpi"><div class="l">${titulo}</div><div class="n ${extra}">${valor}</div></div>`;
const COLORES = { confirmada: '#e01e1e', pendiente: '#ffb020', completada: '#3ddc68', cancelada: '#6b6b73' };

// Gráfica de línea hecha con SVG (ingresos por día)
function lineaSVG(datos) {
  const W = 600, H = 230, pl = 52, pr = 12, pt = 14, pb = 30;
  const max = Math.max(...datos.map((d) => d.total), 1000);
  const x = (i) => pl + ((W - pl - pr) * i) / (datos.length - 1);
  const y = (v) => H - pb - ((H - pt - pb) * v) / max;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos de los últimos 7 días">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4, yy = y(v);
    s += `<line x1="${pl}" y1="${yy}" x2="${W - pr}" y2="${yy}" stroke="#2c2c31"/>`;
    s += `<text x="${pl - 8}" y="${yy + 4}" fill="#9a9aa2" font-size="11" text-anchor="end">${Math.round(v).toLocaleString('es-DO')}</text>`;
  }
  s += `<polyline fill="none" stroke="#e01e1e" stroke-width="3" points="${datos.map((d, i) => x(i) + ',' + y(d.total)).join(' ')}"/>`;
  datos.forEach((d, i) => {
    s += `<circle cx="${x(i)}" cy="${y(d.total)}" r="4.5" fill="#e01e1e"><title>${d.fecha}: ${money(d.total)}</title></circle>`;
    s += `<text x="${x(i)}" y="${H - 8}" fill="#9a9aa2" font-size="12" text-anchor="middle">${d.dia}</text>`;
  });
  return s + '</svg>';
}

// Dona hecha con SVG (citas por estado)
function donaSVG(estados) {
  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  const R = 40, C = 2 * Math.PI * R;
  let s = `<svg width="150" height="150" viewBox="0 0 100 100" role="img" aria-label="Citas por estado"><circle cx="50" cy="50" r="${R}" fill="none" stroke="#2c2c31" stroke-width="16"/>`;
  let acum = 0;
  if (total) Object.keys(estados).forEach((k) => {
    const len = (estados[k] / total) * C;
    if (len > 0) s += `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${COLORES[k]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acum}" transform="rotate(-90 50 50)"/>`;
    acum += len;
  });
  s += `<text x="50" y="54" text-anchor="middle" fill="#f2f2f2" font-size="14" font-weight="700">${total}</text></svg>`;
  return s;
}

async function cargarDashboard() {
  const d = await api('/dashboard');
  MONEDA = d.moneda;
  $('fechaHoy').textContent = new Date().toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' });

  // Tarjetas de arriba
  $('kpis1').innerHTML = kpi('Citas hoy', d.citas_hoy) + kpi('Citas mañana', d.citas_manana) +
    kpi('Clientes registrados', d.clientes_total) + kpi('Ingresos hoy', money(d.ingresos_hoy));
  $('kpis2').innerHTML = kpi('Ingresos del mes', money(d.ingresos_mes), 'pos') + kpi('Gastos del mes', money(d.gastos_mes)) +
    kpi('Ganancia del mes', money(d.ganancia_mes), d.ganancia_mes < 0 ? 'neg' : 'pos') + kpi('Clientes nuevos (mes)', d.clientes_nuevos_mes);

  // Resumen
  const filas = [['Citas hoy', d.citas_hoy], ['Citas completadas (total)', d.citas_completadas], ['Clientes nuevos este mes', d.clientes_nuevos_mes],
    ['Ingresos hoy', money(d.ingresos_hoy)], ['Ingresos este mes', money(d.ingresos_mes)], ['Gastos este mes', money(d.gastos_mes)]];
  $('resumen').innerHTML = filas.map((f) => `<div class="row"><span>${f[0]}</span><b>${f[1]}</b></div>`).join('');

  $('grafica').innerHTML = lineaSVG(d.ultimos7);

  $('top').innerHTML = d.top_servicios.length
    ? d.top_servicios.map((t) => `<div class="row" style="border:0;padding-bottom:0"><span>${esc(t.nombre)}</span><b>${t.pct}%</b></div><div class="bar"><i style="width:${t.pct}%"></i></div>`).join('')
    : '<p class="sub">Aún no hay datos.</p>';

  $('dona').innerHTML = donaSVG(d.por_estado);
  const tot = Object.values(d.por_estado).reduce((a, b) => a + b, 0) || 1;
  $('leyenda').innerHTML = Object.keys(d.por_estado).map((k) =>
    `<div><i style="background:${COLORES[k]}"></i>${k[0].toUpperCase() + k.slice(1)} ${Math.round((d.por_estado[k] / tot) * 100)}%</div>`).join('');

  $('proximas').innerHTML = d.citas_hoy_lista.length
    ? d.citas_hoy_lista.map((c) => `<div class="next ${c.status}"><div><b>${hora12(c.time)} · ${esc(c.cliente)}</b><br><small>${esc(c.servicio)} · ${esc(c.barbero)}</small></div><span class="badge b-${c.status}">${c.status}</span></div>`).join('')
    : '<p class="sub">No hay citas para hoy.</p>';
}

// ---------------------------------------------------------------
// PARTE 5: CITAS (tabla + confirmar / completar / cancelar + aviso al cliente y botón de WhatsApp)
// ---------------------------------------------------------------
// Número listo para WhatsApp: solo dígitos y con código de país (809-555-1234 -> 18095551234)
const telWA = (tel) => { const d = String(tel || '').replace(/\D/g, ''); return d.length === 10 ? CODIGO_PAIS + d : d; };
const fechaLarga = (f) => new Date(f + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' });

// Enlace de WhatsApp con el mensaje de confirmación ya escrito (se abre y solo falta tocar "Enviar").
// PARA CAMBIAR EL MENSAJE: edita el texto de "msg" aquí abajo.
function enlaceWA(c) {
  const msg = `Hola ${c.cliente}, tu cita en ${NEGOCIO} está confirmada ✅\n${c.servicio} con ${c.barbero}\n${fechaLarga(c.date)}, ${hora12(c.time)}\n¡Te esperamos!`;
  return `https://wa.me/${telWA(c.telefono)}?text=${encodeURIComponent(msg)}`;
}

async function cargarCitas() {
  const lista = await api('/citas?filtro=' + $('filtro').value);
  $('tCitas').innerHTML = lista.map((c) => `<tr>
    <td>${esc(c.date)}</td><td>${hora12(c.time)}</td>
    <td>${esc(c.cliente)}<br><small class="sub">${esc(c.telefono)}</small></td>
    <td>${esc(c.servicio)}</td><td>${esc(c.barbero)}</td><td>${money(c.price)}</td>
    <td><span class="badge b-${c.status}">${c.status}</span>${c.avisos ? '<span class="campana" title="El cliente activó los avisos en su celular">🔔</span>' : ''}</td>
    <td><div class="acts">
      ${c.status === 'pendiente' ? `<button class="btn sm" data-est="confirmada" data-id="${c.id}">Confirmar</button>` : ''}
      ${c.status === 'confirmada' ? `<a class="btn sm wa" href="${esc(enlaceWA(c))}" target="_blank" rel="noopener" title="Abre WhatsApp con el mensaje de confirmación listo">WhatsApp</a>` : ''}
      ${esAdmin() && (c.status === 'pendiente' || c.status === 'confirmada') ? `<button class="btn sm ghost" data-est="completada" data-id="${c.id}">Completar</button><button class="btn sm ghost" data-est="cancelada" data-id="${c.id}">Cancelar</button>` : ''}
    </div></td></tr>`).join('') || '<tr><td colspan="8" class="sub">No hay citas para este filtro.</td></tr>';
}
$('filtro').onchange = () => cargarCitas().catch((e) => alert(e.message));

// Cartel con el resultado del aviso al cliente (se oculta solo a los 10 segundos)
let _tAviso = null;
function mostrarAviso(html, tipo) {
  const el = $('avisoCitas');
  el.className = tipo === 'ok' ? 'msg-ok' : 'msg-warn';
  el.style.margin = '0 0 14px';
  el.innerHTML = html;
  clearTimeout(_tAviso); _tAviso = setTimeout(() => el.classList.add('hide'), 10000);
}

$('tCitas').onclick = async (e) => {
  const b = e.target.closest('[data-est]'); if (!b) return;
  try {
    const r = await api('/citas/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.est } });
    const a = r.aviso;   // { enviados, total } | null (null = los avisos push no están activos en el servidor)
    if (b.dataset.est === 'confirmada') {
      if (a && a.enviados > 0) mostrarAviso('✅ Cita confirmada y <b>el cliente ya fue avisado en su celular</b>.', 'ok');
      else if (a && a.total > 0) mostrarAviso('Cita confirmada, pero <b>no se pudo enviar el aviso</b> al celular del cliente. Avísale por WhatsApp con el botón verde de la fila.', 'warn');
      else if (a) mostrarAviso('Cita confirmada. El cliente no activó los avisos en su celular: <b>avísale por WhatsApp</b> con el botón verde de la fila.', 'warn');
      else mostrarAviso('Cita confirmada. <b>Avísale al cliente por WhatsApp</b> con el botón verde de la fila.', 'warn');
    } else if (b.dataset.est === 'cancelada') {
      const avisado = a && a.enviados > 0;
      mostrarAviso(avisado ? 'Cita cancelada y el cliente fue avisado en su celular.' : 'Cita cancelada. Si quieres, avísale al cliente por teléfono o WhatsApp.', avisado ? 'ok' : 'warn');
    }
    await cargarCitas();
  } catch (er) { alert(er.message); }
};

// ---------------------------------------------------------------
// PARTE 6: CLIENTES
// ---------------------------------------------------------------
async function cargarClientes() {
  const lista = await api('/clientes');
  $('tClientes').innerHTML = lista.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.citas}</td><td>${money(c.gastado)}</td><td>${esc(c.created_at.slice(0, 10))}</td></tr>`).join('')
    || '<tr><td colspan="5" class="sub">Aún no hay clientes.</td></tr>';
}

// ---------------------------------------------------------------
// PARTE 7: GASTOS (registrar, listar, borrar)
// ---------------------------------------------------------------
async function cargarGastos() {
  const g = await api('/gastos');
  const ganancia = g.ingresos_mes - g.gastos_mes;
  $('kpisGastos').innerHTML = kpi('Ingresos del mes', money(g.ingresos_mes), 'pos') + kpi('Gastos del mes', money(g.gastos_mes)) +
    kpi('Ganancia', money(ganancia), ganancia < 0 ? 'neg' : 'pos') + kpi('Gastos registrados', g.lista.length);
  $('tGastos').innerHTML = g.lista.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.concept)}</td><td>${money(x.amount)}</td><td>${esAdmin() ? `<button class="btn sm ghost" data-del="${x.id}">✕</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="4" class="sub">Sin gastos registrados.</td></tr>';
  if (!$('gFecha').value) $('gFecha').value = hoyISO();
}
$('gAgregar').onclick = async () => {
  $('gErr').textContent = '';
  try {
    await api('/gastos', { method: 'POST', body: { concepto: $('gConcepto').value, monto: $('gMonto').value, fecha: $('gFecha').value } });
    $('gConcepto').value = ''; $('gMonto').value = ''; cargarGastos();
  } catch (e) { $('gErr').textContent = e.message; }
};
$('tGastos').onclick = async (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  if (confirm('¿Borrar este gasto?')) { await api('/gastos/' + b.dataset.del, { method: 'DELETE' }); cargarGastos(); }
};

// ---------------------------------------------------------------
// PARTE 8: SERVICIOS (cambiar precio, ocultar, agregar)
// ---------------------------------------------------------------
async function cargarServicios() {
  const lista = await api('/servicios');
  $('tServicios').innerHTML = lista.map((s) => `<tr>
    <td>${esc(s.name)}</td>
    <td>${esAdmin() ? `<input type="number" min="0" value="${s.price}" data-precio="${s.id}" style="width:100px">` : money(s.price)}</td>
    <td>${s.active ? 'Sí' : 'No'}</td>
    <td>${esAdmin() ? `<div class="acts"><button class="btn sm" data-guardar="${s.id}">Guardar precio</button>
    <button class="btn sm ghost" data-toggle="${s.id}" data-activo="${s.active ? 0 : 1}">${s.active ? 'Ocultar' : 'Mostrar'}</button></div>` : ''}</td></tr>`).join('');
}
$('tServicios').onclick = async (e) => {
  const g = e.target.closest('[data-guardar]'), t = e.target.closest('[data-toggle]');
  try {
    if (g) { const precio = document.querySelector(`[data-precio="${g.dataset.guardar}"]`).value; await api('/servicios/' + g.dataset.guardar, { method: 'PATCH', body: { precio } }); }
    if (t) await api('/servicios/' + t.dataset.toggle, { method: 'PATCH', body: { activo: t.dataset.activo === '1' } });
    if (g || t) cargarServicios();
  } catch (er) { alert(er.message); }
};
$('sAgregar').onclick = async () => {
  try { await api('/servicios', { method: 'POST', body: { nombre: $('sNombre').value, precio: $('sPrecio').value } }); $('sNombre').value = ''; $('sPrecio').value = ''; cargarServicios(); }
  catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------
// PARTE 9: BARBEROS Y SU HORARIO
// Cada barbero tiene sus días y su hora de entrada/salida.
// Los clientes solo ven horas dentro de ese horario.
// ---------------------------------------------------------------
async function cargarBarberos() {
  const lista = await api('/barberos');
  $('tBarberos').innerHTML = lista.map((b) => {
    const dias = esAdmin()
      ? `<div class="dias">${DIAS_NOM.map((n, d) => `<label class="dia"><input type="checkbox" data-dia="${d}" data-b="${b.id}" ${b.dias.includes(d) ? 'checked' : ''}>${n}</label>`).join('')}</div>`
      : textoDias(b.dias);
    const horas = esAdmin()
      ? `<input type="time" data-ini="${b.id}" value="${b.inicio}" style="width:120px"> a <input type="time" data-fin="${b.id}" value="${b.fin}" style="width:120px">`
      : `${hora12(b.inicio)} a ${hora12(b.fin)}`;
    const acciones = esAdmin()
      ? `<div class="acts"><button class="btn sm" data-bg="${b.id}">Guardar horario</button>
         <button class="btn sm ghost" data-bt="${b.id}" data-activo="${b.active ? 0 : 1}">${b.active ? 'Desactivar' : 'Activar'}</button></div>`
      : '';
    return `<tr><td>${esc(b.name)}</td><td>${b.active ? 'Activo' : 'Inactivo'}</td><td>${dias}</td><td>${horas}</td><td>${acciones}</td></tr>`;
  }).join('');
}
$('tBarberos').onclick = async (e) => {
  const g = e.target.closest('[data-bg]'), t = e.target.closest('[data-bt]');
  try {
    if (g) {
      const id = g.dataset.bg;
      const dias = [...document.querySelectorAll(`[data-dia][data-b="${id}"]:checked`)].map((c) => Number(c.dataset.dia));
      await api('/barberos/' + id, { method: 'PATCH', body: { inicio: document.querySelector(`[data-ini="${id}"]`).value, fin: document.querySelector(`[data-fin="${id}"]`).value, dias } });
      alert('Horario guardado');
    }
    if (t) await api('/barberos/' + t.dataset.bt, { method: 'PATCH', body: { activo: t.dataset.activo === '1' } });
    if (g || t) cargarBarberos();
  } catch (er) { alert(er.message); }
};
$('bAgregar').onclick = async () => {
  try { await api('/barberos', { method: 'POST', body: { nombre: $('bNombre').value } }); $('bNombre').value = ''; cargarBarberos(); }
  catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------
// INICIO: si ya hay sesión guardada, entra directo al panel
// ---------------------------------------------------------------
if (token) mostrarApp();
