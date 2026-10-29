// api/_produccion.js
// Encargado de producción de El Vaso Maíz (decisión de Víctor 2026-10-29): la
// gerente elige en la app quién prepara la producción de cada evento
// (EVENTOS.Encargado_Produccion). A esa persona le llegan por Telegram:
// - dos días antes, la lista de producción del día para revisar inventario y
//   reportar los insumos que falten;
// - el mismo día, la producción de hoy para confirmar que hay todos los ingredientes.
// Si dos eventos del mismo día tienen al mismo encargado, le llega un solo
// mensaje con los dos. Lo manda el cron diario (api/produccion-diaria.js, 8:00
// de Culiacán) y, si se asigna con menos de dos días, la app en ese momento.
// Las respuestas (botones "Tenemos todo" / "Reportar insumos") le llegan a la
// gerente con copia a Diana y Víctor y quedan en EVENTOS.Produccion_Respuesta.
// EVENTOS.Produccion_Avisos guarda qué se mandó a quién (no se repite).

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { leerProductos, produccionVasoMaiz } = require('./_productos');
const { telegramApi, enviarTelegram, enviarTelegramEquipo } = require('./_telegram');
const { horaTexto, fechaTexto } = require('./_staff');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS = 'tblzLAin65BZPP2c6';
const DIAS_ANTES = 2;
const TIPOS = { previo: 'previo', dia: 'dia' };
const MARCA_INSUMOS = '📝 Insumos que faltan para la producción del ';
const FECHA_EN_MARCA = /\((\d{4}-\d{2}-\d{2})\)/;
const MAX_TEXTO = 1500;

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

function hoyCuliacan() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
}

function sumarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');

// ---------- Datos ----------

// Eventos autorizados de El Vaso Maíz de esa fecha con encargado de producción.
async function eventosDelDia(fecha) {
  const formula = `AND({Autorizacion_Diana} = "SI", {Estado} != "Cerrado", OR({Negocio} = "El Vaso Maiz", {Piezas_Vaso_Maiz} > 0), DATESTR({Fecha_Evento}) = "${fecha}")`;
  const data = await airtable(`${EVENTOS}?filterByFormula=${encodeURIComponent(formula)}&sort%5B0%5D%5Bfield%5D=Hora_Inicio&sort%5B0%5D%5Bdirection%5D=asc`);
  return data.records
    .map(r => ({
      id: r.id,
      folio: r.fields.Folio_Evento || '',
      fecha: r.fields.Fecha_Evento || fecha,
      horaInicio: r.fields.Hora_Inicio || '',
      ubicacion: r.fields.Ubicacion || '',
      instrucciones: r.fields.Instrucciones_Equipo || '',
      productos: leerProductos(r.fields.Productos),
      encargadoId: (r.fields.Encargado_Produccion || [])[0] || '',
      avisos: r.fields.Produccion_Avisos || '',
      respuesta: r.fields.Produccion_Respuesta || '',
    }))
    .filter(e => e.encargadoId);
}

async function leerColaborador(id) {
  const r = await airtable(`${COLABORADORES_TABLE}/${id}`).catch(() => null);
  if (!r) return null;
  return { id: r.id, nombre: r.fields.Nombre || '', chatId: r.fields.Telegram_Chat_ID || '', activo: !!r.fields.Activo };
}

