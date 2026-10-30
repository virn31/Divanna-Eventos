// api/_sheets.js
// Google Sheets de pedidos (decisión de Víctor 2026-10-29): una hoja de cálculo
// por negocio, hecha con sus plantillas (Divanna_Pedidos / VasoMaiz_Pedidos).
// Cada una tiene:
//   - "Pedidos": la lista, un renglón por evento (folio EVT, cliente, total,
//     anticipo, resto, estado). Arriba de la fila "Totales".
//   - La plantilla del recibo ("Pedido" en Divanna, "Comanda" en El Vaso Maíz):
//     DiMa la duplica en una pestaña por evento, con el folio como nombre.
// DiMa escribe al autorizar o capturar un evento y lo actualiza con cada cambio
// (mover, confirmar cambio, cancelar). Si la pestaña o el renglón ya existen se
// sobrescriben; lo que se escriba a mano en las celdas amarillas (precio por
// artículo) se respeta salvo en los renglones de artículos, que se rehacen.
// Un evento "Ambos" va a las dos hojas, cada una con sus productos; el total va
// en blanco (Diana lo reparte) y el estado dice el total combinado.
// Variables: GOOGLE_SHEET_DIVANNA y GOOGLE_SHEET_VASOMAIZ (ID de la URL). Sin
// ellas no se hace nada (no es error). La hoja se comparte como Editor con
// GOOGLE_SERVICE_ACCOUNT_EMAIL.

const { google } = require('googleapis');
const { esVasoMaiz } = require('./_sesion');
const { PRODUCTOS, leerProductos, inventarioRequerido } = require('./_productos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = { EVENTOS: 'tblzLAin65BZPP2c6', CLIENTES: 'tblgViisKQRG9TVjh', COBROS: 'tblb8ADFukpm6nRZV' };
const DV = 'Divanna Eventos';
const VM = 'El Vaso Maiz';

// Dónde va cada dato en cada plantilla.
const PLANTILLAS = {
  [DV]: {
    variable: 'GOOGLE_SHEET_DIVANNA',
    pestana: 'Pedido',
    limpiar: ['B5:B10', 'B13', 'A17:E27', 'D29:D30'], // B11-B12 (entrega) se llenan a mano
    articulos: { desde: 17, hasta: 27 },
  },
  [VM]: {
    variable: 'GOOGLE_SHEET_VASOMAIZ',
    pestana: 'Comanda',
    limpiar: ['B5:B11', 'A15:B15', 'D15:E15', 'A19:E30', 'D33'],
    articulos: { desde: 19, hasta: 30 },
  },
};

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

function sheetsGoogle() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const configurado = (negocio) => !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env[PLANTILLAS[negocio].variable]);
const telefonoTexto = (t) => { const d = String(t || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(t || ''); };
const hora12 = (h) => { if (!/^\d{2}:\d{2}$/.test(h || '')) return ''; const [a, m] = h.split(':').map(Number); return `${a % 12 || 12}:${String(m).padStart(2, '0')} ${a < 12 ? 'am' : 'pm'}`; };
const rango = (pestana, celdas) => `'${pestana.replace(/'/g, "''")}'!${celdas}`;
const dinero = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

// ¿A qué hojas va este evento?
function negociosDe(f) {
  if (f.Negocio === 'Ambos') return [DV, VM];
  return [esVasoMaiz(f) ? VM : DV];
}

// Todo lo que se escribe, ya calculado (una vez por evento).
async function leerDatos(eventoId) {
  const r = await airtable(`${TABLES.EVENTOS}/${eventoId}`);
  const f = r.fields || {};
  const [cliente, cobros] = await Promise.all([
    (f.Cliente || [])[0] ? airtable(`${TABLES.CLIENTES}/${f.Cliente[0]}`).catch(() => ({ fields: {} })) : { fields: {} },
    (f.COBROS || []).length
      ? airtable(`${TABLES.COBROS}?filterByFormula=${encodeURIComponent(`OR(${f.COBROS.map(id => `RECORD_ID()="${id}"`).join(',')})`)}`).then(d => d.records || [])
      : [],
  ]);
  const pagado = cobros.reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0);
  const total = Number(f.Monto_Estimado_IA) || 0;
  const tipo = ((f.Notas || '').match(/Tipo de evento: ([^\n]+)/) || [])[1] || '';
  let estado = 'Autorizado';
  if (f.Cancelado) estado = 'Cancelado';
  else if (/^Pagado\b/.test(f.Estatus_Pago || '') || f.Estatus_Pago === 'Liquidado 100%' || (total > 0 && pagado >= total)) estado = 'Pagado';
  else if (pagado > 0) estado = 'Anticipo recibido';
  return {
    f,
    folio: f.Folio_Evento || eventoId,
    recibido: (r.createdTime || '').slice(0, 10),
    cliente: cliente.fields.Nombre || '',
    contacto: telefonoTexto(cliente.fields.Telefono_WhatsApp),
    productos: leerProductos(f.Productos),
    total,
    pagado,
    tipo: tipo === 'sin especificar' ? '' : tipo,
    estado,
  };
}

