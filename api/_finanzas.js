// api/_finanzas.js
// Reporte financiero del día (fase 3, decisión de Víctor 2026-10-29). Cada
// brigada (líder) o encargada lo hace al final del día desde la app:
// - gastos con foto del ticket y si se pagaron con dinero del negocio o propio
//   (el propio queda como reembolso pendiente) -> tabla GASTOS;
// - cobros recibidos en sus eventos (efectivo, transferencia, depósito) con
//   foto del comprobante -> tabla COBROS;
// - efectivo entregado a Diana e insumos usados o que sobraron -> REPORTES_DIA.
// Diana lo aprueba o pide aclaración en el dashboard; solo lo aprobado cuenta
// en el balance. Quién ve montos: Diana y Víctor todo; la gerente de El Vaso
// Maíz todo lo de El Vaso Maíz; quien reporta, lo suyo.
// Estados: Abierto (se está llenando) -> Enviado -> Aprobado, o Aclaración
// (Diana pide corregir; se puede editar y volver a enviar). Aprobado ya no cambia.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { enviarTelegram, enviarTelegramEquipo } = require('./_telegram');
const { enviarPushEquipo } = require('./_push');
const { alcanceDe } = require('./_eventos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  REPORTES: 'tbllUK2N9ZDv2Bpdt',
  COBROS: 'tblb8ADFukpm6nRZV',
  GASTOS: 'tblfuEW0oiX4xTw7T',
  EVENTOS: 'tblzLAin65BZPP2c6',
};
const ESTADOS = { ABIERTO: 'Abierto', ENVIADO: 'Enviado', ACLARACION: 'Aclaración', APROBADO: 'Aprobado' };
const NEGOCIOS = { DV: 'Divanna Eventos', VM: 'El Vaso Maiz', AMBOS: 'Ambos' };
const CATEGORIAS = ['Combustible', 'Inventario', 'Brigada', 'Nomina', 'Otros'];
const PAGADO_CON = ['Dinero del negocio', 'Dinero propio'];
const FORMAS = ['Efectivo', 'Transferencia', 'Depósito'];
const MAX_MONTO = 1000000;
const MAX_FOTO_BYTES = 3 * 1024 * 1024;
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const DIAS_HISTORIAL = 14;

const ID = /^rec[A-Za-z0-9]{14}$/;
const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');

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

function hoyCuliacan() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
}
function sumarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const ahoraTexto = () => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date());
const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

