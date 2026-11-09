// api/_eventos.js
// Qué eventos ve cada colaborador según su rol, y las alertas del equipo del
// día. Lo usan la app (api/brigada-eventos.js) y el bot de Telegram (api/telegram.js).
// También la confirmación "Enterado" de un evento asignado (app y botón de Telegram).

const { ROLES, COLABORADORES_TABLE, puedeOperarEvento, esVasoMaiz, formulaGerencia, GERENCIAS, eventoDeGerencia, gerenciaDe, puestoGerente } = require('./_sesion');
const { enviarTelegramEquipo } = require('./_telegram');
const { leerArticulos } = require('./_productos');
const { eventosConfirmadosDe } = require('./_staff');
const { leerCambio } = require('./_pedidos');
const { dineroParaApp, eventoPagado } = require('./_cargos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  EVENTOS: 'tblzLAin65BZPP2c6',
  CLIENTES: 'tblgViisKQRG9TVjh',
};
// Vínculo inverso COLABORADORES -> EVENTOS (lado del campo EVENTOS.Encargada).
const CAMPO_EVENTOS_DE_ENCARGADA = 'fld52PrtsNA4CnRw2';

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function airtablePatch(tableId, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fecha de hoy en Culiacán (YYYY-MM-DD). TODAY() de Airtable usa UTC y por la
// tarde ya marcaría el día siguiente.
function hoyCuliacan() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
}

function cambioParaApp(texto) {
  const c = leerCambio(texto);
  if (!c || (c.estado !== 'pendiente' && c.estado !== 'confirmado')) return null;
  return { estado: c.estado, pedidoEl: c.pedidoEl || '', confirmadoEl: c.confirmadoEl || '', urgente: !!c.urgente, antes: c.antes || '', servicios: c.servicios };
}

function formatearEvento(r) {
  const itemsRaw = (r.fields.Checklist_Items || '').split('\n').map(s => s.trim()).filter(Boolean);
  let marcados = [];
  try { marcados = JSON.parse(r.fields.Checklist_Items_Marcados || '[]'); } catch (e) { marcados = []; }

  return {
    id: r.id,
    folio: r.fields.Folio_Evento || '',
    negocio: r.fields.Negocio || '',
    vasoMaiz: esVasoMaiz(r.fields),
    // Gerencias a las que les toca el evento (El Vaso Maiz, Divanna Eventos, Casa Isabella).
    gerencias: Object.values(GERENCIAS).filter(g => eventoDeGerencia(g, r.fields)),
    brigadaId: (r.fields.Brigada_Asignada || [])[0] || '',
    encargadaIds: r.fields.Encargada || [],
    // Encargado de producción de El Vaso Maíz y su última respuesta (api/_produccion.js).
    produccionId: (r.fields.Encargado_Produccion || [])[0] || '',
    produccionRespuesta: (r.fields.Produccion_Respuesta || '').trim().split('\n').pop() || '',
    // Equipo de producción y hora en que el encargado avisó "Listo para staff" (api/_etapas.js).
    equipoProduccionIds: r.fields.Equipo_Produccion || [],
    produccionLista: r.fields.Produccion_Lista || '',
    // Cambio que pidió el cliente (pendiente o ya confirmado por Diana), sin montos.
    cambio: cambioParaApp(r.fields.Cambio_Cliente),
    fecha: r.fields.Fecha_Evento || '',
    horaInicio: r.fields.Hora_Inicio || '',
    personalRequerido: r.fields.Personal_Requerido || 0,
    // Modelo, color y cantidad exactos que asignó Diana (lo que se carga).
    articulos: leerArticulos(r.fields.Articulos).map(a => ({ nombre: a.nombre, cantidad: a.cantidad })),
    estado: r.fields.Estado || '',
    servicios: r.fields.Servicios_Solicitados || '',
    invitados: r.fields.Invitados || null,
    ubicacion: r.fields.Ubicacion || '',
    checklist: {
      salida: !!r.fields.Checklist_Salida,
      llegada: !!r.fields.Checklist_Llegada,
      montaje: !!r.fields.Checklist_Montaje,
      recoleccion: !!r.fields.Checklist_Recoleccion,
    },
    checklistItems: itemsRaw.map((texto, i) => ({ texto, marcado: marcados.includes(i) })),
    estatusLogistico: r.fields.Estatus_Logistico || 'Preparando',
    retraso: !!r.fields.Retraso,
    motivoRetraso: r.fields.Motivo_Retraso || '',
    emergencia: !!r.fields.Emergencia,
    motivoEmergencia: r.fields.Motivo_Emergencia || '',
    zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
    etaConfirmado: r.fields.ETA_Confirmado_Brigada || '',
    estatusPago: r.fields.Estatus_Pago || '',
    montoAdeudado: r.fields.Monto_Adeudado || null,
    instrucciones: r.fields.Instrucciones_Equipo || '',
    enteradoPor: r.fields.Enterado_Por || '',
    enteradoHora: r.fields.Enterado_Hora || '',
    fueraDeCiudad: !!r.fields.Fuera_De_Ciudad,
    ubicacionAlerta: r.fields.Ubicacion_Alerta || '',
    ubicacionAlertaHora: r.fields.Ubicacion_Alerta_Hora || '',
  };
}

