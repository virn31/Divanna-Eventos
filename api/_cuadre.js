// api/_cuadre.js
// Cuadre por excepción (decisión de Víctor 2026-10-29). Diana NO lleva un libro:
// el sistema ya sabe lo contratado, lo que cobran las brigadas (reporte del día),
// el efectivo que le entregan y los gastos. Cuando algo no cierra, DiMa le
// pregunta a Diana con botones y su respuesta queda registrada, para que el
// dinero siempre tenga dónde, cómo y cuándo:
// - Al día siguiente de cada evento (cron de las 8:00): si contratado − cobrado
//   por la brigada − pagado a Diana − descuento no da cero, le pregunta qué pasó
//   (le pagaron a ella, sigue debiendo, descuento, otra cosa).
// - Los lunes: efectivo que le llegó (entregado por brigadas + pagos en efectivo
//   a ella) menos lo que ya tiene destino; si queda algo, le pregunta qué se hizo
//   (depósito, gasto del negocio, retiro personal, sigue en caja).
// Solo Diana y Víctor (Admin) ven el cuadre. DiMa lo usa para analizar fugas y
// "dinero bueno al malo"; las correcciones las aplica Diana con los botones.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { enviarRecibo, sheetsConfigurado } = require('./_sheets');
const { Anthropic } = require('@anthropic-ai/sdk');
const { telegramApi, enviarTelegram, enviarTelegramEquipo } = require('./_telegram');
const { totalDelEvento } = require('./_cargos');

const MODELO = 'claude-sonnet-5-5';
let clienteIA = null;
const ia = () => (clienteIA = clienteIA || new Anthropic());

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  COBROS: 'tblb8ADFukpm6nRZV',
  REPORTES: 'tbllUK2N9ZDv2Bpdt',
  GASTOS: 'tblfuEW0oiX4xTw7T',
  CAJA: 'tbl9UVlnxzfXscnW5',
  CLIENTES: 'tblgViisKQRG9TVjh',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
};
// El cuadre empieza aquí: antes no había cobros registrados y todo saldría "sin cuadrar".
const FECHA_INICIO = '2026-10-29';
const TOLERANCIA = 0.5;
const ESTADOS = { POR_ACLARAR: 'Por aclarar', CUADRADO: 'Cuadrado', DEBE: 'Debe', DESCUENTO: 'Descuento', OTRO: 'Otro' };
const FORMAS = { e: 'Efectivo', t: 'Transferencia', d: 'Depósito' };
const TIPOS_CAJA = { dep: 'Depósito al banco', gas: 'Gasto del negocio', ret: 'Retiro personal', caja: 'Sigue en caja', var: 'Varios' };
const MARCA_MONTO = '✍️ ¿Cuánto te pagaron y cómo? ';
const MARCA_OTRO = '❓ ¿Qué pasó con el dinero de ';
const MARCA_VARIOS = '💼 ¿Qué se hizo con el efectivo? ';
const ID = /^rec[A-Za-z0-9]{14}$/;
const ID_EN_TEXTO = /\((rec[A-Za-z0-9]{14})\)/;

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
const ahoraTexto = () => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date());
const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const redondo = (n) => Math.round(n * 100) / 100;
const porIds = (ids) => `OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`;
const esAdmin = (c) => c.rol === ROLES.ADMIN;

