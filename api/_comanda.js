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
const { PRODUCTOS, CLAVES } = require('./_productos');
const { capturarEvento, fechaTexto } = require('./_calendario');
const { ROLES } = require('./_sesion');
const { telegramApi } = require('./_telegram');

const MODELO = 'claude-sonnet-5-5';
const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLA = 'tblNYrh2wjsYgHfmf'; // COMANDAS_FOTO
const EVENTOS = 'tblzLAin65BZPP2c6';
const FORMAS = ['Efectivo', 'Transferencia', 'Depósito'];
const MAX_BYTES = 5 * 1024 * 1024;
const MARCA = '🧾 Comanda leída';

const client = new Anthropic();

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
      forma_anticipo: { type: ['string', 'null'], enum: [...FORMAS, null] },
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
- Total y anticipo: los que están escritos. No calcules precios.

Catálogo (clave: nombre):
${catalogo}`;
}

// Normaliza lo que dio Claude al formato de "capturar evento".
function aCaptura(x) {
  const tel = String(x.cliente_telefono || '').replace(/\D/g, '').slice(-10);
  const lineas = (x.lineas || []).map(t => String(t).trim()).filter(Boolean).slice(0, 80);
  const productos = (x.productos || []).filter(p => PRODUCTOS[p.clave] && p.clave !== 'otro' && p.cantidad > 0).map(p => ({ clave: p.clave, cantidad: Math.round(p.cantidad), nota: p.nota || null }));
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
    montoContratado: Number(x.total) > 0 ? Number(x.total) : '',
    anticipo: Number(x.anticipo) > 0 ? Number(x.anticipo) : '',
    formaAnticipo: FORMAS.includes(x.forma_anticipo) ? x.forma_anticipo : '',
    notas: notas.slice(0, 1500),
    dudas: (x.dudas || []).map(String).filter(Boolean).slice(0, 12),
  };
}

// Lo que todavía falta para poder guardar (las mismas reglas de capturarEvento).
function faltantes(d) {
  const f = [];
  if (!d.clienteNombre) f.push('nombre del cliente');
  if (String(d.clienteTelefono || '').length !== 10) f.push('teléfono del cliente (10 dígitos)');
  if (!d.fecha) f.push('fecha del evento');
  if (!d.servicios) f.push('qué lleva');
  if (!d.montoContratado) f.push('total contratado');
  if (d.anticipo && !d.formaAnticipo) f.push('cómo pagó el anticipo (efectivo, transferencia o depósito)');
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
  const respuesta = await client.beta.messages.create({
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
  const r = await leer({ foto: body.imagen, pista: body.pista });
  if (r.error) return r;
  if (!puedeCapturarNegocio(colaborador, r.datos.negocio)) r.datos.dudas.unshift('La comanda parece de Divanna; tú solo puedes capturar eventos de El Vaso Maíz.');
  return { ok: true, datos: r.datos, faltan: faltantes(r.datos) };
}
const puedeCapturarNegocio = (c, negocio) => c.rol === ROLES.ADMIN || (c.gerente && negocio === 'El Vaso Maiz');

// ---------- Telegram: borrador con botones ----------

const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;
const hora12 = (h) => { if (!h) return ''; const [a, m] = h.split(':').map(Number); return `${a % 12 || 12}:${String(m).padStart(2, '0')} ${a < 12 ? 'am' : 'pm'}`; };

function textoBorrador(d, id) {
  const falta = faltantes(d);
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
  ...(faltantes(d).length ? [] : [{ texto: '✅ Guardar evento', dato: `cm:g:${id}` }]),
  { texto: '❌ Descartar', dato: `cm:x:${id}` },
]];

// Foto que llega al bot (message.photo o una imagen como documento).
async function descargarFotoTelegram(mensaje) {
  const doc = mensaje.document && /^image\//.test(mensaje.document.mime_type || '') ? mensaje.document : null;
  const foto = doc || (mensaje.photo || []).slice(-1)[0];
  if (!foto) return null;
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
  if (!puedeLeer(colaborador)) return { texto: 'Las fotos de comandas las leo solo para Diana, Víctor y la gerente de El Vaso Maíz.' };
  await telegramApi('sendMessage', { chat_id: mensaje.chat.id, text: '📷 Leyendo la comanda, dame unos segundos…' }).catch(() => {});
  let foto;
  try { foto = await descargarFotoTelegram(mensaje); } catch (err) { return { texto: `No pude abrir la foto: ${err.message}` }; }
  if (!foto) return { texto: 'No encontré la foto. Mándala otra vez, por favor.' };
  const r = await leer({ foto, pista: mensaje.caption || '' });
  if (r.error) return { texto: r.error };
  if (!puedeCapturarNegocio(colaborador, r.datos.negocio)) r.datos.dudas.unshift('La comanda parece de Divanna; tú solo puedes capturar eventos de El Vaso Maíz (corrígelo si es de El Vaso Maíz).');
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
  const r = await capturarEvento(colaborador, { ...b.datos, notas: [b.datos.notas, 'Capturado desde foto de comanda (Telegram).'].filter(Boolean).join(' ') });
  if (r.error) return { aviso: r.error, alerta: true };
  const foto = (b.r.fields.Foto || [])[0];
  await Promise.all([
    airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Estado: 'Guardada', Evento: [r.eventoId] } }] }) }),
    foto ? airtable(EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: r.eventoId, fields: { Foto_Comanda: [{ url: foto.url, filename: foto.filename || 'comanda.jpg' }] } }] }) }).catch(() => null) : null,
  ]);
  const extras = [
    r.clienteNuevo ? 'cliente nuevo' : `cliente ya registrado: ${r.cliente}`,
    r.anticipoGuardado ? 'anticipo registrado' : '',
    r.recibo ? (r.recibo.ok ? 'te mandé el recibo' : `el recibo no salió: ${r.recibo.error}`) : '',
    r.google && !r.google.ok ? `⚠️ ${r.google.error}` : '',
    r.diaLleno && r.diaLleno.lleno ? `📅 ese día quedó LLENO (${r.diaLleno.detalle})` : '',
  ].filter(Boolean).join(' · ');
  return { aviso: 'Evento guardado', texto: `✅ Evento ${r.folio} guardado (${extras}). Ya está en el calendario; falta asignarle brigada en el dashboard.` };
}

module.exports = { leer, aCaptura, faltantes, leerParaFormulario, fotoValida, subirAdjunto, esFotoComanda, esRespuestaComanda, atenderFoto, atenderCorreccion, atenderBoton, textoBorrador, MARCA };
