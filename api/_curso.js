// api/_curso.js
// Capacitación por Telegram (/curso): lecciones cortas en orden, cada una con
// una práctica y una pregunta de opción múltiple (botones cu:r:<lección>:<opción>).
// Al acertar se guarda el avance en COLABORADORES.Curso_Avance, se avisa a los
// Admin y llega la siguiente lección. Las lecciones dependen del rol (/staff
// solo a quien coordina, "Gerente" solo a la gerente). El staff no toma el curso.
// Admin: /curso muestra el avance de cada quien y un botón para mandarle su
// lección (cu:inv:<colaborador>).

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { enviarTelegram, enviarTelegramEquipo } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const URL_APP = 'https://divanna-eventos.vercel.app/brigadas/';

const LECCIONES = [
  {
    id: 'app',
    titulo: 'La app DiMa Equipo',
    texto:
      `La app (${URL_APP}) es donde operas cada evento. Se instala desde Chrome con "Instalar app" y entras con tu usuario y PIN, los mismos de este bot.\n\n` +
      'Lo primero al entrar: tocar "Activar alertas" y "Permitir", para que te suenen las emergencias aunque tengas la app cerrada.',
    practica: 'Abre la app, entra y toca "Activar alertas".',
    pregunta: '¿Para qué sirve "Activar alertas"?',
    opciones: ['Para que suenen las emergencias con la app cerrada', 'Para ver los precios de los pedidos', 'Para invitar a las chicas'],
    correcta: 0,
    explicacion: 'Activar alertas hace que el teléfono suene con las emergencias del equipo aunque la app esté cerrada.',
  },
  {
    id: 'eventos',
    titulo: 'Tus eventos',
    texto:
      'Cuando te asignan un evento te llega un Telegram con "✅ Confirmar". Confírmalo siempre: así Diana y Víctor saben que lo viste (en la app es "👍 Enterado").\n\n' +
      'En la app cada evento tiene instrucciones, el checklist de carga (marcas cada cosa al subirla; sin todo marcado no puedes "Salir del almacén") y el estatus, que vas cambiando: salida, llegada, montaje, recolección.',
    practica: 'Escribe /eventos y revisa cuáles tienes. Si alguno no está confirmado, confírmalo.',
    pregunta: '¿Qué haces primero cuando te asignan un evento?',
    opciones: ['Tocar "Confirmar" o "Enterado"', 'Esperar a que Diana te llame', 'Cambiar el estatus a montaje'],
    correcta: 0,
    explicacion: 'Lo primero es confirmar con "✅ Confirmar" en Telegram o "👍 Enterado" en la app.',
  },
  {
    id: 'alertas',
    titulo: 'Alertas',
    texto:
      'Cada evento en la app tiene tres botones:\n' +
      '🚦 Retraso: tráfico o un cambio de hora; queda anotado para Diana y Víctor.\n' +
      '🆘 Emergencia: choque, falla, accidente; le suena a todo el equipo con tu ubicación.\n' +
      '⚠️ Seguridad: una zona peligrosa; avisa al equipo y la app te da el mensaje para el cliente.\n\n' +
      'Para quitar una alerta vuelves a tocar el mismo botón.',
    practica: 'Abre un evento en la app y ubica los tres botones (no los toques).',
    pregunta: 'Hay un choque camino al evento. ¿Qué botón usas?',
    opciones: ['🚦 Retraso', '🆘 Emergencia', '⚠️ Seguridad'],
    correcta: 1,
    explicacion: 'Un choque es 🆘 Emergencia: le suena a todo el equipo con tu ubicación.',
  },
  {
    id: 'gerente',
    solo: 'gerente',
    titulo: 'Tu papel de gerente',
    texto:
      'Como gerente de El Vaso Maíz ves en la app TODOS los eventos autorizados de El Vaso Maíz, aunque no te los asignen.\n\n' +
      'En cada uno tienes "👷 Asignar": eliges brigada y encargada y tocas "Guardar y avisar". A ellas les llega el aviso para confirmar y a Diana y Víctor les aviso qué asignaste. Los precios y pagos los siguen llevando ellos.',
    practica: 'En la app abre un evento de El Vaso Maíz y busca "👷 Asignar".',
    pregunta: '¿Dónde asignas la encargada de un evento de El Vaso Maíz?',
    opciones: ['En la app, en "👷 Asignar" del evento', 'En Airtable', 'Pidiéndoselo a DiMa'],
    correcta: 0,
    explicacion: 'Se asigna en la app, en "👷 Asignar" de cada evento de El Vaso Maíz.',
  },
  {
    id: 'staff',
    solo: 'coordina',
    titulo: 'Tu staff con /staff',
    texto:
      'Las chicas solo usan Telegram. Para darlas de alta: /staff → "➕ Agregar personal" → nombre y teléfono. Te doy un enlace y se lo mandas; ella lo toca y le da "Iniciar".\n\n' +
      'Para un evento: /staff → "📋 Asignar a evento" → eliges el evento, tocas los nombres y "📨 Invitar". Les llega "Sí puedo / No puedo" y sus respuestas te llegan a ti.',
    practica: 'Escribe /staff y entra a "📋 Asignar a evento" para ver la lista (no tienes que invitar a nadie todavía).',
    pregunta: '¿Qué tiene que hacer una chica nueva para recibir invitaciones?',
    opciones: ['Tocar su enlace y darle "Iniciar"', 'Descargar la app', 'Mandarte su PIN'],
    correcta: 0,
    explicacion: 'Solo toca su enlace personal y le da "Iniciar" en Telegram; sin eso el bot no le puede escribir.',
  },
  {
    id: 'ayuda',
    titulo: 'Ayuda: DiMa y mensajes',
    texto: (c) =>
      (c.gerente || c.rol === ROLES.ADMIN
        ? 'DiMa es tu asistente: escríbele aquí sin comando o en la app con "💬 Pregúntale a DiMa", y te explica lo que necesites de la plataforma o de tus eventos.\n\n'
        : '') +
      'Para escribirles directo a Diana y Víctor usa /mensaje con tu texto. Les llega con un botón para contestarte y su respuesta te llega aquí.\n\n' +
      '/instrucciones te da el manual por temas cuando lo necesites.',
    practica: (c) => (c.gerente || c.rol === ROLES.ADMIN
      ? 'Hazle una pregunta a DiMa, por ejemplo: "¿Cómo invito a las chicas a un evento?"'
      : 'Escribe /instrucciones y abre un tema.'),
    pregunta: '¿Cómo les mandas un mensaje directo a Diana y Víctor?',
    opciones: ['Con /mensaje en Telegram', 'Con el botón 🆘 Emergencia', 'No se puede'],
    correcta: 0,
    explicacion: 'Con /mensaje y tu texto, por ejemplo: /mensaje Mañana llego 10 minutos tarde.',
  },
];

