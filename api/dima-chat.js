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
// Con modo "equipo" (y sesión de la app) es el canal interno de DiMa para la
// gerente de El Vaso Maíz y los Admin: ver api/_dima-equipo.js.
//
// Requiere ANTHROPIC_API_KEY en Vercel.

const crypto = require('crypto');
const { Anthropic } = require('@anthropic-ai/sdk');
const { HORAS_RESPUESTA, HORAS_ANTICIPACION_CAMBIO, validarPedido, crearPedido, verificarPedido, registrarCambioCliente, cambioUrgente, mensajeDianaPendiente, marcarMensajeEntregado } = require('./_pedidos');
const { avisarCambioPedido } = require('./_cambios');
const { bloqueosProximos, llenosProximos } = require('./_calendario');

// Fechas en texto para el cliente ("sábado 12 de diciembre").
const fechaLarga = (f) => new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${f}T12:00:00Z`)).replace(',', '');
function listaFechas(fechas) {
  const t = fechas.map(f => 'el ' + fechaLarga(f));
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} o ${t[t.length - 1]}` : t[0];
}
// Hasta 3 fechas libres cerca de la pedida (una semana antes o después, nunca hoy ni antes).
function fechasLibres(fecha, libre) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
  const salida = [];
  for (let i = 1; i <= 7 && salida.length < 3; i++) {
    for (const s of [i, -i]) {
      const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + s);
      const f = d.toISOString().slice(0, 10);
      if (f > hoy && libre(f) && salida.length < 3) salida.push(f);
    }
  }
  return salida.sort();
}
const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarTelegramEquipo } = require('./_telegram');
const { ROLES, requerirSesion } = require('./_sesion');
const { puedeUsarDima, preguntarDima } = require('./_dima-equipo');
const { contenidoDima, contenidoPagina, fotoDrive } = require('./_drive');
const { CATALOGO, REFERENCIAS_DECORACION, FOTOS_PAQUETES_VASOMAIZ, LINK_INSTAGRAM_DIVANNA } = require('./_dima-catalogo');
const { estimarTraslado, LIMITE_KM } = require('./_traslado');
const { TEMPORADA_ALTA, enTemporadaAlta, textoTemporada } = require('./_temporada');
const { CLAVES, PRODUCTOS } = require('./_productos');

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
  'Ya platicamos bastante y no quiero quitarte más tiempo. Si ya registramos tu pedido, nuestro equipo te contacta ' +
  'para confirmarlo. Si todavía no, deja tus datos en el formulario de abajo y te llamamos para terminar ' +
  'tu cotización. ¡Gracias por la confianza!';

const ID_FOTOS_VASOMAIZ = 'paquetes-vasomaiz';

// Las fotos de la carpeta de Drive se suman al enum en cada mensaje (ver herramientas()).
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
    name: 'estimar_traslado',
    description: 'Revisa un evento fuera de la ciudad: distancia por carretera desde la salida de Culiacán, si queda dentro del límite de servicio (35 km) y el aproximado del traslado. Úsala en cuanto sepas que el evento es foráneo.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        destino: { type: 'string', description: 'Lugar del evento como lo dijo el cliente, con municipio si lo sabes (ej. "San Pedro, Navolato").' },
      },
      required: ['destino'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_pedido',
    description: 'Registra el pedido para que la gerencia lo revise y confirme la cotización. Úsala solo cuando el cliente ya confirmó lo que quiere y ya te dio nombre, teléfono y fecha. Si ya registraste el pedido en esta conversación y el cliente pide cambios, vuelve a llamarla con los datos completos actualizados.',
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
        hora_inicio: { type: ['string', 'null'], description: 'Hora en que empieza el evento, formato 24 h "HH:MM" (ej. "18:00" para las 6 pm). null si el cliente no la sabe todavía.' },
        horas_servicio: { type: ['number', 'null'], description: 'Horas de servicio de El Vaso Maíz (los paquetes incluyen 2; si el cliente pide más tiempo, ese número). null si no lleva El Vaso Maíz.' },
        servicios: { type: 'string', description: 'Lo acordado, un artículo o servicio por línea (ej. "10 mesas redondas con mantel"). El equipo usa estas líneas como checklist de carga.' },
        productos: {
          type: 'array',
          description: 'Lo mismo que "servicios" pero con las claves del catálogo, para revisar inventario y personal. Un renglón por producto con su cantidad (paquetes como unidades: 100 personas Antonella = dv_paq50_antonella x 2; piezas sueltas por pieza: 20 sillas Tiffany = dv_silla_tiffany x 20). Si el paquete deja la silla a elección, agrega también las sillas elegidas como renglón aparte (solo apartan inventario, no las cobres de nuevo). Usa la nota para color, sabor o variante; en copas, manteles y platos base anota el modelo y el color que eligió el cliente (la gerencia asigna las piezas exactas de bodega). Lo que no esté en el catálogo va como "otro" con su descripción en la nota.\nCLAVES:\n' +
            CLAVES.map(c => `${c}: ${PRODUCTOS[c].nombre}`).join('\n'),
          items: {
            type: 'object',
            properties: {
              clave: { type: 'string', enum: CLAVES },
              cantidad: { type: 'integer' },
              nota: { type: ['string', 'null'] },
            },
            required: ['clave', 'cantidad', 'nota'],
            additionalProperties: false,
          },
        },
        monto_estimado: { type: ['number', 'null'], description: 'Total aproximado en pesos MXN calculado con el catálogo (sin costo de traslado), o null si no se pudo calcular.' },
        fuera_de_ciudad: { type: 'boolean', description: 'true si el evento NO es dentro de la ciudad de Culiacán (sindicaturas, Navolato y sus pueblos, playas, otros municipios) o si no estás segura.' },
        indicaciones: { type: ['string', 'null'], description: 'Indicaciones del cliente para el equipo que monta: horario de montaje o del evento, acceso, referencias para llegar, contacto en el lugar, etc. null si no dio ninguna.' },
        preferencia_contacto: { type: 'string', enum: ['esperar_en_chat', 'mensaje', 'llamada', 'no_preguntado'], description: 'Cómo quiere el cliente recibir la respuesta de la cotización: esperar aquí en el chat, por mensaje o por llamada. "no_preguntado" si no aplica.' },
      },
      required: ['nombre', 'telefono', 'email', 'negocio', 'tipo_evento', 'fecha', 'hora_inicio', 'horas_servicio', 'invitados', 'ubicacion', 'servicios', 'productos', 'monto_estimado', 'fuera_de_ciudad', 'indicaciones', 'preferencia_contacto'],
      additionalProperties: false,
    },
  },
];

