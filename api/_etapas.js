// api/_etapas.js
// Producción y staff de El Vaso Maíz separados por evento (decisión de Víctor 2026-11-02).
// - La gerente (Ángela) o Diana eligen en la app el equipo de producción
//   (EVENTOS.Equipo_Produccion, 1, 2 o más personas) y a su encargado
//   (EVENTOS.Encargado_Produccion, siempre dentro del equipo). Una persona puede
//   estar en producción y en el staff del mismo evento.
// - Solo el encargado tiene el botón "🚀 Listo para staff" (en la lista de
//   producción del día). Al tocarlo se guarda la hora (EVENTOS.Produccion_Lista)
//   y a cada chica del staff que confirmó le llegan los botones de sus etapas.
//   Quien confirme después los recibe al confirmar.
// - Cualquiera del staff confirmado marca la etapa (Saliendo del almacén → En
//   camino → Llegó al lugar → Evento en curso → Evento terminado). Se guarda en
//   EVENTOS.Estatus_Logistico, lo mismo que mueve la brigada en la app: Ángela lo
//   ve ahí. Solo hacia adelante; la primera que toca avanza para todas.
// - 🆘 SOS: botón fijo abajo del chat (pide la ubicación del teléfono) para
//   cualquier colaborador en cualquier momento. Le llega a todo el equipo igual
//   que la emergencia de la app (api/_alertas.js) y, si quien lo toca tiene un
//   evento hoy, el evento queda en emergencia.
// Los colaboradores no usan la app para esto: todo es por Telegram.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { ESTADOS, fechaTexto, horaTexto } = require('./_staff');
const { alcanceDe } = require('./_eventos');
const { telegramApi, enviarTelegram, enviarTelegramEquipo } = require('./_telegram');
const { textoUbicacion, notificarEquipo } = require('./_alertas');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  STAFF_EVENTO: 'tblvTVcC3NMt5ddjr',
};

// Etapas que marca el staff, en orden. "valor" es la opción de Estatus_Logistico.
const ETAPAS_STAFF = [
  { valor: 'Salió del almacén', texto: '🚚 Saliendo del almacén' },
  { valor: 'En camino', texto: '🛣️ En camino' },
  { valor: 'Llegó al lugar', texto: '📍 Llegamos al lugar' },
  { valor: 'Evento en curso', texto: '🎉 Evento en curso' },
  { valor: 'Cerrado', texto: '🏁 Evento terminado' },
];
// Orden completo de Estatus_Logistico (incluye las etapas de la brigada) para
// no regresar una etapa que ya pasó.
const ORDEN = ['Preparando', 'Salió del almacén', 'En camino', 'Llegó al lugar', 'Montando', 'Evento en curso', 'Recolectando', 'Cerrado'];
const RETRASO_SEGURIDAD = 'Retraso - situación de seguridad en la ciudad';

const TEXTO_BOTON_SOS = '🆘 SOS (manda tu ubicación)';
const MARCA_SOS = '🆘 Tu SOS ya salió.';
const MAX_MOTIVO = 500;

const esId = (id) => /^rec[A-Za-z0-9]{14}$/.test(id || '');

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function todasLasPaginas(path) {
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

const ahoraTexto = () => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date());
const horaCorta = (iso) => iso ? new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '';

function aEvento(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    folio: f.Folio_Evento || '',
    fecha: f.Fecha_Evento || '',
    horaInicio: f.Hora_Inicio || '',
    ubicacion: f.Ubicacion || '',
    estatus: f.Estatus_Logistico || 'Preparando',
    encargadoId: (f.Encargado_Produccion || [])[0] || '',
    equipo: f.Equipo_Produccion || [],
    lista: f.Produccion_Lista || '',
    respuesta: f.Produccion_Respuesta || '',
    checklistItems: (f.Checklist_Items || '').split('\n').map(s => s.trim()).filter(Boolean),
    checklistMarcados: f.Checklist_Items_Marcados || '[]',
  };
}

async function leerEvento(id) {
  if (!esId(id)) return null;
  return aEvento(await airtable(`${TABLES.EVENTOS}/${id}`));
}

async function leerColaboradores(ids) {
  const unicos = [...new Set(ids)].filter(esId);
  if (!unicos.length) return [];
  const formula = encodeURIComponent(`OR(${unicos.map(id => `RECORD_ID()="${id}"`).join(',')})`);
  return (await todasLasPaginas(`${COLABORADORES_TABLE}?filterByFormula=${formula}`))
    .map(r => ({ id: r.id, nombre: r.fields.Nombre || '', chatId: r.fields.Telegram_Chat_ID || '', activo: !!r.fields.Activo }));
}

