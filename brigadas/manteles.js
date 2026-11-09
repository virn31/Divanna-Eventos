// brigadas/manteles.js
// Mantel (Víctor 2026-11-06: "debería aparecer solo mantel, con tipo, color y
// cantidad"). Lo usan el ➕ Capturar evento del calendario y "Hora y productos"
// del dashboard. Cada renglón: tipo (liso, lentejuela o corrugado), color y
// cantidad. Sin precios a la vista. El liso solo tiene los 16 colores de la
// bodega; corrugado y lentejuela se escriben porque se piden a proveedor.
// ("basico" sigue siendo la clave interna del liso.)
// Por dentro: cada mesa trae un básico incluido; los especiales usan primero
// esos incluidos (cambio: se cobra la diferencia) y lo que pase de las mesas es
// extra (precio completo). Se guarda como productos del catálogo (dv_cambio_*,
// dv_mantel*) y el color del básico en la nota de la mesa; el servidor suma los
// precios al monto y el recibo los desglosa (api/_productos.js resumenManteles).
// info (lo manda el servidor): { basicos: {clave: n}, especiales: {...}, precios: {clave: $}, claves: { extra: {...}, cambio: {...} } }
window.DimaManteles = (function(){
  const TIPOS = [['basico', 'Liso'], ['lentejuela', 'Lentejuela'], ['corrugado', 'Corrugado']];
  const COLORES_LISO = ['Verde Limón', 'Morado', 'Azul Cielo', 'Verde Bandera', 'Rosa Fiesta', 'Beige Arena', 'Rosa Pastel', 'Rosa Viejo', 'Naranja', 'Beige claro', 'Amarillo', 'Azul Rey', 'Lila claro', 'Blanco', 'Negro', 'Rojo'];
  const colorDeLista = (color) => COLORES_LISO.find(c => c.toLowerCase() === String(color || '').trim().toLowerCase());
  const esMantel = (info, clave) => !!(info && info.precios && info.precios[clave]);
  const tipoDeClave = (info, clave) => {
    for (const [grupo, claves] of Object.entries(info.claves)) for (const [t, c] of Object.entries(claves)) if (c === clave) return { grupo, tipo: t };
    return null;
  };
  const incluidos = (productos, info) => Math.round((productos || []).reduce((t, p) => t + ((info.basicos || {})[p.clave] || 0) * (Number(p.cantidad) || 0), 0));
  const colorBasico = (productos) => {
    for (const p of productos || []) { const m = /mantel b[aá]sico\s+([^,;·]+)/i.exec(p.nota || ''); if (m) return m[1].trim(); }
    return '';
  };

  // Renglones a partir de lo guardado: básicos de las mesas que no se cambiaron
  // (con el color de la nota de la mesa) + cambios y extras con su color.
  function renglonesDe(productos, info){
    const lista = productos || [];
    const resto = lista.filter(p => !esMantel(info, p.clave));
    const n = incluidos(resto, info);
    const filas = [];
    let cambiados = 0;
    for (const p of lista.filter(x => esMantel(info, x.clave))) {
      const t = tipoDeClave(info, p.clave);
      if (!t) continue;
      if (t.grupo === 'cambio') cambiados += p.cantidad;
      const igual = filas.find(f => f.tipo === t.tipo && f.color === (p.nota || ''));
      if (igual) igual.cantidad += p.cantidad; else filas.push({ tipo: t.tipo, color: p.nota || '', cantidad: p.cantidad });
    }
    const basicosMesas = Math.max(0, n - cambiados);
    if (basicosMesas) {
      const color = colorBasico(resto);
      const igual = filas.find(f => f.tipo === 'basico' && f.color === color);
      if (igual) igual.cantidad += basicosMesas; else filas.unshift({ tipo: 'basico', color, cantidad: basicosMesas });
    }
    const orden = TIPOS.map(([t]) => t);
    return filas.sort((x, y) => orden.indexOf(x.tipo) - orden.indexOf(y.tipo));
  }

  // Color según el tipo. Un color guardado antes que no esté en la lista se
  // conserva como opción, para no perderlo al editar un evento viejo.
  function controlColor(tipo, color, esc){
    if (tipo !== 'basico') return `<input class="dm-color" maxlength="60" placeholder="Color (se pide a proveedor)" value="${esc(color || '')}" style="flex:1; min-width:0;">`;
    const actual = colorDeLista(color) || String(color || '').trim();
    const opciones = ['', ...COLORES_LISO, ...(actual && !colorDeLista(actual) ? [actual] : [])];
    return `<select class="dm-color" aria-label="Color de mantel" style="flex:1; min-width:0;">${opciones.map(c => `<option value="${esc(c)}" ${c === actual ? 'selected' : ''}>${esc(c || 'Color…')}</option>`).join('')}</select>`;
  }

  function fila(f, esc){
    return `<div class="dm-fila" style="display:flex; gap:6px; margin-top:6px; align-items:center;">
      <select class="dm-tipo" aria-label="Tipo de mantel">${TIPOS.map(([t, nom]) => `<option value="${t}" ${f.tipo === t ? 'selected' : ''}>${nom}</option>`).join('')}</select>
      ${controlColor(f.tipo, f.color, esc)}
      <input class="dm-cant" type="number" min="0" step="1" inputmode="numeric" placeholder="Cant." value="${f.cantidad || ''}" style="width:70px;">
      <button type="button" class="dm-quitar" aria-label="Quitar mantel" style="padding:4px 10px;">✕</button>
    </div>`;
  }

  function html(productos, info, esc){
    if (!info || !info.claves) return '';
    const filas = renglonesDe(productos, info);
    return `
      <div class="dm-manteles" style="margin-top:10px; padding:10px; border:1.5px solid var(--line); border-radius:10px;">
        <b>🧺 Mantel</b>
        <div class="dm-resumen" style="font-size:.9rem; opacity:.85; margin-top:4px;"></div>
        <div class="dm-filas">${filas.map(f => fila(f, esc)).join('')}</div>
        <button type="button" class="dm-agregar sec" style="margin-top:6px;">+ Otro mantel</button>
      </div>`;
  }

  // Botones de agregar y quitar renglón (se conectan una vez por caja).
  function conectar(box, esc, alCambiar){
    if (!box || box.dataset.conectado) return;
    box.dataset.conectado = '1';
    // Al cambiar el tipo cambia el control del color; a liso solo pasa un color de la lista.
    box.addEventListener('change', (e) => {
      const tipo = e.target.closest('.dm-tipo');
      if (!tipo) return;
      const control = tipo.closest('.dm-fila').querySelector('.dm-color');
      control.outerHTML = controlColor(tipo.value, tipo.value !== 'basico' || colorDeLista(control.value) ? control.value : '', esc);
      if (alCambiar) alCambiar();
    });
    box.addEventListener('click', (e) => {
      if (e.target.closest('.dm-agregar')) {
        const n = Number(box.dataset.incluidos) || 0;
        const yaVan = leerFilas(box).reduce((t, f) => t + f.cantidad, 0);
        box.querySelector('.dm-filas').insertAdjacentHTML('beforeend', fila({ tipo: 'basico', color: '', cantidad: Math.max(0, n - yaVan) || '' }, esc));
      } else if (e.target.closest('.dm-quitar')) {
        e.target.closest('.dm-fila').remove();
      } else return;
      if (alCambiar) alCambiar();
    });
  }

  function leerFilas(box){
    return [...box.querySelectorAll('.dm-fila')].map(f => ({
      tipo: f.querySelector('.dm-tipo').value,
      color: f.querySelector('.dm-color').value.trim(),
      cantidad: Math.max(0, Math.floor(Number(f.querySelector('.dm-cant').value) || 0)),
    })).filter(f => f.cantidad > 0);
  }

  // Reparte los renglones: los especiales usan primero los básicos incluidos de
  // las mesas (cambio) y lo que sobre es extra; los básicos de más, extra.
  // (El total cobrado es el mismo en cualquier orden: cambio = precio - $60.)
  function repartir(filas, n){
    let libres = n;
    const salida = [];
    for (const f of filas.filter(x => x.tipo !== 'basico')) {
      const cambio = Math.min(f.cantidad, libres);
      libres -= cambio;
      if (cambio) salida.push({ grupo: 'cambio', tipo: f.tipo, cantidad: cambio, color: f.color });
      if (f.cantidad - cambio) salida.push({ grupo: 'extra', tipo: f.tipo, cantidad: f.cantidad - cambio, color: f.color });
    }
    const basicos = [];
    for (const f of filas.filter(x => x.tipo === 'basico')) {
      const incluido = Math.min(f.cantidad, libres);
      libres -= incluido;
      if (incluido) basicos.push(f.color);
      if (f.cantidad - incluido) salida.push({ grupo: 'extra', tipo: 'basico', cantidad: f.cantidad - incluido, color: f.color });
    }
    return { salida, coloresBasico: [...new Set(basicos.filter(Boolean))] };
  }

  // Texto en vivo: cuántos manteles traen las mesas y cuántos van (sin precios).
  function resumir(caja, productos, info){
    const box = caja.querySelector('.dm-manteles');
    if (!box) return { error: '' };
    const n = incluidos(productos, info);
    box.dataset.incluidos = n;
    // Al poner mesas sale solo el renglón de básico con la cantidad de mesas; si
    // nadie lo ha tocado, sigue a las mesas cuando cambian.
    const filas = box.querySelectorAll('.dm-fila');
    if (!filas.length && n > 0) {
      box.querySelector('.dm-filas').insertAdjacentHTML('beforeend', fila({ tipo: 'basico', color: '', cantidad: n }, (s) => s));
      box.querySelector('.dm-fila').dataset.auto = '1';
    } else if (filas.length === 1 && filas[0].dataset.auto === '1') {
      filas[0].querySelector('.dm-cant').value = n || '';
    }
    if (!box.dataset.vigila) {
      box.dataset.vigila = '1';
      box.addEventListener('input', (e) => { const f = e.target.closest('.dm-fila'); if (f) delete f.dataset.auto; });
    }
    const total = leerFilas(box).reduce((t, f) => t + f.cantidad, 0);
    box.querySelector('.dm-resumen').innerHTML = n || total
      ? `Las mesas traen <b>${n}</b> mantel${n === 1 ? '' : 'es'} · Anotados: <b>${total}</b>${total < n ? ` · ⚠️ faltan ${n - total} por anotar` : ''}`
      : 'Sin mesas. Agrega manteles solo si los lleva aparte.';
    return { error: '', total };
  }

  // Productos finales: los demás + cambios y extras de mantel (con su color),
  // y el color del básico en la nota de la primera mesa.
  function aplicar(caja, productos, info){
    const box = caja.querySelector('.dm-manteles');
    const lista = (productos || []).filter(p => !esMantel(info, p.clave)).map(p => ({ ...p }));
    if (!box) return lista;
    const { salida, coloresBasico } = repartir(leerFilas(box), incluidos(lista, info));
    const conMesas = lista.find(p => (info.basicos || {})[p.clave]);
    if (conMesas) {
      const otras = String(conMesas.nota || '').split(/[,;·]/).map(t => t.trim()).filter(t => t && !/mantel b[aá]sico/i.test(t));
      if (coloresBasico.length) otras.push(`mantel básico ${coloresBasico.join(' y ')}`);
      conMesas.nota = otras.join(', ').slice(0, 150) || null;
    }
    for (const s of salida) lista.push({ clave: info.claves[s.grupo][s.tipo], cantidad: s.cantidad, nota: s.color || null });
    return lista;
  }

  return { html, conectar, resumir, aplicar, esMantel, repartir, controlColor, COLORES_LISO };
})();