function monto(valor) {
  const n = Math.round(Number(String(valor == null ? '' : valor).replace(/[$,\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= MAX_MONTO ? n : null;
}

const puedeReportar = (c) => c.rol === ROLES.LIDER || c.rol === ROLES.ENCARGADA;
const veVasoMaiz = (c) => c.rol === ROLES.ADMIN || !!c.gerente;

// ---------- Lectura ----------

function aGasto(r) {
  const f = r.fields || {};
  const foto = (f.Attachments || [])[0];
  return {
    id: r.id,
    concepto: f.Concepto || '',
    monto: f.Monto || 0,
    categoria: f.Categoria || '',
    negocio: f.Negocio || '',
    pagadoCon: f.Pagado_Con || '',
    reembolsado: !!f.Reembolsado,
    eventoId: (f.Evento_Relacionado || [])[0] || '',
    reporteId: (f.Reporte || [])[0] || '',
    reportadoPor: (f.Reportado_Por || [])[0] || '',
    fecha: f.Fecha || '',
    foto: foto ? { url: foto.url, mini: foto.thumbnails && foto.thumbnails.small ? foto.thumbnails.small.url : foto.url } : null,
  };
}

function aCobro(r) {
  const f = r.fields || {};
  const foto = (f.Comprobante || [])[0];
  return {
    id: r.id,
    concepto: f.Concepto || '',
    monto: f.Monto || 0,
    forma: f.Forma || '',
    negocio: f.Negocio || '',
    eventoId: (f.Evento || [])[0] || '',
    reporteId: (f.Reporte || [])[0] || '',
    fecha: f.Fecha || '',
    foto: foto ? { url: foto.url, mini: foto.thumbnails && foto.thumbnails.small ? foto.thumbnails.small.url : foto.url } : null,
  };
}

function aReporte(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    fecha: f.Fecha || '',
    colaboradorId: (f.Colaborador || [])[0] || '',
    nombre: f.Nombre || '',
    negocio: f.Negocio || '',
    estado: f.Estado || ESTADOS.ABIERTO,
    eventoIds: f.Eventos || [],
    efectivoEntregado: f.Efectivo_Entregado || 0,
    insumos: f.Insumos || '',
    notas: f.Notas || '',
    revision: f.Revision || '',
    enviadoHora: f.Enviado_Hora || '',
    totalGastos: f.Total_Gastos || 0,
    totalCobros: f.Total_Cobros || 0,
    reembolsoPendiente: f.Reembolso_Pendiente || 0,
    gastoIds: f.GASTOS || [],
    cobroIds: f.COBROS || [],
  };
}

const porIds = (ids) => `OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`;

// Gastos y cobros de una lista de reportes: { gastos: Map(reporteId -> []), cobros: Map }.
async function detalleDe(reportes) {
  const ids = reportes.map(r => r.id);
  const gastos = new Map(ids.map(id => [id, []]));
  const cobros = new Map(ids.map(id => [id, []]));
  if (!ids.length) return { gastos, cobros };
  // Se busca por el vínculo inverso del reporte (IDs), nunca con ARRAYJOIN (devuelve nombres).
  const gastoIds = reportes.flatMap(r => r.gastoIds);
  const cobroIds = reportes.flatMap(r => r.cobroIds);
  const [g, c] = await Promise.all([
    gastoIds.length ? todas(`${TABLES.GASTOS}?filterByFormula=${encodeURIComponent(porIds(gastoIds))}`) : [],
    cobroIds.length ? todas(`${TABLES.COBROS}?filterByFormula=${encodeURIComponent(porIds(cobroIds))}`) : [],
  ]);
  g.map(aGasto).forEach(x => { if (gastos.has(x.reporteId)) gastos.get(x.reporteId).push(x); });
  c.map(aCobro).forEach(x => { if (cobros.has(x.reporteId)) cobros.get(x.reporteId).push(x); });
  return { gastos, cobros };
}

async function reporteDe(colaboradorId, fecha) {
  const formula = `DATESTR({Fecha}) = "${fecha}"`;
  const registros = await todas(`${TABLES.REPORTES}?filterByFormula=${encodeURIComponent(formula)}`);
  // El vínculo se compara por ID en JS (ARRAYJOIN de un vínculo devuelve el nombre).
  const r = registros.find(x => (x.fields.Colaborador || [])[0] === colaboradorId);
  return r ? aReporte(r) : null;
}

// Eventos de quien reporta en esa fecha (también los ya cerrados).
async function eventosDelDia(colaborador, fecha) {
  const { eventoIds } = await alcanceDe(colaborador);
  if (!eventoIds || !eventoIds.length) return [];
  const formula = `AND(DATESTR({Fecha_Evento}) = "${fecha}", ${porIds(eventoIds)})`;
  const data = await todas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}`);
  return data.map(r => {
    const vm = r.fields.Negocio === NEGOCIOS.VM || Number(r.fields.Piezas_Vaso_Maiz) > 0;
    return {
      id: r.id,
      folio: r.fields.Folio_Evento || '',
      ubicacion: r.fields.Ubicacion || '',
      negocio: vm && r.fields.Negocio !== NEGOCIOS.DV ? NEGOCIOS.VM : (r.fields.Negocio || NEGOCIOS.DV),
      montoAdeudado: r.fields.Monto_Adeudado || null,
      estatusPago: r.fields.Estatus_Pago || '',
    };
  });
}

// Negocio del reporte según los eventos del día (o el puesto si no tuvo eventos).
function negocioDe(colaborador, eventos) {
  const set = new Set(eventos.map(e => e.negocio));
  if (set.size > 1) return NEGOCIOS.AMBOS;
  if (set.size === 1) return [...set][0];
  return colaborador.gerente || colaborador.rol === ROLES.ENCARGADA ? NEGOCIOS.VM : NEGOCIOS.DV;
}

// La gerente ve de los reportes "Ambos" solo lo de El Vaso Maíz.
function filtrarParaGerente(reporte, gastos, cobros) {
  const gs = gastos.filter(g => g.negocio === NEGOCIOS.VM);
  const cs = cobros.filter(c => c.negocio === NEGOCIOS.VM);
  if (reporte.negocio === NEGOCIOS.VM) return { reporte, gastos, cobros };
  return {
    reporte: { ...reporte, totalGastos: suma(gs), totalCobros: suma(cs), reembolsoPendiente: suma(gs.filter(g => g.pagadoCon === 'Dinero propio' && !g.reembolsado)), soloVasoMaiz: true },
    gastos: gs,
    cobros: cs,
  };
}

const suma = (xs) => Math.round(xs.reduce((t, x) => t + (Number(x.monto) || 0), 0) * 100) / 100;

async function nombresColaboradores(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  const data = await todas(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(porIds(unicos))}`);
  return new Map(data.map(r => [r.id, r.fields.Nombre || '']));
}

// Lo que ve la app/dashboard. fecha: día del reporte propio.
async function vista(colaborador, fecha) {
  const salida = { fecha, puedeReportar: puedeReportar(colaborador), categorias: CATEGORIAS, pagadoCon: PAGADO_CON, formas: FORMAS };
  if (salida.puedeReportar) {
    const [mio, eventos, historial] = await Promise.all([
      reporteDe(colaborador.id, fecha),
      eventosDelDia(colaborador, fecha),
      todas(`${TABLES.REPORTES}?filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({Fecha}, DATETIME_PARSE("${sumarDias(hoyCuliacan(), -DIAS_HISTORIAL)}")))`)}`),
    ]);
    const detalle = await detalleDe(mio ? [mio] : []);
    salida.eventos = eventos;
    salida.negocios = eventos.length ? [...new Set(eventos.map(e => e.negocio))] : [negocioDe(colaborador, [])];
    salida.miReporte = mio ? { ...mio, gastos: detalle.gastos.get(mio.id), cobros: detalle.cobros.get(mio.id) } : null;
    salida.misReportes = historial.map(aReporte).filter(r => r.colaboradorId === colaborador.id)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map(r => ({ id: r.id, fecha: r.fecha, estado: r.estado, totalGastos: r.totalGastos, totalCobros: r.totalCobros, reembolsoPendiente: r.reembolsoPendiente }));
  }
  if (veVasoMaiz(colaborador)) salida.revision = await paraRevision(colaborador);
  return salida;
}

// Reportes enviados / en aclaración y los aprobados de los últimos días, más
// reembolsos pendientes. Admin: todos. Gerente: lo de El Vaso Maíz.
async function paraRevision(colaborador) {
  const desde = sumarDias(hoyCuliacan(), -DIAS_HISTORIAL);
  const formula = `AND({Estado} != "${ESTADOS.ABIERTO}", NOT(IS_BEFORE({Fecha}, DATETIME_PARSE("${desde}"))))`;
  let reportes = (await todas(`${TABLES.REPORTES}?filterByFormula=${encodeURIComponent(formula)}`)).map(aReporte);
  const esAdmin = colaborador.rol === ROLES.ADMIN;
  if (!esAdmin) reportes = reportes.filter(r => r.negocio === NEGOCIOS.VM || r.negocio === NEGOCIOS.AMBOS);
  const detalle = await detalleDe(reportes);
  const nombres = await nombresColaboradores(reportes.map(r => r.colaboradorId));
  const lista = reportes.map(r => {
    const base = esAdmin ? { reporte: r, gastos: detalle.gastos.get(r.id), cobros: detalle.cobros.get(r.id) }
      : filtrarParaGerente(r, detalle.gastos.get(r.id), detalle.cobros.get(r.id));
    return { ...base.reporte, quien: nombres.get(r.colaboradorId) || '', gastos: base.gastos, cobros: base.cobros };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.quien.localeCompare(b.quien, 'es'));
  const reembolsos = lista.filter(r => r.estado === ESTADOS.APROBADO)
    .flatMap(r => r.gastos.filter(g => g.pagadoCon === 'Dinero propio' && !g.reembolsado).map(g => ({ ...g, quien: r.quien, fechaReporte: r.fecha })));
  return { pendientes: lista.filter(r => r.estado !== ESTADOS.APROBADO), aprobados: lista.filter(r => r.estado === ESTADOS.APROBADO), reembolsos, puedeAprobar: esAdmin };
}

// ---------- Escritura (quien reporta) ----------

// Devuelve el reporte del día listo para editar (lo crea si no existe) o { error }.
async function reporteEditable(colaborador, fecha, eventos) {
  let r = await reporteDe(colaborador.id, fecha);
  if (r && r.estado === ESTADOS.APROBADO) return { error: 'Este reporte ya fue aprobado por Diana; ya no se puede cambiar.' };
  if (!r) {
    const creado = await airtable(TABLES.REPORTES, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: {
        Nombre: `${fecha} · ${colaborador.nombre}`,
        Fecha: fecha,
        Colaborador: [colaborador.id],
        ...(colaborador.brigadaId ? { Brigada: [colaborador.brigadaId] } : {}),
        Negocio: negocioDe(colaborador, eventos),
        Eventos: eventos.map(e => e.id),
        Estado: ESTADOS.ABIERTO,
      } }] }),
    });
    r = aReporte(creado.records[0]);
  } else if (r.estado === ESTADOS.ENVIADO) {
    // Si cambia algo después de enviarlo, hay que volver a enviarlo.
    await airtable(TABLES.REPORTES, { method: 'PATCH', body: JSON.stringify({ records: [{ id: r.id, fields: { Estado: ESTADOS.ABIERTO } }] }) });
    r.estado = ESTADOS.ABIERTO;
  }
  return { reporte: r };
}

function validarFoto(foto) {
  if (!foto) return { ok: true, foto: null };
  const tipo = String(foto.tipo || '');
  const base64 = String(foto.base64 || '');
  if (!TIPOS_FOTO.includes(tipo) || !/^[A-Za-z0-9+/=]+$/.test(base64)) return { ok: false, error: 'La foto no es válida (usa JPG o PNG).' };
  if (base64.length * 0.75 > MAX_FOTO_BYTES) return { ok: false, error: 'La foto pesa demasiado.' };
  return { ok: true, foto: { tipo, base64, nombre: String(foto.nombre || 'foto.jpg').replace(/[^\w.-]/g, '_').slice(0, 60) } };
}

// Sube la foto al campo de adjuntos del registro (API de contenido de Airtable).
async function subirFoto(recordId, campo, foto) {
  const res = await fetch(`https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(campo)}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: foto.tipo, file: foto.base64, filename: foto.nombre }),
  });
  if (!res.ok) throw new Error(`No se pudo subir la foto (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

async function agregarGasto(colaborador, body) {
  const fecha = esFecha(body.fecha) ? body.fecha : hoyCuliacan();
  const concepto = String(body.concepto || '').trim().slice(0, 120);
  const valor = monto(body.monto);
  if (!concepto) return { error: 'Escribe en qué se gastó.' };
  if (!valor) return { error: 'Escribe un monto válido.' };
  if (!CATEGORIAS.includes(body.categoria)) return { error: 'Elige la categoría del gasto.' };
  if (!PAGADO_CON.includes(body.pagadoCon)) return { error: 'Indica si fue con dinero del negocio o con dinero propio.' };
  const foto = validarFoto(body.foto);
  if (!foto.ok) return { error: foto.error };
  const eventos = await eventosDelDia(colaborador, fecha);
  const negocios = eventos.length ? [...new Set(eventos.map(e => e.negocio))] : [negocioDe(colaborador, [])];
  const negocio = negocios.length === 1 ? negocios[0] : body.negocio;
  if (![NEGOCIOS.DV, NEGOCIOS.VM].includes(negocio) || !negocios.includes(negocio)) return { error: 'Elige de qué negocio es el gasto.' };
  const eventoId = ID.test(body.eventoId || '') && eventos.some(e => e.id === body.eventoId) ? body.eventoId : '';
  const { reporte, error } = await reporteEditable(colaborador, fecha, eventos);
  if (error) return { error };
  const creado = await airtable(TABLES.GASTOS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: {
      Concepto: concepto, Monto: valor, Fecha: fecha, Negocio: negocio, Categoria: body.categoria,
      Pagado_Con: body.pagadoCon, Reporte: [reporte.id], Reportado_Por: [colaborador.id],
      ...(eventoId ? { Evento_Relacionado: [eventoId] } : {}),
    } }] }),
  });
  const id = creado.records[0].id;
  // El gasto queda guardado aunque falle la foto: se dice para que la vuelvan a tomar.
  if (foto.foto) {
    try { await subirFoto(id, 'Attachments', foto.foto); } catch (err) {
      console.error(err.message);
      return { ok: true, id, avisoFoto: 'El gasto quedó guardado, pero la foto del ticket no se pudo subir. Quítalo y agrégalo otra vez con la foto.' };
    }
  }
  return { ok: true, id };
}

async function agregarCobro(colaborador, body) {
  const fecha = esFecha(body.fecha) ? body.fecha : hoyCuliacan();
  const valor = monto(body.monto);
  if (!valor) return { error: 'Escribe un monto válido.' };
  if (!FORMAS.includes(body.forma)) return { error: 'Elige si fue efectivo, transferencia o depósito.' };
  const foto = validarFoto(body.foto);
  if (!foto.ok) return { error: foto.error };
  const eventos = await eventosDelDia(colaborador, fecha);
  const ev = eventos.find(e => e.id === body.eventoId);
  if (!ev) return { error: 'Elige de qué evento es el cobro (solo tus eventos de ese día).' };
  const { reporte, error } = await reporteEditable(colaborador, fecha, eventos);
  if (error) return { error };
  const creado = await airtable(TABLES.COBROS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: {
      Concepto: `${ev.folio} · ${body.forma}`, Monto: valor, Forma: body.forma, Fecha: fecha, Negocio: ev.negocio,
      Evento: [ev.id], Reporte: [reporte.id], Reportado_Por: [colaborador.id],
    } }] }),
  });
  const id = creado.records[0].id;
  if (foto.foto) {
    try { await subirFoto(id, 'Comprobante', foto.foto); } catch (err) {
      console.error(err.message);
      return { ok: true, id, avisoFoto: 'El cobro quedó guardado, pero la foto del comprobante no se pudo subir. Quítalo y agrégalo otra vez con la foto.' };
    }
  }
  return { ok: true, id };
}

// Quita un gasto o cobro propio de un reporte que todavía se puede editar.
async function quitar(colaborador, body) {
  const tabla = body.tipo === 'gasto' ? TABLES.GASTOS : body.tipo === 'cobro' ? TABLES.COBROS : null;
  if (!tabla || !ID.test(body.id || '')) return { error: 'Parámetros inválidos' };
  const item = (body.tipo === 'gasto' ? aGasto : aCobro)(await airtable(`${tabla}/${body.id}`));
  const rep = item.reporteId ? aReporte(await airtable(`${TABLES.REPORTES}/${item.reporteId}`)) : null;
  if (!rep || rep.colaboradorId !== colaborador.id) return { error: 'Ese registro no es tuyo.' };
  if (rep.estado === ESTADOS.APROBADO) return { error: 'El reporte ya fue aprobado; ya no se puede cambiar.' };
  await airtable(`${tabla}/${body.id}`, { method: 'DELETE' });
  if (rep.estado === ESTADOS.ENVIADO) {
    await airtable(TABLES.REPORTES, { method: 'PATCH', body: JSON.stringify({ records: [{ id: rep.id, fields: { Estado: ESTADOS.ABIERTO } }] }) });
  }
  return { ok: true };
}

async function guardarDatos(colaborador, body) {
  const fecha = esFecha(body.fecha) ? body.fecha : hoyCuliacan();
  const efectivo = body.efectivoEntregado === '' || body.efectivoEntregado == null ? 0 : monto(body.efectivoEntregado);
  if (efectivo === null) return { error: 'El efectivo entregado no es un monto válido.' };
  const eventos = await eventosDelDia(colaborador, fecha);
  const { reporte, error } = await reporteEditable(colaborador, fecha, eventos);
  if (error) return { error };
  await airtable(TABLES.REPORTES, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: reporte.id, fields: {
      Efectivo_Entregado: efectivo,
      Insumos: String(body.insumos || '').trim().slice(0, 3000),
      Notas: String(body.notas || '').trim().slice(0, 3000),
    } }] }),
  });
  return { ok: true };
}

// Totales que se guardan en el reporte (se recalculan desde los registros).
async function recalcular(reporte) {
  const actual = aReporte(await airtable(`${TABLES.REPORTES}/${reporte.id}`));
  const { gastos, cobros } = await detalleDe([actual]);
  const gs = gastos.get(actual.id), cs = cobros.get(actual.id);
  const totales = {
    Total_Gastos: suma(gs),
    Total_Cobros: suma(cs),
    Reembolso_Pendiente: suma(gs.filter(g => g.pagadoCon === 'Dinero propio' && !g.reembolsado)),
  };
  return { actual, gastos: gs, cobros: cs, totales };
}

// Quien reporta lo manda a Diana.
async function enviar(colaborador, body) {
  const fecha = esFecha(body.fecha) ? body.fecha : hoyCuliacan();
  const r = await reporteDe(colaborador.id, fecha);
  if (!r) return { error: 'Todavía no hay nada en tu reporte de ese día.' };
  if (r.estado === ESTADOS.APROBADO) return { error: 'Este reporte ya fue aprobado.' };
  if (r.estado === ESTADOS.ENVIADO) return { error: 'Ya lo enviaste; Diana lo está revisando.' };
  const { actual, gastos, cobros, totales } = await recalcular(r);
  if (!gastos.length && !cobros.length && !actual.efectivoEntregado && !actual.insumos.trim()) {
    return { error: 'El reporte está vacío: agrega al menos un gasto, un cobro, el efectivo entregado o los insumos.' };
  }
  await airtable(TABLES.REPORTES, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: r.id, fields: { ...totales, Estado: ESTADOS.ENVIADO, Enviado_Hora: new Date().toISOString() } }] }),
  });
  const sinTicket = gastos.filter(g => !g.foto).length;
  const resumen = [
    `💰 Reporte del día de ${colaborador.nombre} (${fecha})${actual.estado === ESTADOS.ACLARACION ? ' · corregido' : ''}`,
    `Gastos: ${pesos(totales.Total_Gastos)} (${gastos.length})${sinTicket ? ` · ⚠️ ${sinTicket} sin ticket` : ''}`,
    `Cobros: ${pesos(totales.Total_Cobros)} (${cobros.length})`,
    `Efectivo entregado a Diana: ${pesos(actual.efectivoEntregado)}`,
    totales.Reembolso_Pendiente ? `Pagó con dinero propio: ${pesos(totales.Reembolso_Pendiente)} (reembolso pendiente)` : null,
    'Revísalo en el dashboard para aprobarlo o pedir aclaración.',
  ].filter(Boolean).join('\n');
  const avisados = await avisarRevisores(actual.negocio, resumen, `Reporte del día de ${colaborador.nombre}`);
  return { ok: true, avisados };
}

// Admin y, si el reporte tiene algo de El Vaso Maíz, la gerente (ella sin lo de Divanna).
async function avisarRevisores(negocio, texto, titulo) {
  const formula = encodeURIComponent(`AND({Activo}, OR({Rol} = "${ROLES.ADMIN}", {Gerente_Vaso_Maiz}))`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`).catch(() => ({ records: [] }));
  const admins = data.records.filter(r => r.fields.Rol === ROLES.ADMIN).map(r => r.id);
  const gerentes = negocio === NEGOCIOS.DV ? [] : data.records.filter(r => r.fields.Rol !== ROLES.ADMIN && r.fields.Gerente_Vaso_Maiz).map(r => r.id);
  const destinos = [...admins, ...gerentes];
  if (!destinos.length) return 0;
  const [tg] = await Promise.all([
    enviarTelegramEquipo({ texto, soloColaboradores: admins }),
    gerentes.length ? enviarTelegramEquipo({ texto: `${titulo}: ya lo puedes ver en tu app ("💰 Reportes").`, soloColaboradores: gerentes }) : 0,
    enviarPushEquipo({ titulo: `💰 ${titulo}`, cuerpo: 'Toca para revisarlo.', soloColaboradores: admins, url: '/brigadas/dashboard.html' }),
  ]);
  return tg;
}