// Brigada (si aplica) e IDs de los eventos que le tocan al colaborador.
// Para Admin devuelve eventoIds = null: ve todos.
// Se usa el campo de vínculo directo (array de IDs) en vez de una fórmula
// ARRAYJOIN, porque Airtable resuelve ARRAYJOIN sobre un vínculo devolviendo
// el NOMBRE del registro vinculado, no su ID — comparar por ID ahí nunca coincide.
// Cada gerente (El Vaso Maíz, Divanna, Casa Isabella) ve, además de lo suyo,
// todos los eventos autorizados y no cerrados de su negocio.
async function alcanceDe(colaborador) {
  const alcance = await alcanceBase(colaborador);
  if (!colaborador.gerente || alcance.eventoIds === null) return alcance;
  // Los eventos donde lo pusieron en "👷 Asignar" (de cualquier negocio).
  const propio = colaborador.rol === ROLES.ENCARGADA ? [] : await airtableGet(`${COLABORADORES_TABLE}/${colaborador.id}?returnFieldsByFieldId=true`)
    .then(r => r.fields[CAMPO_EVENTOS_DE_ENCARGADA] || [])
    .catch(err => { console.error('No se pudieron leer los eventos asignados al gerente:', err.message); return []; });
  const ids = await idsDeEventos(`AND({Autorizacion_Diana} = "SI", {Estado} != "Cerrado", ${formulaGerencia(colaborador.gerente)})`);
  let eventoIds = [...new Set([...alcance.eventoIds, ...propio, ...ids])];
  // Eden no ve Casa Isabella, ni lo que le llegue por su brigada o por "Asignar".
  if (colaborador.gerente === GERENCIAS.DV && eventoIds.length) {
    const delSalon = new Set(await idsDeEventos(`AND({Estado} != "Cerrado", ${formulaGerencia(GERENCIAS.CI)})`));
    eventoIds = eventoIds.filter(id => !delSalon.has(id));
  }
  return { ...alcance, eventoIds };
}

// IDs de los eventos que cumplen la fórmula (con paginación).
async function idsDeEventos(formula) {
  const ids = [];
  let offset = '';
  do {
    const data = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}&fields%5B%5D=Folio_Evento&pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`);
    ids.push(...data.records.map(r => r.id));
    offset = data.offset || '';
  } while (offset && ids.length < 500);
  return ids;
}

async function alcanceBase(colaborador) {
  if (colaborador.rol === ROLES.ADMIN) return { brigada: null, eventoIds: null };
  // Staff de El Vaso Maíz: los eventos que confirmó por Telegram.
  if (colaborador.rol === ROLES.STAFF) return { brigada: null, eventoIds: await eventosConfirmadosDe(colaborador.id) };
  if (colaborador.rol === ROLES.ENCARGADA) {
    const registro = await airtableGet(`${COLABORADORES_TABLE}/${colaborador.id}?returnFieldsByFieldId=true`);
    return { brigada: null, eventoIds: registro.fields[CAMPO_EVENTOS_DE_ENCARGADA] || [] };
  }
  if (!colaborador.brigadaId) return { brigada: null, eventoIds: [] };
  const b = await airtableGet(`${TABLES.BRIGADAS}/${colaborador.brigadaId}`);
  return {
    brigada: {
      id: b.id,
      nombre: b.fields.Nombre_Brigada || '',
      lider: b.fields.Lider || '',
      vehiculo: b.fields.Vehiculo || '',
    },
    eventoIds: b.fields.EVENTOS || [],
  };
}

// Nombre, teléfono y correo de los clientes de los eventos (de 90 en 90 por el
// máximo de 100 registros por página de Airtable).
async function clientesDe(registros) {
  const ids = [...new Set(registros.map(r => (r.fields.Cliente || [])[0]).filter(Boolean))];
  const mapa = {};
  for (let i = 0; i < ids.length; i += 90) {
    const formula = encodeURIComponent(`OR(${ids.slice(i, i + 90).map(id => `RECORD_ID()="${id}"`).join(',')})`);
    const data = await airtableGet(`${TABLES.CLIENTES}?filterByFormula=${formula}&fields%5B%5D=Nombre&fields%5B%5D=Telefono_WhatsApp&fields%5B%5D=Email`);
    data.records.forEach(c => { mapa[c.id] = c.fields; });
  }
  return mapa;
}

// Días después del evento en que un evento pagado sale de la APK: el mobiliario
// se recoge al día siguiente y la brigada lo sigue necesitando (Víctor 2026-11-09).
const DIAS_PARA_OCULTAR_PAGADO = 2;
function yaPasoParaOcultar(fechaEvento) {
  const fecha = String(fechaEvento || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const limite = new Date(`${hoyCuliacan()}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - DIAS_PARA_OCULTAR_PAGADO);
  return fecha <= limite.toISOString().slice(0, 10);
}

