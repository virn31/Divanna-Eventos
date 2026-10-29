// api/dashboard-eventos.js
// Vista general para Diana y Víctor: TODAS las brigadas, TODOS los eventos
// activos del día (y próximos), con su estatus logístico, retrasos,
// emergencias, alertas de seguridad, y estatus de pago -- todo en tiempo real.
// Requiere sesión con rol Admin (api/_sesion.js).
//
// POST: Diana autoriza o rechaza la cotización de un pedido (antes respondía
// SI / NO por WhatsApp). Al autorizar se genera el checklist de carga y se
// agenda en Calendar, se registra en Sheets y se manda correo al cliente.
// POST accion "instrucciones": Diana guarda instrucciones extra de un evento
// (Instrucciones_Equipo); se avisa por push y Telegram solo al equipo asignado.
// POST accion "mensaje_cliente": Diana deja un mensaje para el cliente
// (Mensaje_Para_Cliente); DiMa se lo entrega en el chat si está esperando o
// cuando regrese con su número de pedido.
// POST accion "asignar": Diana asigna la brigada y la encargada (El Vaso Maíz)
// de un evento; se avisa por push y Telegram solo a quien se acaba de sumar y
// se responde cuántos avisos se entregaron de verdad. Si cambia el equipo, se
// borra el "Enterado" anterior (lo vuelve a confirmar el equipo nuevo).
// La gerente de El Vaso Maíz también puede asignar, solo en eventos de El Vaso
// Maíz; en ese caso se avisa a Diana y Víctor por Telegram.
// En "asignar" también puede venir produccionId: el encargado de producción de
// El Vaso Maíz (api/_produccion.js); si cambia, se le avisa.
// POST accion "confirmar_cambio" / "descartar_cambio": Diana confirma (se aplica y
// se avisa al equipo) o descarta el cambio que pidió el cliente en un pedido ya
// autorizado (api/_cambios.js).
// POST accion "invitar_staff": la gerente (o un Admin) invita a sus chicas a un
// evento autorizado de El Vaso Maíz desde la app; es lo mismo que /staff en
// Telegram y les llega la invitación con "Sí puedo / No puedo".

const { crearEventoCalendar, agregarFilaCotizacion, enviarCotizacionPorCorreo } = require('./_google-integrations');
const { ROLES, COLABORADORES_TABLE, requerirSesion, esVasoMaiz } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo } = require('./_telegram');
const { botonConfirmar } = require('./_eventos');
const { enTemporadaAlta } = require('./_temporada');
const { normalizarProductos, leerProductos, catalogoParaDashboard, normalizarArticulos, leerArticulos, inventarioRequerido, coberturaArticulos, textoPorAsignar } = require('./_productos');
const { camposAgenda, HORAS_RESPUESTA } = require('./_pedidos');
const { staffPorEvento, invitarDesdeApp } = require('./_staff');
const { opcionesProduccion, avisarAsignacion } = require('./_produccion');
const { confirmarCambio, descartarCambio } = require('./_cambios');
const { leerCambio } = require('./_pedidos');
const { cargarInventario, cargarPersonal, eventoParaAgenda, evaluarDisponibilidad, PERSONAL_BASE_VASO_MAIZ } = require('./_agenda');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  CLIENTES: 'tblgViisKQRG9TVjh',
  BALANCES: 'tblRJYJHhHzyKcaWH',
};

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function airtablePatch(tableId, recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ id: recordId, fields }] }),
  });
  if (!res.ok) throw new Error(`Airtable PATCH error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Datos de los clientes vinculados a los pedidos pendientes, en una sola consulta.
async function clientesPorId(ids) {
  if (!ids.length) return {};
  const formula = encodeURIComponent(`OR(${ids.map(id => `RECORD_ID()="${id}"`).join(',')})`);
  const data = await airtableGet(`${TABLES.CLIENTES}?filterByFormula=${formula}`);
  const mapa = {};
  data.records.forEach(c => { mapa[c.id] = c.fields; });
  return mapa;
}

async function ultimoBalance() {
  try {
    const data = await airtableGet(`${TABLES.BALANCES}?maxRecords=1&sort%5B0%5D%5Bfield%5D=Fecha_Fin&sort%5B0%5D%5Bdirection%5D=desc`);
    const b = data.records[0];
    if (!b) return null;
    return {
      periodo: b.fields.Nombre_Periodo || '',
      ingresos: b.fields.Ingresos_Totales || 0,
      gastos: b.fields.Gastos_Totales || 0,
      detalle: b.fields.Detalle_Completo || '',
    };
  } catch (err) {
    console.error('No se pudo leer el último balance:', err.message);
    return null;
  }
}

function agendaParaVista(f) {
  return {
    horaInicio: f.Hora_Inicio || '',
    horasServicio: f.Horas_Servicio || null,
    productos: leerProductos(f.Productos),
    articulos: leerArticulos(f.Articulos),
    personalRequerido: f.Personal_Requerido || 0,
    resumenCapacidad: f.Resumen_Capacidad || '',
  };
}

// Lo que el evento pide y todavía no tiene modelo y color asignados.
function porAsignar(item, inventario) {
  return textoPorAsignar(coberturaArticulos(inventarioRequerido(item.productos), item.articulos, inventario));
}

function itemsDeTexto(texto) {
  return (texto || '').split('\n').map(s => s.trim()).filter(Boolean);
}

// Colaboradores que trabajan el evento: los de la brigada asignada y la
// encargada (El Vaso Maíz). Si el evento aún no tiene a nadie, lista vacía.
function equipoDe(eventoFields, colaboradores) {
  const brigadas = eventoFields.Brigada_Asignada || [];
  const ids = new Set(eventoFields.Encargada || []);
  colaboradores.forEach(c => {
    if ((c.fields.Brigada || []).some(b => brigadas.includes(b))) ids.add(c.id);
  });
  return [...ids];
}

async function colaboradoresActivos() {
  const data = await airtableGet(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent('{Activo}')}`);
  return data.records;
}

