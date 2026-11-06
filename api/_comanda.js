// api/_comanda.js
// Comandas en papel → evento (pedido de Víctor 2026-10-29): mientras Diana se
// adapta, puede seguir llenando comandas a mano y tomarles foto. DiMa (Claude
// con visión) lee la foto y la acomoda en los mismos datos que "➕ Capturar
// evento": cliente, teléfono, fecha, hora, lugar, productos, total y anticipo.
// Nunca guarda sola: primero muestra lo que leyó y lo que no se entiende.
// - En la app (➕ Capturar evento → 📷 Leer comanda): llena el formulario y
//   Diana revisa y toca Guardar (la foto se adjunta al evento).
// - En Telegram (Diana, Víctor o la gerente mandan la foto al bot): queda un
//   borrador en COMANDAS_FOTO con botones Guardar / Descartar; para corregir
//   se contesta encima del borrador ("la fecha es el 28").
// Al guardar con anticipo, sale el recibo (api/_sheets.js).

const { Anthropic } = require('@anthropic-ai/sdk');
const { PRODUCTOS, CLAVES, cargoManteles } = require('./_productos');
const { capturarEvento, fechaTexto } = require('./_calendario');
const { ROLES, negocioDeGerencia, NOMBRE_GERENCIA } = require('./_sesion');
const { telegramApi, enviarTelegramEquipo, esSinSaldo } = require('./_telegram');

const MODELO = 'claude-sonnet-5-5';
const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLA = 'tblNYrh2wjsYgHfmf'; // COMANDAS_FOTO
const EVENTOS = 'tblzLAin65BZPP2c6';
const FORMAS = ['Efectivo', 'Transferencia', 'Depósito'];
const MAX_BYTES = 5 * 1024 * 1024;
const MARCA = '🧾 Comanda leída';

const client = new Anthropic();

// Vercel corta la función a los 60 s (vercel.json). La llamada a Claude tiene que
// terminar antes para contestar un mensaje claro y no un 504 sin explicación.
// Si Claude falla por algo pasajero (saturado, 5xx, red), se reintenta mientras
// quede tiempo; un error de la petición (400, sin saldo) no se reintenta.
const LIMITE_CLAUDE_MS = 50000;
async function llamarClaude(params) {
  const inicio = Date.now();
  for (let intento = 1; ; intento++) {
    const resta = LIMITE_CLAUDE_MS - (Date.now() - inicio);
    try {
      return await client.beta.messages.create(params, { timeout: resta, maxRetries: 0 });
    } catch (err) {
      const pasajero = !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
      if (!pasajero || intento >= 3 || LIMITE_CLAUDE_MS - (Date.now() - inicio) < 20000) throw err;
      console.error(`Comanda: Claude falló (intento ${intento}), reintento:`, err.status || '', err.message);
      await new Promise(r => setTimeout(r, 800 * intento));
    }
  }
}

