// =====================================================
// instalar.js  ->  BOTÓN "INSTALAR APP" (lo usan index.html y cita.html)
// Deja el ícono de tu salón en la pantalla de inicio del celular y abre la misma
// página a pantalla completa. NO es una app de tienda: es tu página, instalada.
//
// Cómo se comporta según el celular:
//   - Android / Chrome / Edge: el botón abre el cuadro oficial de instalación.
//   - iPhone / iPad: Apple no permite instalar con un botón, así que se muestran los 3 pasos.
//   - Otros: si es Android pero el navegador no ofrece instalar solo, se explica dónde está en el menú.
//   - Si la página ya está instalada (abierta desde el ícono), el aviso no sale.
//   - Si el cliente lo cierra con la ✕, no vuelve a salir en 7 días.
// PARA CAMBIAR LOS TEXTOS: edita PASOS aquí abajo y el texto del aviso en index.html / cita.html.
// =====================================================
const Instalar = (() => {
  const $ = (id) => document.getElementById(id);
  const CLAVE = 'bp_instalar_no';   // aquí se recuerda que el cliente cerró el aviso
  const DIAS_OCULTO = 7;            // cuántos días no se le vuelve a mostrar

  const PASOS = {
    ios: ['Toca el botón <b>Compartir</b> (el cuadro con una flecha hacia arriba) en la barra de Safari.',
          'Baja y elige <b>«Agregar a pantalla de inicio»</b>.',
          'Toca <b>«Agregar»</b>. ¡Listo! El ícono queda junto a tus otras apps.'],
    manual: ['Abre el menú de tu navegador (los tres puntos <b>⋮</b>).',
             'Elige <b>«Instalar aplicación»</b> o <b>«Agregar a la pantalla de inicio»</b>.',
             'Confirma con <b>«Instalar»</b> o <b>«Agregar»</b>.'],
  };

  let evento = null;   // el evento "beforeinstallprompt" que entrega el navegador cuando se puede instalar
  let modo = null;     // 'nativo' | 'ios' | 'manual'

  const instalada = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esAndroid = () => /android/i.test(navigator.userAgent);

  function cerradoAntes() {
    try { const t = Number(localStorage.getItem(CLAVE)); return Boolean(t) && Date.now() - t < DIAS_OCULTO * 86400000; }
    catch (e) { return false; }   // sin almacenamiento: se muestra igual
  }
  function recordarCierre() { try { localStorage.setItem(CLAVE, String(Date.now())); } catch (e) { /* no pasa nada */ } }

  function ocultar() { const b = $('instalarBox'); if (b) b.classList.add('hide'); }
  function mostrar(m) {
    const b = $('instalarBox');
    if (!b || instalada() || cerradoAntes()) return;
    modo = m;
    b.classList.remove('hide');
  }

  // Dibuja la lista de pasos debajo del aviso
  function verPasos(tipo) {
    const cont = $('instalarPasos');
    cont.innerHTML = '<ol>' + PASOS[tipo].map((p) => '<li>' + p + '</li>').join('') + '</ol>';
    cont.classList.remove('hide');
  }

  async function alTocarInstalar() {
    if (modo === 'nativo' && evento) {
      const e = evento; evento = null;   // el navegador solo permite usarlo una vez
      try {
        await e.prompt();
        const r = await e.userChoice;
        if (r && r.outcome === 'accepted') { ocultar(); return; }
      } catch (err) { /* el navegador no lo dejó abrir: se muestran los pasos */ }
      modo = 'manual';
    }
    verPasos(modo === 'ios' ? 'ios' : 'manual');
  }

  function iniciar() {
    if (!$('instalarBox')) return;
    $('instalarBtn').onclick = alTocarInstalar;
    $('instalarCerrar').onclick = () => { ocultar(); recordarCierre(); };

    // Chrome / Edge / Android avisan cuando la página se puede instalar
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evento = e; mostrar('nativo'); });
    // Cuando ya se instaló, el aviso sobra
    window.addEventListener('appinstalled', () => { evento = null; ocultar(); recordarCierre(); });

    if (instalada()) return;
    if (esIOS()) mostrar('ios');
    // Android donde el navegador no ofreció instalar solo (por ejemplo, ya lo rechazó antes): se explica el menú
    else if (esAndroid()) setTimeout(() => { if (!evento) mostrar('manual'); }, 3000);
  }

  iniciar();
  return { instalada };
})();