function systemPrompt(drive = { textos: '', fotos: [], hayPromociones: false }) {
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
- NOMBRES: nunca menciones a nadie del equipo por su nombre (ni a Diana ni a ninguna otra persona). Para cobertura, traslado, disponibilidad y montaje di "el equipo de logística"; para precios, autorizaciones y confirmar la cotización di "la gerencia". Si el cliente pregunta con quién habla, eres DiMa, la asistente de Divanna Eventos y El Vaso Maíz.
- Este chat no tiene archivos adjuntos: si el cliente quiere enseñarte una imagen de referencia, pídele que la describa o que la mande por Instagram (${LINK_INSTAGRAM_DIVANNA}).

COBERTURA (revísala en cuanto sepas dónde es el evento):
- Dentro de la ciudad de Culiacán no se cobra traslado. Los eventos foráneos (sindicaturas, Navolato y alrededores) se atienden hasta 35 km de la salida de Culiacán, llevan costo de traslado y los valida el equipo de logística. Más de 35 km NO se atiende, por seguridad y por costos. Es lo mismo que dice la página en "Zona de cobertura".
- En cuanto sepas que el evento es foráneo, llama estimar_traslado para revisar la distancia (aunque el cliente no haya preguntado el costo).
- Fuera de la ciudad es cualquier sindicatura o pueblo aunque sea del municipio (Costa Rica, Eldorado, Quilá, Tepuche, Imala, Jesús María, Culiacancito, El Salado, etc.), todo Navolato (incluido San Pedro), las playas (Altata, Ponce, El Tambor) y otros municipios.
- Si el evento es fuera de la ciudad, en ESE MISMO mensaje en que te enteras explícale al cliente, con calidez y sin cerrarle la puerta, que los eventos foráneos se validan antes de confirmarse, y por qué: el equipo de logística revisa que se pueda trasladar ese día, la distancia y el tiempo de montaje, y el costo de traslado, que se suma a la cotización. Dile que se lo confirman en cuanto lo revise. Nunca confirmes cobertura ni inventes un costo de traslado.
- Sigue armando la cotización normal. En el repaso final vuelve a mencionar, en una frase, que falta validar el traslado, y registra el pedido con fuera_de_ciudad = true.
- SI QUEDA A MÁS DE 35 KM: dile con calidez que por ahora no damos servicio a más de 35 km de Culiacán, por seguridad de nuestro equipo y por costos, que lamentas no poder atenderlo y que si el evento cambia a un lugar más cerca con gusto lo cotizas. No registres el pedido ni des costo de traslado.
- APROXIMADO DE TRASLADO: el costo solo dilo si el cliente pregunta cuánto sale el traslado (o el total con traslado). Con el resultado dile los km desde la salida de Culiacán y el aproximado, y explícale que se cobra ida y vuelta dos veces (ir a dejar y regresar, ir a recoger y regresar). Aclara siempre que es un estimado y que la cotización final con traslado se la confirma el equipo de logística. Si la herramienta no da resultado, dile que logística le confirma cobertura y costo. No calcules el traslado por tu cuenta.
- En los foráneos, cuando pidas los datos de contacto pregúntale también: "Tu pedido es foráneo: ¿quieres esperar aquí la respuesta de la cotización, o prefieres que te contactemos por mensaje o por llamada?". Guarda su respuesta en preferencia_contacto (esperar_en_chat, mensaje o llamada). Si elige esperar, dile que puede dejar esta ventana abierta o regresar después con su número de pedido en "¿Ya tienes número de pedido?".

MENSAJES DEL EQUIPO: a veces el sistema te pasa un mensaje que la gerencia o logística dejó para el cliente sobre su pedido (por ejemplo, la respuesta de un foráneo). Entrégaselo al inicio de tu respuesta, con sus palabras y sin cambiar montos, fechas ni condiciones, y después sigue la plática.
- Si no sabes si un lugar está dentro de la ciudad, pregunta la colonia o la sindicatura. Si sigues con la duda, trátalo como fuera de la ciudad.
- Si el lugar está claramente lejos (por ejemplo Mazatlán, Los Mochis, Guamúchil o Guasave), dile de una vez que está fuera de nuestro límite de 35 km y que por ahora no damos servicio ahí.

TEMPORADA ALTA DE FIN DE AÑO (${textoTemporada()}): cuenta la fecha del EVENTO, no la de hoy.
- Si el evento cae en esas fechas, NO ofrezcas ni cotices los paquetes regulares (ni los de mesas por cantidad de personas, ni los de boda o XV, ni los paquetes de El Vaso Maíz). Cotiza por pieza con los precios del catálogo y súbeles ${Math.round(TEMPORADA_ALTA.aumento * 100)}% (multiplica por ${1 + TEMPORADA_ALTA.aumento}). En el estimado da el total ya con el aumento; no desgloses el porcentaje.
- El costo de traslado NO sube en temporada: se mantiene igual (km x $10 x 4). Súmalo aparte, sin aplicarle el aumento.
- Explícalo con sutileza y sin disculparte de más: es la temporada de más demanda del año, el equipo trabaja a tope y la tarifa es de temporada. Ej.: "Para esas fechas manejamos tarifa de temporada, porque es cuando más eventos atendemos en el año; te lo armo con esa tarifa."
- Si el cliente puede mover su evento antes del ${TEMPORADA_ALTA.desde.dia} de diciembre, puedes mencionar de pasada que fuera de temporada aplican los paquetes regulares.
${drive.hayPromociones
  ? '- PROMOCIONES: las vigentes están en INFORMACIÓN ACTUALIZADA DE LA GERENCIA (al final). Revisa sus fechas contra la fecha de hoy y ofrece solo las vigentes; si no hay ninguna vigente, dile que la gerencia le comparte las que haya.'
  : '- Si el cliente pregunta por promociones, dile que la gerencia le comparte las vigentes.'}

INDICACIONES PARA EL EQUIPO: si el cliente menciona horario de montaje, acceso al lugar, referencias para llegar o a quién buscar, guárdalo en "indicaciones" al registrar. Lo ve la brigada que monta.

FLUJO DE LA COTIZACIÓN:
1. Platica para conocer el evento: negocio (o ambos), tipo de evento, fecha, a qué hora empieza, invitados, ubicación y qué necesita. La hora la necesita el equipo para organizar entregas y personal; pregúntala de forma natural junto con la fecha ("¿Para qué día y a qué hora empieza?"). Si todavía no la sabe, no insistas. Con esos datos se llena la comanda y el recibo del cliente: procura tener también su nombre completo, la dirección exacta del evento (calle, número y colonia o salón) y, en cada producto, el modelo y color que eligió (va en la nota del producto). Pídelo con naturalidad, sin interrogatorio.
2. Arma un estimado con el catálogo de abajo y preséntalo con un repaso breve de lo que lleva. Cierra todo estimado con: "Este es un costo aproximado y se ajustaría cuando se revise detalladamente."
3. VENTA CRUZADA, una vez y antes de pedir datos de contacto: si el cliente solo ha hablado de un negocio, ofrécele el otro en una o dos frases, ligadas a su evento.
   - Si pidió snacks de El Vaso Maíz, ofrece el mobiliario (mesas, sillas, mantelería) y la decoración de Divanna (aro, mampara, arcos de cerezos).
   - Si pidió mobiliario o decoración, ofrece los snacks de El Vaso Maíz.
   Si dice que no, respétalo y sigue. Si dice que sí, súmalo a la misma cotización.
4. Cuando el cliente confirme que así lo quiere, pídele su nombre y un teléfono de 10 dígitos (y su correo si quiere recibir la cotización por ahí) para registrar el pedido.
5. Con eso llama a registrar_pedido. Después dile que ya tenemos todos los datos de su evento, que el equipo revisa la disponibilidad y que en un lapso no mayor a ${HORAS_RESPUESTA} horas le confirmamos la cotización; lo contactan por teléfono para el anticipo y los datos de pago.
- Si el cliente pide directamente "hazme la cotización", "así está bien", "adelante" o cualquier confirmación clara, haz la venta cruzada en una frase (si no la hiciste) y pasa a pedir sus datos.
- Nunca digas que la fecha ya quedó apartada ni que hay disponibilidad confirmada: la apartan con el anticipo, después de que la gerencia confirma.
- CAMBIOS AL PEDIDO: se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación al evento. Si el cliente pregunta o quiere cambiar algo, díselo con amabilidad. Con menos de ${HORAS_ANTICIPACION_CAMBIO} horas no se puede garantizar: si aun así lo quiere, regístralo y la gerencia lo revisa como urgente.
- Nunca inventes precios fuera del catálogo; si no lo sabes, dilo y explica que la gerencia lo confirma al revisar el pedido.

${CATALOGO}${informacionDrive(drive)}`;
}

// Lo que Diana tiene en la carpeta de Drive (api/_drive.js). Va al final del
// prompt y manda sobre el catálogo del código.
function informacionDrive(drive) {
  if (!drive.textos && !drive.fotos.length) return '';
  return `

INFORMACIÓN ACTUALIZADA DE LA GERENCIA (de su carpeta de documentos; si algo de aquí contradice el catálogo de arriba -- precios, paquetes, temporadas, promociones --, MANDA LO DE AQUÍ. Respeta las fechas de vigencia que diga cada promoción o temporada. No inventes nada que no diga):
${drive.textos || '(sin documentos)'}${drive.fotos.length ? `

FOTOS QUE SUBIÓ LA GERENCIA (muéstralas con mostrar_fotos usando su id exacto, con las mismas reglas que las fotos de referencia):
${drive.fotos.map(f => `- "${f.id}": ${f.tema}`).join('\n')}` : ''}`;
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
    // Las fotos no viajan a la API, pero DiMa debe saber cuáles ya vio el cliente.
    const vistas = h.rol === 'dima' ? temasDeFotos(h.fotos) : [];
    mensajes.push({ role: h.rol === 'cliente' ? 'user' : 'assistant', content: vistas.length ? `${texto}\n[Fotos que le mostré: ${vistas.join('; ')}]` : texto });
  }
  if (total > MAX_CARACTERES_TOTAL || mensajes[0].role !== 'user' || mensajes[mensajes.length - 1].role !== 'user') return null;
  return mensajes;
}

// Lugares fuera de la ciudad de Culiacán que suelen pedir. Si el cliente menciona
// alguno, se le recuerda a DiMa que explique la validación de eventos foráneos.
const LUGARES_FORANEOS = [
  'navolato', 'san pedro', 'altata', 'el tambor', 'ponce', 'eldorado', 'el dorado', 'costa rica',
  'quila', 'quilá', 'tepuche', 'imala', 'jesus maria', 'jesús maría', 'culiacancito', 'el salado',
  'tacuichamona', 'sanalona', 'las tapias', 'cosala', 'cosalá', 'elota', 'badiraguato',
  'guamuchil', 'guamúchil', 'mocorito', 'guasave', 'los mochis', 'mazatlan', 'mazatlán', 'angostura', 'sindicatura',
];
// ¿El cliente mencionó una fecha de temporada alta? (navidad, fin de año, del 18
// de diciembre en adelante o el 1 de enero). Así DiMa no se olvida del aumento.
const FECHAS_TEMPORADA = /\b(1[89]|2\d|3[01])\s+de\s+diciembre\b|navidad|nochebuena|noche\s*vieja|fin\s+de\s+a[ñn]o|a[ñn]o\s+nuevo|\b(1|1ro|1°|primero)\s+de\s+enero\b/i;
function temporadaMencionada(historial) {
  return historial.some(h => h.rol === 'cliente' && FECHAS_TEMPORADA.test(h.texto));
}

function lugarForaneoMencionado(historial) {
  const textoCliente = historial.filter(h => h.rol === 'cliente').map(h => h.texto.toLowerCase()).join(' ');
  return LUGARES_FORANEOS.find(l => new RegExp(`(^|[^a-záéíóúñ])${l}([^a-záéíóúñ]|$)`).test(textoCliente)) || null;
}

function herramientas(fotosDrive) {
  if (!fotosDrive.length) return TOOLS;
  const [fotos, ...resto] = TOOLS;
  const ids = fotos.input_schema.properties.ids;
  return [{ ...fotos, input_schema: { ...fotos.input_schema, properties: { ids: { ...ids,
    items: { ...ids.items, enum: [...ids.items.enum, ...fotosDrive.map(f => f.id)] },
    description: `${ids.description} Los que empiezan con "drive:" son fotos que subió la gerencia (ver INFORMACIÓN ACTUALIZADA DE LA GERENCIA).` } } } }, ...resto];
}

// Fotos de la carpeta de Drive del mensaje en curso (id "drive:..." → url y tema).
let FOTOS_DRIVE = [];

function urlsDeFotos(ids) {
  const urls = [];
  for (const id of ids || []) {
    const deDrive = FOTOS_DRIVE.find(f => f.id === id);
    if (deDrive) urls.push(deDrive.url);
    else if (id === ID_FOTOS_VASOMAIZ) urls.push(...FOTOS_PAQUETES_VASOMAIZ.map(f => `/${f}`));
    else if (REFERENCIAS_DECORACION[id]) urls.push(`/referencias/${REFERENCIAS_DECORACION[id].archivo}`);
  }
  return [...new Set(urls)].slice(0, 6);
}

// De qué es cada foto, para que DiMa la comente y sepa cuáles ya vio el cliente.
const TEMA_DE_FOTO = new Map([
  ...Object.values(REFERENCIAS_DECORACION).map(r => [`/referencias/${r.archivo}`, r.tema]),
  ...FOTOS_PAQUETES_VASOMAIZ.map(f => [`/${f}`, `Paquetes de El Vaso Maíz (${f.replace(/^paquetes\//, '').replace(/\.jpg$/, '').replace(/-/g, ' ')})`]),
]);
function temasDeFotos(urls) {
  const tema = (u) => TEMA_DE_FOTO.get(u) || (FOTOS_DRIVE.find(f => f.url === u) || {}).tema;
  return Array.isArray(urls) ? [...new Set(urls.map(tema).filter(Boolean))] : [];
}

// El navegador guarda el folio del pedido de esta conversación. Para que nadie
// pueda inventar un folio y meter cambios en un pedido ajeno, el servidor lo
// firma (HMAC con SESSION_SECRET) y solo acepta cambios con folio + firma válidos.
function firmaFolio(folio) {
  if (!process.env.SESSION_SECRET) return null;
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`folio:${folio}`).digest('base64url').slice(0, 32);
}
function folioFirmado(folio, firma) {
  if (!/^EVT-\d{6}$/.test(folio || '') || typeof firma !== 'string') return null;
  const esperada = firmaFolio(folio);
  if (!esperada || firma.length !== esperada.length) return null;
  return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada)) ? folio : null;
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
    fueraDeCiudad: input.fuera_de_ciudad,
    indicaciones: input.indicaciones,
    preferenciaContacto: input.preferencia_contacto,
    horaInicio: input.hora_inicio,
    horasServicio: input.horas_servicio,
    productos: input.productos,
  });
  if (error) {
    return { texto: `Antes de registrarlo me falta un dato: ${error.charAt(0).toLowerCase() + error.slice(1)}` };
  }

  // Día bloqueado en el calendario: un pedido nuevo no se registra aunque DiMa
  // no lo haya notado (los cambios a un pedido existente sí pasan; la gerencia decide).
  if (!folioPrevio && datos.fecha) {
    const bloqueos = await bloqueosProximos().catch(() => []);
    const choca = bloqueos.find(b => b.fecha === datos.fecha && (b.negocio === 'Ambos' || datos.negocio === 'Ambos' || !datos.negocio || b.negocio === datos.negocio));
    const todos = await llenosProximos().catch(() => []);
    const quiereCasa = (datos.productos || []).some(p => p.clave === 'dv_casa_isabella') || /casa\s+isabella/i.test(datos.servicios || '');
    const ocupado = (f) => ({
      bloqueo: bloqueos.find(b => b.fecha === f && (b.negocio === 'Ambos' || datos.negocio === 'Ambos' || !datos.negocio || b.negocio === datos.negocio)),
      lleno: todos.find(d => d.fecha === f && d.negocios.some(n => !datos.negocio || datos.negocio === 'Ambos' || n === datos.negocio)),
      casa: quiereCasa && todos.find(d => d.fecha === f && d.casaIsabella),
    });
    const pedida = ocupado(datos.fecha);
    if (pedida.bloqueo || pedida.lleno || pedida.casa) {
      const otras = fechasLibres(datos.fecha, (f) => { const o = ocupado(f); return !o.bloqueo && !o.lleno && !o.casa; });
      const ofrecer = otras.length ? ` Tenemos disponible ${listaFechas(otras)}. ¿Te acomoda alguna, o prefieres otra fecha?` : ' ¿Te gustaría revisar otra fecha?';
      if (pedida.bloqueo) {
        return { texto: `Una disculpa: el ${fechaLarga(datos.fecha)} ya no tenemos disponibilidad${pedida.bloqueo.negocio === 'Ambos' ? '' : ' para ' + (pedida.bloqueo.negocio === 'El Vaso Maiz' ? 'El Vaso Maíz' : 'Divanna Eventos')}.${ofrecer}` };
      }
      if (pedida.lleno) return { texto: `Lamentablemente esa fecha (${fechaLarga(datos.fecha)}) la tenemos llena y ya no podemos cubrir tu evento.${ofrecer}` };
      return { texto: `Esa fecha (${fechaLarga(datos.fecha)}) ya no está disponible en Casa Isabella.${otras.length ? ` El salón está libre ${listaFechas(otras)}. ¿Te acomoda alguna, o prefieres otra fecha?` : ' ¿Te gustaría revisar otra fecha?'}` };
    }
  }

  // Límite de servicio: aunque DiMa no lo haya revisado, no se registran
  // eventos a más de 35 km. Si el mapa no responde, se registra y logística valida.
  if (datos.fueraDeCiudad && datos.ubicacion) {
    const t = await estimarTraslado(datos.ubicacion);
    if (t.ok && t.fueraDeCobertura) {
      return {
        texto: `Lo siento mucho: ${t.lugar} queda a unos ${t.kmDesdeSalida} km de Culiacán y por ahora no damos servicio a más de ${LIMITE_KM} km, por seguridad de nuestro equipo y por costos. Si el evento cambia a un lugar más cerca, con gusto te lo cotizo.`,
      };
    }
  }

  // Si ya hay pedido (registrado en esta conversación o abierto con folio y
  // teléfono), no se duplica el evento: el cambio se guarda en el evento y se
  // avisa a Diana para que ajuste la cotización.
  if (folioPrevio) {
    let cambio;
    try {
      cambio = await registrarCambioCliente(folioPrevio, {
        servicios: datos.servicios,
        indicaciones: datos.indicaciones,
        montoEstimado: datos.montoEstimado,
        transcripcion: transcripcion(historial),
        preferenciaContacto: datos.preferenciaContacto,
        horaInicio: datos.horaInicio,
        horasServicio: datos.horasServicio,
        productos: datos.productos,
      });
    } catch (err) {
      // No se finge que quedó: se le dice al cliente y se avisa a los Admin con lo que pidió.
      console.error('No se pudo guardar el cambio en el evento:', err.message);
      await enviarTelegramEquipo({
        roles: [ROLES.ADMIN],
        texto: `⚠️ El cliente ${datos.nombre} quiso cambiar el pedido ${folioPrevio} pero NO se pudo guardar (${err.message}). Lo que pidió:\n\n${datos.servicios}` +
          (datos.indicaciones ? `\n\n📌 ${datos.indicaciones}` : ''),
      });
      return { texto: `Una disculpa: no pude guardar tu cambio en este momento. Ya le avisé a la gerencia con lo que me pediste para que te contacte; si quieres, inténtalo de nuevo en unos minutos.`, folio: folioPrevio };
    }
    await avisarCambioPedido({
      folio: folioPrevio,
      nombre: datos.nombre,
      servicios: datos.servicios,
      montoEstimado: datos.montoEstimado,
      indicaciones: datos.indicaciones,
      urgente: cambio.urgente,
      autorizado: cambio.autorizado,
      eventoFields: cambio.campos,
    }).catch(err => console.error('Error avisando el cambio de pedido:', err.message));
    await enviarCorreoEquipo({
      asunto: `${cambio.urgente ? '⚠️ URGENTE · ' : ''}✏️ Cambio en el pedido ${folioPrevio} - ${datos.nombre}`,
      texto: `El cliente pidió cambios en el chat después de registrar el pedido ${folioPrevio}.` +
        (cambio.urgente ? ' Faltan menos de 24 horas para el evento.' : '') +
        (cambio.autorizado ? ' El pedido ya estaba autorizado: confírmalo o descártalo en el dashboard.' : '') +
        `\n\nAsí queda ahora:\n${datos.servicios}\n\n` +
        (datos.montoEstimado > 0 ? `Nuevo estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n\n` : '') +
        `Conversación:\n${transcripcion(historial)}`,
    });
    const texto = cambio.urgente
      ? `Listo, ya pasé tus cambios a la gerencia para el pedido ${folioPrevio}. Te recuerdo que los cambios se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación: como faltan menos de ${HORAS_ANTICIPACION_CAMBIO} horas para tu evento, no podemos garantizarlo, pero lo marqué como urgente y la gerencia te confirma lo antes posible.`
      : `Listo, ya pasé tus cambios a la gerencia para el pedido ${folioPrevio}. Revisa si cambia la cotización y te confirma en un lapso no mayor a ${HORAS_RESPUESTA} horas. Recuerda que los cambios se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación.`;
    return { texto, folio: folioPrevio };
  }

  const { folio } = await crearPedido(datos, {
    origen: 'chat',
    notasExtra: `\nConversación con DiMa:\n${transcripcion(historial)}`,
  });
  const aviso = datos.fueraDeCiudad ? ' Como es fuera de la ciudad, el equipo de logística te confirma la cobertura y el costo de traslado.' : '';
  return { texto: `Listo, quedó registrado tu pedido con el folio ${folio}.${aviso}`, folio };
}

