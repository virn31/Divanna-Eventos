// api/_tickets.js
// Gastos fáciles para todo el equipo (Víctor 2026-11-10), aunque ese día no
// tengan eventos:
// - Telegram: mandar la FOTO del ticket al bot. DiMa lee el total, el concepto
//   y la categoría y lo guarda de una vez (con la foto) en el reporte del día de
//   quien lo manda, pagado con dinero del negocio. Abajo salen 👛 "Lo pagué yo"
//   (gt:p, para el reembolso) y 🗑️ "Borrar" (gt:x). Si en el pie de foto viene
//   el monto ("350 gasolina") no se llama a Claude. Diana, Víctor y los gerentes
//   mandan fotos de comandas: para ellos una foto es gasto solo si el pie dice
//   "gasto" o "ticket"; sin eso sigue siendo comanda (api/_comanda.js).
// - Telegram: "/gasto 350 gasolina" (para todos; Diana y Víctor siguen con su
//   pregunta de tipo en api/_finanzas.js).
// - App (💰): al elegir la foto del ticket, DiMa llena monto, concepto y
//   categoría (POST /api/finanzas accion leer_ticket); la persona revisa y guarda.
// Si quien anota no tuvo eventos ese día, el reporte se manda solo a Diana (no
// hay cobros ni efectivo que esperar); si tuvo, sale "📨 Enviar reporte a Diana".

const { ROLES } = require('./_sesion');
const { telegramApi } = require('./_telegram');
const F = require('./_finanzas');
const { descargarFotoTelegram, puedeLeer, llamarClaude, MODELO } = require('./_comanda');

