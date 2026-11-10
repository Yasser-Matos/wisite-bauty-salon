// =====================================================
// inicio.js  ->  LÓGICA DE LA PÁGINA DE INICIO (index.html)
// Pinta los datos de js/negocio.js, los servicios y el equipo (de la base de datos)
// y las fotos (de la carpeta public/fotos). Incluye la vista ampliada de fotos.
// =====================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONEDA = 'RD$';
const DIAS_NOM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const N = NEGOCIO_INFO;
// Un dato "vale" si no está vacío ni entre [corchetes] (los corchetes son los espacios que aún no llenas)
const lleno = (v) => typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('[');

const durTxt = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : ''); };
const formatoHora = (t) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };

// ---------- Portada ----------
function pintarPortada() {
  document.title = `${N.nombre} - ${N.eslogan}`;
  $('pEslogan').textContent = N.eslogan || N.nombre;
  $('pDescripcion').textContent = N.descripcion || '';
  $('pDestacados').innerHTML = (N.destacados || []).map((d) => `<span class="etiqueta">${esc(d)}</span>`).join('');
  $('pPie').textContent = `© ${new Date().getFullYear()} ${N.nombre}`;
}

// ---------- Servicios ----------
function pintarServicios(lista) {
  $('listaServicios').innerHTML = lista.length
    ? lista.map((s) => `<div class="svc-item"><span>${esc(s.name)}<br><small class="sub">${durTxt(Number(s.duracion || 60))}</small></span><span class="price">${MONEDA} ${Number(s.price).toLocaleString('es-DO')}</span></div>`).join('')
    : '<p class="sub">Muy pronto publicaremos nuestros servicios.</p>';
}

// ---------- Equipo ----------
function pintarEquipo(lista) {
  if (!lista.length) { $('equipo').classList.add('hide'); return; }
  $('listaEquipo').innerHTML = lista.map((b) => {
    const dias = b.dias.length === 7 ? 'Todos los días' : b.dias.map((d) => DIAS_NOM[d]).join(', ');
    return `<div class="miembro"><div class="avatar" aria-hidden="true">${esc(b.name.trim().charAt(0).toUpperCase())}</div>
      <div><b>${esc(b.name)}</b><br><small class="sub">${esc(dias)} · ${formatoHora(b.inicio)} a ${formatoHora(b.fin)}</small></div></div>`;
  }).join('');
}

// ---------- Promociones ----------
function pintarPromos(lista) {
  if (!lista.length) return;   // sin promociones, la sección queda oculta
  $('promos').classList.remove('hide');
  $('listaPromos').innerHTML = lista.map((p) => `<div class="promo">
      <div class="promo-t">${esc(p.title)}</div>
      ${p.description ? `<p class="sub">${esc(p.description)}</p>` : ''}
      <div class="promo-pie">${p.price_text ? `<span class="price">${esc(p.price_text)}</span>` : '<span></span>'}<a class="btn sm" href="reservar.html" style="text-decoration:none">Reservar</a></div>
    </div>`).join('');
}

// ---------- Reseñas ----------
const estrellasTxt = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
function pintarResenas(r) {
  if (!r.total) return;   // sin reseñas publicadas, la sección queda oculta
  $('resenas').classList.remove('hide');
  $('resumenResenas').innerHTML = `<span class="estrellas-fijas" aria-hidden="true">★</span> <b>${r.promedio.toFixed(1)}</b> de 5 · ${r.total} reseña${r.total === 1 ? '' : 's'}`;
  $('listaResenas').innerHTML = r.lista.map((x) => `<figure class="resena">
      <div class="estrellas-fijas" role="img" aria-label="${x.rating} de 5 estrellas">${estrellasTxt(x.rating)}</div>
      ${x.text ? `<blockquote>${esc(x.text)}</blockquote>` : ''}
      <figcaption class="sub">${esc(x.name)}</figcaption>
    </figure>`).join('');
}

// ---------- Datos para Google (se leen al indexar la página) ----------
function datosGoogle(r) {
  const d = { '@context': 'https://schema.org', '@type': 'BeautySalon', name: N.nombre, description: N.descripcion, url: location.origin + '/', image: location.origin + '/icons/icon-512.png' };
  if (lleno(N.telefono)) d.telephone = N.telefono;
  if (lleno(N.direccion)) d.address = { '@type': 'PostalAddress', streetAddress: N.direccion };
  const redes = [N.instagram, N.facebook].filter(lleno);
  if (redes.length) d.sameAs = redes;
  if (r.total >= 1) d.aggregateRating = { '@type': 'AggregateRating', ratingValue: r.promedio, reviewCount: r.total };   // solo con reseñas reales publicadas
  const s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(d).replace(/</g, '\\u003c');
  document.head.appendChild(s);
}

