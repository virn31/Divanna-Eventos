// brigadas/calendario.js
// Calendario del equipo (lo usan la app y el dashboard). Todos ven todos los
// eventos autorizados del mes y los días bloqueados, sin montos. Diana, Víctor
// y la gerente (ella solo El Vaso Maíz) pueden mover fecha/hora, cambiar horas
// de servicio, cancelar y bloquear días. Los cambios avisan al equipo y se
// reflejan en Google Calendar (api/_calendario.js).
// Uso: DimaCalendario.abrir({ api, esc }) — api(url, opciones) es el fetch con
// sesión de cada página (lanza Error con el mensaje del servidor).
window.DimaCalendario = (function(){
  const COLOR = { 'Divanna Eventos': '#3987e5', 'El Vaso Maiz': '#d95926' };
  const NOMBRE = { 'Divanna Eventos': 'Divanna', 'El Vaso Maiz': 'El Vaso Maíz', 'Ambos': 'los dos negocios' };
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  let o = null, mes = null, datos = null, diaSel = null, panel = null;

  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
  const textoDia = (f) => { const d = new Date(`${f}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };
  const textoMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const moverMes = (m, n) => { let [a, b] = m.split('-').map(Number); b += n; if(b > 12){ b = 1; a++; } if(b < 1){ b = 12; a--; } return `${a}-${String(b).padStart(2, '0')}`; };

  function estilos(){
    if(document.getElementById('calEstilos')) return;
    const s = document.createElement('style');
    s.id = 'calEstilos';
    s.textContent = `
      .cal-panel{position:fixed; inset:0; z-index:70; overflow-y:auto; background:var(--ink-2); color:var(--paper); padding:16px 16px 40px; font-size:1rem;}
      .cal-panel[hidden]{display:none;}
      .cal-cont{max-width:760px; margin:0 auto;}
      .cal-top{display:flex; justify-content:space-between; align-items:center; font-weight:800; font-size:1.15rem;}
      .cal-top button, .cal-nav button{border:1.5px solid var(--line); background:var(--ink); color:var(--paper); border-radius:10px; padding:8px 14px; font:inherit; font-weight:700; cursor:pointer;}
      .cal-nav{display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px; font-weight:800; font-size:1.1rem; text-transform:capitalize;}
      .cal-ley{display:flex; flex-wrap:wrap; gap:14px; font-size:0.85rem; color:var(--muted); margin-bottom:8px;}
      .cal-ley i{display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:middle;}
      .cal-grid{display:grid; grid-template-columns:repeat(7, 1fr); gap:4px;}
      .cal-dsem{text-align:center; font-size:0.75rem; color:var(--muted); padding:4px 0;}
      .cal-dia{min-height:54px; border:1.5px solid var(--line); border-radius:10px; background:var(--ink); padding:4px; cursor:pointer; text-align:left; color:var(--paper); font:inherit;}
      .cal-dia.vacio{visibility:hidden;}
      .cal-dia.hoy{border-color:var(--maiz);}
      .cal-dia.sel{outline:2px solid var(--maiz);}
      .cal-dia.bloq{background:repeating-linear-gradient(135deg, var(--ink), var(--ink) 6px, rgba(255,107,107,0.12) 6px, rgba(255,107,107,0.12) 12px);}
      .cal-num{font-size:0.85rem; font-weight:800;}
      .cal-pts{display:flex; flex-wrap:wrap; gap:3px; margin-top:4px;}
      .cal-pts i{width:9px; height:9px; border-radius:50%; display:block; box-shadow:0 0 0 2px var(--ink);}
      .cal-sec{margin-top:16px; font-weight:800; font-size:1.05rem;}
      .cal-ev{margin-top:10px; padding:12px 14px; border-radius:12px; background:var(--ink); border:1px solid var(--line); border-left:5px solid var(--c);}
      .cal-ev small, .cal-sub{color:var(--muted); font-size:0.85rem;}
      .cal-acc{display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;}
      .cal-acc button, .cal-form button{border:none; border-radius:10px; padding:10px 14px; font:inherit; font-weight:800; cursor:pointer; background:var(--maiz); color:var(--ink);}
      .cal-acc button.sec, .cal-form button.sec{background:var(--line); color:var(--paper);}
      .cal-acc button.peligro, .cal-form button.peligro{background:#e66767; color:#fff;}
      .cal-form{margin-top:10px; display:grid; gap:8px;}
      .cal-form input, .cal-form select{padding:10px 12px; border-radius:10px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit;}
      .cal-msg{margin-top:8px; font-size:0.88rem;}
      .cal-bloq{margin-top:10px; padding:10px 12px; border-radius:12px; border:1px dashed #e66767; display:flex; justify-content:space-between; gap:8px; align-items:center;}
    `;
    document.head.appendChild(s);
  }

  function crearPanel(){
    if(panel) return;
    estilos();
    panel = document.createElement('div');
    panel.className = 'cal-panel';
    panel.hidden = true;
    panel.innerHTML = '<div class="cal-cont"><div class="cal-top"><span>📅 Calendario del equipo</span><button data-cal="cerrar">✕ Cerrar</button></div><div id="calCuerpo"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', clic);
  }

  async function cargar(){
    const cuerpo = panel.querySelector('#calCuerpo');
    cuerpo.innerHTML = '<div class="cal-sub" style="margin-top:16px;">Cargando…</div>';
    try {
      datos = await o.api(`/api/brigada-eventos?vista=calendario&mes=${mes}`);
      pintar();
    } catch(e){
      if(e.message === 'sesion') return;
      cuerpo.innerHTML = `<div class="cal-msg">⚠️ No se pudo cargar el calendario (${o.esc(e.message && e.message !== 'fail' ? e.message : 'sin conexión')}). Revisa tu señal e intenta de nuevo.</div>`;
    }
  }

  function tarjetaEvento(ev){
    const e = o.esc;
    const hora = ev.hora ? `🕒 ${e(ev.hora)}${ev.horasServicio ? ` · ${e(ev.horasServicio)} h` : ''}` : '🕒 hora por confirmar';
    return `
      <div class="cal-ev" style="--c:${COLOR[ev.negocio] || '#888'};" data-ev="${e(ev.id)}">
        <b>${e(ev.folio)}</b> · ${e(NOMBRE[ev.negocio] || ev.negocio)}<br>
        <small>${e(textoDia(ev.fecha))} · ${hora}</small><br>
        <small>📍 ${e(ev.ubicacion || 'ubicación por confirmar')}${ev.invitados ? ` · 👥 ${e(ev.invitados)}` : ''}</small><br>
        <small>👷 ${e(ev.brigada || 'sin brigada')}${ev.estatus ? ` · ${e(ev.estatus)}` : ''}${ev.enGoogle ? ' · 📆 en Google' : ''}</small>
        ${ev.editable ? `<div class="cal-acc"><button data-cal="editar" data-id="${e(ev.id)}">✏️ Cambiar fecha u hora</button><button class="sec" data-cal="pre-cancelar" data-id="${e(ev.id)}">❌ Cancelar evento</button></div>` : ''}
        <div class="cal-zona"></div>
      </div>`;
  }

  function pintar(){
    const e = o.esc;
    const [a, m] = mes.split('-').map(Number);
    const primero = new Date(Date.UTC(a, m - 1, 1)).getUTCDay(); // 0 = domingo
    const desplazo = (primero + 6) % 7; // semana empieza en lunes
    const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const porDia = {};
    datos.eventos.forEach(ev => { (porDia[ev.fecha] = porDia[ev.fecha] || []).push(ev); });
    const bloqDia = {};
    datos.bloqueos.forEach(b => { (bloqDia[b.fecha] = bloqDia[b.fecha] || []).push(b); });
    let celdas = '';
    for(let i = 0; i < desplazo; i++) celdas += '<div class="cal-dia vacio"></div>';
    for(let d = 1; d <= diasMes; d++){
      const f = `${mes}-${String(d).padStart(2, '0')}`;
      const evs = porDia[f] || [];
      celdas += `<button class="cal-dia ${f === hoy() ? 'hoy' : ''} ${f === diaSel ? 'sel' : ''} ${bloqDia[f] ? 'bloq' : ''}" data-cal="dia" data-f="${f}" aria-label="${e(textoDia(f))}: ${evs.length} eventos${bloqDia[f] ? ', bloqueado' : ''}">
        <span class="cal-num">${d}</span>${bloqDia[f] ? ' ⛔' : ''}
        <span class="cal-pts">${evs.slice(0, 6).map(ev => `<i style="background:${COLOR[ev.negocio] || '#888'};"></i>`).join('')}</span></button>`;
    }
    const lista = diaSel ? (porDia[diaSel] || []) : datos.eventos;
    const bloqueos = diaSel ? (bloqDia[diaSel] || []) : datos.bloqueos;
    const negociosBloqueo = datos.soloVasoMaiz ? ['El Vaso Maiz'] : ['Ambos', 'Divanna Eventos', 'El Vaso Maiz'];
    panel.querySelector('#calCuerpo').innerHTML = `
      ${datos.puedeEditar ? `<div class="cal-form" style="margin-top:12px;"><button data-cal="nuevo">➕ Capturar evento</button></div><div id="calNuevo"></div>` : ''}
      <div class="cal-nav"><button data-cal="mes" data-n="-1">‹</button><span>${e(textoMes(mes))}</span><button data-cal="mes" data-n="1">›</button></div>
      <div class="cal-ley"><span><i style="background:${COLOR['Divanna Eventos']};"></i>Divanna</span><span><i style="background:${COLOR['El Vaso Maiz']};"></i>El Vaso Maíz</span><span>⛔ día bloqueado</span></div>
      <div class="cal-grid">${['L','M','M','J','V','S','D'].map(x => `<div class="cal-dsem">${x}</div>`).join('')}${celdas}</div>
      <div class="cal-sec">${diaSel ? `${e(textoDia(diaSel))} <button class="sec" data-cal="todo" style="border:none; background:none; color:var(--muted); font:inherit; cursor:pointer;">(ver todo el mes)</button>` : `Eventos de ${e(textoMes(mes))} (${datos.eventos.length})`}</div>
      ${bloqueos.map(b => `<div class="cal-bloq"><span>⛔ ${e(textoDia(b.fecha))} · ${e(NOMBRE[b.negocio] || b.negocio)} · ${e(b.motivo)}</span>${b.editable ? `<button class="sec" data-cal="desbloquear" data-id="${e(b.id)}" style="border:none; border-radius:10px; padding:8px 12px; background:var(--line); color:var(--paper); font:inherit; cursor:pointer;">Quitar</button>` : ''}</div>`).join('')}
      ${lista.length ? lista.map(tarjetaEvento).join('') : `<div class="cal-sub" style="margin-top:8px;">${diaSel ? 'No hay eventos este día.' : 'No hay eventos autorizados este mes.'}</div>`}
      ${datos.puedeEditar && !datos.soloVasoMaiz ? `
        <div class="cal-sec">📆 Google Calendar</div>
        <div class="cal-sub">Los eventos que se autorizaron antes de conectar Google no están ahí. Este botón los pasa (de hoy en adelante, 20 por vez).</div>
        <div class="cal-form"><button class="sec" data-cal="sincronizar">🔄 Pasar los eventos a Google</button><div class="cal-msg" id="calSyncMsg"></div></div>` : ''}
      ${datos.puedeEditar ? `
        <div class="cal-sec">⛔ Bloquear un día</div>
        <div class="cal-sub">DiMa ya no ofrece ese día a los clientes de ese negocio.</div>
        <div class="cal-form" id="calBloq">
          <input type="date" id="calBloqFecha" min="${hoy()}" value="${diaSel && diaSel >= hoy() ? diaSel : ''}">
          <select id="calBloqNeg">${negociosBloqueo.map(n => `<option value="${e(n)}">${e(n === 'Ambos' ? 'Los dos negocios' : NOMBRE[n])}</option>`).join('')}</select>
          <input id="calBloqMotivo" maxlength="120" placeholder="Motivo (ej. vacaciones, mantenimiento)">
          <button data-cal="bloquear">Bloquear día</button>
          <div class="cal-msg" id="calBloqMsg"></div>
        </div>` : ''}`;
  }

  function resultado(d){
    const e = o.esc;
    const g = d.google;
    const google = !g ? '' : g.ok ? ' 📆 Google actualizado.' : ` ⚠️ ${e(g.error || 'Google no se actualizó')}`;
    const avisos = d.avisados != null ? ` Avisos al equipo: ${d.avisados} (Telegram ${d.porTelegram || 0}, app ${d.porPush || 0}).` : '';
    return `✅ Listo.${avisos}${google}`;
  }

  // ---------- ➕ Capturar evento (los que se apartaron fuera del chat) ----------
  // Entra ya autorizado; el anticipo queda como pago a Diana (cuadre).
  function filaProducto(){
    const e = o.esc;
    return `<div class="cal-prod" style="display:flex; gap:6px;"><select class="calProdClave" style="flex:1;"><option value="">— producto de El Vaso Maíz —</option>${(datos.catalogoVM || []).map(p => `<option value="${e(p.clave)}">${e(p.nombre)}</option>`).join('')}</select><input class="calProdCant" type="number" min="1" placeholder="Cant." style="width:80px;"></div>`;
  }

  function formularioNuevo(){
    const e = o.esc;
    const caja = panel.querySelector('#calNuevo');
    if(caja.innerHTML){ caja.innerHTML = ''; return; }
    const negocios = datos.soloVasoMaiz ? ['El Vaso Maiz'] : ['Divanna Eventos', 'El Vaso Maiz'];
    caja.innerHTML = `
      <div class="cal-ev" style="--c:var(--maiz);">
        <b>➕ Capturar evento</b>
        <div class="cal-sub">Para los eventos que ya se apartaron por teléfono o en persona. Entra ya autorizado y avisa al calendario de Google.</div>
        <div class="cal-form">
          <input id="calNNombre" maxlength="80" placeholder="Nombre del cliente">
          <input id="calNTel" inputmode="tel" maxlength="15" placeholder="Teléfono del cliente (10 dígitos)">
          <select id="calNNeg">${negocios.map(n => `<option value="${e(n)}">${e(NOMBRE[n])}</option>`).join('')}</select>
          <label class="cal-sub">Fecha <input type="date" id="calNFecha" value="${diaSel || ''}"></label>
          <label class="cal-sub">Hora de inicio <input type="time" id="calNHora"></label>
          <label class="cal-sub">Horas de servicio <input type="number" id="calNHoras" min="1" max="12" step="0.5" placeholder="Ej. 2"></label>
          <input id="calNLugar" maxlength="200" placeholder="Lugar (colonia, salón o dirección)">
          <input id="calNInv" type="number" min="1" placeholder="Invitados">
          <textarea id="calNServ" rows="4" maxlength="4000" placeholder="Qué lleva, uno por línea (sale como checklist de carga)" style="padding:10px 12px; border-radius:10px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit;"></textarea>
          <div id="calProdsCaja"><div class="cal-sub">El Vaso Maíz: paquetes y piezas (con esto sale la producción y el personal)</div><div id="calProds">${filaProducto()}</div><button class="sec" data-cal="otro-producto">+ Otro producto</button></div>
          <input id="calNMonto" inputmode="decimal" placeholder="Monto contratado (total)">
          <div style="display:flex; gap:6px;"><input id="calNAnt" inputmode="decimal" placeholder="Anticipo ya recibido (si hubo)" style="flex:1;"><select id="calNAntForma"><option>Efectivo</option><option>Transferencia</option><option>Depósito</option></select></div>
          <input id="calNInstr" maxlength="2000" placeholder="Instrucciones para el equipo (opcional)">
          <button data-cal="capturar">Guardar evento</button>
          <div class="cal-msg" id="calNMsg"></div>
        </div>
      </div>`;
    const negSel = caja.querySelector('#calNNeg');
    const prods = caja.querySelector('#calProdsCaja');
    const ver = () => { prods.hidden = negSel.value !== 'El Vaso Maiz'; };
    negSel.addEventListener('change', ver); ver();
  }

  async function capturar(b){
    const e = o.esc;
    const v = (id) => panel.querySelector('#' + id).value;
    const msg = panel.querySelector('#calNMsg');
    const negocio = v('calNNeg');
    const productos = negocio === 'El Vaso Maiz' ? [...panel.querySelectorAll('.cal-prod')]
      .map(f => ({ clave: f.querySelector('.calProdClave').value, cantidad: Number(f.querySelector('.calProdCant').value) }))
      .filter(p => p.clave && p.cantidad > 0) : [];
    b.disabled = true;
    msg.textContent = 'Guardando…';
    try {
      const d = await post({
        accion: 'capturar_evento', clienteNombre: v('calNNombre'), clienteTelefono: v('calNTel'), negocio,
        fecha: v('calNFecha'), hora: v('calNHora'), horasServicio: v('calNHoras'), ubicacion: v('calNLugar'), invitados: v('calNInv'),
        servicios: v('calNServ'), productos, montoContratado: v('calNMonto'), anticipo: v('calNAnt'), formaAnticipo: v('calNAntForma'), instrucciones: v('calNInstr'),
      });
      msg.innerHTML = `✅ Evento ${e(d.folio)} guardado${d.clienteNuevo ? ' (cliente nuevo)' : ` (cliente ya registrado: ${e(d.cliente || '')})`}.${d.anticipoGuardado ? ' Anticipo registrado.' : ''}${d.google ? (d.google.ok ? ' 📆 En Google.' : ` ⚠️ ${e(d.google.error || 'Google no se actualizó')}`) : ''} Ahora asígnale brigada en el dashboard.`;
      if(v('calNFecha')){ mes = v('calNFecha').slice(0, 7); diaSel = v('calNFecha'); }
      setTimeout(cargar, 3500);
    } catch(err){
      if(err.message === 'sesion') return;
      msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo guardar, intenta de nuevo.');
      b.disabled = false;
    }
  }

  async function post(cuerpo){
    return o.api('/api/dashboard-eventos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  }

  async function clic(ev){
    const b = ev.target.closest('[data-cal]');
    if(!b) return;
    const accion = b.dataset.cal;
    const e = o.esc;
    if(accion === 'cerrar'){ panel.hidden = true; return; }
    if(accion === 'mes'){ mes = moverMes(mes, Number(b.dataset.n)); diaSel = null; cargar(); return; }
    if(accion === 'dia'){ diaSel = diaSel === b.dataset.f ? null : b.dataset.f; pintar(); return; }
    if(accion === 'todo'){ diaSel = null; pintar(); return; }
    if(accion === 'nuevo'){ formularioNuevo(); return; }
    if(accion === 'otro-producto'){ panel.querySelector('#calProds').insertAdjacentHTML('beforeend', filaProducto()); return; }
    if(accion === 'capturar'){ capturar(b); return; }
    const tarjeta = b.closest('.cal-ev');
    const zona = tarjeta && tarjeta.querySelector('.cal-zona');
    const evento = tarjeta && datos.eventos.find(x => x.id === tarjeta.dataset.ev);
    if(accion === 'editar'){
      zona.innerHTML = `<div class="cal-form">
        <label class="cal-sub">Fecha <input type="date" class="cal-fecha" min="${hoy()}" value="${e(evento.fecha)}"></label>
        <label class="cal-sub">Hora de inicio <input type="time" class="cal-hora" value="${e(evento.hora)}"></label>
        <label class="cal-sub">Horas de servicio <input type="number" class="cal-horas" min="1" max="12" step="0.5" value="${e(evento.horasServicio || '')}"></label>
        <button data-cal="guardar">Guardar y avisar al equipo</button><div class="cal-msg"></div></div>`;
      return;
    }
    if(accion === 'pre-cancelar'){
      zona.innerHTML = `<div class="cal-form"><input class="cal-motivo" maxlength="300" placeholder="Motivo de la cancelación">
        <button class="peligro" data-cal="cancelar">Sí, cancelar ${e(evento.folio)} y avisar al equipo</button><div class="cal-msg"></div></div>`;
      return;
    }
    const msg = accion === 'sincronizar' ? panel.querySelector('#calSyncMsg') : ((zona || panel).querySelector('.cal-msg') || panel.querySelector('#calBloqMsg'));
    b.disabled = true;
    if(msg) msg.textContent = 'Guardando…';
    try {
      let d;
      if(accion === 'guardar'){
        d = await post({ accion: 'calendario_mover', eventoId: evento.id, fecha: zona.querySelector('.cal-fecha').value, hora: zona.querySelector('.cal-hora').value, horasServicio: zona.querySelector('.cal-horas').value });
      } else if(accion === 'cancelar'){
        d = await post({ accion: 'calendario_cancelar', eventoId: evento.id, motivo: zona.querySelector('.cal-motivo').value });
      } else if(accion === 'bloquear'){
        d = await post({ accion: 'bloquear_dia', fecha: panel.querySelector('#calBloqFecha').value, negocio: panel.querySelector('#calBloqNeg').value, motivo: panel.querySelector('#calBloqMotivo').value });
      } else if(accion === 'desbloquear'){
        d = await post({ accion: 'desbloquear_dia', bloqueoId: b.dataset.id });
      } else if(accion === 'sincronizar'){
        d = await post({ accion: 'calendario_sincronizar' });
        msg.innerHTML = `📆 Pasados a Google: ${d.pasados}.${d.faltan ? ` Faltan ${d.faltan}: toca otra vez.` : ' Ya están todos.'}${(d.errores || []).length ? '<br>⚠️ ' + d.errores.map(e).join('<br>⚠️ ') : ''}`;
        b.disabled = false;
        return;
      } else { b.disabled = false; return; }
      if(msg) msg.innerHTML = resultado(d);
      // Se recarga para ver el cambio; si Google falló, el aviso se queda a la vista un momento más.
      setTimeout(cargar, d.google && !d.google.ok ? 6000 : 2500);
    } catch(err){
      if(err.message === 'sesion') return;
      if(msg) msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo guardar, intenta de nuevo.');
      b.disabled = false;
    }
  }

  function abrir(opciones){
    o = opciones;
    crearPanel();
    mes = mes || hoy().slice(0, 7);
    panel.hidden = false;
    cargar();
  }

  function cerrar(){ if(panel) panel.hidden = true; }

  return { abrir, cerrar };
})();
