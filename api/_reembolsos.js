// api/_reembolsos.js
// Reembolsos consolidados por colaborador (pedido de Víctor 2026-11-07).
// - Pendiente: GASTOS con Pagado_Con = "Dinero propio" y Reembolsado sin marcar,
//   ("Inversión personal" es otra opción de Pagado_Con: no se reembolsa). Una fila por
//   colaborador (Reportado_Por) con su total.
// - Cada pago, total o parcial, crea un registro en PAGOS_REEMBOLSO ligado a los
//   gastos pendientes de esa persona en ese momento.
// - Los gastos se marcan Reembolsado, del más viejo al más nuevo, cuando lo
//   pagado alcanza su monto. Lo que sobra de un pago parcial queda "a cuenta":
//   saldo a favor = pagos de la persona − gastos ya marcados que algún pago cubrió.
// - Lo pagado en efectivo descuenta del efectivo sin destino de Diana (_cuadre.js).
// Solo Diana y Víctor (Admin) ven y pagan reembolsos.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { enviarTelegram } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = { GASTOS: 'tblfuEW0oiX4xTw7T', PAGOS: 'tbln6uJwZMFd6nS0J' };
// Nombres de opciones en Airtable (verificar contra el esquema antes de publicar).
const DINERO_PROPIO = 'Dinero propio';
const FORMAS = ['Efectivo', 'Transferencia'];
const TOLERANCIA = 0.5;
const ID = /^rec[A-Za-z0-9]{14}$/;

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function todas(path) {
  const registros = [];
  let offset = '';
  do {
    const data = await airtable(`${path}${path.includes('?') ? '&' : '?'}pageSize=100${offset ? '&offset=' + offset : ''}`);
    registros.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return registros;
}

const hoyCuliacan = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const redondo = (n) => Math.round(n * 100) / 100;
const porIds = (ids) => `OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`;
const esAdmin = (c) => c && c.rol === ROLES.ADMIN;

function monto(valor) {
  const n = Math.round(Number(String(valor == null ? '' : valor).replace(/[$,\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= 1000000 ? n : null;
}

const aGasto = (r) => ({
  id: r.id,
  concepto: r.fields.Concepto || '',
  monto: Number(r.fields.Monto) || 0,
  fecha: r.fields.Fecha || '',
  pagadoCon: r.fields.Pagado_Con || '',
  colaboradorId: (r.fields.Reportado_Por || [])[0] || '',
});

async function porLotes(ids, path) {
  const unicos = [...new Set(ids.filter(id => ID.test(id)))];
  const salida = [];
  for (let i = 0; i < unicos.length; i += 50) {
    salida.push(...await todas(`${path}${path.includes('?') ? '&' : '?'}filterByFormula=${encodeURIComponent(porIds(unicos.slice(i, i + 50)))}`));
  }
  return salida;
}

// Lee gastos pendientes, pagos y lo ya cubierto; arma una fila por colaborador.
async function datos() {
  const formula = `AND({Pagado_Con} = "${DINERO_PROPIO}", NOT({Reembolsado}))`;
  const [pendientesRaw, pagos] = await Promise.all([
    todas(`${TABLES.GASTOS}?filterByFormula=${encodeURIComponent(formula)}`),
    todas(TABLES.PAGOS),
  ]);
  const pendientes = pendientesRaw.map(aGasto).filter(g => g.pagadoCon === DINERO_PROPIO && g.colaboradorId && g.monto > 0);
  // Gastos que algún pago ya cubrió (marcados Reembolsado): consumen lo pagado.
  const ligados = [...new Set(pagos.flatMap(p => p.fields.Gastos || []))];
  const cubiertos = ligados.length
    ? (await porLotes(ligados, `${TABLES.GASTOS}?fields%5B%5D=Monto&fields%5B%5D=Reembolsado&fields%5B%5D=Reportado_Por`)).filter(r => r.fields.Reembolsado).map(aGasto)
    : [];
  const filas = new Map();
  const fila = (id) => {
    if (!filas.has(id)) filas.set(id, { colaboradorId: id, nombre: '', gastos: [], pagado: 0, cubierto: 0 });
    return filas.get(id);
  };
  pendientes.forEach(g => fila(g.colaboradorId).gastos.push(g));
  pagos.forEach(p => { const id = (p.fields.Colaborador || [])[0]; if (id && filas.has(id)) filas.get(id).pagado += Number(p.fields.Monto) || 0; });
  cubiertos.forEach(g => { if (filas.has(g.colaboradorId)) filas.get(g.colaboradorId).cubierto += g.monto; });
  const nombres = new Map((await porLotes([...filas.keys()], `${COLABORADORES_TABLE}?fields%5B%5D=Nombre&fields%5B%5D=Telegram_Chat_ID`))
    .map(r => [r.id, { nombre: r.fields.Nombre || '', chatId: r.fields.Telegram_Chat_ID || '' }]));
  return [...filas.values()].map(f => {
    const gastos = f.gastos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
    const total = redondo(gastos.reduce((t, g) => t + g.monto, 0));
    const aCuenta = redondo(Math.max(0, f.pagado - f.cubierto));
    const n = nombres.get(f.colaboradorId) || {};
    return { colaboradorId: f.colaboradorId, nombre: n.nombre || 'Sin nombre', chatId: n.chatId || '', gastos, total, aCuenta, pendiente: redondo(Math.max(0, total - aCuenta)) };
  }).filter(f => f.pendiente > TOLERANCIA).sort((a, b) => b.pendiente - a.pendiente || a.nombre.localeCompare(b.nombre, 'es'));
}

// Lo que ve Finanzas → Reembolsos y el home: una fila por colaborador.
async function vistaReembolsos(colaborador) {
  if (!esAdmin(colaborador)) return { error: 'Solo Diana y Víctor ven los reembolsos.', codigo: 403 };
  const filas = (await datos()).map(({ chatId, ...f }) => f);
  return { filas, total: redondo(filas.reduce((t, f) => t + f.pendiente, 0)), formas: FORMAS };
}

// Gastos que quedan cubiertos con el crédito (del más viejo al más nuevo).
function gastosCubiertos(gastos, credito) {
  const cubiertos = [];
  let resta = credito;
  for (const g of gastos) {
    if (resta + TOLERANCIA < g.monto) break;
    cubiertos.push(g);
    resta = redondo(resta - g.monto);
  }
  return cubiertos;
}

// Pago total ("todo") o parcial a un colaborador. Devuelve { ok, texto, ... } o { error }.
async function pagarReembolso(colaborador, { colaboradorId, monto: montoTexto, forma }) {
  if (!esAdmin(colaborador)) return { error: 'Solo Diana y Víctor pagan reembolsos.', codigo: 403 };
  if (!ID.test(colaboradorId || '')) return { error: 'Parámetros inválidos' };
  if (!FORMAS.includes(forma)) return { error: 'Elige si fue en efectivo o por transferencia.' };
  const f = (await datos()).find(x => x.colaboradorId === colaboradorId);
  if (!f) return { error: 'Esa persona no tiene reembolsos pendientes.' };
  const valor = montoTexto === 'todo' ? f.pendiente : monto(montoTexto);
  if (!valor) return { error: 'Escribe cuánto le pagaste.' };
  if (valor > f.pendiente + TOLERANCIA) return { error: `Es más de lo pendiente (${pesos(f.pendiente)}).` };
  await airtable(TABLES.PAGOS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: {
      Referencia: `Reembolso ${f.nombre} · ${hoyCuliacan()}`, Monto: valor, Fecha: hoyCuliacan(), Forma: forma,
      Colaborador: [colaboradorId], Registrado_Por: colaborador.nombre, Gastos: f.gastos.map(g => g.id),
    } }] }),
  });
  const cubiertos = gastosCubiertos(f.gastos, redondo(f.aCuenta + valor));
  for (let i = 0; i < cubiertos.length; i += 10) {
    await airtable(TABLES.GASTOS, { method: 'PATCH', body: JSON.stringify({ records: cubiertos.slice(i, i + 10).map(g => ({ id: g.id, fields: { Reembolsado: true } })) }) });
  }
  const queda = redondo(Math.max(0, f.pendiente - valor));
  if (f.chatId) {
    await enviarTelegram(f.chatId, `💵 ${colaborador.nombre} te reembolsó ${pesos(valor)} (${forma.toLowerCase()}).${queda > TOLERANCIA ? ` Te quedan ${pesos(queda)} por cobrar.` : ' Ya quedas al corriente.'}`)
      .catch(err => console.error('Reembolso: no se pudo avisar a', f.nombre, err.message));
  }
  return {
    ok: true, pagado: valor, queda, marcados: cubiertos.length,
    texto: `✅ Guardado: ${pesos(valor)} a ${f.nombre} en ${forma.toLowerCase()}. ${cubiertos.length === 1 ? '1 gasto quedó reembolsado' : `${cubiertos.length} gastos quedaron reembolsados`}.${queda > TOLERANCIA ? ` Le quedan ${pesos(queda)}.` : ' Ya no se le debe nada.'}`,
  };
}

// Pagos de reembolso en efectivo (para el efectivo sin destino de Diana).
async function reembolsadoEnEfectivo() {
  const pagos = await todas(`${TABLES.PAGOS}?filterByFormula=${encodeURIComponent('{Forma} = "Efectivo"')}&fields%5B%5D=Monto&fields%5B%5D=Fecha`);
  return redondo(pagos.reduce((t, p) => t + (Number(p.fields.Monto) || 0), 0));
}

module.exports = { vistaReembolsos, pagarReembolso, reembolsadoEnEfectivo, gastosCubiertos, datosReembolsos: datos, FORMAS_REEMBOLSO: FORMAS };
