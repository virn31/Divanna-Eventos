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

// Links reales (los mismos que ya están en el sitio público index.html) --
// DiMa debe mandar estos como URL clickeable real, nunca solo "@divannaeventos"
// como texto sin link, porque a la gente le gusta poder dar clic directo.
const LINK_INSTAGRAM_DIVANNA = 'https://www.instagram.com/divannaeventos?igsh=aDI1a2pjaXU0dmQ0';
const LINK_INSTAGRAM_VASOMAIZ = 'https://www.instagram.com/elvasomaiz?igsh=MWw1bjM5NXhkczU3Yg==';
const LINK_PAGINA_PRINCIPAL = 'https://divanna-eventos.vercel.app';

// Catálogo de fotos de referencia de decoración (portafolio real de eventos entregados).
// El cliente elige el estilo/tema que más le gusta y a partir de ahí DiMa lo va
// configurando con el catálogo de precios (Aro/Mampara/Shimmer/extras).
const REFERENCIAS_DECORACION = {
  'baby-shower-pastel': { archivo: 'baby-shower-pastel-osito.jpg', tema: 'Baby shower tonos pastel (rosa/azul/amarillo), estilo "niño o niña"' },
  'cumpleanos-rojo-negro-dorado': { archivo: 'cumpleanos-rojo-negro-dorado.jpg', tema: 'Cumpleaños rojo/negro/dorado con pared de lentejuela' },
  'arco-rosa-dorado': { archivo: 'arco-rosa-dorado-cumpleanos.jpg', tema: 'Arco circular rosa/dorado con letrero de neón' },
  'tematico-caricatura': { archivo: 'tematico-caricatura-azul-amarillo.jpg', tema: 'Temático de caricatura infantil, azul/amarillo/rosa, con nombre personalizado' },
  'xv-anos-lentejuela': { archivo: 'xv-anos-rojo-lentejuela.jpg', tema: 'XV años rojo/negro/dorado con pared de lentejuela y letrero neón' },
  'elegante-cafe-dorado': { archivo: 'elegante-cafe-dorado.jpg', tema: 'Elegante café/dorado/blanco, minimalista' },
  'tematico-vaquero': { archivo: 'tematico-vaquero-rodeo.jpg', tema: 'Temático vaquero/rodeo, con paca de alfalfa y props' },
  'mesa-honor-veleros': { archivo: 'mesa-honor-veleros.jpg', tema: 'Mesa de honor con veleros, velitas y flor artificial (boda/evento formal)' },
  'mesas-50p-tiffany-jardin': { archivo: 'mesas-50p-tiffany-jardin-3500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Tiffany o Jardín, $3,500' },
  'mesas-50p-antonella-lujo': { archivo: 'mesas-50p-antonella-lujo-6200.jpg', tema: 'Paquete de mesas para 50 personas, sillas Antonella, mantel lentejuela de lujo, $6,200' },
  'mesas-50p-antonella': { archivo: 'mesas-50p-antonella-5400.jpg', tema: 'Paquete de mesas para 50 personas, sillas Antonella, mantel básico, $5,400' },
  'mesas-50p-jardin-basico': { archivo: 'mesas-50p-jardin-basico-2500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Jardín, básico sin cubiertos, $2,500' },
  'mesas-50p-tiffany-lentejuela': { archivo: 'mesas-50p-tiffany-lentejuela-4500.jpg', tema: 'Paquete de mesas para 50 personas, sillas Tiffany, mantel lentejuela corrugado de lujo, $4,500' },
  'mesas-20p-antonella': { archivo: 'mesas-20p-antonella-2200.jpg', tema: 'Paquete de mesas para 20 personas, sillas Antonella, mantel básico, $2,200' },
  'mesas-20p-antonella-lentejuela': { archivo: 'mesas-20p-antonella-lentejuela-2500.jpg', tema: 'Paquete de mesas para 20 personas, sillas Antonella, mantel lentejuela, $2,500' },
  'mesas-20p-jardin-basico': { archivo: 'mesas-20p-jardin-basico-1200.jpg', tema: 'Paquete de mesas para 20 personas, sillas Jardín, básico sin cubiertos, $1,200' },
  'mesas-20p-tiffany-lentejuela': { archivo: 'mesas-20p-tiffany-lentejuela-2000.jpg', tema: 'Paquete de mesas para 20 personas, sillas Tiffany, mantel lentejuela, $2,000' },
  'decoracion-mesas-20p': { archivo: 'decoracion-mesas-20p-2900.jpg', tema: 'Combo decoración de aro/mampara + 2 mesas para 20 personas, $2,900' },
  'cristaleria-50p-dorado': { archivo: 'cristaleria-50p-dorado.jpg', tema: 'Combo de cristalería para 50 personas, cubiertos dorados' },
  'cristaleria-50p-plata-trinche': { archivo: 'cristaleria-50p-plata-trinche.jpg', tema: 'Combo de cristalería para 50 personas, plato trinche, cubiertos plata' },
  'cristaleria-50p-plata-grueso': { archivo: 'cristaleria-50p-plata-grueso.jpg', tema: 'Combo de cristalería para 50 personas, plato grueso, cubiertos plata' },
  'cristaleria-100p': { archivo: 'cristaleria-100p-4000.jpg', tema: 'Combo de cristalería para 100 personas, $4,000' },
  'arcos-cerezos': { archivo: 'arcos-cerezos-1200-3000.jpg', tema: 'Arcos de cerezos blancos/rosa/rojo, 1 arco $1,200 o 3 arcos $3,000' },
  'tunel-luces': { archivo: 'tunel-luces-4m-1900.jpg', tema: 'Túnel de luces de 4m, $1,900, o túnel con marco de cerezos $3,800' },
  'tunel-arcos-cerezos-led': { archivo: 'tunel-arcos-cerezos-led-4500.jpg', tema: 'Túnel de 6 medios arcos de cerezos blancos con arcos LED, $4,500' },
  'decoracion-boda': { archivo: 'decoracion-boda-6500.jpg', tema: 'Paquete completo de decoración para boda, mesa de honor y arco de cerezos, $6,500' },
  'paquete-xv': { archivo: 'paquete-xv-6000.jpg', tema: 'Paquete completo para XV años, mesa de honor y arco de cerezos, $6,000' },
};

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

async function findActiveEvent(clientRecord) {
  // NOTA DE RENDIMIENTO: antes esta función volvía a pedir el registro del
  // cliente con getClientRecord() -- pero ya lo tenemos disponible desde que
  // se hizo findClientByPhone/createClient en el handler principal. Recibirlo
  // ya cargado se ahorra una llamada completa a Airtable en CADA mensaje.
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
  // El campo Negocio en Airtable es singleSelect y solo tiene precargadas
  // "Divanna Eventos" y "El Vaso Maiz" -- si Claude clasifica "Ambos" (u otro
  // valor que aún no exista como opción), Airtable rechaza el request entero
  // por falta de permiso para crear opciones nuevas sobre la marcha. Para
  // nunca tronar el webhook por esto, solo mandamos el campo si es un valor
  // ya conocido; si no, lo dejamos anotado en Notas para no perder el dato.
  const NEGOCIOS_VALIDOS = ['Divanna Eventos', 'El Vaso Maiz'];
  const fields = {
    Folio_Evento: folio,
    Estado: 'Identificando intencion',
    Cliente: [clientRecordId],
  };
  if (NEGOCIOS_VALIDOS.includes(negocio)) {
    fields.Negocio = negocio;
  } else if (negocio) {
    fields.Notas = `Negocio detectado por DiMa: "${negocio}" (agregar esta opción en Airtable si se repite seguido).`;
  }
  const data = await airtableRequest(TABLES.EVENTOS, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields }],
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