// Si leer comandas deja de funcionar, Diana y Víctor se enteran por Telegram
// (máximo un aviso por hora por instancia). Nunca lanza error.
let ultimoAvisoFalla = 0;
async function avisarFalla(origen, err) {
  console.error(`Comanda: no se pudo leer (${origen}):`, err && (err.status || ''), err && err.message);
  if (Date.now() - ultimoAvisoFalla < 60 * 60 * 1000) return;
  ultimoAvisoFalla = Date.now();
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `⚠️ Falló la lectura de una comanda por foto (${origen}).
Detalle: ${String((err && err.message) || err).slice(0, 300)}

Si se repite, revisen los registros de Vercel.`,
  }).catch(e => console.error('No se pudo avisar la falla de comandas:', e.message));
}

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function subirAdjunto(recordId, campo, foto) {
  const res = await fetch(`https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${encodeURIComponent(campo)}/uploadAttachment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: foto.tipo, file: foto.base64, filename: foto.nombre || 'comanda.jpg' }),
  });
  if (!res.ok) throw new Error(`No se pudo subir la foto (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
const puedeLeer = (c) => c.rol === ROLES.ADMIN || !!c.gerente;
const fotoValida = (f) => f && /^image\/(jpeg|png|webp)$/.test(f.tipo || '') && typeof f.base64 === 'string' && f.base64.length > 100 && f.base64.length * 0.75 <= MAX_BYTES;

const nulo = (tipo) => ({ type: [tipo, 'null'] });
const HERRAMIENTA = {
  name: 'datos_comanda',
  description: 'Entrega lo que dice la comanda, acomodado en los datos del evento.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['negocio', 'cliente_nombre', 'cliente_telefono', 'fecha', 'hora', 'horas_servicio', 'ubicacion', 'invitados', 'productos', 'lineas', 'total', 'anticipo', 'forma_anticipo', 'numero_recibo', 'notas', 'dudas'],
    properties: {
      negocio: { type: 'string', enum: ['Divanna Eventos', 'El Vaso Maiz'] },
      cliente_nombre: nulo('string'),
      cliente_telefono: { ...nulo('string'), description: '10 dígitos, solo números. Si hay varios, el del cliente.' },
      fecha: { ...nulo('string'), description: 'Fecha del EVENTO en YYYY-MM-DD.' },
      hora: { ...nulo('string'), description: 'Hora de inicio del evento en HH:MM de 24 horas.' },
      horas_servicio: nulo('number'),
      ubicacion: nulo('string'),
      invitados: nulo('integer'),
      productos: {
        type: 'array',
        description: 'Solo lo que corresponde con seguridad a una clave del catálogo.',
        items: {
          type: 'object', additionalProperties: false, required: ['clave', 'cantidad', 'nota'],
          properties: { clave: { type: 'string', enum: CLAVES }, cantidad: { type: 'integer' }, nota: { ...nulo('string'), description: 'Modelo, color o detalle escrito.' } },
        },
      },
      lineas: { type: 'array', items: { type: 'string' }, description: 'Cada artículo como va en la lista de carga: "45 sillas Jardín", "4 manteles básicos beige".' },
      total: { ...nulo('number'), description: 'Total del pedido escrito en la comanda.' },
      anticipo: nulo('number'),
      // La API no acepta enum con tipo ['string', 'null']: "No se sabe" hace de null (aCaptura lo deja vacío).
      forma_anticipo: { type: 'string', enum: [...FORMAS, 'No se sabe'], description: 'Forma de pago del anticipo; "No se sabe" si no está escrita.' },
      numero_recibo: { ...nulo('string'), description: 'Número o folio impreso o escrito en el papel.' },
      notas: { ...nulo('string'), description: 'Otros datos útiles (fecha y hora de entrega, colores, indicaciones).' },
      dudas: { type: 'array', items: { type: 'string' }, description: 'Lo que no se lee bien o hay que confirmar (tachones, números dudosos, datos que faltan).' },
    },
  },
};

function sistema() {
  const catalogo = CLAVES.filter(k => k !== 'otro').map(k => `${k}: ${PRODUCTOS[k].nombre}${PRODUCTOS[k].negocio === 'El Vaso Maiz' ? ' (El Vaso Maíz)' : ''}`).join('\n');
  return `Eres DiMa, la asistente de Divanna Eventos (renta de mobiliario y decoración) y El Vaso Maíz (snacks para eventos), en Culiacán. Diana llena a mano comandas/recibos en papel y te manda la foto. Léela con cuidado y entrega los datos con la herramienta datos_comanda.

Hoy es ${hoy()}. Si la fecha del evento no trae año, usa la próxima fecha que todavía no pasa. Horas como "6 pm" → 18:00.
- El negocio: El Vaso Maíz si es comanda de snacks (esquites, tostilocos, papas, raspados, paquetes de snacks); si no, Divanna Eventos.
- No inventes: si un dato no está o no se lee, ponlo en null y explícalo en "dudas". Si un número está tachado o es dudoso, di cuál leíste y que hay que confirmarlo.
- "lineas": cada artículo con su cantidad como está escrito (sale como lista de carga). Incluye también los que no tienen cantidad.
- "productos": además, los que correspondan con seguridad a una clave del catálogo, con su cantidad (de mesas, sillas, manteles, platos, copas y paquetes).
- MANTEL: en la comanda el espacio de "Mantel" es para el TIPO (básico, lentejuela o corrugado) y el COLOR, no para la cantidad: los manteles salen de las mesas (uno por mesa). Pon el tipo y el color en la nota del producto que trae las mesas (ej. "mantel lentejuela rosa"). Las mesas traen mantel básico: si dice lentejuela o corrugado, agrega además dv_cambio_lentejuela o dv_cambio_corrugado con la misma cantidad de mesas (o un paquete que ya traiga ese mantel, si lo escrito es un paquete). Si ahí solo hay un número o no dice tipo y color, NO agregues "Mantel extra" por ese número y pon en "dudas": "Falta el tipo y color del mantel".
- No cuentes dos veces: "Mesa con mantel" y "Mesa con 10 sillas Jardinera y mantel" ya traen su mantel, y los paquetes traen mesas, sillas, manteles, platos, copas y servilletas. Los manteles extra (dv_mantel básico, dv_mantel_corrugado, dv_mantel_lentejuela) son solo para manteles ADEMÁS de los que ya traen las mesas o paquetes. Ej.: "10 mesas, 10 manteles" = dv_mesa_mantel x 10 (sin dv_mantel); "10 mesas, 12 manteles" = dv_mesa_mantel x 10 + dv_mantel x 2; "10 mesas, mantel lentejuela" = dv_mesa_mantel x 10 + dv_cambio_lentejuela x 10.
- PERSONALIZADOS: "personalizados" son los diseños impresos para los platos o vasos (con el nombre o tema del festejado), NO son snacks ni piezas que se preparan. En El Vaso Maíz van como vm_personalizado y en Divanna como dv_personalizado. Nunca los pongas como vm_pieza ni en un paquete.
- Total y anticipo: los que están escritos. No calcules precios.
- Si no está escrita la forma de pago del anticipo, pon "No se sabe" y NO lo pongas en "dudas" (se registra después en la app).

Catálogo (clave: nombre):
${catalogo}`;
}

// Candado (Víctor 2026-11-02: "en lugar de poner 10 manteles pone 20"): las
// mesas con mantel ya traen su mantel y Claude a veces agrega además "Mantel
// extra" por los mismos manteles. Manda lo escrito en el papel: si las líneas
// dicen N manteles (básicos, no lentejuela ni corrugado) y con los productos
// salen más, se le quita la diferencia a "Mantel extra".
// Candado (Víctor 2026-11-02, EVT-004762 pedía 11 personas): "155 personalizados"
// son diseños para los platos, no piezas que se preparan. Si Claude los pone como
// "pieza suelta" de El Vaso Maíz, se cambian a personalizado (no cuenta personal).
function personalizadosNoSePreparan(productos, lineas, negocio) {
  const cantidades = lineas.filter(t => /personaliz/i.test(t)).map(t => Number((t.match(/^\s*(\d+)/) || [])[1])).filter(n => n > 0);
  const destino = negocio === 'El Vaso Maiz' ? 'vm_personalizado' : 'dv_personalizado';
  return productos.map(p => {
    if (p.clave !== 'vm_pieza') return p;
    const i = cantidades.indexOf(p.cantidad);
    if (i < 0 && !/personaliz/i.test(p.nota || '')) return p;
    if (i >= 0) cantidades.splice(i, 1);
    return { ...p, clave: destino };
  });
}

function sinMantelesDobles(productos, lineas) {
  let escritos = 0;
  for (const t of lineas) {
    if (!/manteles?\b/i.test(t) || /lentejuela|corrugad/i.test(t)) continue;
    const n = (t.match(/^\s*(\d+)/) || [])[1];
    if (!n) return productos; // no se sabe cuántos: se deja como vino
    escritos += Number(n);
  }
  if (!escritos) return productos;
  const total = productos.reduce((t, p) => t + ((PRODUCTOS[p.clave].componentes || {})['Mantel'] || 0) * p.cantidad, 0);
  let sobran = total - escritos;
  if (sobran <= 0) return productos;
  return productos.map(p => {
    if (p.clave !== 'dv_mantel' || sobran <= 0) return p;
    const quitar = Math.min(sobran, p.cantidad);
    sobran -= quitar;
    return { ...p, cantidad: p.cantidad - quitar };
  }).filter(p => p.cantidad > 0);
}

// Normaliza lo que dio Claude al formato de "capturar evento".
function aCaptura(x) {
  const tel = String(x.cliente_telefono || '').replace(/\D/g, '').slice(-10);
  const lineas = (x.lineas || []).map(t => String(t).trim()).filter(Boolean).slice(0, 80);
  const limpios = (x.productos || []).filter(p => PRODUCTOS[p.clave] && p.clave !== 'otro' && p.cantidad > 0).map(p => ({ clave: p.clave, cantidad: Math.round(p.cantidad), nota: p.nota || null }));
  const productos = sinMantelesDobles(personalizadosNoSePreparan(limpios, lineas, x.negocio), lineas);
  const notas = [x.numero_recibo ? `Comanda de papel Nº ${x.numero_recibo}.` : '', x.notas || ''].filter(Boolean).join(' ');
  return {
    negocio: x.negocio === 'El Vaso Maiz' ? 'El Vaso Maiz' : 'Divanna Eventos',
    clienteNombre: String(x.cliente_nombre || '').trim().slice(0, 80),
    clienteTelefono: tel,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(x.fecha || '') ? x.fecha : '',
    hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(x.hora || '') ? x.hora : '',
    horasServicio: Number(x.horas_servicio) > 0 ? Number(x.horas_servicio) : '',
    ubicacion: String(x.ubicacion || '').trim().slice(0, 200),
    invitados: Number(x.invitados) > 0 ? Math.round(Number(x.invitados)) : '',
    servicios: lineas.join('\n'),
    productos,
    // El total del papel ya trae los manteles; capturarEvento los vuelve a sumar.
    montoContratado: Number(x.total) > 0 ? Math.max(0, Number(x.total) - cargoManteles(productos)) || Number(x.total) : '',
    anticipo: Number(x.anticipo) > 0 ? Number(x.anticipo) : '',
    formaAnticipo: FORMAS.includes(x.forma_anticipo) ? x.forma_anticipo : '',
    notas: notas.slice(0, 1500),
    dudas: (x.dudas || []).map(String).filter(Boolean).slice(0, 12),
  };
}

// Lo que todavía falta para poder guardar (las mismas reglas de capturarEvento).
// En Telegram no se pide la forma de pago del anticipo (Víctor 2026-11-02: "eso
// se hace en la apk"): se guarda el evento y el anticipo se registra en la app
// con 💵 Registrar pago. En el formulario de la app sí se pide.
function faltantes(d, { pideForma = true } = {}) {
  const f = [];
  if (!d.clienteNombre) f.push('nombre del cliente');
  if (String(d.clienteTelefono || '').length !== 10) f.push('teléfono del cliente (10 dígitos)');
  if (!d.fecha) f.push('fecha del evento');
  if (!d.servicios) f.push('qué lleva');
  if (!d.montoContratado) f.push('total contratado');
  if (pideForma && d.anticipo && !d.formaAnticipo) f.push('cómo pagó el anticipo (efectivo, transferencia o depósito)');
  return f;
}

// Lee una foto (o corrige un borrador con texto). Devuelve { datos } o { error }.
async function leer({ foto = null, pista = '', previo = null, correccion = '' }) {
  const contenido = [];
  if (foto) contenido.push({ type: 'image', source: { type: 'base64', media_type: foto.tipo, data: foto.base64 } });
  let texto = foto ? 'Lee esta comanda.' : 'Corrige estos datos de una comanda.';
  if (pista) texto += `\nNota de quien la manda: ${String(pista).slice(0, 500)}`;
  if (previo) texto += `\nLo que ya habías leído (JSON): ${JSON.stringify(previo).slice(0, 6000)}`;
  if (correccion) texto += `\nCorrección de Diana (tiene prioridad sobre lo leído): ${String(correccion).slice(0, 1000)}\nDevuelve todos los datos ya corregidos; quita de "dudas" lo que la corrección resolvió.`;
  contenido.push({ type: 'text', text: texto });
  const respuesta = await llamarClaude({
    model: MODELO,
    max_tokens: 4000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: sistema(),
    tools: [HERRAMIENTA],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: contenido }],
  });
  const uso = (respuesta.content || []).find(b => b.type === 'tool_use' && b.name === HERRAMIENTA.name);
  if (!uso) return { error: 'No pude leer la comanda. Intenta con una foto más clara y derecha, con buena luz.' };
  return { datos: aCaptura(uso.input) };
}

