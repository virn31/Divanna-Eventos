// api/_danos.js
// /daño por Telegram (decisión de Víctor, 2026-10-30): al recoger, el líder, la
// encargada, la gerente o Diana y Víctor le escriben a DiMa qué se rompió o
// faltó ("/daño EVT-123 se rompieron 3 copas globo y un mantel quedó manchado").
// DiMa reconoce el evento y los artículos de INVENTARIO y calcula con
// Precio_Reposicion: perdido o inservible al 100%, daño menor al 10%
// (api/_cargos.js). Contesta con el desglose y los botones ✅ Registrar /
// ❌ Cancelar (dn:s|x:<evento>:<lote>): hasta confirmar, el borrador vive en
// EVENTOS.Cargos_Extra como pendiente y no suma al total.

const { Anthropic } = require('@anthropic-ai/sdk');
const { alcanceDe, leerEventos } = require('./_eventos');
const { veDinero, inventarioParaCargos, proponerLote, textoLote, cerrarLote } = require('./_cargos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS_TABLE = 'tblzLAin65BZPP2c6';
const MODELO = 'claude-sonnet-5-5';
const DIAS_ATRAS = 5;   // eventos de los últimos días (se recoge después del evento)

const client = new Anthropic();

async function airtable(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

const hoyCuliacan = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
function diasDesde(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const AYUDA = 'Escríbeme qué se rompió o faltó, en el mismo mensaje:\n/daño EVT-123 se rompieron 3 copas globo y un mantel quedó manchado\n\n' +
  'Lo perdido o roto se cobra completo y el daño menor (mancha, rayón) al 10% del precio de reposición. Te muestro la cuenta antes de registrarla.';

// Eventos que puede reportar: los suyos de los últimos días y mañana, más el
// folio que escribió aunque no esté en esa lista (se revisa que sea suyo al guardar).
async function eventosCandidatos(colaborador, texto) {
  const { eventoIds } = await alcanceDe(colaborador);
  const hoy = hoyCuliacan();
  const lista = (await leerEventos(eventoIds)).filter(ev => ev.fecha && ev.fecha >= diasDesde(hoy, -DIAS_ATRAS) && ev.fecha <= diasDesde(hoy, 1));
  const escrito = (/EVT-\d+/i.exec(texto) || [])[0];
  if (escrito && !lista.some(ev => ev.folio.toUpperCase() === escrito.toUpperCase())) {
    const d = await airtable(`${EVENTOS_TABLE}?filterByFormula=${encodeURIComponent(`{Folio_Evento} = "${escrito.toUpperCase()}"`)}&maxRecords=1`);
    const r = (d.records || [])[0];
    if (r) lista.push({ id: r.id, folio: r.fields.Folio_Evento, fecha: r.fields.Fecha_Evento || '', negocio: r.fields.Negocio || '', ubicacion: r.fields.Ubicacion || '' });
  }
  return lista;
}

function herramienta(eventos, inventario) {
  return {
    name: 'anotar_danos',
    description: 'Entrega los daños y faltantes que reporta el equipo, acomodados por artículo de inventario.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        folio: { type: 'string', enum: [...eventos.map(ev => ev.folio), 'no_se'], description: 'Folio del evento; "no_se" si no lo dijo y hay más de uno posible.' },
        renglones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              articulo: { type: 'string', enum: [...inventario.map(a => a.id), 'otro'], description: 'ID del artículo de INVENTARIO; "otro" si no está en la lista.' },
              descripcion: { type: 'string', description: 'Qué es, en pocas palabras (ej. "Copa globo", "Tapete").' },
              cantidad: { type: 'integer' },
              gravedad: { type: 'string', enum: ['perdido', 'menor'], description: '"perdido" si se rompió, se perdió, faltó o ya no sirve; "menor" si se puede limpiar o reparar (mancha, rayón, despostillado leve).' },
              nota: { type: ['string', 'null'], description: 'Detalle útil (ej. "mancha de vino", "pata quebrada").' },
            },
            required: ['articulo', 'descripcion', 'cantidad', 'gravedad', 'nota'],
            additionalProperties: false,
          },
        },
        duda: { type: ['string', 'null'], description: 'Si falta algo para calcular (qué evento, cuántas piezas, qué artículo exacto), la pregunta corta; si no, null.' },
      },
      required: ['folio', 'renglones', 'duda'],
      additionalProperties: false,
    },
  };
}

