// api/whatsapp.js
// Webhook de DiMa OS: recibe mensajes de WhatsApp vía Twilio,
// usa Claude para clasificar el negocio y extraer datos del evento,
// guarda todo en Airtable, y responde al cliente por WhatsApp.

const crypto = require('crypto');
const { crearEventoCalendar, agregarFilaCotizacion, enviarCotizacionPorCorreo } = require('./_google-integrations');

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

async function getClientRecord(clientRecordId) {
  return airtableRequest(`${TABLES.CLIENTES}/${clientRecordId}`);
}

async function findActiveEvent(clientRecordId) {
  const clientRecord = await getClientRecord(clientRecordId);
  const eventoIds = clientRecord.fields.Historial_Eventos || [];
  if (eventoIds.length === 0) return null;

  const idsFormula = eventoIds.map(id => `RECORD_ID()="${id}"`).join(',');
  const formula = encodeURIComponent(`AND(OR(${idsFormula}), {Estado} != "Cerrado")`);
  const data = await airtableRequest(
    `${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=desc`
  );
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

async function findEventByFolio(folio) {
  const formula = encodeURIComponent(`{Folio_Evento} = "${folio}"`);
  const data = await airtableRequest(`${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1`);
  return data.records[0] || null;
}

async function enviarWhatsApp(numeroDestino, mensaje) {
  if (!numeroDestino) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    console.error('Faltan variables de entorno de Twilio para enviar WhatsApp saliente');
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
  if (!res.ok) console.error('Error enviando WhatsApp:', await res.text());
}

// Convierte el texto libre de "Servicios_Solicitados" en una lista de artículos,
// uno por línea, para el checklist de carga de la brigada. Parseo simple por ahora
// (comas / " y " / saltos de línea) mientras el catálogo estructurado no esté cargado.
function parsearItemsDeServicios(textoServicios) {
  if (!textoServicios) return [];
  return textoServicios
    .split(/,|\by\b|\n/i)
    .map(s => s.trim())
    .filter(Boolean);
}

// Manda a Diana la cotización con las 3 opciones fijas SI/NO/MODIFICAR.
// NOTA: el monto todavía no se calcula solo (no hay motor de precios conectado
// aún) — Diana debe confirmar/ajustar el monto como parte de su respuesta si
// hace falta, hasta que el catálogo de precios esté cargado en el sistema.
async function enviarCotizacionADiana(event) {
  const f = event.fields;
  const items = parsearItemsDeServicios(f.Servicios_Solicitados);

  await updateEvent(event.id, {
    Items_Detallados_Cotizacion: items.join('\n'),
    Autorizacion_Diana: 'Pendiente',
    Cotizacion_Enviada_Diana: true,
  });

  const mensaje =
    `Diana, realicé cotización para evento ${f.Folio_Evento}.\n` +
    `Fecha: ${f.Fecha_Evento || 'por confirmar'}\n` +
    `Ubicación: ${f.Ubicacion || 'por confirmar'}\n` +
    `Invitados: ${f.Invitados || 'por confirmar'}\n` +
    `Servicios: ${f.Servicios_Solicitados || 'por confirmar'}\n` +
    `Monto: pendiente de confirmar por ti (aún no hay catálogo de precios cargado)\n\n` +
    `Responde:\nSI ${f.Folio_Evento}\nNO ${f.Folio_Evento}\nMODIFICAR ${f.Folio_Evento} [tu cambio]`;

  await enviarWhatsApp(process.env.DIANA_WHATSAPP_NUMBER, mensaje);
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
  const clientRecord = await getClientRecord(clientRecordId);
  const conversacionIds = (clientRecord.fields.CONVERSACIONES || []).slice(-limit);
  if (conversacionIds.length === 0) return [];

  const idsFormula = conversacionIds.map(id => `RECORD_ID()="${id}"`).join(',');
  const formula = encodeURIComponent(`OR(${idsFormula})`);
  const data = await airtableRequest(
    `${TABLES.CONVERSACIONES}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`
  );
  return data.records.map(r => ({
    rol: r.fields.Rol,
    mensaje: r.fields.Mensaje,
  }));
}

// ---------- CLAUDE: CLASIFICACIÓN Y EXTRACCIÓN ----------
async function askClaude({ mensajeCliente, historial, eventoActivo }) {
  const systemPrompt = `Eres DiMa, la asistente de WhatsApp de dos negocios hermanos en Culiacán, Sinaloa:

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

  const messages = historial
    .filter(h => h.mensaje && String(h.mensaje).trim().length > 0)
    .map(h => ({
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

    // ---------- RESPUESTA DE DIANA (SI / NO / MODIFICAR) ----------
    // Si el mensaje viene del número de Diana, no pasa por el flujo de cliente:
    // se procesa como autorización de una cotización pendiente.
    const numeroDiana = (process.env.DIANA_WHATSAPP_NUMBER || '').replace('whatsapp:', '');
    if (numeroDiana && from.replace(/\D/g, '').endsWith(numeroDiana.replace(/\D/g, ''))) {
      const match = body.trim().match(/^(SI|NO|MODIFICAR)\s+(EVT-\S+)\s*(.*)$/i);
      if (match) {
        const [, comando, folio, resto] = match;
        const eventoFolio = await findEventByFolio(folio.toUpperCase());
        if (!eventoFolio) {
          res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>No encontré el evento ${folio}, revisa el folio.</Message></Response>`);
          return;
        }

        const comandoUpper = comando.toUpperCase();
        if (comandoUpper === 'SI') {
          const items = parsearItemsDeServicios(eventoFolio.fields.Items_Detallados_Cotizacion || eventoFolio.fields.Servicios_Solicitados);
          await updateEvent(eventoFolio.id, {
            Autorizacion_Diana: 'SI',
            Checklist_Items: items.join('\n'),
            Checklist_Items_Marcados: '[]',
          });

          // Integraciones de Google: agendar en Calendar, registrar en Sheets,
          // y mandar correo al cliente si dio su email. Ninguna de estas debe
          // tronar el flujo principal si falla -- son "nice to have", no crítico.
          try {
            const f = eventoFolio.fields;
            let clienteNombre = '', clienteTelefono = '', clienteEmail = '';
            if (f.Cliente && f.Cliente[0]) {
              const clienteData = await airtableRequest(`${TABLES.CLIENTES}/${f.Cliente[0]}`);
              clienteNombre = clienteData.fields.Nombre || '';
              clienteTelefono = clienteData.fields.Telefono_WhatsApp || '';
              clienteEmail = clienteData.fields.Email || '';
            }

            const datosEvento = {
              folio: f.Folio_Evento,
              negocio: f.Negocio,
              fechaEvento: f.Fecha_Evento,
              ubicacion: f.Ubicacion,
              invitados: f.Invitados,
              servicios: f.Servicios_Solicitados,
              monto: f.Monto_Cotizacion || '',
            };

            await crearEventoCalendar(datosEvento);
            await agregarFilaCotizacion({ ...datosEvento, clienteNombre, clienteTelefono });
            if (clienteEmail) {
              await enviarCotizacionPorCorreo({ ...datosEvento, emailCliente: clienteEmail });
            }
          } catch (googleErr) {
            console.error('Error en integraciones de Google (no crítico):', googleErr.message);
          }
        } else if (comandoUpper === 'NO') {
          await updateEvent(eventoFolio.id, { Autorizacion_Diana: 'NO' });
        } else if (comandoUpper === 'MODIFICAR') {
          await updateEvent(eventoFolio.id, {
            Autorizacion_Diana: 'MODIFICAR',
            Modificacion_Solicitada_Diana: resto || '',
          });
        }

        const confirmacion = comandoUpper === 'SI'
          ? `Listo, cotización ${folio} autorizada. Checklist de carga generado para la brigada.`
          : comandoUpper === 'NO'
          ? `Entendido, cotización ${folio} cancelada. Ajusto con el cliente.`
          : `Recibido, voy a regenerar la cotización ${folio} con tu cambio: "${resto}".`;

        res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(confirmacion)}</Message></Response>`);
        return;
      }
      // Si el mensaje de Diana no matchea el formato esperado, seguimos el flujo normal
      // (podría ser una pregunta suya, no necesariamente una autorización).
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
        event.fields = { ...event.fields, ...fieldsToUpdate };
      }

      // Cuando ya hay lo mínimo para cotizar y todavía no se le ha mandado
      // a Diana, DiMa arma y envía la cotización sola (nunca cotiza el cliente).
      const yaTieneLoMinimo = event.fields.Fecha_Evento && event.fields.Servicios_Solicitados && event.fields.Ubicacion;
      if (yaTieneLoMinimo && !event.fields.Cotizacion_Enviada_Diana) {
        await enviarCotizacionADiana(event);
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
