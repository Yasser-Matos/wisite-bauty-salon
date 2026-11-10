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
const durTxt = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : ''); };
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
const CARGAR = { dashboard: cargarDashboard, citas: cargarCitas, clientes: cargarClientes, gastos: cargarGastos, servicios: cargarServicios, barberos: cargarBarberos,
  fotos: cargarFotos, promos: cargarPromos, resenas: cargarResenas, respaldo: async () => {} };

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
  actualizarInsignia();
}

// ---------------------------------------------------------------
// PARTE 4: DASHBOARD
// Dibuja tarjetas, resumen, gráfica de 7 días, top de servicios,
// dona de estados y próximas citas.
// ---------------------------------------------------------------
const kpi = (titulo, valor, extra = '') => `<div class="card kpi"><div class="l">${titulo}</div><div class="n ${extra}">${valor}</div></div>`;
const COLORES = { confirmada: '#d6457f', pendiente: '#ffb020', completada: '#3ddc68', cancelada: '#6b6b73' };

// Gráfica de línea hecha con SVG (ingresos por día)
function lineaSVG(datos) {
  const W = 600, H = 230, pl = 52, pr = 12, pt = 14, pb = 30;
  const max = Math.max(...datos.map((d) => d.total), 1000);
  const x = (i) => pl + ((W - pl - pr) * i) / (datos.length - 1);
  const y = (v) => H - pb - ((H - pt - pb) * v) / max;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos de los últimos 7 días">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4, yy = y(v);
    s += `<line x1="${pl}" y1="${yy}" x2="${W - pr}" y2="${yy}" stroke="#3a2a32"/>`;
    s += `<text x="${pl - 8}" y="${yy + 4}" fill="#9a9aa2" font-size="11" text-anchor="end">${Math.round(v).toLocaleString('es-DO')}</text>`;
  }
  s += `<polyline fill="none" stroke="#d6457f" stroke-width="3" points="${datos.map((d, i) => x(i) + ',' + y(d.total)).join(' ')}"/>`;
  datos.forEach((d, i) => {
    s += `<circle cx="${x(i)}" cy="${y(d.total)}" r="4.5" fill="#d6457f"><title>${d.fecha}: ${money(d.total)}</title></circle>`;
    s += `<text x="${x(i)}" y="${H - 8}" fill="#9a9aa2" font-size="12" text-anchor="middle">${d.dia}</text>`;
  });
  return s + '</svg>';
}

