// api/_correcciones.js
// Correcciones que la gerencia le da a DiMa desde el dashboard ("🧠 Entrenar a
// DiMa"). Se guardan en CORRECCIONES_DIMA y las activas se agregan al final de
// sus instrucciones con prioridad sobre el catálogo: aplican de inmediato en el
// chat de la página. Para quitar una, se desactiva (desde el dashboard o en Airtable).

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLA = 'tbl9D2BnUFIu8PPIe';
const MAX_ACTIVAS = 60;
const MAX_CARACTERES = 1200;
const CACHE_MS = 60 * 1000;

let cache = { hasta: 0, lista: null };

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

// [{ id, instruccion, autor, creada }] de las activas, de la más vieja a la más nueva.
async function correccionesActivas({ sinCache = false } = {}) {
  if (!sinCache && cache.lista && Date.now() < cache.hasta) return cache.lista;
  const data = await airtable(`${TABLA}?filterByFormula=${encodeURIComponent('{Activa}')}&pageSize=100`);
  const lista = (data.records || [])
    .map(r => ({ id: r.id, instruccion: String(r.fields.Instruccion || '').trim(), autor: r.fields.Autor || '', creada: r.createdTime || '' }))
    .filter(c => c.instruccion)
    .sort((a, b) => a.creada.localeCompare(b.creada))
    .slice(-MAX_ACTIVAS);
  cache = { hasta: Date.now() + CACHE_MS, lista };
  return lista;
}

// Para el chat de clientes: si Airtable falla, DiMa sigue con su prompt normal.
async function correccionesParaPrompt() {
  try { return await correccionesActivas(); } catch (err) {
    console.error('No se pudieron leer las correcciones de DiMa:', err.message);
    return cache.lista || [];
  }
}

function textoCorrecciones(lista) {
  if (!lista || !lista.length) return '';
  return 'CORRECCIONES Y REGLAS DE LA GERENCIA (tienen prioridad sobre todo lo anterior, incluido el catálogo; si algo de arriba las contradice, manda la corrección):\n' +
    lista.map(c => `- ${c.instruccion}`).join('\n');
}

// Lo que nunca se guarda como regla (se compara sin acentos). Devuelve el motivo o ''.
const PROHIBIDO = [
  [/ya no eres|deja de ser|ahora eres|ahora te llamas|cambia(te)? (tu|el) nombre|finge ser|hazte pasar|di que eres|no eres dima|olvida (todo|tus|las)|ignora (tus|las|todas)/, 'no se puede cambiar la identidad de DiMa ni sus instrucciones.'],
  [/\b(no|sin) (cobres |cobrar |pidas |pedir )?(el |la |los |las )?(anticipo|deposito|liquidacion|garantia)|(saltate|salta|omite|brincate) (el |la |los |las )?(regla|cobro|pago|anticipo|deposito|liquidacion)|\bclabe\b|cuenta bancaria|numero de (cuenta|tarjeta)|datos de pago/, 'no se pueden saltar las reglas de cobro ni dar datos de pago.'],
  [/(datos|telefonos?|correos?|direcciones?|nombres?|lista|informacion) (personales )?(de|del) (los |las |otros? |otras? |un |una |el |la |cada )*client/, 'no se pueden pedir ni revelar datos de clientes.'],
];
function motivoRechazo(texto) {
  const t = String(texto || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const hallado = PROHIBIDO.find(([patron]) => patron.test(t));
  return hallado ? hallado[1] : '';
}

async function guardarCorreccion(instruccion, autor) {
  const texto = String(instruccion || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CARACTERES);
  if (texto.length < 5) return null;
  // Un doble toque en "Sí" no la guarda dos veces.
  const yaActiva = (await correccionesActivas({ sinCache: true })).find(c => c.instruccion === texto);
  if (yaActiva) return { id: yaActiva.id, instruccion: texto };
  const data = await airtable(TABLA, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: { Instruccion: texto, Activa: true, Autor: String(autor || '').slice(0, 60) } }] }),
  });
  cache = { hasta: 0, lista: null };
  return { id: data.records[0].id, instruccion: texto };
}

async function desactivarCorreccion(id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return false;
  await airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Activa: false } }] }) });
  cache = { hasta: 0, lista: null };
  return true;
}

module.exports = { correccionesActivas, correccionesParaPrompt, textoCorrecciones, guardarCorreccion, desactivarCorreccion, motivoRechazo };
