// api/dima-chat.js
// Chat público de DiMa en la landing ("Haz aquí tu cotización"). Reemplaza al
// bot de WhatsApp: platica con el cliente, le da un estimado con el catálogo y,
// cuando el cliente confirma, registra el pedido (api/_pedidos.js) para que
// Diana lo revise y autorice en la app.
//
// El servidor no guarda estado: el navegador manda el historial completo (solo
// texto) en cada mensaje. Para que la plática no se alargue (ni el costo):
// - a partir de AVISO_CIERRE mensajes del cliente, DiMa recibe la instrucción
//   de ir cerrando con amabilidad (resumen, datos de contacto, registrar);
// - al pasar MAX_MENSAJES_CLIENTE ya no se llama a Claude: se le ofrece al
//   cliente que Diana lo contacte o usar el formulario;
// - límite de envíos por IP (ver limiteDeEnvios).
//
// Requiere ANTHROPIC_API_KEY en Vercel.

const { Anthropic } = require('@anthropic-ai/sdk');
const { validarPedido, crearPedido } = require('./_pedidos');
const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarTelegramEquipo } = require('./_telegram');
const { ROLES } = require('./_sesion');
const { CATALOGO, REFERENCIAS_DECORACION, FOTOS_PAQUETES_VASOMAIZ, LINK_INSTAGRAM_DIVANNA } = require('./_dima-catalogo');

const MODELO = 'claude-sonnet-5-5';
const MAX_MENSAJES_CLIENTE = 20;
const AVISO_CIERRE = 14;
const MAX_MENSAJES = MAX_MENSAJES_CLIENTE * 2;
const MAX_CARACTERES_MENSAJE = 1500;
const MAX_CARACTERES_TOTAL = 30000;

const client = new Anthropic();

// Límite de envíos por IP: mínimo 2 s entre mensajes y máximo 40 mensajes cada
// 30 minutos. Vive en la memoria de cada instancia de la función, así que es un
// freno básico contra abuso, no un límite exacto; para algo más firme se agrega
// una regla de rate limiting en el Firewall de Vercel.
const ENVIOS_POR_IP = new Map();
const VENTANA_MS = 30 * 60 * 1000;
const MAX_ENVIOS_VENTANA = 40;
const ESPERA_MINIMA_MS = 2000;

function limiteDeEnvios(ip) {
  const ahora = Date.now();
  const envios = (ENVIOS_POR_IP.get(ip) || []).filter(t => ahora - t < VENTANA_MS);
  if (envios.length && ahora - envios[envios.length - 1] < ESPERA_MINIMA_MS) return 'rapido';
  if (envios.length >= MAX_ENVIOS_VENTANA) return 'muchos';
  envios.push(ahora);
  ENVIOS_POR_IP.set(ip, envios);
  if (ENVIOS_POR_IP.size > 5000) ENVIOS_POR_IP.clear();
  return null;
}

const MENSAJE_LIMITE =
  'Ya platicamos bastante y no quiero quitarte más tiempo. Si ya registramos tu pedido, Diana te contacta ' +
  'para confirmarlo. Si todavía no, deja tus datos en el formulario de abajo y Diana te llama para terminar ' +
  'tu cotización. ¡Gracias por la confianza!';

const ID_FOTOS_VASOMAIZ = 'paquetes-vasomaiz';