// ---------- Galería de fotos ----------
let fotos = [];
let actual = 0;
function pintarGaleria(lista) {
  fotos = lista;
  if (!fotos.length) {
    // Aún no hay fotos en la carpeta public/fotos: se muestran espacios de ejemplo
    $('galeria').innerHTML = Array.from({ length: 6 }, () => '<div class="foto vacia"><span>Pronto verás aquí nuestros trabajos</span></div>').join('');
    return;
  }
  $('galeria').innerHTML = fotos.map((f, i) =>
    `<button type="button" class="foto" data-i="${i}" aria-label="Ver foto ${i + 1}"><img src="${esc(f.src)}" alt="Trabajo realizado en ${esc(N.nombre)}" loading="lazy"></button>`).join('');
  document.querySelectorAll('.foto[data-i]').forEach((el) => { el.onclick = () => abrir(Number(el.dataset.i)); });
}
function abrir(i) {
  actual = (i + fotos.length) % fotos.length;
  $('lbImg').src = fotos[actual].src;
  $('lightbox').classList.remove('hide');
  $('lbCerrar').focus();
}
function cerrar() { $('lightbox').classList.add('hide'); $('lbImg').src = ''; }
$('lbCerrar').onclick = cerrar;
$('lbPrev').onclick = (e) => { e.stopPropagation(); abrir(actual - 1); };
$('lbNext').onclick = (e) => { e.stopPropagation(); abrir(actual + 1); };
$('lightbox').onclick = (e) => { if (e.target === $('lightbox')) cerrar(); };
document.addEventListener('keydown', (e) => {
  if ($('lightbox').classList.contains('hide')) return;
  if (e.key === 'Escape') cerrar();
  if (e.key === 'ArrowLeft') abrir(actual - 1);
  if (e.key === 'ArrowRight') abrir(actual + 1);
});

// ---------- Ubicación, horario y contacto ----------
function pintarInfo() {
  const filas = [];
  if (lleno(N.direccion)) {
    filas.push(`<div class="dato"><h3>Dirección</h3><p>${esc(N.direccion)}${N.referencia ? `<br><span class="sub">${esc(N.referencia)}</span>` : ''}</p></div>`);
  }
  if (N.horario && N.horario.length) {
    filas.push(`<div class="dato"><h3>Horario</h3>${N.horario.map(([d, h]) => `<div class="row"><span>${esc(d)}</span><b>${esc(h)}</b></div>`).join('')}</div>`);
  }
  const contacto = [];
  if (lleno(N.telefono)) contacto.push(`<div class="row"><span>Teléfono</span><b>${esc(N.telefono)}</b></div>`);
  const botones = [];
  if (lleno(N.whatsapp)) botones.push(`<a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(N.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent('Hola, quisiera información de ' + N.nombre)}">WhatsApp</a>`);
  if (lleno(N.instagram)) botones.push(`<a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(N.instagram)}">Instagram</a>`);
  if (lleno(N.facebook)) botones.push(`<a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(N.facebook)}">Facebook</a>`);
  if (contacto.length || botones.length) {
    filas.push(`<div class="dato"><h3>Contacto</h3>${contacto.join('')}<div class="acts" style="margin-top:10px">${botones.join('')}</div></div>`);
  }
  $('cInfo').innerHTML = filas.join('') || '<p class="sub">Muy pronto publicaremos nuestra información.</p>';

  // Mapa: se arma con la dirección (no necesita claves). Si no hay dirección, se oculta.
  if (lleno(N.direccion)) {
    const q = encodeURIComponent(N.direccion);
    $('cMapa').innerHTML = `<iframe title="Mapa de ${esc(N.nombre)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${q}&output=embed"></iframe>
      <a class="btn ghost sm" style="text-decoration:none;margin-top:10px;display:inline-block" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${q}">Cómo llegar</a>`;
  } else {
    $('cMapa').classList.add('hide');
    $('cInfo').parentElement.classList.remove('g2');
  }
}

// ---------- Inicio ----------
async function pedir(url, vacio) {
  try { const r = await fetch(url); return r.ok ? await r.json() : vacio; } catch (e) { return vacio; }
}
async function iniciar() {
  Push.registrar();   // registra la mini-app (necesaria para poder instalarla)
  pintarPortada();
  pintarInfo();
  const [servicios, equipo, lista, promos, resenas] = await Promise.all([
    pedir('/api/servicios', []), pedir('/api/barberos', []), pedir('/api/fotos', []),
    pedir('/api/promociones', []), pedir('/api/resenas', { lista: [], total: 0, promedio: 0 }),
  ]);
  pintarPromos(promos);
  pintarResenas(resenas);
  datosGoogle(resenas);
  pintarServicios(servicios);
  pintarEquipo(equipo);
  pintarGaleria(lista);
}
iniciar();