// IDs del staff que confirmó ese evento.
async function staffConfirmado(eventoId) {
  const formula = encodeURIComponent(`{Estado} = "${ESTADOS.CONFIRMO}"`);
  const registros = await todasLasPaginas(`${TABLES.STAFF_EVENTO}?filterByFormula=${formula}`);
  return registros.filter(r => (r.fields.Evento || [])[0] === eventoId).map(r => (r.fields.Colaborador || [])[0]).filter(Boolean);
}

// ---------- Teclado fijo con el SOS ----------

function tecladoSos() {
  return { keyboard: [[{ text: TEXTO_BOTON_SOS, request_location: true }]], resize_keyboard: true, is_persistent: true };
}

// Mensaje con el botón 🆘 abajo del chat (se queda ahí aunque lleguen más mensajes).
async function enviarConSos(chatId, texto) {
  return telegramApi('sendMessage', { chat_id: chatId, text: String(texto).slice(0, 4000), disable_web_page_preview: true, reply_markup: tecladoSos() });
}

// ---------- Equipo de producción ----------

// Al asignar desde la app: a quien entra al equipo de producción le llega un
// aviso con el botón 🆘. La lista de producción sigue llegándole solo al encargado.
async function avisarEquipoProduccion(ev, nuevosIds, encargadoId) {
  const personas = await leerColaboradores([...nuevosIds, encargadoId].filter(Boolean));
  const encargado = personas.find(p => p.id === encargadoId);
  const enviados = [], fallidos = [];
  for (const p of personas.filter(x => nuevosIds.includes(x.id))) {
    if (!p.chatId) { fallidos.push({ nombre: p.nombre, motivo: 'no ha activado su Telegram' }); continue; }
    const quien = p.id === encargadoId
      ? 'Tú eres el encargado: cuando todo esté listo toca "🚀 Listo para staff" en la lista de producción del día y al staff le llegan sus botones.'
      : `${encargado ? encargado.nombre : 'El encargado'} es quien avisa al staff cuando todo esté listo.`;
    const r = await enviarConSos(p.chatId, [
      `🍳 Hola ${p.nombre}, estás en el equipo de producción de ${ev.folio || 'un evento'} (${fechaTexto(ev.fecha)}${ev.horaInicio ? ' · empieza ' + horaTexto(ev.horaInicio) : ''}).`,
      '',
      quien,
      '',
      `Si tienes una emergencia en cualquier momento, toca el botón "${TEXTO_BOTON_SOS}" de abajo: le llega a todo el equipo con tu ubicación.`,
    ].join('\n'));
    (r.ok ? enviados : fallidos).push(r.ok ? p.nombre : { nombre: p.nombre, motivo: (r.data && r.data.description) || `error ${r.status}` });
  }
  return { enviados, fallidos };
}

// ---------- Listo para staff ----------

function botonesEtapas(eventoId, desde = 0) {
  return ETAPAS_STAFF.slice(desde).map((e, i) => [{ texto: e.texto, dato: `et:${desde + i}:${eventoId}` }]);
}

