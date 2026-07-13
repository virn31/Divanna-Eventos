// api/brigada-estatus.js
// Actualiza el estatus logístico ampliado de un evento (Preparando -> Cerrado),
// retrasos normales, emergencias, y alertas de seguridad en la ciudad.
// En emergencias y alertas de seguridad, notifica por WhatsApp de forma
// instantánea y simultánea a Diana, Víctor, y todas las brigadas activas
// ese mismo día -- DiMa nunca decide ni reasigna sola, solo alerta.

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
};

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

async function enviarWhatsApp(numeroDestino, mensaje) {
  if (!numeroDestino) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // ej. 'whatsapp:+528111111111'
  if (!sid || !token || !from) {
    console.error('Faltan variables de entorno de Twilio para enviar alerta WhatsApp');
    return;
  }
  const to = numeroDestino.startsWith('whatsapp:') ? numeroDestino : `whatsapp:${numeroDestino}`;
  const body = new URLSearchParams({ From: from, To: to, Body: mensaje });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    console.error(`Error enviando WhatsApp a ${to}:`, await res.text());
  }
}

// Notifica a Diana, Víctor, y todas las brigadas activas hoy (excepto la que reporta).
async function notificarEquipoCompleto({ mensaje, brigadaQueReportaId }) {
  const destinatarios = [];

  if (process.env.DIANA_WHATSAPP_NUMBER) destinatarios.push(process.env.DIANA_WHATSAPP_NUMBER);
  if (process.env.VICTOR_WHATSAPP_NUMBER) destinatarios.push(process.env.VICTOR_WHATSAPP_NUMBER);

  try {
    const brigadasData = await airtableGet(`${TABLES.BRIGADAS}?filterByFormula=${encodeURIComponent('{Disponible_Hoy} = TRUE()')}`);
    brigadasData.records.forEach(b => {
      if (b.id !== brigadaQueReportaId && b.fields.Celular_Lider) {
        destinatarios.push(b.fields.Celular_Lider);
      }
    });
  } catch (err) {
    console.error('No se pudo obtener la lista de brigadas activas para la alerta:', err);
  }

  await Promise.all(destinatarios.map(num => enviarWhatsApp(num, mensaje)));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { eventoId, tipo, valor, motivo, brigadaId, brigadaNombre } = req.body || {};

    if (!eventoId || !tipo) {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }

    // Necesitamos folio/ubicación del evento para armar mensajes de alerta claros.
    const eventoData = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
    const folio = eventoData.fields.Folio_Evento || eventoId;
    const ubicacion = eventoData.fields.Ubicacion || 'ubicación por confirmar';

    let fieldsToUpdate = {};
    let alertaMensaje = null;

    switch (tipo) {
      case 'estatus_logistico':
        fieldsToUpdate.Estatus_Logistico = valor;
        if (valor === 'Salió del almacén') {
          fieldsToUpdate.Timestamp_Salida = new Date().toISOString();
        }
        break;

      case 'retraso':
        fieldsToUpdate.Retraso = !!valor;
        fieldsToUpdate.Motivo_Retraso = motivo || '';
        break;

      case 'emergencia':
        fieldsToUpdate.Emergencia = !!valor;
        fieldsToUpdate.Motivo_Emergencia = motivo || '';
        if (valor) {
          alertaMensaje =
            `🆘 EMERGENCIA - Evento ${folio} (${ubicacion})\n` +
            `Brigada: ${brigadaNombre || 'sin identificar'}\n` +
            `Motivo: ${motivo || 'sin especificar'}\n` +
            `Si estás cerca, por favor acude a ayudar. Coordinemos por WhatsApp.`;
        }
        break;

      case 'alerta_seguridad':
        fieldsToUpdate.Estatus_Logistico = 'Retraso - situación de seguridad en la ciudad';
        fieldsToUpdate.Zona_Alerta_Seguridad = motivo || '';
        if (valor) {
          alertaMensaje =
            `⚠️ ALERTA DE SEGURIDAD - reportada por brigada ${brigadaNombre || ''}\n` +
            `Zona: ${motivo || 'sin especificar'}\n` +
            `Evento afectado: ${folio} (${ubicacion})\n` +
            `Eviten la zona si es posible.`;
        }
        break;

      case 'eta_confirmado':
        fieldsToUpdate.ETA_Confirmado_Brigada = valor || '';
        break;

      default:
        res.status(400).json({ error: 'Tipo de actualización no reconocido' });
        return;
    }

    await airtablePatch(TABLES.EVENTOS, eventoId, fieldsToUpdate);

    // Alertas simultáneas a todo el equipo (no bloqueamos la respuesta al cliente/brigada por esto)
    if (alertaMensaje) {
      notificarEquipoCompleto({ mensaje: alertaMensaje, brigadaQueReportaId: brigadaId }).catch(err =>
        console.error('Error notificando al equipo:', err)
      );
    }

    // Si es alerta de seguridad, además le mandamos al cliente el mensaje directo acordado.
    // (El envío real al cliente vía WhatsApp lo dispara api/whatsapp.js al detectar el
    // cambio de estatus; aquí solo dejamos el estatus y el motivo guardados en Airtable.)

    res.status(200).json({ success: true, mensajeCliente: tipo === 'alerta_seguridad' ? MENSAJE_ALERTA_SEGURIDAD_CLIENTE : null });
  } catch (err) {
    console.error('Error en brigada-estatus:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
