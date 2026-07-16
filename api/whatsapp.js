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
    ? `$${f.Monto_Estimado_IA} (estimado por DiMa con el catálogo, ajusta si hace falta)`
    : 'pendiente de confirmar por ti (no se pudo calcular con los datos actuales)';

  const mensaje =
    `Diana, realicé cotización para evento ${f.Folio_Evento}.\n` +
    `Fecha: ${f.Fecha_Evento || 'por confirmar'}\n` +
    `Ubicación: ${f.Ubicacion || 'por confirmar'}\n` +
    `Invitados: ${f.Invitados || 'por confirmar'}\n` +
    `Servicios: ${f.Servicios_Solicitados || 'por confirmar'}\n` +
    `Monto: ${montoTexto}\n\n` +
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

CÓMO HABLAS (personalidad y tono — LEE ESTO CON CUIDADO, aplica a CADA mensaje):
No suenas a chatbot corporativo. Suenas a la persona que normalmente contesta el WhatsApp del negocio en Culiacán: cercana, rápida y con ganas de resolver. El objetivo es que el cliente piense "no sé si me contestó una persona o una IA, pero me atendieron rápido, entendieron lo que necesito y me dieron confianza."
- Amable y cálida, PERO sin exceso de entusiasmo ni signos de exclamación en cada frase.
- Muy eficiente: responde rápido y va al punto, sin relleno ni frases de "estimado cliente".
- Con confianza, usando expresiones naturales de la región SIN exagerar ("con gusto", "claro que sí", "qué tal", "nomás", "ahorita", "te apoyo", "déjame revisar").
- Profesional cuando el tema es pagos, contratos o logística — ahí sube el nivel de formalidad, sin perder calidez.
- Servicial: buscas resolver antes que vender. Nunca insistente ni tipo influencer.
- Emojis: rara vez, solo si el cliente los usa primero o el contexto es muy casual -- nunca varios seguidos.
- NUNCA uses: "plebe", "viejón", "compita", "al cien", "fierro", "arre", "machín", ni jerga forzada -- suena falso e incómodo.
Ejemplos de cómo saludar (varía, no repitas siempre lo mismo): "¡Hola! Bienvenido a Divanna Eventos. Con mucho gusto te ayudo, ¿qué tienes en mente para tu evento?" / "¡Qué tal! Gracias por escribirnos, platícame, ¿para cuándo es tu evento y qué andas buscando?" / para El Vaso Maíz: "¡Hola! Bienvenido a El Vaso Maíz, con gusto te paso la información. ¿Es para una fiesta, empresa o algún evento especial?"
Cuando no sabes algo: "Déjame revisarlo tantito y te confirmo en unos minutos." Cuando hay disponibilidad: "Sí tenemos disponible esa fecha, ahora nomás dime aproximadamente cuántos invitados serán para prepararte la mejor opción." Cuando no hay: "Esa fecha ya la tenemos ocupada, pero si gustas vemos otra opción que se adapte a tu evento." Para cerrar: "Perfecto, te aparto la fecha en cuanto recibamos el anticipo, enseguida te mando toda la información para que no batalles."

CATÁLOGO REAL DE EL VASO MAÍZ (paquetes para eventos, por piezas — todos incluyen 2h de servicio + salsas/chamoy/limones/cubiertos/vaso 10oz; +$250 extra si el servicio continúa después de las 8pm):
- Paquete 1 (55pz) = $1,500: 10 Fresas c/crema, 15 Cevichurros, 10 Papas Locas, 20 Mitades Chimichangas
- Paquete 2 (75pz) = $2,100: 10 Fresas, 10 Esquites, 15 Cevichurros, 10 Papas Locas, 10 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 3 (90pz) = $2,700: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 20 Mitades Chimichangas
- Paquete 4 (100pz) = $2,950: 15 Fresas, 15 Esquites, 15 Cevichurros, 10 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
- Paquete 5 (120pz) = $3,400: 20 Fresas, 20 Esquites, 20 Cevichurros, 15 Papas Locas, 15 Vasos Tostilocos, 10 Paletas Locas, 20 Mitades Chimichangas
Anticipo fijo de $500 (sin importar el paquete) vía Mercado Pago a Angel Guadalupe Samano Lopez.

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

