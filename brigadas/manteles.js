// brigadas/manteles.js
// Selector de manteles (Víctor 2026-11-06, sin precios a la vista: "más simple
// siempre es mejor"; el desglose con precios va en el recibo), lo usan el ➕ Capturar evento del
// calendario y "Hora y productos" del dashboard. Cada mesa trae su mantel básico
// incluido; aquí se dice cuántos se cambian a lentejuela o corrugado (se cobra la
// diferencia), los extras y el color de cada tipo. Se guarda como productos del
// catálogo (dv_cambio_*, dv_mantel*), y el servidor suma su precio al monto
// (api/_productos.js resumenManteles).
// info (lo manda el servidor): { basicos: {clave: n}, precios: {clave: $}, claves: { extra: {...}, cambio: {...} } }
window.DimaManteles = (function(){
  const TIPOS = [['basico', 'Básico'], ['lentejuela', 'Lentejuela'], ['corrugado', 'Corrugado']];
  const esMantel = (info, clave) => !!(info && info.precios && info.precios[clave]);
  const tipoDeClave = (info, clave) => {
    for (const [grupo, claves] of Object.entries(info.claves)) for (const [t, c] of Object.entries(claves)) if (c === clave) return { grupo, tipo: t };
    return null;
  };

  // Separa los renglones de mantel del resto de los productos.
  function separar(productos, info){
    const lista = productos || [];
    return { resto: lista.filter(p => !esMantel(info, p.clave)), manteles: lista.filter(p => esMantel(info, p.clave)) };
  }

  const incluidos = (productos, info) => Math.round((productos || []).reduce((t, p) => t + ((info.basicos || {})[p.clave] || 0) * (Number(p.cantidad) || 0), 0));

  // Color del básico: lo que diga "mantel básico ..." en la nota de alguna mesa.
  function colorBasico(productos){
    for (const p of productos || []) {
      const m = /mantel b[aá]sico\s+([^,;·]+)/i.exec(p.nota || '');
      if (m) return m[1].trim();
    }
    return '';
  }

  function html(productos, info, esc){
    if (!info || !info.claves) return '';
    const { resto, manteles } = separar(productos, info);
    const val = { cambio: {}, extra: {}, color: { basico: colorBasico(resto) } };
    for (const p of manteles) {
      const t = tipoDeClave(info, p.clave);
      if (!t) continue;
      val[t.grupo][t.tipo] = (val[t.grupo][t.tipo] || 0) + p.cantidad;
      if (p.nota && !val.color[t.tipo]) val.color[t.tipo] = p.nota;
    }
    const num = (grupo, tipo) => `<input type="number" min="0" step="1" inputmode="numeric" class="dm-n" data-grupo="${grupo}" data-tipo="${tipo}" value="${val[grupo][tipo] || ''}" placeholder="0" style="width:70px;">`;
    const fila = (txt, campo) => `<label style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:6px;"><span>${txt}</span>${campo}</label>`;
    return `
      <div class="dm-manteles" style="margin-top:10px; padding:10px; border:1.5px solid var(--line); border-radius:10px;">
        <b>🧺 Manteles</b>
        <div class="dm-resumen" style="font-size:.9rem; opacity:.85; margin-top:4px;"></div>
        ${fila('¿Cuántos cambian a lentejuela?', num('cambio', 'lentejuela'))}
        ${fila('¿Cuántos cambian a corrugado?', num('cambio', 'corrugado'))}
        <div style="margin-top:8px; font-size:.9rem; opacity:.85;">Extras (además de los de las mesas)</div>
        ${TIPOS.map(([t, n]) => fila(n, num('extra', t))).join('')}
        <div style="margin-top:8px; font-size:.9rem; opacity:.85;">Color de cada tipo</div>
        ${TIPOS.map(([t, n]) => fila(n, `<input class="dm-color" data-tipo="${t}" maxlength="60" placeholder="Ej. beige" value="${esc(val.color[t] || '')}" style="width:150px;">`)).join('')}
      </div>`;
  }

  function leerValores(caja){
    const v = { cambio: { lentejuela: 0, corrugado: 0 }, extra: { basico: 0, lentejuela: 0, corrugado: 0 }, color: {} };
    caja.querySelectorAll('.dm-n').forEach(i => { v[i.dataset.grupo][i.dataset.tipo] = Math.max(0, Math.floor(Number(i.value) || 0)); });
    caja.querySelectorAll('.dm-color').forEach(i => { v.color[i.dataset.tipo] = i.value.trim(); });
    return v;
  }

  // Texto en vivo: cuántos van de cada tipo y cuánto se suma al monto.
  function resumir(caja, productos, info){
    const box = caja.querySelector('.dm-manteles');
    if (!box) return { error: '' };
    const v = leerValores(box);
    const n = incluidos(productos, info);
    const cambiados = v.cambio.lentejuela + v.cambio.corrugado;
    // Los paquetes que ya traen lentejuela o corrugado cuentan en el total (a su precio de paquete).
    const esp = { lentejuela: 0, corrugado: 0 };
    for (const p of productos || []) { const e = (info.especiales || {})[p.clave]; if (e) { esp.lentejuela += e.lentejuela * (Number(p.cantidad) || 0); esp.corrugado += e.corrugado * (Number(p.cantidad) || 0); } }
    const porTipo = { basico: Math.max(0, n - cambiados) + v.extra.basico, lentejuela: Math.round(esp.lentejuela) + v.cambio.lentejuela + v.extra.lentejuela, corrugado: Math.round(esp.corrugado) + v.cambio.corrugado + v.extra.corrugado };
    const total = porTipo.basico + porTipo.lentejuela + porTipo.corrugado;
    const cargo = Object.entries(v.cambio).reduce((t, [k, c]) => t + c * info.precios[info.claves.cambio[k]], 0)
      + Object.entries(v.extra).reduce((t, [k, c]) => t + c * info.precios[info.claves.extra[k]], 0);
    const error = cambiados > n ? `Se cambian ${cambiados} manteles pero las mesas solo traen ${n} básicos. Si son más, ponlos como extra.` : '';
    const tipos = TIPOS.filter(([t]) => porTipo[t]).map(([t, nom]) => `${porTipo[t]} ${nom.toLowerCase()}`).join(' · ');
    box.querySelector('.dm-resumen').innerHTML = error ? `⚠️ ${error}`
      : `Las mesas traen <b>${n}</b> básico${n === 1 ? '' : 's'}. Van <b>${total}</b> manteles${tipos ? ': ' + tipos : ''}.`;
    return { error, cargo, total };
  }

  // Productos finales: los demás + cambios y extras de mantel (con su color),
  // y el color del básico en la nota de la primera mesa.
  function aplicar(caja, productos, info){
    const box = caja.querySelector('.dm-manteles');
    const lista = (productos || []).filter(p => !esMantel(info, p.clave)).map(p => ({ ...p }));
    if (!box) return lista;
    const v = leerValores(box);
    const conMesas = lista.find(p => (info.basicos || {})[p.clave]);
    if (conMesas) {
      const sin = String(conMesas.nota || '').split(/[,;·]/).map(t => t.trim()).filter(t => t && !/mantel b[aá]sico/i.test(t));
      if (v.color.basico) sin.push(`mantel básico ${v.color.basico}`);
      conMesas.nota = sin.join(', ').slice(0, 150) || null;
    }
    for (const [grupo, cuantos] of [['cambio', v.cambio], ['extra', v.extra]]) {
      for (const [t, c] of Object.entries(cuantos)) if (c > 0) lista.push({ clave: info.claves[grupo][t], cantidad: c, nota: v.color[t] || null });
    }
    return lista;
  }

  return { html, separar, resumir, aplicar, esMantel };
})();
