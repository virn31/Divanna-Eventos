// api/brigada-estatus.js
// Actualiza el estatus logístico ampliado de un evento (Preparando -> Cerrado),
// retrasos normales, emergencias, y alertas de seguridad en la ciudad.
// En emergencias y alertas de seguridad manda una notificación push con sonido
// y vibración a los teléfonos de todo el equipo (api/_push.js) y un correo a
// Diana y Víctor -- DiMa nunca decide ni reasigna sola, solo alerta.
// Si el teléfono manda su GPS, la alerta lleva la ubicación (link al mapa y
// pin en Telegram), y con tipo "ubicacion" la app la actualiza cada minuto
// mientras la emergencia siga activa. Quien reporta recibe confirmación en Telegram.
//
// Requiere sesión. El asistente solo marca la carga y lanza alertas; el resto
// de cambios son del líder, la encargada del evento o un admin.

const { enviarCorreoEquipo } = require('./_google-integrations');
const { ROLES, requerirSesion, puedeOperarEvento } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
};

const TIPOS_ASISTENTE = ['checklist_item', 'emergencia', 'alerta_seguridad', 'ubicacion'];

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

const MENSAJE_ALERTA_SEGURIDAD_CLIENTE =
  'Hay una situación de inseguridad en la ciudad que nos está retrasando, ' +
  'tan pronto podamos nos movemos, gracias por su paciencia.';

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable GET error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function airtablePatch(tableId, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Push y Telegram a todo el equipo (menos quien reporta) y correo a Diana y
// Víctor, en paralelo. Si un canal falla, los demás y el aviso en la app quedan.
// Después le confirma a quien reportó, por Telegram, a cuántos les llegó.
async function notificarEquipo({ asunto, mensaje, reportaId, ubic }) {
  const [enviado, porPush, porTelegram] = await Promise.all([
    enviarCorreoEquipo({ asunto, texto: mensaje }),
    enviarPushEquipo({ titulo: asunto, cuerpo: mensaje, excluirColaboradorId: reportaId, url: ubic ? linkMapa(ubic) : null }),
    enviarTelegramEquipo({ texto: mensaje, excluirColaboradorId: reportaId, ubicacion: ubic }),
  ]);
  if (!enviado) console.error('No se pudo enviar por correo la alerta:', asunto);
  await enviarTelegramEquipo({
    soloColaboradores: [reportaId],
    texto: `✅ Tu alerta se envió.\n${asunto}\nLes llegó a ${porTelegram} por Telegram y a ${porPush} teléfonos por la app` +
      `${enviado ? ', y el correo a Diana y Víctor' : ''}.` +
      (ubic ? '\nTu ubicación va con la alerta; deja la app abierta para que se siga actualizando.' : '\nNo se pudo mandar tu ubicación: activa la ubicación del teléfono para la app.'),
  });
  return { porPush, porTelegram, correo: !!enviado };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, [ROLES.LIDER, ROLES.ASISTENTE, ROLES.ENCARGADA, ROLES.ADMIN]);
    if (!colaborador) return;

    const { eventoId, tipo, valor, motivo } = req.body || {};
    const ubic = leerUbicacion((req.body || {}).ubicacion);

    if (!/^rec[A-Za-z0-9]{14}$/.test(eventoId || '') || !tipo) {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }
    if (colaborador.rol === ROLES.ASISTENTE && !TIPOS_ASISTENTE.includes(tipo)) {
      res.status(403).json({ error: 'Este cambio lo hace el líder de la brigada.' });
      return;
    }

    // Necesitamos folio/ubicación del evento para armar mensajes de alerta claros.
    const eventoData = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
    if (!puedeOperarEvento(colaborador, eventoData.fields)) {
      res.status(403).json({ error: 'Este evento no está asignado a ti.' });
      return;
    }
    const reporta = colaborador.nombre || 'sin identificar';
    const folio = eventoData.fields.Folio_Evento || eventoId;
    const ubicacion = eventoData.fields.Ubicacion || 'ubicación por confirmar';

    let fieldsToUpdate = {};
    let alertaMensaje = null;
    let alertaAsunto = '';

    switch (tipo) {
      case 'checklist_item': {
        // valor = índice del item, motivo (reusado) = 'marcar' o 'desmarcar'
        let marcados = [];
        try { marcados = JSON.parse(eventoData.fields.Checklist_Items_Marcados || '[]'); } catch (e) { marcados = []; }
        const idx = parseInt(valor, 10);
        if (motivo === 'desmarcar') {
          marcados = marcados.filter(i => i !== idx);
        } else if (!marcados.includes(idx)) {
          marcados.push(idx);
        }
        fieldsToUpdate.Checklist_Items_Marcados = JSON.stringify(marcados);
        break;
      }

      case 'estatus_logistico': {
        // Bloqueo 1: no se puede avanzar de "Preparando" a "Salió del almacén" (o después)
        // si quedan items del checklist de carga sin marcar.
        const itemsRaw = (eventoData.fields.Checklist_Items || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (itemsRaw.length > 0 && valor !== 'Preparando') {
          let marcados = [];
          try { marcados = JSON.parse(eventoData.fields.Checklist_Items_Marcados || '[]'); } catch (e) { marcados = []; }
          if (marcados.length < itemsRaw.length) {
            res.status(409).json({ error: 'Faltan artículos por marcar como cargados antes de salir del almacén' });
            return;
          }
        }

        // Bloqueo 2: clientes semáforo Amarillo/Rojo deben estar LIQUIDADOS al 100%
        // antes de "Montando" (momento real de entrega/montaje) -- salvo que Diana
        // haya autorizado la excepción de crédito para ese evento específico.
        if (valor === 'Montando') {
          const requiereLiquidacion = !!eventoData.fields.Requiere_Liquidacion_Anticipada;
          const estatusPago = eventoData.fields.Estatus_Pago || '';
          const yaLiquidado = estatusPago === 'Liquidado 100%';
          const creditoAutorizado = estatusPago === 'Decorador con crédito abierto - autorizado por Diana';
          if (requiereLiquidacion && !yaLiquidado && !creditoAutorizado) {
            res.status(409).json({
              error: 'Este cliente debe estar LIQUIDADO al 100% antes de montar. Verifica con Diana antes de continuar (o pídele que autorice crédito abierto si aplica).',
            });
            return;
          }
        }

        fieldsToUpdate.Estatus_Logistico = valor;
        if (valor === 'Salió del almacén') {
          fieldsToUpdate.Timestamp_Salida = new Date().toISOString();
        }
        break;
      }

      case 'retraso':
        fieldsToUpdate.Retraso = !!valor;
        fieldsToUpdate.Motivo_Retraso = motivo || '';
        break;

      case 'emergencia':
        fieldsToUpdate.Emergencia = !!valor;
        fieldsToUpdate.Motivo_Emergencia = motivo || '';
        if (valor) {
          alertaAsunto = `🆘 EMERGENCIA - Evento ${folio}`;
          alertaMensaje =
            `🆘 EMERGENCIA - Evento ${folio} (${ubicacion})\n` +
            `Reporta: ${reporta}\n` +
            `Motivo: ${motivo || 'sin especificar'}\n` +
            `${textoUbicacion(ubic)}\n` +
            `Si estás cerca, por favor acude a ayudar. Coordinemos por teléfono.`;
        }
        break;

      case 'alerta_seguridad':
        fieldsToUpdate.Estatus_Logistico = 'Retraso - situación de seguridad en la ciudad';
        fieldsToUpdate.Zona_Alerta_Seguridad = motivo || '';
        if (valor) {
          alertaAsunto = `⚠️ Alerta de seguridad - Evento ${folio}`;
          alertaMensaje =
            `⚠️ ALERTA DE SEGURIDAD - reportada por ${reporta}\n` +
            `Zona: ${motivo || 'sin especificar'}\n` +
            `Evento afectado: ${folio} (${ubicacion})\n` +
            `${textoUbicacion(ubic)}\n` +
            `Eviten la zona si es posible.`;
        }
        break;

      case 'ubicacion':
        // Actualización periódica desde la app mientras la emergencia o la
        // alerta de seguridad siguen activas. No manda avisos.
        if (!ubic) { res.status(400).json({ error: 'Ubicación inválida' }); return; }
        if (!eventoData.fields.Emergencia && !eventoData.fields.Zona_Alerta_Seguridad) {
          res.status(200).json({ success: true, activa: false });
          return;
        }
        break;

      case 'eta_confirmado':
        fieldsToUpdate.ETA_Confirmado_Brigada = valor || '';
        break;

      default:
        res.status(400).json({ error: 'Tipo de actualización no reconocido' });
        return;
    }

    if (ubic && ['emergencia', 'alerta_seguridad', 'ubicacion'].includes(tipo) && (valor || tipo === 'ubicacion')) {
      fieldsToUpdate.Ubicacion_Alerta = `${ubic.lat},${ubic.lng}`;
      fieldsToUpdate.Ubicacion_Alerta_Hora = new Date().toISOString();
    }

    await airtablePatch(TABLES.EVENTOS, eventoId, fieldsToUpdate);

    // Se espera el envío antes de responder: en Vercel la función se congela al
    // responder y un correo pendiente nunca saldría.
    let enviados = null;
    if (alertaMensaje) {
      enviados = await notificarEquipo({ asunto: alertaAsunto, mensaje: alertaMensaje, reportaId: colaborador.id, ubic }).catch(err => {
        console.error('Error notificando al equipo:', err);
        return null;
      });
    }

    // En alerta de seguridad, la app le muestra a la brigada el mensaje acordado
    // para que se lo comunique al cliente por teléfono.
    res.status(200).json({
      success: true,
      activa: tipo === 'ubicacion' ? true : undefined,
      enviados,
      mensajeCliente: tipo === 'alerta_seguridad' ? MENSAJE_ALERTA_SEGURIDAD_CLIENTE : null,
    });
  } catch (err) {
    console.error('Error en brigada-estatus:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