function sistema(eventos, inventario) {
  return `Eres DiMa, la asistente interna de Divanna Eventos (mobiliario y decoración) y El Vaso Maíz, en Culiacán. Alguien del equipo te reporta daños o faltantes de un evento. Acomódalos con la herramienta anotar_danos; siempre úsala.
- Cada renglón es un artículo de INVENTARIO con su cantidad. Elige el artículo exacto (modelo y color) si se puede saber; si hay varios parecidos y no se sabe cuál, elige el más común y dilo en la nota. Si no está en la lista, usa "otro" con su descripción.
- Gravedad: "perdido" si se rompió, se perdió, faltó o ya no sirve; "menor" si se puede limpiar o reparar.
- Si no dice cuántas piezas, es 1. Si no puedes saber qué artículo o de qué evento es, pon la pregunta en "duda".
- Tú no calculas montos: el sistema los saca del precio de reposición.

EVENTOS QUE PUEDE REPORTAR:
${eventos.map(ev => `- ${ev.folio} · ${ev.fecha} · ${ev.negocio} · ${ev.ubicacion || ''}`).join('\n') || '(ninguno)'}

INVENTARIO (id: artículo · categoría):
${inventario.map(a => `- ${a.id}: ${a.nombre} · ${a.categoria}`).join('\n') || '(no se pudo leer)'}`;
}

// Respuesta al comando: texto, o { texto, botones } con el borrador.
async function reportarDanos(colaborador, texto) {
  if (!veDinero(colaborador)) return 'Los daños los anotan el líder de la brigada, la encargada, la gerente o Diana y Víctor.';
  const descripcion = String(texto || '').trim();
  if (descripcion.length < 3) return AYUDA;
  if (descripcion.length > 1500) return 'Es mucho texto: mándamelo en partes, un evento por mensaje.';

  const [eventos, inventario] = await Promise.all([
    eventosCandidatos(colaborador, descripcion),
    inventarioParaCargos().catch(err => { console.error('Daños: no se pudo leer el inventario:', err.message); return []; }),
  ]);
  if (!eventos.length) return `No encuentro eventos tuyos de los últimos ${DIAS_ATRAS} días. Escribe el folio: /daño EVT-123 …`;

  const respuesta = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: sistema(eventos, inventario),
    tools: [herramienta(eventos, inventario)],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: descripcion }],
  });
  const uso = (respuesta.content || []).find(b => b.type === 'tool_use' && b.name === 'anotar_danos');
  if (!uso) {
    const t = (respuesta.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return t || AYUDA;
  }
  const d = uso.input;
  let evento = eventos.find(ev => ev.folio === d.folio);
  if (!evento && eventos.length === 1) evento = eventos[0];
  if (!evento) return `¿De qué evento es? Vuelve a mandarlo con el folio:\n/daño EVT-… ${descripcion.replace(/^\/da(ñ|n)o\s*/i, '')}\n\nTus eventos de estos días: ${eventos.map(ev => ev.folio).join(', ')}`;
  if (!d.renglones.length) return d.duda || AYUDA;

  const porId = new Map(inventario.map(a => [a.id, a]));
  const renglones = d.renglones.map(r => ({ articulo: porId.get(r.articulo) || null, descripcion: r.descripcion, cantidad: r.cantidad, gravedad: r.gravedad, nota: r.nota }));
  const registro = await airtable(`${EVENTOS_TABLE}/${evento.id}`);
  const lote = await proponerLote(colaborador, registro, renglones);
  if (lote.error) return lote.error;
  return {
    texto: `🧾 Daños y faltantes de ${evento.folio}:\n${textoLote(evento.folio, lote.cargos)}${d.duda ? `\n\n❓ ${d.duda}` : ''}\n\n¿Lo registro y lo sumo a lo que debe el cliente? Si algo está mal, cancela y vuelve a escribirlo.`,
    botones: [[{ texto: '✅ Registrar', dato: `dn:s:${registro.id}:${lote.lote}` }, { texto: '❌ Cancelar', dato: `dn:x:${registro.id}:${lote.lote}` }]],
  };
}

// Botones del borrador. Devuelve { aviso, alerta?, textoFinal? }.
async function botonDanos(colaborador, accion, eventoId, lote) {
  if (accion !== 's' && accion !== 'x') return { aviso: '' };
  return cerrarLote(colaborador, eventoId, lote, accion === 's');
}

module.exports = { reportarDanos, botonDanos };