// Eventos activos (no cerrados) de una lista de IDs, o de todos si ids = null.
// soloHoy limita a los de la fecha de hoy en Culiacán. conDinero agrega a cada
// evento su dinero (total, pagado, falta, cargos extra) y el cliente: solo para
// quien entrega y cobra (veDinero en api/_cargos.js).
async function leerEventos(ids, { soloHoy = false, conDinero = false, sinPagadosPasados = false } = {}) {
  if (ids && ids.length === 0) return [];
  // Por tandas de 80 IDs (la URL tiene límite) y con paginación: un gerente
  // de Divanna puede tener más de 100 eventos abiertos.
  const tandas = ids ? Array.from({ length: Math.ceil(ids.length / 80) }, (_, i) => ids.slice(i * 80, i * 80 + 80)) : [null];
  const records = [];
  for (const tanda of tandas) {
    const condiciones = ['{Estado} != "Cerrado"'];
    if (tanda) condiciones.push(`OR(${tanda.map(id => `RECORD_ID()="${id}"`).join(',')})`);
    if (soloHoy) condiciones.push(`DATESTR({Fecha_Evento}) = "${hoyCuliacan()}"`);
    const formula = encodeURIComponent(`AND(${condiciones.join(', ')})`);
    let offset = '';
    do {
      const pagina = await airtableGet(
        `${TABLES.EVENTOS}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`
      );
      records.push(...pagina.records);
      offset = pagina.offset || '';
    } while (offset && records.length < 600);
  }
  if (tandas.length > 1) records.sort((a, b) => String(a.fields.Fecha_Evento || '').localeCompare(String(b.fields.Fecha_Evento || '')));
  const data = { records };
  const eventos = data.records.map(formatearEvento);
  // Todos ven nombre, teléfono y correo del cliente: el encargado lo atiende de
  // principio a fin. Si no se puede leer, la app sigue sin esos datos.
  const clientes = await clientesDe(data.records).catch(err => { console.error('No se pudieron leer los clientes:', err.message); return {}; });
  eventos.forEach((ev, i) => {
    const c = clientes[(data.records[i].fields.Cliente || [])[0]] || {};
    ev.clienteNombre = c.Nombre || '';
    ev.clienteTelefono = c.Telefono_WhatsApp || '';
    ev.clienteEmail = c.Email || '';
  });
  const revisarPagados = sinPagadosPasados && data.records.some(r => yaPasoParaOcultar(r.fields.Fecha_Evento));
  let dinero = null;
  if ((conDinero || revisarPagados) && eventos.length) {
    // Si no se puede leer el dinero, la app sigue con los eventos y lo dice.
    dinero = await dineroParaApp(data.records).catch(err => { console.error('No se pudo leer el dinero de los eventos:', err.message); return null; });
  }
  // El asistente no recibe el dinero aunque aquí se haya leído para ocultar.
  if (conDinero && eventos.length) eventos.forEach(ev => { ev.dinero = dinero ? dinero.get(ev.id) || null : { error: true }; });
  if (!revisarPagados) return eventos;
  return eventos.filter((ev, i) => {
    const f = data.records[i].fields;
    return !(yaPasoParaOcultar(f.Fecha_Evento) && eventoPagado(f, dinero && dinero.get(ev.id)));
  });
}

