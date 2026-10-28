// api/_staff.js
// Staff de El Vaso Maíz por Telegram (decisión de Víctor 2026-10-28): cada
// chica es un colaborador con Rol "Staff" y su Coordinadora (ej. Ángela). La
// coordinadora escribe /staff, elige un evento autorizado de El Vaso Maíz, toca
// los nombres de las chicas que necesita y "Invitar": a cada una le llega un
// Telegram con los datos del evento y botones "Sí puedo" / "No puedo". Cada
// respuesta le llega a la coordinadora. Las invitaciones viven en STAFF_EVENTO.
//
// Los botones guardan la selección en su propio callback_data (máscara de bits
// sobre la lista ordenada de chicas), así no hay que guardar estado aparte.

const { ROLES, COLABORADORES_TABLE } = require('./_sesion');
const { ventanaPersonalVasoMaiz } = require('./_productos');
const { enviarTelegram } = require('./_telegram');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  STAFF_EVENTO: 'tblvTVcC3NMt5ddjr',
};
const ESTADOS = { INVITADA: 'Invitada', CONFIRMO: 'Confirmó', NO_PUEDE: 'No puede', CANCELADA: 'Cancelada' };
const MAX_EVENTOS_MENU = 10;
const MAX_STAFF = 60; // límite de la máscara de selección

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function todasLasPaginas(path) {
  const registros = [];
  let offset = '';
  do {
    const data = await airtable(`${path}${path.includes('?') ? '&' : '?'}pageSize=100${offset ? '&offset=' + offset : ''}`);
    registros.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return registros;
}

function hoyCuliacan() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
}

// ---------- Datos ----------