function textoEtapas(ev, nombre, encargado) {
  return [
    `🚀 Hola ${nombre}, la producción de ${ev.folio} ya está lista${encargado ? ` (avisó ${encargado})` : ''}. Ya pueden arrancar.`,
    `📅 ${fechaTexto(ev.fecha)}${ev.horaInicio ? ' · empieza ' + horaTexto(ev.horaInicio) : ''}`,
    `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
    '',
    'Marca cada etapa conforme avancen (basta con que una del equipo la toque):',
  ].join('\n');
}

// Manda los botones de etapas a esas personas (ids). Devuelve { enviados, fallidos }.
async function enviarEtapas(ev, ids, encargadoNombre) {
  const personas = await leerColaboradores(ids);
  const enviados = [], fallidos = [];
  for (const p of personas) {
    if (!p.chatId) { fallidos.push(p.nombre); continue; }
    const r = await enviarTelegram(p.chatId, textoEtapas(ev, p.nombre, encargadoNombre), botonesEtapas(ev.id));
    (r.ok ? enviados : fallidos).push(p.nombre);
  }
  return { enviados, fallidos };
}

// Botón pl:<evento> del encargado. Devuelve { aviso, alerta, textoFinal }.
async function listoParaStaff(colaborador, eventoId) {
  const ev = await leerEvento(eventoId);
  if (!ev) return { aviso: 'No encontré ese evento.', alerta: true };
  if (ev.encargadoId !== colaborador.id) return { aviso: 'Solo el encargado de producción de este evento puede avisar al staff.', alerta: true };
  if (ev.lista) return { aviso: `Ya avisaste al staff a las ${horaCorta(ev.lista)}.`, alerta: true };

  const linea = `[${ahoraTexto()}] 🚀 ${colaborador.nombre}: listo para staff`;
  await airtable(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: ev.id, fields: { Produccion_Lista: new Date().toISOString(), Produccion_Respuesta: ev.respuesta ? `${ev.respuesta}\n${linea}` : linea } }] }),
  });
  const { enviados, fallidos } = await enviarEtapas(ev, await staffConfirmado(ev.id), colaborador.nombre);
  const textoFinal = [
    enviados.length
      ? `🚀 Avisaste al staff de ${ev.folio}: ${enviados.join(', ')}. Ya tienen sus botones.`
      : `🚀 Quedó marcado que ${ev.folio} está listo. Todavía no hay staff confirmado: a quien confirme le llegan sus botones en ese momento.`,
    fallidos.length ? `⚠️ No les llegó a: ${fallidos.join(', ')}. Avísales por otro medio.` : null,
  ].filter(Boolean).join('\n');
  return { aviso: 'Listo, avisé al staff.', textoFinal };
}

// Una chica confirmó un evento cuya producción ya estaba lista: sus botones de una vez.
async function etapasAlConfirmar(colaborador, chatId, ev) {
  if (!ev || !ev.produccionLista) return;
  await enviarTelegram(chatId, textoEtapas(ev, colaborador.nombre, ''), botonesEtapas(ev.id));
}

// ---------- Etapas del staff ----------

const posicion = (estatus) => {
  if (estatus === RETRASO_SEGURIDAD) return ORDEN.indexOf('En camino');
  return ORDEN.indexOf(estatus || 'Preparando');
};

// Botón et:<etapa>:<evento>. Devuelve { aviso, alerta, textoFinal, botones }.
async function marcarEtapa(colaborador, indice, eventoId) {
  const etapa = ETAPAS_STAFF[Number(indice)];
  if (!etapa || !/^\d$/.test(String(indice))) return { aviso: '' };
  const ev = await leerEvento(eventoId);
  if (!ev) return { aviso: 'No encontré ese evento.', alerta: true };
  if (!(await staffConfirmado(ev.id)).includes(colaborador.id)) return { aviso: 'Este evento no lo tienes confirmado.', alerta: true };
  if (!ev.lista) return { aviso: 'Todavía no: espera a que producción avise que está listo.', alerta: true };
  if (posicion(ev.estatus) >= ORDEN.indexOf(etapa.valor)) {
    return { aviso: `Ya está marcado: va en "${ev.estatus === 'Cerrado' ? 'Evento terminado' : ev.estatus}".`, alerta: true };
  }
  // Igual que en la app: no se sale del almacén con artículos sin marcar como cargados.
  if (ev.checklistItems.length) {
    let marcados = [];
    try { marcados = JSON.parse(ev.checklistMarcados); } catch (e) { marcados = []; }
    if (marcados.length < ev.checklistItems.length) {
      return { aviso: 'Faltan artículos por marcar como cargados en la app antes de salir del almacén. Avísale a tu coordinadora.', alerta: true };
    }
  }
  const campos = { Estatus_Logistico: etapa.valor };
  if (etapa.valor === 'Salió del almacén') campos.Timestamp_Salida = new Date().toISOString();
  await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: ev.id, fields: campos }] }) });
  const siguiente = ETAPAS_STAFF.indexOf(etapa) + 1;
  return {
    aviso: `Listo: ${etapa.texto}`,
    textoFinal: `✅ ${etapa.texto} · lo marcó ${colaborador.nombre} (${horaCorta(new Date().toISOString())})`,
    botones: siguiente < ETAPAS_STAFF.length ? botonesEtapas(ev.id, siguiente) : null,
  };
}

// ---------- 🆘 SOS ----------

// Evento de hoy, no terminado, de quien manda el SOS: lo que le toca por su rol
// (staff confirmado, brigada, encargada) o por producción. Admin y la gerente
// no tienen un evento propio: el SOS sale sin evento.
async function eventoDeHoy(colaborador) {
  if (colaborador.rol === ROLES.ADMIN || colaborador.gerente) return null;
  const [{ eventoIds }, data] = await Promise.all([
    alcanceDe(colaborador),
    airtable(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(`AND({Estado} != "Cerrado", DATESTR({Fecha_Evento}) = "${hoyCuliacan()}")`)}&sort%5B0%5D%5Bfield%5D=Hora_Inicio&sort%5B0%5D%5Bdirection%5D=asc`),
  ]);
  const propios = new Set(eventoIds || []);
  return data.records.map(aEvento).find(ev => ev.estatus !== 'Cerrado'
    && (propios.has(ev.id) || ev.encargadoId === colaborador.id || ev.equipo.includes(colaborador.id))) || null;
}