const TOOLS = [
  {
    name: 'mostrar_fotos',
    description: 'Muestra en el chat fotos reales del portafolio. Úsala cuando el cliente pida ver ejemplos o cuando presentes por primera vez un paquete que tiene foto. Máximo 3 por mensaje y nunca repitas una foto que ya mostraste en esta conversación.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string', enum: [...Object.keys(REFERENCIAS_DECORACION), ID_FOTOS_VASOMAIZ] },
          description: `IDs de FOTOS DE REFERENCIA DE DECORACIÓN, o "${ID_FOTOS_VASOMAIZ}" para las fotos de los paquetes de El Vaso Maíz.`,
        },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_pedido',
    description: 'Registra el pedido para que Diana lo revise y confirme la cotización. Úsala solo cuando el cliente ya confirmó lo que quiere y ya te dio nombre, teléfono y fecha. Si ya registraste el pedido en esta conversación y el cliente pide cambios, vuelve a llamarla con los datos completos actualizados.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        telefono: { type: 'string', description: 'Teléfono de 10 dígitos del cliente.' },
        email: { type: ['string', 'null'], description: 'Correo del cliente si lo dio, para mandarle la cotización confirmada.' },
        negocio: { type: 'string', enum: ['Divanna Eventos', 'El Vaso Maiz', 'Ambos'] },
        tipo_evento: { type: 'string', description: 'Boda, XV años, cumpleaños, baby shower, empresa...' },
        fecha: { type: 'string', description: 'Fecha del evento en formato YYYY-MM-DD.' },
        invitados: { type: ['integer', 'null'] },
        ubicacion: { type: 'string', description: 'Colonia, salón o dirección del evento.' },
        servicios: { type: 'string', description: 'Lo acordado, un artículo o servicio por línea (ej. "10 mesas redondas con mantel"). Diana usa estas líneas como checklist de carga.' },
        monto_estimado: { type: ['number', 'null'], description: 'Total aproximado en pesos MXN calculado con el catálogo, o null si no se pudo calcular.' },
      },
      required: ['nombre', 'telefono', 'email', 'negocio', 'tipo_evento', 'fecha', 'invitados', 'ubicacion', 'servicios', 'monto_estimado'],
      additionalProperties: false,
    },
  },
];

function systemPrompt() {
  const hoy = new Date();
  const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(hoy);
  const hoyTexto = hoy.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mazatlan' });

  return `Eres DiMa, la asistente del chat de la página web de dos negocios hermanos en Culiacán, Sinaloa:
1. DIVANNA EVENTOS: renta de mobiliario y artículos para eventos (mesas, sillas, decoración, montaje) y el salón Casa Isabella. NO coordina eventos.
2. EL VASO MAÍZ: snacks para eventos (barras de snacks, elotes en vaso, papas preparadas, antojitos).

FECHA DE HOY: ${hoyTexto} (${hoyISO}). Úsala para resolver fechas relativas ("el próximo viernes", "en dos meses") y para saber si una fecha cae entre semana o en fin de semana -- calcúlalo tú, no se lo preguntes al cliente.

CÓMO HABLAS:
- Suenas a la persona que atiende el negocio en Culiacán: cercana, rápida, con ganas de resolver. Cálida y sinaloense sin caricatura: "con gusto", "claro que sí", "qué tal", "nomás", "ahorita", "te apoyo", "déjame revisar". Nunca "plebe", "viejón", "compita", "al cien", "fierro", "arre", "machín".
- Mensajes breves (2 a 4 líneas), sin relleno corporativo ni signos de exclamación en cada frase. Emojis rara vez.
- Interés genuino por el evento, sea una piñata o una boda de 200 personas: platica con curiosidad ("¿Para cuándo será?", "¿Cuántas personas los van a acompañar?", "¿Ya tienen tema o colores?") en vez de pedir datos como formulario. Nunca preguntes algo que el cliente ya dijo.
- Cuando algo no lo manejan, no cierres la puerta: reconoce lo que sí ofrecen y explora con el cliente qué tiene en mente.
- No repitas el desglose completo de un paquete que ya presentaste; refiérete a él ("el paquete que ya vimos").
- Una idea por mensaje: no apiles repaso + anticipo + visita + venta cruzada en un solo mensaje.
- Este chat no tiene archivos adjuntos: si el cliente quiere enseñarte una imagen de referencia, pídele que la describa o que la mande por Instagram (${LINK_INSTAGRAM_DIVANNA}).

FLUJO DE LA COTIZACIÓN:
1. Platica para conocer el evento: negocio (o ambos), tipo de evento, fecha, invitados, ubicación y qué necesita.
2. Arma un estimado con el catálogo de abajo y preséntalo con un repaso breve de lo que lleva. Cierra todo estimado con: "Este es un costo aproximado y se ajustaría cuando se revise detalladamente."
3. Cuando el cliente confirme que así lo quiere, pídele su nombre y un teléfono de 10 dígitos (y su correo si quiere recibir la cotización por ahí) para registrar el pedido.
4. Con eso llama a registrar_pedido. Después dile que Diana revisa la disponibilidad y confirma la cotización, y que lo contactan por teléfono para el anticipo y los datos de pago.
- Si el cliente pide directamente "hazme la cotización", "así está bien", "adelante" o cualquier confirmación clara, avanza al paso 3 sin seguir preguntando.
- Nunca digas que la fecha ya quedó apartada ni que hay disponibilidad confirmada: la apartan con el anticipo, después de que Diana confirma.
- Nunca inventes precios fuera del catálogo; si no lo sabes, dilo y explica que Diana lo confirma al revisar el pedido.

${CATALOGO}`;
}

