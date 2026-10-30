// api/_calendario.js
// Calendario del equipo (decisión de Víctor 2026-10-29):
// - Todos los de la app ven todos los eventos autorizados (sin montos) y los
//   días bloqueados. Diana y Víctor modifican todo; la gerente de El Vaso Maíz
//   solo lo de El Vaso Maíz.
// - Se puede mover fecha y hora, cambiar horas de servicio, cancelar y
//   bloquear días. Cada cambio avisa al equipo asignado (y al staff que ya
//   confirmó) y se refleja en Google Calendar.
// - Google Calendar (divannaeventos@gmail.com) es un espejo que lleva DiMa:
//   se crea al autorizar y se actualiza o borra con cada cambio
//   (EVENTOS.Google_Evento_ID). Lo que se cambie directo en Google NO regresa
//   a la plataforma.
// Cancelar no borra el expediente: marca Cancelado, Autorizacion_Diana = NO y
// Estado = Cerrado (así el semáforo, producción y staff lo dejan fuera solos).

const { google } = require('googleapis');
const { ROLES, COLABORADORES_TABLE, esVasoMaiz } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegram, enviarTelegramEquipo } = require('./_telegram');
const { botonConfirmar } = require('./_eventos');
const { capacidadEvento, leerProductos, normalizarProductos, PRODUCTOS, CLAVES } = require('./_productos');
const { buscarClientePorTelefono, camposAgenda } = require('./_pedidos');
const { reenviarPorCambio } = require('./_produccion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  BLOQUEOS: 'tblHSdMCxW2kkiiC9',
  STAFF_EVENTO: 'tblvTVcC3NMt5ddjr',
};
const NEGOCIOS = { DV: 'Divanna Eventos', VM: 'El Vaso Maiz', AMBOS: 'Ambos' };
const ZONA = 'America/Mazatlan';
const HORAS_DEFAULT = 3;
const ID = /^rec[A-Za-z0-9]{14}$/;
const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
const esHora = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function todas(path) {
  const registros = [];
  let offset = '';
  do {
    const data = await airtable(`${path}${path.includes('?') ? '&' : '?'}pageSize=100${offset ? '&offset=' + offset : ''}`);
    registros.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return registros;
}

const hoyCuliacan = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const fechaCorta = () => new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: ZONA }).format(new Date());
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaTexto(iso) {
  if (!esFecha(iso)) return 'sin fecha';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

// ¿Puede este colaborador modificar este evento / bloquear este negocio?
const esEditor = (c) => c.rol === ROLES.ADMIN || !!c.gerente;
function puedeEditarEvento(c, f) {
  if (c.rol === ROLES.ADMIN) return true;
  return !!c.gerente && esVasoMaiz(f);
}
function puedeBloquear(c, negocio) {
  if (c.rol === ROLES.ADMIN) return true;
  return !!c.gerente && negocio === NEGOCIOS.VM;
}

// ---------- Google Calendar (espejo) ----------

function googleConfigurado() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID);
}

function calendarioGoogle() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

function sumarHoras(fecha, hora, horas) {
  const [h, m] = hora.split(':').map(Number);
  const total = h * 60 + m + Math.round(horas * 60);
  const dias = Math.floor(total / (24 * 60));
  const resto = total % (24 * 60);
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return { fecha: d.toISOString().slice(0, 10), hora: `${String(Math.floor(resto / 60)).padStart(2, '0')}:${String(resto % 60).padStart(2, '0')}` };
}
const diaSiguiente = (fecha) => sumarHoras(fecha, '00:00', 24).fecha;