const ID = /^rec[A-Za-z0-9]{14}$/;
const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
const MAX_FOTO = 3 * 1024 * 1024; // lo que acepta el reporte del día (validarFoto)
const pesos = (n) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })}`;

// ---------- Leer el texto ("350 gasolina", "gasolina $350.50", "gasto 120 hielo") ----------

const PALABRAS_CATEGORIA = [
  [/gasolin|diesel|di[eé]sel|pemex|combustible|magna|premium|gasolinera/i, 'Combustible'],
  [/comida|almuerzo|desayuno|cena|refresco|agua para|taco|lonche|vi[aá]tico|caseta|estacionamiento|uber|taxi/i, 'Brigada'],
  [/sueldo|n[oó]mina|pago a |raya/i, 'Nomina'],
  [/pintura|remodela|material de construcci|cemento|plomer|electricista|alba[ñn]il/i, 'Remodelacion'],
  [/hielo|vaso|servilleta|chamoy|fruta|insumo|desechable|bolsa|tela|mantel|globo|flor|decoraci/i, 'Inventario'],
];
function categoriaDeTexto(texto) {
  const t = String(texto || '');
  const hallada = PALABRAS_CATEGORIA.find(([re]) => re.test(t));
  return hallada ? hallada[1] : 'Otros';
}

// Devuelve { monto, concepto } (monto null si no hay número).
function leerTexto(texto) {
  const limpio = String(texto || '').replace(/\b(gasto|ticket|nota)\b:?/gi, ' ').replace(/\s+/g, ' ').trim();
  const m = /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(limpio);
  const valor = m ? F.monto(m[1]) : null;
  const concepto = (m ? (limpio.slice(0, m.index) + ' ' + limpio.slice(m.index + m[0].length)) : limpio)
    .replace(/\s*\b(pesos|mxn)\b\s*/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { monto: valor, concepto };
}

// ---------- Leer la foto con Claude ----------

const HERRAMIENTA = {
  name: 'datos_ticket',
  description: 'Entrega lo que dice el ticket o nota de compra.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['es_ticket', 'total', 'concepto', 'categoria'],
    properties: {
      es_ticket: { type: 'boolean', description: 'true si la foto es un ticket, nota, factura o recibo de una compra o pago.' },
      total: { type: ['number', 'null'], description: 'TOTAL pagado en pesos (el total final, no subtotales ni cambio). null si no se alcanza a leer.' },
      concepto: { type: ['string', 'null'], description: 'Qué se compró, en 1 a 5 palabras en español (ej. "Gasolina", "Hielo y vasos", "Comida de la brigada"). Si hay nombre del negocio útil, agrégalo (ej. "Gasolina Pemex").' },
      categoria: { type: 'string', enum: F.CATEGORIAS, description: 'Combustible: gasolina o diésel. Inventario: insumos, desechables, material para eventos. Brigada: comida, casetas, estacionamiento, transporte del equipo. Nomina: pagos a personas. Remodelacion: obra o material de construcción. Otros: lo demás.' },
    },
  },
};

function sistema() {
  return 'Lees fotos de tickets de compra para el reporte de gastos de un negocio de eventos en Culiacán (México). '
    + 'Devuelve el TOTAL final pagado en pesos mexicanos, qué se compró en pocas palabras y la categoría. '
    + 'Si la foto no es un ticket o no se alcanza a leer el total, devuelve total null. No inventes montos. '
    + 'Usa siempre la herramienta datos_ticket.';
}

// Devuelve { monto, concepto, categoria } o { error }.
async function leerTicket(foto, pista = '') {
  const respuesta = await llamarClaude({
    model: MODELO,
    max_tokens: 1000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: sistema(),
    tools: [HERRAMIENTA],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: foto.tipo, data: foto.base64 } },
      { type: 'text', text: `Lee este ticket.${pista ? `\nNota de quien lo manda: ${String(pista).slice(0, 300)}` : ''}` },
    ] }],
  });
  const uso = (respuesta.content || []).find(b => b.type === 'tool_use' && b.name === HERRAMIENTA.name);
  if (!uso) return { error: 'No pude leer el ticket.' };
  const d = uso.input || {};
  const valor = F.monto(d.total);
  if (!d.es_ticket && !valor) return { error: 'La foto no parece un ticket.' };
  if (!valor) return { error: 'No alcancé a leer el total.' };
  return { monto: valor, concepto: String(d.concepto || '').trim().slice(0, 120) || 'Gasto', categoria: F.CATEGORIAS.includes(d.categoria) ? d.categoria : 'Otros' };
}

// ---------- Guardar ----------

const fechaHoy = () => F.hoyCuliacan();

// ¿De qué negocio es? (Víctor 2026-11-10). gt:n:<gasto>:<DV|CI|VM><auto>.
const CODIGOS = { DV: 'Divanna Eventos', CI: 'Casa Isabella', VM: 'El Vaso Maiz' };
const ETIQUETAS = { DV: '🪑 Divanna', CI: '🏛️ Casa Isabella', VM: '🌽 El Vaso Maíz' };
function botonesNegocio(id, auto) {
  return [Object.keys(CODIGOS).map(c => ({ texto: ETIQUETAS[c], dato: `gt:n:${id}:${c}${auto ? 1 : 0}` }))];
}

function botonesGasto(id, conEventos, auto, fecha) {
  const filas = [[{ texto: '👛 Lo pagué yo', dato: `gt:p:${id}:${auto ? 1 : 0}` }, { texto: '🗑️ Borrar', dato: `gt:x:${id}:${auto ? 1 : 0}` }]];
  if (conEventos) filas.push([{ texto: '📨 Enviar reporte a Diana', dato: `gt:e:${fecha}` }]);
  return filas;
}

// Guarda el gasto de quien lo manda. Devuelve { texto, botones }.
async function guardarGasto(colaborador, { monto: valor, concepto, categoria }, foto = null) {
  const cat = F.CATEGORIAS.includes(categoria) ? categoria : categoriaDeTexto(concepto);
  const concept = String(concepto || '').trim().slice(0, 120) || 'Gasto';
  if (colaborador.rol === ROLES.ADMIN) {
    const r = await F.agregarGastoAdmin(colaborador, { concepto: concept, monto: valor, categoria: cat, foto });
    if (r.error) return { texto: `⚠️ ${r.error}` };
    return {
      texto: `✅ Anoté ${pesos(valor)} · ${concept} (${cat}) · ${fechaHoy()} · dinero del negocio.${r.avisoFoto ? `\n⚠️ ${r.avisoFoto}` : ''}\n¿De qué negocio es?`,
      botones: botonesNegocio(r.id, false).concat([[{ texto: '🗑️ Borrar', dato: `gt:x:${r.id}:0` }]]),
    };
  }
  const fecha = fechaHoy();
  const r = await F.agregarGasto(colaborador, {
    fecha, concepto: concept, monto: valor, categoria: cat, pagadoCon: 'Dinero del negocio',
    autoNegocio: true, autoEvento: true, foto,
  });
  if (r.error) return { texto: `⚠️ No pude guardar el gasto: ${r.error}` };
  // Primero se confirma el negocio. Sin eventos ese día (no hay cobros ni efectivo
  // que esperar), al confirmarlo el reporte se le manda solo a Diana.
  const texto = [
    `✅ Anoté ${pesos(valor)} · ${concept} (${cat}), pagado con dinero del negocio.`,
    r.avisoFoto ? `⚠️ ${r.avisoFoto}` : null,
    '👉 ¿De qué negocio es? Toca uno.',
    'Si lo pagaste con tu dinero toca 👛 y te lo reembolsan.',
  ].filter(Boolean).join('\n');
  return { texto, botones: botonesNegocio(r.id, !r.conEventos).concat(botonesGasto(r.id, r.conEventos, !r.conEventos, fecha)) };
}

// ---------- Telegram ----------

// ¿Esta foto es un gasto? Para quien no captura comandas, siempre; para Diana,
// Víctor y los gerentes, solo si el pie de foto lo dice.
const esFotoDeGasto = (mensaje, colaborador) => !puedeLeer(colaborador) || /\b(gasto|ticket)s?\b/i.test(String(mensaje.caption || ''));

// La foto más grande que quepa en el reporte (Telegram manda varios tamaños).
function conFotoQueQuepa(mensaje) {
  if (!mensaje.photo || !mensaje.photo.length) return mensaje;
  const caben = mensaje.photo.filter(p => !p.file_size || p.file_size <= MAX_FOTO);
  return { ...mensaje, photo: caben.length ? caben : mensaje.photo.slice(0, 1) };
}

async function atenderFotoGasto(mensaje, colaborador) {
  await telegramApi('sendMessage', { chat_id: mensaje.chat.id, text: '🧾 Leyendo el ticket…' }).catch(() => {});
  let foto;
  try { foto = await descargarFotoTelegram(conFotoQueQuepa(mensaje)); } catch (err) { return { texto: `No pude abrir la foto: ${err.message}` }; }
  if (!foto) return { texto: 'No encontré la foto. Mándala otra vez, por favor.' };
  if (foto.base64.length * 0.75 > MAX_FOTO) return { texto: 'La foto pesa demasiado. Mándala como foto normal (no como archivo).' };
  const pie = leerTexto(mensaje.caption || '');
  let datos;
  if (pie.monto) {
    datos = { monto: pie.monto, concepto: pie.concepto, categoria: categoriaDeTexto(pie.concepto) };
  } else {
    let r;
    try { r = await leerTicket(foto, mensaje.caption || ''); } catch (err) {
      if (err && err.status === 400 && /credit balance is too low/i.test(String(err.message || ''))) throw err; // telegram.js avisa la falta de saldo
      console.error('No se pudo leer el ticket:', err && err.message);
      r = { error: 'No pude leer el ticket en este momento.' };
    }
    if (r.error) return { texto: `${r.error} Mándala otra vez escribiendo el monto en el pie de foto, por ejemplo: 350 gasolina` };
    datos = { ...r, concepto: pie.concepto || r.concepto };
  }
  return guardarGasto(colaborador, datos, foto);
}

// "/gasto 350 gasolina" de quien no es Admin.
async function gastoPorTexto(colaborador, texto) {
  const d = leerTexto(texto);
  if (!d.monto || !d.concepto) return 'Escríbelo así: /gasto 350 gasolina\nO mándame la foto del ticket y yo leo el total.';
  return guardarGasto(colaborador, { monto: d.monto, concepto: d.concepto, categoria: categoriaDeTexto(d.concepto) });
}

// Botones gt:p|x:<gasto>:<auto> y gt:e:<fecha>. Devuelve { aviso, alerta, textoFinal, botones }.
async function botonTicket(colaborador, accion, id, auto) {
  if (accion === 'e') {
    if (!esFecha(id)) return { aviso: '' };
    const r = await F.enviar(colaborador, { fecha: id });
    return r.error ? { aviso: r.error, alerta: true } : { aviso: 'Enviado', textoFinal: '📨 Reporte enviado a Diana.', botones: [] };
  }
  if (accion === 'n') {
    const codigo = String(auto || '').slice(0, 2), sola = String(auto || '').slice(2) === '1';
    if (!ID.test(id || '') || !CODIGOS[codigo]) return { aviso: '' };
    const r = await F.cambiarGasto(colaborador, id, 'negocio', CODIGOS[codigo]);
    if (r.error) return { aviso: r.error, alerta: true };
    let enviado = false;
    if (sola && r.gasto && r.gasto.reporteId && r.gasto.fecha) enviado = !(await F.enviar(colaborador, { fecha: r.gasto.fecha }).catch(err => ({ error: err.message }))).error;
    const quedan = r.gasto && r.gasto.reporteId
      ? botonesGasto(id, !sola, sola, r.gasto.fecha || fechaHoy())
      : [[{ texto: '🗑️ Borrar', dato: `gt:x:${id}:0` }]];
    return { aviso: F.NOMBRE_NEGOCIO[CODIGOS[codigo]], textoFinal: `🏷️ Negocio: ${F.NOMBRE_NEGOCIO[CODIGOS[codigo]]}.${enviado ? ' 📨 Ya le llegó a Diana para revisarlo.' : r.gasto && r.gasto.reporteId && !sola ? ' Va en tu reporte de hoy: al terminar el día envíaselo a Diana.' : ''}`, botones: quedan };
  }
  if (!ID.test(id || '') || !['p', 'x'].includes(accion)) return { aviso: '' };
  const r = await F.cambiarGasto(colaborador, id, accion === 'p' ? 'propio' : 'borrar');
  if (r.error) return { aviso: r.error, alerta: true };
  // Si el reporte se mandó solo (sin eventos), se vuelve a mandar con el cambio.
  let reenviado = false;
  if (auto === '1' && r.gasto && r.gasto.fecha) reenviado = !(await F.enviar(colaborador, { fecha: r.gasto.fecha }).catch(err => ({ error: err.message }))).error;
  if (accion === 'x') return { aviso: 'Borrado', textoFinal: '🗑️ Gasto borrado.', botones: [] };
  return {
    aviso: 'Anotado',
    textoFinal: `👛 Anotado como tu dinero: te lo reembolsan.${reenviado ? ' Diana ya tiene el cambio.' : ''}`,
    botones: [[{ texto: '🗑️ Borrar', dato: `gt:x:${id}:${auto === '1' ? 1 : 0}` }]],
  };
}

// ---------- App ----------

// POST /api/finanzas accion leer_ticket: { foto } → { ok, monto, concepto, categoria }.
async function leerParaApp(colaborador, body) {
  if (!F.puedeReportar(colaborador)) return { error: 'Tu rol no anota gastos en la app.', codigo: 403 };
  const v = F.validarFoto(body.foto);
  if (!v.ok || !v.foto) return { error: v.error || 'Manda la foto del ticket.' };
  try {
    const r = await leerTicket(v.foto);
    return r.error ? { error: `${r.error} Escríbelo a mano.` } : { ok: true, ...r };
  } catch (err) {
    console.error('No se pudo leer el ticket (app):', err && err.message);
    return { error: 'No pude leer el ticket en este momento. Escríbelo a mano.' };
  }
}

module.exports = { botonesNegocio, CODIGOS, leerTexto, categoriaDeTexto, leerTicket, guardarGasto, esFotoDeGasto, atenderFotoGasto, gastoPorTexto, botonTicket, leerParaApp, HERRAMIENTA };
