// api/_limites.js
// Límites de la página pública contra abuso (Víctor 2026-11-11, seguridad de la
// página donde el cliente cotiza). Se guardan en Airtable (LIMITES_WEB) para que
// valgan en todas las instancias de Vercel; el límite en memoria de dima-chat.js
// sigue como primer freno.
// - Chat de DiMa: mensajes por conexión al día y un tope total al día (protege el
//   saldo de Claude aunque cambien de conexión). MODO MEDICIÓN (Víctor
//   2026-11-11): por ~2 meses solo se cuenta, no se bloquea, para medir el
//   tráfico real antes de fijar topes y el límite de gasto de Anthropic. Las
//   cifras de ayer salen en el buenos días de las 8:00 (api/_cuadre.js). Para
//   activar los topes: CONFIG.bloquearChat = true (y ajustar max con lo medido).
// - Pedidos nuevos (chat y formulario): por teléfono y por conexión al día.
// - "¿Ya tienes número de pedido?": intentos FALLIDOS por teléfono y por conexión
//   en una hora; al llegar al tope se bloquea y se avisa a Diana y Víctor.
// La Clave guarda una huella HMAC (con SESSION_SECRET), nunca la IP ni el teléfono.
// Si Airtable falla, se deja pasar (no se le cierra la puerta a un cliente real)
// y se anota en los registros.

const crypto = require('crypto');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLA = 'tblhWEpjaizM0qUtO';
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const ZONA = 'America/Mazatlan';

// Interruptor del chat: false = modo medición (cuenta y no bloquea).
const CONFIG = { bloquearChat: false };

// Topes holgados: en Culiacán muchos teléfonos salen a internet con la misma IP
// de la compañía (Telcel, AT&T), así que por conexión se deja bastante margen.
const REGLAS = {
  // Chat: por día del calendario (así se reporta "ayer"). Topes provisionales.
  chatIp: { tipo: 'dia-chat-ip', dia: true, max: 300, bloquea: () => CONFIG.bloquearChat },
  chatTotal: { tipo: 'dia-chat', dia: true, max: 2500, bloquea: () => CONFIG.bloquearChat },
  // Solo para medir (nunca bloquean).
  conversaciones: { tipo: 'dia-conv', dia: true, max: Infinity },
  pedidosDia: { tipo: 'dia-pedido', dia: true, max: Infinity },
  pedidoTel: { tipo: 'pedido-tel', max: 3, ventanaMs: DIA },
  pedidoIp: { tipo: 'pedido-ip', max: 8, ventanaMs: DIA },
  verifTel: { tipo: 'verif-tel', max: 5, ventanaMs: HORA },
  verifIp: { tipo: 'verif-ip', max: 10, ventanaMs: HORA },
};

const MENSAJES = {
  chat: 'Por hoy ya no puedo seguir platicando desde esta conexión. Déjanos tus datos en el formulario de abajo y te llamamos para terminar tu cotización.',
  chatTotal: 'En este momento DiMa está atendiendo a muchas personas. Déjanos tus datos en el formulario de abajo y te llamamos para tu cotización.',
  pedido: 'Ya recibimos varios pedidos desde este teléfono o conexión hoy. Si necesitas otro, escríbenos mañana o espera la llamada de nuestro equipo.',
  verif: 'Por seguridad pausamos la búsqueda de pedidos por un rato (hubo varios intentos que no coincidieron). Intenta en una hora, o espera la llamada de nuestro equipo.',
};

const fechaCuliacan = (dias = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(Date.now() + dias * DIA));

// Clave: tipo + (fecha, en las reglas por día) + huella HMAC del valor.
function huella(tipo, valor, fecha = null) {
  const secreto = process.env.SESSION_SECRET || 'sin-secreto';
  return `${tipo}:${fecha ? fecha + ':' : ''}${crypto.createHmac('sha256', secreto).update(`${tipo}|${valor}`).digest('hex').slice(0, 24)}`;
}

// IP del cliente según Vercel (la primera de x-forwarded-for).
const ipDe = (req) => String((req.headers || {})['x-forwarded-for'] || '').split(',')[0].trim() || 'sin-ip';
const telefonoDe = (t) => String(t || '').replace(/\D/g, '').slice(-10);

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function leer(clave) {
  // La clave solo lleva letras, números, "-" y ":" (huella hex), así que es segura en la fórmula.
  const d = await airtable(`${TABLA}?filterByFormula=${encodeURIComponent(`{Clave} = "${clave}"`)}&maxRecords=1`);
  return (d.records || [])[0] || null;
}

// Estado vigente de una regla: { conteo, registro } (conteo 0 si la ventana ya pasó).
async function estado(regla, valor) {
  const clave = huella(regla.tipo, valor, regla.dia ? fechaCuliacan() : null);
  const r = await leer(clave);
  // Las reglas por día tienen su propia clave cada día; las demás, una ventana.
  const vigente = !!r && (regla.dia || Date.now() - Number(r.fields.Desde || 0) < regla.ventanaMs);
  return { clave, registro: r, conteo: vigente ? Number(r.fields.Conteo || 0) : 0, vigente };
}

async function sumarA(e) {
  const ahora = Date.now();
  if (e.registro) {
    const fields = e.vigente ? { Conteo: e.conteo + 1 } : { Conteo: 1, Desde: ahora, Avisado: false };
    await airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id: e.registro.id, fields }] }) });
  } else {
    await airtable(TABLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: { Clave: e.clave, Conteo: 1, Desde: ahora } }] }) });
    if (Math.random() < 0.05) limpiar().catch(err => console.error('Límites: no se pudo limpiar:', err.message));
  }
  return e.conteo + 1;
}