function monto(valor) {
  const n = Math.round(Number(String(valor == null ? '' : valor).replace(/[$,\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= 1000000 ? n : null;
}

// ---------- Cálculo ----------

// Dinero de un evento: contratado, cobrado por la brigada, pagado a Diana,
// descuento, saldo (lo que falta por cuadrar) y gastos ligados.
function dineroDelEvento(e, cobros, aprobados, gastos) {
  const f = e.fields;
  const suyos = cobros.filter(c => (c.fields.Evento || [])[0] === e.id);
  const brigada = suyos.filter(c => c.fields.Recibido_Por !== 'Diana').reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0);
  const brigadaSinAprobar = suyos.filter(c => c.fields.Recibido_Por !== 'Diana' && !aprobados.has((c.fields.Reporte || [])[0])).reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0);
  const diana = suyos.filter(c => c.fields.Recibido_Por === 'Diana').reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0);
  const contratado = totalDelEvento(f); // contratado + cargos extra (daños y faltantes)
  const descuento = Number(f.Descuento) || 0;
  const gastosEvento = gastos.filter(g => (g.fields.Evento_Relacionado || [])[0] === e.id).reduce((t, g) => t + (Number(g.fields.Monto) || 0), 0);
  return {
    id: e.id,
    folio: f.Folio_Evento || '',
    fecha: f.Fecha_Evento || '',
    hora: f.Hora_Inicio || '',
    negocio: f.Negocio || '',
    clienteId: (f.Cliente || [])[0] || '',
    brigadaId: (f.Brigada_Asignada || [])[0] || '',
    contratado,
    brigada: redondo(brigada),
    brigadaSinAprobar: redondo(brigadaSinAprobar),
    diana: redondo(diana),
    descuento,
    saldo: redondo(contratado - brigada - diana - descuento),
    gastos: redondo(gastosEvento),
    margen: redondo(contratado - descuento - gastosEvento),
    estado: f.Cuadre_Estado || '',
    preguntado: f.Cuadre_Preguntado || '',
    notas: f.Cuadre_Notas || '',
    cancelado: !!f.Cancelado,
  };
}

async function datosCuadre() {
  const hoy = hoyCuliacan();
  const desde = `NOT(IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${FECHA_INICIO}")))`;
  const [eventos, cobros, aprobados, gastos, caja, brigadas] = await Promise.all([
    todas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(`AND(OR({Autorizacion_Diana} = "SI", {Cancelado}), ${desde})`)}`),
    todas(`${TABLES.COBROS}?filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({Fecha}, DATETIME_PARSE("${FECHA_INICIO}")))`)}`),
    todas(`${TABLES.REPORTES}?filterByFormula=${encodeURIComponent('{Estado} = "Aprobado"')}&fields%5B%5D=Efectivo_Entregado&fields%5B%5D=Fecha`),
    todas(`${TABLES.GASTOS}?filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({Fecha}, DATETIME_PARSE("${FECHA_INICIO}")))`)}`),
    todas(`${TABLES.CAJA}`),
    todas(`${TABLES.BRIGADAS}?fields%5B%5D=Nombre_Brigada`),
  ]);
  const ok = new Set(aprobados.map(r => r.id));
  // Gastos que cuentan: capturados a mano o de reportes aprobados.
  const gastosValidos = gastos.filter(g => !(g.fields.Reporte || [])[0] || ok.has(g.fields.Reporte[0]));
  const lista = eventos.map(e => dineroDelEvento(e, cobros, ok, gastosValidos));
  const nombreBrigada = new Map(brigadas.map(b => [b.id, b.fields.Nombre_Brigada || '']));
  lista.forEach(e => { e.brigadaNombre = nombreBrigada.get(e.brigadaId) || ''; });
  return { hoy, eventos: lista, cobros, aprobados, ok, caja };
}

// Efectivo de Diana: lo que le entregaron las brigadas (reportes aprobados) y lo
// que le pagaron en efectivo, contra los destinos registrados.
function efectivoDe(d) {
  const entregado = d.aprobados.filter(r => (r.fields.Fecha || '') >= FECHA_INICIO).reduce((t, r) => t + (Number(r.fields.Efectivo_Entregado) || 0), 0);
  const pagadoEfectivo = d.cobros.filter(c => c.fields.Recibido_Por === 'Diana' && c.fields.Forma === 'Efectivo').reduce((t, c) => t + (Number(c.fields.Monto) || 0), 0);
  const destinos = {};
  for (const m of d.caja) {
    if (m.fields.Tipo === TIPOS_CAJA.caja) continue;
    destinos[m.fields.Tipo || 'Varios'] = (destinos[m.fields.Tipo || 'Varios'] || 0) + (Number(m.fields.Monto) || 0);
  }
  const conDestino = Object.values(destinos).reduce((t, v) => t + v, 0);
  // "Sigue en caja": vale la última declaración.
  const ultimaCaja = d.caja.filter(m => m.fields.Tipo === TIPOS_CAJA.caja).sort((a, b) => (b.fields.Fecha || '').localeCompare(a.fields.Fecha || '') || (b.createdTime || '').localeCompare(a.createdTime || ''))[0];
  const enCaja = ultimaCaja ? Number(ultimaCaja.fields.Monto) || 0 : 0;
  const entradas = entregado + pagadoEfectivo;
  return {
    entregadoBrigadas: redondo(entregado),
    pagadoEfectivo: redondo(pagadoEfectivo),
    entradas: redondo(entradas),
    destinos,
    enCaja: redondo(enCaja),
    sinDestino: redondo(Math.max(0, entradas - conDestino - enCaja)),
    excedente: redondo(Math.max(0, conDestino + enCaja - entradas)),
  };
}

async function nombresClientes(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const nombres = new Map();
  for (let i = 0; i < unicos.length; i += 50) {
    const lote = unicos.slice(i, i + 50);
    const data = await todas(`${TABLES.CLIENTES}?filterByFormula=${encodeURIComponent(porIds(lote))}&fields%5B%5D=Nombre`);
    data.forEach(r => nombres.set(r.id, r.fields.Nombre || ''));
  }
  return nombres;
}

// Todo lo que ve la sección "🔍 Cuadre" (solo Admin) y lo que recibe DiMa.
async function vistaCuadre() {
  const d = await datosCuadre();
  const nombres = await nombresClientes(d.eventos.map(e => e.clienteId));
  const conCliente = (e) => ({ ...e, cliente: nombres.get(e.clienteId) || '' });
  const pasados = d.eventos.filter(e => !e.cancelado && e.fecha < d.hoy);
  const porAclarar = pasados.filter(e => e.saldo > TOLERANCIA && ![ESTADOS.DEBE, ESTADOS.OTRO].includes(e.estado)).map(conCliente);
  const deben = d.eventos.filter(e => !e.cancelado && e.estado === ESTADOS.DEBE && e.saldo > TOLERANCIA).map(conCliente);
  const otros = d.eventos.filter(e => e.estado === ESTADOS.OTRO && e.saldo > TOLERANCIA).map(conCliente);
  const cobradoDeMas = d.eventos.filter(e => !e.cancelado && e.saldo < -TOLERANCIA).map(conCliente);
  const conPerdida = d.eventos.filter(e => !e.cancelado && e.gastos > 0 && e.margen < 0).map(conCliente);
  // Clientes: dónde se queda el dinero (adeudos, cancelaciones, margen).
  const porCliente = new Map();
  for (const e of d.eventos) {
    if (!e.clienteId) continue;
    const c = porCliente.get(e.clienteId) || { clienteId: e.clienteId, cliente: nombres.get(e.clienteId) || 'Sin nombre', eventos: 0, cancelados: 0, contratado: 0, pendiente: 0, margen: 0 };
    c.eventos++;
    if (e.cancelado) c.cancelados++;
    else {
      c.contratado += e.contratado;
      c.pendiente += Math.max(0, e.saldo);
      c.margen += e.margen;
    }
    porCliente.set(e.clienteId, c);
  }
  const clientes = [...porCliente.values()]
    .filter(c => c.pendiente > TOLERANCIA || c.cancelados || c.margen < 0)
    .sort((a, b) => b.pendiente - a.pendiente || b.cancelados - a.cancelados)
    .slice(0, 15);
  // Para el buenos días: eventos de hoy y mañana, y lo que falta por cobrar.
  const manana = new Date(`${d.hoy}T12:00:00Z`);
  manana.setUTCDate(manana.getUTCDate() + 1);
  const fechaManana = manana.toISOString().slice(0, 10);
  const vigentes = d.eventos.filter(e => !e.cancelado);
  const porHora = (a, b) => (a.hora || '').localeCompare(b.hora || '');
  const hoyEv = vigentes.filter(e => e.fecha === d.hoy).sort(porHora).map(conCliente);
  const mananaEv = vigentes.filter(e => e.fecha === fechaManana).sort(porHora).map(conCliente);
  const pendientes = vigentes.filter(e => e.saldo > TOLERANCIA && e.estado !== ESTADOS.OTRO);
  const porCobrar = { eventos: pendientes.length, total: redondo(pendientes.reduce((t, e) => t + e.saldo, 0)) };
  return { desde: FECHA_INICIO, porAclarar, deben, otros, cobradoDeMas, conPerdida, clientes, efectivo: efectivoDe(d), hoy: hoyEv, manana: mananaEv, porCobrar };
}

// Resumen para DiMa (solo Admin).
function cuadreParaDima(v) {
  const lineaEv = (e) => `${e.folio} (${e.fecha}${e.cliente ? ', ' + e.cliente : ''}): contratado ${pesos(e.contratado)}, cobró la brigada ${pesos(e.brigada)}, pagado a Diana ${pesos(e.diana)}, descuento ${pesos(e.descuento)}, falta ${pesos(e.saldo)}, gastos ${pesos(e.gastos)}, margen ${pesos(e.margen)}${e.notas ? ' · notas: ' + e.notas.split('\n').pop() : ''}`;
  const ef = v.efectivo;
  return [
    `El cuadre empieza el ${v.desde}; antes no hay cobros registrados.`,
    `POR ACLARAR (eventos que ya pasaron y no cuadran, Diana no ha dicho qué pasó): ${v.porAclarar.length ? '\n' + v.porAclarar.map(lineaEv).join('\n') : 'ninguno'}`,
    `CLIENTES QUE SIGUEN DEBIENDO: ${v.deben.length ? '\n' + v.deben.map(lineaEv).join('\n') : 'ninguno'}`,
    `EXPLICADOS COMO "OTRO": ${v.otros.length ? '\n' + v.otros.map(lineaEv).join('\n') : 'ninguno'}`,
    `COBRADO DE MÁS (entró más de lo contratado, revisar si es error de captura): ${v.cobradoDeMas.length ? '\n' + v.cobradoDeMas.map(lineaEv).join('\n') : 'ninguno'}`,
    `EVENTOS CON PÉRDIDA (gastos mayores que lo contratado): ${v.conPerdida.length ? '\n' + v.conPerdida.map(lineaEv).join('\n') : 'ninguno'}`,
    `CLIENTES A VIGILAR (adeudos, cancelaciones o margen negativo): ${v.clientes.length ? '\n' + v.clientes.map(c => `${c.cliente}: ${c.eventos} eventos, ${c.cancelados} cancelados, contratado ${pesos(c.contratado)}, pendiente ${pesos(c.pendiente)}, margen ${pesos(c.margen)}`).join('\n') : 'ninguno'}`,
    `EFECTIVO DE DIANA: le entregaron las brigadas ${pesos(ef.entregadoBrigadas)}, le pagaron en efectivo ${pesos(ef.pagadoEfectivo)}; destinos registrados ${Object.entries(ef.destinos).map(([k, x]) => `${k} ${pesos(x)}`).join(', ') || 'ninguno'}; declarado en caja ${pesos(ef.enCaja)}; SIN DESTINO ${pesos(ef.sinDestino)}${ef.excedente ? `; OJO: hay ${pesos(ef.excedente)} más registrado como destino de lo que entró` : ''}.`,
  ].join('\n\n');
}

// ---------- Respuestas de Diana (dashboard y Telegram) ----------

async function anotar(eventoId, f, campos, linea) {
  await airtable(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: eventoId, fields: { ...campos, Cuadre_Notas: f.Cuadre_Notas ? `${f.Cuadre_Notas}\n${linea}` : linea } }] }),
  });
}

async function saldoActual(eventoId) {
  const e = await airtable(`${TABLES.EVENTOS}/${eventoId}`);
  const cobroIds = e.fields.COBROS || [];
  const cobros = cobroIds.length ? await todas(`${TABLES.COBROS}?filterByFormula=${encodeURIComponent(porIds(cobroIds))}`) : [];
  return { e, dinero: dineroDelEvento(e, cobros, new Set(), []) };
}

// tipo: pago | debe | descuento | otro. Devuelve { ok, texto } o { error }.
async function aclarar(colaborador, { eventoId, tipo, monto: montoTexto, forma, nota }) {
  if (!esAdmin(colaborador)) return { error: 'Solo Diana y Víctor cuadran el dinero.', codigo: 403 };
  if (!ID.test(eventoId || '')) return { error: 'Parámetros inválidos' };
  const { e, dinero } = await saldoActual(eventoId);
  const f = e.fields;
  const quien = colaborador.nombre;
  if (tipo === 'pago') {
    const valor = montoTexto === 'todo' ? (dinero.saldo > 0 ? dinero.saldo : null) : monto(montoTexto);
    if (!valor) return { error: 'Escribe cuánto te pagaron.' };
    if (!Object.values(FORMAS).includes(forma)) return { error: 'Elige si fue efectivo, transferencia o depósito.' };
    await airtable(TABLES.COBROS, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: {
        Concepto: `${f.Folio_Evento || ''} · pago a ${quien}`, Monto: valor, Forma: forma, Fecha: hoyCuliacan(),
        ...(f.Negocio === 'Divanna Eventos' || f.Negocio === 'El Vaso Maiz' ? { Negocio: f.Negocio } : {}),
        Evento: [eventoId], Recibido_Por: 'Diana', Reportado_Por: [colaborador.id],
      } }] }),
    });
    const saldo = redondo(dinero.saldo - valor);
    const recibo = sheetsConfigurado() ? await enviarRecibo(eventoId, `pago de ${pesos(valor)}`) : null;
    await anotar(eventoId, f, { Cuadre_Estado: saldo > TOLERANCIA ? ESTADOS.POR_ACLARAR : ESTADOS.CUADRADO }, `[${ahoraTexto()}] ${quien}: le pagaron ${pesos(valor)} (${forma}).${saldo > TOLERANCIA ? ` Falta ${pesos(saldo)}.` : saldo < -TOLERANCIA ? ` Ojo: quedó ${pesos(-saldo)} de más.` : ' Cuadrado.'}`);
    return { ok: true, texto: `✅ Anotado: ${pesos(valor)} en ${forma.toLowerCase()} de ${f.Folio_Evento}.${saldo > TOLERANCIA ? ` Todavía falta ${pesos(saldo)}.` : saldo < -TOLERANCIA ? ` Ojo: quedó ${pesos(-saldo)} de más que lo contratado.` : ' Ya cuadra.'}${recibo ? (recibo.ok ? ' 🧾 Te mandé el recibo actualizado.' : ` (El recibo no salió: ${recibo.error})`) : ''}` };
  }
  if (tipo === 'debe') {
    await anotar(eventoId, f, { Cuadre_Estado: ESTADOS.DEBE }, `[${ahoraTexto()}] ${quien}: el cliente sigue debiendo ${pesos(dinero.saldo)}.`);
    return { ok: true, texto: `⏳ Anotado: ${f.Folio_Evento} sigue debiendo ${pesos(dinero.saldo)}. Queda en "por cobrar".` };
  }
  if (tipo === 'descuento') {
    if (!(dinero.saldo > TOLERANCIA)) return { error: 'Este evento no tiene saldo pendiente.' };
    await anotar(eventoId, f, { Cuadre_Estado: ESTADOS.CUADRADO, Descuento: redondo(dinero.descuento + dinero.saldo) }, `[${ahoraTexto()}] ${quien}: descuento o cortesía de ${pesos(dinero.saldo)}.`);
    return { ok: true, texto: `🎁 Anotado: descuento de ${pesos(dinero.saldo)} en ${f.Folio_Evento}. Ya cuadra.` };
  }
  if (tipo === 'otro') {
    const texto = String(nota || '').trim().slice(0, 500);
    if (!texto) return { error: 'Escribe qué pasó con ese dinero.' };
    await anotar(eventoId, f, { Cuadre_Estado: ESTADOS.OTRO }, `[${ahoraTexto()}] ${quien}: ${texto}`);
    return { ok: true, texto: `📝 Anotado en ${f.Folio_Evento}: ${texto}` };
  }
  return { error: 'Respuesta inválida' };
}

// Destino del efectivo sin destino (se asigna todo lo pendiente). tipo: clave de TIPOS_CAJA.
async function destinoCaja(colaborador, { tipo, nota, monto: montoTexto }) {
  if (!esAdmin(colaborador)) return { error: 'Solo Diana y Víctor.', codigo: 403 };
  const nombreTipo = TIPOS_CAJA[tipo];
  if (!nombreTipo) return { error: 'Destino inválido' };
  const ef = efectivoDe(await datosCuadre());
  const valor = montoTexto ? monto(montoTexto) : (tipo === 'caja' ? redondo(ef.sinDestino + ef.enCaja) : ef.sinDestino);
  if (!valor) return { error: 'No hay efectivo sin destino.' };
  const texto = String(nota || '').trim().slice(0, 300);
  if (tipo === 'var' && !texto) return { error: 'Escribe qué se hizo con el efectivo.' };
  await airtable(TABLES.CAJA, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: { Concepto: texto || nombreTipo, Fecha: hoyCuliacan(), Monto: valor, Tipo: nombreTipo, Registrado_Por: colaborador.nombre } }] }),
  });
  return { ok: true, texto: tipo === 'caja' ? `💼 Anotado: tienes ${pesos(valor)} en caja.` : `✅ Anotado: ${pesos(valor)} → ${nombreTipo}${texto ? ' (' + texto + ')' : ''}.` };
}

// ---------- Preguntas automáticas (cron de las 8:00) ----------

function botonesEvento(id) {
  return [
    [{ texto: '💵 Me pagaron todo en efectivo', dato: `cd:pe:${id}` }],
    [{ texto: '🏦 Todo por transferencia', dato: `cd:pt:${id}` }, { texto: '✍️ Otra cantidad', dato: `cd:pm:${id}` }],
    [{ texto: '⏳ Sigue debiendo', dato: `cd:d:${id}` }, { texto: '🎁 Descuento o cortesía', dato: `cd:x:${id}` }],
    [{ texto: '❓ Otra cosa', dato: `cd:o:${id}` }],
  ];
}

const botonesCaja = () => [
  [{ texto: '🏦 Lo deposité', dato: 'cj:dep' }, { texto: '🧾 Gasto del negocio', dato: 'cj:gas' }],
  [{ texto: '👛 Retiro personal', dato: 'cj:ret' }, { texto: '💼 Sigue en caja', dato: 'cj:caja' }],
  [{ texto: '✍️ Repartido / otra cosa', dato: 'cj:var' }],
];

// ---------- Tono (pedido de Víctor 2026-10-29) ----------
// DiMa le escribe a Diana como una amiga cercana: primero rompe el hielo, luego
// se pone seria sin perder el cariño, y ahí van los datos y los botones. El
// saludo lo escribe la IA SIN cifras ni folios (los números siempre los pone el
// sistema); si falla o se sale de eso, se usa uno de los saludos de abajo.
// Nunca se acusa a la brigada: casi siempre el dinero llegó y no se registró.
const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || '';

const SALUDOS_RESPALDO = [
  (n, k) => `¡Buenos días, ${n}! ☀️ Espero que hayas descansado rico y que hoy sea un gran día. Yo ya estoy lista para seguir trabajando contigo.\n\nOye, te platico: revisé las cuentas de ayer y no me cuadraron ${k === 1 ? 'en un evento' : `en ${k} eventos`}. Nada grave, pero conviene dejarlo claro hoy para llevar la administración sana y que no se nos escape nada. Te paso el detalle 👇`,
  (n, k) => `Hola ${n} 💜 ¿cómo amaneciste? Te mando un abrazo para empezar el día con todo.\n\nAhora sí, en modo serio pero con cariño: las cuentas de ayer no me cerraron ${k === 1 ? 'en un evento' : `en ${k} eventos`}. Ayúdame a aclararlo para que no haya fugas; te dejo cada uno abajo.`,
  (n, k) => `¡Hola, ${n}! 🌸 Que tengas un día precioso. Aquí sigo al pendiente de todo.\n\nTe cuento: al cuadrar lo de ayer me quedaron ${k === 1 ? 'un evento sin cerrar' : `${k} eventos sin cerrar`} en el dinero. Con dos toques lo dejamos listo y la administración queda sana 👇`,
];

async function saludoDelDia(nombre, cuantos) {
  try {
    const r = await ia().beta.messages.create({
      model: MODELO,
      max_tokens: 400,
      output_config: { effort: 'low' },
      system: 'Eres DiMa, la asistente de Divanna Eventos y El Vaso Maíz (Culiacán). Escribes como una amiga cercana, cálida y natural, en español mexicano, sin markdown.',
      messages: [{ role: 'user', content:
        `Escríbele a ${nombre} un mensaje de buenos días por Telegram. Dos partes, en 3 a 5 frases en total:\n` +
        `1) Rompe el hielo con cariño (deséale un gran día, dile que estás lista para seguir trabajando). Varía la forma, que no suene a plantilla.\n` +
        (cuantos
          ? `2) Ponte seria sin perder el tono amistoso: dile que al revisar las cuentas de ayer no cuadraron ${cuantos === 1 ? 'en un evento' : `en ${cuantos} eventos`}, que llevar la administración sana evita fugas y que enseguida le pasas el detalle.\n`
          : '2) Dile que enseguida le pasas el resumen del día (eventos y cuentas).\n') +
        'Reglas: NO pongas montos, cifras, folios, nombres de clientes ni de brigadas (el detalle va aparte). No culpes a nadie. Máximo 450 caracteres. Uno o dos emojis como mucho.' }],
    });
    const texto = ((r && r.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    // Solo se usa si respetó las reglas: sin cifras ni folios y corto.
    if (texto && texto.length <= 600 && !/\$|\d{2,}|EVT-/i.test(texto)) return texto;
  } catch (err) {
    console.error('DiMa: no se pudo escribir el saludo del cuadre:', err.message);
  }
  return cuantos ? azar(SALUDOS_RESPALDO)(nombre, cuantos) : azar(SALUDOS_SIN_PENDIENTES)(nombre);
}

const SALUDOS_SIN_PENDIENTES = [
  (n) => `¡Buenos días, ${n}! ☀️ Que hoy sea un gran día. Aquí estoy lista para seguir trabajando contigo; te paso el resumen del día 👇`,
  (n) => `Hola ${n} 💜 ¿cómo amaneciste? Te mando un abrazo para empezar con todo. Va el resumen de hoy 👇`,
  (n) => `¡Hola, ${n}! 🌸 Que tengas un día precioso. Aquí sigo al pendiente de todo; te dejo cómo vamos 👇`,
];

// Resumen del buenos días (los números los pone el sistema, no DiMa).
function textoResumen(v, cuantos) {
  const linea = (e) => `• ${e.hora ? e.hora + ' · ' : ''}${e.folio}${e.cliente ? ' · ' + e.cliente : ''}${e.negocio ? ' (' + e.negocio + ')' : ''}${e.saldo > TOLERANCIA ? ' · falta ' + pesos(e.saldo) : ''}`;
  const bloque = (titulo, lista) => lista.length ? `${titulo} (${lista.length}):\n${lista.map(linea).join('\n')}` : `${titulo}: sin eventos.`;
  return [
    '📋 Resumen del día',
    bloque('Hoy', v.hoy),
    bloque('Mañana', v.manana),
    v.porCobrar.eventos ? `💰 Falta por cobrar: ${pesos(v.porCobrar.total)} en ${v.porCobrar.eventos === 1 ? '1 evento' : v.porCobrar.eventos + ' eventos'}.` : '💰 No hay nada pendiente por cobrar.',
    cuantos ? `🔍 ${cuantos === 1 ? 'Un evento no cuadra' : cuantos + ' eventos no cuadran'}; te los paso abajo.` : '✅ Las cuentas cuadran.',
  ].join('\n\n');
}

// Detalle de un evento, en plática (los números los pone el sistema).
function textoEvento(e) {
  const quien = e.cliente ? `el evento de ${e.cliente} (${e.folio})` : `el evento ${e.folio}`;
  const brigada = e.brigadaNombre || 'la brigada';
  const reporto = e.brigada > 0
    ? `${brigada} reportó ${pesos(e.brigada)}${e.brigadaSinAprobar ? ` (${pesos(e.brigadaSinAprobar)} todavía sin aprobar)` : ''}`
    : `${brigada} no reportó ningún cobro`;
  const yaTe = e.diana ? ` y tú ya me dijiste que te pagaron ${pesos(e.diana)}` : '';
  const pregunta = e.brigada > 0
    ? azar(['¿Los muchachos te lo pagaron directo o te entregaron el efectivo?', '¿Te lo entregaron a ti, o el cliente todavía lo debe?', '¿Ese dinero te llegó a ti o quedó pendiente?'])
    : azar(['¿El cliente te pagó directo a ti, o sigue pendiente?', '¿Te depositaron a ti, o todavía lo deben?']);
  return `🧾 En ${quien}, del ${e.fecha}, el contrato era de ${pesos(e.contratado)}; ${reporto}${yaTe}. Me faltan ${pesos(e.saldo)}.\n${pregunta}`;
}

// Diana y Víctor con Telegram (cada quien recibe su versión con su nombre).
async function adminsConTelegram() {
  const formula = encodeURIComponent(`AND({Activo}, {Rol} = "${ROLES.ADMIN}", {Telegram_Chat_ID} != "")`);
  return (await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`)).records
    .map(r => ({ id: r.id, nombre: primerNombre(r.fields.Nombre), chatId: r.fields.Telegram_Chat_ID }));
}