function leccionesDe(colaborador, coordina) {
  return LECCIONES.filter(l => !l.solo || (l.solo === 'gerente' ? colaborador.gerente : coordina));
}

function valor(v, colaborador) {
  return typeof v === 'function' ? v(colaborador) : v;
}

function mensajeLeccion(colaborador, lecciones, i) {
  const l = lecciones[i];
  return {
    texto: `🎓 Lección ${i + 1} de ${lecciones.length}: ${l.titulo}\n\n${valor(l.texto, colaborador)}\n\n` +
      `✍️ Práctica: ${valor(l.practica, colaborador)}\n\n❓ ${l.pregunta}`,
    botones: l.opciones.map((o, k) => [{ texto: o, dato: `cu:r:${i}:${k}` }]),
  };
}

function mensajeFinal(lecciones) {
  return `🎓 ¡Terminaste el curso! Pasaste las ${lecciones.length} lecciones. ` +
    'Cuando tengas una duda, /instrucciones tiene el manual y /mensaje te comunica con Diana y Víctor.';
}

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

// /curso de quien no es Admin: su lección actual (o el aviso de que ya terminó).
function cursoDe(colaborador, coordina) {
  const lecciones = leccionesDe(colaborador, coordina);
  const i = Math.min(colaborador.cursoAvance || 0, lecciones.length);
  if (i >= lecciones.length) return mensajeFinal(lecciones);
  return mensajeLeccion(colaborador, lecciones, i);
}