// ---------- Revisión (Diana / Víctor) ----------

async function revisar(colaborador, body) {
  if (colaborador.rol !== ROLES.ADMIN) return { error: 'Solo Diana y Víctor aprueban reportes.', codigo: 403 };
  if (!ID.test(body.reporteId || '')) return { error: 'Parámetros inválidos' };
  const aprobar = body.accion === 'aprobar';
  const comentario = String(body.comentario || '').trim().slice(0, 1000);
  if (!aprobar && !comentario) return { error: 'Escribe qué hay que aclarar o corregir.' };
  const r = aReporte(await airtable(`${TABLES.REPORTES}/${body.reporteId}`));
  if (r.estado !== ESTADOS.ENVIADO) return { error: r.estado === ESTADOS.APROBADO ? 'Este reporte ya estaba aprobado.' : 'Este reporte todavía no se envía.', codigo: 409 };
  const { totales } = await recalcular(r);
  const linea = `[${ahoraTexto()}] ${colaborador.nombre}: ${aprobar ? '✅ aprobado' : '✏️ pidió aclaración'}${comentario ? ' — ' + comentario : ''}`;
  await airtable(TABLES.REPORTES, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: r.id, fields: { ...totales, Estado: aprobar ? ESTADOS.APROBADO : ESTADOS.ACLARACION, Revision: r.revision ? `${r.revision}\n${linea}` : linea } }] }),
  });
  const persona = r.colaboradorId ? await airtable(`${COLABORADORES_TABLE}/${r.colaboradorId}`).catch(() => null) : null;
  const chat = persona && persona.fields.Telegram_Chat_ID;
  let avisado = false;
  if (chat) {
    const texto = aprobar
      ? `✅ ${colaborador.nombre} aprobó tu reporte del ${r.fecha}.${totales.Reembolso_Pendiente ? ` Te deben ${pesos(totales.Reembolso_Pendiente)} de lo que pagaste con tu dinero.` : ''}${comentario ? '\n' + comentario : ''}`
      : `✏️ ${colaborador.nombre} pidió una aclaración de tu reporte del ${r.fecha}:\n\n${comentario}\n\nCorrígelo en la app ("💰 Reporte del día") y vuelve a enviarlo.`;
    avisado = (await enviarTelegram(chat, texto)).ok;
  }
  await enviarPushEquipo({ titulo: aprobar ? '✅ Reporte aprobado' : '✏️ Diana pidió una aclaración', cuerpo: `Tu reporte del ${r.fecha}`, soloColaboradores: [r.colaboradorId], url: '/brigadas/' }).catch(() => 0);
  return { ok: true, avisado };
}

