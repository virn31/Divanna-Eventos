// api/telegram.js
// Webhook del bot interno de Telegram del equipo. Cada colaborador lo vincula
// una vez por chat privado con "/entrar usuario PIN" (mismos datos de la app)
// y a partir de ahí puede consultar y recibe avisos según su rol:
//   /hoy      eventos de hoy           /eventos  próximos eventos
//   /alertas  emergencias y seguridad  /pedidos  pedidos por cotizar (Admin)
//   /salir    desvincular Telegram     /ayuda    lista de comandos
//
// Requiere en Vercel: TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET (Telegram lo
// manda en cada llamada; así nadie más puede hacerse pasar por Telegram).

const { ROLES, iniciarSesion } = require('./_sesion');
const { alcanceDe, leerEventos, alertasEquipoDeHoy } = require('./_eventos');
const { enviarTelegram, borrarMensaje, colaboradorPorChat, guardarChat } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS_TABLE = 'tblzLAin65BZPP2c6';
const URL_APP = 'https://divanna-eventos.vercel.app/brigadas/';

const ROL_TEXTO = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.LIDER]: 'Líder de brigada',
  [ROLES.ASISTENTE]: 'Asistente',
  [ROLES.ENCARGADA]: 'Encargada de evento',
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso) {
  if (!iso) return 'sin fecha';
  const [, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

function textoEvento(ev) {
  const lineas = [
    `📅 ${fechaCorta(ev.fecha)} · ${ev.folio}${ev.negocio ? ' · ' + ev.negocio : ''}`,
    `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
    `🚚 ${ev.estatusLogistico}${ev.invitados ? ' · 👥 ' + ev.invitados : ''}`,
  ];
  if (ev.estatusPago) lineas.push(`💰 ${ev.estatusPago}${ev.montoAdeudado ? ' · debe $' + ev.montoAdeudado : ''}`);
  if (ev.retraso && ev.motivoRetraso) lineas.push(`🚦 Retraso: ${ev.motivoRetraso}`);
  if (ev.emergencia) lineas.push(`🆘 Emergencia: ${ev.motivoEmergencia || 'sin detalle'}`);
  if (ev.zonaAlertaSeguridad) lineas.push(`⚠️ Seguridad: ${ev.zonaAlertaSeguridad}`);
  return lineas.join('\n');
}

function ayuda(colaborador) {
  if (!colaborador) {
    return 'Hola, soy el bot del equipo de Divanna Eventos y El Vaso Maíz.\n\n' +
      'Para vincular tu cuenta escribe:\n/entrar tuusuario tuPIN\n\n' +
      'Son los mismos datos de la app. Borro tu mensaje en cuanto lo leo para que tu PIN no quede en el chat.';
  }
  const comandos = [
    '/hoy — tus eventos de hoy',
    '/eventos — tus próximos eventos',
    '/alertas — emergencias y alertas de seguridad de hoy',
  ];
  if (colaborador.rol === ROLES.ADMIN) comandos.push('/pedidos — pedidos por cotizar');
  comandos.push('/salir — desvincular este Telegram');
  return `${colaborador.nombre} (${ROL_TEXTO[colaborador.rol] || colaborador.rol})\n\n${comandos.join('\n')}\n\n` +
    `Aquí te llegan las emergencias${colaborador.rol === ROLES.ADMIN ? ', los pedidos nuevos y el balance semanal' : ''}.\n` +
    `Para marcar checklist o cambiar estatus usa la app: ${URL_APP}`;
}

async function listaEventos(colaborador, soloHoy) {
  const { eventoIds } = await alcanceDe(colaborador);
  const eventos = await leerEventos(eventoIds, { soloHoy });
  if (!eventos.length) return soloHoy ? 'No tienes eventos hoy. 🙌' : 'No tienes eventos próximos.';
  const mostrados = eventos.slice(0, 10);
  const extra = eventos.length > mostrados.length ? `\n\n…y ${eventos.length - mostrados.length} más en la app.` : '';
  return `${soloHoy ? 'Tus eventos de hoy' : 'Tus próximos eventos'}:\n\n${mostrados.map(textoEvento).join('\n\n')}${extra}`;
}

async function listaAlertas() {
  const alertas = await alertasEquipoDeHoy([]);
  if (!alertas.length) return 'Sin emergencias ni alertas de seguridad hoy. ✅';
  return 'Alertas de hoy:\n\n' + alertas.map(a => [
    a.emergencia ? `🆘 ${a.folio} (${a.ubicacion || 'sin ubicación'}): ${a.motivoEmergencia || 'sin detalle'}` : null,
    a.zonaAlertaSeguridad ? `⚠️ ${a.folio}: zona ${a.zonaAlertaSeguridad}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function listaPedidos() {
  const formula = encodeURIComponent(`AND({Autorizacion_Diana} = "Pendiente", {Estado} != "Cerrado")`);
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTOS_TABLE}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  const { records } = await res.json();
  if (!records.length) return 'No hay pedidos por cotizar. ✅';
  return `Pedidos por cotizar (${records.length}):\n\n` + records.slice(0, 10).map(r => {
    const f = r.fields;
    const servicios = (f.Servicios_Solicitados || '').split('\n').filter(Boolean);
    return `📝 ${f.Folio_Evento || ''} · ${fechaCorta(f.Fecha_Evento)}\n` +
      `${servicios.slice(0, 3).join(', ')}${servicios.length > 3 ? '…' : ''}` +
      (f.Monto_Estimado_IA ? `\nEstimado DiMa: $${Number(f.Monto_Estimado_IA).toLocaleString('es-MX')}` : '');
  }).join('\n\n') + `\n\nCotízalos en ${URL_APP}`;
}

async function entrar(chatId, mensaje, argumentos) {
  // El mensaje trae el PIN: se borra primero, pase lo que pase.
  await borrarMensaje(chatId, mensaje.message_id);
  const [usuarioRaw, pin] = argumentos;
  const usuario = String(usuarioRaw || '').toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(usuario) || !/^\d{6}$/.test(String(pin || ''))) {
    return 'Escríbelo así: /entrar tuusuario 123456';
  }
  const sesion = await iniciarSesion(usuario, String(pin));
  if (!sesion) {
    // Pausa en cada intento fallido para frenar a quien intente adivinar PINs.
    await new Promise(r => setTimeout(r, 1500));
    return 'Usuario o PIN incorrecto.';
  }
  // Si este Telegram estaba vinculado a otra persona, se le quita.
  const anterior = await colaboradorPorChat(chatId);
  if (anterior && anterior.id !== sesion.colaborador.id) await guardarChat(anterior.id, '');
  await guardarChat(sesion.colaborador.id, chatId);
  return `Listo, quedó vinculado tu Telegram. (Borré tu mensaje con el PIN.)\n\n${ayuda(sesion.colaborador)}`;
}

async function responder(mensaje) {
  const chatId = mensaje.chat.id;
  const texto = String(mensaje.text || '').trim();
  const [primera, ...argumentos] = texto.split(/\s+/);
  const comando = (primera || '').toLowerCase().replace(/@.*$/, '');

  if (comando === '/entrar') return entrar(chatId, mensaje, argumentos);

  const colaborador = await colaboradorPorChat(chatId);
  if (!colaborador) return ayuda(null);

  switch (comando) {
    case '/hoy': return listaEventos(colaborador, true);
    case '/eventos': return listaEventos(colaborador, false);
    case '/alertas': return listaAlertas();
    case '/pedidos':
      return colaborador.rol === ROLES.ADMIN ? listaPedidos() : 'Esa consulta es solo para Diana y Víctor.';
    case '/salir':
      await guardarChat(colaborador.id, '');
      return 'Listo, desvinculé este Telegram. Ya no te llegarán avisos aquí. Para volver: /entrar tuusuario tuPIN';
    default:
      return ayuda(colaborador);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secreto || req.headers['x-telegram-bot-api-secret-token'] !== secreto) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const mensaje = (req.body || {}).message;
  // Siempre 200 a Telegram (si no, reintenta el mismo mensaje una y otra vez).
  if (!mensaje || !mensaje.chat || typeof mensaje.text !== 'string') { res.status(200).json({ ok: true }); return; }

  try {
    if (mensaje.chat.type !== 'private') {
      // Si alguien escribe su PIN en un grupo, se intenta borrar.
      if (mensaje.text.toLowerCase().startsWith('/entrar')) await borrarMensaje(mensaje.chat.id, mensaje.message_id);
      if (mensaje.text.startsWith('/')) {
        await enviarTelegram(mensaje.chat.id, 'Escríbeme por mensaje privado: aquí no puedo mostrar información del equipo.');
      }
    } else {
      await enviarTelegram(mensaje.chat.id, await responder(mensaje));
    }
  } catch (err) {
    console.error('Error en telegram:', err);
    await enviarTelegram(mensaje.chat.id, 'Tuve un problema para responder. Intenta de nuevo en un momento.').catch(() => {});
  }
  res.status(200).json({ ok: true });
};
