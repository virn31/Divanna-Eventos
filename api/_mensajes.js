// api/_mensajes.js
// Mensajes directos por Telegram entre el equipo y Diana/Víctor (Admin).
// - Alguien del equipo escribe "/mensaje <texto>" (o /mensaje solo y contesta
//   encima de la pregunta del bot): le llega a los Admin con "↩️ Responder" (rs:<colaborador>).
// - El Admin toca Responder, contesta encima y su respuesta le llega a esa persona
//   con su propio "↩️ Responder" (rs:eq); el otro Admin recibe copia.
// Las preguntas del bot usan force_reply y llevan una marca de texto para saber a
// quién va la respuesta; solo se aceptan respuestas a mensajes del propio bot.
// El staff de El Vaso Maíz no usa /mensaje: habla con su coordinadora.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { telegramApi, enviarTelegram, enviarTelegramEquipo } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const MAX_TEXTO = 1500;
const MARCA_EQUIPO = '✉️ Escribe tu mensaje para Diana y Víctor';
const MARCA_RESPUESTA = '↩️ Respuesta para ';
const ID_EN_MARCA = /\((rec[A-Za-z0-9]{14})\)/;

async function leerColaborador(id) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${COLABORADORES_TABLE}/${id}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) return null;
  const r = await res.json();
  return { id: r.id, nombre: r.fields.Nombre || '', chatId: r.fields.Telegram_Chat_ID || '', activo: !!r.fields.Activo };
}

function pedirTexto(chatId, marca, placeholder) {
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: `${marca}:`,
    reply_markup: { force_reply: true, input_field_placeholder: placeholder },
  });
}

// ¿Es la respuesta a una de las preguntas de este módulo?
function esRespuestaMensaje(mensaje) {
  const previo = mensaje.reply_to_message;
  if (!previo || !previo.from || !previo.from.is_bot) return false;
  const t = String(previo.text || '');
  return t.startsWith(MARCA_EQUIPO) || t.startsWith(MARCA_RESPUESTA);
}

// Manda el mensaje de alguien del equipo a los Admin. Devuelve el texto para quien escribió.
async function mensajeAAdmins(colaborador, texto) {
  const limpio = String(texto || '').trim().slice(0, MAX_TEXTO);
  if (!limpio) return null;
  const puesto = colaborador.gerente ? ' (Gerente de El Vaso Maíz)' : '';
  const n = await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `✉️ Mensaje de ${colaborador.nombre}${puesto}:\n\n${limpio}`,
    botones: [[{ texto: '↩️ Responder', dato: `rs:${colaborador.id}` }]],
  });
  return n ? '✅ Se lo mandé a Diana y Víctor. Su respuesta te llega aquí.' : 'No pude entregar tu mensaje ahorita. Intenta en un momento o llámales.';
}

// /mensaje [texto]
async function comandoMensaje(chatId, colaborador, texto) {
  if (colaborador.rol === ROLES.STAFF) return 'Para cualquier duda escríbele a tu coordinadora.';
  if (colaborador.rol === ROLES.ADMIN) return 'Para contestarle a alguien usa el botón "↩️ Responder" de su mensaje.';
  if (texto && texto.trim()) return mensajeAAdmins(colaborador, texto);
  await pedirTexto(chatId, MARCA_EQUIPO, 'Tu mensaje');
  return null;
}

// Toque de "↩️ Responder": rs:<colaborador> (Admin) o rs:eq (equipo → Admin).
async function botonResponder(chatId, colaborador, destino) {
  if (destino === 'eq') {
    if (colaborador.rol === ROLES.STAFF || colaborador.rol === ROLES.ADMIN) return 'Esta opción no es para ti.';
    await pedirTexto(chatId, MARCA_EQUIPO, 'Tu mensaje');
    return null;
  }
  if (colaborador.rol !== ROLES.ADMIN) return 'Solo Diana y Víctor pueden contestar aquí.';
  if (!/^rec[A-Za-z0-9]{14}$/.test(destino || '')) return null;
  const persona = await leerColaborador(destino);
  if (!persona) return 'No encontré a esa persona.';
  await pedirTexto(chatId, `${MARCA_RESPUESTA}${persona.nombre} (${persona.id})`, `Respuesta para ${persona.nombre}`);
  return null;
}

// Texto escrito encima de una de las preguntas. Devuelve el texto para quien escribió.
async function atenderRespuesta(mensaje, colaborador) {
  const previo = String(mensaje.reply_to_message.text || '');
  const texto = String(mensaje.text || '').trim().slice(0, MAX_TEXTO);
  if (!texto) return null;
  if (previo.startsWith(MARCA_EQUIPO)) {
    if (colaborador.rol === ROLES.STAFF || colaborador.rol === ROLES.ADMIN) return null;
    return mensajeAAdmins(colaborador, texto);
  }
  // Respuesta de un Admin a alguien del equipo.
  if (colaborador.rol !== ROLES.ADMIN) return 'Solo Diana y Víctor pueden contestar aquí.';
  const id = (previo.match(ID_EN_MARCA) || [])[1];
  const persona = id && await leerColaborador(id);
  if (!persona || !persona.activo || !persona.chatId) return 'Esa persona ya no tiene Telegram vinculado; no le pude entregar tu respuesta.';
  const r = await enviarTelegram(persona.chatId, `✉️ ${colaborador.nombre} te respondió:\n\n${texto}`, [[{ texto: '↩️ Responder', dato: 'rs:eq' }]]);
  if (!r.ok) return `No le pude entregar tu respuesta a ${persona.nombre} (${(r.data && r.data.description) || 'error ' + r.status}).`;
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    excluirColaboradorId: colaborador.id,
    texto: `✉️ ${colaborador.nombre} le respondió a ${persona.nombre}:\n\n${texto}`,
  }).catch(err => console.error('Error mandando copia de la respuesta:', err));
  return `✅ Se lo mandé a ${persona.nombre}.`;
}

module.exports = { esRespuestaMensaje, comandoMensaje, botonResponder, atenderRespuesta };
