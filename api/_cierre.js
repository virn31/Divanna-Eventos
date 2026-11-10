// api/_cierre.js
// Cierre de eventos pasados con confirmación de Diana (Víctor 2026-11-10).
// Casi nadie marca "Cerrado" y los eventos que ya pasaron se le seguían
// mostrando al equipo (app y Telegram). Cada mañana (cron de
// api/produccion-diaria.js) DiMa le pregunta SOLO a Diana por los eventos
// autorizados de antes de hoy que siguen abiertos, con un botón por evento
// (ce:s:<evento>) y "Cerrar todos" (ce:t:<fecha>). Al confirmar se marca
// EVENTOS.Estado = Cerrado y el evento deja de salirle al equipo (todas las
// vistas filtran {Estado} != "Cerrado"). El cuadre del dinero no depende del
// Estado, así que cerrar no esconde lo que falte por cobrar. Si Diana no
// contesta, se le vuelve a preguntar al día siguiente.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { enviarTelegram } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS = 'tblzLAin65BZPP2c6';
const ZONA = 'America/Mazatlan';
const ID = /^rec[A-Za-z0-9]{14}$/;
const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
const MAX_BOTONES = 20; // un mensaje legible; los demás salen al día siguiente o con "Cerrar todos"

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

const hoyCuliacan = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso) {
  if (!esFecha(iso)) return 'sin fecha';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

// Fórmula: autorizados, no cancelados, no cerrados y con fecha antes de "antesDe".
function formulaPorCerrar(antesDe) {
  return `AND({Autorizacion_Diana} = "SI", NOT({Cancelado}), {Estado} != "Cerrado", {Fecha_Evento} != "", IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${antesDe}")))`;
}

async function eventosPorCerrar(antesDe = hoyCuliacan()) {
  const registros = [];
  let offset = '';
  do {
    const data = await airtable(`${EVENTOS}?filterByFormula=${encodeURIComponent(formulaPorCerrar(antesDe))}`
      + '&fields%5B%5D=Folio_Evento&fields%5B%5D=Fecha_Evento&fields%5B%5D=Negocio&fields%5B%5D=Ubicacion'
      + `&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc&pageSize=100${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`);
    registros.push(...data.records);
    offset = data.offset || '';
  } while (offset && registros.length < 300);
  return registros.map(r => ({
    id: r.id, folio: r.fields.Folio_Evento || '', fecha: r.fields.Fecha_Evento || '',
    negocio: r.fields.Negocio === 'El Vaso Maiz' ? 'El Vaso Maíz' : r.fields.Negocio === 'Divanna Eventos' ? 'Divanna' : '',
    ubicacion: r.fields.Ubicacion || '',
  }));
}

// Solo Diana (Admin cuyo nombre empieza con "Diana") con Telegram vinculado.
async function dianaConTelegram() {
  const formula = encodeURIComponent(`AND({Activo}, {Rol} = "${ROLES.ADMIN}", {Telegram_Chat_ID} != "")`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
  const r = data.records.find(x => /^diana\b/i.test(String(x.fields.Nombre || '').trim()));
  return r ? { id: r.id, chatId: r.fields.Telegram_Chat_ID } : null;
}

function textoPregunta(lista, total) {
  const renglones = lista.map(e => `• ${e.folio} · ${fechaCorta(e.fecha)}${e.negocio ? ' · ' + e.negocio : ''}${e.ubicacion ? ' · ' + e.ubicacion.slice(0, 40) : ''}`);
  return `🔒 Diana, ${total === 1 ? 'este evento ya pasó y sigue abierto' : `estos ${total} eventos ya pasaron y siguen abiertos`} en la app del equipo:\n\n`
    + renglones.join('\n')
    + (total > lista.length ? `\n…y ${total - lista.length} más.` : '')
    + '\n\n¿Ya se cerraron (recogido y sin pendientes)? Toca los que ya terminaron y dejan de salirle al equipo. El cuadre del dinero no cambia.';
}

function botonesPregunta(lista, antesDe) {
  const filas = [];
  for (let i = 0; i < lista.length; i += 2) {
    filas.push(lista.slice(i, i + 2).map(e => ({ texto: `✅ ${e.folio}`, dato: `ce:s:${e.id}` })));
  }
  filas.push([{ texto: '✅ Cerrar todos', dato: `ce:t:${antesDe}` }, { texto: '⏳ Luego', dato: 'ce:n' }]);
  return filas;
}

// Cron diario: le pregunta a Diana. Devuelve { pendientes, enviado }.
async function preguntarCierres() {
  const hoy = hoyCuliacan();
  const lista = await eventosPorCerrar(hoy);
  if (!lista.length) return { pendientes: 0, enviado: false };
  const diana = await dianaConTelegram();
  if (!diana) { console.error('Cierre de eventos: Diana no tiene Telegram vinculado'); return { pendientes: lista.length, enviado: false }; }
  const visibles = lista.slice(0, MAX_BOTONES);
  const r = await enviarTelegram(diana.chatId, textoPregunta(visibles, lista.length), botonesPregunta(visibles, hoy));
  if (!r.ok) console.error('Cierre de eventos: no se pudo preguntar a Diana', r.status);
  return { pendientes: lista.length, enviado: !!r.ok };
}

async function cerrar(ids) {
  for (let i = 0; i < ids.length; i += 10) {
    await airtable(EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: ids.slice(i, i + 10).map(id => ({ id, fields: { Estado: 'Cerrado' } })) }) });
  }
}