// Buenos días diario a Diana y Víctor: saludo + resumen (eventos de hoy y
// mañana, lo que falta por cobrar) y, si hay eventos que ya pasaron, no
// cuadran y no se han preguntado, un mensaje por evento con botones.
async function preguntasDelDia() {
  const v = await vistaCuadre();
  const nuevos = v.porAclarar.filter(e => !e.preguntado && !e.estado).slice(0, 15);
  const admins = await adminsConTelegram();
  if (!admins.length) console.error('Buenos días: ningún Admin activo tiene Telegram vinculado');
  const entregados = new Set();
  let saludados = 0;
  for (const a of admins) {
    const hola = await enviarTelegram(a.chatId, await saludoDelDia(a.nombre, nuevos.length));
    if (!hola.ok) { console.error('Buenos días: no se pudo saludar a', a.nombre, hola.status); continue; }
    saludados++;
    await enviarTelegram(a.chatId, textoResumen(v, nuevos.length));
    for (const e of nuevos) {
      const r = await enviarTelegram(a.chatId, textoEvento(e), botonesEvento(e.id));
      if (r.ok) entregados.add(e.id);
    }
  }
  for (const e of nuevos.filter(x => entregados.has(x.id))) {
    await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: e.id, fields: { Cuadre_Preguntado: hoyCuliacan(), Cuadre_Estado: ESTADOS.POR_ACLARAR } }] }) });
  }
  return { pendientes: v.porAclarar.length, preguntados: entregados.size, saludados };
}