// Chicas activas que dirige este colaborador (Admin: todas), ordenadas por nombre.
async function staffDe(colaborador) {
  const registros = await todasLasPaginas(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(`AND({Activo}, {Rol} = "${ROLES.STAFF}")`)}`);
  return registros
    .filter(r => colaborador.rol === ROLES.ADMIN || (r.fields.Coordinadora || []).includes(colaborador.id))
    .map(r => ({ id: r.id, nombre: r.fields.Nombre || 'Sin nombre', chatId: r.fields.Telegram_Chat_ID || '' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id))
    .slice(0, MAX_STAFF);
}

function aEvento(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    folio: f.Folio_Evento || '',
    fecha: f.Fecha_Evento || '',
    horaInicio: f.Hora_Inicio || '',
    horasServicio: f.Horas_Servicio || null,
    ubicacion: f.Ubicacion || '',
    instrucciones: f.Instrucciones_Equipo || '',
    piezas: f.Piezas_Vaso_Maiz || 0,
    personal: f.Personal_Requerido || 0,
  };
}

// Eventos autorizados de El Vaso Maíz de hoy en adelante.
async function eventosVasoMaiz() {
  const formula = `AND({Autorizacion_Diana} = "SI", {Estado} != "Cerrado", NOT(IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${hoyCuliacan()}"))), OR({Negocio} = "El Vaso Maiz", {Piezas_Vaso_Maiz} > 0))`;
  const data = await airtable(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=${MAX_EVENTOS_MENU}`);
  return data.records.map(aEvento);
}

async function evento(id) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return null;
  return aEvento(await airtable(`${TABLES.EVENTOS}/${id}`));
}

function aInvitacion(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    eventoId: (f.Evento || [])[0] || '',
    colaboradorId: (f.Colaborador || [])[0] || '',
    invitoId: (f.Invito || [])[0] || '',
    estado: f.Estado || '',
    fecha: f.Fecha_Evento || '',
  };
}

// Invitaciones de hoy en adelante (para estados, choques de horario y el dashboard).
async function invitacionesProximas() {
  const formula = `AND({Estado} != "${ESTADOS.CANCELADA}", NOT(IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${hoyCuliacan()}"))))`;
  return (await todasLasPaginas(`${TABLES.STAFF_EVENTO}?filterByFormula=${encodeURIComponent(formula)}`)).map(aInvitacion);
}

// Eventos que una chica ya confirmó (para /hoy y /eventos de Staff).
async function eventosConfirmadosDe(colaboradorId) {
  const formula = `{Estado} = "${ESTADOS.CONFIRMO}"`;
  const registros = await todasLasPaginas(`${TABLES.STAFF_EVENTO}?filterByFormula=${encodeURIComponent(formula)}`);
  return registros.map(aInvitacion).filter(i => i.colaboradorId === colaboradorId).map(i => i.eventoId);
}

// ¿Quien coordina puede usar /staff? Admin siempre; los demás si dirigen a alguien.
async function puedeCoordinar(colaborador) {
  if (colaborador.rol === ROLES.ADMIN) return true;
  return (await staffDe(colaborador)).length > 0;
}

// ---------- Textos ----------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaTexto(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return 'sin fecha';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}
function horaTexto(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const sufijo = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${sufijo}`;
}
function salidaTexto(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m - 30 + 24 * 60) % (24 * 60);
  return horaTexto(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
}
function cuandoTexto(ev) {
  return `${fechaTexto(ev.fecha)}${ev.horaInicio ? ` · empieza ${horaTexto(ev.horaInicio)} (salida ${salidaTexto(ev.horaInicio)})` : ' · hora por confirmar'}`;
}

// Lo que recibe la chica (sin datos del cliente).
function textoInvitacion(ev, nombre, quienInvita) {
  return [
    `Hola ${nombre} 👋 ${quienInvita} te programó un evento:`,
    '',
    `🌽 El Vaso Maíz · ${ev.folio}`,
    `📅 ${cuandoTexto(ev)}`,
    `⏱️ ${ev.horasServicio || 2} h de servicio${ev.piezas ? ` · ${ev.piezas} piezas` : ''}`,
    `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
    ev.instrucciones ? `📌 ${ev.instrucciones}` : null,
    '',
    '¿Puedes acudir? Porfa confírmame.',
  ].filter(l => l !== null).join('\n');
}

// ---------- Selección (máscara de bits en el botón) ----------

const mascara = (texto) => { try { return BigInt('0x' + (texto || '0')); } catch (e) { return 0n; } };
const textoMascara = (m) => m.toString(16);
const elegida = (m, i) => ((m >> BigInt(i)) & 1n) === 1n;
const alternar = (m, i) => m ^ (1n << BigInt(i));

// Choque de horario: la chica ya confirmó otro evento que se traslapa.
function choqueDe(colaboradorId, ev, invitaciones, eventosPorId) {
  const ventana = ventanaPersonalVasoMaiz(ev);
  if (!ventana) return null;
  for (const inv of invitaciones) {
    if (inv.colaboradorId !== colaboradorId || inv.eventoId === ev.id || inv.estado !== ESTADOS.CONFIRMO) continue;
    const otro = eventosPorId.get(inv.eventoId);
    const v = otro && ventanaPersonalVasoMaiz(otro);
    if (v && v.desde < ventana.hasta && ventana.desde < v.hasta) return otro;
  }
  return null;
}

// ---------- Menús de la coordinadora ----------

async function menuEventos() {
  const [eventos, invitaciones] = await Promise.all([eventosVasoMaiz(), invitacionesProximas()]);
  if (!eventos.length) return { texto: 'No hay eventos autorizados de El Vaso Maíz próximos. 🙌', botones: [] };
  const botones = eventos.map(ev => {
    const confirmadas = invitaciones.filter(i => i.eventoId === ev.id && i.estado === ESTADOS.CONFIRMO).length;
    const listo = ev.personal && confirmadas >= ev.personal ? '✅' : '🧑‍🍳';
    return [{ texto: `${listo} ${ev.folio} · ${fechaTexto(ev.fecha)}${ev.horaInicio ? ' ' + horaTexto(ev.horaInicio) : ''} · ${confirmadas}/${ev.personal || '?'}`, dato: `st:e:${ev.id}:0` }];
  });
  return { texto: '¿Para qué evento eliges staff?', botones };
}

async function menuEvento(colaborador, eventoId, textoSel) {
  const [ev, chicas, invitaciones, eventos] = await Promise.all([evento(eventoId), staffDe(colaborador), invitacionesProximas(), eventosVasoMaiz()]);
  if (!ev) return { texto: 'No encontré ese evento.', botones: [[{ texto: '⬅️ Eventos', dato: 'st:l' }]] };
  const eventosPorId = new Map(eventos.map(e => [e.id, e]));
  const sel = mascara(textoSel);
  const deEsteEvento = new Map(invitaciones.filter(i => i.eventoId === ev.id).map(i => [i.colaboradorId, i.estado]));
  const confirmadas = [...deEsteEvento.values()].filter(e => e === ESTADOS.CONFIRMO).length;
  const invitadas = [...deEsteEvento.values()].filter(e => e === ESTADOS.INVITADA).length;

  let elegidas = 0;
  const celdas = chicas.map((c, i) => {
    const estado = deEsteEvento.get(c.id);
    if (estado === ESTADOS.CONFIRMO) return { texto: `✅ ${c.nombre}`, dato: 'st:x:c' };
    if (estado === ESTADOS.INVITADA) return { texto: `⏳ ${c.nombre}`, dato: 'st:x:i' };
    if (!c.chatId) return { texto: `📵 ${c.nombre}`, dato: 'st:x:t' };
    const choque = choqueDe(c.id, ev, invitaciones, eventosPorId);
    if (choque) return { texto: `⛔ ${c.nombre} (${choque.folio})`, dato: 'st:x:o' };
    if (elegida(sel, i)) elegidas++;
    const marca = elegida(sel, i) ? '☑️' : (estado === ESTADOS.NO_PUEDE ? '❌' : '⬜');
    return { texto: `${marca} ${c.nombre}`, dato: `st:e:${ev.id}:${textoMascara(alternar(sel, i))}` };
  });
  const botones = [];
  for (let i = 0; i < celdas.length; i += 2) botones.push(celdas.slice(i, i + 2));
  const fin = [{ texto: '⬅️ Eventos', dato: 'st:l' }];
  if (elegidas) fin.unshift({ texto: `📨 Invitar (${elegidas})`, dato: `st:i:${ev.id}:${textoMascara(sel)}` });
  botones.push(fin);

  const texto = [
    `🌽 ${ev.folio} · ${cuandoTexto(ev)}`,
    `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
    `🧑‍🍳 Se necesitan ${ev.personal || '?'} personas · confirmadas ${confirmadas} · esperando respuesta ${invitadas}`,
    '',
    chicas.length ? 'Toca los nombres para elegir y luego "Invitar".\n✅ confirmó · ⏳ invitada · ❌ no pudo · ⛔ ya tiene otro evento a esa hora · 📵 sin Telegram' : 'No tienes staff asignado en COLABORADORES (campo Coordinadora).',
  ].join('\n');
  return { texto, botones };
}

// Crea las invitaciones y les manda el Telegram a las elegidas.
async function invitar(colaborador, eventoId, textoSel) {
  const [ev, chicas, invitaciones, eventos] = await Promise.all([evento(eventoId), staffDe(colaborador), invitacionesProximas(), eventosVasoMaiz()]);
  if (!ev) return { texto: 'No encontré ese evento.', botones: [[{ texto: '⬅️ Eventos', dato: 'st:l' }]] };
  const eventosPorId = new Map(eventos.map(e => [e.id, e]));
  const sel = mascara(textoSel);
  const enviadas = [], fallidas = [];

  for (const [i, c] of chicas.entries()) {
    if (!elegida(sel, i)) continue;
    const previa = invitaciones.find(inv => inv.eventoId === ev.id && inv.colaboradorId === c.id);
    if (previa && (previa.estado === ESTADOS.CONFIRMO || previa.estado === ESTADOS.INVITADA)) continue;
    if (!c.chatId || choqueDe(c.id, ev, invitaciones, eventosPorId)) continue;

    const campos = { Estado: ESTADOS.INVITADA, Invito: [colaborador.id], Fecha_Evento: ev.fecha || null, Respondio: null };
    let invitacionId;
    if (previa) {
      await airtable(TABLES.STAFF_EVENTO, { method: 'PATCH', body: JSON.stringify({ records: [{ id: previa.id, fields: campos }] }) });
      invitacionId = previa.id;
    } else {
      const creado = await airtable(TABLES.STAFF_EVENTO, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: { ...campos, Nombre: `${ev.folio} · ${c.nombre}`, Evento: [ev.id], Colaborador: [c.id] } }] }),
      });
      invitacionId = creado.records[0].id;
    }
    const r = await enviarTelegram(c.chatId, textoInvitacion(ev, c.nombre, colaborador.nombre), [[
      { texto: '✅ Sí puedo', dato: `inv:s:${invitacionId}` },
      { texto: '❌ No puedo', dato: `inv:n:${invitacionId}` },
    ]]);
    (r.ok ? enviadas : fallidas).push(c.nombre);
  }

  const texto = [
    `🌽 ${ev.folio} · ${cuandoTexto(ev)}`,
    enviadas.length ? `📨 Invitaciones enviadas: ${enviadas.join(', ')}. Te aviso aquí cuando respondan.` : 'No se envió ninguna invitación nueva.',
    fallidas.length ? `⚠️ No les llegó a: ${fallidas.join(', ')} (¿bloquearon el bot?). Avísales por otro medio.` : null,
  ].filter(Boolean).join('\n');
  return { texto, botones: [[{ texto: '🧑‍🍳 Ver el evento', dato: `st:e:${ev.id}:0` }, { texto: '⬅️ Eventos', dato: 'st:l' }]] };
}

// ---------- Respuesta de la chica ----------

// si = true (Sí puedo) o false (No puedo). Devuelve { aviso, alerta, textoFinal }.
async function responderInvitacion(colaborador, invitacionId, si) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(invitacionId || '')) return { aviso: 'Invitación no válida.', alerta: true };
  const inv = aInvitacion(await airtable(`${TABLES.STAFF_EVENTO}/${invitacionId}`));
  if (inv.colaboradorId !== colaborador.id) return { aviso: 'Esta invitación no es tuya.', alerta: true };
  if (inv.estado !== ESTADOS.INVITADA) return { aviso: inv.estado === ESTADOS.CANCELADA ? 'Esta invitación se canceló.' : `Ya respondiste: ${inv.estado}.`, alerta: true };
  const ev = await evento(inv.eventoId);

  if (si) {
    const [invitaciones, eventos] = await Promise.all([invitacionesProximas(), eventosVasoMaiz()]);
    const choque = ev && choqueDe(colaborador.id, ev, invitaciones, new Map(eventos.map(e => [e.id, e])));
    if (choque) return { aviso: `Ya confirmaste ${choque.folio} a esa misma hora. Avísale a tu coordinadora.`, alerta: true };
  }

  const estado = si ? ESTADOS.CONFIRMO : ESTADOS.NO_PUEDE;
  await airtable(TABLES.STAFF_EVENTO, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: inv.id, fields: { Estado: estado, Respondio: new Date().toISOString() } }] }),
  });

  // Aviso a quien la invitó, con cuántas van.
  if (inv.invitoId && ev) {
    const [coordinadora, todas] = await Promise.all([
      airtable(`${COLABORADORES_TABLE}/${inv.invitoId}`).catch(() => null),
      todasLasPaginas(`${TABLES.STAFF_EVENTO}?filterByFormula=${encodeURIComponent(`{Estado} = "${ESTADOS.CONFIRMO}"`)}`).catch(() => []),
    ]);
    const confirmadas = todas.map(aInvitacion).filter(i => i.eventoId === ev.id).length;
    const chatCoordinadora = coordinadora && coordinadora.fields.Telegram_Chat_ID;
    if (chatCoordinadora) {
      const lineas = si
        ? [`✅ ${colaborador.nombre} confirmó ${ev.folio} (${fechaTexto(ev.fecha)}) · ${confirmadas} de ${ev.personal || '?'}`]
        : [`❌ ${colaborador.nombre} no puede ir a ${ev.folio} (${fechaTexto(ev.fecha)}) · confirmadas ${confirmadas} de ${ev.personal || '?'}`, 'Usa /staff para invitar a otra.'];
      if (si && ev.personal && confirmadas >= ev.personal) lineas.push('🎉 Equipo completo para este evento.');
      await enviarTelegram(chatCoordinadora, lineas.join('\n'));
    }
  }

  return {
    aviso: si ? '¡Gracias! Quedó confirmado.' : 'Gracias por avisar.',
    textoFinal: si ? '✅ Confirmaste. ¡Gracias! Lo verás en /eventos.' : '❌ Respondiste que no puedes. ¡Gracias por avisar!',
  };
}

// Resumen por evento para el dashboard: { eventoId: [{ nombre, estado }] }.
async function staffPorEvento() {
  const [invitaciones, staff] = await Promise.all([
    invitacionesProximas(),
    todasLasPaginas(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(`{Rol} = "${ROLES.STAFF}"`)}`),
  ]);
  const nombres = new Map(staff.map(r => [r.id, r.fields.Nombre || '']));
  const resumen = {};
  for (const i of invitaciones) {
    (resumen[i.eventoId] = resumen[i.eventoId] || []).push({ nombre: nombres.get(i.colaboradorId) || '¿?', estado: i.estado });
  }
  return resumen;
}

module.exports = {
  ESTADOS,
  puedeCoordinar,
  menuEventos,
  menuEvento,
  invitar,
  responderInvitacion,
  eventosConfirmadosDe,
  staffPorEvento,
  textoInvitacion,
  horaTexto,
  salidaTexto,
};
