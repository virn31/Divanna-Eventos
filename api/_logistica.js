// api/_logistica.js
// 🚚 Logística (pestaña del calendario; Víctor 2026-11-11): los traslados de
// Divanna (entrega/montaje y recolección del mobiliario) y de El Vaso Maíz (el
// staff va al domicilio o salón a dar el servicio), por día y por vehículo.
// - Todos los de la app la ven completa, sin montos.
// - Editan: Diana y Víctor todo; Ángela (gerente de El Vaso Maíz) solo El Vaso
//   Maíz; Eden (gerente de Divanna) solo Divanna. Nadie más.
// - Casa Isabella NO entra: es un lugar fijo, no hay envío.
// - El vehículo es el de la brigada (BRIGADAS.Vehiculo: Edén → Ranger,
//   Ángel → Monster, El Vaso Maíz → Meche, Mario → S10), así que elegir
//   vehículo = asignar la brigada (EVENTOS.Brigada_Asignada).
// Campos propios en EVENTOS: Entrega_Hora, Recoleccion_Fecha, Recoleccion_Hora,
// Logistica_Notas y Logistica_Bitacora. Si están vacíos se muestra una hora
// sugerida (marcada como "sin confirmar") a partir de Hora_Inicio.
// Lectura: GET /api/brigada-eventos?vista=logistica&desde=YYYY-MM-DD&dias=N
// Escritura: POST /api/dashboard-eventos { accion: 'logistica_guardar', ... }

const { ROLES, GERENCIAS, esVasoMaiz, usaCasaIsabella, eventoDeGerencia, ocultoParaGerente, NOMBRE_GERENCIA } = require('./_sesion');
const C = require('./_calendario');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = { EVENTOS: 'tblzLAin65BZPP2c6', BRIGADAS: 'tblwqJrIaC1MsMGNL', CLIENTES: 'tblgViisKQRG9TVjh' };
const NEGOCIOS = { DV: 'Divanna Eventos', VM: 'El Vaso Maiz' };
const ZONA = 'America/Mazatlan';
const ID = /^rec[A-Za-z0-9]{14}$/;
const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
const esHora = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
// Sugerencias cuando la gerencia no ha puesto la hora (se marcan "sin confirmar"):
// Divanna llega 2 h antes del evento a entregar y montar; El Vaso Maíz 30 min
// antes (como en api/_productos.js); la recolección, el día siguiente en la mañana
// (el mobiliario vuelve a estar libre a las 12, HORA_REGRESO_SIGUIENTE_DIA).
const MINUTOS_ANTES = { [NEGOCIOS.DV]: 120, [NEGOCIOS.VM]: 30 };
const HORA_RECOLECCION_SUGERIDA = '10:00';
// Dos movimientos del mismo vehículo a menos de esto el mismo día = posible choque.
const MINUTOS_CHOQUE = 90;
const MAX_DIAS = 14;
// Etapas de Estatus_Logistico en las que la entrega ya se hizo (api/_etapas.js).
const YA_LLEGO = ['Llegó al lugar', 'Montando', 'Evento en curso', 'Recolectando', 'Cerrado'];

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