// Lunes: efectivo sin destino.
async function preguntaCaja() {
  const ef = efectivoDe(await datosCuadre());
  if (ef.sinDestino <= TOLERANCIA) return { sinDestino: 0, enviado: false };
  let enviado = false;
  for (const a of await adminsConTelegram()) {
    const texto = [
      azar([`¡Feliz inicio de semana, ${a.nombre}! 💜`, `Buenos días, ${a.nombre} ☀️ arrancamos semana.`, `Hola ${a.nombre}, ¡a darle con todo esta semana! 🌸`]),
      `Para cerrar bien la anterior: te llegaron ${pesos(ef.entradas)} en efectivo (${pesos(ef.entregadoBrigadas)} que te entregaron las brigadas y ${pesos(ef.pagadoEfectivo)} que te pagaron directo)${ef.enCaja ? ` y tenías ${pesos(ef.enCaja)} en caja` : ''}, y me quedan ${pesos(ef.sinDestino)} sin destino.`,
      'El dinero es tuyo y tú decides qué hacer con él; solo dime a dónde fue para que todo cuadre 👇',
    ].join('\n');
    const r = await enviarTelegram(a.chatId, texto, botonesCaja());
    enviado = enviado || r.ok;
  }
  return { sinDestino: ef.sinDestino, enviado };
}