// Evento de Google a partir del EVENTO de Airtable (sin montos).
function aGoogle(f, nombres = {}) {
  const vm = esVasoMaiz(f);
  const titulo = `${vm ? '🌽' : '🎉'} ${f.Folio_Evento || 'Evento'}${f.Ubicacion ? ' · ' + f.Ubicacion : ''}`;
  const lineas = [
    `Negocio: ${f.Negocio || (vm ? NEGOCIOS.VM : 'sin especificar')}`,
    nombres.brigada ? `Brigada: ${nombres.brigada}` : 'Brigada: sin asignar',
    nombres.encargadas ? `Encargada: ${nombres.encargadas}` : null,
    f.Invitados ? `Invitados: ${f.Invitados}` : null,
    f.Servicios_Solicitados ? `\nLleva:\n${String(f.Servicios_Solicitados).slice(0, 1500)}` : null,
    f.Instrucciones_Equipo ? `\nInstrucciones:\n${String(f.Instrucciones_Equipo).slice(0, 1000)}` : null,
    '\nLo administra DiMa: los cambios se hacen en la app (lo que se cambie aquí no regresa a la app).',
  ].filter(Boolean);
  const evento = { summary: titulo, location: f.Ubicacion || undefined, description: lineas.join('\n') };
  if (esHora(f.Hora_Inicio)) {
    const fin = sumarHoras(f.Fecha_Evento, f.Hora_Inicio, Number(f.Horas_Servicio) || HORAS_DEFAULT);
    evento.start = { dateTime: `${f.Fecha_Evento}T${f.Hora_Inicio}:00`, timeZone: ZONA };
    evento.end = { dateTime: `${fin.fecha}T${fin.hora}:00`, timeZone: ZONA };
  } else {
    evento.start = { date: f.Fecha_Evento };
    evento.end = { date: diaSiguiente(f.Fecha_Evento) };
  }
  return evento;
}

async function nombresDe(f) {
  const brigadaId = (f.Brigada_Asignada || [])[0];
  const encargadas = f.Encargada || [];
  const [b, e] = await Promise.all([
    brigadaId ? airtable(`${TABLES.BRIGADAS}/${brigadaId}`).catch(() => null) : null,
    encargadas.length ? airtable(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent(`OR(${encargadas.map(id => `RECORD_ID()="${id}"`).join(',')})`)}`).catch(() => null) : null,
  ]);
  return {
    brigada: b ? b.fields.Nombre_Brigada || '' : '',
    encargadas: e ? e.records.map(r => r.fields.Nombre || '').filter(Boolean).join(', ') : '',
  };
}

// Deja Google igual que el EVENTO: lo crea, lo actualiza o lo borra.
// Devuelve { ok, accion, error } y nunca lanza (el motivo se muestra a quien hizo el cambio).
async function sincronizarEvento(eventoId) {
  if (!googleConfigurado()) return { ok: false, error: 'Google Calendar no está configurado en Vercel.' };
  try {
    const r = await airtable(`${TABLES.EVENTOS}/${eventoId}`);
    const f = r.fields;
    const cal = calendarioGoogle();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    const idGoogle = f.Google_Evento_ID || '';
    const debeEstar = f.Autorizacion_Diana === 'SI' && !f.Cancelado && esFecha(f.Fecha_Evento);
    if (!debeEstar) {
      if (!idGoogle) return { ok: true, accion: 'nada' };
      await cal.events.delete({ calendarId, eventId: idGoogle }).catch(err => { if (err.code !== 404 && err.code !== 410) throw err; });
      await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: { Google_Evento_ID: '' } }] }) });
      return { ok: true, accion: 'borrado' };
    }
    const cuerpo = aGoogle(f, await nombresDe(f));
    if (idGoogle) {
      try {
        await cal.events.update({ calendarId, eventId: idGoogle, requestBody: cuerpo });
        return { ok: true, accion: 'actualizado' };
      } catch (err) {
        if (err.code !== 404 && err.code !== 410) throw err; // si lo borraron en Google, se vuelve a crear
      }
    }
    const creado = await cal.events.insert({ calendarId, requestBody: cuerpo });
    await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: eventoId, fields: { Google_Evento_ID: creado.data.id } }] }) });
    return { ok: true, accion: 'creado' };
  } catch (err) {
    console.error('Error sincronizando Google Calendar:', err.message);
    return { ok: false, error: `Google Calendar: ${err.message}` };
  }
}

// ---------- Lectura (todos) ----------

function rangoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const desde = `${mes}-01`;
  const sig = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  return { desde, sig };
}

// Eventos autorizados y días bloqueados de un mes (YYYY-MM), sin montos.
async function vistaMes(colaborador, mes) {
  const { desde, sig } = rangoMes(mes);
  const enRango = (campo) => `AND(NOT(IS_BEFORE({${campo}}, DATETIME_PARSE("${desde}"))), IS_BEFORE({${campo}}, DATETIME_PARSE("${sig}")))`;
  const [eventos, bloqueos, brigadas] = await Promise.all([
    todas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(`AND({Autorizacion_Diana} = "SI", NOT({Cancelado}), ${enRango('Fecha_Evento')})`)}`),
    todas(`${TABLES.BLOQUEOS}?filterByFormula=${encodeURIComponent(enRango('Fecha'))}`),
    todas(`${TABLES.BRIGADAS}?fields%5B%5D=Nombre_Brigada`),
  ]);
  const nombreBrigada = new Map(brigadas.map(b => [b.id, b.fields.Nombre_Brigada || '']));
  return {
    mes,
    puedeEditar: esEditor(colaborador),
    // Para capturar eventos de El Vaso Maíz (paquetes y piezas del catálogo).
    catalogoVM: esEditor(colaborador) ? CLAVES.filter(k => PRODUCTOS[k].negocio === NEGOCIOS.VM).map(k => ({ clave: k, nombre: PRODUCTOS[k].nombre })) : [],
    soloVasoMaiz: colaborador.rol !== ROLES.ADMIN,
    eventos: eventos.map(r => {
      const f = r.fields;
      return {
        id: r.id,
        folio: f.Folio_Evento || '',
        fecha: f.Fecha_Evento,
        hora: f.Hora_Inicio || '',
        horasServicio: f.Horas_Servicio || null,
        negocio: esVasoMaiz(f) ? NEGOCIOS.VM : (f.Negocio || NEGOCIOS.DV),
        ubicacion: f.Ubicacion || '',
        invitados: f.Invitados || null,
        brigada: nombreBrigada.get((f.Brigada_Asignada || [])[0]) || '',
        estatus: f.Estatus_Logistico || '',
        enGoogle: !!f.Google_Evento_ID,
        editable: puedeEditarEvento(colaborador, f),
      };
    }).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)),
    bloqueos: bloqueos.map(r => ({
      id: r.id, fecha: r.fields.Fecha, negocio: r.fields.Negocio || NEGOCIOS.AMBOS, motivo: r.fields.Motivo || '',
      editable: puedeBloquear(colaborador, r.fields.Negocio || NEGOCIOS.AMBOS),
    })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  };
}

