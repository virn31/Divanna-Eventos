// api/_cambios.js
// Cambios de pedido que pide el cliente por el chat de DiMa (decisión de
// Víctor 2026-10-29). Antes solo llegaba un Telegram a los Admin, el cambio no
// se veía en el dashboard ni en la app y el equipo no se enteraba.
// - Al momento: Diana, Víctor y la gerente (si es de El Vaso Maíz) reciben
//   aviso en la app (push con sonido) y por Telegram. A la gerente sin montos.
// - Pedido ya autorizado: el cambio queda pendiente (EVENTOS.Cambio_Cliente)
//   hasta que Diana lo confirma o lo descarta en el dashboard. Al confirmar se
//   aplica (servicios, hora, productos, indicaciones) y se avisa al equipo del
//   evento (brigada, encargada, gerente y producción) con "Confirmar"; si la
//   producción ya se había mandado, se le reenvía la lista actualizada.
// - Con menos de 24 h para el evento el cambio va marcado como URGENTE.

const { ROLES, COLABORADORES_TABLE, esVasoMaiz } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo } = require('./_telegram');
const { botonConfirmar } = require('./_eventos');
const { camposAgenda, leerCambio } = require('./_pedidos');
const { reenviarPorCambio } = require('./_produccion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS = 'tblzLAin65BZPP2c6';

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

const fechaCorta = () => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mazatlan' }).format(new Date());

// Admin y, si el evento es de El Vaso Maíz, la gerente: { admins: [ids], gerentes: [ids] }.
async function gerenciaDe(eventoFields) {
  const formula = encodeURIComponent(`AND({Activo}, OR({Rol} = "${ROLES.ADMIN}", {Gerente_Vaso_Maiz}))`);
  const data = await airtable(`${COLABORADORES_TABLE}?filterByFormula=${formula}`);
  const admins = data.records.filter(r => r.fields.Rol === ROLES.ADMIN).map(r => r.id);
  const gerentes = esVasoMaiz(eventoFields || {}) ? data.records.filter(r => r.fields.Rol !== ROLES.ADMIN && r.fields.Gerente_Vaso_Maiz).map(r => r.id) : [];
  return { admins, gerentes };
}

// Aviso inmediato de un cambio pedido por el cliente. Devuelve cuántos avisos se entregaron.
async function avisarCambioPedido({ folio, nombre, servicios, montoEstimado, indicaciones, urgente, autorizado, eventoFields }) {
  const { admins, gerentes } = await gerenciaDe(eventoFields);
  const titulo = `${urgente ? '⚠️ URGENTE · ' : ''}✏️ Cambio en el pedido ${folio}`;
  const estado = autorizado
    ? 'Ya estaba autorizado: Diana lo revisa y lo confirma o descarta en el dashboard. El equipo se entera cuando lo confirme.'
    : 'Todavía no se cotiza: ya quedó actualizado en el dashboard.';
  const base = [
    `${titulo}${nombre ? ' (' + nombre + ')' : ''}`,
    urgente ? 'Faltan menos de 24 horas para el evento.' : null,
    estado,
    '',
    `Así lo quiere ahora:\n${servicios}`,
    indicaciones ? `\n📌 ${indicaciones}` : null,
  ].filter(l => l !== null).join('\n');
  const conMonto = montoEstimado > 0 ? `${base}\n\nNuevo estimado de DiMa: $${Number(montoEstimado).toLocaleString('es-MX')}` : base;
  const cuerpo = urgente ? 'Faltan menos de 24 h. Toca para verlo.' : 'Toca para ver lo que cambió.';

  const [tgAdmins, tgGerente, pushAdmins, pushGerente] = await Promise.all([
    admins.length ? enviarTelegramEquipo({ texto: conMonto, soloColaboradores: admins }) : 0,
    gerentes.length ? enviarTelegramEquipo({ texto: base, soloColaboradores: gerentes }) : 0,
    admins.length ? enviarPushEquipo({ titulo, cuerpo, soloColaboradores: admins, url: '/brigadas/dashboard.html' }) : 0,
    gerentes.length ? enviarPushEquipo({ titulo, cuerpo, soloColaboradores: gerentes, url: '/brigadas/' }) : 0,
  ]);
  return { telegram: tgAdmins + tgGerente, push: pushAdmins + pushGerente };
}

// Quien tiene el evento: brigada, encargada(s), gerente (El Vaso Maíz) y producción.
function equipoDelEvento(eventoFields, colaboradores) {
  const brigadas = eventoFields.Brigada_Asignada || [];
  const ids = new Set([...(eventoFields.Encargada || []), ...(eventoFields.Encargado_Produccion || [])]);
  colaboradores.forEach(c => {
    if ((c.fields.Brigada || []).some(b => brigadas.includes(b))) ids.add(c.id);
    if (esVasoMaiz(eventoFields) && c.fields.Gerente_Vaso_Maiz) ids.add(c.id);
  });
  return [...ids];
}

// Diana confirma el cambio pendiente: se aplica y se avisa al equipo.
// Devuelve { error } o { avisados, porTelegram, porPush, produccion }.
async function confirmarCambio(eventoId, f, colaborador, colaboradores) {
  const c = leerCambio(f.Cambio_Cliente);
  if (!c || c.estado !== 'pendiente') return { error: 'Este evento no tiene un cambio pendiente.' };
  const campos = {
    Servicios_Solicitados: c.servicios,
    ...camposAgenda({ horaInicio: c.horaInicio, horasServicio: c.horasServicio, productos: c.productos || [] }),
    Cambio_Cliente: JSON.stringify({ ...c, estado: 'confirmado', confirmadoEl: new Date().toISOString(), confirmadoPor: colaborador.nombre }),
    Notas: `${f.Notas || ''}\n--- Cambio del cliente CONFIRMADO por ${colaborador.nombre} (${fechaCorta()}) ---`.slice(-90000),
    // El equipo vuelve a confirmar que vio el evento con el cambio.
    Enterado_Por: '',
    Enterado_Hora: null,
  };
  if (c.indicaciones && !(f.Instrucciones_Equipo || '').includes(c.indicaciones)) {
    campos.Instrucciones_Equipo = `${f.Instrucciones_Equipo ? f.Instrucciones_Equipo + '\n' : ''}Del cliente: ${c.indicaciones}`;
  }
  await airtable(EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: campos }] }) });

  const equipo = equipoDelEvento(f, colaboradores).filter(id => id !== colaborador.id);
  let porTelegram = 0, porPush = 0;
  const erroresAvisos = [];
  if (equipo.length) {
    const titulo = `🔄 Cambió el pedido ${f.Folio_Evento || ''}`.trim();
    const texto = [
      `${titulo}${f.Fecha_Evento ? ' (' + f.Fecha_Evento + (f.Hora_Inicio || c.horaInicio ? ' · ' + (c.horaInicio || f.Hora_Inicio) : '') + ')' : ''}`,
      'El cliente pidió un cambio y la gerencia ya lo confirmó. Ahora lleva:',
      '',
      c.servicios,
      c.indicaciones ? `\n📌 ${c.indicaciones}` : null,
      '',
      'Confirma que lo viste con el botón o en la app ("Enterado").',
    ].filter(l => l !== null).join('\n');
    [porPush, porTelegram] = await Promise.all([
      enviarPushEquipo({ titulo, cuerpo: 'La gerencia confirmó un cambio. Toca para verlo.', soloColaboradores: equipo }),
      enviarTelegramEquipo({ texto, soloColaboradores: equipo, errores: erroresAvisos, botones: botonConfirmar(eventoId) }),
    ]);
  }
  const produccion = (f.Encargado_Produccion || []).length
    ? await reenviarPorCambio(eventoId, f.Fecha_Evento).catch(err => { console.error('No se pudo reenviar la producción:', err.message); return { enviados: [], fallidos: [{ nombre: 'producción', motivo: 'error al reenviar' }] }; })
    : null;
  return { avisados: equipo.length, porTelegram, porPush, erroresAvisos, produccion };
}

// Diana descarta el cambio: no se aplica nada; queda anotado. Al cliente se
// le explica con "Mensaje para el cliente".
async function descartarCambio(eventoId, f, colaborador) {
  const c = leerCambio(f.Cambio_Cliente);
  if (!c || c.estado !== 'pendiente') return { error: 'Este evento no tiene un cambio pendiente.' };
  await airtable(EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: eventoId, fields: {
      Cambio_Cliente: JSON.stringify({ ...c, estado: 'descartado', descartadoEl: new Date().toISOString(), descartadoPor: colaborador.nombre }),
      Notas: `${f.Notas || ''}\n--- Cambio del cliente DESCARTADO por ${colaborador.nombre} (${fechaCorta()}) ---`.slice(-90000),
    } }] }),
  });
  return {};
}

module.exports = { avisarCambioPedido, confirmarCambio, descartarCambio, equipoDelEvento };