// Respuesta a una pregunta (cu:r:<i>:<k>). Devuelve { aviso, alerta, siguiente }.
async function responderCurso(colaborador, coordina, i, k) {
  const lecciones = leccionesDe(colaborador, coordina);
  const actual = Math.min(colaborador.cursoAvance || 0, lecciones.length);
  const l = lecciones[i];
  if (!l || i !== actual) return { aviso: i < actual ? 'Esa lección ya la pasaste. Escribe /curso para seguir.' : 'Escribe /curso para ver tu lección.', alerta: true };
  if (k !== l.correcta) {
    return { aviso: `Casi. ${l.explicacion} Intenta otra vez.`, alerta: true };
  }
  await airtable(COLABORADORES_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: colaborador.id, fields: { Curso_Avance: i + 1 } }] }),
  });
  await enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🎓 ${colaborador.nombre} pasó la lección ${i + 1} de ${lecciones.length}: ${l.titulo}.` +
      (i + 1 === lecciones.length ? ' ¡Terminó el curso!' : ''),
  }).catch(err => console.error('Error avisando avance del curso:', err));
  const siguiente = i + 1 < lecciones.length
    ? mensajeLeccion(colaborador, lecciones, i + 1)
    : { texto: mensajeFinal(lecciones) };
  return { aviso: `✅ ¡Correcto! ${l.explicacion}`, siguiente };
}

function aColab(r) {
  return {
    id: r.id,
    nombre: r.fields.Nombre || '',
    rol: r.fields.Rol || '',
    gerente: !!r.fields.Gerente_Vaso_Maiz,
    coordina: !!r.fields.Coordina_Staff,
    cursoAvance: Number(r.fields.Curso_Avance) || 0,
    chatId: r.fields.Telegram_Chat_ID || '',
  };
}

// /curso de un Admin: avance de cada quien y botón para mandarle su lección.
async function avanceEquipo() {
  const formula = encodeURIComponent(`AND({Activo}, {Rol} != "${ROLES.ADMIN}", {Rol} != "${ROLES.STAFF}")`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
  const personas = data.records.map(aColab);
  if (!personas.length) return 'No hay nadie del equipo para capacitar todavía.';
  const lineas = personas.map(p => {
    const total = leccionesDe(p, p.coordina).length;
    return `${Math.min(p.cursoAvance, total) >= total ? '🎓' : '📘'} ${p.nombre}: ${Math.min(p.cursoAvance, total)} de ${total}${p.chatId ? '' : ' (sin Telegram)'}`;
  });
  return {
    texto: `Capacitación del equipo (/curso):\n\n${lineas.join('\n')}\n\nToca a alguien para mandarle su lección.`,
    botones: personas.filter(p => p.chatId).map(p => [{ texto: `📨 ${p.nombre}`, dato: `cu:inv:${p.id}` }]),
  };
}

// Un Admin le manda a alguien su lección actual. Devuelve el texto para el Admin.
async function invitarAlCurso(colaboradorId, admin) {
  const p = aColab(await airtable(`${COLABORADORES_TABLE}/${colaboradorId}`));
  if (!p.chatId) return `${p.nombre} no ha vinculado su Telegram.`;
  const lecciones = leccionesDe(p, p.coordina);
  const intro = `👋 Hola ${p.nombre.split(' ')[0]}, ${admin.nombre} te pidió tomar tu capacitación. Son ${lecciones.length} lecciones cortas; contesta con los botones.`;
  await enviarTelegram(p.chatId, intro);
  const m = cursoDe(p, p.coordina);
  const r = typeof m === 'string' ? await enviarTelegram(p.chatId, m) : await enviarTelegram(p.chatId, m.texto, m.botones);
  return r.ok ? `Listo, le mandé a ${p.nombre} su lección.` : `No le pude escribir a ${p.nombre} (${(r.data && r.data.description) || 'error ' + r.status}).`;
}

module.exports = { cursoDe, responderCurso, avanceEquipo, invitarAlCurso, leccionesDe };