// Borra contadores viejos (más de 2 días) para que la tabla no crezca.
async function limpiar() {
  const viejo = Date.now() - 2 * DIA;
  const d = await airtable(`${TABLA}?filterByFormula=${encodeURIComponent(`{Desde} < ${viejo}`)}&maxRecords=10&fields%5B%5D=Clave`);
  const ids = (d.records || []).map(r => r.id);
  if (ids.length) await airtable(`${TABLA}?${ids.map(id => `records%5B%5D=${id}`).join('&')}`, { method: 'DELETE' });
}

// Cuenta un uso si hay cupo. Devuelve true si se permite. Varias reglas a la vez:
// se permite solo si todas tienen cupo, y entonces se suman todas.
async function consumir(pares) {
  try {
    const estados = await Promise.all(pares.map(([regla, valor]) => estado(regla, valor).then(e => ({ ...e, regla }))));
    const agotada = estados.find(e => e.conteo >= e.regla.max && (!e.regla.bloquea || e.regla.bloquea()));
    if (agotada) return { permitido: false, regla: agotada.regla.tipo };
    await Promise.all(estados.map(sumarA));
    return { permitido: true };
  } catch (err) {
    console.error('Límites: no se pudieron revisar (se deja pasar):', err.message);
    return { permitido: true, error: true };
  }
}

// ¿Ya se agotaron los intentos fallidos? (sin contar este).
async function bloqueado(pares) {
  try {
    const estados = await Promise.all(pares.map(([regla, valor]) => estado(regla, valor).then(e => ({ ...e, regla }))));
    return estados.some(e => e.conteo >= e.regla.max);
  } catch (err) {
    console.error('Límites: no se pudieron revisar (se deja pasar):', err.message);
    return false;
  }
}

// Anota un intento fallido. Devuelve las reglas que acaban de llegar al tope y
// que no se habían avisado (para avisar una sola vez a Diana y Víctor).
async function fallo(pares) {
  try {
    const estados = await Promise.all(pares.map(([regla, valor]) => estado(regla, valor).then(e => ({ ...e, regla }))));
    const nuevos = [];
    for (const e of estados) {
      const n = await sumarA(e);
      if (n >= e.regla.max && !(e.vigente && e.registro && e.registro.fields.Avisado)) {
        nuevos.push(e.regla.tipo);
        const r = await leer(e.clave);
        if (r) await airtable(TABLA, { method: 'PATCH', body: JSON.stringify({ records: [{ id: r.id, fields: { Avisado: true } }] }) });
      }
    }
    return nuevos;
  } catch (err) {
    console.error('Límites: no se pudo anotar el intento fallido:', err.message);
    return [];
  }
}

// Cifras de un día (para el buenos días): mensajes y conversaciones del chat,
// pedidos nuevos de la página, la conexión con más mensajes y cuántas habrían
// llegado al tope por conexión. null si no se pudo leer.
async function estadisticasDia(fecha = fechaCuliacan(-1)) {
  try {
    const conteo = async (regla) => { const r = await leer(huella(regla.tipo, 'total', fecha)); return r ? Number(r.fields.Conteo || 0) : 0; };
    const prefijo = `${REGLAS.chatIp.tipo}:${fecha}:`;
    const [mensajes, conversaciones, pedidos, pico, topadas] = await Promise.all([
      conteo(REGLAS.chatTotal), conteo(REGLAS.conversaciones), conteo(REGLAS.pedidosDia),
      airtable(`${TABLA}?filterByFormula=${encodeURIComponent(`FIND("${prefijo}", {Clave}) = 1`)}&sort%5B0%5D%5Bfield%5D=Conteo&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1&fields%5B%5D=Conteo`),
      airtable(`${TABLA}?filterByFormula=${encodeURIComponent(`AND(FIND("${prefijo}", {Clave}) = 1, {Conteo} >= ${REGLAS.chatIp.max})`)}&fields%5B%5D=Conteo&pageSize=100`),
    ]);
    return { fecha, mensajes, conversaciones, pedidos, pico: Number((((pico.records || [])[0] || {}).fields || {}).Conteo || 0), topadas: (topadas.records || []).length };
  } catch (err) {
    console.error('Límites: no se pudieron leer las cifras del día:', err.message);
    return null;
  }
}

// Línea del buenos días.
function textoEstadisticas(e) {
  if (!e) return null;
  const medicion = !CONFIG.bloquearChat;
  return `🌐 DiMa ayer: ${e.mensajes} mensajes en ${e.conversaciones} conversaciones · ${e.pedidos} pedidos nuevos desde la página · conexión más activa: ${e.pico} mensajes`
    + (medicion ? ` (modo medición: no se bloquea a nadie; con el tope previsto de ${REGLAS.chatIp.max} por conexión ${e.topadas ? `${e.topadas === 1 ? '1 conexión habría' : e.topadas + ' conexiones habrían'} llegado al tope` : 'nadie habría llegado al tope'}). El costo en dólares está en console.anthropic.com → Usage.` : '.');
}

module.exports = { REGLAS, MENSAJES, CONFIG, consumir, bloqueado, fallo, huella, ipDe, telefonoDe, estadisticasDia, textoEstadisticas, fechaCuliacan, TABLA };