// ---------- App: leer y llenar el formulario ----------

async function leerParaFormulario(colaborador, body) {
  if (!puedeLeer(colaborador)) return { error: 'Solo Diana, Víctor y la gerente capturan eventos.', codigo: 403 };
  if (!fotoValida(body.imagen)) return { error: 'Manda una foto (JPG o PNG) de menos de 5 MB.' };
  let r;
  try {
    r = await leer({ foto: body.imagen, pista: body.pista });
  } catch (err) {
    if (esSinSaldo(err)) throw err; // dashboard-eventos avisa y contesta el mensaje de saldo
    await avisarFalla('app', err);
    return { error: 'DiMa no pudo leer la foto en este momento. Intenta de nuevo en un minuto; si sigue, llena el formulario a mano.', codigo: 502 };
  }
  if (r.error) return r;
  if (!puedeCapturarNegocio(colaborador, r.datos.negocio)) r.datos.dudas.unshift(avisoOtroNegocio(colaborador, r.datos.negocio));
  return { ok: true, datos: r.datos, faltan: faltantes(r.datos) };
}
// Cada gerente captura en su negocio (Casa Isabella: Divanna, con el salón).
const puedeCapturarNegocio = (c, negocio) => c.rol === ROLES.ADMIN || (!!c.gerente && negocio === negocioDeGerencia(c.gerente));
const avisoOtroNegocio = (c, negocio) => `La comanda parece de ${negocio === 'El Vaso Maiz' ? 'El Vaso Maíz' : 'Divanna'}; tú solo puedes capturar eventos de ${NOMBRE_GERENCIA[c.gerente] || 'tu negocio'} (corrígelo si me equivoqué).`;