// Botones cd:<acción>:<evento> y cj:<destino>. Devuelve { aviso, alerta, textoFinal }.
async function botonCuadre(chatId, colaborador, tipo, accion, id) {
  if (!esAdmin(colaborador)) return { aviso: 'Esto es solo para Diana y Víctor.', alerta: true };
  if (tipo === 'cj') {
    if (accion === 'var') {
      await telegramApi('sendMessage', { chat_id: chatId, text: `${MARCA_VARIOS}Escribe qué se hizo (ej. deposité 3000 y pagué la gasolina con 500):`, reply_markup: { force_reply: true } });
      return { aviso: 'Escribe qué se hizo' };
    }
    const r = await destinoCaja(colaborador, { tipo: accion });
    return r.error ? { aviso: r.error, alerta: true } : { aviso: 'Anotado', textoFinal: r.texto };
  }
  if (!ID.test(id || '')) return { aviso: '' };
  if (accion === 'pm' || accion === 'o') {
    const e = await airtable(`${TABLES.EVENTOS}/${id}`);
    const marca = accion === 'pm' ? `${MARCA_MONTO}${e.fields.Folio_Evento || ''} (${id})` : `${MARCA_OTRO}${e.fields.Folio_Evento || ''} (${id})`;
    await telegramApi('sendMessage', { chat_id: chatId, text: `${marca}\n${accion === 'pm' ? 'Escribe el monto y la forma, por ejemplo: 2000 efectivo' : 'Escribe qué pasó con ese dinero:'}`, reply_markup: { force_reply: true } });
    return { aviso: 'Escríbelo' };
  }
  const opciones = { pe: { tipo: 'pago', monto: 'todo', forma: FORMAS.e }, pt: { tipo: 'pago', monto: 'todo', forma: FORMAS.t }, d: { tipo: 'debe' }, x: { tipo: 'descuento' } };
  if (!opciones[accion]) return { aviso: '' };
  const r = await aclarar(colaborador, { eventoId: id, ...opciones[accion] });
  return r.error ? { aviso: r.error, alerta: true } : { aviso: 'Anotado', textoFinal: r.texto };
}