async function asignadosDe(eventoFields) {
  if (!(eventoFields.Brigada_Asignada || []).length) return [...new Set(eventoFields.Encargada || [])];
  return equipoDe(eventoFields, await colaboradoresActivos());
}

async function avisarInstrucciones(eventoId, eventoFields, texto) {
  const asignados = await asignadosDe(eventoFields);
  if (!asignados.length) return 0;
  const titulo = `📌 Instrucciones para ${eventoFields.Folio_Evento || 'tu evento'}`;
  const cuerpo = `${eventoFields.Ubicacion ? eventoFields.Ubicacion + ' · ' : ''}${eventoFields.Fecha_Evento || ''}\n${texto}`;
  await Promise.all([
    enviarPushEquipo({ titulo, cuerpo, soloColaboradores: asignados }),
    enviarTelegramEquipo({ texto: `${titulo}\n${cuerpo}`, soloColaboradores: asignados, botones: botonConfirmar(eventoId) }),
  ]);
  return asignados.length;
}

// Hora, horas de servicio y productos que Diana ajusta en el dashboard. Solo
// toca lo que viene en la petición; una lista de productos vacía los borra.
function agendaDesdeDashboard(body, inventario) {
  const b = body || {};
  const datos = {
    horaInicio: /^([01]\d|2[0-3]):[0-5]\d$/.test(b.horaInicio || '') ? b.horaInicio : '',
    horasServicio: Number(b.horasServicio) >= 0.5 && Number(b.horasServicio) <= 24 ? Number(b.horasServicio) : null,
    productos: normalizarProductos(b.productos),
  };
  const campos = camposAgenda(datos);
  if (b.horaInicio === '') campos.Hora_Inicio = '';
  if (Array.isArray(b.productos) && !datos.productos.length) {
    Object.assign(campos, { Productos: '', Piezas_Vaso_Maiz: 0, Personal_Requerido: 0, Resumen_Capacidad: '' });
  } else if (!Array.isArray(b.productos) && datos.horasServicio) {
    delete campos.Horas_Servicio; // sin productos no se puede recalcular el personal
  }
  if (Array.isArray(b.articulos)) {
    const articulos = normalizarArticulos(b.articulos, inventario);
    campos.Articulos = articulos.length ? JSON.stringify(articulos) : '';
  }
  return campos;
}

