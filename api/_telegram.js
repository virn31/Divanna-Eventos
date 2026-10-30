// api/_telegram.js
// Bot interno de Telegram del equipo: envío de mensajes y relación entre
// chats de Telegram y COLABORADORES (campo Telegram_Chat_ID). El webhook que
// recibe los comandos está en api/telegram.js.
//
// Requiere TELEGRAM_BOT_TOKEN en Vercel (lo da @BotFather).

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const LIMITE_TEXTO = 4000; // Telegram acepta 4096 caracteres por mensaje.

function telegramConfigurado() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function telegramApi(metodo, cuerpo) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, status: res.status, data };
}

// Archivo (por ejemplo el PDF del recibo). Multipart, no JSON.
async function enviarDocumento(chatId, contenido, nombre, texto = '', tipo = 'application/pdf') {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (texto) form.append('caption', texto.slice(0, 1024));
  form.append('document', new Blob([contenido], { type: tipo }), nombre);
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  return { ok: !!(res.ok && data.ok), error: data.description || '' };
}

// Botones bajo el mensaje: lista de renglones de { texto, dato } (dato = callback_data, máx. 64 bytes).
function teclado(botones) {
  return { inline_keyboard: botones.map(fila => fila.map(b => ({ text: b.texto, callback_data: b.dato }))) };
}

// Texto plano (sin parse_mode) para no tener que escapar lo que escriben
// clientes y brigadas. "botones" es opcional.
async function enviarTelegram(chatId, texto, botones = null) {
  if (!telegramConfigurado()) return { ok: false, status: 0 };
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: String(texto).slice(0, LIMITE_TEXTO),
    disable_web_page_preview: true,
    ...(botones ? { reply_markup: teclado(botones) } : {}),
  });
}

// Cambia el texto (y los botones) de un mensaje que ya mandó el bot.
async function editarTelegram(chatId, mensajeId, texto, botones = null) {
  if (!telegramConfigurado()) return { ok: false, status: 0 };
  return telegramApi('editMessageText', {
    chat_id: chatId,
    message_id: mensajeId,
    text: String(texto).slice(0, LIMITE_TEXTO),
    disable_web_page_preview: true,
    reply_markup: teclado(botones || []),
  });
}

// Respuesta a un toque de botón (quita el relojito; "alerta" lo muestra como ventana).
async function responderBoton(callbackId, texto = '', alerta = false) {
  if (!telegramConfigurado()) return;
  await telegramApi('answerCallbackQuery', { callback_query_id: callbackId, text: String(texto).slice(0, 190), show_alert: alerta }).catch(() => {});
}

async function borrarMensaje(chatId, mensajeId) {
  if (!telegramConfigurado()) return;
  await telegramApi('deleteMessage', { chat_id: chatId, message_id: mensajeId }).catch(() => {});
}

function aColaborador(r) {
  return {
    id: r.id,
    nombre: r.fields.Nombre || '',
    rol: r.fields.Rol || '',
    brigadaId: (r.fields.Brigada || [])[0] || null,
    chatId: r.fields.Telegram_Chat_ID || '',
    coordinaStaff: !!r.fields.Coordina_Staff,
    gerente: !!r.fields.Gerente_Vaso_Maiz,
    cursoAvance: Number(r.fields.Curso_Avance) || 0,
  };
}

// Colaborador activo vinculado a ese chat de Telegram, o null.
async function colaboradorPorChat(chatId) {
  if (!/^-?\d{1,20}$/.test(String(chatId))) return null;
  const formula = encodeURIComponent(`AND({Telegram_Chat_ID} = "${chatId}", {Activo})`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}&maxRecords=1`);
  const r = data.records[0];
  return r && Object.values(ROLES).includes(r.fields.Rol) ? aColaborador(r) : null;
}

async function guardarChat(colaboradorId, chatId) {
  await airtable(COLABORADORES_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: colaboradorId, fields: { Telegram_Chat_ID: chatId ? String(chatId) : '' } }] }),
  });
}

// Manda un aviso a los colaboradores activos con Telegram vinculado.
// roles: lista de roles que lo reciben (null = todos); soloColaboradores: lista
// de IDs para mandarlo solo a esas personas; ubicacion: { lat, lng } para
// mandar además el pin del mapa. Devuelve a cuántos les llegó. Nunca lanza error.
// Si se pasa una lista de errores, ahí quedan los motivos de lo que no se entregó.
async function enviarTelegramEquipo({ texto, roles = null, excluirColaboradorId = null, soloColaboradores = null, ubicacion = null, errores = null, botones = null }) {
  if (!telegramConfigurado()) {
    if (errores) errores.push('Telegram sin configurar (falta TELEGRAM_BOT_TOKEN)');
    return 0;
  }
  try {
    const formula = encodeURIComponent('AND({Activo}, {Telegram_Chat_ID} != "")');
    const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
    const destinos = data.records.map(aColaborador)
      .filter(c => c.id !== excluirColaboradorId && (!roles || roles.includes(c.rol))
        && (!soloColaboradores || soloColaboradores.includes(c.id)));

    let enviados = 0;
    await Promise.all(destinos.map(async (c) => {
      const r = await enviarTelegram(c.chatId, texto, botones);
      if (r.ok) {
        enviados++;
        if (ubicacion) await telegramApi('sendLocation', { chat_id: c.chatId, latitude: ubicacion.lat, longitude: ubicacion.lng }).catch(() => {});
        return;
      }
      // 403: la persona bloqueó o borró el bot; se desvincula para no seguir intentando.
      if (r.status === 403) await guardarChat(c.id, '').catch(() => {});
      else console.error('Error enviando Telegram:', r.status, r.data && r.data.description);
      if (errores) errores.push(`Telegram a ${c.nombre || 'alguien'}: ${r.status === 403 ? 'bloqueó el bot, quedó desvinculado' : (r.data && r.data.description) || 'error ' + r.status}`);
    }));
    return enviados;
  } catch (err) {
    console.error('Error en enviarTelegramEquipo:', err.message);
    if (errores) errores.push(`Telegram: ${err.message}`);
    return 0;
  }
}

module.exports = {
  telegramConfigurado,
  telegramApi,
  enviarTelegram,
  enviarDocumento,
  editarTelegram,
  responderBoton,
  borrarMensaje,
  colaboradorPorChat,
  guardarChat,
  enviarTelegramEquipo,
};
