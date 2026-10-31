// brigadas/dinero.js
// 💰 Dinero del evento (lo usan la app del equipo y el dashboard de Diana):
// contratado, daños y faltantes, pagado y lo que falta; registrar un cobro y
// anotar daños o faltantes (api/_cargos.js). El cobro de la brigada entra a su
// reporte del día; el de Diana o Víctor queda como pago a Diana (registrar_pago).
// Uso: DimaDinero.configurar({ api, esc, toast, recargar, esAdmin, eventos })
//   api(url, opciones) es el fetch con sesión de cada página (lanza Error con el
//   mensaje del servidor); eventos() devuelve los eventos pintados (con .dinero).
//   DimaDinero.bloque(ev) da el HTML y DimaDinero.conectar(raiz) los botones.
window.DimaDinero = (function(){
  let o = null;
  let inventario = null;
  const pesos = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-MX');
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());

  function configurar(opciones){ o = opciones; }

  // Etiqueta corta para la ficha: "Falta $X", "✅ Pagado" o "Sin monto".
  function etiqueta(d){
    if(!d || d.error) return '';
    if(d.total > 0 && d.resta <= 0) return '<span class="ficha-pago ok">✅ Pagado</span>';
    return d.total > 0 ? `<span class="ficha-pago">Falta ${pesos(d.resta)}</span>` : '<span class="ficha-pago">Sin monto</span>';
  }

  function bloque(ev){
    const esc = o.esc;
    const d = ev.dinero;
    if(d.error) return '<div class="din-msg">⚠️ No se pudo leer el dinero de este evento. Toca actualizar.</div>';
    const fila = (t, v, cls = '') => `<div class="din-fila ${cls}"><span>${t}</span><b>${v}</b></div>`;
    return `
      ${d.cliente || d.telefono ? `<div class="din-cliente">👤 ${esc(d.cliente || 'Cliente')}${d.telefono ? ` · <a href="tel:${esc(d.telefono)}">📞 ${esc(d.telefono)}</a>` : ''}</div>` : ''}
      <div class="din-resumen">
        ${fila('Contratado', d.contratado ? pesos(d.contratado) : 'sin monto todavía')}
        ${d.cargosExtraTotal ? fila('Daños y faltantes', '+ ' + pesos(d.cargosExtraTotal)) : ''}
        ${d.descuento ? fila('Descuento', '− ' + pesos(d.descuento)) : ''}
        ${fila('Pagado', pesos(d.pagado))}
        ${fila('Falta por cobrar', pesos(d.resta), d.resta > 0 ? 'falta' : 'ok')}
      </div>
      ${d.cobros.length ? `<div class="din-lista"><b>Pagos</b>${d.cobros.map(c => `<div>${esc(c.fecha)} · ${pesos(c.monto)} · ${esc(c.forma)}${c.aDiana ? ' · a Diana' : ' · cobró la brigada'}</div>`).join('')}</div>` : ''}
      ${d.cargosExtra.length ? `<div class="din-lista"><b>Daños y faltantes</b>${d.cargosExtra.map(c => `<div>${esc(c.cantidad)} × ${esc(c.descripcion)}${c.menor ? ' (daño menor, 10%)' : ''} = ${pesos(c.total)}${c.sinPrecio ? ' ⚠️ precio escrito a mano' : ''}${c.nota ? ` · ${esc(c.nota)}` : ''} <small>(${esc(c.por)})</small> <button type="button" class="din-quitar" data-din="quitar-cargo" data-cargo="${esc(c.id)}">Quitar</button></div>`).join('')}</div>` : ''}
      <details class="din-caja" data-caja="cobro-${esc(ev.id)}"><summary>💵 Registrar cobro</summary>
        <label>¿Qué pagó el cliente?<select class="din-cobro-tipo"><option value="abono">Anticipo o abono</option>${d.resta > 0 ? `<option value="todo">Liquidó todo (${pesos(d.resta)})</option>` : ''}</select></label>
        <input class="din-cobro-monto" inputmode="decimal" placeholder="Cantidad que te pagó">
        <label>Forma de pago<select class="din-cobro-forma"><option>Efectivo</option><option>Transferencia</option><option>Depósito</option></select></label>
        <button type="button" class="din-btn" data-din="cobro">Guardar cobro</button>
        <div class="din-msg">${o.esAdmin() ? 'Queda como pago a Diana y te llega el recibo por Telegram.' : 'Entra a tu reporte del día; Diana lo aprueba al recibir el dinero.'}</div>
      </details>
      <details class="din-caja" data-caja="cargo-${esc(ev.id)}"><summary>🧾 Anotar daño o faltante</summary>
        <label>¿Qué artículo?<select class="din-tipo"><option value="">Elige el artículo…</option></select></label>
        <input class="din-desc" maxlength="120" placeholder="Si no está en la lista: qué es (ej. tapete roto)" hidden>
        <input class="din-cant" inputmode="numeric" placeholder="¿Cuántas piezas?">
        <label>¿Qué pasó?<select class="din-grav"><option value="perdido">Se rompió, se perdió o ya no sirve (precio completo)</option><option value="menor">Daño menor: mancha o rayón (10% del precio)</option></select></label>
        <input class="din-monto-cargo" inputmode="decimal" placeholder="Cuánto se cobra en total (no tiene precio)" hidden>
        <input class="din-nota" maxlength="300" placeholder="Comentario: silla quebrada, faltan copas…">
        <div class="din-previa"></div>
        <button type="button" class="din-btn" data-din="cargo">Guardar y sumar al cobro</button>
        <div class="din-msg"></div>
      </details>`;
  }

  const tarjetaDe = (el) => el.closest('[data-din-ev]');
  const eventoDe = (el) => { const t = tarjetaDe(el); return t && o.eventos().find(x => x.id === t.dataset.dinEv); };

  // La lista de artículos se pide una vez, al abrir "Anotar daño o faltante".
  async function llenarArticulos(caja){
    const sel = caja.querySelector('.din-tipo');
    if(!sel || sel.options.length > 1) return;
    const esc = o.esc;
    try {
      if(!inventario) inventario = (await o.api('/api/brigada-eventos?vista=inventario')).articulos || [];
      const ev = eventoDe(caja) || {};
      const delEvento = new Set((ev.articulos || []).map(a => a.nombre));
      const opcion = a => `<option value="${esc(a.id)}" data-precio="${a.precio || ''}">${esc(a.nombre)}${a.precio ? ' · ' + pesos(a.precio) + ' c/u' : ' · sin precio'}</option>`;
      const propios = inventario.filter(a => delEvento.has(a.nombre));
      sel.innerHTML = '<option value="">Elige el artículo…</option>'
        + (propios.length ? `<optgroup label="De este evento">${propios.map(opcion).join('')}</optgroup>` : '')
        + `<optgroup label="Todo el inventario">${inventario.map(opcion).join('')}</optgroup>`
        + '<option value="otro">Otro (no está en la lista)</option>';
    } catch(e){
      if(e.message === 'sesion') return;
      sel.insertAdjacentHTML('beforeend', '<option value="otro">Otro (no se pudo cargar la lista)</option>');
    }
  }

  function vistaPrevia(caja){
    const sel = caja.querySelector('.din-tipo');
    const opt = sel.options[sel.selectedIndex];
    const precio = opt ? Number(opt.dataset.precio) || 0 : 0;
    caja.querySelector('.din-desc').hidden = sel.value !== 'otro';
    caja.querySelector('.din-monto-cargo').hidden = !sel.value || !!precio;
    const cant = Number(caja.querySelector('.din-cant').value) || 0;
    // Daño menor: 10% del precio de reposición (api/_cargos.js).
    const menor = caja.querySelector('.din-grav').value === 'menor';
    const total = Math.round(precio * cant * (menor ? 0.10 : 1) * 100) / 100;
    caja.querySelector('.din-previa').textContent = precio && cant ? `Se le cobra al cliente: ${cant} × ${pesos(precio)}${menor ? ' × 10%' : ''} = ${pesos(total)}` : '';
  }

  const postJson = (url, cuerpo) => o.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  async function accion(b){
    const ev = eventoDe(b);
    if(!ev || !ev.dinero) return;
    const caja = b.closest('details') || tarjetaDe(b);
    const msg = caja.querySelector('.din-msg');
    const valor = (cls) => (caja.querySelector(cls) || {}).value || '';
    b.disabled = true;
    try {
      if(b.dataset.din === 'cobro'){
        const todo = valor('.din-cobro-tipo') === 'todo';
        const monto = todo ? String(ev.dinero.resta) : valor('.din-cobro-monto');
        const d = o.esAdmin()
          ? await postJson('/api/dashboard-eventos', { accion: 'registrar_pago', eventoId: ev.id, monto: todo ? 'todo' : monto, forma: valor('.din-cobro-forma') })
          : await postJson('/api/finanzas', { accion: 'cobro', desdeFicha: true, fecha: hoy(), eventoId: ev.id, monto, forma: valor('.din-cobro-forma') });
        o.toast(d.texto || `Cobro de ${pesos(monto)} guardado en tu reporte del día`);
      } else if(b.dataset.din === 'cargo'){
        const tipo = valor('.din-tipo');
        if(!tipo) throw new Error('Elige el artículo o "Otro".');
        const d = await postJson('/api/brigada-estatus', { eventoId: ev.id, tipo: 'cargo_extra', articuloId: tipo === 'otro' ? '' : tipo, descripcion: valor('.din-desc'), cantidad: valor('.din-cant'), monto: valor('.din-monto-cargo'), nota: valor('.din-nota'), gravedad: valor('.din-grav') });
        o.toast(`Cargo de ${pesos(d.cargo.total)} sumado${o.esAdmin() ? '' : '. Diana ya está avisada'}.`);
      } else if(b.dataset.din === 'quitar-cargo'){
        await postJson('/api/brigada-estatus', { eventoId: ev.id, tipo: 'quitar_cargo', cargoId: b.dataset.cargo });
        o.toast('Cargo quitado');
      }
      // Se cierra la caja y se recarga para ver el dinero al día.
      if(caja.tagName === 'DETAILS') caja.open = false;
      o.recargar();
    } catch(e){
      if(e.message === 'sesion') return;
      const texto = '⚠️ ' + (e.message && e.message !== 'fail' ? e.message : 'No se pudo guardar, intenta de nuevo.');
      if(msg) msg.textContent = texto; else o.toast(texto);
      b.disabled = false;
    }
  }

  function conectar(raiz){
    raiz.querySelectorAll('[data-din]').forEach(b => b.addEventListener('click', () => accion(b)));
    raiz.querySelectorAll('.din-tipo, .din-cant, .din-grav').forEach(el => el.addEventListener('input', () => vistaPrevia(el.closest('details'))));
    raiz.querySelectorAll('details[data-caja^="cargo-"]').forEach(d => {
      if(d.open) llenarArticulos(d);
      d.addEventListener('toggle', () => { if(d.open) llenarArticulos(d); });
    });
  }

  return { configurar, bloque, conectar, etiqueta, pesos };
})();