// ---------- Telegram: borrador con botones ----------

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const hora12 = (h) => { if (!h) return ''; const [a, m] = h.split(':').map(Number); return `${a % 12 || 12}:${String(m).padStart(2, '0')} ${a < 12 ? 'am' : 'pm'}`; };

function textoBorrador(d, id) {
  const falta = faltantes(d, { pideForma: false });
  const lineas = [
    `${MARCA} (borrador, todavía no se guarda)`,
    '',
    `🏢 ${d.negocio === 'El Vaso Maiz' ? 'El Vaso Maíz' : 'Divanna Eventos'}`,
    `👤 ${d.clienteNombre || '—'} · 📞 ${d.clienteTelefono || '—'}`,
    `📅 ${d.fecha ? fechaTexto(d.fecha) : '—'}${d.hora ? ' · ' + hora12(d.hora) : ''}${d.horasServicio ? ` · ${d.horasServicio} h` : ''}`,
    `📍 ${d.ubicacion || '—'}${d.invitados ? ` · ${d.invitados} invitados` : ''}`,
    '',
    '📦 Lleva:',
    ...(d.servicios ? d.servicios.split('\n').map(l => `• ${l}`) : ['—']),
    '',
    `💵 Total ${d.montoContratado ? pesos(d.montoContratado) : '—'} · Anticipo ${d.anticipo ? `${pesos(d.anticipo)}${d.formaAnticipo ? ' (' + d.formaAnticipo.toLowerCase() + ')' : ''}` : '—'}`,
    ...(d.notas ? [`📝 ${d.notas}`] : []),
    ...(d.dudas.length ? ['', '⚠️ Revisa:', ...d.dudas.map(x => `• ${x}`)] : []),
    ...(falta.length ? ['', `❗ Falta para guardar: ${falta.join(', ')}.`] : []),
    '',
    'Si algo está mal, contéstame ENCIMA de este mensaje con la corrección (ej. "la fecha es el 28 de noviembre, anticipo en transferencia").',
    `Borrador: ${id}`,
  ];
  return lineas.join('\n').slice(0, 4000);
}
const botonesBorrador = (id, d) => [[
  ...(faltantes(d, { pideForma: false }).length ? [] : [{ texto: '✅ Guardar evento', dato: `cm:g:${id}` }]),
  { texto: '❌ Descartar', dato: `cm:x:${id}` },
]];