const hoyCuliacan = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const fechaCorta = () => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: ZONA }).format(new Date());
function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const aMinutos = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const deMinutos = (m) => { const x = Math.max(0, Math.min(23 * 60 + 59, m)); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// ¿Entra en Logística? Divanna (sin el salón) y El Vaso Maíz.
const entraEnLogistica = (f) => !!f && !usaCasaIsabella(f);
const negocioDe = (f) => (esVasoMaiz(f) ? NEGOCIOS.VM : (f.Negocio || NEGOCIOS.DV));

// ¿Puede editar la logística de este evento? Admin todo; gerente de El Vaso Maíz
// o de Divanna, lo de su negocio. Mario (Casa Isabella), líderes y demás: no.
function puedeEditarLogistica(c, f) {
  if (!c || !entraEnLogistica(f)) return false;
  if (c.rol === ROLES.ADMIN) return true;
  if (c.gerente !== GERENCIAS.VM && c.gerente !== GERENCIAS.DV) return false;
  return eventoDeGerencia(c.gerente, f);
}
const editaLogistica = (c) => !!c && (c.rol === ROLES.ADMIN || c.gerente === GERENCIAS.VM || c.gerente === GERENCIAS.DV);
// Filtro con el que abre cada quien: Ángela El Vaso Maíz, Eden Divanna, los demás todo.
const negocioPropio = (c) => (c && c.rol !== ROLES.ADMIN ? (c.gerente === GERENCIAS.VM ? NEGOCIOS.VM : c.gerente === GERENCIAS.DV ? NEGOCIOS.DV : null) : null);

// Movimientos (entrega y, si aplica, recolección) de un evento.
function movimientosDe(r, brigadas) {
  const f = r.fields;
  const negocio = negocioDe(f);
  const b = brigadas.get((f.Brigada_Asignada || [])[0]) || null;
  const comun = {
    eventoId: r.id,
    folio: f.Folio_Evento || '',
    negocio,
    ubicacion: f.Ubicacion || '',
    invitados: f.Invitados || null,
    horaEvento: f.Hora_Inicio || '',
    fechaEvento: f.Fecha_Evento,
    brigadaId: b ? b.id : '',
    brigada: b ? b.nombre : '',
    vehiculo: b ? b.vehiculo : '',
    estatus: f.Estatus_Logistico || '',
    notas: f.Logistica_Notas || '',
  };
  const lista = [];
  // Entrega / servicio: el día del evento.
  let hora = esHora(f.Entrega_Hora) ? f.Entrega_Hora : '';
  let sugerida = false;
  if (!hora && esHora(f.Hora_Inicio)) { hora = deMinutos(aMinutos(f.Hora_Inicio) - (MINUTOS_ANTES[negocio] || 60)); sugerida = true; }
  lista.push({ ...comun, tipo: 'entrega', fecha: f.Fecha_Evento, hora, sugerida, hecho: YA_LLEGO.includes(f.Estatus_Logistico) });
  // Recolección: Divanna siempre (el mobiliario se queda); El Vaso Maíz solo si la pusieron.
  if (negocio === NEGOCIOS.DV || esFecha(f.Recoleccion_Fecha)) {
    const fecha = esFecha(f.Recoleccion_Fecha) ? f.Recoleccion_Fecha : sumarDias(f.Fecha_Evento, 1);
    const horaR = esHora(f.Recoleccion_Hora) ? f.Recoleccion_Hora : HORA_RECOLECCION_SUGERIDA;
    lista.push({ ...comun, tipo: 'recoleccion', fecha, hora: horaR, sugerida: !esFecha(f.Recoleccion_Fecha) || !esHora(f.Recoleccion_Hora),
      hecho: !!f.Checklist_Recoleccion || f.Estatus_Logistico === 'Cerrado' });
  }
  return lista;
}

// Avisos de cada movimiento: sin vehículo, hora sin confirmar, choque de vehículo.
function marcarAvisos(movs) {
  movs.forEach(m => { m.avisos = []; });
  movs.forEach(m => {
    if (m.hecho) return;
    if (!m.brigadaId) m.avisos.push('Sin vehículo');
    if (!m.hora) m.avisos.push('Sin hora');
    else if (m.sugerida) m.avisos.push('Hora sin confirmar');
  });
  const conHora = movs.filter(m => m.brigadaId && m.hora && !m.hecho);
  for (let i = 0; i < conHora.length; i++) {
    for (let j = i + 1; j < conHora.length; j++) {
      const a = conHora[i], b = conHora[j];
      if (a.brigadaId !== b.brigadaId || a.fecha !== b.fecha || a.eventoId === b.eventoId) continue;
      if (Math.abs(aMinutos(a.hora) - aMinutos(b.hora)) < MINUTOS_CHOQUE) {
        a.avisos.push(`Choca con ${b.folio} (${b.hora})`);
        b.avisos.push(`Choca con ${a.folio} (${a.hora})`);
      }
    }
  }
  return movs;
}

// Vista de Logística: movimientos de [desde, desde + dias) ordenados por día y hora.
async function vistaLogistica(colaborador, query = {}) {
  const desde = esFecha(query.desde) ? query.desde : hoyCuliacan();
  const dias = Math.min(MAX_DIAS, Math.max(1, Math.floor(Number(query.dias) || 1)));
  const hasta = sumarDias(desde, dias); // exclusivo
  // Se leen eventos desde una semana antes: su recolección puede caer en el rango.
  const leerDesde = sumarDias(desde, -7);
  const formula = `AND({Autorizacion_Diana} = "SI", NOT(IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${leerDesde}"))), IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${hasta}")), NOT({Cancelado}))`;
  const [eventos, brigadasRaw] = await Promise.all([
    todas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}`),
    todas(`${TABLES.BRIGADAS}?fields%5B%5D=Nombre_Brigada&fields%5B%5D=Vehiculo`),
  ]);
  const brigadas = new Map(brigadasRaw.map(b => [b.id, { id: b.id, nombre: b.fields.Nombre_Brigada || '', vehiculo: b.fields.Vehiculo || '' }]));
  const visibles = eventos.filter(r => esFecha(r.fields.Fecha_Evento) && entraEnLogistica(r.fields) && !ocultoParaGerente(colaborador, r.fields));
  const porId = new Map(visibles.map(r => [r.id, r.fields]));
  const movs = marcarAvisos(visibles.flatMap(r => movimientosDe(r, brigadas)))
    .filter(m => m.fecha >= desde && m.fecha < hasta);
  // Contacto del cliente: igual que en el calendario, solo en los eventos que cada quien opera.
  const idsClientes = [...new Set(movs.filter(m => C.puedeEditarEvento(colaborador, porId.get(m.eventoId))).map(m => (porId.get(m.eventoId).Cliente || [])[0]).filter(id => ID.test(id || '')))];
  const clientes = new Map();
  try {
    for (let i = 0; i < idsClientes.length; i += 50) {
      const f = `OR(${idsClientes.slice(i, i + 50).map(id => `RECORD_ID()="${id}"`).join(',')})`;
      (await todas(`${TABLES.CLIENTES}?filterByFormula=${encodeURIComponent(f)}&fields%5B%5D=Nombre&fields%5B%5D=Telefono_WhatsApp`))
        .forEach(c => clientes.set(c.id, { nombre: c.fields.Nombre || '', telefono: c.fields.Telefono_WhatsApp || '' }));
    }
  } catch (err) { console.error('Logística: no se pudieron leer los clientes:', err.message); }
  const salida = movs.map(m => {
    const f = porId.get(m.eventoId);
    const propio = C.puedeEditarEvento(colaborador, f);
    const cli = propio ? clientes.get((f.Cliente || [])[0]) : null;
    return {
      ...m,
      recoleccionFecha: esFecha(f.Recoleccion_Fecha) ? f.Recoleccion_Fecha : '',
      recoleccionHora: esHora(f.Recoleccion_Hora) ? f.Recoleccion_Hora : '',
      entregaHora: esHora(f.Entrega_Hora) ? f.Entrega_Hora : '',
      editable: puedeEditarLogistica(colaborador, f),
      propio,
      clienteNombre: cli ? cli.nombre : '',
      clienteTelefono: cli ? cli.telefono : '',
    };
  }).sort((a, b) => (a.fecha + (a.hora || '99:99') + a.folio).localeCompare(b.fecha + (b.hora || '99:99') + b.folio));
  return {
    desde,
    dias,
    hoy: hoyCuliacan(),
    puedeEditar: editaLogistica(colaborador),
    negocioPropio: negocioPropio(colaborador),
    // Vehículos para elegir (solo a quien edita).
    vehiculos: editaLogistica(colaborador) ? [...brigadas.values()].sort((a, b) => a.vehiculo.localeCompare(b.vehiculo)) : [],
    movimientos: salida,
  };
}

const fechaTexto = (f) => C.fechaTexto(f);
function resumenLogistica(f, brigada) {
  const negocio = negocioDe(f);
  const partes = [
    `Llegada al lugar: ${esHora(f.Entrega_Hora) ? f.Entrega_Hora : 'por confirmar'}`,
    `🚗 ${brigada ? `${brigada.vehiculo || 'sin vehículo'} (${brigada.nombre})` : 'sin vehículo'}`,
  ];
  if (negocio === NEGOCIOS.DV || esFecha(f.Recoleccion_Fecha)) {
    partes.push(`Recolección: ${esFecha(f.Recoleccion_Fecha) ? fechaTexto(f.Recoleccion_Fecha) : 'por confirmar'}${esHora(f.Recoleccion_Hora) ? ' ' + f.Recoleccion_Hora : ''}`);
  }
  return partes.join(' · ');
}

// Guardar la logística de un evento. Solo cambia lo que viene en la petición
// (undefined = se queda igual; '' = se borra). Avisa a la brigada que sale y a la
// que entra (Telegram y push, con "Confirmar" si cambió el vehículo) y, si no fue
// un Admin, a Diana y Víctor.
async function guardarLogistica(colaborador, body = {}) {
  if (!ID.test(body.eventoId || '')) return { error: 'Parámetros inválidos' };
  const r = await airtable(`${TABLES.EVENTOS}/${body.eventoId}`);
  const f = r.fields || {};
  if (!entraEnLogistica(f)) return { error: 'Casa Isabella no lleva logística de envío (es un lugar fijo).' };
  if (!puedeEditarLogistica(colaborador, f)) {
    return { error: colaborador.gerente === GERENCIAS.VM || colaborador.gerente === GERENCIAS.DV ? `Solo puedes editar la logística de ${NOMBRE_GERENCIA[colaborador.gerente]}.` : 'Solo Diana, Víctor, Ángela (El Vaso Maíz) y Eden (Divanna) editan la logística.', codigo: 403 };
  }
  if (f.Cancelado) return { error: 'Este evento ya está cancelado.', codigo: 409 };

  const campos = {};
  const cambios = [];
  const texto = (v) => (v == null ? undefined : String(v).trim());
  const entrega = texto(body.entregaHora);
  if (entrega !== undefined && entrega !== (f.Entrega_Hora || '')) {
    if (entrega && !esHora(entrega)) return { error: 'La hora de llegada debe ser como 16:00.' };
    campos.Entrega_Hora = entrega;
    cambios.push(`llegada ${f.Entrega_Hora || '—'} → ${entrega || '—'}`);
  }
  const recF = texto(body.recoleccionFecha);
  if (recF !== undefined && recF !== (f.Recoleccion_Fecha || '')) {
    if (recF && !esFecha(recF)) return { error: 'Elige la fecha de recolección.' };
    if (recF && esFecha(f.Fecha_Evento) && recF < f.Fecha_Evento) return { error: 'La recolección no puede ser antes del evento.' };
    campos.Recoleccion_Fecha = recF || null;
    cambios.push(`recolección ${f.Recoleccion_Fecha ? fechaTexto(f.Recoleccion_Fecha) : '—'} → ${recF ? fechaTexto(recF) : '—'}`);
  }
  const recH = texto(body.recoleccionHora);
  if (recH !== undefined && recH !== (f.Recoleccion_Hora || '')) {
    if (recH && !esHora(recH)) return { error: 'La hora de recolección debe ser como 10:00.' };
    campos.Recoleccion_Hora = recH;
    cambios.push(`hora de recolección ${f.Recoleccion_Hora || '—'} → ${recH || '—'}`);
  }
  const notas = body.notas == null ? undefined : String(body.notas).trim().slice(0, 1500);
  if (notas !== undefined && notas !== (f.Logistica_Notas || '')) {
    campos.Logistica_Notas = notas;
    cambios.push('notas de logística');
  }
  // Vehículo = brigada. '' la quita.
  const antesBrigada = (f.Brigada_Asignada || [])[0] || '';
  let nuevaBrigada = null;
  const brigadaId = body.brigadaId == null ? undefined : String(body.brigadaId);
  if (brigadaId !== undefined && brigadaId !== antesBrigada) {
    if (brigadaId && !ID.test(brigadaId)) return { error: 'Parámetros inválidos' };
    if (brigadaId) {
      const b = await airtable(`${TABLES.BRIGADAS}/${brigadaId}`).catch(() => null);
      if (!b || !b.fields) return { error: 'Ese vehículo ya no existe.' };
      nuevaBrigada = { id: b.id, nombre: b.fields.Nombre_Brigada || '', vehiculo: b.fields.Vehiculo || '' };
    }
    Object.assign(campos, { Brigada_Asignada: brigadaId ? [brigadaId] : [], Enterado_Por: '', Enterado_Hora: null });
    cambios.push(`vehículo: ${nuevaBrigada ? `${nuevaBrigada.vehiculo || 'sin vehículo'} (${nuevaBrigada.nombre})` : 'sin vehículo'}`);
  }
  if (!cambios.length) return { error: 'No cambiaste nada.' };
  campos.Logistica_Bitacora = `${f.Logistica_Bitacora || ''}\n${fechaCorta()} · ${colaborador.nombre}: ${cambios.join('; ')}`.trim().slice(-20000);
  await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: body.eventoId, fields: campos }] }) });

  // Avisos: equipo de antes y de ahora (si cambió el vehículo, la brigada que sale también se entera).
  const nuevo = { ...f, ...campos };
  const brigadaFinal = nuevaBrigada || (brigadaId === '' ? null : await (async () => {
    const id = (nuevo.Brigada_Asignada || [])[0];
    if (!id) return null;
    const b = await airtable(`${TABLES.BRIGADAS}/${id}`).catch(() => null);
    return b && b.fields ? { id, nombre: b.fields.Nombre_Brigada || '', vehiculo: b.fields.Vehiculo || '' } : null;
  })());
  const [antes, despues] = await Promise.all([C.equipoDe(body.eventoId, f), 'Brigada_Asignada' in campos ? C.equipoDe(body.eventoId, nuevo) : null]);
  const ids = new Set([...antes.ids, ...((despues || {}).ids || [])]);
  if (colaborador.rol !== ROLES.ADMIN) antes.admins.forEach(id => ids.add(id));
  const titulo = `🚚 Logística de ${f.Folio_Evento || 'un evento'}`;
  const textoAviso = `${titulo} (${fechaTexto(f.Fecha_Evento)}${f.Ubicacion ? ' · ' + f.Ubicacion : ''})\n${resumenLogistica(nuevo, brigadaFinal)}`
    + `${nuevo.Logistica_Notas ? `\n📝 ${String(nuevo.Logistica_Notas).slice(0, 500)}` : ''}\n\nCambió: ${cambios.join('; ')}. Lo hizo ${colaborador.nombre}.`;
  const avisos = await C.avisar(colaborador, [...ids], titulo, textoAviso, body.eventoId, 'Brigada_Asignada' in campos);
  // La brigada va en la descripción de Google Calendar.
  const google = 'Brigada_Asignada' in campos ? await C.sincronizarEvento(body.eventoId) : null;
  return { ok: true, ...avisos, google, cambios };
}

module.exports = {
  vistaLogistica,
  guardarLogistica,
  puedeEditarLogistica,
  editaLogistica,
  entraEnLogistica,
  movimientosDe,
  marcarAvisos,
  MINUTOS_CHOQUE,
};