// Canal interno: la app manda { modo: 'equipo', historial: [{ rol: 'yo' | 'dima', texto }] }.
async function chatEquipo(req, res) {
  try {
    const colaborador = await requerirSesion(req, res, [ROLES.ADMIN, ROLES.LIDER, ROLES.ENCARGADA, ROLES.ASISTENTE]);
    if (!colaborador) return;
    if (!puedeUsarDima(colaborador)) { res.status(403).json({ error: 'Este canal es solo para la gerencia.' }); return; }
    const r = await preguntarDima(colaborador, (req.body || {}).historial, { coordina: true });
    if (r.error) { res.status(400).json({ error: 'La conversación es demasiado larga o no es válida. Empieza una nueva.' }); return; }
    res.status(200).json({ texto: r.texto });
  } catch (err) {
    console.error('Error en DiMa equipo:', err);
    res.status(500).json({ error: 'DiMa no pudo contestar, intenta de nuevo en un momento.' });
  }
}

// GET público: ?foto=<id> sirve una foto de la carpeta de Drive y ?contenido=1
// da la galería y las promociones de la página. Se cachea en la CDN de Vercel.
async function paraLaPagina(req, res) {
  const { foto, contenido } = req.query || {};
  try {
    if (foto) {
      const f = await fotoDrive(String(foto));
      if (!f) { res.status(404).json({ error: 'No existe' }); return; }
      res.setHeader('Content-Type', f.tipo);
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      res.status(200).send(f.datos);
      return;
    }
    if (contenido) {
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
      res.status(200).json(await contenidoPagina());
      return;
    }
  } catch (err) {
    console.error('Error leyendo Drive para la página:', err.message);
    res.status(502).json({ error: 'No se pudo leer' });
    return;
  }
  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return paraLaPagina(req, res);
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if ((req.body || {}).modo === 'equipo') return chatEquipo(req, res);

  const { historial, folio, folioFirma, pedidoExistente, accion } = req.body || {};
  let folioPrevio = folioFirmado(folio, folioFirma);

  // El navegador revisa cada rato si Diana ya dejó respuesta para el cliente
  // que está esperando en el chat. No llama a Claude; solo lee Airtable.
  if (accion === 'revisar') {
    if (!folioPrevio) { res.status(400).json({ error: 'Pedido no válido' }); return; }
    try {
      const pendiente = await mensajeDianaPendiente(folioPrevio);
      if (pendiente) await marcarMensajeEntregado(pendiente.id);
      res.status(200).json({ mensaje: pendiente ? pendiente.mensaje : null });
    } catch (err) {
      console.error('Error revisando mensaje de Diana:', err.message);
      res.status(200).json({ mensaje: null });
    }
    return;
  }

  // Se revisa antes de validar el tamaño del historial: al pasarse del límite
  // el cliente recibe la despedida amable, no un error.
  const mensajesCliente = Array.isArray(historial) ? historial.filter(h => h && h.rol === 'cliente').length : 0;
  if (mensajesCliente > MAX_MENSAJES_CLIENTE) {
    res.status(200).json({ texto: MENSAJE_LIMITE, fotos: [], folio: folioPrevio, folioFirma: folioPrevio ? firmaFolio(folioPrevio) : null, limite: true });
    return;
  }

  const drive = await contenidoDima();
  FOTOS_DRIVE = drive.fotos;
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

  // Avisos del sistema al final de la conversación (no se guardan en el
  // historial del navegador). Van juntos en un solo mensaje "system".
  const avisos = [];
  let mensajeAEntregar = null;

  // Cliente que vuelve con su folio y teléfono para agregar o cambiar algo.
  if (pedidoExistente && !folioPrevio) {
    const pedido = await verificarPedido(pedidoExistente.folio, pedidoExistente.telefono).catch(() => null);
    if (!pedido) {
      res.status(400).json({ error: 'No encontramos ese número de pedido con ese teléfono. Revisa los dos datos o escríbenos desde el chat normal.' });
      return;
    }
    folioPrevio = pedido.folio;
    if (pedido.mensajeDiana) {
      mensajeAEntregar = { id: pedido.id, mensaje: pedido.mensajeDiana };
    }
    avisos.push(
      `El cliente ya tiene el pedido ${pedido.folio} registrado a nombre de ${pedido.nombre || 'el cliente'}` +
      ` (${pedido.negocio || 'negocio sin especificar'}, ${pedido.fecha}${pedido.horaInicio ? ' a las ' + pedido.horaInicio : ''}, ${pedido.ubicacion || 'ubicación sin especificar'}` +
      `${pedido.invitados ? ', ' + pedido.invitados + ' invitados' : ''}${pedido.fueraDeCiudad ? ', fuera de la ciudad' : ''}).\n` +
      `Lo que lleva:\n${pedido.servicios}\n` +
      (pedido.instrucciones ? `Indicaciones ya guardadas:\n${pedido.instrucciones}\n` : '') +
      (pedido.autorizado ? 'La gerencia ya confirmó esta cotización: cualquier cambio lo vuelve a revisar.\n' : 'La gerencia todavía no confirma la cotización.\n') +
      (cambioUrgente(pedido.fecha, pedido.horaInicio)
        ? `IMPORTANTE: faltan menos de ${HORAS_ANTICIPACION_CAMBIO} horas para el evento. Dile al inicio, con amabilidad, que los cambios se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación y que ya no podemos garantizarlo; si aun así quiere el cambio, regístralo (se pasa como urgente a la gerencia).\n`
        : `Recuérdale con amabilidad que los cambios de pedido se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación.\n`) +
      'Lo que pida ahora son agregados o cambios a ESE pedido. No pidas otra vez sus datos de contacto. Cuando tengas claro el cambio, llama registrar_pedido con los datos completos ya actualizados (nombre y teléfono del pedido).'
    );
  }

  // Cliente que sigue en la misma conversación con su pedido ya registrado.
  if (folioPrevio && !mensajeAEntregar && !pedidoExistente) {
    mensajeAEntregar = await mensajeDianaPendiente(folioPrevio).catch(() => null);
  }
  if (mensajeAEntregar) {
    avisos.push(`El equipo dejó este mensaje para el cliente sobre su pedido ${folioPrevio}. Entrégaselo al inicio de tu respuesta, sin cambiar montos, fechas ni condiciones, y sin decir quién lo escribió por su nombre:\n"${mensajeAEntregar.mensaje}"`);
  }

  // Días sin cupo (ya llenos con eventos autorizados): DiMa no los ofrece.
  try {
    const todos = await llenosProximos();
    const llenos = todos.filter(d => d.negocios.length);
    const casa = todos.filter(d => d.casaIsabella);
    if (llenos.length) {
      avisos.push(`DÍAS SIN CUPO (ya están llenos): ${llenos.map(d => `${d.fecha} (${d.negocios.map(n => n === 'El Vaso Maiz' ? 'El Vaso Maíz' : 'Divanna').join(' y ')})`).join(', ')}. Si el cliente pide una de esas fechas para ese negocio, dile: "Lamentablemente esa fecha la tenemos llena y ya no podemos cubrir tu evento", y ofrécele otras fechas cercanas que no estén en esta lista; no registres el pedido en esa fecha.`);
    }
    if (casa.length) {
      avisos.push(`CASA ISABELLA YA APARTADA: ${casa.map(d => d.fecha).join(', ')}. Si el cliente quiere el salón Casa Isabella en una de esas fechas, dile: "Esa fecha ya no está disponible" y ofrécele otras fechas para el salón; no registres el salón en esa fecha. El mobiliario a domicilio sí se puede ese día si no está en DÍAS SIN CUPO.`);
    }
  } catch (err) {
    console.error('No se pudieron leer los días llenos:', err.message);
  }

  // Días que la gerencia bloqueó en el calendario: DiMa no los ofrece.
  try {
    const bloqueos = await bloqueosProximos();
    if (bloqueos.length) {
      avisos.push(`DÍAS NO DISPONIBLES (los bloqueó la gerencia): ${bloqueos.map(b => `${b.fecha} (${b.negocio === 'Ambos' ? 'los dos negocios' : b.negocio})`).join(', ')}. Si el cliente pide una de esas fechas para ese negocio, dile con amabilidad que esa fecha ya no está disponible y ofrécele otra; no registres el pedido en esa fecha.`);
    }
  } catch (err) {
    console.error('No se pudieron leer los días bloqueados:', err.message);
  }

  if (temporadaMencionada(historial)) {
    avisos.push(`El cliente mencionó una fecha de temporada alta (${textoTemporada()}). Si el evento cae ahí: sin paquetes regulares, precios por pieza +${Math.round(TEMPORADA_ALTA.aumento * 100)}% (el traslado no sube), y explícalo con sutileza (temporada de más demanda).`);
  }

  const lugar = lugarForaneoMencionado(historial);
  if (lugar) {
    avisos.push(`El cliente mencionó "${lugar}", que es fuera de la ciudad de Culiacán. Si todavía no se lo explicaste, explícale en esta respuesta que los eventos foráneos se validan antes de confirmar (traslado del equipo ese día, distancia y costo de traslado) y que el equipo de logística se lo confirma. Registra con fuera_de_ciudad = true.`);
  }

  if (mensajesCliente >= AVISO_CIERRE) {
    const restantes = MAX_MENSAJES_CLIENTE - mensajesCliente;
    avisos.push(`La conversación ya va larga (quedan ${restantes} mensajes del cliente). Ve cerrando con amabilidad y sin prisas visibles: ` +
      (folioPrevio
        ? 'el pedido ya está registrado; resuelve lo que falte en pocas palabras y despídete diciendo que el equipo lo contacta.'
        : 'haz un repaso breve de lo acordado, pide nombre y teléfono si faltan y registra el pedido; si aún tiene dudas, dile que la gerencia se las resuelve al confirmar.'));
  }

  if (avisos.length) mensajes.push({ role: 'system', content: avisos.join('\n\n') });

  try {
    const sistema = systemPrompt(drive);
    const conversacion = [...mensajes];
    const partes = [];
    let fotos = [];
    let folioNuevo = folioPrevio;
    let registrado = false;
    // Fotos que el cliente ya vio en esta conversación (el navegador las guarda en el historial).
    const yaVistas = new Set(historial.flatMap(h => (h && h.rol === 'dima' && Array.isArray(h.fotos)) ? h.fotos : []));

    // Normalmente es una sola llamada. Si DiMa pide el aproximado de traslado o
    // muestra fotos, se le devuelve el resultado y sigue con él (máx. 3 vueltas).
    for (let vuelta = 0; vuelta < 3; vuelta++) {
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
        system: sistema,
        tools: herramientas(drive.fotos),
        tool_choice: { type: 'auto' },
        messages: [...conversacion],
      });

      if (respuesta.stop_reason === 'refusal') {
        if (!partes.length) {
          res.status(200).json({ texto: 'Perdona, con eso no te puedo ayudar. ¿Te ayudo a cotizar tu evento?', fotos: [] });
          return;
        }
        break;
      }

      const resultados = [];
      let pidioTraslado = false, pidioFotos = false;
      for (const bloque of respuesta.content) {
        if (bloque.type === 'text' && bloque.text.trim()) {
          partes.push(bloque.text.trim());
        } else if (bloque.type === 'tool_use' && bloque.name === 'mostrar_fotos') {
          // Antes se cortaba aquí y el cliente veía las fotos sin comentario (DiMa
          // "se trababa"). Ahora DiMa recibe de qué son y sigue la plática.
          pidioFotos = true;
          const pedidas = urlsDeFotos(bloque.input.ids);
          const nuevas = pedidas.filter(u => !yaVistas.has(u) && !fotos.includes(u));
          fotos = fotos.concat(nuevas);
          const repetidas = temasDeFotos(pedidas.filter(u => !nuevas.includes(u)));
          resultados.push({ type: 'tool_result', tool_use_id: bloque.id, content:
            (nuevas.length ? `El cliente ya ve estas fotos: ${temasDeFotos(nuevas).join('; ')}.` : 'No se mostró ninguna foto nueva.')
            + (repetidas.length ? ` Estas ya las había visto y no se repiten: ${repetidas.join('; ')}.` : '')
            + ' Coméntalas en una o dos frases (qué incluye, desde cuánto según el catálogo) y sigue con la cotización con una pregunta. No vuelvas a llamar mostrar_fotos en esta respuesta.' });
        } else if (bloque.type === 'tool_use' && bloque.name === 'estimar_traslado') {
          pidioTraslado = true;
          const t = await estimarTraslado(bloque.input.destino);
          const contenido = !t.ok ? `Sin resultado: ${t.motivo} Logística confirma cobertura y costo.`
            : t.dentroDeCiudad ? `${t.lugar} está dentro de la ciudad de Culiacán: no lleva costo de traslado.`
            : t.fueraDeCobertura ? `FUERA DE COBERTURA: ${t.lugar} queda a ${t.kmDesdeSalida} km de la salida de Culiacán, más del límite de ${LIMITE_KM} km. No damos servicio ahí: no registres el pedido.`
            : `${t.lugar}: ${t.kmDesdeSalida} km por carretera desde la salida de Culiacán, dentro del límite de ${LIMITE_KM} km. Traslado aproximado: $${t.costo.toLocaleString('es-MX')} (${t.kmDesdeSalida} km x $10 x 4 viajes: ir a dejar y regresar, ir a recoger y regresar).`;
          resultados.push({ type: 'tool_result', tool_use_id: bloque.id, content: contenido });
        } else if (bloque.type === 'tool_use' && bloque.name === 'registrar_pedido') {
          // Nunca se registra dos veces en la misma respuesta.
          const resultado = registrado
            ? { texto: '' }
            : await registrarPedido(bloque.input, historial, folioNuevo);
          registrado = registrado || !!resultado.folio;
          if (resultado.texto) partes.push(resultado.texto);
          if (resultado.folio && !folioNuevo) {
            folioNuevo = resultado.folio;
            partes.push(`Ya tenemos todos los datos de tu evento. El equipo revisa la disponibilidad y en un lapso no mayor a ${HORAS_RESPUESTA} horas te confirmamos la cotización; te contactamos por teléfono para el anticipo y los datos de pago. Guarda tu número de pedido (${resultado.folio}): si después quieres agregar o cambiar algo, escríbelo en la página en "¿Ya tienes número de pedido?". Los cambios se piden con al menos ${HORAS_ANTICIPACION_CAMBIO} horas de anticipación.`);
          } else if (resultado.folio) {
            folioNuevo = resultado.folio;
          }
          resultados.push({ type: 'tool_result', tool_use_id: bloque.id, content: resultado.texto || 'Pedido ya registrado.' });
        }
      }

      if (!(pidioTraslado || pidioFotos) || respuesta.stop_reason !== 'tool_use') break;
      conversacion.push({ role: 'assistant', content: respuesta.content });
      conversacion.push({ role: 'user', content: resultados });
    }

    // Diana ya quedó atendida: no se le vuelve a entregar el mismo mensaje.
    if (mensajeAEntregar) await marcarMensajeEntregado(mensajeAEntregar.id).catch(() => {});

    let texto = partes.join('\n\n');
    if (!texto && fotos.length) texto = 'Claro, mira estos ejemplos:';
    if (!texto) texto = 'Perdona, se me fue la idea. ¿Me repites lo último?';

    res.status(200).json({
      texto,
      fotos,
      folio: folioNuevo,
      folioFirma: folioNuevo ? firmaFolio(folioNuevo) : null,
      limite: mensajesCliente >= MAX_MENSAJES_CLIENTE,
    });
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
