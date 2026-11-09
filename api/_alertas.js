// api/_alertas.js
// Avisos de emergencia y de seguridad a todo el equipo. Los usan la app
// (api/brigada-estatus.js) y el botón 🆘 SOS de Telegram (api/_etapas.js), para
// que el aviso sea el mismo venga de donde venga.

const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo } = require('./_telegram');

// { lat, lng, precision } del GPS del teléfono, o null si no viene o no es válido.
function leerUbicacion(u) {
  if (!u || typeof u !== 'object') return null;
  const lat = Number(u.lat), lng = Number(u.lng), precision = Number(u.precision);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, precision: Number.isFinite(precision) ? Math.round(precision) : null };
}

function linkMapa({ lat, lng }) {
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function textoUbicacion(ubic) {
  if (!ubic) return '📍 Sin ubicación GPS (el teléfono no dio permiso o no tenía señal).';
  return `📍 Ubicación de quien reporta: ${linkMapa(ubic)}${ubic.precision ? ` (±${ubic.precision} m)` : ''}`;
}

// Push y Telegram a todo el equipo (menos quien reporta) y correo a Diana y
// Víctor, en paralelo. Si un canal falla, los demás y el aviso en la app quedan.
// Después le confirma a quien reportó, por Telegram, a cuántos les llegó.
// desdeTelegram: el aviso salió del bot (no se habla de dejar la app abierta).
async function notificarEquipo({ asunto, mensaje, reportaId, ubic, desdeTelegram = false }) {
  const [enviado, porPush, porTelegram] = await Promise.all([
    enviarCorreoEquipo({ asunto, texto: mensaje }),
    enviarPushEquipo({ titulo: asunto, cuerpo: mensaje, excluirColaboradorId: reportaId, url: ubic ? linkMapa(ubic) : null }),
    enviarTelegramEquipo({ texto: mensaje, excluirColaboradorId: reportaId, ubicacion: ubic }),
  ]);
  if (!enviado) console.error('No se pudo enviar por correo la alerta:', asunto);
  const notaUbicacion = desdeTelegram
    ? (ubic ? '\nTu ubicación va con la alerta.' : '\nSalió sin tu ubicación.')
    : (ubic ? '\nTu ubicación va con la alerta; deja la app abierta para que se siga actualizando.' : '\nNo se pudo mandar tu ubicación: activa la ubicación del teléfono para la app.');
  await enviarTelegramEquipo({
    soloColaboradores: [reportaId],
    texto: `✅ Tu alerta se envió.\n${asunto}\nLes llegó a ${porTelegram} por Telegram y a ${porPush} teléfonos por la app` +
      `${enviado ? ', y el correo a Diana y Víctor' : ''}.` + notaUbicacion,
  });
  return { porPush, porTelegram, correo: !!enviado };
}

module.exports = { leerUbicacion, linkMapa, textoUbicacion, notificarEquipo };