// Días bloqueados de hoy en adelante (para DiMa al cotizar).
async function bloqueosProximos(dias = 240) {
  const hoy = hoyCuliacan();
  const hasta = sumarHoras(hoy, '00:00', dias * 24).fecha;
  const formula = `AND(NOT(IS_BEFORE({Fecha}, DATETIME_PARSE("${hoy}"))), IS_BEFORE({Fecha}, DATETIME_PARSE("${hasta}")))`;
  return (await todas(`${TABLES.BLOQUEOS}?filterByFormula=${encodeURIComponent(formula)}`))
    .map(r => ({ fecha: r.fields.Fecha, negocio: r.fields.Negocio || NEGOCIOS.AMBOS, motivo: r.fields.Motivo || '' }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ---------- Avisos al equipo ----------

// Brigada, encargada(s), gerente (El Vaso Maíz), producción y staff que confirmó.
async function equipoDe(eventoId, f) {
  const brigadas = f.Brigada_Asignada || [];
  const ids = new Set([...(f.Encargada || []), ...(f.Encargado_Produccion || [])]);
  const [colaboradores, staff] = await Promise.all([
    todas(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent('{Activo}')}`),
    todas(`${TABLES.STAFF_EVENTO}?filterByFormula=${encodeURIComponent('{Estado} = "Confirmó"')}`),
  ]);
  colaboradores.forEach(c => {
    if ((c.fields.Brigada || []).some(b => brigadas.includes(b))) ids.add(c.id);
    if (esVasoMaiz(f) && c.fields.Gerente_Vaso_Maiz) ids.add(c.id);
  });
  staff.filter(s => (s.fields.Evento || [])[0] === eventoId).forEach(s => ids.add((s.fields.Colaborador || [])[0]));
  return { ids: [...ids].filter(Boolean), staff: staff.filter(s => (s.fields.Evento || [])[0] === eventoId) };
}

async function avisar(colaborador, ids, titulo, texto, eventoId, conBoton) {
  const destinos = ids.filter(id => id !== colaborador.id);
  if (!destinos.length) return { avisados: 0, porTelegram: 0, porPush: 0 };
  const [porPush, porTelegram] = await Promise.all([
    enviarPushEquipo({ titulo, cuerpo: 'Toca para verlo.', soloColaboradores: destinos }),
    enviarTelegramEquipo({ texto, soloColaboradores: destinos, ...(conBoton ? { botones: botonConfirmar(eventoId) } : {}) }),
  ]);
  return { avisados: destinos.length, porTelegram, porPush };
}

// ---------- Escritura (Diana, Víctor y la gerente) ----------

async function leerEditable(colaborador, eventoId) {
  if (!ID.test(eventoId || '')) return { error: 'Parámetros inválidos' };
  const r = await airtable(`${TABLES.EVENTOS}/${eventoId}`);
  if (!puedeEditarEvento(colaborador, r.fields)) return { error: 'Solo puedes modificar eventos de El Vaso Maíz.', codigo: 403 };
  if (r.fields.Cancelado) return { error: 'Este evento ya está cancelado.', codigo: 409 };
  return { f: r.fields };
}

// Mover fecha/hora y/o cambiar horas de servicio.
async function mover(colaborador, body) {
  const { f, error, codigo } = await leerEditable(colaborador, body.eventoId);
  if (error) return { error, codigo };
  const fecha = body.fecha;
  const hora = body.hora == null ? (f.Hora_Inicio || '') : String(body.hora);
  const horas = body.horasServicio == null || body.horasServicio === '' ? (f.Horas_Servicio || null) : Number(body.horasServicio);
  if (!esFecha(fecha)) return { error: 'Elige la fecha.' };
  if (fecha < hoyCuliacan()) return { error: 'No se puede mover un evento a una fecha que ya pasó.' };
  if (hora && !esHora(hora)) return { error: 'La hora debe ser como 18:00.' };
  if (horas !== null && !(horas >= 1 && horas <= 12)) return { error: 'Las horas de servicio van de 1 a 12.' };
  const antes = `${fechaTexto(f.Fecha_Evento)}${f.Hora_Inicio ? ' ' + f.Hora_Inicio : ''}${f.Horas_Servicio ? ` (${f.Horas_Servicio} h)` : ''}`;
  const ahora = `${fechaTexto(fecha)}${hora ? ' ' + hora : ''}${horas ? ` (${horas} h)` : ''}`;
  if (fecha === f.Fecha_Evento && hora === (f.Hora_Inicio || '') && horas === (f.Horas_Servicio || null)) return { error: 'No cambiaste nada.' };

  const campos = {
    Fecha_Evento: fecha,
    Hora_Inicio: hora,
    Horas_Servicio: horas,
    Enterado_Por: '',
    Enterado_Hora: null,
    Notas: `${f.Notas || ''}\n--- ${colaborador.nombre} movió el evento en el calendario (${fechaCorta()}): ${antes} → ${ahora} ---`.slice(-90000),
  };
  // El personal de El Vaso Maíz depende de las horas de servicio.
  const productos = leerProductos(f.Productos);
  if (productos.length && horas !== (f.Horas_Servicio || null)) {
    const c = capacidadEvento(productos, horas);
    Object.assign(campos, { Piezas_Vaso_Maiz: c.piezas, Personal_Requerido: c.personal, Resumen_Capacidad: c.resumen });
  }
  await airtable(TABLES.EVENTOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id: body.eventoId, fields: campos }] }) });

  const { ids, staff } = await equipoDe(body.eventoId, f);
  // Las invitaciones del staff llevan la fecha del evento (choques de horario).
  if (staff.length && fecha !== f.Fecha_Evento) {
    await airtable(TABLES.STAFF_EVENTO, { method: 'PATCH', body: JSON.stringify({ records: staff.slice(0, 10).map(s => ({ id: s.id, fields: { Fecha_Evento: fecha } })) }) });
  }
  const titulo = `📅 Se movió ${f.Folio_Evento || 'un evento'}`;
  const texto = `${titulo}\nAntes: ${antes}\nAhora: ${ahora}${f.Ubicacion ? '\n📍 ' + f.Ubicacion : ''}\n\nLo cambió ${colaborador.nombre}. Confirma que lo viste con el botón o en la app ("Enterado").`;
  const avisos = await avisar(colaborador, ids, titulo, texto, body.eventoId, true);
  const google = await sincronizarEvento(body.eventoId);
  const produccion = (f.Encargado_Produccion || []).length ? await reenviarPorCambio(body.eventoId, fecha).catch(() => null) : null;
  return { ok: true, ...avisos, google, produccion };
}

async function cancelar(colaborador, body) {
  const { f, error, codigo } = await leerEditable(colaborador, body.eventoId);
  if (error) return { error, codigo };
  const motivo = String(body.motivo || '').trim().slice(0, 300);
  if (!motivo) return { error: 'Escribe el motivo de la cancelación.' };
  await airtable(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: body.eventoId, fields: {
      Cancelado: true,
      Autorizacion_Diana: 'NO',
      Estado: 'Cerrado',
      Notas: `${f.Notas || ''}\n--- CANCELADO por ${colaborador.nombre} (${fechaCorta()}): ${motivo} ---`.slice(-90000),
    } }] }),
  });
  const { ids } = await equipoDe(body.eventoId, f);
  const titulo = `❌ Se canceló ${f.Folio_Evento || 'un evento'}`;
  const texto = `${titulo} (${fechaTexto(f.Fecha_Evento)}${f.Hora_Inicio ? ' ' + f.Hora_Inicio : ''}${f.Ubicacion ? ' · ' + f.Ubicacion : ''}).\nMotivo: ${motivo}\nYa no hay que ir ni preparar nada. Lo canceló ${colaborador.nombre}.`;
  const avisos = await avisar(colaborador, ids, titulo, texto, body.eventoId, false);
  const google = await sincronizarEvento(body.eventoId);
  return { ok: true, ...avisos, google };
}

async function bloquear(colaborador, body) {
  const negocio = body.negocio;
  if (![NEGOCIOS.DV, NEGOCIOS.VM, NEGOCIOS.AMBOS].includes(negocio)) return { error: 'Elige el negocio.' };
  if (!puedeBloquear(colaborador, negocio)) return { error: 'Solo puedes bloquear días de El Vaso Maíz.', codigo: 403 };
  if (!esFecha(body.fecha) || body.fecha < hoyCuliacan()) return { error: 'Elige una fecha de hoy en adelante.' };
  const motivo = String(body.motivo || '').trim().slice(0, 120);
  if (!motivo) return { error: 'Escribe el motivo (ej. vacaciones, mantenimiento).' };
  const creado = await airtable(TABLES.BLOQUEOS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: { Fecha: body.fecha, Negocio: negocio, Motivo: motivo, Creado_Por: colaborador.nombre } }] }),
  });
  const id = creado.records[0].id;
  let google = { ok: false, error: 'Google Calendar no está configurado en Vercel.' };
  if (googleConfigurado()) {
    try {
      const ev = await calendarioGoogle().events.insert({ calendarId: process.env.GOOGLE_CALENDAR_ID, requestBody: {
        summary: `⛔ No disponible (${negocio === NEGOCIOS.AMBOS ? 'los dos negocios' : negocio}): ${motivo}`,
        start: { date: body.fecha }, end: { date: diaSiguiente(body.fecha) },
      } });
      await airtable(TABLES.BLOQUEOS, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields: { Google_Evento_ID: ev.data.id } }] }) });
      google = { ok: true, accion: 'creado' };
    } catch (err) {
      console.error('Error bloqueando en Google:', err.message);
      google = { ok: false, error: `Google Calendar: ${err.message}` };
    }
  }
  return { ok: true, id, google };
}

async function desbloquear(colaborador, body) {
  if (!ID.test(body.bloqueoId || '')) return { error: 'Parámetros inválidos' };
  const r = await airtable(`${TABLES.BLOQUEOS}/${body.bloqueoId}`);
  if (!puedeBloquear(colaborador, r.fields.Negocio || NEGOCIOS.AMBOS)) return { error: 'Solo puedes quitar bloqueos de El Vaso Maíz.', codigo: 403 };
  if (r.fields.Google_Evento_ID && googleConfigurado()) {
    await calendarioGoogle().events.delete({ calendarId: process.env.GOOGLE_CALENDAR_ID, eventId: r.fields.Google_Evento_ID })
      .catch(err => { if (err.code !== 404 && err.code !== 410) console.error('Error quitando bloqueo en Google:', err.message); });
  }
  await airtable(`${TABLES.BLOQUEOS}/${body.bloqueoId}`, { method: 'DELETE' });
  return { ok: true };
}

// ---------- Capturar un evento a mano (➕ en el calendario) ----------
// Para los eventos que se apartaron fuera del chat (teléfono, en persona). Entra
// YA AUTORIZADO (sin cotización), con su checklist de carga; el cliente se busca
// por teléfono (si no existe se crea); el anticipo recibido queda como pago a
// Diana (así el cuadre y "por cobrar" ya lo saben). Diana y Víctor cualquier
// negocio; la gerente solo El Vaso Maíz.
const TABLA_CLIENTES = 'tblgViisKQRG9TVjh';
const TABLA_COBROS = 'tblb8ADFukpm6nRZV';
const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Depósito'];

function montoValido(valor) {
  const n = Math.round(Number(String(valor == null ? '' : valor).replace(/[$,\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= 10000000 ? n : null;
}

async function capturarEvento(colaborador, b) {
  const nombre = String(b.clienteNombre || '').trim().slice(0, 80);
  const tel = String(b.clienteTelefono || '').replace(/\D/g, '').slice(-10);
  const negocio = b.negocio;
  if (!nombre) return { error: 'Escribe el nombre del cliente.' };
  if (tel.length !== 10) return { error: 'El teléfono del cliente debe tener 10 dígitos.' };
  if (![NEGOCIOS.DV, NEGOCIOS.VM].includes(negocio)) return { error: 'Elige el negocio.' };
  if (colaborador.rol !== ROLES.ADMIN && !(colaborador.gerente && negocio === NEGOCIOS.VM)) return { error: 'Solo puedes capturar eventos de El Vaso Maíz.', codigo: 403 };
  if (!esFecha(b.fecha)) return { error: 'Elige la fecha del evento.' };
  const hora = String(b.hora || '');
  if (hora && !esHora(hora)) return { error: 'La hora debe ser como 18:00.' };
  const horas = b.horasServicio === '' || b.horasServicio == null ? null : Number(b.horasServicio);
  if (horas !== null && !(horas >= 1 && horas <= 12)) return { error: 'Las horas de servicio van de 1 a 12.' };
  const servicios = String(b.servicios || '').trim().slice(0, 4000);
  if (!servicios) return { error: 'Escribe qué lleva el evento (uno por línea).' };
  const contratado = montoValido(b.montoContratado);
  if (!contratado) return { error: 'Escribe el monto contratado.' };
  const anticipo = b.anticipo === '' || b.anticipo == null ? null : montoValido(b.anticipo);
  if (b.anticipo && !anticipo) return { error: 'El anticipo no es un monto válido.' };
  if (anticipo && !FORMAS_PAGO.includes(b.formaAnticipo)) return { error: 'Elige cómo se pagó el anticipo.' };
  if (anticipo && anticipo > contratado) return { error: 'El anticipo es mayor que lo contratado.' };
  const productos = normalizarProductos(Array.isArray(b.productos) ? b.productos : []);
  const invitados = Number(b.invitados) > 0 && Number(b.invitados) < 100000 ? Math.round(Number(b.invitados)) : null;

  // Cliente: el que ya tenga ese teléfono, o uno nuevo.
  let cliente = await buscarClientePorTelefono(tel);
  const clienteNuevo = !cliente;
  if (!cliente) {
    const nuevo = await airtable(TABLA_CLIENTES, { method: 'POST', body: JSON.stringify({ records: [{ fields: { Nombre: nombre, Telefono_WhatsApp: `+52${tel}`, Tipo_Cliente: 'Particular', Nivel: 'Nuevo' } }] }) });
    cliente = nuevo.records[0];
  }

  const folio = `EVT-${Date.now().toString().slice(-6)}`;
  const items = servicios.split('\n').map(s => s.trim()).filter(Boolean);
  const campos = {
    Folio_Evento: folio,
    Estado: 'Reservacion confirmada',
    Cliente: [cliente.id],
    Negocio: negocio,
    Fecha_Evento: b.fecha,
    Servicios_Solicitados: servicios,
    Autorizacion_Diana: 'SI',
    Monto_Estimado_IA: contratado,
    Items_Detallados_Cotizacion: items.join('\n'),
    Checklist_Items: items.join('\n'),
    Checklist_Items_Marcados: '[]',
    Notas: `Evento capturado a mano por ${colaborador.nombre} en el calendario (${fechaCorta()}).${b.notas ? '\n' + String(b.notas).slice(0, 2000) : ''}`,
    ...camposAgenda({ horaInicio: hora, horasServicio: horas, productos }),
  };
  if (String(b.ubicacion || '').trim()) campos.Ubicacion = String(b.ubicacion).trim().slice(0, 200);
  if (invitados) campos.Invitados = invitados;
  if (String(b.instrucciones || '').trim()) campos.Instrucciones_Equipo = String(b.instrucciones).trim().slice(0, 2000);
  const creado = await airtable(TABLES.EVENTOS, { method: 'POST', body: JSON.stringify({ records: [{ fields: campos }] }) });
  const eventoId = creado.records[0].id;

  // El anticipo ya recibido entra como pago a Diana (cuadre y por cobrar).
  let anticipoGuardado = false;
  if (anticipo) {
    await airtable(TABLA_COBROS, { method: 'POST', body: JSON.stringify({ records: [{ fields: {
      Concepto: `${folio} · anticipo a ${colaborador.nombre}`, Monto: anticipo, Forma: b.formaAnticipo, Fecha: hoyCuliacan(),
      Negocio: negocio, Evento: [eventoId], Recibido_Por: 'Diana', Reportado_Por: [colaborador.id],
    } }] }) });
    anticipoGuardado = true;
  }
  const google = await sincronizarEvento(eventoId);
  return { ok: true, eventoId, folio, clienteNuevo, cliente: cliente.fields ? cliente.fields.Nombre || nombre : nombre, anticipoGuardado, google };
}

// Pasa a Google los eventos autorizados de hoy en adelante que todavía no están
// (los autorizados antes de que existiera la sincronización). En tandas, para
// no pasar el tiempo límite de Vercel. Solo Admin.
const TANDA = 20;
async function sincronizarPendientes(colaborador) {
  if (colaborador.rol !== ROLES.ADMIN) return { error: 'Solo Diana y Víctor.', codigo: 403 };
  if (!googleConfigurado()) return { error: 'Google Calendar no está configurado en Vercel.' };
  const formula = `AND({Autorizacion_Diana} = "SI", NOT({Cancelado}), {Google_Evento_ID} = "", NOT(IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${hoyCuliacan()}"))))`;
  const pendientes = await todas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}&fields%5B%5D=Folio_Evento`);
  const tanda = pendientes.slice(0, TANDA);
  const errores = [];
  let pasados = 0;
  for (const r of tanda) {
    const s = await sincronizarEvento(r.id);
    if (s.ok) pasados++; else errores.push(`${r.fields.Folio_Evento || r.id}: ${s.error}`);
  }
  return { ok: true, pasados, faltan: pendientes.length - tanda.length, errores: errores.slice(0, 5) };
}

module.exports = {
  capturarEvento,
  sincronizarPendientes,
  NEGOCIOS,
  esEditor,
  puedeEditarEvento,
  googleConfigurado,
  sincronizarEvento,
  vistaMes,
  bloqueosProximos,
  mover,
  cancelar,
  bloquear,
  desbloquear,
  aGoogle,
};