async function marcarReembolsado(colaborador, body) {
  if (colaborador.rol !== ROLES.ADMIN) return { error: 'Solo Diana y Víctor marcan reembolsos.', codigo: 403 };
  if (!ID.test(body.gastoId || '')) return { error: 'Parámetros inválidos' };
  const g = aGasto(await airtable(`${TABLES.GASTOS}/${body.gastoId}`));
  if (g.pagadoCon !== 'Dinero propio') return { error: 'Ese gasto se pagó con dinero del negocio.' };
  if (g.reembolsado) return { error: 'Ya estaba marcado como reembolsado.', codigo: 409 };
  await airtable(TABLES.GASTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: g.id, fields: { Reembolsado: true } }] }) });
  if (g.reporteId) {
    const { totales } = await recalcular({ id: g.reporteId });
    await airtable(TABLES.REPORTES, { method: 'PATCH', body: JSON.stringify({ records: [{ id: g.reporteId, fields: { Reembolso_Pendiente: totales.Reembolso_Pendiente } }] }) });
  }
  const persona = g.reportadoPor ? await airtable(`${COLABORADORES_TABLE}/${g.reportadoPor}`).catch(() => null) : null;
  if (persona && persona.fields.Telegram_Chat_ID) {
    await enviarTelegram(persona.fields.Telegram_Chat_ID, `💵 ${colaborador.nombre} te reembolsó ${pesos(g.monto)} (${g.concepto}, ${g.fecha}).`);
  }
  return { ok: true };
}

module.exports = {
  ESTADOS,
  NEGOCIOS,
  TABLES,
  puedeReportar,
  vista,
  agregarGasto,
  agregarCobro,
  quitar,
  guardarDatos,
  enviar,
  revisar,
  marcarReembolsado,
  hoyCuliacan,
};
