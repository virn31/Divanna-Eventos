// api/whatsapp.js
// Webhook de DiMa OS: recibe mensajes de WhatsApp vía Twilio,
// usa Claude para clasificar el negocio y extraer datos del evento,
// guarda todo en Airtable, y responde al cliente por WhatsApp.

const crypto = require('crypto');

// ---------- CONFIGURACIÓN ----------
const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H'; // Base "DiMa OS"
const TABLES = {
  CLIENTES: 'tblgViisKQRG9TVjh',
  EVENTOS: 'tblzLAin65BZPP2c6',
  COTIZACIONES: 'tblVv2AiF57mBAFiR',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  INVENTARIO: 'tblG7pqvkyGTzBxx0',
  CONVERSACIONES: 'tblOk1USNMTI29FYX',
  GASTOS: 'tblfuEW0oiX4xTw7T',
  BALANCES: 'tblRJYJHhHzyKcaWH',
};

const CLAUDE_MODEL = 'claude-sonnet-5';

// ---------- UTILIDADES DE AIRTABLE ----------
async function airtableRequest(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Airtable error ${res.status}: ${errText}`);
  }
  return res.json();
}

async function findClientByPhone(phone) {
  const formula = encodeURIComponent(`{Telefono_WhatsApp} = "${phone}"`);
  const data = await airtableRequest(`${TABLES.CLIENTES}?filterByFormula=${formula}&maxRecords=1`);
  return data.records[0] || null;
}

async function createClient(phone, profileName) {
  const data = await airtableRequest(TABLES.CLIENTES, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Nombre: profileName || 'Cliente WhatsApp',
          Telefono_WhatsApp: phone,
          Tipo_Cliente: 'Particular',
          Nivel: 'Nuevo',
        },
      }],
    }),
  });
  return data.records[0];
}

async function findActiveEvent(clientRecordId) {
  const formula = encodeURIComponent(
    `AND(FIND("${clientRecordId}", ARRAYJOIN({Cliente})), {Estado} != "Cerrado")`
  );
  const data = await airtableRequest(`${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=desc`);
  return data.records[0] || null;
}

async function createEvent(clientRecordId, negocio) {
  const folio = `EVT-${Date.now().toString().slice(-6)}`;
  const data = await airtableRequest(TABLES.EVENTOS, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Folio_Evento: folio,
          Negocio: negocio,
          Estado: 'Identificando intencion',
          Cliente: [clientRecordId],
        },
      }],
    }),
  });
  return data.records[0];
}

async function updateEvent(recordId, fields) {
  return airtableRequest(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
}

async function logConversation(clientRecordId, eventRecordId, mensaje, rol) {
  const fields = {
    Mensaje_ID: `${Date.now()}-${rol}`,
    Timestamp: new Date().toISOString(),
    Mensaje: mensaje,
    Rol: rol,
    Cliente: [clientRecordId],
  };
  if (eventRecordId) fields.Evento_Relacionado = [eventRecordId];
  return airtableRequest(TABLES.CONVERSACIONES, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }] }),
  });
}

async function getRecentHistory(clientRecordId, limit = 10) {
  const formula = encodeURIComponent(`FIND("${clientRecordId}", ARRAYJOIN({Cliente}))`);
  const data = await airtableRequest(
    `${TABLES.CONVERSACIONES}?filterByFormula=${formula}&maxRecords=${limit}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc`
  );
  return data.records.reverse().map(r => ({
    rol: r.fields.Rol,
    mensaje: r.fields.Mensaje,
  }));
}

// ---------- CLAUDE: CLASIFICACIÓN Y EXTRACCIÓN ----------
async function askClaude({ mensajeCliente, historial, eventoActivo }) {
  const systemPrompt = `Eres NOVA, la asistente de WhatsApp de dos negocios hermanos en Culiacán, Sinaloa:

1. DIVANNA EVENTOS: renta de mobiliario y artículos para eventos (mesas, sillas, decoración, montaje). NO coordina eventos.
2. EL VASO MAÍZ: snacks para eventos (barras de snacks, elotes en vaso, papas preparadas, antojitos).

Tu trabajo en cada mensaje:
1. Identificar a cuál negocio se refiere el cliente (o si aplica a ambos).
2. Nunca preguntar información que ya se conoce (revisa el historial y el expediente del evento activo).
3. Ir armando el expediente del evento: fecha, servicios solicitados, número de invitados, ubicación.
4. Responder de forma cálida, profesional y breve (máximo 3-4 líneas), siempre en español de México.
5. Cuando tengas datos suficientes para cotizar, avisa que un especialista de la Red generará la cotización — nunca inventes precios ni cotices tú misma.

Expediente del evento activo (puede estar vacío si es la primera vez que escribe):
${eventoActivo ? JSON.stringify(eventoActivo.fields, null, 2) : 'Ninguno — este es un cliente nuevo o inicia un evento nuevo.'}

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin backticks, con esta forma exacta:
{
  "negocio": "Divanna Eventos" | "El Vaso Maiz" | "Ambos" | null,
  "reply": "texto de respuesta para el cliente",
  "updates": {
    "Fecha_Evento": "YYYY-MM-DD o null",
    "Servicios_Solicitados": "texto o null",
    "Invitados": número o null,
    "Ubicacion": "texto o null"
  }
}`;

  const messages = historial.map(h => ({
    role: h.rol === 'Cliente' ? 'user' : 'assistant',
    content: h.mensaje,
  }));
  messages.push({ role: 'user', content: mensajeCliente });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText = data.content.find(b => b.type === 'text')?.text || '{}';
  const cleaned = rawText.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Si Claude no devolvió JSON válido, degradamos con una respuesta segura.
    return {
      negocio: null,
      reply: 'Gracias por tu mensaje. En un momento un especialista de la Red te atiende para darte todos los detalles.',
      updates: {},
    };
  }
}

// ---------- VALIDACIÓN DE FIRMA DE TWILIO ----------
function validateTwilioSignature(req, url) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;

  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = crypto
    .createHmac('sha1', process.env.TWILIO_AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return expected === signature;
}

// ---------- HANDLER PRINCIPAL ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const fullUrl = `${proto}://${host}/api/whatsapp`;

    // Validación de firma (recomendado, pero no bloquea en sandbox si falla la config).
    const isValid = validateTwilioSignature(req, fullUrl);
    if (process.env.ENFORCE_TWILIO_SIGNATURE === 'true' && !isValid) {
      res.status(403).send('Invalid signature');
      return;
    }

    const from = (req.body.From || '').replace('whatsapp:', '');
    const profileName = req.body.ProfileName || '';
    const body = req.body.Body || '';

    if (!from || !body) {
      res.status(400).send('Missing From or Body');
      return;
    }

    // 1. Buscar o crear cliente
    let client = await findClientByPhone(from);
    if (!client) {
      client = await createClient(from, profileName);
    }

    // 2. Buscar evento activo
    let event = await findActiveEvent(client.id);

    // 3. Guardar mensaje entrante
    await logConversation(client.id, event ? event.id : null, body, 'Cliente');

    // 4. Historial reciente para contexto
    const historial = await getRecentHistory(client.id, 10);

    // 5. Preguntar a Claude
    const aiResult = await askClaude({
      mensajeCliente: body,
      historial: historial.slice(0, -1), // excluir el mensaje que ya vamos a mandar como "user" actual
      eventoActivo: event,
    });

    // 6. Crear evento si no existía y ya se identificó negocio
    if (!event && aiResult.negocio) {
      event = await createEvent(client.id, aiResult.negocio);
    }

    // 7. Actualizar expediente del evento con los datos nuevos
    if (event && aiResult.updates) {
      const fieldsToUpdate = {};
      if (aiResult.updates.Fecha_Evento) fieldsToUpdate.Fecha_Evento = aiResult.updates.Fecha_Evento;
      if (aiResult.updates.Servicios_Solicitados) fieldsToUpdate.Servicios_Solicitados = aiResult.updates.Servicios_Solicitados;
      if (aiResult.updates.Invitados) fieldsToUpdate.Invitados = aiResult.updates.Invitados;
      if (aiResult.updates.Ubicacion) fieldsToUpdate.Ubicacion = aiResult.updates.Ubicacion;
      if (Object.keys(fieldsToUpdate).length > 0) {
        await updateEvent(event.id, fieldsToUpdate);
      }
    }

    // 8. Guardar respuesta de la IA en el log
    await logConversation(client.id, event ? event.id : null, aiResult.reply, 'IA');

    // 9. Responder a Twilio en formato TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(aiResult.reply)}</Message></Response>`;
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

  } catch (err) {
    console.error('Error en webhook DiMa:', err);
    const fallback = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Gracias por tu mensaje, en un momento te atendemos.</Message></Response>`;
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(fallback);
  }
};

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