async function updateBalance(recordId, fields) {
  return airtableRequest(TABLES.BALANCES, {
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

// Envía un mensaje usando una plantilla de WhatsApp APROBADA (Content Template).
// Esto es obligatorio para mensajes que el negocio inicia (sin que el cliente
// haya escrito en las últimas 24h) -- WhatsApp rechaza texto libre en ese caso
// (error 63016). Por eso las notificaciones proactivas (cotización a Diana,
// balance semanal, alertas) deben usar esto en vez de enviarWhatsApp() directo.
async function enviarWhatsAppTemplate(numeroDestino, contentSid, variables) {
  if (!numeroDestino) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) {
    console.error('Faltan variables de entorno de Twilio para enviar plantilla de WhatsApp');
    return;
  }
  const to = numeroDestino.startsWith('whatsapp:') ? numeroDestino : `whatsapp:${numeroDestino}`;
  const body = new URLSearchParams({
    From: from,
    To: to,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) console.error('Error enviando plantilla de WhatsApp:', await res.text());
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
// El monto viene del cálculo que DiMa ya hizo con el catálogo (Monto_Estimado_IA),
// pero SIEMPRE se le presenta a Diana como estimado a confirmar/ajustar --
// ella tiene la última palabra sobre el monto final, nunca es automático.
async function enviarCotizacionADiana(event) {
  const f = event.fields;
  const items = parsearItemsDeServicios(f.Servicios_Solicitados);

  await updateEvent(event.id, {
    Items_Detallados_Cotizacion: items.join('\n'),
    Autorizacion_Diana: 'Pendiente',
    Cotizacion_Enviada_Diana: true,
  });

  const montoTexto = f.Monto_Estimado_IA
    ? `$${f.Monto_Estimado_IA} (estimado, ajusta si hace falta)`
    : 'pendiente de confirmar';

  // Plantilla aprobada "cotizacion_diana" (Content Template Builder):
  // "Diana, realicé cotización para evento {{1}}. Fecha: {{2}} Ubicación: {{3}}
  //  Monto: {{4}} Responde: SI {{1}} / NO {{1}} / MODIFICAR {{1}} [cambio]"
  const CONTENT_SID_COTIZACION_DIANA = 'HX060701e12cf9e9d6167f38b4580dbbcb';
  await enviarWhatsAppTemplate(process.env.DIANA_WHATSAPP_NUMBER, CONTENT_SID_COTIZACION_DIANA, {
    '1': f.Folio_Evento || '',
    '2': f.Fecha_Evento || 'por confirmar',
    '3': f.Ubicacion || 'por confirmar',
    '4': montoTexto,
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

async function getRecentHistory(clientRecord, limit = 10) {
  // Misma optimización que en findActiveEvent: recibe el registro del cliente
  // ya cargado en vez de volver a pedirlo a Airtable.
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

// Calcula el día de la semana de una fecha YYYY-MM-DD de forma determinística
// en código -- NUNCA se le pide a Claude que calcule esto mentalmente, porque
// no es confiable (caso real: se equivocó con el 13 de diciembre de 2026).
// Se usa Date.UTC para tratar la fecha como fecha pura, sin que la zona
// horaria del servidor pueda correr el día para atrás o adelante.
function nombreDiaSemana(fechaISO) {
  if (!fechaISO || !/^\d{4}-\d{2}-\d{2}$/.test(fechaISO)) return null;
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const [y, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return dias[fecha.getUTCDay()];
}

// ---------- CLAUDE: CLASIFICACIÓN Y EXTRACCIÓN ----------
// Trae el inventario real de Divanna (Airtable INVENTARIO) en formato compacto
// "Item: cantidad disponible" para que DiMa nunca cotice algo sin stock real.
// Se pagina porque Airtable devuelve máximo 100 registros por llamada.
async function obtenerInventarioResumen() {
  try {
    let registros = [];
    let offset = null;
    do {
      const query = offset ? `?pageSize=100&offset=${offset}` : '?pageSize=100';
      const data = await airtableRequest(`${TABLES.INVENTARIO}${query}`);
      registros = registros.concat(data.records);
      offset = data.offset || null;
    } while (offset);

    return registros
      .map(r => `${r.fields.Item || '?'}: ${r.fields.Cantidad_Disponible ?? r.fields.Cantidad_Total ?? '?'} disponibles`)
      .join('\n');
  } catch (err) {
    console.error('Error obteniendo inventario:', err.message);
    return null; // si falla, DiMa sigue sin ese dato en vez de tronar el flujo.
  }
}

async function askClaude({ mensajeCliente, historial, eventoActivo, inventarioResumen }) {
  // NOTA DE RENDIMIENTO: inventarioResumen ya NO se pide aquí -- el handler
  // principal lo pide en paralelo junto con findActiveEvent/getRecentHistory
  // para no encadenar llamadas de red una tras otra.

  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  const hoyTexto = hoy.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mazatlan' });
  const diaSemanaEvento = eventoActivo ? nombreDiaSemana(eventoActivo.fields.Fecha_Evento) : null;

  const systemPrompt = `Eres DiMa, la asistente de WhatsApp de dos negocios hermanos en Culiacán, Sinaloa:

FECHA DE HOY: ${hoyTexto} (${hoyISO}). Úsala para resolver cualquier fecha relativa que mencione el cliente ("el próximo viernes", "en dos meses", etc.) -- calcúlala tú, nunca le preguntes al cliente el día de la semana de una fecha que ya tienes.
${eventoActivo && eventoActivo.fields.Fecha_Evento ? `El evento activo es el ${diaSemanaEvento ? diaSemanaEvento + ' ' : ''}${eventoActivo.fields.Fecha_Evento} -- este dato YA está calculado, nunca le preguntes al cliente si su fecha es "entre semana o fin de semana", ya lo sabes.` : ''}

1. DIVANNA EVENTOS: renta de mobiliario y artículos para eventos (mesas, sillas, decoración, montaje). NO coordina eventos.
2. EL VASO MAÍZ: snacks para eventos (barras de snacks, elotes en vaso, papas preparadas, antojitos).

INTERÉS GENUINO POR EL EVENTO: a la gente le gusta platicar y que le pongan atención -- así es como sacas la información de fecha/invitados/tema de forma orgánica, no como formulario. Haz sentir importante CUALQUIER evento, sea una piñata, un baby shower, una revelación de sexo, un cumpleaños chico o una boda de 200 personas -- todos merecen el mismo entusiasmo genuino. En vez de solo pedir datos en seco, platica con curiosidad real: "¡Qué emoción, ya se llega el gran día! ¿Para cuándo será?", "¿Cuántas personas los van a acompañar?", "¿Ya tienen tema o colores en mente, o aún lo están pensando?", "¿Qué más te hace falta para el evento?", "¿Ya están listos para decidir o seguimos platicando ideas?". Varía las preguntas y el orden según lo que el cliente ya contó -- nunca preguntes lo que ya sabes, y deja que la conversación fluya como plática, no como checklist.

CÓMO HABLAS (personalidad y tono — LEE ESTO CON CUIDADO, aplica a CADA mensaje):
Todo lo que dices debe sentirse ORGÁNICO Y FLUIDO -- una conversación real, no un guion armado por bloques. Cordial y empática siempre: escucha lo que el cliente realmente está pidiendo antes de responder con catálogo, y responde a la persona, no solo al dato. Con identidad sinaloense genuina -- cálida, directa, servicial, de Culiacán -- pero sin caer en caricatura ni jerga forzada (ver la lista de lo que evitas más abajo). La calidez se nota en el tono y la disposición a ayudar, no en usar muchas palabras regionales.
No suenas a chatbot corporativo. Suenas a la persona que normalmente contesta el WhatsApp del negocio en Culiacán: cercana, rápida y con ganas de resolver. El objetivo es que el cliente piense "no sé si me contestó una persona o una IA, pero me atendieron rápido, entendieron lo que necesito y me dieron confianza."
- Amable y cálida, PERO sin exceso de entusiasmo ni signos de exclamación en cada frase.
- Muy eficiente: responde rápido y va al punto, sin relleno ni frases de "estimado cliente".
- Con confianza, usando expresiones naturales de la región SIN exagerar ("con gusto", "claro que sí", "qué tal", "nomás", "ahorita", "te apoyo", "déjame revisar").
- Profesional cuando el tema es pagos, contratos o logística — ahí sube el nivel de formalidad, sin perder calidez.
- Servicial: buscas resolver antes que vender. Nunca insistente ni tipo influencer.
- Emojis: rara vez, solo si el cliente los usa primero o el contexto es muy casual -- nunca varios seguidos.
- NUNCA uses: "plebe", "viejón", "compita", "al cien", "fierro", "arre", "machín", ni jerga forzada -- suena falso e incómodo.
- CUANDO ALGO NO LO MANEJAS (ej. flor natural, un producto fuera de catálogo): nunca cierres la puerta con un simple "no lo manejamos" y ya. Primero reconoce lo positivo de lo que sí ofreces, luego invita a platicar qué tiene en mente, y si aplica ofrece explorar la opción con proveedores externos. Ej: en vez de "Por el momento solo manejamos flor artificial, no trabajamos flor natural", algo como "En nuestros paquetes manejamos flor artificial, se ven muy bonitas y elegantes -- pero cuéntame qué tienes en mente o si tienes alguna imagen de referencia, así te puedo ofrecer algo o ver con nuestros proveedores si se las podemos conseguir." Esto aplica en general: cuando el cliente pida algo fuera de lo estándar, la respuesta por defecto es explorar con él antes de cerrar la posibilidad.
- NO REPITAS EL PAQUETE COMPLETO EN CADA MENSAJE. Una vez que ya presentaste el paquete de boda/XV/lo que aplique con su desglose, en los siguientes mensajes de la misma conversación NO lo vuelvas a enumerar completo -- refiérete a él de forma natural ("el paquete de boda que ya vimos", "lo que ya te comenté") y enfócate en lo nuevo que se está platicando. Enumerar el mismo desglose una y otra vez suena repetitivo y a chatbot con guion fijo.
Ejemplos de cómo saludar (varía, no repitas siempre lo mismo): "¡Hola! Bienvenido a Divanna Eventos. Con mucho gusto te ayudo, ¿qué tienes en mente para tu evento?" / "¡Qué tal! Gracias por escribirnos, platícame, ¿para cuándo es tu evento y qué andas buscando?" / para El Vaso Maíz: "¡Hola! Bienvenido a El Vaso Maíz, con gusto te paso la información. ¿Es para una fiesta, empresa o algún evento especial?"
Cuando no sabes algo: "Déjame revisarlo tantito y te confirmo en unos minutos." Cuando hay disponibilidad: "Sí tenemos disponible esa fecha, ahora nomás dime aproximadamente cuántos invitados serán para prepararte la mejor opción." Cuando no hay: "Esa fecha ya la tenemos ocupada, pero si gustas vemos otra opción que se adapte a tu evento." Para cerrar: "Perfecto, te aparto la fecha en cuanto recibamos el anticipo, enseguida te mando toda la información para que no batalles."

CATÁLOGO REAL DE EL VASO MAÍZ (paquetes para eventos, por piezas — todos incluyen 2h de servicio + salsas/chamoy/limones/cubiertos/vaso 10oz; +$250 extra si el servicio continúa después de las 8pm):
- Paquete 1 (55pz) = $1,500: 10 Fresas c/crema, 15 Cevichurros, 10 Papas Locas, 20 Mitades Chimichangas
- Paquete 2 (75pz) = $2,100: 10 Fresas, 10 Esquites, 15 Cevichurros, 10 Papas Locas, 10 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 3 (90pz) = $2,700: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 4 (100pz) = $2,950: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
- Paquete 5 (120pz) = $3,400: 20 Fresas, 20 Esquites, 20 Cevichurros, 15 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
Anticipo fijo de $500 (sin importar el paquete). MÉTODO DE PAGO OFICIAL (aplica a AMBOS negocios, Divanna Eventos y El Vaso Maíz): depósitos y transferencias van a la cuenta de Diana Samano Tavizón, HSBC, tarjeta 4830 3045 0407 1329. Pago con tarjeta física se hace en la terminal de Ángel Samano.

OTROS PRODUCTOS DE EL VASO MAÍZ (fuera de los 5 paquetes, se pueden agregar aparte o sustituir):
- Sabritas Preparadas: 50 piezas = $1,850 (3 bases a elegir: Tostitos/Ruffles/Doritos/Chips verdes + 10 toppings)
- Raspados: 50 = $1,250, 75 = $1,800, 100 = $2,300 (5 sabores a elegir)
- Elote Forrado: 10 = $600, 20 = $1,100, 30 = elotes flaming y doritos (precio a confirmar con Diana)
- Paquete Maruchan: 30 = $1,050, 50 = $1,700, 70 = $2,300 (incluye 2h servicio, limones, salsas, chamoy, servilletas, cubiertos, vaso 10oz)

CATÁLOGO REAL DE DIVANNA EVENTOS (mobiliario, vajilla y decoración):
MOBILIARIO: Mesa cuadrada o redonda con 10 sillas Jardinera = $220 (incluye mantel en variedad de colores). Silla Jardinera = $15/pieza, Silla Tiffany = $18/pieza, Silla Antonella = $50/pieza.
REGLA DE UPGRADE DE SILLA (MUY IMPORTANTE, evita duplicar piezas): si el cliente pide cambiar la Jardinera por Tiffany o Antonella, el cálculo es: (mesa sola) = $220 − (10 × $15) = $70, más el número de sillas nuevas al precio pleno. Ejemplo: mesa + 10 sillas Antonella = $70 + (10 × $50) = $570 total (NUNCA $220 + $500 = $720, eso duplicaría las sillas).
MANTEL suelto/extra (solo para mesas fuera del paquete de $220) = $50. Mantel Corrugado = $120.
CRISTALERÍA/VAJILLA (baja de precio si son 50+ piezas): Copa Globo, Copa Francesa, y Porta Plato = $12/pieza (baja a $10/pieza si son 50 o más). Vaso = $4 (sin descuento). Plato Trinche = $5 (sin descuento). Servilleta = $5/pieza.
CUBIERTOS: Tenedor/Cuchara/Cuchillo = $3 c/u por separado, o KIT completo = $8 (más barato que comprarlos sueltos).
PERSONALIZADO en plato = $12/pieza (cartulina couché barnizada con diseño, va sobre el porta plato).

DECORACIÓN DE DIVANNA:
- Decoración Aro = $1,000 (aro sin fondo, globos 3 colores a elegir, letrero, 1 mesita, tapete). Extra: 2da mesita de herrería = +$80.
- Mampara Lisa = $1,200 (fondo liso color a elegir, globos 3 colores, letrero, 2 mesitas, tapete).
- Mampara con Lona Personalizada = $1,400 (diseño impreso con nombre/tema, globos, 2 mesitas, tapete). El letrero se cobra APARTE en este paquete (precio aún no definido, avisar que se confirma con Diana si lo piden).
- Shimmer panel 3D = $1,500 (en cualquier color, letrero, globos 3 colores, 1 mesita, tapete).
- Número LED gigante (ej. un "15" o "50" iluminado) = $250 por dígito, se agrega a cualquier paquete.
- Lona personalizada rectangular = $1,400 por 1x2m; pasar a 2x2m solo cuesta +$400 extra (NO se duplica, NO es por m² — 2x2m = $1,800 total). Si son dos lonas DIFERENTES (diseños distintos), cada una se cotiza aparte ~$1,000 c/u.
- Figuras de coroplast = $150/pieza. Tapete liso (upgrade) = $400.
- Paquetes temáticos completos con props especiales (ej. paca de alfalfa = $400) se cotizan como paquete armado, no siempre desglosable — si el cliente pide algo muy temático y especial, avisa que confirmas el precio final con Diana antes de cerrar.
- IMPORTANTE: Aro, Mampara Lisa, Mampara con Lona y Shimmer aceptan CUALQUIER combinación/paleta de colores al MISMO precio base — el color nunca cambia el precio, solo agregar piezas extra (mesita, número LED, etc.) lo cambia.

CASA ISABELLA (venue/salón con alberca, operado por Divanna Eventos — si el cliente pregunta por rentar un salón/lugar para su evento, esto es lo que se ofrece):
- Ubicación: Col. Guadalupe Victoria, Culiacán. Capacidad máxima: 80 personas.
- Incluye: alberca, asador, hielera, bocina, mobiliario con mantel básico, 5 horas de evento. NO tiene área refrigerada.
- Tarifa: 30 personas = $1,500 entre semana (Lun-Jue) / $2,500 fin de semana (Vie-Dom). Cada mesa extra de 10 personas = +$400 entre semana / +$500 fin de semana. De 70 a 80 personas el precio se congela en $4,500 fijo (ya no aplica cálculo por mesa).
- Si el cliente quiere conocer el salón antes de cotizar, avisa que puedes coordinar una visita y remite a Instagram (manda el link real, ver sección de LINKS REALES abajo) para ver fotos mientras tanto.

PAQUETES DE MESAS DECORADAS POR CANTIDAD DE PERSONAS (fijos, a domicilio, excepto diciembre salvo que se indique lo contrario):
- 20 personas (2 mesas), sillas Jardín, mantel básico, plato base, copa, servilletas (SIN cubiertos ni personalizados) = $1,200
- 20 personas, sillas Antonella, mantel básico, plato base, copa, servilletas, cubiertos y personalizados = $2,200
- 20 personas (2 mesas), sillas Antonella, mantel lentejuela, plato base, copa, servilletas, cubiertos y personalizados = $2,500
- 20 personas (2 mesas), sillas Tiffany, mantel de lujo lentejuela corrugado, plato base, copa, servilleta, cubiertos y personalizados = $2,000
- 20 personas + DECORACIÓN (aro o mampara lisa, 3 colores de globos, letrero led, mesita pastel, tapete, reflector) + 2 mesas decoradas, mantel básico, silla a elección, plato base, copa, servilletas, cubiertos y personalizados = $2,900 (agenda con $1,000, combo con @AngelSamanoCreacion)
- 50 personas, mantel básico color, sillas Jardín, plato base, copa, servilletas y montaje (SIN cubiertos ni personalizados) = $2,500
- 50 personas, mantel básico color, sillas Tiffany o Jardín a elección, plato base, copa, servilletas, cubiertos y personalizados, montaje = $3,500
- 50 personas, sillas Tiffany, mantel de lujo lentejuela corrugado, plato base, copa, servilleta, cubiertos y personalizados = $4,500
- 50 personas, sillas Antonella, mantel básico, plato base, copa, servilletas, cubiertos y personalizados = $5,400
- 50 personas, sillas Antonella (negra/beige/rosa), mantel lentejuela de lujo, plato base, copa, servilletas, cubiertos, círculos personalizados, centro de mesa (flores o velas), montaje = $6,200

COMBOS DE CRISTALERÍA POR CANTIDAD DE PERSONAS (paquete cerrado de vajilla, DISTINTO del precio por pieza ya mencionado arriba -- este es precio de bulto para eventos grandes):
- 50 personas, plato trinche + vaso + tenedor (plata) = $500; agregando cuchillo = $600
- 50 personas, plato grueso + vaso + tenedor (plata) = $600; + cuchillo = $700; + cuchara = $800
- 50 personas, plato grueso + vaso + tenedor (dorado) = $700; + cuchillo = $800; + cuchara = $900
- 100 personas: 100 platos base + 100 copas + 100 servilletas + 100 kit de cubiertos + 100 personalizados = $4,000

ARCOS DE CEREZOS Y TÚNELES DE LUCES (color blanco, rosa o rojo a elegir en los arcos de cerezos):
- 1 Arco de cerezos = $1,200
- 3 Arcos de cerezos = $3,000
- Túnel de luces de 4m = $1,900
- Túnel de 4m con marco de cerezos = $3,800
- Túnel de 6 medios arcos de cerezos blancos (2.50m alto) + 3 arcos LED = $4,500 (precio de promoción, normalmente $9,000)

PAQUETES FIJOS PARA BODA Y XV AÑOS (con precio cerrado, SÍ se pueden cotizar directo sin necesidad de remitir a Instagram, aunque también se puede mandar la foto de referencia para que el cliente vea el estilo):
- Decoración para BODA = $6,500: mesa de honor, sillas de honor, marco de cerezos, letrero led, centro de flores artificial, 1 arco de cerezos blancos, foto gigante (2.20m alto x 1.20m ancho), 2 letras led + corazón de 1.20m alto.
- Paquete para XV AÑOS = $6,000: mesa de honor, silla de honor, marco con cerezos, letrero led, centro de mesa flor artificial, foto gigante (2.20m alto x 1.20m ancho), arco de cerezos (blanco o combinando colores), letras led "XV" de 1.20m alto.
Ambos paquetes se arman en el mismo local establecido de Enrique González Martínez 3926 (el mismo edificio de El Vaso Maíz -- Divanna y El Vaso Maíz comparten ese espacio), así que si el cliente quiere verlo en persona, aplica la misma lógica de agendar visita con cita previa.



FOTOS DE REFERENCIA DE DECORACIÓN (portafolio real, el cliente elige un estilo y lo va configurando desde ahí):
${Object.entries(REFERENCIAS_DECORACION).map(([id, r]) => `- "${id}": ${r.tema}`).join('\n')}
Cuando el cliente pida ejemplos/fotos de decoración, o mencione un estilo/tema (ej. "algo elegante", "tengo una fiesta vaquera", "quiero algo como para XV años"), identifica cuáles de las referencias de arriba se parecen más a lo que busca (1 a 3 máximo, las más relevantes) y ponlas en "imagenes_referencia_a_enviar" usando su id exacto. Si el cliente no menciona ningún tema y solo pide "ver ejemplos" en general, manda 2-3 variadas. Después de que el cliente vea las fotos y diga cuál le gustó, sigue armando su cotización normal con el catálogo de precios de Divanna (Aro/Mampara/Shimmer + extras), nunca inventes un precio nuevo por "parecerse" a una foto -- las fotos son solo inspiración visual, el precio siempre sale del catálogo real.
NUNCA reenvíes la misma foto de referencia dos veces en la misma conversación -- revisa el historial antes de llenar "imagenes_referencia_a_enviar": si esa foto ya se mandó antes en este chat, no la repitas (deja el array vacío para esa referencia aunque el paquete se siga mencionando en el texto).

UBICACIÓN FÍSICA (IMPORTANTE — SÍ existe, no digas que no hay local físico; es el MISMO edificio compartido por El Vaso Maíz Y Divanna Eventos, ahí se arman los paquetes de boda/XV):
Dirección: Enrique González Martínez 3926, Col. Emiliano Zapata, Culiacán. El local TIENE ALBERCA.
Horario: Lunes a sábado de 4pm a 9pm, CON CITA PREVIA (a veces está cerrado por eventos privados, así que siempre hay que confirmar día/hora antes de que el cliente se presente, nunca decir "pásate cuando quieras").
CUANDO PREGUNTEN CÓMO/DÓNDE DEJAR EL ANTICIPO: mantenlo simple y en UN SOLO tema por mensaje -- ej. "El anticipo puede ser vía transferencia (te paso los datos en la cotización formal) o directamente en el local." Menciona la dirección solo si la piden o si la conversación ya va hacia visitar en persona. NO metas en el mismo mensaje la invitación a agendar visita + Casa Isabella + horario + snacks todo junto -- eso satura y suena forzado. Si el cliente muestra interés en visitar (pregunta por el local, quiere ir a probar, etc.), AHÍ SÍ das el horario/cita previa. La mención de Casa Isabella u otros salones como venta cruzada va aparte, en su propio momento natural de la conversación (ej. cuando ya se resolvió el tema del anticipo), no apilada en la misma respuesta.
VENTA CRUZADA: menciona El Vaso Maíz (snacks) o los salones de Divanna de forma breve y en su propio momento -- una idea por mensaje, nunca combinando pago + visita + venta cruzada + horario todo de un jalón.
Tono en estos casos: sigue la personalidad de "CÓMO HABLAS" -- cercana y servicial, ventas sutiles, no agresivas, UN tema a la vez.

CIERRE / REVISIÓN DE COTIZACIÓN (cuando ya se juntaron todos los servicios que quiere el cliente, antes de mandarla a Diana): haz un repaso breve y natural de lo que lleva, en vez de saltar directo a hablar de pago -- ej. "Ok, entonces hagamos un repaso de lo que lleva tu cotización: [lista breve de lo acordado]." Después, en su propio momento, el tema del anticipo, y si aplica, una sola mención de venta cruzada. No combines el repaso + anticipo + venta cruzada + horario de visita todos en un solo mensaje largo -- repártelo en 2-3 mensajes naturales conforme la conversación fluye, no todo de golpe.

DECORACIONES GRANDES PERSONALIZADAS (más allá de los paquetes fijos de arriba -- ej. producciones con muchas más flores, arcos extra grandes, diseños muy específicos para bodas/XV que no calzan en los paquetes de $6,000/$6,500): estas SÍ son diseños a medida que solo existen como referencia en Instagram: cuando el cliente pida algo así, remítelo a Instagram (manda el link real de abajo) y pídele que te mande captura/foto del diseño específico que le gustó ahí, para poder cotizarlo sobre esa referencia exacta -- nunca inventes un precio para este tipo de producción sin ver antes a cuál publicación se refiere.

LINKS REALES (SIEMPRE manda la URL completa y clickeable, NUNCA solo "@divannaeventos" como texto sin link -- a la gente le gusta poder dar clic directo en vez de tener que buscar la cuenta a mano):
- Instagram Divanna Eventos: ${LINK_INSTAGRAM_DIVANNA}
- Instagram El Vaso Maíz: ${LINK_INSTAGRAM_VASOMAIZ}
- Página principal (portafolio completo de ambos negocios): ${LINK_PAGINA_PRINCIPAL}
Manda el link de Instagram que corresponda cada vez que remitas al cliente ahí (ej. para ver más fotos, decoraciones grandes personalizadas, o si preguntan por el perfil). No hace falta mandar los 3 links siempre -- solo el que aplica al momento de la conversación.

CÓMO ARMAR COTIZACIONES COMBINADAS (Divanna + El Vaso Maíz):
1. Si el cliente da suficientes datos (cuántas mesas/sillas, tipo de decoración, si quiere snacks), CALCULA el monto total tú misma sumando los componentes con las reglas de arriba.
2. SIEMPRE cierra cualquier estimado con: "Este es un costo aproximado y se ajustaría cuando se revise detalladamente."
3. VENTA CRUZADA: si el cliente solo pregunta por un negocio, ofrécele el otro al final (si pregunta por snacks, menciona que también hay mobiliario/decoración de Divanna, y viceversa) — siempre el que el cliente aún no ha mencionado.
4. Nunca inventes precios de productos que no estén en este catálogo — si no lo sabes, dilo y ofrece confirmarlo con Diana.

Tu trabajo en cada mensaje:
1. Identificar a cuál negocio se refiere el cliente (o si aplica a ambos).
2. Nunca preguntar información que ya se conoce (revisa el historial y el expediente del evento activo).
3. Ir armando el expediente del evento: fecha, servicios solicitados, número de invitados, ubicación.
4. Responder siguiendo la personalidad definida arriba en "CÓMO HABLAS" (breve, máximo 3-4 líneas), siempre en español de México.
5. TÚ (DiMa) eres quien arma la cotización, nunca un "especialista" ni ninguna otra persona — nunca inventes precios ni montos, pero tampoco digas que alguien más va a contactar al cliente. Solo sigue recopilando datos de forma natural.
6. SI EL CLIENTE PIDE VER LOS PAQUETES/PRECIOS de El Vaso Maíz (ej. "pásame los paquetes", "qué precios tienen"), da un resumen CÁLIDO Y BREVE (1-2 líneas) mencionando el rango de precios (desde $1,500 hasta $3,400 según tamaño), y pídele más datos del evento (fecha, invitados, ubicación) para poder recomendarle el paquete que mejor le convenga — NO enumeres los 5 paquetes completos con todos los ingredientes de cada uno a menos que el cliente insista en ver el detalle completo o ya tengas el número de invitados (en ese caso sí recomienda el paquete específico que más se ajuste). Nunca digas que alguien más se los va a mandar — esto lo haces tú directamente.
7. CUANDO YA IDENTIFICASTE UN PAQUETE FIJO QUE APLICA (ej. cliente pide boda/XV y ya tienes fecha+ubicación, o menciona cantidad de personas que calza con algún paquete de mesas/cristalería): tu PRIMER reply sobre ese paquete debe presentarlo como punto de partida, mandar la foto de referencia (una sola vez) e invitar a ver más ideas en Instagram CON EL LINK REAL, y preguntar si tiene algo específico en mente -- ej. "Mira, este es nuestro paquete de bodas: [detalle breve]. Aquí puedes ver más fotos, videos e ideas: ${LINK_INSTAGRAM_DIVANNA} -- si quieres toma captura de algo que te guste y armamos algo especial. ¿Tienes algo en mente para tu evento?" -- en ese mensaje pon listo_para_cotizar en FALSE aunque ya tengas fecha+servicio+ubicación. Solo pasa listo_para_cotizar a TRUE cuando el cliente ya vio las opciones y confirmó o dio suficiente detalle de lo que quiere. En mensajes SIGUIENTES de la misma conversación, ya no vuelvas a mandar la foto ni el link de Instagram por default -- solo si el cliente pide ver más ejemplos.
8. INVENTARIO REAL (revisa la lista de abajo antes de CONFIRMAR cantidades de Divanna Eventos): si el cliente pide una cantidad de mesas/sillas/copas/manteles/platón que SUPERA lo disponible en el inventario real, NUNCA lo confirmes como si hubiera stock -- dile con calidez que esa cantidad exacta puede estar ajustada y que lo confirmas con Diana, o sugiere una variante de color/material que sí tenga suficiente disponible. Si no tienes el dato de inventario en este momento (puede venir vacío por un error temporal), no bloquees la conversación -- sigue normal y solo aclara que la disponibilidad final se confirma antes de cerrar.

SEÑAL EXPLÍCITA DE CIERRE (MUY IMPORTANTE, revísala en cada mensaje): si el cliente pide directamente que se genere la cotización -- frases tipo "hazme la cotización", "mándame la cotización de todo lo que te pedí", "ok cotízamelo así", "ya, ármala", o CUALQUIER confirmación clara de que quiere proceder con lo ya platicado ("sí, así está bien", "perfecto, va", "de una vez", "está bien, cotízalo", "eso quiero", "adelante") -- pon listo_para_cotizar en TRUE en ESE mismo mensaje, sin importar si antes ya se mostró o no una foto/paquete, y sin importar si la frase exacta no coincide con estos ejemplos -- lo importante es la INTENCIÓN de cerrar, no una frase exacta memorizada. Ante la duda entre seguir platicando o pasar a cotización, si el cliente ya dio fecha+servicio+ubicación Y ya reaccionó positivamente a lo que se le mostró, prefiere avanzar a listo_para_cotizar=TRUE en vez de seguir preguntando indefinidamente -- nunca debe sentirse que la conversación da vueltas sin avanzar. Es una instrucción directa del cliente y nunca debe quedarse sin respuesta ni pedirle más detalles que no haya dado ya.

Expediente del evento activo (puede estar vacío si es la primera vez que escribe):
${eventoActivo ? JSON.stringify(eventoActivo.fields, null, 2) : 'Ninguno — este es un cliente nuevo o inicia un evento nuevo.'}

INVENTARIO REAL DE DIVANNA EVENTOS (cantidad disponible ahora mismo, actualizado en cada mensaje):
${inventarioResumen || 'No disponible en este momento (error temporal) — no bloquees la conversación por esto, solo aclara que confirmas disponibilidad final antes de cerrar.'}

Siempre debes usar la herramienta "responder_cliente" para dar tu respuesta.`;

  const messages = historial
    .filter(h => h.mensaje && String(h.mensaje).trim().length > 0)
    .map(h => ({
      role: h.rol === 'Cliente' ? 'user' : 'assistant',
      content: h.mensaje,
    }));
  messages.push({ role: 'user', content: mensajeCliente });

  // En vez de pedirle a Claude que "responda solo en JSON" (poco confiable
  // una vez que el prompt se vuelve conversacional con el catálogo), usamos
  // tool use forzado: Claude DEBE llamar a esta herramienta, y su "input"
  // ya viene como objeto estructurado, sin necesidad de parsear texto.
  const tools = [{
    name: 'responder_cliente',
    description: 'Registra la clasificación del negocio, los datos del evento, y la respuesta para el cliente.',
    input_schema: {
      type: 'object',
      properties: {
        negocio: { type: ['string', 'null'], enum: ['Divanna Eventos', 'El Vaso Maiz', 'Ambos', null] },
        reply: { type: 'string', description: 'Texto de respuesta para el cliente, en español de México, siguiendo la personalidad definida en "CÓMO HABLAS" (cercana, eficiente, sin sonar a chatbot corporativo), breve.' },
        enviar_imagenes_paquetes: {
          type: 'boolean',
          description: 'TRUE si el cliente pidió explícitamente ver fotos/imágenes de los paquetes de El Vaso Maíz (ej. "mándame las imágenes", "quiero ver fotos"). Si es TRUE, el reply debe decir algo breve tipo "¡Claro! Aquí tienes" sin prometer que se las mandarás después -- se adjuntan automáticamente en el mismo mensaje.',
        },
        imagenes_referencia_a_enviar: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(REFERENCIAS_DECORACION) },
          description: 'IDs (máximo 3) del catálogo de FOTOS DE REFERENCIA DE DECORACIÓN que mejor se ajustan a lo que el cliente pidió ver o al tema que mencionó. Vacío [] si no aplica en este mensaje. Si se llena, el reply debe decir algo breve tipo "¡Claro! Mira estos ejemplos" sin prometer que se las mandarás después -- se adjuntan automáticamente en el mismo mensaje.',
        },
        listo_para_cotizar: {
          type: 'boolean',
          description: 'TRUE únicamente cuando la conversación ya llegó al punto de pasar a cotización formal con Diana -- es decir, ya se le mostró al cliente el paquete/opciones aplicables (si existía uno fijo) Y el cliente ya confirmó o dio suficiente detalle de lo que quiere. FALSE en el primer mensaje donde apenas se junta fecha+servicio+ubicación: en ESE mensaje, si hay un paquete fijo que aplica (ej. boda $6,500, XV $6,000, algún paquete de mesas/cristalería), tu reply debe presentarlo brevemente como punto de partida y preguntar si tiene algo específico en mente -- NUNCA saltar directo al mensaje de "ya tengo todos sus datos, inicio cotización" sin antes haber mostrado el paquete y dejar que el cliente reaccione. Cuando listo_para_cotizar sea TRUE, el sistema reemplaza tu reply automáticamente por el mensaje fijo de inicio de cotización, así que no hace falta que tú lo redactes.',
        },
        updates: {
          type: 'object',
          properties: {
            Fecha_Evento: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD, o null si no se sabe.' },
            Servicios_Solicitados: { type: ['string', 'null'] },
            Invitados: { type: ['number', 'null'] },
            Ubicacion: { type: ['string', 'null'] },
            Monto_Estimado: { type: ['number', 'null'], description: 'Monto total aproximado en pesos MXN, calculado con las reglas del catálogo (solo si ya hay suficientes datos para calcularlo; null si aún falta información).' },
          },
          required: ['Fecha_Evento', 'Servicios_Solicitados', 'Invitados', 'Ubicacion', 'Monto_Estimado'],
        },
      },
      required: ['negocio', 'reply', 'enviar_imagenes_paquetes', 'imagenes_referencia_a_enviar', 'listo_para_cotizar', 'updates'],
    },
  }];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools,
      tool_choice: { type: 'tool', name: 'responder_cliente' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const toolUse = data.content.find(b => b.type === 'tool_use');

  if (!toolUse || !toolUse.input) {
    console.error('Claude no devolvió tool_use válido. Respuesta completa:', JSON.stringify(data).slice(0, 500));
    return {
      negocio: null,
      reply: 'Gracias por tu mensaje, en un momento te atiendo con todos los detalles.',
      updates: {},
    };
  }

  return toolUse.input;
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
// Descarga una imagen de Twilio (requiere autenticación básica con las
// credenciales de la cuenta) y la devuelve en base64 lista para mandar a Claude.
async function descargarMediaComoBase64(mediaUrl) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const res = await fetch(mediaUrl, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
  });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, mediaType: contentType.split(';')[0] };
}

// Analiza una imagen con Claude (visión) para saber si es un comprobante de
// pago/depósito, y si sí, extraer monto y método. Caso real que resuelve:
// las 3 llamadas el mismo día preguntando "¿ya llegó mi depósito?" -- ahora
// DiMa lo confirma sola, sin que Diana/Víctor tengan que contestar llamadas.
async function procesarPosibleComprobante({ mediaUrl, from, profileName, hayTextoJunto }) {
  try {
    const { base64, mediaType } = await descargarMediaComoBase64(mediaUrl);

    const tools = [{
      name: 'analizar_comprobante',
      description: 'Analiza si la imagen es un comprobante de pago/transferencia/depósito.',
      input_schema: {
        type: 'object',
        properties: {
          es_comprobante_de_pago: { type: 'boolean' },
          monto: { type: ['number', 'null'], description: 'Monto detectado en el comprobante, o null si no se distingue.' },
          metodo: { type: ['string', 'null'], enum: ['Transferencia', 'Depósito', 'Efectivo', null] },
        },
        required: ['es_comprobante_de_pago', 'monto', 'metodo'],
      },
    }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Analiza esta imagen: ¿es un comprobante de pago, transferencia o depósito bancario? Si sí, extrae el monto y el método.' },
          ],
        }],
        tools,
        tool_choice: { type: 'tool', name: 'analizar_comprobante' },
      }),
    });

    if (!res.ok) throw new Error(`Claude vision error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const toolUse = data.content.find(b => b.type === 'tool_use');
    const analisis = toolUse ? toolUse.input : { es_comprobante_de_pago: false };

    if (!analisis.es_comprobante_de_pago) {
      // No es un comprobante -- si no hay texto en el mismo mensaje, respondemos
      // algo breve para no dejar al cliente sin respuesta; si sí hay texto,
      // dejamos que el flujo normal de conversación lo atienda.
      return hayTextoJunto ? null : 'Recibí tu imagen 📷 ¿me cuentas en qué te ayudo con ella?';
    }

    // Sí es comprobante: buscamos al cliente y su evento activo para actualizar.
    const client = await findClientByPhone(from);
    if (!client) {
      return '¡Gracias por tu comprobante! Para confirmarlo contra tu pedido, ¿me recuerdas tu nombre y para qué evento es? 😊';
    }
    const event = await findActiveEvent(client.id);
    if (!event) {
      return '¡Gracias por tu comprobante! No encuentro un evento activo a tu nombre todavía -- ¿me confirmas los datos de tu pedido para poder ligarlo?';
    }

    const metodoTexto = analisis.metodo || 'Transferencia';
    const montoDetectado = analisis.monto || null;
    const montoAdeudadoActual = event.fields.Monto_Adeudado || 0;
    const yaQuedaLiquidado = montoDetectado && montoAdeudadoActual && montoDetectado >= montoAdeudadoActual;

    await updateEvent(event.id, {
      Estatus_Pago: yaQuedaLiquidado ? 'Liquidado 100%' : `Pagado - ${metodoTexto}`,
      Monto_Adeudado: yaQuedaLiquidado ? 0 : Math.max((montoAdeudadoActual || 0) - (montoDetectado || 0), 0),
    });

    // Avisamos a Diana y Víctor -- sin que tengan que revisar ni contestar llamadas.
    const avisoEquipo =
      `💰 Pago confirmado automáticamente\n` +
      `Cliente: ${profileName || from}\n` +
      `Evento: ${event.fields.Folio_Evento}\n` +
      `Monto detectado: ${montoDetectado ? '$' + montoDetectado : 'no se pudo leer con certeza'}\n` +
      `Método: ${metodoTexto}\n` +
      (yaQuedaLiquidado ? 'Estatus: LIQUIDADO 100%' : `Restante: $${Math.max((montoAdeudadoActual || 0) - (montoDetectado || 0), 0)}`);
    await Promise.all([
      enviarWhatsApp(process.env.DIANA_WHATSAPP_NUMBER, avisoEquipo),
      enviarWhatsApp(process.env.VICTOR_WHATSAPP_NUMBER, avisoEquipo),
    ]);

    return montoDetectado
      ? `¡Recibido! Confirmamos tu pago de $${montoDetectado} 💜 ${yaQuedaLiquidado ? 'Tu evento queda liquidado al 100%, ¡todo listo!' : 'Gracias por tu abono.'}`
      : '¡Recibido tu comprobante! Lo estamos verificando y en un momento te confirmamos. 💜';
  } catch (err) {
    console.error('Error procesando posible comprobante:', err.message);
    // Ante un error, si no hay texto en el mismo mensaje evitamos dejar al
    // cliente sin respuesta; si sí hay texto, dejamos que el flujo normal continúe.
    return hayTextoJunto ? null : 'Recibí tu imagen 📷 En un momento la reviso, gracias por tu paciencia.';
  }
}

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
    const numMedia = parseInt(req.body.NumMedia || '0', 10);
    const mediaContentType = req.body.MediaContentType0 || '';

    console.log('DiMa webhook recibido:', JSON.stringify({
      from,
      bodyLength: body.length,
      numMedia,
      mediaContentType,
    }));

    if (!from) {
      res.status(400).send('Missing From');
      return;
    }

    // Por ahora DiMa no puede transcribir notas de voz. En vez de dejar al
    // cliente sin respuesta (que es lo que pasaba antes), le pedimos con
    // calidez que lo escriba, siguiendo la personalidad de DiMa.
    if (!body && numMedia > 0 && mediaContentType.startsWith('audio/')) {
      const mensajeAudio = 'Por el momento no puedo escuchar audios, ¿me lo escribes porfa? Así te atiendo más rápido.';
      const twimlAudio = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(mensajeAudio)}</Message></Response>`;
      res.setHeader('Content-Type', 'text/xml');
      res.status(200).send(twimlAudio);
      return;
    }

    // ---------- CONFIRMACIÓN AUTOMÁTICA DE PAGOS (foto de comprobante) ----------
    // Caso real que motivó esto: 3 llamadas el mismo día preguntando si ya se
    // había recibido un depósito. En vez de que Diana/Víctor tengan que revisar
    // manualmente, DiMa lee la imagen con visión, confirma el pago, actualiza
    // Airtable, y le avisa al cliente Y al equipo -- sin que nadie conteste llamadas.
    if (numMedia > 0 && mediaContentType.startsWith('image/')) {
      const respuestaPago = await procesarPosibleComprobante({
        mediaUrl: req.body.MediaUrl0,
        from,
        profileName,
        hayTextoJunto: !!body,
      });
      if (respuestaPago) {
        const twimlPago = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(respuestaPago)}</Message></Response>`;
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twimlPago);
        return;
      }
      // Si no se detectó como comprobante de pago, seguimos el flujo normal
      // de texto (si el cliente además escribió algo en el mismo mensaje).
    }

    if (!body) {
      res.status(400).send('Missing Body');
      return;
    }

    // ---------- BALANCE SEMANAL: mandar el detalle completo si hay uno pendiente ----------
    // Cuando el cron manda la plantilla aprobada del balance (simple, sin
    // detalle), guarda el mensaje completo en Airtable esperando que Diana o
    // Víctor respondan algo -- eso abre la ventana de 24h y aquí les mandamos
    // el desglose real y cálido, en el tono normal de DiMa.
    const numeroDianaLimpio = (process.env.DIANA_WHATSAPP_NUMBER || '').replace('whatsapp:', '').replace(/\D/g, '');
    const numeroVictorLimpio = (process.env.VICTOR_WHATSAPP_NUMBER || '').replace('whatsapp:', '').replace(/\D/g, '');
    const fromLimpio = from.replace(/\D/g, '');
    const esEquipoInterno = (numeroDianaLimpio && fromLimpio.endsWith(numeroDianaLimpio)) || (numeroVictorLimpio && fromLimpio.endsWith(numeroVictorLimpio));

    const CLAVE_BALANCE = '5555';
    if (esEquipoInterno && body.trim() === CLAVE_BALANCE) {
      try {
        const formula = encodeURIComponent("AND(NOT({Detalle_Enviado}), {Detalle_Completo} != '')");
        const balancesPendientes = await airtableRequest(`${TABLES.BALANCES}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Fecha_Fin&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`);
        if (balancesPendientes.records.length > 0) {
          const balanceReciente = balancesPendientes.records[0];
          if (balanceReciente.fields.Detalle_Completo) {
            await updateBalance(balanceReciente.id, { Detalle_Enviado: true });
            const twimlBalance = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(balanceReciente.fields.Detalle_Completo)}</Message></Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.status(200).send(twimlBalance);
            return;
          }
        }
        // Si escribieron la clave pero no hay ningún balance pendiente, avisamos.
        const twimlSinBalance = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml('No tengo ningún balance pendiente por mostrarte en este momento 💜')}</Message></Response>`;
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twimlSinBalance);
        return;
      } catch (e) {
        console.error('Error revisando balance pendiente:', e.message);
        // si falla, seguimos el flujo normal en vez de tronar
      }
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
        let itemsChecklist = [];
        if (comandoUpper === 'SI') {
          itemsChecklist = parsearItemsDeServicios(eventoFolio.fields.Items_Detallados_Cotizacion || eventoFolio.fields.Servicios_Solicitados);
          await updateEvent(eventoFolio.id, {
            Autorizacion_Diana: 'SI',
            Checklist_Items: itemsChecklist.join('\n'),
            Checklist_Items_Marcados: '[]',
          });
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

        // Respondemos a Diana DE INMEDIATO -- lo de abajo (Google Calendar/
        // Sheets/correo) es lo más lento y menos crítico de esta rama, nunca
        // debe hacerla esperar su confirmación.
        res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(confirmacion)}</Message></Response>`);

        if (comandoUpper === 'SI') {
          // Integraciones de Google: agendar en Calendar, registrar en Sheets,
          // y mandar correo al cliente si dio su email. Ninguna de estas debe
          // afectar la respuesta ya enviada si falla -- son "nice to have".
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
              monto: f.Monto_Estimado_IA || '',
            };

            await Promise.all([
              crearEventoCalendar(datosEvento),
              agregarFilaCotizacion({ ...datosEvento, clienteNombre, clienteTelefono }),
              clienteEmail ? enviarCotizacionPorCorreo({ ...datosEvento, emailCliente: clienteEmail }) : Promise.resolve(),
            ]);
          } catch (googleErr) {
            console.error('Error en integraciones de Google (no crítico, no afecta a Diana):', googleErr.message);
          }
        }
        return;
      }
      // Si el mensaje de Diana no matchea el formato esperado, seguimos el flujo normal
      // (podría ser una pregunta suya, no necesariamente una autorización).
    }

    // 1. Buscar o crear cliente (necesario antes que todo lo demás)
    let client = await findClientByPhone(from);
    if (!client) {
      client = await createClient(from, profileName);
    }

    // 2-4. PARALELIZADO: estas tres llamadas son independientes entre sí y
    // antes se hacían una tras otra (incluyendo 2 llamadas duplicadas a
    // getClientRecord que ya se eliminaron). Este es el cambio de rendimiento
    // más importante del webhook -- reduce varios segundos de latencia
    // encadenada, sobre todo en el mensaje que dispara la cotización final.
    const [event, historial, inventarioResumen] = await Promise.all([
      findActiveEvent(client),
      getRecentHistory(client, 10), // se pide ANTES de loguear el mensaje actual, así que ya viene "limpio"
      obtenerInventarioResumen(),
    ]);

    // 5. Guardar mensaje entrante en paralelo con la llamada a Claude --
    // el log no bloquea ni depende de la respuesta de la IA.
    const logEntrantePromise = logConversation(client.id, event ? event.id : null, body, 'Cliente');

    const aiResultPromise = askClaude({
      mensajeCliente: body,
      historial, // ya no incluye el mensaje actual porque el log entrante corre en paralelo, no antes
      eventoActivo: event,
      inventarioResumen,
    });

    const [, aiResult] = await Promise.all([logEntrantePromise, aiResultPromise]);

    // 6. Crear evento si no existía y ya se identificó negocio
    let eventoFinal = event;
    if (!eventoFinal && aiResult.negocio) {
      eventoFinal = await createEvent(client.id, aiResult.negocio);
    }

    // 7. Actualizar expediente del evento con los datos nuevos
    let dispararCotizacionDiana = false;
    if (eventoFinal && aiResult.updates) {
      const fieldsToUpdate = {};
      if (aiResult.updates.Fecha_Evento) fieldsToUpdate.Fecha_Evento = aiResult.updates.Fecha_Evento;
      if (aiResult.updates.Servicios_Solicitados) fieldsToUpdate.Servicios_Solicitados = aiResult.updates.Servicios_Solicitados;
      if (aiResult.updates.Invitados) fieldsToUpdate.Invitados = aiResult.updates.Invitados;
      if (aiResult.updates.Ubicacion) fieldsToUpdate.Ubicacion = aiResult.updates.Ubicacion;
      if (aiResult.updates.Monto_Estimado) fieldsToUpdate.Monto_Estimado_IA = aiResult.updates.Monto_Estimado;
      if (Object.keys(fieldsToUpdate).length > 0) {
        await updateEvent(eventoFinal.id, fieldsToUpdate);
        eventoFinal.fields = { ...eventoFinal.fields, ...fieldsToUpdate };
      }

      // Cuando ya hay lo mínimo para cotizar y todavía no se le ha mandado
      // a Diana, DiMa responde al cliente con el texto fijo de inmediato.
      // El envío real de la notificación a Diana (2 llamadas de red: Airtable
      // + Twilio) se hace DESPUÉS de responderle al cliente (ver abajo) --
      // así el cliente nunca se queda esperando por algo que no le compete a él.
      const yaTieneLoMinimo = eventoFinal.fields.Fecha_Evento && eventoFinal.fields.Servicios_Solicitados && eventoFinal.fields.Ubicacion && aiResult.listo_para_cotizar;
      if (yaTieneLoMinimo && !eventoFinal.fields.Cotizacion_Enviada_Diana) {
        dispararCotizacionDiana = true;
        // Se marca de inmediato en el objeto en memoria (aunque el PATCH real
        // a Airtable ocurre dentro de enviarCotizacionADiana) para blindar
        // contra un reintento de Twilio del mismo webhook disparando esto dos veces.
        eventoFinal.fields.Cotizacion_Enviada_Diana = true;
        aiResult.reply =
          'Gracias, tengo todos sus datos, inicio su cotización. ' +
          'En menos de 24 hrs le envío su cotización. Si es urgente el día ' +
          'de hoy, hágamelo saber y con gusto le damos turno prioritario.';
      }
    }

    // 8. Construir y ENVIAR la respuesta a Twilio primero -- esto es lo único
    // que realmente le importa al cliente y a Twilio (que tiene su propio
    // límite de tiempo de espera en el webhook). Todo lo que sigue después
    // (notificar a Diana, guardar el log de salida, marcar fotos ya enviadas)
    // es trabajo de "back office" que no debe retrasar esta respuesta.
    const baseUrl = 'https://divanna-eventos.vercel.app';
    const mediasPaquetes = aiResult.enviar_imagenes_paquetes
      ? [
          `<Media>${baseUrl}/paquetes/paquetes-1-a-4.jpg</Media>`,
          `<Media>${baseUrl}/paquetes/paquete-5-raspados-maruchan.jpg</Media>`,
          `<Media>${baseUrl}/paquetes/sabritas-preparadas.jpg</Media>`,
        ].join('')
      : '';
    const mediasReferencia = (aiResult.imagenes_referencia_a_enviar || [])
      .slice(0, 3)
      .filter(id => REFERENCIAS_DECORACION[id])
      .filter(id => {
        // Nunca reenviar una foto que ya se mandó en este evento -- control
        // determinístico en Airtable, no depende de que Claude "recuerde"
        // el historial (los adjuntos no viven en el texto del historial).
        const yaEnviadas = (eventoFinal && eventoFinal.fields.Imagenes_Referencia_Enviadas || '').split(',').map(s => s.trim()).filter(Boolean);
        return !yaEnviadas.includes(id);
      });
    const mediasReferenciaTwiml = mediasReferencia
      .map(id => `<Media>${baseUrl}/referencias/${REFERENCIAS_DECORACION[id].archivo}</Media>`)
      .join('');
    const medias = mediasPaquetes + mediasReferenciaTwiml;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(aiResult.reply)}${medias}</Message></Response>`;
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

    // 9. TRABAJO DE BACK OFFICE (después de responder al cliente). Va en su
    // propio try/catch para que un error aquí NUNCA se vea reflejado como un
    // fallo de la respuesta ya enviada -- el cliente ya recibió su mensaje.
    try {
      const tareasPendientes = [
        logConversation(client.id, eventoFinal ? eventoFinal.id : null, aiResult.reply, 'IA'),
      ];
      if (eventoFinal && mediasReferencia.length > 0) {
        const yaEnviadas = (eventoFinal.fields.Imagenes_Referencia_Enviadas || '').split(',').map(s => s.trim()).filter(Boolean);
        const actualizadas = [...yaEnviadas, ...mediasReferencia].join(',');
        tareasPendientes.push(updateEvent(eventoFinal.id, { Imagenes_Referencia_Enviadas: actualizadas }));
      }
      if (dispararCotizacionDiana) {
        tareasPendientes.push(enviarCotizacionADiana(eventoFinal));
      }
      await Promise.all(tareasPendientes);
    } catch (bgErr) {
      console.error('Error en trabajo de back office (no afecta al cliente, ya se le respondió):', bgErr.message);
    }

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
