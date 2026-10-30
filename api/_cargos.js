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
//
// Cuánto se cobra (Víctor, 2026-10-30): perdido o inservible = 100% del precio
// de reposición; daño menor (mancha, rayón, se limpia o se repara) = 10%.
// Por Telegram (/daño, api/_danos.js) DiMa arma un borrador: sus cargos quedan
// con "pendiente" y un "lote" y no cuentan en el total hasta que se confirman.

const crypto = require('crypto');
const { ROLES, puedeOperarEvento } = require('./_sesion');
const { enviarTelegramEquipo } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = { EVENTOS: 'tblzLAin65BZPP2c6', INVENTARIO: 'tblG7pqvkyGTzBxx0', COBROS: 'tblb8ADFukpm6nRZV', CLIENTES: 'tblgViisKQRG9TVjh' };
const ID = /^rec[A-Za-z0-9]{14}$/;
const MAX_CARGOS = 60;
const PORCENTAJE_DANO_MENOR = 0.10;

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

// Los cargos que cuentan (sin los borradores de /daño). Con { conPendientes }
// también los borradores, para guardar sin perderlos.
function leerCargos(texto, { conPendientes = false } = {}) {
  try {
    const lista = JSON.parse(texto || '[]');
    return Array.isArray(lista) ? lista.filter(c => c && c.id && c.descripcion && Number(c.total) >= 0 && (conPendientes || !c.pendiente)) : [];
  } catch (e) { return []; }
}

// Monto de un renglón: precio de reposición x cantidad, al 10% si es daño menor.
function montoCargo(precio, cantidad, gravedad) {
  return redondo(precio * cantidad * (gravedad === 'menor' ? PORCENTAJE_DANO_MENOR : 1));
}
const textoGravedad = (g) => g === 'menor' ? ' (daño menor, 10%)' : '';

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
      cargosExtra: leerCargos(f.Cargos_Extra).map(x => ({ id: x.id, descripcion: x.descripcion, cantidad: x.cantidad, precio: x.precio, total: x.total, nota: x.nota || '', por: x.por || '', sinPrecio: !!x.sinPrecio, menor: x.gravedad === 'menor' })),
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
  const total = redondo(cargos.filter(c => !c.pendiente).reduce((t, c) => t + (Number(c.total) || 0), 0));
  await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: { Cargos_Extra: JSON.stringify(cargos), Cargos_Extra_Total: total } }] }) });
  return total;
}