// Convierte el historial del navegador en mensajes de la API, validando tamaños.
function construirMensajes(historial) {
  if (!Array.isArray(historial) || historial.length === 0 || historial.length > MAX_MENSAJES) return null;
  let total = 0;
  const mensajes = [];
  for (const h of historial) {
    if (!h || (h.rol !== 'cliente' && h.rol !== 'dima') || typeof h.texto !== 'string') return null;
    const texto = h.texto.trim();
    if (!texto || texto.length > (h.rol === 'cliente' ? MAX_CARACTERES_MENSAJE : 4000)) return null;
    total += texto.length;
    mensajes.push({ role: h.rol === 'cliente' ? 'user' : 'assistant', content: texto });
  }
  if (total > MAX_CARACTERES_TOTAL || mensajes[0].role !== 'user' || mensajes[mensajes.length - 1].role !== 'user') return null;
  return mensajes;
}

function urlsDeFotos(ids) {
  const urls = [];
  for (const id of ids || []) {
    if (id === ID_FOTOS_VASOMAIZ) urls.push(...FOTOS_PAQUETES_VASOMAIZ.map(f => `/${f}`));
    else if (REFERENCIAS_DECORACION[id]) urls.push(`/referencias/${REFERENCIAS_DECORACION[id].archivo}`);
  }
  return [...new Set(urls)].slice(0, 6);
}

function transcripcion(historial) {
  return historial.map(h => `${h.rol === 'cliente' ? 'Cliente' : 'DiMa'}: ${h.texto.trim()}`).join('\n');
}