// Foto que llega al bot (message.photo o una imagen como documento).
async function descargarFotoTelegram(mensaje) {
  const doc = mensaje.document && /^image\//.test(mensaje.document.mime_type || '') ? mensaje.document : null;
  const foto = doc || (mensaje.photo || []).slice(-1)[0];
  if (!foto) return null;
  if (doc && !/^image\/(jpeg|png|webp)$/.test(doc.mime_type)) throw new Error('viene como archivo en un formato que no leo. Mándala como foto (con el ícono de la cámara o la galería), no como archivo.');
  if (foto.file_size && foto.file_size > MAX_BYTES) throw new Error('La foto pesa más de 5 MB.');
  const info = await telegramApi('getFile', { file_id: foto.file_id });
  const ruta = info.data && info.data.result && info.data.result.file_path;
  if (!ruta) throw new Error('Telegram no me dio la foto.');
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${ruta}`);
  if (!res.ok) throw new Error(`No pude bajar la foto (${res.status}).`);
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  const tipo = doc ? doc.mime_type : 'image/jpeg';
  return { base64, tipo: /^image\/(jpeg|png|webp)$/.test(tipo) ? tipo : 'image/jpeg', nombre: ruta.split('/').pop() };
}

const esFotoComanda = (mensaje) => !!((mensaje.photo && mensaje.photo.length) || (mensaje.document && /^image\//.test(mensaje.document.mime_type || '')));
const esRespuestaComanda = (mensaje) => !!(mensaje.reply_to_message && mensaje.reply_to_message.from && mensaje.reply_to_message.from.is_bot
  && String(mensaje.reply_to_message.text || '').startsWith(MARCA) && typeof mensaje.text === 'string');

// Devuelve { texto, botones } para contestar en el chat.
async function atenderFoto(mensaje, colaborador) {
  if (!puedeLeer(colaborador)) return { texto: 'Las fotos de comandas las leo solo para Diana, Víctor y los gerentes.' };
  await telegramApi('sendMessage', { chat_id: mensaje.chat.id, text: '📷 Leyendo la comanda, dame unos segundos…' }).catch(() => {});
  let foto;
  try { foto = await descargarFotoTelegram(mensaje); } catch (err) { return { texto: `No pude abrir la foto: ${err.message}` }; }
  if (!foto) return { texto: 'No encontré la foto. Mándala otra vez, por favor.' };
  let r;
  try {
    r = await leer({ foto, pista: mensaje.caption || '' });
  } catch (err) {
    if (esSinSaldo(err)) throw err; // telegram.js avisa y contesta el mensaje de saldo
    await avisarFalla('Telegram', err);
    return { texto: 'No pude leer la comanda en este momento. Mándala otra vez en un minuto; si sigue, captúrala en la app.' };
  }
  if (r.error) return { texto: r.error };
  if (!puedeCapturarNegocio(colaborador, r.datos.negocio)) r.datos.dudas.unshift(avisoOtroNegocio(colaborador, r.datos.negocio));
  const creado = await airtable(TABLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: {
    Resumen: `${r.datos.clienteNombre || 'Sin nombre'} · ${r.datos.fecha || 'sin fecha'}`.slice(0, 100),
    Datos: JSON.stringify(r.datos), Estado: 'Pendiente', Colaborador: [colaborador.id],
  } }] }) });
  const id = creado.records[0].id;
  await subirAdjunto(id, 'Foto', foto).catch(err => console.error('No se pudo guardar la foto de la comanda:', err.message));
  return { texto: textoBorrador(r.datos, id), botones: botonesBorrador(id, r.datos) };
}

async function leerBorrador(id, colaborador) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return { error: 'No encontré ese borrador.' };
  const r = await airtable(`${TABLA}/${id}`);
  if ((r.fields.Colaborador || [])[0] !== colaborador.id && colaborador.rol !== ROLES.ADMIN) return { error: 'Ese borrador no es tuyo.' };
  if (r.fields.Estado !== 'Pendiente') return { error: r.fields.Estado === 'Guardada' ? 'Esa comanda ya se guardó.' : 'Esa comanda ya se descartó.' };
  return { r, datos: JSON.parse(r.fields.Datos || '{}') };
}

async function atenderCorreccion(mensaje, colaborador) {
  const id = (String(mensaje.reply_to_message.text).match(/Borrador: (rec[A-Za-z0-9]{14})/) || [])[1];
  const b = await leerBorrador(id, colaborador);
  if (b.error) return { texto: b.error };
  await telegramApi('sendChatAction', { chat_id: mensaje.chat.id, action: 'typing' }).catch(() => {});
  const { dudas, ...previo } = b.datos;
  const r = await leer({ previo: { ...previo, dudas }, correccion: mensaje.text });
  if (r.error) return { texto: 'No entendí la corrección; dímela de otra forma, por favor.' };
  await airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Datos: JSON.stringify(r.datos), Resumen: `${r.datos.clienteNombre || 'Sin nombre'} · ${r.datos.fecha || 'sin fecha'}`.slice(0, 100) } }] }) });
  return { texto: textoBorrador(r.datos, id), botones: botonesBorrador(id, r.datos) };
}

// Botón Guardar / Descartar. Devuelve { aviso, texto } (texto = respuesta en el chat).
async function atenderBoton(accion, id, colaborador) {
  const b = await leerBorrador(id, colaborador);
  if (b.error) return { aviso: b.error, alerta: true };
  if (accion === 'x') {
    await airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Estado: 'Descartada' } }] }) });
    return { aviso: 'Descartada', texto: '❌ Comanda descartada. No se guardó nada.' };
  }
  // Sin forma de pago, el anticipo no se registra aquí (el cobro la necesita): queda anotado y se registra en la app.
  const anticipoPendiente = b.datos.anticipo && !b.datos.formaAnticipo ? b.datos.anticipo : null;
  const notaAnticipo = anticipoPendiente ? `Anticipo según la comanda: ${pesos(anticipoPendiente)} (falta registrarlo en la app con 💵 Registrar pago).` : '';
  const r = await capturarEvento(colaborador, {
    ...b.datos,
    ...(anticipoPendiente ? { anticipo: null, formaAnticipo: '' } : {}),
    notas: [b.datos.notas, 'Capturado desde foto de comanda (Telegram).', notaAnticipo].filter(Boolean).join(' '),
  });
  if (r.error) return { aviso: r.error, alerta: true };
  const foto = (b.r.fields.Foto || [])[0];
  await Promise.all([
    airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Estado: 'Guardada', Evento: [r.eventoId] } }] }) }),
    foto ? airtable(EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: r.eventoId, fields: { Foto_Comanda: [{ url: foto.url, filename: foto.filename || 'comanda.jpg' }] } }] }) }).catch(() => null) : null,
  ]);
  const extras = [
    r.clienteNuevo ? 'cliente nuevo' : `cliente ya registrado: ${r.cliente}`,
    r.anticipoGuardado ? 'anticipo registrado' : '',
    anticipoPendiente ? `anticipo de ${pesos(anticipoPendiente)} por registrar en la app con 💵 Registrar pago` : '',
    r.recibo ? (r.recibo.ok ? 'te mandé el recibo' : `el recibo no salió: ${r.recibo.error}`) : '',
    r.google && !r.google.ok ? `⚠️ ${r.google.error}` : '',
    r.diaLleno && r.diaLleno.lleno ? `📅 ese día quedó LLENO (${r.diaLleno.detalle})` : '',
  ].filter(Boolean).join(' · ');
  return { aviso: 'Evento guardado', texto: `✅ Evento ${r.folio} guardado (${extras}). Ya está en el calendario; falta asignarle brigada en el dashboard.` };
}

module.exports = { HERRAMIENTA, leer, llamarClaude, avisarFalla, aCaptura, sinMantelesDobles, personalizadosNoSePreparan, faltantes, leerParaFormulario, fotoValida, subirAdjunto, esFotoComanda, esRespuestaComanda, atenderFoto, atenderCorreccion, atenderBoton, textoBorrador, MARCA };