// body: { eventoId, articuloId?, descripcion?, cantidad, monto?, nota, gravedad? }
// Con artículo de INVENTARIO con precio: cantidad x Precio_Reposicion (al 10% si
// gravedad es "menor").
// Sin precio (o sin artículo): monto escrito por quien lo anota, y va marcado
// para que Diana lo revise. Devuelve { ok, cargo, cargosExtraTotal } o { error, codigo }.
async function agregarCargo(colaborador, body) {
  if (!veDinero(colaborador)) return { error: 'Solo el líder o la encargada anotan daños y faltantes.', codigo: 403 };
  if (!ID.test(body.eventoId || '')) return { error: 'Parámetros inválidos' };
  const cantidad = Math.round(Number(body.cantidad));
  if (!(cantidad > 0 && cantidad <= 1000)) return { error: 'Escribe cuántas piezas.' };
  const evento = await airtable(`${TABLES.EVENTOS}/${body.eventoId}`);
  if (!puedeOperarEvento(colaborador, evento.fields)) return { error: 'Este evento no es tuyo.', codigo: 403 };
  const cargos = leerCargos(evento.fields.Cargos_Extra, { conPendientes: true });
  if (cargos.length >= MAX_CARGOS) return { error: 'Este evento ya tiene demasiados cargos; avísale a Diana.' };
  const gravedad = body.gravedad === 'menor' ? 'menor' : 'perdido';

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
  if (precio) total = montoCargo(precio, cantidad, gravedad);
  else {
    total = redondo(Number(String(body.monto || '').replace(/[$,\s]/g, '')));
    if (!(total > 0 && total < 1000000)) return { error: 'Ese artículo no tiene precio de reposición: escribe cuánto se le cobra al cliente.' };
    precio = redondo(total / cantidad);
  }
  const cargo = {
    id: crypto.randomBytes(6).toString('hex'),
    articuloId, descripcion, cantidad, precio, total, sinPrecio, gravedad,
    nota: String(body.nota || '').trim().slice(0, 300),
    por: colaborador.nombre || '', porId: colaborador.id, el: new Date().toISOString(),
  };
  const cargosExtraTotal = await guardarCargos(evento.id, [...cargos, cargo]);
  const f = evento.fields;
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🧾 Cargo extra en ${f.Folio_Evento || 'un evento'}: ${cantidad} × ${descripcion}${textoGravedad(gravedad)} = ${pesos(total)}${cargo.nota ? ` (${cargo.nota})` : ''}.`
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
  const cargos = leerCargos(evento.fields.Cargos_Extra, { conPendientes: true });
  const cargo = cargos.find(c => c.id === body.cargoId && !c.pendiente);
  if (!cargo) return { error: 'Ese cargo ya no existe.' };
  if (colaborador.rol !== ROLES.ADMIN && cargo.porId !== colaborador.id) return { error: 'Solo quien lo anotó o Diana lo pueden quitar.', codigo: 403 };
  const cargosExtraTotal = await guardarCargos(evento.id, cargos.filter(c => c.id !== cargo.id));
  if (colaborador.rol !== ROLES.ADMIN) {
    await enviarTelegramEquipo({ roles: [ROLES.ADMIN], texto: `↩️ ${colaborador.nombre} quitó el cargo extra de ${evento.fields.Folio_Evento || 'un evento'}: ${cargo.cantidad} × ${cargo.descripcion} (${pesos(cargo.total)}).` })
      .catch(err => console.error('No se pudo avisar que se quitó el cargo:', err.message));
  }
  return { ok: true, cargosExtraTotal };
}

// ---------- Borrador de daños por Telegram (/daño, api/_danos.js) ----------
// renglones: [{ articulo: { id, nombre, precio } | null, descripcion, cantidad, gravedad, nota }]
// Guarda los cargos como pendientes de un lote y devuelve { lote, cargos, total, sinPrecio }.
async function proponerLote(colaborador, evento, renglones) {
  if (!veDinero(colaborador)) return { error: 'Solo el líder, la encargada, la gerente o Diana y Víctor anotan daños.' };
  if (!puedeOperarEvento(colaborador, evento.fields)) return { error: `El ${evento.fields.Folio_Evento || 'evento'} no es tuyo.` };
  const previos = leerCargos(evento.fields.Cargos_Extra, { conPendientes: true });
  if (previos.length + renglones.length > MAX_CARGOS) return { error: 'Este evento ya tiene demasiados cargos; avísale a Diana.' };
  const lote = crypto.randomBytes(4).toString('hex');
  const el = new Date().toISOString();
  const cargos = renglones.map(r => {
    const cantidad = Math.min(1000, Math.max(1, Math.round(Number(r.cantidad) || 1)));
    const gravedad = r.gravedad === 'menor' ? 'menor' : 'perdido';
    const precio = r.articulo && r.articulo.precio ? r.articulo.precio : null;
    return {
      id: crypto.randomBytes(6).toString('hex'),
      articuloId: r.articulo ? r.articulo.id : '',
      descripcion: String((r.articulo && r.articulo.nombre) || r.descripcion || 'Artículo').slice(0, 120),
      cantidad, precio, gravedad,
      total: precio ? montoCargo(precio, cantidad, gravedad) : 0,
      sinPrecio: !precio,
      nota: String(r.nota || '').slice(0, 300),
      por: colaborador.nombre || '', porId: colaborador.id, el,
      pendiente: true, lote,
    };
  });
  await guardarCargos(evento.id, [...previos.filter(c => !(c.pendiente && c.porId === colaborador.id)), ...cargos]);
  return { lote, cargos, total: redondo(cargos.reduce((t, c) => t + c.total, 0)), sinPrecio: cargos.some(c => c.sinPrecio) };
}

function textoLote(folio, cargos) {
  return cargos.map(c => `• ${c.cantidad} × ${c.descripcion}${textoGravedad(c.gravedad)}: ${c.sinPrecio ? 'sin precio de reposición' : pesos(c.total)}${c.nota ? ` (${c.nota})` : ''}`).join('\n')
    + `
Total: ${pesos(cargos.reduce((t, c) => t + c.total, 0))}${cargos.some(c => c.sinPrecio) ? ' (más lo que no tiene precio: Diana lo pone)' : ''}`;
}

// Confirma (registrar = true) o descarta el borrador. Solo quien lo pidió o un Admin.
async function cerrarLote(colaborador, eventoId, lote, registrar) {
  if (!ID.test(eventoId || '') || !/^[a-f0-9]{8}$/.test(lote || '')) return { aviso: 'Ese borrador no es válido.' };
  const evento = await airtable(`${TABLES.EVENTOS}/${eventoId}`);
  const todos = leerCargos(evento.fields.Cargos_Extra, { conPendientes: true });
  const suyos = todos.filter(c => c.pendiente && c.lote === lote);
  if (!suyos.length) return { aviso: 'Ese borrador ya se registró o se descartó.' };
  if (colaborador.rol !== ROLES.ADMIN && suyos[0].porId !== colaborador.id) return { aviso: 'Solo quien lo anotó o Diana lo pueden confirmar.', alerta: true };
  const folio = evento.fields.Folio_Evento || 'el evento';
  if (!registrar) {
    await guardarCargos(evento.id, todos.filter(c => c.lote !== lote || !c.pendiente));
    return { aviso: 'Descartado', textoFinal: '❌ Descartado: no se cobró nada.' };
  }
  const confirmados = suyos.map(({ pendiente, lote: _l, ...c }) => c);
  const cargosExtraTotal = await guardarCargos(evento.id, [...todos.filter(c => c.lote !== lote || !c.pendiente), ...confirmados]);
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🧾 Daños y faltantes en ${folio} (los anotó ${suyos[0].por} con DiMa):
${textoLote(folio, confirmados)}
Total de cargos extra del evento: ${pesos(cargosExtraTotal)}.`
      + (confirmados.some(c => c.sinPrecio) ? '\n⚠️ Hay artículos sin precio de reposición: ponlo en INVENTARIO o en el monto del cargo.' : ''),
  }).catch(err => console.error('No se pudo avisar los daños:', err.message));
  return { aviso: 'Registrado', textoFinal: `✅ Registrado en ${folio} y sumado a lo que debe el cliente. Diana ya está avisada.`, cargosExtraTotal };
}

module.exports = { veDinero, leerCargos, totalDelEvento, dineroParaApp, inventarioParaCargos, agregarCargo, quitarCargo, proponerLote, cerrarLote, textoLote, PORCENTAJE_DANO_MENOR };