const ubicacionDe = (loc) => loc && Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))
  ? { lat: Math.round(Number(loc.latitude) * 1e6) / 1e6, lng: Math.round(Number(loc.longitude) * 1e6) / 1e6, precision: Number.isFinite(Number(loc.horizontal_accuracy)) ? Math.round(Number(loc.horizontal_accuracy)) : null }
  : null;

// Manda el SOS a todo el equipo. ubic puede ser null (sin ubicación).
async function enviarSos(chatId, colaborador, ubic) {
  const ev = await eventoDeHoy(colaborador).catch(err => { console.error('SOS: no se pudo leer el evento de hoy:', err.message); return null; });
  const asunto = `🆘 SOS - ${colaborador.nombre}${ev ? ` - Evento ${ev.folio}` : ''}`;
  const mensaje = [
    `🆘 SOS de ${colaborador.nombre}`,
    ev ? `Evento ${ev.folio} (${ev.ubicacion || 'ubicación por confirmar'})` : null,
    textoUbicacion(ubic),
    'Si estás cerca, por favor acude a ayudar. Coordinemos por teléfono.',
  ].filter(Boolean).join('\n');
  if (ev) {
    const campos = { Emergencia: true, Motivo_Emergencia: `SOS por Telegram de ${colaborador.nombre}` };
    if (ubic) Object.assign(campos, { Ubicacion_Alerta: `${ubic.lat},${ubic.lng}`, Ubicacion_Alerta_Hora: new Date().toISOString() });
    await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: ev.id, fields: campos }] }) })
      .catch(err => console.error('SOS: no se pudo marcar la emergencia del evento:', err.message));
  }
  await notificarEquipo({ asunto, mensaje, reportaId: colaborador.id, ubic, desdeTelegram: true });
  // Si puede, que diga qué pasa (contesta encima de este mensaje).
  await telegramApi('sendMessage', {
    chat_id: chatId,
    text: `${MARCA_SOS}\nSi puedes, escribe aquí qué está pasando y se lo mando a todos.`,
    reply_markup: { force_reply: true, input_field_placeholder: 'Ej. se ponchó la llanta en …' },
  });
}

const esUbicacionSos = (mensaje) => !!(mensaje && mensaje.location && !mensaje.via_bot);

function esRespuestaSos(mensaje) {
  const previo = mensaje && mensaje.reply_to_message;
  return !!(previo && previo.from && previo.from.is_bot && String(previo.text || '').startsWith(MARCA_SOS));
}

// Lo que escribió encima de "Tu SOS ya salió": a todo el equipo.
async function atenderMotivoSos(mensaje, colaborador) {
  const texto = String(mensaje.text || '').trim().slice(0, MAX_MOTIVO);
  if (!texto) return null;
  const ev = await eventoDeHoy(colaborador).catch(() => null);
  if (ev) {
    await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: ev.id, fields: { Motivo_Emergencia: `SOS por Telegram de ${colaborador.nombre}: ${texto}` } }] }) })
      .catch(err => console.error('SOS: no se pudo guardar el motivo:', err.message));
  }
  const n = await enviarTelegramEquipo({ texto: `🆘 ${colaborador.nombre} agrega sobre su SOS${ev ? ` (${ev.folio})` : ''}:\n${texto}`, excluirColaboradorId: colaborador.id });
  return `✅ Se lo mandé a ${n} persona${n === 1 ? '' : 's'} del equipo.`;
}

// /sos: deja el botón abajo y ofrece mandarlo sin ubicación (por ejemplo en la computadora).
async function comandoSos(chatId) {
  await enviarConSos(chatId, `Para mandar una emergencia toca el botón "${TEXTO_BOTON_SOS}" de abajo y acepta compartir tu ubicación. Le llega a todo el equipo.`);
  return { texto: 'Si no puedes mandar la ubicación:', botones: [[{ texto: '🆘 Mandar SOS sin ubicación', dato: 'sos:x' }]] };
}

module.exports = {
  ETAPAS_STAFF,
  TEXTO_BOTON_SOS,
  tecladoSos,
  enviarConSos,
  avisarEquipoProduccion,
  botonesEtapas,
  listoParaStaff,
  etapasAlConfirmar,
  marcarEtapa,
  enviarSos,
  ubicacionDe,
  esUbicacionSos,
  esRespuestaSos,
  atenderMotivoSos,
  comandoSos,
};
