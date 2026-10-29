// api/_dima-equipo.js
// DiMa como asistente del equipo (no de clientes): contesta dudas de la
// plataforma y de los eventos de quien pregunta. Canal exclusivo de la gerente
// de El Vaso Maíz (COLABORADORES.Gerente_Vaso_Maiz) y de los Admin, desde la app
// ("💬 Pregúntale a DiMa", POST /api/dima-chat con modo "equipo") y desde
// Telegram (cualquier mensaje que no sea comando).
//
// Sabe el manual (api/_instrucciones.js) y los próximos eventos que esa persona
// ve en la app, sin precios ni pagos. No hace cambios: solo explica.
// Límite por persona en memoria de cada instancia (freno básico de costo).

const { Anthropic } = require('@anthropic-ai/sdk');
const { ROLES } = require('./_sesion');
const { alcanceDe, leerEventos } = require('./_eventos');
const { manualTexto } = require('./_instrucciones');
const { historialMensual, historialParaDima } = require('./_finanzas');

const MODELO = 'claude-sonnet-5-5';
const MAX_MENSAJES = 20;
const MAX_CARACTERES = 1500;
const MAX_POR_DIA = 60;

const client = new Anthropic();
const USO = new Map();

function puedeUsarDima(colaborador) {
  return !!colaborador && (colaborador.rol === ROLES.ADMIN || !!colaborador.gerente);
}

function dentroDelLimite(colaboradorId) {
  const ahora = Date.now();
  const usos = (USO.get(colaboradorId) || []).filter(t => ahora - t < 24 * 60 * 60 * 1000);
  if (usos.length >= MAX_POR_DIA) return false;
  usos.push(ahora);
  USO.set(colaboradorId, usos);
  return true;
}

// historial: [{ rol: 'yo' | 'dima', texto }] del más viejo al más nuevo; el
// último debe ser de quien pregunta. Devuelve null si no es válido.
function construirMensajes(historial) {
  if (!Array.isArray(historial) || !historial.length || historial.length > MAX_MENSAJES) return null;
  const mensajes = [];
  for (const h of historial) {
    if (!h || typeof h.texto !== 'string' || !['yo', 'dima'].includes(h.rol)) return null;
    const texto = h.texto.trim().slice(0, MAX_CARACTERES);
    if (!texto) continue;
    const role = h.rol === 'yo' ? 'user' : 'assistant';
    if (mensajes.length && mensajes[mensajes.length - 1].role === role) mensajes[mensajes.length - 1].content += '\n' + texto;
    else mensajes.push({ role, content: texto });
  }
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return null;
  return mensajes;
}

function resumenEventos(eventos) {
  if (!eventos.length) return 'No tiene eventos próximos en la app.';
  return eventos.slice(0, 15).map(ev => [
    `${ev.folio} · ${ev.fecha || 'sin fecha'}${ev.horaInicio ? ' ' + ev.horaInicio : ''} · ${ev.negocio || ''} · ${ev.ubicacion || 'ubicación por confirmar'}`,
    `  estatus: ${ev.estatusLogistico}${ev.personalRequerido ? ` · personas: ${ev.personalRequerido}` : ''}${ev.enteradoPor ? ` · enterado: ${ev.enteradoPor}` : ' · sin confirmar'}`,
    ev.servicios ? `  pide: ${ev.servicios.slice(0, 200)}` : '',
    ev.instrucciones ? `  instrucciones: ${ev.instrucciones.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n')).join('\n');
}

async function sistemaPara(colaborador, coordina) {
  let eventos = [];
  try {
    const { eventoIds } = await alcanceDe(colaborador);
    eventos = await leerEventos(eventoIds);
  } catch (err) {
    console.error('DiMa equipo: no se pudieron leer los eventos:', err.message);
  }
  const puesto = colaborador.gerente ? 'gerente de El Vaso Maíz' : colaborador.rol === ROLES.ADMIN ? 'dueño(a) del negocio (Admin)' : colaborador.rol;
  const esAdmin = colaborador.rol === ROLES.ADMIN;
  // Solo a Diana y Víctor: historial de dinero por mes y por empresa.
  let finanzas = '';
  if (esAdmin) {
    try {
      finanzas = historialParaDima(await historialMensual());
    } catch (err) {
      console.error('DiMa equipo: no se pudo leer el historial:', err.message);
      finanzas = 'NO SE PUDO LEER el historial de dinero en este momento: si te piden un balance, di que no pudiste leerlo y que lo intenten en un rato. No des cifras.';
    }
  }
  return [
    'Eres DiMa, la asistente interna del equipo de Divanna Eventos y El Vaso Maíz (Culiacán). ' +
    `Hablas con ${colaborador.nombre || 'alguien del equipo'}, ${puesto}. Tu trabajo es que domine la plataforma: ` +
    'la app DiMa Equipo, el bot de Telegram @dimaclnbot y cómo se organizan los eventos.',
    'Reglas:\n' +
    '- Contesta en español, cálido y directo, en pocas líneas. Texto simple, sin markdown (sin asteriscos ni #); puedes usar viñetas con "•".\n' +
    '- Usa solo el manual y los eventos de abajo. Si algo no está ahí, dilo y sugiere escribirles a Diana y Víctor con /mensaje. No inventes botones ni funciones.\n' +
    '- No puedes hacer cambios (asignar, confirmar, invitar): explica dónde y cómo se hacen.\n' +
    (esAdmin
      ? '- Con esta persona SÍ puedes hablar de dinero, usando solo el HISTORIAL POR MES de abajo. Si te pide un balance o las mejores temporadas, compara las dos empresas mes por mes y di cuáles son sus mejores meses (por ingresos y por número de eventos). Di siempre cuántos meses de datos hay: con menos de 12 meses no afirmes que es una temporada que se repite cada año, di que es lo que se ve hasta ahora. Aclara que "ingresos contratados" es lo pactado en eventos autorizados, no lo cobrado. No inventes cifras ni meses que no estén abajo.\n'
      : '- No hablas de precios, pagos ni montos de los pedidos; eso lo llevan Diana y Víctor.\n') +
    '- Cuando ayude, propón el siguiente paso concreto o una práctica corta para que aprenda haciéndolo.',
    `MANUAL DE LA PLATAFORMA (lo que le toca a esta persona):\n${manualTexto(colaborador, coordina)}`,
    `SUS PRÓXIMOS EVENTOS (lo que ve en la app hoy):\n${resumenEventos(eventos)}`,
    ...(esAdmin ? [`HISTORIAL POR MES DE LAS DOS EMPRESAS:\n${finanzas}`] : []),
  ].join('\n\n');
}

// Devuelve el texto de DiMa. Lanza error si falla la API.
async function preguntarDima(colaborador, historial, { coordina = false } = {}) {
  const mensajes = construirMensajes(historial);
  if (!mensajes) return { error: 'mensaje' };
  if (!dentroDelLimite(colaborador.id)) {
    return { texto: 'Por hoy ya platicamos mucho 😊. Mañana seguimos; si es urgente, escríbeles a Diana y Víctor con /mensaje.' };
  }
  const respuesta = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 1500,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: await sistemaPara(colaborador, coordina),
    messages: mensajes,
  });
  if (respuesta.stop_reason === 'refusal') return { texto: 'Perdona, con eso no te puedo ayudar. Pregúntame de la plataforma o de tus eventos.' };
  const texto = (respuesta.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { texto: texto || 'No te entendí bien, ¿me lo dices de otra forma?' };
}

module.exports = { puedeUsarDima, preguntarDima };