// Quita del teclado los botones de los eventos ya cerrados (callback_data ce:s:<id>).
function tecladoSin(replyMarkup, cerrados) {
  const filas = ((replyMarkup && replyMarkup.inline_keyboard) || [])
    .map(fila => fila.filter(b => !cerrados.some(id => b.callback_data === `ce:s:${id}`)).map(b => ({ texto: b.text, dato: b.callback_data })))
    .filter(fila => fila.length);
  // Si ya no queda ningún evento suelto, se quita también "Cerrar todos".
  return filas.some(f => f.some(b => b.dato.startsWith('ce:s:'))) ? filas : [];
}

// Botones ce:s:<evento> / ce:t:<fecha> / ce:n. Solo Admin (la pregunta solo le llega a Diana).
// Devuelve { aviso, alerta, textoFinal, botones }.
async function botonCierre(colaborador, accion, valor, mensaje) {
  if (!colaborador || colaborador.rol !== ROLES.ADMIN) return { aviso: 'Esto solo lo confirma Diana.', alerta: true };
  if (accion === 'n') return { aviso: 'Te pregunto mañana', textoFinal: '⏳ Te los vuelvo a preguntar mañana.', botones: [] };
  let ids = [];
  let folio = '';
  if (accion === 's' && ID.test(valor || '')) {
    const r = await airtable(`${EVENTOS}/${valor}`);
    folio = r.fields.Folio_Evento || 'El evento';
    if (r.fields.Estado === 'Cerrado') return { aviso: 'Ya estaba cerrado', textoFinal: `✅ ${folio} cerrado.`, botones: tecladoSin(mensaje.reply_markup, [valor]) };
    ids = [valor];
  } else if (accion === 't' && esFecha(valor)) {
    ids = (await eventosPorCerrar(valor)).map(e => e.id);
  } else {
    return { aviso: '' };
  }
  if (!ids.length) return { aviso: 'No quedaba ninguno abierto', textoFinal: '✅ Ya no quedan eventos pasados abiertos.', botones: [] };
  await cerrar(ids);
  if (accion === 't') return { aviso: 'Cerrados', textoFinal: `✅ Cerré ${ids.length === 1 ? '1 evento' : `${ids.length} eventos`}. Ya no le salen al equipo.`, botones: [] };
  return { aviso: 'Cerrado', textoFinal: `✅ ${folio} cerrado.`, botones: tecladoSin(mensaje.reply_markup, ids) };
}

module.exports = { preguntarCierres, botonCierre, eventosPorCerrar, formulaPorCerrar, textoPregunta, botonesPregunta, tecladoSin };
