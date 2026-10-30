// api/_cargos.js
// Dinero del evento en la ficha de la app (decisión de Víctor, 2026-10-30):
// quien entrega y cobra (líder, encargada, gerente y Admin; NO el asistente ni
// el staff) ve el total, lo pagado y lo que falta, registra el cobro (va al
// reporte del día, api/_finanzas.js) y anota daños o faltantes ("2 sillas
// Tiffany quebradas", "faltan 6 copas"). El cargo se calcula al momento con
// INVENTARIO.Precio_Reposicion; si el artículo no tiene precio, quien lo anota
// escribe el monto y se le avisa a Diana para que lo revise.
//
// Los cargos viven en EVENTOS.Cargos_Extra (JSON) y su suma en
// EVENTOS.Cargos_Extra_Total, que se suma a lo contratado en el cuadre
// (api/_cuadre.js) y en el recibo (api/_sheets.js).

const crypto = require('crypto');
const { ROLES, puedeOperarEvento } = require('./_sesion');
const { enviarTelegramEquipo } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = { EVENTOS: 'tblzLAin65BZPP2c6', INVENTARIO: 'tblG7pqvkyGTzBxx0', COBROS: 'tblb8ADFukpm6nRZV', CLIENTES: 'tblgViisKQRG9TVjh' };
const ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_CARGOS = 60;

async function airtable(path, opciones = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Todas las páginas de una lectura (Airtable da 100 registros por página).
async function todas(path) {
  const registros = [];
  let offset = '';
  do {
    const d = await airtable(`${path}${path.includes('?') ? '&' : '?'}pageSize=100${offset ? `&offset=${offset}` : ''}`);
    registros.push(...(d.records || []));
    offset = d.offset || '';
  } while (offset);
  return registros;
}

const redondo = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pesos = (n) => `$${redondo(n).toLocaleString('es-MX')}`;

// ¿Ve y opera el dinero del evento? El asistente solo carga y alertas.
function veDinero(colaborador) {
  return [ROLES.ADMIN, ROLES.LIDER, ROLES.ENCARGADA].includes(colaborador.rol);
}

function leerCargos(texto) {
  try {
    const lista = JSON.parse(texto || '[]');
    return Array.isArray(lista) ? lista.filter(c => c && c.id && c.descripcion && Number(c.total) >= 0) : [];
  } catch (e) { return []; }
}

// Lo contratado más los cargos extra: es lo que el cliente debe en total.
function totalDelEvento(f) {
  return redondo((Number(f.Monto_Estimado_IA) || 0) + (Number(f.Cargos_Extra_Total) || 0));
}

// Dinero de cada evento para la ficha de la app. Una sola lectura de COBROS
// para todos los eventos (y otra de CLIENTES para el nombre y teléfono).
async function dineroParaApp(registros) {
  const cobroIds = registros.flatMap(r => r.fields.COBROS || []);
  const clienteIds = [...new Set(registros.map(r => (r.fields.Cliente || [])[0]).filter(Boolean))];
  const porIds = (ids) => encodeURIComponent(`OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`);
  const [cobros, clientes] = await Promise.all([
    cobroIds.length ? todas(`${TABLES.COBROS}?filterByFormula=${porIds(cobroIds)}`) : [],
    clienteIds.length ? todas(`${TABLES.CLIENTES}?filterByFormula=${porIds(clienteIds)}&fields%5B%5D=Nombre&fields%5B%5D=Telefono_WhatsApp`) : [],
  ]);
  const cliente = new Map(clientes.map(c => [c.id, c.fields]));
  const resultado = new Map();
  for (const r of registros) {
    const f = r.fields;
    const suyos = cobros.filter(c => (c.fields.Evento || [])[0] === r.id);
    const pagado = redondo(suyos.reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0));
    const total = totalDelEvento(f);
    const descuento = Number(f.Descuento) || 0;
    const c = cliente.get((f.Cliente || [])[0]) || {};
    resultado.set(r.id, {
      cliente: c.Nombre || '',
      telefono: String(c.Telefono_WhatsApp || '').replace(/^\+52/, ''),
      contratado: Number(f.Monto_Estimado_IA) || 0,
      cargosExtra: leerCargos(f.Cargos_Extra).map(x => ({ id: x.id, descripcion: x.descripcion, cantidad: x.cantidad, precio: x.precio, total: x.total, nota: x.nota || '', por: x.por || '', sinPrecio: !!x.sinPrecio })),
      cargosExtraTotal: Number(f.Cargos_Extra_Total) || 0,
      descuento,
      total,
      pagado,
      resta: redondo(Math.max(0, total - descuento - pagado)),
      cobros: suyos.map(x => ({ monto: Number(x.fields.Monto) || 0, forma: x.fields.Forma || '', fecha: x.fields.Fecha || '', aDiana: x.fields.Recibido_Por === 'Diana' })),
    });
  }
  return resultado;
}

// Artículos para elegir al anotar un daño: los asignados al evento primero.
async function inventarioParaCargos() {
  const registros = await todas(`${TABLES.INVENTARIO}?filterByFormula=${encodeURIComponent('{Item} != ""')}&fields%5B%5D=Item&fields%5B%5D=Categoria&fields%5B%5D=Precio_Reposicion`);
  return registros.map(r => ({ id: r.id, nombre: r.fields.Item, categoria: r.fields.Categoria || '', precio: Number(r.fields.Precio_Reposicion) || null }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

async function guardarCargos(eventoId, cargos) {
  const total = redondo(cargos.reduce((t, c) => t + (Number(c.total) || 0), 0));
  await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: { Cargos_Extra: JSON.stringify(cargos), Cargos_Extra_Total: total } }] }) });
  return total;
}