// Emergencias y alertas de seguridad activas hoy en eventos de OTRAS brigadas.
// Si falla no bloquea: el colaborador sigue viendo sus propios eventos.
async function alertasEquipoDeHoy(eventoIdsPropios) {
  try {
    const formula = encodeURIComponent(
      `AND(DATESTR({Fecha_Evento}) = "${hoyCuliacan()}", {Estado} != "Cerrado", OR({Emergencia}, {Zona_Alerta_Seguridad} != ""))`
    );
    const data = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${formula}`);
    return data.records
      .filter(r => !(eventoIdsPropios || []).includes(r.id))
      .map(r => ({
        folio: r.fields.Folio_Evento || '',
        ubicacion: r.fields.Ubicacion || '',
        emergencia: !!r.fields.Emergencia,
        motivoEmergencia: r.fields.Motivo_Emergencia || '',
        zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
        ubicacionAlerta: r.fields.Ubicacion_Alerta || '',
        ubicacionAlertaHora: r.fields.Ubicacion_Alerta_Hora || '',
      }));
  } catch (err) {
    console.error('No se pudieron obtener las alertas del equipo:', err);
    return [];
  }
}

// Para la "vista equipo" de los Admin: brigadas y encargadas activas para
// elegir a quién ver.
// conGerentes (para "👷 Asignar"): además de las encargadas salen los gerentes
// (Ángela, Eden, Mario), para que se asignen a sí mismos o entre ellos. El
// gerente asignado ve ese evento aunque no sea de su negocio (alcanceDe).
async function opcionesVista(conGerentes = false) {
  const formula = conGerentes ? '{Activo}' : `AND({Activo}, {Rol} = "${ROLES.ENCARGADA}")`;
  const [brigadas, encargadas] = await Promise.all([
    airtableGet(`${TABLES.BRIGADAS}?fields%5B%5D=Nombre_Brigada&sort%5B0%5D%5Bfield%5D=Nombre_Brigada`),
    airtableGet(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(formula)}${conGerentes ? '' : '&fields%5B%5D=Nombre'}`),
  ]);
  return {
    brigadas: brigadas.records.map(r => ({ id: r.id, nombre: r.fields.Nombre_Brigada || 'Sin nombre' })),
    encargadas: encargadas.records
      .filter(r => !conGerentes || r.fields.Rol === ROLES.ENCARGADA || gerenciaDe(r.fields))
      .map(r => ({ id: r.id, nombre: `${r.fields.Nombre || 'Sin nombre'}${conGerentes && r.fields.Rol !== ROLES.ENCARGADA ? ` (${puestoGerente(gerenciaDe(r.fields))})` : ''}` })),
  };
}

// Botón "Confirmar" que va debajo de los avisos de un evento (asignación e
// instrucciones). Lo atiende api/telegram.js con confirmarEvento.
function botonConfirmar(eventoId) {
  return [[{ texto: '✅ Confirmar', dato: `cf:${eventoId}` }]];
}

function textoEnterado(nombre, eventoFields) {
  const f = eventoFields;
  return `👍 ${nombre} está enterado de ${f.Folio_Evento || 'un evento'} (${f.Ubicacion || 'ubicación por confirmar'}${f.Fecha_Evento ? ' · ' + f.Fecha_Evento : ''}).`;
}

// Quien tiene el evento asignado confirma que lo vio: se guarda en
// Enterado_Por/Enterado_Hora y se avisa a los Admin por Telegram.
// Devuelve null si el evento no es suyo.
async function confirmarEvento(colaborador, eventoId) {
  const evento = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
  if (!puedeOperarEvento(colaborador, evento.fields)) return null;
  const nombre = colaborador.nombre || 'sin identificar';
  await airtablePatch(TABLES.EVENTOS, eventoId, { Enterado_Por: nombre, Enterado_Hora: new Date().toISOString() });
  await enviarTelegramEquipo({ texto: textoEnterado(nombre, evento.fields), roles: [ROLES.ADMIN] })
    .catch(err => console.error('Error avisando enterado:', err));
  return { folio: evento.fields.Folio_Evento || '' };
}

module.exports = { hoyCuliacan, alcanceDe, leerEventos, alertasEquipoDeHoy, opcionesVista, botonConfirmar, textoEnterado, confirmarEvento };
