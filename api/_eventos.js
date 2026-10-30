// api/_eventos.js
// Qué eventos ve cada colaborador según su rol, y las alertas del equipo del
// día. Lo usan la app (api/brigada-eventos.js) y el bot de Telegram (api/telegram.js).
// También la confirmación "Enterado" de un evento asignado (app y botón de Telegram).

const { ROLES, COLABORADORES_TABLE, puedeOperarEvento, esVasoMaiz } = require('./_sesion');
const { enviarTelegramEquipo } = require('./_telegram');
const { leerArticulos } = require('./_productos');
const { eventosConfirmadosDe } = require('./_staff');
const { leerCambio } = require('./_pedidos');
const { dineroParaApp } = require('./_cargos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  EVENTOS: 'tblzLAin65BZPP2c6',
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
    brigadaId: (r.fields.Brigada_Asignada || [])[0] || '',
    encargadaIds: r.fields.Encargada || [],
    // Encargado de producción de El Vaso Maíz y su última respuesta (api/_produccion.js).
    produccionId: (r.fields.Encargado_Produccion || [])[0] || '',
    produccionRespuesta: (r.fields.Produccion_Respuesta || '').trim().split('\n').pop() || '',
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
// La gerente de El Vaso Maíz ve, además de lo suyo, todos los eventos
// autorizados y no cerrados de El Vaso Maíz.
async function alcanceDe(colaborador) {
  const alcance = await alcanceBase(colaborador);
  if (!colaborador.gerente || alcance.eventoIds === null) return alcance;
  const formula = encodeURIComponent('AND({Autorizacion_Diana} = "SI", {Estado} != "Cerrado", OR({Negocio} = "El Vaso Maiz", {Piezas_Vaso_Maiz} > 0))');
  const data = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${formula}&fields%5B%5D=Folio_Evento&pageSize=100`);
  return { ...alcance, eventoIds: [...new Set([...alcance.eventoIds, ...data.records.map(r => r.id)])] };
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

// Eventos activos (no cerrados) de una lista de IDs, o de todos si ids = null.
// soloHoy limita a los de la fecha de hoy en Culiacán. conDinero agrega a cada
// evento su dinero (total, pagado, falta, cargos extra) y el cliente: solo para
// quien entrega y cobra (veDinero en api/_cargos.js).
async function leerEventos(ids, { soloHoy = false, conDinero = false } = {}) {
  if (ids && ids.length === 0) return [];
  const condiciones = ['{Estado} != "Cerrado"'];
  if (ids) condiciones.push(`OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`);
  if (soloHoy) condiciones.push(`DATESTR({Fecha_Evento}) = "${hoyCuliacan()}"`);
  const formula = encodeURIComponent(`AND(${condiciones.join(', ')})`);
  const data = await airtableGet(
    `${TABLES.EVENTOS}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`
  );
  const eventos = data.records.map(formatearEvento);
  if (conDinero && eventos.length) {
    // Si no se puede leer el dinero, la app sigue con los eventos y lo dice.
    const dinero = await dineroParaApp(data.records).catch(err => { console.error('No se pudo leer el dinero de los eventos:', err.message); return null; });
    eventos.forEach(ev => { ev.dinero = dinero ? dinero.get(ev.id) || null : { error: true }; });
  }
  return eventos;
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
async function opcionesVista() {
  const [brigadas, encargadas] = await Promise.all([
    airtableGet(`${TABLES.BRIGADAS}?fields%5B%5D=Nombre_Brigada&sort%5B0%5D%5Bfield%5D=Nombre_Brigada`),
    airtableGet(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(`AND({Activo}, {Rol} = "${ROLES.ENCARGADA}")`)}&fields%5B%5D=Nombre`),
  ]);
  return {
    brigadas: brigadas.records.map(r => ({ id: r.id, nombre: r.fields.Nombre_Brigada || 'Sin nombre' })),
    encargadas: encargadas.records.map(r => ({ id: r.id, nombre: r.fields.Nombre || 'Sin nombre' })),
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