async function registrarPedido(input, historial, folioPrevio) {
  const { error, datos } = validarPedido({
    nombre: input.nombre,
    telefono: input.telefono,
    email: input.email,
    negocio: input.negocio,
    tipoEvento: input.tipo_evento,
    fecha: input.fecha,
    invitados: input.invitados,
    ubicacion: input.ubicacion,
    servicios: input.servicios,
    montoEstimado: input.monto_estimado,
  });
  if (error) {
    return { texto: `Antes de registrarlo me falta un dato: ${error.charAt(0).toLowerCase() + error.slice(1)}` };
  }

  // Si ya se registró en esta conversación, no se duplica el evento: se avisa
  // del cambio al equipo para que Diana lo ajuste en el pedido existente.
  if (folioPrevio) {
    await enviarTelegramEquipo({
      roles: [ROLES.ADMIN],
      texto: `✏️ Cambio en el pedido ${folioPrevio} (${datos.nombre}). Así queda:

${datos.servicios}` +
        (datos.montoEstimado > 0 ? `

Nuevo estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}` : ''),
    });
    await enviarCorreoEquipo({
      asunto: `✏️ Cambio en el pedido ${folioPrevio} - ${datos.nombre}`,
      texto: `El cliente pidió cambios en el chat después de registrar el pedido ${folioPrevio}.\n\nAsí queda ahora:\n${datos.servicios}\n\n` +
        (datos.montoEstimado > 0 ? `Nuevo estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n\n` : '') +
        `Conversación:\n${transcripcion(historial)}`,
    });
    return { texto: `Listo, le pasé tus cambios a Diana para el pedido ${folioPrevio}.`, folio: folioPrevio };
  }

  const { folio } = await crearPedido(datos, {
    origen: 'chat',
    notasExtra: `\nConversación con DiMa:\n${transcripcion(historial)}`,
  });
  return { texto: `Listo, quedó registrado tu pedido con el folio ${folio}.`, folio };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { historial, folio } = req.body || {};
  const folioPrevio = /^EVT-\d{6}$/.test(folio || '') ? folio : null;

  // Se revisa antes de validar el tamaño del historial: al pasarse del límite
  // el cliente recibe la despedida amable, no un error.
  const mensajesCliente = Array.isArray(historial) ? historial.filter(h => h && h.rol === 'cliente').length : 0;
  if (mensajesCliente > MAX_MENSAJES_CLIENTE) {
    res.status(200).json({ texto: MENSAJE_LIMITE, fotos: [], folio: folioPrevio, limite: true });
    return;
  }

  const mensajes = construirMensajes(historial);
  if (!mensajes) {
    res.status(400).json({ error: 'La conversación es demasiado larga o no es válida. Recarga la página para empezar de nuevo.' });
    return;
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sin-ip';
  const limite = limiteDeEnvios(ip);
  if (limite) {
    res.status(429).json({
      error: limite === 'rapido'
        ? 'Dame un segundito para leerte y me vuelves a escribir.'
        : 'Recibimos muchos mensajes desde tu conexión. Intenta en un rato o usa el formulario de abajo.',
    });
    return;
  }

  // Instrucción del sistema al final de la conversación (no se guarda en el
  // historial del navegador) para que DiMa vaya cerrando sin cortar al cliente.
  if (mensajesCliente >= AVISO_CIERRE) {
    const restantes = MAX_MENSAJES_CLIENTE - mensajesCliente;
    mensajes.push({
      role: 'system',
      content: `La conversación ya va larga (quedan ${restantes} mensajes del cliente). Ve cerrando con amabilidad y sin prisas visibles: ` +
        (folioPrevio
          ? 'el pedido ya está registrado; resuelve lo que falte en pocas palabras y despídete diciendo que Diana lo contacta.'
          : 'haz un repaso breve de lo acordado, pide nombre y teléfono si faltan y registra el pedido; si aún tiene dudas, dile que Diana se las resuelve al confirmar.'),
    });
  }

  try {
    const respuesta = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      // Chat de ventas: respuestas cortas, no requiere razonamiento profundo.
      output_config: { effort: 'low' },
      // Si un clasificador de seguridad rechaza la petición, la API la reintenta
      // en el modelo de respaldo recomendado en vez de devolver el rechazo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // El catálogo es largo y no cambia en el día: se cachea entre mensajes.
      cache_control: { type: 'ephemeral' },
      system: systemPrompt(),
      tools: TOOLS,
      tool_choice: { type: 'auto' },
      messages: mensajes,
    });

    if (respuesta.stop_reason === 'refusal') {
      res.status(200).json({ texto: 'Perdona, con eso no te puedo ayudar. ¿Te ayudo a cotizar tu evento?', fotos: [] });
      return;
    }

    const partes = [];
    let fotos = [];
    let folioNuevo = folioPrevio;
    for (const bloque of respuesta.content) {
      if (bloque.type === 'text' && bloque.text.trim()) {
        partes.push(bloque.text.trim());
      } else if (bloque.type === 'tool_use' && bloque.name === 'mostrar_fotos') {
        fotos = fotos.concat(urlsDeFotos(bloque.input.ids));
      } else if (bloque.type === 'tool_use' && bloque.name === 'registrar_pedido') {
        const resultado = await registrarPedido(bloque.input, historial, folioNuevo);
        partes.push(resultado.texto);
        if (resultado.folio) {
          folioNuevo = resultado.folio;
          partes.push('Diana revisa la disponibilidad y te confirma la cotización; te contactamos por teléfono para el anticipo y los datos de pago.');
        }
      }
    }

    let texto = partes.join('\n\n');
    if (!texto && fotos.length) texto = 'Claro, mira estos ejemplos:';
    if (!texto) texto = 'Perdona, se me fue la idea. ¿Me repites lo último?';

    res.status(200).json({ texto, fotos, folio: folioNuevo, limite: mensajesCliente >= MAX_MENSAJES_CLIENTE });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error('DiMa: límite de uso de la API de Claude', err.message);
    } else if (err instanceof Anthropic.APIError) {
      console.error(`DiMa: error de la API de Claude ${err.status}:`, err.message);
    } else {
      console.error('Error en dima-chat:', err);
    }
    res.status(502).json({ error: 'DiMa no está disponible en este momento. Intenta de nuevo en un momento o usa el formulario.' });
  }
};