// Dona hecha con SVG (citas por estado)
function donaSVG(estados) {
  const total = Object.values(estados).reduce((a, b) => a + b, 0);
  const R = 40, C = 2 * Math.PI * R;
  let s = `<svg width="150" height="150" viewBox="0 0 100 100" role="img" aria-label="Citas por estado"><circle cx="50" cy="50" r="${R}" fill="none" stroke="#3a2a32" stroke-width="16"/>`;
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

// Mensaje de recordatorio para una cita confirmada (botón "Recordar"). PARA CAMBIARLO: edita "msg".
function enlaceRecordatorio(c) {
  const msg = `Hola ${c.cliente}, te recordamos tu cita en ${NEGOCIO}:\n${c.servicio} con ${c.barbero}\n${fechaLarga(c.date)}, ${hora12(c.time)}\n¡Te esperamos!`;
  return `https://wa.me/${telWA(c.telefono)}?text=${encodeURIComponent(msg)}`;
}

async function cargarCitas() {
  const lista = await api('/citas?filtro=' + $('filtro').value);
  $('tCitas').innerHTML = lista.map((c) => `<tr>
    <td>${esc(c.date)}</td><td>${hora12(c.time)}<br><small class="sub">${durTxt(Number(c.duration || 60))}</small></td>
    <td>${esc(c.cliente)}<br><small class="sub">${esc(c.telefono)}</small></td>
    <td>${esc(c.servicio)}</td><td>${esc(c.barbero)}</td><td>${money(c.price)}</td>
    <td><span class="badge b-${c.status}">${c.status}</span>${c.avisos ? '<span class="campana" title="El cliente activó los avisos en su celular">🔔</span>' : ''}</td>
    <td><div class="acts">
      ${c.status === 'pendiente' ? `<button class="btn sm" data-est="confirmada" data-id="${c.id}">Confirmar</button>` : ''}
      ${c.status === 'confirmada' ? `<a class="btn sm wa" href="${esc(enlaceWA(c))}" target="_blank" rel="noopener" title="Abre WhatsApp con el mensaje de confirmación listo">WhatsApp</a>` : ''}
      ${c.status === 'confirmada' && c.date >= hoyISO() ? `<a class="btn sm ghost" href="${esc(enlaceRecordatorio(c))}" target="_blank" rel="noopener" title="Abre WhatsApp con un recordatorio de la cita">Recordar</a>` : ''}
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
    <td>${esAdmin() ? `<input type="number" min="15" max="480" step="15" value="${s.duration_min}" data-dur="${s.id}" style="width:80px"> min` : durTxt(s.duration_min)}</td>
    <td>${s.active ? 'Sí' : 'No'}</td>
    <td>${esAdmin() ? `<div class="acts"><button class="btn sm" data-guardar="${s.id}">Guardar</button>
    <button class="btn sm ghost" data-toggle="${s.id}" data-activo="${s.active ? 0 : 1}">${s.active ? 'Ocultar' : 'Mostrar'}</button></div>` : ''}</td></tr>`).join('');
}
$('tServicios').onclick = async (e) => {
  const g = e.target.closest('[data-guardar]'), t = e.target.closest('[data-toggle]');
  try {
    if (g) { const precio = document.querySelector(`[data-precio="${g.dataset.guardar}"]`).value; const duracion = document.querySelector(`[data-dur="${g.dataset.guardar}"]`).value; await api('/servicios/' + g.dataset.guardar, { method: 'PATCH', body: { precio, duracion } }); }
    if (t) await api('/servicios/' + t.dataset.toggle, { method: 'PATCH', body: { activo: t.dataset.activo === '1' } });
    if (g || t) cargarServicios();
  } catch (er) { alert(er.message); }
};
$('sAgregar').onclick = async () => {
  try { await api('/servicios', { method: 'POST', body: { nombre: $('sNombre').value, precio: $('sPrecio').value, duracion: $('sDur').value } }); $('sNombre').value = ''; $('sPrecio').value = ''; $('sDur').value = 60; cargarServicios(); }
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
// PARTE 10: FOTOS DE TRABAJOS
// Se suben desde aquí y salen en la galería de la página de inicio.
// Cada foto se reduce en el navegador (máx. 1400 px) antes de enviarla.
// ---------------------------------------------------------------
async function cargarFotos() {
  const lista = await api('/fotos');
  $('gFotos').innerHTML = lista.length
    ? lista.map((f) => `<figure class="foto-admin"><img src="${esc(f.src)}" alt="Foto de trabajo subida el ${esc(f.fecha)}" loading="lazy">${esAdmin() ? `<button class="btn sm ghost" data-borrar-foto="${f.id}" aria-label="Borrar foto">Borrar</button>` : ''}</figure>`).join('')
    : '<p class="sub">Aún no has subido fotos desde aquí. (Las que pongas en la carpeta public/fotos del código también salen en la página.)</p>';
}
// Reduce una foto a JPG de máx. 1400 px y calidad ajustada para que pese menos de ~1.4 MB
async function reducirImagen(archivo) {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85, url;
  do { url = c.toDataURL('image/jpeg', q); q -= 0.1; } while (url.length > 1.9e6 && q > 0.3);
  return url;
}
$('fArchivos').onchange = async () => {
  const archivos = [...$('fArchivos').files].slice(0, 10);
  let subidas = 0, fallos = 0;
  for (let i = 0; i < archivos.length; i++) {
    $('fEstado').textContent = `Subiendo foto ${i + 1} de ${archivos.length}…`;
    try { await api('/fotos', { method: 'POST', body: { imagen: await reducirImagen(archivos[i]) } }); subidas++; }
    catch (e) { fallos++; $('fEstado').textContent = e.message; if (/Ya tienes/.test(e.message)) break; }
  }
  $('fArchivos').value = '';
  $('fEstado').textContent = `${subidas} foto${subidas === 1 ? '' : 's'} subida${subidas === 1 ? '' : 's'}.` + (fallos ? ` ${fallos} no se pudo${fallos === 1 ? '' : 'ieron'} subir.` : '');
  cargarFotos();
};
$('gFotos').onclick = async (e) => {
  const b = e.target.closest('[data-borrar-foto]'); if (!b) return;
  if (!confirm('¿Borrar esta foto?')) return;
  try { await api('/fotos/' + b.dataset.borrarFoto, { method: 'DELETE' }); cargarFotos(); } catch (er) { alert(er.message); }
};

// ---------------------------------------------------------------
// PARTE 11: PROMOCIONES Y PAQUETES
// ---------------------------------------------------------------
async function cargarPromos() {
  const lista = await api('/promociones');
  $('tPromos').innerHTML = lista.map((p) => `<tr>
    <td><b>${esc(p.title)}</b>${p.description ? `<br><small class="sub">${esc(p.description)}</small>` : ''}</td>
    <td>${esc(p.price_text)}</td><td>${p.active ? 'Sí' : 'No'}</td>
    <td>${esAdmin() ? `<div class="acts"><button class="btn sm ghost" data-ptoggle="${p.id}" data-activo="${p.active ? 0 : 1}">${p.active ? 'Ocultar' : 'Mostrar'}</button>
      <button class="btn sm ghost" data-pdel="${p.id}">Borrar</button></div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="sub">Aún no hay promociones.</td></tr>';
}
$('tPromos').onclick = async (e) => {
  const t = e.target.closest('[data-ptoggle]'), d = e.target.closest('[data-pdel]');
  try {
    if (t) await api('/promociones/' + t.dataset.ptoggle, { method: 'PATCH', body: { activo: t.dataset.activo === '1' } });
    if (d && confirm('¿Borrar esta promoción?')) await api('/promociones/' + d.dataset.pdel, { method: 'DELETE' });
    if (t || d) cargarPromos();
  } catch (er) { alert(er.message); }
};
$('pAgregar').onclick = async () => {
  try {
    await api('/promociones', { method: 'POST', body: { titulo: $('pTitulo').value, descripcion: $('pDesc').value, precio: $('pPrecio').value } });
    $('pTitulo').value = ''; $('pDesc').value = ''; $('pPrecio').value = ''; cargarPromos();
  } catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------
// PARTE 12: RESEÑAS (aprobar para que salgan en la página de inicio)
// ---------------------------------------------------------------
async function actualizarInsignia() {
  try {
    const n = (await api('/resenas')).filter((r) => r.status === 'pendiente').length;
    $('insigniaResenas').textContent = n; $('insigniaResenas').classList.toggle('hide', !n);
  } catch (e) { /* no importa */ }
}
async function cargarResenas() {
  const lista = await api('/resenas');
  const ETIQUETA = { pendiente: 'Pendiente', publicada: 'Publicada', oculta: 'Oculta' };
  $('listaResenasAdmin').innerHTML = lista.map((r) => `<div class="card resena-admin ${r.status}">
      <div><span class="estrellas-fijas" aria-label="${r.rating} de 5 estrellas">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
      <b style="margin-left:8px">${esc(r.name)}</b> <small class="sub">${esc(r.fecha)}</small>
      <span class="badge ${r.status === 'publicada' ? 'b-completada' : r.status === 'pendiente' ? 'b-pendiente' : 'b-cancelada'}" style="margin-left:8px">${ETIQUETA[r.status]}</span></div>
      ${r.text ? `<p style="margin:8px 0">${esc(r.text)}</p>` : '<p class="sub" style="margin:8px 0">(sin comentario)</p>'}
      ${esAdmin() ? `<div class="acts">
        ${r.status !== 'publicada' ? `<button class="btn sm" data-rs="publicada" data-id="${r.id}">Publicar</button>` : ''}
        ${r.status !== 'oculta' ? `<button class="btn sm ghost" data-rs="oculta" data-id="${r.id}">Ocultar</button>` : ''}
        <button class="btn sm ghost" data-rdel="${r.id}">Borrar</button></div>` : ''}
    </div>`).join('') || '<div class="card"><p class="sub">Todavía no hay reseñas.</p></div>';
  actualizarInsignia();
}
$('listaResenasAdmin').onclick = async (e) => {
  const s = e.target.closest('[data-rs]'), d = e.target.closest('[data-rdel]');
  try {
    if (s) await api('/resenas/' + s.dataset.id, { method: 'PATCH', body: { status: s.dataset.rs } });
    if (d && confirm('¿Borrar esta reseña?')) await api('/resenas/' + d.dataset.rdel, { method: 'DELETE' });
    if (s || d) cargarResenas();
  } catch (er) { alert(er.message); }
};

// ---------------------------------------------------------------
// PARTE 13: RESPALDO (descargar una copia de la base de datos)
// ---------------------------------------------------------------
$('bRespaldo').onclick = async () => {
  $('rEstado').textContent = 'Preparando…';
  try {
    const r = await fetch('/api/admin/respaldo', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo crear el respaldo');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'respaldo-salon-' + hoyISO() + '.db';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('rEstado').textContent = 'Listo: el archivo se descargó.';
  } catch (e) { $('rEstado').textContent = e.message; }
};

// ---------------------------------------------------------------
// INICIO: si ya hay sesión guardada, entra directo al panel
// ---------------------------------------------------------------
if (token) mostrarApp();