function esRespuestaCuadre(mensaje) {
  const previo = mensaje.reply_to_message;
  const t = String((previo && previo.text) || '');
  return !!(previo && previo.from && previo.from.is_bot && (t.startsWith(MARCA_MONTO) || t.startsWith(MARCA_OTRO) || t.startsWith(MARCA_VARIOS)));
}

// "2000 efectivo" / texto libre escrito encima de la pregunta.
async function atenderRespuestaCuadre(mensaje, colaborador) {
  if (!esAdmin(colaborador)) return 'Esto es solo para Diana y Víctor.';
  const previo = String(mensaje.reply_to_message.text || '');
  const texto = String(mensaje.text || '').trim();
  if (previo.startsWith(MARCA_VARIOS)) {
    const r = await destinoCaja(colaborador, { tipo: 'var', nota: texto });
    return r.error || r.texto;
  }
  const id = (previo.match(ID_EN_TEXTO) || [])[1];
  if (!id) return null;
  if (previo.startsWith(MARCA_OTRO)) {
    const r = await aclarar(colaborador, { eventoId: id, tipo: 'otro', nota: texto });
    return r.error || r.texto;
  }
  const m = /([\d.,$\s]+)\s*(efectivo|transferencia|transf|dep[oó]sito)?/i.exec(texto);
  const forma = !m || !m[2] ? null : /^ef/i.test(m[2]) ? FORMAS.e : /^tr/i.test(m[2]) ? FORMAS.t : FORMAS.d;
  if (!m || !monto(m[1])) return 'No entendí el monto. Escríbelo así: 2000 efectivo';
  if (!forma) return 'Dime también la forma: efectivo, transferencia o depósito. Ejemplo: 2000 transferencia';
  const r = await aclarar(colaborador, { eventoId: id, tipo: 'pago', monto: m[1], forma });
  return r.error || r.texto;
}

module.exports = {
  FECHA_INICIO,
  ESTADOS,
  TIPOS_CAJA,
  dineroDelEvento,
  vistaCuadre,
  cuadreParaDima,
  aclarar,
  destinoCaja,
  preguntasDelDia,
  preguntaCaja,
  botonCuadre,
  esRespuestaCuadre,
  atenderRespuestaCuadre,
};
