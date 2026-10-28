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

// Texto plano (sin parse_mode) para no tener que escapar lo que escriben
// clientes y brigadas.
async function enviarTelegram(chatId, texto) {
  if (!telegramConfigurado()) return { ok: false, status: 0 };
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: String(texto).slice(0, LIMITE_TEXTO),
    disable_web_page_preview: true,
  });
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
// de IDs para mandarlo solo a esas personas. Nunca lanza error.
async function enviarTelegramEquipo({ texto, roles = null, excluirColaboradorId = null, soloColaboradores = null }) {
  if (!telegramConfigurado()) return 0;
  try {
    const formula = encodeURIComponent('AND({Activo}, {Telegram_Chat_ID} != "")');
    const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
    const destinos = data.records.map(aColaborador)
      .filter(c => c.id !== excluirColaboradorId && (!roles || roles.includes(c.rol))
        && (!soloColaboradores || soloColaboradores.includes(c.id)));

    let enviados = 0;
    await Promise.all(destinos.map(async (c) => {
      const r = await enviarTelegram(c.chatId, texto);
      if (r.ok) { enviados++; return; }
      // 403: la persona bloqueó o borró el bot; se desvincula para no seguir intentando.
      if (r.status === 403) await guardarChat(c.id, '').catch(() => {});
      else console.error('Error enviando Telegram:', r.status, r.data && r.data.description);
    }));
    return enviados;
  } catch (err) {
    console.error('Error en enviarTelegramEquipo:', err.message);
    return 0;
  }
}

module.exports = {
  telegramConfigurado,
  enviarTelegram,
  borrarMensaje,
  colaboradorPorChat,
  guardarChat,
  enviarTelegramEquipo,
};
