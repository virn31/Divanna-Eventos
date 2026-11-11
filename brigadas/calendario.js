// brigadas/calendario.js
// Calendario del equipo (lo usan la app y el dashboard). Todos ven todos los
// eventos autorizados del mes y los días bloqueados, sin montos. Diana, Víctor
// y los gerentes (cada uno su negocio) pueden mover fecha/hora, cambiar horas
// de servicio, cancelar y bloquear días; el líder de brigada, en los eventos de
// su brigada. En la app, los eventos de cada quien traen "📋 Abrir ficha completa"
// (la misma ficha de su pantalla principal); los demás solo se ven. Los cambios avisan al equipo y se
// reflejan en Google Calendar (api/_calendario.js).
// Uso: DimaCalendario.abrir({ api, esc, abrirFicha }) — api(url, opciones) es el fetch con
// sesión de cada página (lanza Error con el mensaje del servidor); abrirFicha(id), opcional,
// abre la ficha completa del evento en la página.
// 🚚 Logística (segunda pestaña, api/_logistica.js): entregas y recolecciones de Divanna y
// los servicios de El Vaso Maíz por día y por vehículo. Todos la ven; editan Diana y Víctor
// (todo), Ángela (El Vaso Maíz) y Eden (Divanna). Casa Isabella no entra (lugar fijo).
window.DimaCalendario = (function(){
  const COLOR = { 'Divanna Eventos': '#3987e5', 'El Vaso Maiz': '#d95926' };
  const NOMBRE = { 'Divanna Eventos': 'Divanna', 'El Vaso Maiz': 'El Vaso Maíz', 'Ambos': 'los dos negocios' };
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  let o = null, mes = null, datos = null, diaSel = null, panel = null;
  // Pestaña activa y estado de Logística.
  let vista = 'mes', logDesde = null, logDias = 1, logFiltro = null, logAgrupar = 'hora', logDatos = null;

  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
  const textoDia = (f) => { const d = new Date(`${f}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; };
  const textoMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  // WhatsApp del cliente desde el WhatsApp de quien lo toca (enlace wa.me; el sistema no manda nada).
  const linkWhats = (tel) => { const d = String(tel || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? '52' + d : d}` : ''; };
  const moverMes = (m, n) => { let [a, b] = m.split('-').map(Number); b += n; if(b > 12){ b = 1; a++; } if(b < 1){ b = 12; a--; } return `${a}-${String(b).padStart(2, '0')}`; };

  function estilos(){
    if(document.getElementById('calEstilos')) return;
    const s = document.createElement('style');
    s.id = 'calEstilos';
    s.textContent = `
      .cal-panel{position:fixed; inset:0; z-index:70; overflow-y:auto; background:var(--ink-2); color:var(--paper); padding:16px 16px 40px; font-size:1rem;}
      .cal-panel[hidden]{display:none;}
      .cal-panel [data-buscar-producto].sin-resultado{border-color:#e05555;}
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
      .cal-dia.lleno{border-color:#e6a23c !important;}
      .cal-lleno-tag{display:inline-block; font-size:0.62rem; font-weight:800; letter-spacing:.02em; color:#1a1208; background:#e6a23c; border-radius:6px; padding:1px 4px; margin-left:2px;}
      .cal-lleno{margin-top:10px; padding:10px 12px; border-radius:12px; border:1px solid #e6a23c; color:var(--paper);}
      .cal-bloq{margin-top:10px; padding:10px 12px; border-radius:12px; border:1px dashed #e66767; display:flex; justify-content:space-between; gap:8px; align-items:center;}
      .cal-tabs{display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:12px; padding:4px; border-radius:14px; background:var(--ink); border:1px solid var(--line);}
      .cal-tabs button{border:none; border-radius:10px; padding:10px 8px; min-height:44px; font:inherit; font-weight:700; cursor:pointer; background:none; color:var(--muted);}
      .cal-tabs button.on{background:var(--maiz); color:var(--ink);}
      .log-chips{display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; align-items:center;}
      .log-chips button, .log-chips input{border:1.5px solid var(--line); border-radius:999px; padding:0 14px; height:40px; min-height:40px; box-sizing:border-box; width:auto; font:inherit; font-size:0.9rem; font-weight:700; cursor:pointer; background:var(--ink); color:var(--paper);}
      .log-chips button.on{border-color:var(--maiz); background:var(--maiz); color:var(--ink);}
      .log-res{margin-top:10px; font-size:0.9rem; color:var(--muted);}
      .log-dia{margin-top:18px; font-weight:800; font-size:1.05rem;}
      .log-grupo{margin-top:12px; font-weight:700; font-size:0.92rem; color:var(--muted);}
      .log-mov{margin-top:10px; padding:12px 14px; border-radius:12px; background:var(--ink); border:1px solid var(--line); border-left:5px solid var(--c); display:grid; grid-template-columns:auto 1fr; gap:4px 12px;}
      .log-mov.hecho{opacity:0.6;}
      .log-cuerpo{display:grid; gap:4px; min-width:0;}
      .log-hora{font-weight:800; font-size:1.2rem; min-width:56px; line-height:1.2;}
      .log-hora small{display:block; font-size:0.72rem; font-weight:600; color:var(--muted);}
      .log-tipo{font-size:0.75rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase;}
      .log-mov small{color:var(--muted); font-size:0.85rem;}
      .log-mov a{color:inherit;}
      .log-avisos{display:flex; flex-wrap:wrap; gap:4px;}
      .log-avisos span{font-size:0.75rem; font-weight:700; border-radius:6px; padding:2px 6px; background:rgba(230,162,60,0.18); color:#e6a23c;}
      .log-mov .cal-acc, .log-mov .cal-zona{grid-column:1 / -1;}
      .log-mov .cal-form label{display:grid; gap:4px;}
      .log-mov textarea{padding:10px 12px; border-radius:10px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit; min-height:70px;}
    `;
    document.head.appendChild(s);
  }

  function crearPanel(){
    if(panel) return;
    estilos();
    panel = document.createElement('div');
    panel.className = 'cal-panel';
    panel.hidden = true;
    panel.innerHTML = '<div class="cal-cont"><div class="cal-top"><span>📅 Calendario del equipo</span><button data-cal="cerrar">✕ Cerrar</button></div>'
      + '<div class="cal-tabs" role="tablist"><button data-cal="tab" data-t="mes" class="on" role="tab">📅 Calendario</button><button data-cal="tab" data-t="log" role="tab">🚚 Logística</button></div>'
      + '<div id="calCuerpo"></div><div id="logCuerpo" hidden></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', clic);
    panel.addEventListener('change', (ev) => {
      if(ev.target.id === 'logFecha' && ev.target.value){ logDesde = ev.target.value; logDias = 1; cargarLog(); }
    });
  }

  function mostrarVista(){
    panel.querySelectorAll('.cal-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === vista));
    panel.querySelector('#calCuerpo').hidden = vista !== 'mes';
    panel.querySelector('#logCuerpo').hidden = vista !== 'log';
    if(vista === 'log') cargarLog(); else cargar();
  }

  // ---------- 🚚 Logística ----------
  const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const linkMapa = (lugar) => lugar ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lugar)}` : '';
  const TIPO = {
    entrega: { 'Divanna Eventos': '🚚 Entrega y montaje', 'El Vaso Maiz': '🌽 Servicio en el lugar' },
    recoleccion: { 'Divanna Eventos': '📦 Recolección', 'El Vaso Maiz': '📦 Recolección' },
  };

  async function cargarLog(){
    const cuerpo = panel.querySelector('#logCuerpo');
    logDesde = logDesde || hoy();
    cuerpo.innerHTML = '<div class="esqueleto"><div class="hueso"></div><div class="hueso"></div><div class="hueso chico"></div></div>';
    try {
      logDatos = await o.api(`/api/brigada-eventos?vista=logistica&desde=${logDesde}&dias=${logDias}`);
      // Cada quien abre con lo suyo (Ángela El Vaso Maíz, Eden Divanna); se puede cambiar.
      if(logFiltro === null) logFiltro = logDatos.negocioPropio || 'todos';
      pintarLog();
    } catch(e){
      if(e.message === 'sesion') return;
      cuerpo.innerHTML = `<div class="cal-msg">⚠️ No se pudo cargar la logística (${o.esc(e.message && e.message !== 'fail' ? e.message : 'sin conexión')}). Revisa tu señal e intenta de nuevo.</div>`;
    }
  }

  function tarjetaMov(m){
    const e = o.esc;
    const tipo = (TIPO[m.tipo] || {})[m.negocio] || m.tipo;
    const mapa = linkMapa(m.ubicacion);
    const tel = String(m.clienteTelefono || '').replace(/[^\d+]/g, '');
    return `
      <div class="log-mov ${m.hecho ? 'hecho' : ''}" style="--c:${COLOR[m.negocio] || '#888'};" data-mov="${e(m.eventoId)}" data-tipo="${e(m.tipo)}">
        <div class="log-hora">${m.hora ? e(m.hora) : '—'}${m.sugerida && m.hora ? '<small>sugerida</small>' : ''}</div>
        <div class="log-cuerpo">
        <div><span class="log-tipo" style="color:${COLOR[m.negocio] || 'inherit'};">${e(tipo)}</span>${m.hecho ? ' · ✅ hecho' : ''}</div>
        <div><b>${e(m.folio)}</b> · ${e(NOMBRE[m.negocio] || m.negocio)}${m.horaEvento ? ` · <small>evento ${e(m.horaEvento)}</small>` : ''}${m.invitados ? ` · <small>👥 ${e(m.invitados)}</small>` : ''}</div>
        <div><small>📍 ${mapa ? `<a href="${e(mapa)}" target="_blank" rel="noopener">${e(m.ubicacion)}</a>` : 'ubicación por confirmar'}</small></div>
        <div><small>🚗 ${m.vehiculo ? `<b>${e(m.vehiculo)}</b> · ${e(m.brigada)}` : (m.brigada ? e(m.brigada) : 'sin vehículo')}${m.estatus ? ` · ${e(m.estatus)}` : ''}</small></div>
        ${m.clienteNombre || tel ? `<div><small>👤 ${e(m.clienteNombre || 'Cliente')}${tel ? ` · 📞 <a href="tel:${e(tel)}">${e(m.clienteTelefono)}</a>` : ''}</small></div>` : ''}
        ${m.notas ? `<div><small>📝 ${e(m.notas)}</small></div>` : ''}
        ${(m.avisos || []).length ? `<div class="log-avisos">${m.avisos.map(a => `<span>⚠️ ${e(a)}</span>`).join('')}</div>` : ''}
        </div>
        ${m.editable || (m.propio && o.abrirFicha) ? `<div class="cal-acc">${m.editable ? `<button data-cal="log-editar">✏️ Editar logística</button>` : ''}${m.propio && o.abrirFicha ? `<button class="sec" data-cal="log-ficha">📋 Ficha</button>` : ''}</div>` : ''}
        <div class="cal-zona"></div>
      </div>`;
  }

  function pintarLog(){
    const e = o.esc, d = logDatos;
    const manana = sumarDias(d.hoy, 1);
    const movs = d.movimientos.filter(m => logFiltro === 'todos' || m.negocio === logFiltro);
    const pendientes = movs.filter(m => (m.avisos || []).length).length;
    const entregas = movs.filter(m => m.tipo === 'entrega').length;
    const porDia = {};
    movs.forEach(m => { (porDia[m.fecha] = porDia[m.fecha] || []).push(m); });
    let lista = '';
    Object.keys(porDia).sort().forEach(f => {
      if(logDias > 1) lista += `<div class="log-dia">${e(mayuscula(textoDia(f)))}${f === d.hoy ? ' · hoy' : ''}</div>`;
      if(logAgrupar === 'vehiculo'){
        const grupos = {};
        porDia[f].forEach(m => { const k = m.vehiculo || m.brigada || 'Sin vehículo'; (grupos[k] = grupos[k] || []).push(m); });
        Object.keys(grupos).sort((a, b) => (a === 'Sin vehículo') - (b === 'Sin vehículo') || a.localeCompare(b))
          .forEach(k => { lista += `<div class="log-grupo">🚗 ${e(k)} (${grupos[k].length})</div>${grupos[k].map(tarjetaMov).join('')}`; });
      } else lista += porDia[f].map(tarjetaMov).join('');
    });
    const chip = (accion, valor, texto, on) => `<button data-cal="${accion}" data-v="${e(valor)}" class="${on ? 'on' : ''}">${texto}</button>`;
    const esHoy = logDias === 1 && logDesde === d.hoy, esManana = logDias === 1 && logDesde === manana, esSemana = logDias === 7 && logDesde === d.hoy;
    panel.querySelector('#logCuerpo').innerHTML = `
      <div class="log-chips">
        ${chip('log-rango', 'hoy', 'Hoy', esHoy)}${chip('log-rango', 'manana', 'Mañana', esManana)}${chip('log-rango', 'semana', '7 días', esSemana)}
        <input type="date" id="logFecha" aria-label="Elegir día" value="${!esHoy && !esManana && !esSemana ? e(logDesde) : ''}">
      </div>
      <div class="log-chips">
        ${chip('log-filtro', 'todos', 'Todos', logFiltro === 'todos')}${chip('log-filtro', 'Divanna Eventos', 'Divanna', logFiltro === 'Divanna Eventos')}${chip('log-filtro', 'El Vaso Maiz', 'El Vaso Maíz', logFiltro === 'El Vaso Maiz')}
        <span style="flex:1"></span>${chip('log-agrupar', 'hora', '🕒 Por hora', logAgrupar === 'hora')}${chip('log-agrupar', 'vehiculo', '🚗 Por vehículo', logAgrupar === 'vehiculo')}
      </div>
      <div class="log-res">${logDias === 1 ? `<b style="color:var(--paper);">${e(mayuscula(textoDia(logDesde)))}</b> · ` : ''}${plural(movs.length, 'movimiento', 'movimientos')} · ${plural(entregas, 'salida', 'salidas')} · ${plural(movs.length - entregas, 'recolección', 'recolecciones')}${pendientes ? ` · <span style="color:#e6a23c;">⚠️ ${pendientes} por revisar</span>` : ''}</div>
      ${lista || `<div class="cal-sub" style="margin-top:14px;">No hay entregas ni recolecciones ${logDias === 1 ? 'este día' : 'en estos días'}${logFiltro !== 'todos' ? ' de ' + e(NOMBRE[logFiltro]) : ''}.</div>`}
      <div class="cal-sub" style="margin-top:16px;">${d.puedeEditar ? 'Las horas "sugeridas" salen de la hora del evento; confírmalas con ✏️. ' : ''}Casa Isabella no aparece aquí: es un lugar fijo.</div>`;
  }

  function formLog(zona, m){
    const e = o.esc, d = logDatos;
    const conRecoleccion = m.negocio === 'Divanna Eventos' || m.recoleccionFecha;
    zona.innerHTML = `<div class="cal-form">
      <label class="cal-sub">${m.negocio === 'El Vaso Maiz' ? 'Hora de llegada del staff' : 'Hora de llegada a entregar'}${m.horaEvento ? ` (el evento empieza ${e(m.horaEvento)})` : ''} <input type="time" class="log-entrega" value="${e(m.entregaHora)}"></label>
      <label class="cal-sub">Vehículo <select class="log-vehiculo"><option value="">Sin vehículo</option>${d.vehiculos.map(v => `<option value="${e(v.id)}" ${v.id === m.brigadaId ? 'selected' : ''}>${e(v.vehiculo || 'Sin vehículo')} · ${e(v.nombre)}</option>`).join('')}</select></label>
      ${conRecoleccion ? `
      <label class="cal-sub">Día de recolección <input type="date" class="log-rec-fecha" min="${e(m.fechaEvento)}" value="${e(m.recoleccionFecha)}"></label>
      <label class="cal-sub">Hora de recolección <input type="time" class="log-rec-hora" value="${e(m.recoleccionHora)}"></label>` : ''}
      <label class="cal-sub">Notas para el traslado <textarea class="log-notas" maxlength="1500" placeholder="Acceso, quién recibe, referencias, qué llevar">${e(m.notas)}</textarea></label>
      <button data-cal="log-guardar">Guardar y avisar al equipo</button><div class="cal-msg"></div></div>`;
  }

  async function clicLog(b, accion){
    const e = o.esc;
    if(accion === 'log-rango'){ const v = b.dataset.v; logDesde = v === 'manana' ? sumarDias(logDatos.hoy, 1) : logDatos.hoy; logDias = v === 'semana' ? 7 : 1; cargarLog(); return; }
    if(accion === 'log-filtro'){ logFiltro = b.dataset.v; pintarLog(); return; }
    if(accion === 'log-agrupar'){ logAgrupar = b.dataset.v; pintarLog(); return; }
    const tarjeta = b.closest('.log-mov');
    const m = tarjeta && logDatos.movimientos.find(x => x.eventoId === tarjeta.dataset.mov && x.tipo === tarjeta.dataset.tipo);
    if(!m) return;
    const zona = tarjeta.querySelector('.cal-zona');
    if(accion === 'log-ficha'){ panel.hidden = true; o.abrirFicha(m.eventoId); return; }
    if(accion === 'log-editar'){ formLog(zona, m); return; }
    if(accion === 'log-guardar'){
      const msg = zona.querySelector('.cal-msg');
      const cuerpo = { accion: 'logistica_guardar', eventoId: m.eventoId,
        entregaHora: zona.querySelector('.log-entrega').value, brigadaId: zona.querySelector('.log-vehiculo').value, notas: zona.querySelector('.log-notas').value };
      if(zona.querySelector('.log-rec-fecha')){ cuerpo.recoleccionFecha = zona.querySelector('.log-rec-fecha').value; cuerpo.recoleccionHora = zona.querySelector('.log-rec-hora').value; }
      b.disabled = true;
      msg.textContent = 'Guardando…';
      try {
        const d = await post(cuerpo);
        msg.innerHTML = `✅ Guardado.${d.avisados ? ` Avisé a ${d.avisados} del equipo (Telegram ${d.porTelegram || 0}, push ${d.porPush || 0}).` : ''}${d.google && !d.google.ok ? `<br>⚠️ ${e(d.google.error || 'Google no se actualizó.')}` : ''}`;
        setTimeout(cargarLog, d.google && !d.google.ok ? 6000 : 2000);
      } catch(err){
        if(err.message === 'sesion') return;
        msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo guardar, intenta de nuevo.');
        b.disabled = false;
      }
    }
  }

  async function cargar(){
    const cuerpo = panel.querySelector('#calCuerpo');
    cuerpo.innerHTML = '<div class="esqueleto"><div class="hueso"></div><div class="hueso"></div><div class="hueso chico"></div></div>';
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
        ${ev.clienteNombre || ev.clienteTelefono ? `<small>👤 ${e(ev.clienteNombre || 'Cliente sin nombre')}${ev.clienteTelefono ? ` · 📞 <a href="tel:${e(String(ev.clienteTelefono).replace(/[^\d+]/g, ''))}" style="color:inherit;">${e(ev.clienteTelefono)}</a> · 💬 <a href="${e(linkWhats(ev.clienteTelefono))}" target="_blank" rel="noopener" style="color:inherit;">WhatsApp</a>` : ''}</small><br>` : ''}
        <small>📍 ${e(ev.ubicacion || 'ubicación por confirmar')}${ev.invitados ? ` · 👥 ${e(ev.invitados)}` : ''}</small><br>
        <small>👷 ${e(ev.brigada || 'sin brigada')}${ev.estatus ? ` · ${e(ev.estatus)}` : ''}${ev.enGoogle ? ' · 📆 en Google' : ''}</small>
        ${ev.propio && o.abrirFicha ? `<div class="cal-acc"><button data-cal="ficha" data-id="${e(ev.id)}">📋 Abrir ficha completa</button></div>` : ''}
        ${ev.editable ? `<div class="cal-acc"><button ${ev.propio && o.abrirFicha ? 'class="sec" ' : ''}data-cal="editar" data-id="${e(ev.id)}">✏️ Cambiar fecha u hora</button>${datos.puedeCobrar ? `<button data-cal="pre-pago" data-id="${e(ev.id)}">💵 Registrar pago</button>` : ''}<button class="sec" data-cal="recibo" data-id="${e(ev.id)}">🧾 Mandar recibo</button><button class="sec" data-cal="pre-cancelar" data-id="${e(ev.id)}">❌ Cancelar evento</button></div>` : ''}
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
    const llenoDia = {};
    (datos.llenos || []).forEach(l => { llenoDia[l.fecha] = l; });
    let celdas = '';
    for(let i = 0; i < desplazo; i++) celdas += '<div class="cal-dia vacio"></div>';
    for(let d = 1; d <= diasMes; d++){
      const f = `${mes}-${String(d).padStart(2, '0')}`;
      const evs = porDia[f] || [];
      celdas += `<button class="cal-dia ${f === hoy() ? 'hoy' : ''} ${f === diaSel ? 'sel' : ''} ${bloqDia[f] ? 'bloq' : ''} ${llenoDia[f] ? 'lleno' : ''}" data-cal="dia" data-f="${f}" aria-label="${e(textoDia(f))}: ${evs.length} eventos${bloqDia[f] ? ', bloqueado' : ''}${llenoDia[f] ? ', lleno' : ''}">
        <span class="cal-num">${d}</span>${bloqDia[f] ? ' ⛔' : ''}${llenoDia[f] ? '<span class="cal-lleno-tag">LLENO</span>' : ''}
        <span class="cal-pts">${evs.slice(0, 6).map(ev => `<i style="background:${COLOR[ev.negocio] || '#888'};"></i>`).join('')}</span></button>`;
    }
    const lista = diaSel ? (porDia[diaSel] || []) : datos.eventos;
    const bloqueos = diaSel ? (bloqDia[diaSel] || []) : datos.bloqueos;
    const negociosBloqueo = datos.negociosBloqueo || (datos.soloVasoMaiz ? ['El Vaso Maiz'] : ['Ambos', 'Divanna Eventos', 'El Vaso Maiz']);
    panel.querySelector('#calCuerpo').innerHTML = `
      ${datos.puedeEditar ? `<div class="cal-form" style="margin-top:12px;"><button data-cal="nuevo">➕ Capturar evento</button></div><div id="calNuevo"></div>` : ''}
      <div class="cal-nav"><button data-cal="mes" data-n="-1">‹</button><span>${e(textoMes(mes))}</span><button data-cal="mes" data-n="1">›</button></div>
      <div class="cal-ley"><span><i style="background:${COLOR['Divanna Eventos']};"></i>Divanna</span><span><i style="background:${COLOR['El Vaso Maiz']};"></i>El Vaso Maíz</span><span>⛔ día bloqueado</span><span><b style="color:#e6a23c;">LLENO</b> sin cupo</span></div>
      ${datos.llenosError ? '<div class="cal-sub">⚠️ No se pudo revisar qué días están llenos; intenta en un momento.</div>' : ''}
      <div class="cal-grid">${['L','M','M','J','V','S','D'].map(x => `<div class="cal-dsem">${x}</div>`).join('')}${celdas}</div>
      <div class="cal-sec">${diaSel ? `${e(textoDia(diaSel))} <button class="sec" data-cal="todo" style="border:none; background:none; color:var(--muted); font:inherit; cursor:pointer;">(ver todo el mes)</button>` : `Eventos de ${e(textoMes(mes))} (${datos.eventos.length})`}</div>
      ${(diaSel ? (llenoDia[diaSel] ? [llenoDia[diaSel]] : []) : (datos.llenos || [])).map(l => `<div class="cal-lleno">📅 <b>${e(textoDia(l.fecha))}: lleno</b> · ${e(l.detalle)}<br><span class="cal-sub">DiMa ya no ofrece este día${datos.puedeEditar ? '; si aun así quieren otro evento, captúralo a mano con ➕' : ''}.</span></div>`).join('')}
      ${bloqueos.map(b => `<div class="cal-bloq"><span>⛔ ${e(textoDia(b.fecha))} · ${e(NOMBRE[b.negocio] || b.negocio)} · ${e(b.motivo)}</span>${b.editable ? `<button class="sec" data-cal="desbloquear" data-id="${e(b.id)}" style="border:none; border-radius:10px; padding:8px 12px; background:var(--line); color:var(--paper); font:inherit; cursor:pointer;">Quitar</button>` : ''}</div>`).join('')}
      ${lista.length ? lista.map(tarjetaEvento).join('') : `<div class="cal-sub" style="margin-top:8px;">${diaSel ? 'No hay eventos este día.' : 'No hay eventos autorizados este mes.'}</div>`}
      ${datos.puedeEditar && !datos.soloVasoMaiz ? `
        <div class="cal-sec">📆 Google Calendar</div>
        <div class="cal-sub">Los eventos que se autorizaron antes de conectar Google no están en Calendar ni en las hojas de pedidos (Sheets). Este botón los pasa (de hoy en adelante, 20 por vez).</div>
        <div class="cal-form"><button class="sec" data-cal="sincronizar">🔄 Pasar los eventos a Google</button><div class="cal-msg" id="calSyncMsg"></div></div>` : ''}
      ${(datos.puedeEditar || datos.modifica) && negociosBloqueo.length ? `
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

  function lleno(d){
    return d.diaLleno && d.diaLleno.lleno ? ` 📅 Ese día quedó LLENO (${o.esc(d.diaLleno.detalle || '')}); ya se avisó.` : '';
  }
  function resultado(d){
    const e = o.esc;
    const g = d.google;
    const google = !g ? '' : g.ok ? ' 📆 Google actualizado.' : ` ⚠️ ${e(g.error || 'Google no se actualizó')}`;
    const avisos = d.avisados != null ? ` Avisos al equipo: ${d.avisados} (Telegram ${d.porTelegram || 0}, app ${d.porPush || 0}).` : '';
    return `✅ Listo.${avisos}${google}${lleno(d)}`;
  }

  // ---------- ➕ Capturar evento (los que se apartaron fuera del chat) ----------
  // Entra ya autorizado; el anticipo queda como pago a Diana (cuadre).
  const esMantel = (clave) => !!(window.DimaManteles && DimaManteles.esMantel(datos.manteles, clave));
  function filaProducto(){
    const e = o.esc;
    return `<div class="cal-prod" style="display:flex; flex-wrap:wrap; gap:6px;"><input type="search" data-buscar-producto placeholder="🔎 Buscar producto (ej. mesita)" style="flex-basis:100%;"><select class="calProdClave" style="flex:1;"><option value="">— producto —</option>${(datos.catalogo || datos.catalogoGerente || datos.catalogoVM || []).filter(p => !esMantel(p.clave)).map(p => `<option value="${e(p.clave)}">${e(p.nombre)}</option>`).join('')}</select><input class="calProdCant" type="number" min="1" placeholder="Cant." style="width:80px;"><input class="calProdNota" maxlength="150" placeholder="Nota: color, variante…" style="flex-basis:100%;"></div>`;
  }
  // Productos escritos en el formulario (sin manteles).
  const filasProductos = () => [...panel.querySelectorAll('.cal-prod')]
    .map(f => ({ clave: f.querySelector('.calProdClave').value, cantidad: Number(f.querySelector('.calProdCant').value), nota: f.querySelector('.calProdNota').value.trim() || null }))
    .filter(p => p.clave && p.cantidad > 0);
  // 🧺 Selector de manteles (brigadas/manteles.js) y el total con lo que suman.
  function pintarManteles(productos){
    const caja = panel.querySelector('#calManteles');
    if(!caja) return;
    caja.innerHTML = datos.manteles && window.DimaManteles ? DimaManteles.html(productos || [], datos.manteles, o.esc) : '';
    if(window.DimaManteles) DimaManteles.conectar(caja.querySelector('.dm-manteles'), o.esc, resumirManteles);
    resumirManteles();
  }
  function resumirManteles(){
    const caja = panel.querySelector('#calNuevo');
    const neg = panel.querySelector('#calNNeg');
    const mant = panel.querySelector('#calManteles');
    if(!caja || !mant || !datos.manteles || !window.DimaManteles) return { error: '', cargo: 0 };
    mant.hidden = neg && neg.value === 'El Vaso Maiz';
    if(mant.hidden) return { error: '', cargo: 0 };
    const r = DimaManteles.resumir(caja, filasProductos(), datos.manteles);
    return r;
  }

  function formularioNuevo(){
    const e = o.esc;
    const caja = panel.querySelector('#calNuevo');
    if(caja.innerHTML){ caja.innerHTML = ''; return; }
    const negocios = datos.negociosGerente || (datos.soloVasoMaiz ? ['El Vaso Maiz'] : ['Divanna Eventos', 'El Vaso Maiz']);
    caja.innerHTML = `
      <div class="cal-ev" style="--c:var(--maiz);">
        <b>➕ Capturar evento</b>
        <div class="cal-sub">Para los eventos que ya se apartaron por teléfono o en persona. Entra ya autorizado y avisa al calendario de Google.</div>
        <div class="cal-form">
          <button class="sec" data-cal="leer-foto">📷 Llenar con la foto de una comanda</button>
          <button class="sec" data-cal="mostrar-texto">📝 Llenar con el pedido escrito</button>
          <div id="calNTextoCaja" hidden><textarea id="calNTexto" rows="4" maxlength="4000" placeholder="Pega o escribe el pedido: cliente, teléfono, fecha, hora, lugar, qué lleva (con colores y estilos), total y anticipo" style="width:100%; padding:10px 12px; border-radius:10px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit;"></textarea><button data-cal="leer-texto" style="margin-top:6px;">Leer pedido</button></div>
          <input type="file" id="calNFoto" accept="image/*" hidden>
          <div class="cal-msg" id="calNFotoMsg"></div>
          <input id="calNNombre" maxlength="80" placeholder="Nombre del cliente">
          <input id="calNTel" inputmode="tel" maxlength="15" placeholder="Teléfono del cliente (10 dígitos)">
          <select id="calNNeg">${negocios.map(n => `<option value="${e(n)}">${e(NOMBRE[n])}</option>`).join('')}</select>
          <label class="cal-sub">Fecha <input type="date" id="calNFecha" value="${diaSel || ''}"></label>
          ${diaSel && (datos.llenos || []).some(l => l.fecha === diaSel) ? `<div class="cal-lleno">⚠️ Este día ya está lleno (${e(datos.llenos.find(l => l.fecha === diaSel).detalle)}). Puedes capturarlo de todos modos; revisa que tengan equipo.</div>` : ''}
          <label class="cal-sub">Hora de inicio <input type="time" id="calNHora"></label>
          <label class="cal-sub">Horas de servicio <input type="number" id="calNHoras" min="1" max="12" step="0.5" placeholder="Ej. 2"></label>
          <input id="calNLugar" maxlength="200" placeholder="Lugar (colonia, salón o dirección)">
          <input id="calNInv" type="number" min="1" placeholder="Invitados">
          <textarea id="calNServ" rows="4" maxlength="4000" placeholder="Qué lleva, uno por línea (sale como checklist de carga)" style="padding:10px 12px; border-radius:10px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit;"></textarea>
          <div id="calProdsCaja"><div class="cal-sub">${datos.catalogo ? 'Productos del catálogo (con esto salen la producción, el personal y el inventario)' : 'El Vaso Maíz: paquetes y piezas (con esto sale la producción y el personal)'}</div><div id="calProds">${filaProducto()}</div><button class="sec" data-cal="otro-producto">+ Otro producto</button></div>
          <div id="calManteles"></div>
          <input id="calNMonto" inputmode="decimal" placeholder="Monto contratado (los manteles especiales y extra se suman solos)">
          <div style="display:flex; gap:6px;"><input id="calNAnt" inputmode="decimal" placeholder="Anticipo ya recibido (si hubo)" style="flex:1;"><select id="calNAntForma"><option>Efectivo</option><option>Transferencia</option><option>Depósito</option></select></div>
          <input id="calNInstr" maxlength="2000" placeholder="Instrucciones para el equipo (opcional)">
          <button data-cal="capturar">Guardar evento</button>
          <div class="cal-msg" id="calNMsg"></div>
        </div>
      </div>`;
    const negSel = caja.querySelector('#calNNeg');
    const prods = caja.querySelector('#calProdsCaja');
    const ver = () => { prods.hidden = !datos.catalogo && negSel.value !== 'El Vaso Maiz'; };
    negSel.addEventListener('change', ver); ver();
    caja.querySelector('#calNFoto').addEventListener('change', (ev) => leerFoto(ev.target.files[0]));
    pintarManteles([]);
    caja.addEventListener('input', resumirManteles);
    caja.addEventListener('change', resumirManteles);
  }

  // 📷 Foto de la comanda: se achica en el teléfono (máx. 1600 px, JPG), DiMa la lee y llena el formulario.
  // En Android a veces no se puede abrir la foto (fotos enormes de la cámara, poca memoria,
  // formatos raros), por eso hay tres caminos: createImageBitmap → <img> → la foto tal cual.
  let fotoComanda = null;
  const MAX_LADO = 1600, MAX_ENVIO = 3 * 1024 * 1024; // Vercel acepta hasta 4.5 MB por petición
  function aJpeg(fuente, ancho, alto){
    const escala = Math.min(1, MAX_LADO / Math.max(ancho, alto));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(ancho * escala)); lienzo.height = Math.max(1, Math.round(alto * escala));
    lienzo.getContext('2d').drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    for(const calidad of [0.85, 0.7, 0.55]){
      const base64 = lienzo.toDataURL('image/jpeg', calidad).split(',')[1] || '';
      if(base64.length > 1000 && base64.length * 0.75 <= MAX_ENVIO) return { base64, tipo: 'image/jpeg', nombre: 'comanda.jpg' };
    }
    throw new Error('el lienzo salió vacío');
  }
  async function conBitmap(archivo){
    if(!window.createImageBitmap) throw new Error('sin createImageBitmap');
    const bm = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    try { return aJpeg(bm, bm.width, bm.height); } finally { if(bm.close) bm.close(); }
  }
  function conImagen(archivo){
    return new Promise((ok, mal) => {
      const img = new Image();
      const url = URL.createObjectURL(archivo);
      img.onload = () => { try { ok(aJpeg(img, img.naturalWidth, img.naturalHeight)); } catch(err){ mal(err); } finally { URL.revokeObjectURL(url); } };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('el navegador no pudo abrirla')); };
      img.src = url;
    });
  }
  function talCual(archivo){
    return new Promise((ok, mal) => {
      if(!/^image\/(jpeg|png|webp)$/.test(archivo.type) || archivo.size > MAX_ENVIO) return mal(new Error('formato o tamaño no aceptado'));
      const lector = new FileReader();
      lector.onload = () => ok({ base64: String(lector.result).split(',')[1] || '', tipo: archivo.type, nombre: archivo.name || 'comanda.jpg' });
      lector.onerror = () => mal(new Error('no se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
  }
  async function achicar(archivo){
    if(!archivo.size) throw new Error('La foto llegó vacía. Vuelve a tomarla, o tómala con la cámara y elígela de la galería.');
    const fallas = [];
    for(const camino of [conBitmap, conImagen, talCual]){
      try { return await camino(archivo); } catch(err){ fallas.push(camino.name + ': ' + (err && err.message)); }
    }
    reportarFalla('abrir', fallas.join(' | '), archivo);
    if(/hei[cf]/i.test(archivo.type + archivo.name)) throw new Error('La foto está en formato HEIC y no la puedo abrir. Ponle a la cámara formato JPG, o mándala por Telegram como foto.');
    throw new Error('No pude abrir la foto en este teléfono. Toma una captura de pantalla de la foto y elige la captura, o mándala por Telegram.');
  }
  // Las fallas del teléfono se anotan en los registros del servidor para poder corregirlas.
  function reportarFalla(etapa, detalle, archivo){
    post({ accion: 'falla_foto', etapa, detalle: String(detalle).slice(0, 500),
      archivo: archivo ? { tipo: archivo.type, tamano: archivo.size } : null, navegador: navigator.userAgent.slice(0, 160) }).catch(() => {});
  }
  // Manda la foto; si se cae la señal o el servidor tarda, lo intenta una vez más.
  async function mandarFoto(foto, msg){
    for(let intento = 1; ; intento++){
      try {
        return await post({ accion: 'leer_comanda', imagen: foto }, { signal: AbortSignal.timeout ? AbortSignal.timeout(70000) : undefined });
      } catch(err){
        const red = err instanceof TypeError || (err && (err.name === 'TimeoutError' || err.name === 'AbortError' || err.status >= 500));
        if(!red || err.message === 'sesion') throw err;
        if(intento >= 2){
          reportarFalla('mandar', (err.name || '') + ' ' + (err.status || '') + ' ' + err.message);
          if(err.status >= 500 && err.message && err.message !== 'fail') throw err;
          throw new Error(err.name === 'TimeoutError' || err.name === 'AbortError'
            ? 'DiMa tardó demasiado en leer la foto. Intenta de nuevo en un minuto.'
            : 'Se cortó la conexión al mandar la foto. Revisa tu señal e intenta de nuevo.');
        }
        msg.textContent = '📶 No se pudo mandar la foto, lo intento otra vez…';
      }
    }
  }
  async function leerFoto(archivo){
    const e = o.esc;
    const msg = panel.querySelector('#calNFotoMsg');
    if(!archivo) return;
    msg.textContent = '📷 DiMa está leyendo la comanda… (unos segundos)';
    try {
      const foto = await achicar(archivo);
      const r = await mandarFoto(foto, msg);
      llenarConLectura(r);
      fotoComanda = foto;
    } catch(err){
      if(err.message === 'sesion') return;
      msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo leer la foto, intenta de nuevo.');
    }
  }

  // 📝 Pedido escrito (texto pegado o dictado): DiMa lo lee igual que una comanda.
  // ❓ Respuestas a las preguntas de DiMa: se mandan con lo ya leído y vuelve a llenar.
  async function leerTexto(boton, conRespuestas){
    const msg = panel.querySelector('#calNFotoMsg');
    const caja = panel.querySelector(conRespuestas ? '#calNResp' : '#calNTexto');
    const texto = caja ? caja.value.trim() : '';
    if(!texto){ msg.textContent = conRespuestas ? '⚠️ Escribe las respuestas.' : '⚠️ Escribe o pega el pedido.'; return; }
    boton.disabled = true;
    msg.textContent = conRespuestas ? '❓ DiMa está revisando tus respuestas…' : '📝 DiMa está leyendo el pedido… (unos segundos)';
    try {
      const r = await post(conRespuestas ? { accion: 'leer_comanda', previo: ultimaLectura, respuestas: texto } : { accion: 'leer_comanda', texto });
      llenarConLectura(r);
    } catch(err){
      if(err.message === 'sesion') return;
      msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo leer, intenta de nuevo.');
    } finally {
      boton.disabled = false;
    }
  }

  // Llena el formulario con lo que leyó DiMa y muestra sus preguntas.
  let ultimaLectura = null, preguntasPendientes = [];
  function llenarConLectura(r){
    const e = o.esc;
    const msg = panel.querySelector('#calNFotoMsg');
    {
      const d = r.datos;
      ultimaLectura = d;
      preguntasPendientes = d.preguntas || [];
      const poner = (id, valor) => { const el = panel.querySelector('#' + id); if(el && valor !== '' && valor != null) el.value = valor; };
      poner('calNNombre', d.clienteNombre); poner('calNTel', d.clienteTelefono); poner('calNFecha', d.fecha); poner('calNHora', d.hora);
      poner('calNHoras', d.horasServicio); poner('calNLugar', d.ubicacion); poner('calNInv', d.invitados); poner('calNServ', d.servicios);
      poner('calNMonto', d.montoContratado); poner('calNAnt', d.anticipo); poner('calNAntForma', d.formaAnticipo);
      const neg = panel.querySelector('#calNNeg');
      if([...neg.options].some(op => op.value === d.negocio)){ neg.value = d.negocio; neg.dispatchEvent(new Event('change')); }
      const lista = panel.querySelector('#calProds');
      const todos = (d.productos || []).filter(p => (datos.catalogo || datos.catalogoGerente || datos.catalogoVM || []).some(c => c.clave === p.clave));
      const validos = todos.filter(p => !esMantel(p.clave));
      if(validos.length){
        lista.innerHTML = validos.map(() => filaProducto()).join('');
        [...lista.querySelectorAll('.cal-prod')].forEach((fila, i) => { fila.querySelector('.calProdClave').value = validos[i].clave; fila.querySelector('.calProdCant').value = validos[i].cantidad; fila.querySelector('.calProdNota').value = validos[i].nota || ''; });
      }
      pintarManteles(todos);
      fotoNotas = d.notas || '';
      const avisos = [...(d.dudas || []), ...(r.faltan || []).filter(x => x !== 'contestar las preguntas').map(x => 'Falta: ' + x)];
      msg.innerHTML = (preguntasPendientes.length ? '❓ DiMa tiene preguntas; puedes contestarlas o guardar así (solo nombre, teléfono y fecha son obligatorios).' : '✅ Listo, revisa cada dato antes de guardar.')
        + `${d.notas ? '<br>📝 ' + e(d.notas) : ''}${avisos.length ? '<br>⚠️ ' + avisos.map(e).join('<br>⚠️ ') : ''}`
        + (preguntasPendientes.length ? `<div class="cal-lleno" style="margin-top:8px;"><b>❓ Preguntas de DiMa</b><br>${preguntasPendientes.map(p => '• ' + e(p)).join('<br>')}
          <textarea id="calNResp" rows="3" maxlength="1000" placeholder="Contesta aquí (ej. manteles lentejuela rosa, cerezos blancos)" style="width:100%; margin-top:6px; padding:8px; border-radius:8px; border:1.5px solid var(--line); background:var(--ink-2); color:var(--paper); font:inherit;"></textarea>
          <button data-cal="responder-dima" style="margin-top:6px;">Enviar respuestas</button></div>` : '');
    }
  }
  let fotoNotas = '';

  async function capturar(b){
    const e = o.esc;
    const v = (id) => panel.querySelector('#' + id).value;
    const msg = panel.querySelector('#calNMsg');
    const negocio = v('calNNeg');
    const mant = resumirManteles();
    if(mant.error){ msg.textContent = '⚠️ ' + mant.error; return; }
    const filas = !panel.querySelector('#calProdsCaja').hidden ? filasProductos() : [];
    const conManteles = negocio !== 'El Vaso Maiz' && datos.manteles && window.DimaManteles;
    const productos = conManteles ? DimaManteles.aplicar(panel.querySelector('#calNuevo'), filas, datos.manteles) : filas;
    b.disabled = true;
    msg.textContent = 'Guardando…';
    try {
      const d = await post({
        accion: 'capturar_evento', clienteNombre: v('calNNombre'), clienteTelefono: v('calNTel'), negocio,
        fecha: v('calNFecha'), hora: v('calNHora'), horasServicio: v('calNHoras'), ubicacion: v('calNLugar'), invitados: v('calNInv'),
        servicios: v('calNServ'), productos, montoContratado: v('calNMonto'), anticipo: v('calNAnt'), formaAnticipo: v('calNAntForma'), instrucciones: v('calNInstr'),
        ...(fotoComanda ? { fotoComanda, notas: [fotoNotas, 'Capturado desde foto de comanda.'].filter(Boolean).join(' ') } : {}),
      });
      fotoComanda = null; fotoNotas = ''; ultimaLectura = null; preguntasPendientes = [];
      const monto = d.total ? ` Total: $${Number(d.total).toLocaleString('es-MX')}${d.decorador ? ' (ya con 10% de decorador)' : ''}.` : '';
      msg.innerHTML = `✅ Evento ${e(d.folio)} guardado${d.clienteNuevo ? ' (cliente nuevo)' : ` (cliente ya registrado: ${e(d.cliente || '')})`}.${d.anticipoGuardado ? ' Anticipo registrado.' : ''}${monto}${d.google ? (d.google.ok ? ' 📆 En Google.' : ` ⚠️ ${e(d.google.error || 'Google no se actualizó')}`) : ''}${lleno(d)}${d.recibo ? (d.recibo.ok ? ' 🧾 Recibo enviado por Telegram.' : ` ⚠️ El recibo no salió: ${e(d.recibo.error)}`) : ''} Ahora asígnale brigada en el dashboard.`;
      if(v('calNFecha')){ mes = v('calNFecha').slice(0, 7); diaSel = v('calNFecha'); }
      setTimeout(cargar, 3500);
    } catch(err){
      if(err.message === 'sesion') return;
      msg.textContent = '⚠️ ' + (err.message && err.message !== 'fail' ? err.message : 'No se pudo guardar, intenta de nuevo.');
      b.disabled = false;
    }
  }

  async function post(cuerpo, extra = {}){
    return o.api('/api/dashboard-eventos', { ...extra, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  }

  async function clic(ev){
    const b = ev.target.closest('[data-cal]');
    if(!b) return;
    const accion = b.dataset.cal;
    const e = o.esc;
    if(accion === 'cerrar'){ panel.hidden = true; return; }
    if(accion === 'tab'){ vista = b.dataset.t; mostrarVista(); return; }
    if(accion.startsWith('log-')){ clicLog(b, accion); return; }
    if(accion === 'mes'){ mes = moverMes(mes, Number(b.dataset.n)); diaSel = null; cargar(); return; }
    if(accion === 'dia'){ diaSel = diaSel === b.dataset.f ? null : b.dataset.f; pintar(); return; }
    if(accion === 'todo'){ diaSel = null; pintar(); return; }
    if(accion === 'nuevo'){ formularioNuevo(); return; }
    if(accion === 'otro-producto'){ panel.querySelector('#calProds').insertAdjacentHTML('beforeend', filaProducto()); return; }
    if(accion === 'capturar'){ capturar(b); return; }
    if(accion === 'leer-foto'){ panel.querySelector('#calNFoto').click(); return; }
    if(accion === 'mostrar-texto'){ const c = panel.querySelector('#calNTextoCaja'); c.hidden = !c.hidden; if(!c.hidden) panel.querySelector('#calNTexto').focus(); return; }
    if(accion === 'leer-texto'){ leerTexto(b, false); return; }
    if(accion === 'responder-dima'){ leerTexto(b, true); return; }
    const tarjeta = b.closest('.cal-ev');
    const zona = tarjeta && tarjeta.querySelector('.cal-zona');
    const evento = tarjeta && datos.eventos.find(x => x.id === tarjeta.dataset.ev);
    if(accion === 'ficha'){ panel.hidden = true; o.abrirFicha(evento.id); return; }
    if(accion === 'recibo'){
      zona.innerHTML = '<div class="cal-msg">🧾 Preparando el recibo…</div>';
      try {
        const d = await post({ accion: 'enviar_recibo', eventoId: evento.id });
        zona.innerHTML = `<div class="cal-msg">✅ Recibo enviado por Telegram (${d.enviados}). Reenvíaselo al cliente.</div>`;
      } catch(err){
        if(err.message === 'sesion') return;
        zona.innerHTML = `<div class="cal-msg">⚠️ ${e(err.message && err.message !== 'fail' ? err.message : 'No salió el recibo.')}</div>`;
      }
      return;
    }
    if(accion === 'editar'){
      zona.innerHTML = `<div class="cal-form">
        <label class="cal-sub">Fecha <input type="date" class="cal-fecha" min="${hoy()}" value="${e(evento.fecha)}"></label>
        <label class="cal-sub">Hora de inicio <input type="time" class="cal-hora" value="${e(evento.hora)}"></label>
        <label class="cal-sub">Horas de servicio <input type="number" class="cal-horas" min="1" max="12" step="0.5" value="${e(evento.horasServicio || '')}"></label>
        <button data-cal="guardar">Guardar y avisar al equipo</button><div class="cal-msg"></div></div>`;
      return;
    }
    if(accion === 'pre-pago'){
      zona.innerHTML = `<div class="cal-form">
        <label class="cal-sub">¿Qué pagó el cliente? <select class="cal-pago-tipo"><option value="abono">Anticipo o abono</option><option value="todo">Liquidó todo lo que faltaba</option></select></label>
        <input class="cal-pago-monto" inputmode="decimal" placeholder="Cantidad que te pagó">
        <label class="cal-sub">Forma de pago <select class="cal-pago-forma"><option>Efectivo</option><option>Transferencia</option><option>Depósito</option></select></label>
        <button data-cal="pago">Guardar pago</button><div class="cal-msg"></div></div>`;
      const tipo = zona.querySelector('.cal-pago-tipo'), monto = zona.querySelector('.cal-pago-monto');
      tipo.addEventListener('change', () => { monto.hidden = tipo.value === 'todo'; });
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
      } else if(accion === 'pago'){
        const todo = zona.querySelector('.cal-pago-tipo').value === 'todo';
        d = await post({ accion: 'registrar_pago', eventoId: evento.id, monto: todo ? 'todo' : zona.querySelector('.cal-pago-monto').value, forma: zona.querySelector('.cal-pago-forma').value });
        msg.textContent = d.texto;
        return;
      } else if(accion === 'sincronizar'){
        d = await post({ accion: 'calendario_sincronizar' });
        msg.innerHTML = `📆 Pasados a Google (Calendar y Sheets): ${d.pasados}.${d.faltan ? ` Faltan ${d.faltan}: toca otra vez.` : ' Ya están todos.'}${(d.errores || []).length ? '<br>⚠️ ' + d.errores.map(e).join('<br>⚠️ ') : ''}`;
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
    mostrarVista();
  }

  function cerrar(){ if(panel) panel.hidden = true; }

  return { abrir, cerrar };
})();
