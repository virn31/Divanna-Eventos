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

const { crearEventoCalendar, agregarFilaCotizacion, enviarCotizacionPorCorreo } = require('./_google-integrations');
const { ROLES, COLABORADORES_TABLE, requerirSesion } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo } = require('./_telegram');

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

function itemsDeTexto(texto) {
  return (texto || '').split('\n').map(s => s.trim()).filter(Boolean);
}

// Colaboradores que trabajan el evento: los de la brigada asignada y la
// encargada (El Vaso Maíz). Si el evento aún no tiene a nadie, lista vacía.
async function asignadosDe(eventoFields) {
  const brigadas = eventoFields.Brigada_Asignada || [];
  const ids = new Set(eventoFields.Encargada || []);
  if (brigadas.length) {
    const data = await airtableGet(`${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent('{Activo}')}`);
    data.records.forEach(c => {
      if ((c.fields.Brigada || []).some(b => brigadas.includes(b))) ids.add(c.id);
    });
  }
  return [...ids];
}

async function avisarInstrucciones(eventoFields, texto) {
  const asignados = await asignadosDe(eventoFields);
  if (!asignados.length) return 0;
  const titulo = `📌 Instrucciones para ${eventoFields.Folio_Evento || 'tu evento'}`;
  const cuerpo = `${eventoFields.Ubicacion ? eventoFields.Ubicacion + ' · ' : ''}${eventoFields.Fecha_Evento || ''}\n${texto}`;
  await Promise.all([
    enviarPushEquipo({ titulo, cuerpo, soloColaboradores: asignados }),
    enviarTelegramEquipo({ texto: `${titulo}\n${cuerpo}`, soloColaboradores: asignados }),
  ]);
  return asignados.length;
}

async function resolverPedido(req, res) {
  const { eventoId, accion, monto, items } = req.body || {};
  const instrucciones = typeof (req.body || {}).instrucciones === 'string' ? req.body.instrucciones.trim().slice(0, 2000) : null;
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventoId || '') || !['autorizar', 'rechazar', 'instrucciones'].includes(accion)) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }

  const evento = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
  const f = evento.fields;

  if (accion === 'instrucciones') {
    if (instrucciones === null) { res.status(400).json({ error: 'Faltan las instrucciones' }); return; }
    await airtablePatch(TABLES.EVENTOS, eventoId, { Instrucciones_Equipo: instrucciones });
    // Solo se avisa si hay algo escrito y cambió.
    const avisados = instrucciones && instrucciones !== (f.Instrucciones_Equipo || '').trim()
      ? await avisarInstrucciones(f, instrucciones)
      : 0;
    res.status(200).json({ success: true, avisados });
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
  });

  // Integraciones de Google: igual que cuando Diana decía SI por WhatsApp. Si
  // fallan no se deshace la autorización, solo se reporta.
  let googleOk = true;
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
      crearEventoCalendar(datosEvento),
      agregarFilaCotizacion({ ...datosEvento, clienteNombre, clienteTelefono }),
      clienteEmail ? enviarCotizacionPorCorreo({ ...datosEvento, emailCliente: clienteEmail }) : Promise.resolve(true),
    ]);
    googleOk = resultados.every(Boolean);
  } catch (err) {
    console.error('Error en integraciones de Google al autorizar:', err.message);
    googleOk = false;
  }

  res.status(200).json({ success: true, googleOk });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'POST') {
    try {
      if (!(await requerirSesion(req, res, [ROLES.ADMIN]))) return;
      await resolverPedido(req, res);
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
        notas: r.fields.Notas || '',
        clienteNombre: c.Nombre || '',
        clienteTelefono: c.Telefono_WhatsApp || '',
        clienteEmail: c.Email || '',
      };
    });

    res.status(200).json({ eventos, pedidos, balance: await ultimoBalance() });
  } catch (err) {
    console.error('Error en dashboard-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