// Renglones de artículos de un negocio: [articulo/cantidad, ...].
function articulosDe(d, negocio) {
  const propios = d.productos.filter(p => (PRODUCTOS[p.clave].negocio || DV) === negocio);
  if (negocio === VM) {
    return propios.map(p => [p.cantidad, PRODUCTOS[p.clave].nombre, '', null, p.nota || '']);
  }
  // Divanna: como el recibo de papel, por artículo (mesas, sillas, manteles...).
  const lineas = Object.entries(inventarioRequerido(propios)).map(([cat, n]) => [cat, n, '']);
  for (const p of propios) {
    if (!Object.keys(PRODUCTOS[p.clave].componentes || {}).length) lineas.push([PRODUCTOS[p.clave].nombre, p.cantidad, p.nota || '']);
  }
  // Pedidos viejos sin productos: lo que Diana escribió al autorizar.
  if (!lineas.length) {
    (d.f.Items_Detallados_Cotizacion || d.f.Checklist_Items || '').split('\n').map(t => t.trim()).filter(Boolean).forEach(t => lineas.push([t, '', '']));
  }
  return lineas;
}

// Lo que va en la pestaña del recibo: [[rango, [[valores]]], ...].
function celdasRecibo(d, negocio, pestana) {
  const p = PLANTILLAS[negocio];
  const compartido = negociosDe(d.f).length > 1;
  const total = compartido ? '' : d.total;
  const lineas = articulosDe(d, negocio);
  const caben = p.articulos.hasta - p.articulos.desde + 1;
  const sobran = lineas.slice(caben);
  const out = [];
  const poner = (celda, valor) => out.push({ range: rango(pestana, celda), values: [[valor]] });
  if (negocio === DV) {
    poner('B5', d.folio);
    poner('B6', d.cliente);
    poner('B7', d.contacto);
    poner('B8', d.f.Fecha_Evento || '');
    poner('B9', hora12(d.f.Hora_Inicio));
    poner('B10', d.f.Ubicacion || '');
    const paquetes = d.productos.filter(x => (PRODUCTOS[x.clave].negocio || DV) === DV && Object.keys(PRODUCTOS[x.clave].componentes || {}).length)
      .map(x => `${x.cantidad} × ${PRODUCTOS[x.clave].nombre}`);
    const extra = [paquetes.join(', '), sobran.map(l => `${l[1] ? l[1] + ' ' : ''}${l[0]}`).join(', '), compartido ? `Evento compartido con El Vaso Maíz: total combinado ${dinero(d.total)}` : ''].filter(Boolean).join(' · ');
    poner('B13', extra);
    lineas.slice(0, caben).forEach((l, i) => {
      const n = p.articulos.desde + i;
      out.push({ range: rango(pestana, `A${n}:E${n}`), values: [[l[0], l[1], l[2], '', `=IF(D${n}="","",B${n}*D${n})`]] });
    });
    poner('D29', total);
    poner('D30', d.pagado);
  } else {
    poner('B5', d.recibido);
    poner('B6', d.tipo || 'Evento de snacks');
    poner('B7', d.f.Fecha_Evento || '');
    poner('B8', hora12(d.f.Hora_Inicio));
    poner('B9', d.cliente);
    poner('B10', d.contacto);
    poner('B11', d.f.Ubicacion || '');
    out.push({ range: rango(pestana, 'A15:B15'), values: [[Number(d.f.Piezas_Vaso_Maiz) || '', lineas.length ? 'Pedido (ver detalle)' : 'Pedido']] });
    out.push({ range: rango(pestana, 'D15:E15'), values: [[total, compartido ? `Evento compartido con Divanna: total combinado ${dinero(d.total)}` : 'Total contratado']] });
    lineas.slice(0, caben).forEach((l, i) => {
      const n = p.articulos.desde + i;
      out.push({ range: rango(pestana, `A${n}:E${n}`), values: [[l[0], l[1], '', `=IF(C${n}="",0,A${n}*C${n})`, l[4]]] });
    });
    if (sobran.length) poner(`E${p.articulos.hasta}`, `+ ${sobran.map(l => `${l[0]} ${l[1]}`).join(', ')}`);
    poner('D33', d.pagado);
    poner('D34', '=D32-D33'); // la plantilla restaba B32-B33 (celdas vacías)
  }
  return out;
}