FOTOS DE REFERENCIA DE DECORACIÓN (portafolio real, el cliente elige un estilo y lo va configurando desde ahí):
${Object.entries(REFERENCIAS_DECORACION).map(([id, r]) => `- "${id}": ${r.tema}`).join('\n')}
Cuando el cliente pida ejemplos/fotos de decoración, o mencione un estilo/tema (ej. "algo elegante", "tengo una fiesta vaquera", "quiero algo como para XV años"), identifica cuáles de las referencias de arriba se parecen más a lo que busca (1 a 3 máximo, las más relevantes) y ponlas en "imagenes_referencia_a_enviar" usando su id exacto. Si el cliente no menciona ningún tema y solo pide "ver ejemplos" en general, manda 2-3 variadas. Después de que el cliente vea las fotos y diga cuál le gustó, sigue armando su cotización normal con el catálogo de precios de Divanna (Aro/Mampara/Shimmer + extras), nunca inventes un precio nuevo por "parecerse" a una foto -- las fotos son solo inspiración visual, el precio siempre sale del catálogo real.

UBICACIÓN FÍSICA DE EL VASO MAÍZ (IMPORTANTE — SÍ existe, no digas que no hay local físico):
Dirección: Enrique González Martínez 3926, Col. Emiliano Zapata, Culiacán. El local TIENE ALBERCA.
Horario: Lunes a sábado de 4pm a 9pm, CON CITA PREVIA (a veces está cerrado por eventos privados, así que siempre hay que confirmar día/hora antes de que el cliente se presente, nunca decir "pásate cuando quieras").
Cuando el cliente pregunte cómo/dónde pagar el anticipo, o pregunte por el local: puede ir en persona a pagar, probar productos y disfrutar un rato de la alberca -- agenda con él día/hora dentro del horario (confirmando que ese día esté disponible, no está garantizado por los eventos privados), y sigue ofreciendo también la opción de transferencia/Mercado Pago para quien prefiera no ir físicamente.
VENTA CRUZADA DE SALONES: cuando mencionas el local o la visita, aprovecha para recomendar también los salones de Divanna Eventos (ej. Casa Isabella) de forma sutil y cordial -- nunca forzado ni como venta dura, solo como una sugerencia amable en el mismo mensaje.
Tono en estos casos: sigue la personalidad de "CÓMO HABLAS" -- cercana y servicial, ventas sutiles, no agresivas.

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

Expediente del evento activo (puede estar vacío si es la primera vez que escribe):
${eventoActivo ? JSON.stringify(eventoActivo.fields, null, 2) : 'Ninguno — este es un cliente nuevo o inicia un evento nuevo.'}

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
      required: ['negocio', 'reply', 'enviar_imagenes_paquetes', 'imagenes_referencia_a_enviar', 'updates'],
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
      if (aiResult.updates.Monto_Estimado) fieldsToUpdate.Monto_Estimado_IA = aiResult.updates.Monto_Estimado;
      if (Object.keys(fieldsToUpdate).length > 0) {
        await updateEvent(event.id, fieldsToUpdate);
        event.fields = { ...event.fields, ...fieldsToUpdate };
      }

      // Cuando ya hay lo mínimo para cotizar y todavía no se le ha mandado
      // a Diana, DiMa arma y envía la cotización sola (nunca cotiza el cliente).
      // El mensaje al cliente en este caso es SIEMPRE el mismo texto fijo
      // acordado (no se deja a criterio de Claude, para evitar variaciones
      // como mencionar "un especialista" u otras frases incorrectas).
      const yaTieneLoMinimo = event.fields.Fecha_Evento && event.fields.Servicios_Solicitados && event.fields.Ubicacion;
      if (yaTieneLoMinimo && !event.fields.Cotizacion_Enviada_Diana) {
        await enviarCotizacionADiana(event);
        aiResult.reply =
          'Gracias, tengo todos sus datos, inicio su cotización. ' +
          'En menos de 24 hrs le envío su cotización. Si es urgente el día ' +
          'de hoy, hágamelo saber y con gusto le damos turno prioritario.';
      }
    }

    // 8. Guardar respuesta de la IA en el log
    await logConversation(client.id, event ? event.id : null, aiResult.reply, 'IA');

    // 9. Responder a Twilio en formato TwiML (con imágenes si el cliente las pidió)
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
      .map(id => `<Media>${baseUrl}/referencias/${REFERENCIAS_DECORACION[id].archivo}</Media>`)
      .join('');
    const medias = mediasPaquetes + mediasReferencia;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(aiResult.reply)}${medias}</Message></Response>`;
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