// Gerente(s) de El Vaso Maíz y Admin: a quienes les llegan las respuestas.
async function destinatariosRespuesta() {
  const formula = encodeURIComponent(`AND({Activo}, OR({Gerente_Vaso_Maiz}, {Rol} = "${ROLES.ADMIN}"))`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
  return data.records.map(r => r.id);
}

async function avisarGerencia(texto) {
  const ids = await destinatariosRespuesta().catch(err => { console.error('No se pudo leer a la gerencia:', err.message); return []; });
  if (!ids.length) return 0;
  return enviarTelegramEquipo({ texto, soloColaboradores: ids });
}

// Quién puede ser encargado de producción: el staff de la gerente (Admin:
// todo el staff), las encargadas de evento y la gerente. Activos.
async function opcionesProduccion(colaborador) {
  const formula = encodeURIComponent(`AND({Activo}, OR({Rol} = "${ROLES.STAFF}", {Rol} = "${ROLES.ENCARGADA}", {Gerente_Vaso_Maiz}))`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
  return data.records
    .filter(r => r.fields.Rol !== ROLES.STAFF || colaborador.rol === ROLES.ADMIN || (r.fields.Coordinadora || []).includes(colaborador.id))
    .map(r => ({ id: r.id, nombre: r.fields.Nombre || 'Sin nombre', conTelegram: !!r.fields.Telegram_Chat_ID }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- Textos ----------

function listaProduccion(eventos) {
  const totales = new Map();
  const sueltas = [];
  let piezas = 0;
  for (const ev of eventos) {
    const p = produccionVasoMaiz(ev.productos);
    p.productos.forEach(x => totales.set(x.nombre, (totales.get(x.nombre) || 0) + x.cantidad));
    p.sinDesglose.forEach(x => sueltas.push(`${x.cantidad} pieza(s) suelta(s) de ${ev.folio}${x.nota ? ': ' + x.nota : ' (sin especificar: pregúntale a la gerente)'}`));
    piezas += p.piezas;
  }
  const lineas = [...totales].map(([nombre, n]) => `• ${nombre}: ${n}`);
  sueltas.forEach(s => lineas.push(`• ${s}`));
  if (!lineas.length) lineas.push('• ⚠️ Este evento no tiene productos registrados: pregúntale a la gerente qué se prepara.');
  return { lineas, piezas };
}

function textoAviso(tipo, nombre, fecha, eventos) {
  const { lineas, piezas } = listaProduccion(eventos);
  const encabezado = tipo === TIPOS.dia
    ? `Hola ${nombre} 👋 esta es la producción del día de hoy (${fechaTexto(fecha)}):`
    : `Hola ${nombre} 👋 esta es la producción que necesitamos para el ${fechaTexto(fecha)}:`;
  const detalle = eventos.map(ev => [
    `🌽 ${ev.folio}${ev.horaInicio ? ' · empieza ' + horaTexto(ev.horaInicio) : ' · hora por confirmar'}${ev.ubicacion ? ' · ' + ev.ubicacion : ''}`,
    ev.instrucciones ? `   📌 ${ev.instrucciones}` : null,
  ].filter(Boolean).join('\n'));
  const cierre = tipo === TIPOS.dia
    ? 'Por favor confirma si tenemos todos los ingredientes.'
    : 'Por favor verifica el inventario y repórtame las necesidades de insumos.';
  return [encabezado, '', ...lineas, piezas ? `Total: ${piezas} piezas` : null, '', ...detalle, '', cierre]
    .filter(l => l !== null).join('\n');
}

function botonesAviso(tipo, fecha) {
  return [[
    { texto: '✅ Tenemos todo', dato: `pr:o:${tipo}:${fecha}` },
    { texto: tipo === TIPOS.dia ? '⚠️ Falta algo' : '📝 Reportar insumos', dato: `pr:f:${tipo}:${fecha}` },
  ]];
}

const marcaAviso = (tipo, encargadoId) => `${tipo}:${encargadoId}`;
const ahoraTexto = () => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mazatlan', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date());

// ---------- Envío ----------

// Manda el aviso (previo o del día) de esa fecha a cada encargado que no lo
// haya recibido. soloEncargado limita a una persona. Devuelve
// { enviados: [nombres], fallidos: [{ nombre, motivo }] }.
async function enviarAvisos(tipo, fecha, { soloEncargado = null } = {}) {
  const eventos = (await eventosDelDia(fecha)).filter(e => !soloEncargado || e.encargadoId === soloEncargado);
  const porEncargado = new Map();
  for (const ev of eventos) {
    if (ev.avisos.split('\n').some(l => l.startsWith(marcaAviso(tipo, ev.encargadoId) + ' '))) continue;
    if (!porEncargado.has(ev.encargadoId)) porEncargado.set(ev.encargadoId, []);
    porEncargado.get(ev.encargadoId).push(ev);
  }
  const enviados = [], fallidos = [];
  for (const [encargadoId, suyos] of porEncargado) {
    const persona = await leerColaborador(encargadoId);
    const nombre = (persona && persona.nombre) || 'el encargado';
    if (!persona || !persona.activo) { fallidos.push({ nombre, motivo: 'ya no está activo' }); continue; }
    if (!persona.chatId) { fallidos.push({ nombre, motivo: 'no ha activado su Telegram' }); continue; }
    const r = await enviarTelegram(persona.chatId, textoAviso(tipo, nombre, fecha, suyos), botonesAviso(tipo, fecha));
    if (!r.ok) { fallidos.push({ nombre, motivo: (r.data && r.data.description) || `error ${r.status}` }); continue; }
    enviados.push(nombre);
    const linea = `${marcaAviso(tipo, encargadoId)} ${new Date().toISOString()}`;
    await airtable(EVENTOS, {
      method: 'PATCH',
      body: JSON.stringify({ records: suyos.map(ev => ({ id: ev.id, fields: { Produccion_Avisos: ev.avisos ? `${ev.avisos}\n${linea}` : linea } })) }),
    });
  }
  return { enviados, fallidos };
}

// Cron diario: aviso previo de los eventos de mañana y pasado mañana (mañana
// solo si se asignó tarde y aún no lo recibe) y aviso del día de hoy.
async function avisosDelDia() {
  const hoy = hoyCuliacan();
  const resultados = [];
  for (const [tipo, fecha] of [[TIPOS.previo, sumarDias(hoy, DIAS_ANTES)], [TIPOS.previo, sumarDias(hoy, 1)], [TIPOS.dia, hoy]]) {
    resultados.push({ tipo, fecha, ...(await enviarAvisos(tipo, fecha)) });
  }
  const fallas = resultados.flatMap(r => r.fallidos.map(f => `• ${f.nombre} (${r.tipo === TIPOS.dia ? 'hoy' : fechaTexto(r.fecha)}): ${f.motivo}`));
  if (fallas.length) await avisarGerencia(`⚠️ No pude mandar la lista de producción a:\n${fallas.join('\n')}\nAvísales por otro medio.`);
  return resultados;
}

// Al asignar desde la app: si el evento es en dos días o menos, le llega ya la
// lista (del día si es hoy); si no, un aviso corto de que le tocará.
async function avisarAsignacion(encargadoId, ev) {
  const hoy = hoyCuliacan();
  if (!esFecha(ev.fecha) || ev.fecha < hoy) return { enviados: [], fallidos: [] };
  if (ev.fecha <= sumarDias(hoy, DIAS_ANTES)) {
    return enviarAvisos(ev.fecha === hoy ? TIPOS.dia : TIPOS.previo, ev.fecha, { soloEncargado: encargadoId });
  }
  const persona = await leerColaborador(encargadoId);
  const nombre = (persona && persona.nombre) || 'el encargado';
  if (!persona || !persona.chatId) return { enviados: [], fallidos: [{ nombre, motivo: 'no ha activado su Telegram' }] };
  const r = await enviarTelegram(persona.chatId, `🍳 Hola ${nombre}, te toca la producción de ${ev.folio || 'un evento'} (${fechaTexto(ev.fecha)}). Dos días antes te mando aquí la lista de lo que hay que preparar.`);
  return r.ok ? { enviados: [nombre], fallidos: [] } : { enviados: [], fallidos: [{ nombre, motivo: (r.data && r.data.description) || `error ${r.status}` }] };
}

// ---------- Respuestas del encargado ----------

async function anotarRespuesta(eventos, texto) {
  const linea = `[${ahoraTexto()}] ${texto}`;
  await airtable(EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: eventos.map(ev => ({ id: ev.id, fields: { Produccion_Respuesta: ev.respuesta ? `${ev.respuesta}\n${linea}` : linea } })) }),
  });
}

async function suyosDelDia(colaborador, fecha) {
  if (!esFecha(fecha)) return [];
  return (await eventosDelDia(fecha)).filter(e => e.encargadoId === colaborador.id);
}

// Botón pr:o|f:<tipo>:<fecha>. Devuelve { aviso, alerta, textoFinal }.
async function botonProduccion(chatId, colaborador, accion, tipo, fecha) {
  if (!Object.values(TIPOS).includes(tipo)) return { aviso: '' };
  const suyos = await suyosDelDia(colaborador, fecha);
  if (!suyos.length) return { aviso: 'Esta producción ya no está a tu cargo.', alerta: true };
  const cuando = tipo === TIPOS.dia ? 'de hoy' : `del ${fechaTexto(fecha)}`;
  const folios = suyos.map(e => e.folio).join(', ');
  if (accion === 'o') {
    await anotarRespuesta(suyos, `✅ ${colaborador.nombre}: tenemos todo (${tipo === TIPOS.dia ? 'aviso del día' : 'aviso previo'})`);
    await avisarGerencia(`✅ ${colaborador.nombre} confirmó que tenemos todo para la producción ${cuando} (${folios}).`);
    return { aviso: '¡Gracias! Le avisé a la gerente.', textoFinal: '✅ Respondiste que tenemos todo. ¡Gracias!' };
  }
  if (accion === 'f') {
    await telegramApi('sendMessage', {
      chat_id: chatId,
      text: `${MARCA_INSUMOS}${fechaTexto(fecha)} (${fecha}):\nEscribe aquí lo que falta, con cantidades.`,
      reply_markup: { force_reply: true, input_field_placeholder: 'Ej. 3 kg de fresa, 2 botes de crema' },
    });
    return { aviso: 'Escribe lo que falta' };
  }
  return { aviso: '' };
}

function esRespuestaProduccion(mensaje) {
  const previo = mensaje.reply_to_message;
  return !!(previo && previo.from && previo.from.is_bot && String(previo.text || '').startsWith(MARCA_INSUMOS));
}

// Texto escrito encima de "Insumos que faltan…". Devuelve el texto para quien escribió.
async function atenderRespuestaProduccion(mensaje, colaborador) {
  const texto = String(mensaje.text || '').trim().slice(0, MAX_TEXTO);
  const fecha = (String(mensaje.reply_to_message.text || '').match(FECHA_EN_MARCA) || [])[1];
  if (!texto || !fecha) return null;
  const suyos = await suyosDelDia(colaborador, fecha);
  if (!suyos.length) return 'Esta producción ya no está a tu cargo; no lo registré.';
  await anotarRespuesta(suyos, `📝 ${colaborador.nombre}: faltan ${texto}`);
  const n = await avisarGerencia(`📝 ${colaborador.nombre} (producción del ${fechaTexto(fecha)}, ${suyos.map(e => e.folio).join(', ')}) reporta que faltan:\n\n${texto}`);
  return n ? '✅ Se lo mandé a la gerente, a Diana y a Víctor.' : 'Lo anoté, pero no pude avisarle a la gerente ahorita. Avísale por otro medio.';
}

module.exports = {
  TIPOS,
  opcionesProduccion,
  enviarAvisos,
  avisosDelDia,
  avisarAsignacion,
  botonProduccion,
  esRespuestaProduccion,
  atenderRespuestaProduccion,
  textoAviso,
};