// Renglón de la lista "Pedidos".
function renglonLista(d, negocio, n) {
  const compartido = negociosDe(d.f).length > 1;
  const total = compartido ? '' : d.total;
  const estado = compartido ? `${d.estado} · Ambos: total ${dinero(d.total)}` : d.estado;
  if (negocio === DV) {
    return [d.folio, d.cliente, d.contacto, d.f.Ubicacion || '', d.f.Fecha_Evento || '', total, d.pagado, `=IF(F${n}="","",F${n}-G${n})`, estado];
  }
  return [d.folio, d.recibido, d.cliente, d.contacto, d.tipo || 'Evento de snacks', d.f.Fecha_Evento || '', total, d.pagado, `=IF(G${n}="","",G${n}-H${n})`, estado];
}

async function escribirEnHoja(d, negocio) {
  const sheets = sheetsGoogle();
  const spreadsheetId = process.env[PLANTILLAS[negocio].variable];
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const hojas = meta.data.sheets.map(s => s.properties);
  const plantilla = hojas.find(h => h.title === PLANTILLAS[negocio].pestana);
  const lista = hojas.find(h => h.title === 'Pedidos');
  if (!plantilla || !lista) throw new Error(`a la hoja le falta la pestaña "${!plantilla ? PLANTILLAS[negocio].pestana : 'Pedidos'}"`);

  // 1. Pestaña del recibo (se crea copiando la plantilla).
  let accion = 'actualizado';
  if (!hojas.some(h => h.title === d.folio)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ duplicateSheet: { sourceSheetId: plantilla.sheetId, newSheetName: d.folio, insertSheetIndex: hojas.length } }] } });
    accion = 'creado';
  }
  await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: PLANTILLAS[negocio].limpiar.map(c => rango(d.folio, c)) } });
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: celdasRecibo(d, negocio, d.folio) } });

  // 2. Renglón en "Pedidos": el del folio si ya está; si no, el primero libre arriba de "Totales".
  const filas = (await sheets.spreadsheets.values.get({ spreadsheetId, range: rango('Pedidos', 'A1:J1000') })).data.values || [];
  let n = filas.findIndex(fila => fila[0] === d.folio) + 1;
  if (!n) {
    const totales = filas.findIndex(fila => fila.some(c => /^Totales$/i.test(String(c).trim()))) + 1 || filas.length + 2;
    // Se deja libre el renglón de separación justo arriba de Totales (fuera de las sumas).
    for (let i = 2; i < totales - 1; i++) {
      const fila = filas[i - 1] || [];
      if (!fila[0] && !fila[1] && !fila[2]) { n = i; break; }
    }
    if (!n) {
      // Lista llena: se mete un renglón dentro del rango de las sumas (antes del último).
      n = Math.max(2, totales - 2);
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ insertDimension: { range: { sheetId: lista.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n }, inheritFromBefore: true } }] } });
    }
  }
  const fila = renglonLista(d, negocio, n);
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: rango('Pedidos', `A${n}:${negocio === DV ? 'I' : 'J'}${n}`), valueInputOption: 'USER_ENTERED', requestBody: { values: [fila] },
  });
  return accion;
}

// Escribe (o actualiza) el evento en la hoja de su negocio. Solo eventos
// autorizados o cancelados después de autorizar. Nunca lanza.
async function sincronizarSheets(eventoId) {
  if (!configurado(DV) && !configurado(VM)) return { ok: true, accion: 'sin configurar' };
  try {
    const d = await leerDatos(eventoId);
    if (d.f.Autorizacion_Diana !== 'SI' && !d.f.Cancelado) return { ok: true, accion: 'nada' };
    const negocios = negociosDe(d.f).filter(configurado);
    if (!negocios.length) return { ok: true, accion: 'sin configurar' };
    const errores = [];
    const acciones = [];
    for (const negocio of negocios) {
      try {
        acciones.push(await escribirEnHoja(d, negocio));
      } catch (err) {
        console.error(`Error escribiendo en Sheets (${negocio}):`, err.message);
        errores.push(`Sheets ${negocio === VM ? 'El Vaso Maíz' : 'Divanna'}: ${err.message}`);
      }
    }
    if (errores.length) return { ok: false, error: errores.join(' · ') };
    // Marca para "Pasar los eventos a Google" (así sabe cuáles faltan en Sheets).
    if (!d.f.En_Sheets) {
      await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: { En_Sheets: true } }] }) })
        .catch(err => console.error('No se pudo marcar En_Sheets:', err.message));
    }
    return { ok: true, accion: acciones.join(', ') };
  } catch (err) {
    console.error('Error en Sheets:', err.message);
    return { ok: false, error: `Sheets: ${err.message}` };
  }
}

const sheetsConfigurado = () => configurado(DV) || configurado(VM);

module.exports = { sincronizarSheets, sheetsConfigurado, celdasRecibo, renglonLista, articulosDe, negociosDe };