// body: { eventoId, articuloId?, descripcion?, cantidad, monto?, nota }
// Con artículo de INVENTARIO con precio: cantidad x Precio_Reposicion.
// Sin precio (o sin artículo): monto escrito por quien lo anota, y va marcado
// para que Diana lo revise. Devuelve { ok, cargo, cargosExtraTotal } o { error, codigo }.
async function agregarCargo(colaborador, body) {
  if (!veDinero(colaborador)) return { error: 'Solo el líder o la encargada anotan daños y faltantes.', codigo: 403 };
  if (!ID.test(body.eventoId || '')) return { error: 'Parámetros inválidos' };
  const cantidad = Math.round(Number(body.cantidad));
  if (!(cantidad > 0 && cantidad <= 1000)) return { error: 'Escribe cuántas piezas.' };
  const evento = await airtable(`${TABLES.EVENTOS}/${body.eventoId}`);
  if (!puedeOperarEvento(colaborador, evento.fields)) return { error: 'Este evento no es tuyo.', codigo: 403 };
  const cargos = leerCargos(evento.fields.Cargos_Extra);
  if (cargos.length >= MAX_CARGOS) return { error: 'Este evento ya tiene demasiados cargos; avísale a Diana.' };

  let descripcion = String(body.descripcion || '').trim().slice(0, 120);
  let precio = null;
  let articuloId = '';
  if (ID.test(body.articuloId || '')) {
    const art = await airtable(`${TABLES.INVENTARIO}/${body.articuloId}`);
    articuloId = art.id;
    descripcion = art.fields.Item || descripcion;
    precio = Number(art.fields.Precio_Reposicion) || null;
  }
  if (!descripcion) return { error: 'Elige el artículo o escribe qué pasó.' };
  let total;
  const sinPrecio = !precio;
  if (precio) total = redondo(precio * cantidad);
  else {
    total = redondo(Number(String(body.monto || '').replace(/[$,\s]/g, '')));
    if (!(total > 0 && total < 1000000)) return { error: 'Ese artículo no tiene precio de reposición: escribe cuánto se le cobra al cliente.' };
    precio = redondo(total / cantidad);
  }
  const cargo = {
    id: crypto.randomBytes(6).toString('hex'),
    articuloId, descripcion, cantidad, precio, total, sinPrecio,
    nota: String(body.nota || '').trim().slice(0, 300),
    por: colaborador.nombre || '', porId: colaborador.id, el: new Date().toISOString(),
  };
  const cargosExtraTotal = await guardarCargos(evento.id, [...cargos, cargo]);
  const f = evento.fields;
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🧾 Cargo extra en ${f.Folio_Evento || 'un evento'}: ${cantidad} × ${descripcion} = ${pesos(total)}${cargo.nota ? ` (${cargo.nota})` : ''}.`
      + `${sinPrecio ? ' ⚠️ Sin precio de reposición: el monto lo escribió quien lo anotó, revísalo.' : ''} Lo anotó ${cargo.por}. Total de cargos extra: ${pesos(cargosExtraTotal)}.`,
  }).catch(err => console.error('No se pudo avisar el cargo extra:', err.message));
  return { ok: true, cargo, cargosExtraTotal };
}

// Quitar un cargo: Diana y Víctor cualquiera; quien lo anotó, el suyo.
async function quitarCargo(colaborador, body) {
  if (!veDinero(colaborador)) return { error: 'No puedes quitar cargos.', codigo: 403 };
  if (!ID.test(body.eventoId || '') || typeof body.cargoId !== 'string') return { error: 'Parámetros inválidos' };
  const evento = await airtable(`${TABLES.EVENTOS}/${body.eventoId}`);
  if (!puedeOperarEvento(colaborador, evento.fields)) return { error: 'Este evento no es tuyo.', codigo: 403 };
  const cargos = leerCargos(evento.fields.Cargos_Extra);
  const cargo = cargos.find(c => c.id === body.cargoId);
  if (!cargo) return { error: 'Ese cargo ya no existe.' };
  if (colaborador.rol !== ROLES.ADMIN && cargo.porId !== colaborador.id) return { error: 'Solo quien lo anotó o Diana lo pueden quitar.', codigo: 403 };
  const cargosExtraTotal = await guardarCargos(evento.id, cargos.filter(c => c.id !== cargo.id));
  if (colaborador.rol !== ROLES.ADMIN) {
    await enviarTelegramEquipo({ roles: [ROLES.ADMIN], texto: `↩️ ${colaborador.nombre} quitó el cargo extra de ${evento.fields.Folio_Evento || 'un evento'}: ${cargo.cantidad} × ${cargo.descripcion} (${pesos(cargo.total)}).` })
      .catch(err => console.error('No se pudo avisar que se quitó el cargo:', err.message));
  }
  return { ok: true, cargosExtraTotal };
}

module.exports = { veDinero, leerCargos, totalDelEvento, dineroParaApp, inventarioParaCargos, agregarCargo, quitarCargo };