async function resolverPedido(req, res, colaborador) {
  const { eventoId, accion, monto, items } = req.body || {};
  const instrucciones = typeof (req.body || {}).instrucciones === 'string' ? req.body.instrucciones.trim().slice(0, 2000) : null;
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventoId || '') || !['autorizar', 'rechazar', 'instrucciones', 'mensaje_cliente', 'agenda', 'asignar', 'invitar_staff', 'confirmar_cambio', 'descartar_cambio'].includes(accion)) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }

  const evento = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
  const f = evento.fields;
  // Solo se lee INVENTARIO si Diana mandó artículos (para validar y guardar su nombre).
  const inventario = Array.isArray((req.body || {}).articulos) ? await cargarInventario() : [];

  if (accion === 'mensaje_cliente') {
    const mensaje = typeof (req.body || {}).mensaje === 'string' ? req.body.mensaje.trim().slice(0, 1500) : '';
    if (!mensaje) { res.status(400).json({ error: 'Escribe el mensaje para el cliente' }); return; }
    await airtablePatch(TABLES.EVENTOS, eventoId, { Mensaje_Para_Cliente: mensaje, Mensaje_Cliente_Entregado: false });
    res.status(200).json({ success: true });
    return;
  }

  if (accion === 'instrucciones') {
    if (instrucciones === null) { res.status(400).json({ error: 'Faltan las instrucciones' }); return; }
    await airtablePatch(TABLES.EVENTOS, eventoId, { Instrucciones_Equipo: instrucciones });
    // Solo se avisa si hay algo escrito y cambió.
    const avisados = instrucciones && instrucciones !== (f.Instrucciones_Equipo || '').trim()
      ? await avisarInstrucciones(eventoId, f, instrucciones)
      : 0;
    res.status(200).json({ success: true, avisados });
    return;
  }

  if (accion === 'asignar') {
    const esAdmin = colaborador.rol === ROLES.ADMIN;
    if (!esAdmin && !esVasoMaiz(f)) {
      res.status(403).json({ error: 'Solo puedes asignar eventos de El Vaso Maíz.' });
      return;
    }
    const b = req.body || {};
    const brigadaId = typeof b.brigadaId === 'string' ? b.brigadaId : '';
    if ((brigadaId && !/^rec[A-Za-z0-9]{14}$/.test(brigadaId)) || !Array.isArray(b.encargadaIds)) {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }
    // Encargado de producción (opcional; solo si viene en la petición): debe estar
    // entre las opciones de quien asigna. '' lo quita.
    const cambiaProduccion = typeof b.produccionId === 'string';
    if (cambiaProduccion && b.produccionId) {
      const opciones = await opcionesProduccion(colaborador);
      if (!opciones.some(o => o.id === b.produccionId)) {
        res.status(400).json({ error: 'Esa persona no puede ser encargada de producción.' });
        return;
      }
    }
    const produccionAntes = (f.Encargado_Produccion || [])[0] || '';
    const colaboradores = await colaboradoresActivos();
    // Solo se aceptan encargadas activas con ese rol.
    const encargadas = colaboradores.filter(c => c.fields.Rol === ROLES.ENCARGADA && b.encargadaIds.includes(c.id)).map(c => c.id);
    const campos = { Brigada_Asignada: brigadaId ? [brigadaId] : [], Encargada: encargadas };
    if (cambiaProduccion) campos.Encargado_Produccion = b.produccionId ? [b.produccionId] : [];
    const antes = equipoDe(f, colaboradores);
    const despues = equipoDe({ ...f, ...campos }, colaboradores);
    const nuevos = despues.filter(id => !antes.includes(id));
    if (nuevos.length || antes.length !== despues.length) Object.assign(campos, { Enterado_Por: '', Enterado_Hora: null });
    await airtablePatch(TABLES.EVENTOS, eventoId, campos);
    let porTelegram = 0, porPush = 0;
    const erroresAvisos = [];
    if (nuevos.length) {
      const titulo = `🗓️ Te asignaron ${f.Folio_Evento || 'un evento'}`;
      const cuerpo = `${f.Ubicacion ? f.Ubicacion + ' · ' : ''}${f.Fecha_Evento || ''}${f.Hora_Inicio ? ' · ' + f.Hora_Inicio : ''}\nConfirma que lo viste con el botón o en la app ("Enterado").`;
      [porPush, porTelegram] = await Promise.all([
        enviarPushEquipo({ titulo, cuerpo, soloColaboradores: nuevos }),
        enviarTelegramEquipo({ texto: `${titulo}\n${cuerpo}`, soloColaboradores: nuevos, errores: erroresAvisos, botones: botonConfirmar(eventoId) }),
      ]);
    }
    if (!esAdmin) {
      const brigada = brigadaId ? (await airtableGet(`${TABLES.BRIGADAS}/${brigadaId}`)).fields.Nombre_Brigada : 'sin brigada';
      const nombres = colaboradores.filter(c => encargadas.includes(c.id)).map(c => c.fields.Nombre).join(', ');
      await enviarTelegramEquipo({
        roles: [ROLES.ADMIN],
        texto: `👷 ${colaborador.nombre} asignó ${f.Folio_Evento || 'un evento'}: ${brigada}${nombres ? ' · encargada: ' + nombres : ''}`
          + `${cambiaProduccion && b.produccionId ? ' · producción: ' + ((colaboradores.find(c => c.id === b.produccionId) || {}).fields || {}).Nombre : ''}.`,
      }).catch(err => console.error('Error avisando asignación de la gerente:', err));
    }
    // Nuevo encargado de producción: lista ya si faltan 2 días o menos; si no, aviso corto.
    let produccion = null;
    if (cambiaProduccion && b.produccionId && b.produccionId !== produccionAntes) {
      produccion = await avisarAsignacion(b.produccionId, { folio: f.Folio_Evento, fecha: f.Fecha_Evento })
        .catch(err => { console.error('Error avisando producción:', err.message); return { enviados: [], fallidos: [{ nombre: 'el encargado de producción', motivo: 'error al enviar' }] }; });
    }
    const nuevosColab = colaboradores.filter(c => nuevos.includes(c.id));
    res.status(200).json({
      success: true,
      produccion,
      avisados: nuevos.length,
      porTelegram,
      porPush,
      conTelegram: nuevosColab.filter(c => c.fields.Telegram_Chat_ID).length,
      sinTelegram: nuevosColab.filter(c => !c.fields.Telegram_Chat_ID).map(c => c.fields.Nombre || ''),
      erroresAvisos,
    });
    return;
  }

  if (accion === 'confirmar_cambio') {
    const r = await confirmarCambio(eventoId, f, colaborador, await colaboradoresActivos());
    if (r.error) { res.status(409).json({ error: r.error }); return; }
    res.status(200).json({ success: true, ...r });
    return;
  }

  if (accion === 'descartar_cambio') {
    const r = await descartarCambio(eventoId, f, colaborador);
    if (r.error) { res.status(409).json({ error: r.error }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (accion === 'invitar_staff') {
    const ids = (req.body || {}).colaboradorIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 60 || !ids.every(id => /^rec[A-Za-z0-9]{14}$/.test(id))) {
      res.status(400).json({ error: 'Elige al menos a una persona.' });
      return;
    }
    const r = await invitarDesdeApp(colaborador, eventoId, ids);
    if (!r) { res.status(403).json({ error: 'Solo se invita staff a eventos autorizados de El Vaso Maíz de hoy en adelante.' }); return; }
    res.status(200).json({ success: true, enviadas: r.enviadas, fallidas: r.fallidas });
    return;
  }

  if (accion === 'agenda') {
    const campos = agendaDesdeDashboard(req.body, inventario);
    if (!Object.keys(campos).length) { res.status(400).json({ error: 'Nada que guardar' }); return; }
    await airtablePatch(TABLES.EVENTOS, eventoId, campos);
    res.status(200).json({ success: true, resumen: campos.Resumen_Capacidad || '' });
    return;
  }

  if (accion === 'rechazar') {
    await airtablePatch(TABLES.EVENTOS, eventoId, { Autorizacion_Diana: 'NO' });
    res.status(200).json({ success: true });
    return;
  }

  const montoNum = Number(monto);
  const listaItems = itemsDeTexto(items || f.Servicios_Solicitados);
  if (!(montoNum > 0) || !listaItems.length) {
    res.status(400).json({ error: 'Pon el monto y al menos un artículo para el checklist' });
    return;
  }

  await airtablePatch(TABLES.EVENTOS, eventoId, {
    Autorizacion_Diana: 'SI',
    Monto_Estimado_IA: montoNum,
    Items_Detallados_Cotizacion: listaItems.join('\n'),
    Checklist_Items: listaItems.join('\n'),
    Checklist_Items_Marcados: '[]',
    ...(instrucciones !== null ? { Instrucciones_Equipo: instrucciones } : {}),
    ...agendaDesdeDashboard(req.body, inventario),
  });

  // Integraciones de Google: igual que cuando Diana decía SI por WhatsApp. Si
  // fallan no se deshace la autorización, solo se reporta.
  let googleOk = true;
  const erroresGoogle = [];
  try {
    let clienteNombre = '', clienteTelefono = '', clienteEmail = '';
    if (f.Cliente && f.Cliente[0]) {
      const cliente = await airtableGet(`${TABLES.CLIENTES}/${f.Cliente[0]}`);
      clienteNombre = cliente.fields.Nombre || '';
      clienteTelefono = cliente.fields.Telefono_WhatsApp || '';
      clienteEmail = cliente.fields.Email || '';
    }
    const datosEvento = {
      folio: f.Folio_Evento,
      negocio: f.Negocio,
      fechaEvento: f.Fecha_Evento,
      ubicacion: f.Ubicacion,
      invitados: f.Invitados,
      servicios: listaItems.join(', '),
      monto: montoNum,
    };
    const resultados = await Promise.all([
      crearEventoCalendar(datosEvento, erroresGoogle),
      agregarFilaCotizacion({ ...datosEvento, clienteNombre, clienteTelefono }, erroresGoogle),
      clienteEmail ? enviarCotizacionPorCorreo({ ...datosEvento, emailCliente: clienteEmail }, erroresGoogle) : Promise.resolve(true),
    ]);
    googleOk = resultados.every(Boolean);
  } catch (err) {
    console.error('Error en integraciones de Google al autorizar:', err.message);
    erroresGoogle.push(err.message);
    googleOk = false;
  }

  res.status(200).json({ success: true, googleOk, erroresGoogle });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'POST') {
    try {
      const colaborador = await requerirSesion(req, res, [ROLES.ADMIN, ROLES.LIDER, ROLES.ENCARGADA]);
      if (!colaborador) return;
      // Fuera de Admin, solo la gerente de El Vaso Maíz y solo para asignar o invitar staff.
      if (colaborador.rol !== ROLES.ADMIN && !(colaborador.gerente && ['asignar', 'invitar_staff'].includes((req.body || {}).accion))) {
        res.status(403).json({ error: 'Tu rol no tiene acceso a esta sección.' });
        return;
      }
      await resolverPedido(req, res, colaborador);
    } catch (err) {
      console.error('Error resolviendo pedido:', err);
      res.status(500).json({ error: 'Error interno, intenta de nuevo' });
    }
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    if (!(await requerirSesion(req, res, [ROLES.ADMIN]))) return;

    // Traemos todas las brigadas (para el nombre/vehículo/líder de cada una)
    const brigadasData = await airtableGet(`${TABLES.BRIGADAS}`);
    const brigadasPorId = {};
    brigadasData.records.forEach(b => { brigadasPorId[b.id] = b.fields; });

    // Traemos todos los eventos no cerrados
    const eventFormula = encodeURIComponent('{Estado} != "Cerrado"');
    const eventosData = await airtableGet(
      `${TABLES.EVENTOS}?filterByFormula=${eventFormula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`
    );

    const eventos = eventosData.records.map(r => {
      const brigadaIds = r.fields.Brigada_Asignada || [];
      const brigadaInfo = brigadaIds.length ? brigadasPorId[brigadaIds[0]] : null;

      return {
        id: r.id,
        folio: r.fields.Folio_Evento || '',
        negocio: r.fields.Negocio || '',
        fecha: r.fields.Fecha_Evento || '',
        ubicacion: r.fields.Ubicacion || '',
        invitados: r.fields.Invitados || null,
        brigadaId: brigadaIds[0] || '',
        encargadaIds: r.fields.Encargada || [],
        enteradoPor: r.fields.Enterado_Por || '',
        enteradoHora: r.fields.Enterado_Hora || '',
        brigadaNombre: brigadaInfo ? brigadaInfo.Nombre_Brigada : 'Sin asignar',
        brigadaLider: brigadaInfo ? brigadaInfo.Lider : '',
        estatusLogistico: r.fields.Estatus_Logistico || 'Preparando',
        retraso: !!r.fields.Retraso,
        motivoRetraso: r.fields.Motivo_Retraso || '',
        emergencia: !!r.fields.Emergencia,
        motivoEmergencia: r.fields.Motivo_Emergencia || '',
        zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
        etaConfirmado: r.fields.ETA_Confirmado_Brigada || '',
        estatusPago: r.fields.Estatus_Pago || '',
        montoAdeudado: r.fields.Monto_Adeudado || null,
        autorizacionDiana: r.fields.Autorizacion_Diana || '',
        instrucciones: r.fields.Instrucciones_Equipo || '',
        fueraDeCiudad: !!r.fields.Fuera_De_Ciudad,
        ubicacionAlerta: r.fields.Ubicacion_Alerta || '',
        ubicacionAlertaHora: r.fields.Ubicacion_Alerta_Hora || '',
        preferenciaContacto: r.fields.Preferencia_Contacto || '',
        mensajeParaCliente: r.fields.Mensaje_Para_Cliente || '',
        mensajeEntregado: !!r.fields.Mensaje_Cliente_Entregado,
        temporadaAlta: enTemporadaAlta(r.fields.Fecha_Evento),
        cambioCliente: leerCambio(r.fields.Cambio_Cliente),
        ...agendaParaVista(r.fields),
      };
    });

    // Pedidos de la landing esperando cotización de Diana
    const pendientes = eventosData.records.filter(r => r.fields.Autorizacion_Diana === 'Pendiente');
    const clientes = await clientesPorId([...new Set(pendientes.map(r => (r.fields.Cliente || [])[0]).filter(Boolean))]);
    const pedidos = pendientes.map(r => {
      const c = clientes[(r.fields.Cliente || [])[0]] || {};
      return {
        id: r.id,
        folio: r.fields.Folio_Evento || '',
        negocio: r.fields.Negocio || '',
        fecha: r.fields.Fecha_Evento || '',
        ubicacion: r.fields.Ubicacion || '',
        invitados: r.fields.Invitados || null,
        servicios: r.fields.Servicios_Solicitados || '',
        montoEstimado: r.fields.Monto_Estimado_IA || null,
        instrucciones: r.fields.Instrucciones_Equipo || '',
        fueraDeCiudad: !!r.fields.Fuera_De_Ciudad,
        preferenciaContacto: r.fields.Preferencia_Contacto || '',
        mensajeParaCliente: r.fields.Mensaje_Para_Cliente || '',
        mensajeEntregado: !!r.fields.Mensaje_Cliente_Entregado,
        temporadaAlta: enTemporadaAlta(r.fields.Fecha_Evento),
        cambioCliente: leerCambio(r.fields.Cambio_Cliente),
        ...agendaParaVista(r.fields),
        // DiMa le promete al cliente respuesta en 12 h o menos desde que registra.
        limiteRespuesta: r.createdTime ? new Date(Date.parse(r.createdTime) + HORAS_RESPUESTA * 3600 * 1000).toISOString() : '',
        notas: r.fields.Notas || '',
        clienteNombre: c.Nombre || '',
        clienteTelefono: c.Telefono_WhatsApp || '',
        clienteEmail: c.Email || '',
      };
    });

    const balance = await ultimoBalance();
    // El inventario se lee al final: si falla, el dashboard sigue funcionando sin el selector de artículos.
    const inventario = await cargarInventario().catch(err => { console.error('No se pudo leer INVENTARIO:', err.message); return []; });
    const personalPorFecha = await cargarPersonal().catch(err => { console.error('No se pudo leer PERSONAL_DIA:', err.message); return {}; });
    // Semáforo en vivo: cada pedido y evento contra los demás eventos autorizados.
    const paraAgenda = eventosData.records.map(eventoParaAgenda);
    const porId = new Map(paraAgenda.map(e => [e.id, e]));
    const staff = await staffPorEvento().catch(err => { console.error('No se pudo leer STAFF_EVENTO:', err.message); return {}; });
    [...eventos, ...pedidos].forEach(item => {
      item.staff = staff[item.id] || [];
      item.porAsignar = porAsignar(item, inventario);
      const ev = porId.get(item.id);
      item.disponibilidad = ev ? evaluarDisponibilidad(ev, { otros: paraAgenda, inventario, personalPorFecha }) : null;
    });
    // Opciones para asignar: todas las brigadas y las encargadas activas.
    const brigadas = brigadasData.records.map(b => ({ id: b.id, nombre: b.fields.Nombre_Brigada || 'Brigada', lider: b.fields.Lider || '' }));
    const encargadas = await colaboradoresActivos()
      .then(cs => cs.filter(c => c.fields.Rol === ROLES.ENCARGADA).map(c => ({ id: c.id, nombre: c.fields.Nombre || '' })))
      .catch(err => { console.error('No se pudo leer COLABORADORES:', err.message); return []; });
    res.status(200).json({ eventos, pedidos, balance, catalogo: catalogoParaDashboard(), inventario, personalBase: PERSONAL_BASE_VASO_MAIZ, brigadas, encargadas });
  } catch (err) {
    console.error('Error en dashboard-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
