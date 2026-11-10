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

const { enviarCotizacionPorCorreo } = require('./_google-integrations');
const C = require('./_calendario');
const { sincronizarEvento } = C;
const { ROLES, COLABORADORES_TABLE, requerirSesion, esVasoMaiz, esDeSuGerencia, GERENCIAS, NOMBRE_GERENCIA, gerenciaDe, puestoGerente, eleccionDeEvento } = require('./_sesion');
const { enviarPushEquipo } = require('./_push');
const { enviarTelegramEquipo, esSinSaldo, avisarSinSaldo, MENSAJE_SIN_SALDO_EQUIPO } = require('./_telegram');
const { botonConfirmar } = require('./_eventos');
const { enTemporadaAlta } = require('./_temporada');
const { tieneDescuento, conDescuento, redondo } = require('./_decorador');
const { origenDePersona } = require('./_origen');
const { normalizarProductos, leerProductos, resumenManteles, infoManteles, catalogoParaDashboard, normalizarArticulos, leerArticulos, inventarioRequerido, coberturaArticulos, textoPorAsignar } = require('./_productos');
const { camposAgenda, HORAS_RESPUESTA } = require('./_pedidos');
const { staffPorEvento, invitarDesdeApp, staffParaApp } = require('./_staff');
const { opcionesProduccion, avisarAsignacion } = require('./_produccion');
const { avisarEquipoProduccion } = require('./_etapas');
const { confirmarCambio, descartarCambio, avisarEquipoCambio } = require('./_cambios');
const Comanda = require('./_comanda');
const { enviarRecibo } = require('./_sheets');
const { leerCambio, notasSinConversacion } = require('./_pedidos');
const { porCobrarPeriodo } = require('./_finanzas');
const { aclarar } = require('./_cuadre');
const { dineroParaApp } = require('./_cargos');
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

// Datos de los clientes vinculados a pedidos y eventos. De 90 en 90 para no
// pasar el máximo de 100 registros por página de Airtable.
async function clientesPorId(ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 90) {
    const grupo = ids.slice(i, i + 90);
    const formula = encodeURIComponent(`OR(${grupo.map(id => `RECORD_ID()="${id}"`).join(',')})`);
    const data = await airtableGet(`${TABLES.CLIENTES}?filterByFormula=${formula}`);
    data.records.forEach(c => { mapa[c.id] = c.fields; });
  }
  return mapa;
}

// ✏️ Diana corrige a mano los datos del evento y del cliente desde el dashboard.
// Solo se escriben los campos que vienen en la petición. Si el evento no tiene
// cliente y se escribe un nombre o teléfono, se crea el cliente y se vincula.
// También el pedido (decisión de Víctor 2026-11-03): lo que se pidió (que en un
// evento autorizado es también la lista de carga) y el monto (solo Admin; la
// gerente no ve montos). Si cambia lo pedido de un evento autorizado se avisa
// al equipo igual que un cambio del cliente confirmado.
const TEXTO = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

// Al cambiar la lista de carga se conservan las palomitas de los artículos que
// siguen igual (las marcas guardan el número de renglón, no el texto).
function marcadosConservados(viejos, marcadosJson, nuevos) {
  let marcados = [];
  try { marcados = JSON.parse(marcadosJson || '[]'); } catch (e) { marcados = []; }
  const pendientes = marcados.map(i => viejos[i]).filter(t => t !== undefined);
  const resultado = [];
  nuevos.forEach((t, j) => {
    const k = pendientes.indexOf(t);
    if (k !== -1) { resultado.push(j); pendientes.splice(k, 1); }
  });
  return JSON.stringify(resultado);
}

async function editarEvento(eventoId, f, body, colaborador) {
  const evento = {};
  const esAdmin = colaborador.rol === ROLES.ADMIN;
  const autorizado = f.Autorizacion_Diana === 'SI';
  let pedidoCambio = false;
  if (body.servicios !== undefined) {
    const lista = itemsDeTexto(TEXTO(body.servicios, 5000));
    // Vacío solo se acepta si ya estaba vacío (pedidos viejos sin lista).
    if (!lista.length && itemsDeTexto(f.Servicios_Solicitados).length) return { error: 'El pedido no puede quedar vacío' };
    const texto = lista.join('\n');
    if (lista.length && texto !== itemsDeTexto(f.Servicios_Solicitados).join('\n')) {
      pedidoCambio = true;
      evento.Servicios_Solicitados = texto;
      if (autorizado) {
        evento.Items_Detallados_Cotizacion = texto;
        evento.Checklist_Items = texto;
        evento.Checklist_Items_Marcados = marcadosConservados(itemsDeTexto(f.Checklist_Items), f.Checklist_Items_Marcados, lista);
      }
    }
  }
  if (body.monto !== undefined && body.monto !== '' && body.monto !== null) {
    if (!esAdmin) return { error: 'Solo Diana o Víctor cambian el monto.', codigo: 403 };
    const monto = Number(body.monto);
    if (!(monto > 0 && monto < 10000000)) return { error: 'Monto inválido' };
    evento.Monto_Estimado_IA = Math.round(monto * 100) / 100;
  }
  const avisar = autorizado && pedidoCambio && body.avisarEquipo !== false;
  if (avisar) {
    // El equipo vuelve a confirmar que vio el evento con el cambio.
    evento.Enterado_Por = '';
    evento.Enterado_Hora = null;
    evento.Notas = `${f.Notas || ''}\n--- Pedido modificado a mano por ${colaborador.nombre} (${new Date().toISOString().slice(0, 10)}) ---`.slice(-90000);
  }
  const ubicacion = TEXTO(body.ubicacion, 500);
  if (ubicacion !== undefined) evento.Ubicacion = ubicacion;
  if (body.fecha !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha || '')) return { error: 'Fecha inválida' };
    evento.Fecha_Evento = body.fecha;
  }
  if (body.invitados !== undefined) {
    const n = body.invitados === '' || body.invitados === null ? null : Number(body.invitados);
    if (n !== null && !(Number.isInteger(n) && n > 0 && n < 100000)) return { error: 'Invitados inválidos' };
    evento.Invitados = n;
  }
  if (typeof body.fueraDeCiudad === 'boolean') evento.Fuera_De_Ciudad = body.fueraDeCiudad;

  const cliente = {};
  const nombre = TEXTO(body.clienteNombre, 200);
  if (nombre !== undefined) cliente.Nombre = nombre;
  if (body.clienteTelefono !== undefined) {
    const digitos = String(body.clienteTelefono || '').replace(/\D/g, '');
    if (digitos && digitos.length < 10) return { error: 'El teléfono debe tener 10 dígitos' };
    // Mismo formato que los clientes de la página (+52 y 10 dígitos).
    cliente.Telefono_WhatsApp = !digitos ? '' : digitos.length === 10 ? `+52${digitos}` : `+${digitos}`;
  }
  const email = TEXTO(body.clienteEmail, 200);
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Correo inválido' };
    cliente.Email = email;
  }

  const clienteId = (f.Cliente || [])[0];
  if (clienteId && Object.keys(cliente).length) {
    await airtablePatch(TABLES.CLIENTES, clienteId, cliente);
  } else if (!clienteId && (cliente.Nombre || cliente.Telefono_WhatsApp)) {
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLES.CLIENTES}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: { Tipo_Cliente: 'Particular', Nivel: 'Nuevo', ...cliente } }] }),
    });
    if (!res.ok) throw new Error(`Airtable POST error ${res.status}: ${await res.text()}`);
    evento.Cliente = [(await res.json()).records[0].id];
  }
  if (Object.keys(evento).length) await airtablePatch(TABLES.EVENTOS, eventoId, evento);
  // Fecha, lugar o pedido distintos: se actualiza Google Calendar.
  const google = evento.Fecha_Evento !== undefined || evento.Ubicacion !== undefined || pedidoCambio ? await sincronizarEvento(eventoId) : null;
  const aviso = avisar
    ? await avisarEquipoCambio(eventoId, { ...f, ...evento }, colaborador, await colaboradoresActivos(), {
      servicios: evento.Servicios_Solicitados,
      explicacion: `${colaborador.nombre || 'La gerencia'} modificó el pedido. Ahora lleva:`,
    })
    : null;
  return { google, aviso };
}

async function ultimoBalance() {
  try {
    const data = await airtableGet(`${TABLES.BALANCES}?maxRecords=1&sort%5B0%5D%5Bfield%5D=Fecha_Fin&sort%5B0%5D%5Bdirection%5D=desc`);
    const b = data.records[0];
    if (!b) return null;
    // Por cobrar se recalcula en vivo (si un cliente paga después del lunes, baja).
    // Si no se puede, se usa lo guardado ese lunes y se dice; si tampoco hay, null.
    let porCobrar = null, porCobrarGuardado = false;
    if (b.fields.Fecha_Inicio && b.fields.Fecha_Fin) {
      porCobrar = await porCobrarPeriodo(b.fields.Fecha_Inicio, b.fields.Fecha_Fin).then(r => r.total)
        .catch(err => { console.error('No se pudo calcular por cobrar:', err.message); return null; });
    }
    if (porCobrar === null && typeof b.fields.Por_Cobrar === 'number') { porCobrar = b.fields.Por_Cobrar; porCobrarGuardado = true; }
    return {
      periodo: b.fields.Nombre_Periodo || '',
      ingresos: b.fields.Ingresos_Totales || 0,
      gastos: b.fields.Gastos_Totales || 0,
      porCobrar,
      porCobrarGuardado,
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
  if (!/^rec[A-Za-z0-9]{14}$/.test(eventoId || '') || !['autorizar', 'rechazar', 'instrucciones', 'mensaje_cliente', 'agenda', 'asignar', 'invitar_staff', 'confirmar_cambio', 'descartar_cambio', 'editar'].includes(accion)) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }

  const evento = await airtableGet(`${TABLES.EVENTOS}/${eventoId}`);
  const f = evento.fields;
  // Solo se lee INVENTARIO si Diana mandó artículos (para validar y guardar su nombre).
  const inventario = Array.isArray((req.body || {}).articulos) ? await cargarInventario() : [];

  if (accion === 'editar') {
    // Cada gerente edita solo eventos de su negocio (igual que al asignar).
    if (colaborador.rol !== ROLES.ADMIN && !esDeSuGerencia(colaborador, f)) {
      res.status(403).json({ error: `Solo puedes editar eventos de ${NOMBRE_GERENCIA[colaborador.gerente] || 'tu negocio'}.` });
      return;
    }
    const r = await editarEvento(eventoId, f, req.body || {}, colaborador);
    if (r.error) { res.status(r.codigo || 400).json({ error: r.error }); return; }
    res.status(200).json({ success: true, google: r.google, avisados: r.aviso ? r.aviso.avisados : 0, recibo: await reciboAlEditar(eventoId, f, colaborador) });
    return;
  }

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
    if (!esAdmin && !esDeSuGerencia(colaborador, f)) {
      res.status(403).json({ error: `Solo puedes asignar eventos de ${NOMBRE_GERENCIA[colaborador.gerente] || 'tu negocio'}.` });
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
    // Producción es solo de El Vaso Maíz: Admin o su gerente.
    const puedeProduccion = esAdmin || colaborador.gerente === GERENCIAS.VM;
    const cambiaProduccion = typeof b.produccionId === 'string' && puedeProduccion;
    // Equipo de producción (opcional; solo si viene): 1, 2 o más personas de las
    // mismas opciones que el encargado. El encargado siempre queda en el equipo.
    const cambiaEquipo = Array.isArray(b.equipoProduccionIds) && puedeProduccion;
    if ((cambiaProduccion && b.produccionId) || cambiaEquipo) {
      const opciones = await opcionesProduccion(colaborador);
      if (cambiaProduccion && b.produccionId && !opciones.some(o => o.id === b.produccionId)) {
        res.status(400).json({ error: 'Esa persona no puede ser encargada de producción.' });
        return;
      }
      if (cambiaEquipo && b.equipoProduccionIds.some(id => !opciones.some(o => o.id === id))) {
        res.status(400).json({ error: 'Alguien del equipo de producción no se puede elegir.' });
        return;
      }
    }
    const produccionAntes = (f.Encargado_Produccion || [])[0] || '';
    const equipoAntes = f.Equipo_Produccion || [];
    const encargadoFinal = cambiaProduccion ? b.produccionId : produccionAntes;
    const colaboradores = await colaboradoresActivos();
    // Solo se aceptan encargadas activas con ese rol.
    // Encargadas activas o gerentes (se pueden asignar a sí mismos o entre ellos).
    const encargadas = colaboradores.filter(c => (c.fields.Rol === ROLES.ENCARGADA || gerenciaDe(c.fields)) && b.encargadaIds.includes(c.id)).map(c => c.id);
    const campos = { Brigada_Asignada: brigadaId ? [brigadaId] : [], Encargada: encargadas };
    if (cambiaProduccion) campos.Encargado_Produccion = b.produccionId ? [b.produccionId] : [];
    if (cambiaEquipo) campos.Equipo_Produccion = [...new Set([...b.equipoProduccionIds, ...(encargadoFinal ? [encargadoFinal] : [])])];
    const nuevosEquipo = cambiaEquipo ? campos.Equipo_Produccion.filter(id => !equipoAntes.includes(id)) : [];
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
          + `${cambiaProduccion && b.produccionId ? ' · producción: ' + ((colaboradores.find(c => c.id === b.produccionId) || {}).fields || {}).Nombre : ''}`
          + `${cambiaEquipo && campos.Equipo_Produccion.length ? ' · equipo de producción: ' + campos.Equipo_Produccion.map(id => ((colaboradores.find(c => c.id === id) || {}).fields || {}).Nombre || '¿?').join(', ') : ''}.`,
      }).catch(err => console.error('Error avisando asignación de la gerente:', err));
    }
    // Nuevo encargado de producción: lista ya si faltan 2 días o menos; si no, aviso corto.
    let produccion = null;
    if (cambiaProduccion && b.produccionId && b.produccionId !== produccionAntes) {
      produccion = await avisarAsignacion(b.produccionId, { folio: f.Folio_Evento, fecha: f.Fecha_Evento })
        .catch(err => { console.error('Error avisando producción:', err.message); return { enviados: [], fallidos: [{ nombre: 'el encargado de producción', motivo: 'error al enviar' }] }; });
    }
    // Quien entra al equipo de producción recibe su aviso con el botón 🆘 (api/_etapas.js).
    let equipoProduccion = null;
    if (nuevosEquipo.length) {
      equipoProduccion = await avisarEquipoProduccion({ folio: f.Folio_Evento, fecha: f.Fecha_Evento, horaInicio: f.Hora_Inicio }, nuevosEquipo, encargadoFinal)
        .catch(err => { console.error('Error avisando al equipo de producción:', err.message); return { enviados: [], fallidos: [{ nombre: 'el equipo de producción', motivo: 'error al enviar' }] }; });
    }
    const nuevosColab = colaboradores.filter(c => nuevos.includes(c.id));
    // La brigada y la encargada van en la descripción del evento en Google.
    const google = await sincronizarEvento(eventoId);
    res.status(200).json({
      success: true,
      google,
      produccion,
      equipoProduccion,
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
    res.status(200).json({ success: true, ...r, google: await sincronizarEvento(eventoId) });
    return;
  }

  if (accion === 'descartar_cambio') {
    const r = await descartarCambio(eventoId, f, colaborador);
    if (r.error) { res.status(409).json({ error: r.error }); return; }
    res.status(200).json({ success: true });
    return;
  }

  if (accion === 'invitar_staff') {
    // El staff (chicas por Telegram) es solo de El Vaso Maíz.
    if (colaborador.rol !== ROLES.ADMIN && colaborador.gerente !== GERENCIAS.VM) {
      res.status(403).json({ error: 'El staff es solo de El Vaso Maíz.' });
      return;
    }
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
    const manteles = Array.isArray((req.body || {}).productos) ? montoPorManteles(f, normalizarProductos(req.body.productos)) : {};
    if (manteles.error) { res.status(400).json({ error: manteles.error }); return; }
    if (manteles.monto !== undefined) campos.Monto_Estimado_IA = manteles.monto;
    await airtablePatch(TABLES.EVENTOS, eventoId, campos);
    res.status(200).json({
      success: true, resumen: campos.Resumen_Capacidad || '', google: await sincronizarEvento(eventoId),
      monto: campos.Monto_Estimado_IA, recibo: await reciboAlEditar(eventoId, f, colaborador),
    });
    return;
  }

  if (accion === 'rechazar') {
    await airtablePatch(TABLES.EVENTOS, eventoId, { Autorizacion_Diana: 'NO' });
    // Si ya estaba en Google Calendar (autorizado antes), se quita.
    const google = await sincronizarEvento(eventoId);
    res.status(200).json({ success: true, google });
    return;
  }

  const montoNum = Number(monto);
  const listaItems = itemsDeTexto(items || f.Servicios_Solicitados);
  if (!(montoNum > 0) || !listaItems.length) {
    res.status(400).json({ error: 'Pon el monto y al menos un artículo para el checklist' });
    return;
  }

  // Quién autorizó (EVENTOS.Autorizado_Por). Si la columna aún no existe en
  // Airtable, se autoriza igual sin ese dato.
  const camposAutorizar = {
    Autorizacion_Diana: 'SI',
    Monto_Estimado_IA: montoNum,
    Items_Detallados_Cotizacion: listaItems.join('\n'),
    Checklist_Items: listaItems.join('\n'),
    Checklist_Items_Marcados: '[]',
    ...(instrucciones !== null ? { Instrucciones_Equipo: instrucciones } : {}),
    ...agendaDesdeDashboard(req.body, inventario),
  };
  try {
    await airtablePatch(TABLES.EVENTOS, eventoId, { ...camposAutorizar, Autorizado_Por: origenDePersona(colaborador.nombre) });
  } catch (err) {
    if (!/UNKNOWN_FIELD_NAME|Autorizado_Por/.test(err.message)) throw err;
    console.error('Falta la columna EVENTOS.Autorizado_Por, se autoriza sin ella:', err.message);
    await airtablePatch(TABLES.EVENTOS, eventoId, camposAutorizar);
  }

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
    // Calendar: DiMa lo crea o lo actualiza (y guarda su ID para cambios posteriores).
    const calendario = sincronizarEvento(eventoId).then(r => { if (!r.ok) erroresGoogle.push(r.error); return r.ok; });
    const resultados = await Promise.all([
      calendario,
      clienteEmail ? enviarCotizacionPorCorreo({ ...datosEvento, emailCliente: clienteEmail }, erroresGoogle) : Promise.resolve(true),
    ]);
    googleOk = resultados.every(Boolean);
  } catch (err) {
    console.error('Error en integraciones de Google al autorizar:', err.message);
    erroresGoogle.push(err.message);
    googleOk = false;
  }

  // ¿Con este evento se llenó el día? Avisa a Diana, Víctor (y gerente si es El Vaso Maíz).
  const diaLleno = await C.avisarSiLleno(f.Fecha_Evento, esVasoMaiz(f) ? 'El Vaso Maiz' : (f.Negocio || 'Divanna Eventos'));
  // Evento nuevo para los gerentes del negocio (solo la primera vez que se autoriza).
  if (f.Autorizacion_Diana !== 'SI') await C.avisarEventoNuevo(colaborador, { ...f, ...camposAutorizar, Servicios_Solicitados: listaItems.join('\n') });
  res.status(200).json({ success: true, googleOk, erroresGoogle, diaLleno });
}

// Calendario (api/_calendario.js): Diana, Víctor y la gerente (ella solo El Vaso Maíz).
const ACCIONES_CALENDARIO = {
  calendario_mover: moverConRecibo,
  calendario_cancelar: C.cancelar,
  borrar_evento: C.borrar,
  bloquear_dia: C.bloquear,
  desbloquear_dia: C.desbloquear,
  calendario_sincronizar: C.sincronizarPendientes,
  capturar_evento: capturarConFoto,
  leer_comanda: Comanda.leerParaFormulario,
  falla_foto: fallaFoto,
  enviar_recibo: reciboAPeticion,
  registrar_pago: pagoAPeticion,
};

// 📷 El teléfono no pudo abrir o mandar la foto de una comanda: solo se anota en
// los registros de Vercel para saber qué falla (tipo de foto, teléfono, etapa).
async function fallaFoto(colaborador, body) {
  const a = body.archivo || {};
  console.error('Comanda por foto falló en el teléfono:', JSON.stringify({
    quien: colaborador.nombre, etapa: String(body.etapa || '').slice(0, 20), detalle: String(body.detalle || '').slice(0, 500),
    tipo: String(a.tipo || '').slice(0, 40), tamano: Number(a.tamano) || 0, navegador: String(body.navegador || '').slice(0, 160),
  }));
  return { ok: true };
}

// ➕ Capturar evento; si vino de una foto de comanda, la foto se adjunta al evento.
async function capturarConFoto(colaborador, body) {
  const r = await C.capturarEvento(colaborador, body);
  if (!r.error && Comanda.fotoValida(body.fotoComanda)) {
    r.fotoGuardada = await Comanda.subirAdjunto(r.eventoId, 'Foto_Comanda', body.fotoComanda).then(() => true).catch(err => { console.error('No se pudo adjuntar la comanda:', err.message); return false; });
  }
  return r;
}

// 🧾 Mandar recibo (calendario): Diana y Víctor cualquiera; la gerente los de El Vaso Maíz.
// Manteles (Víctor 2026-11-06): al cambiar los productos, lo que cambian los
// manteles cambiados o extra se suma (o resta) solo al monto contratado; si el
// cliente es decorador, también con su 10%. Devuelve { monto } o { error } o {}.
function montoPorManteles(f, productosNuevos) {
  const nuevo = resumenManteles(productosNuevos);
  if (nuevo.error) return { error: nuevo.error };
  const diferencia = nuevo.cargo - resumenManteles(leerProductos(f.Productos)).cargo;
  const monto = Number(f.Monto_Estimado_IA) || 0;
  if (!diferencia || !(monto > 0)) return {};
  const ajuste = tieneDescuento(f) ? conDescuento(diferencia) : diferencia;
  return { monto: Math.max(0, redondo(monto + ajuste)) };
}

// Al editar un evento autorizado desde la web, el recibo se rehace (la pestaña
// del folio se sobrescribe, el viejo desaparece) y se manda por Telegram.
const RECIBO_AL_EDITAR = false;
// Regla de Víctor 2026-11-07: el recibo ya enviado no se rehace ni se reenvía solo;
// sale únicamente con "🧾 Mandar recibo" cuando el cliente lo pide.
async function reciboAlEditar(eventoId, f, colaborador) {
  if (!RECIBO_AL_EDITAR || f.Autorizacion_Diana !== 'SI') return null;
  const r = await enviarRecibo(eventoId, `actualizado por ${colaborador.nombre}`).catch(err => ({ ok: false, error: err.message }));
  return r && r.error === 'Google Sheets todavía no está configurado.' ? null : r;
}

async function moverConRecibo(colaborador, body) {
  const r = await C.mover(colaborador, body);
  if (r.ok) {
    const f = (await airtableGet(`${TABLES.EVENTOS}/${body.eventoId}`)).fields || {};
    r.recibo = await reciboAlEditar(body.eventoId, f, colaborador);
  }
  return r;
}

async function reciboAPeticion(colaborador, body) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(body.eventoId || '')) return { error: 'Parámetros inválidos' };
  const f = (await airtableGet(`${TABLES.EVENTOS}/${body.eventoId}`)).fields || {};
  if (colaborador.rol !== ROLES.ADMIN && !esDeSuGerencia(colaborador, f)) return { error: `Solo puedes mandar recibos de ${NOMBRE_GERENCIA[colaborador.gerente] || 'tu negocio'}.`, codigo: 403 };
  if (f.Autorizacion_Diana !== 'SI') return { error: 'El evento no está autorizado.' };
  const r = await enviarRecibo(body.eventoId, `lo pidió ${colaborador.nombre}`);
  return r.ok ? { ok: true, enviados: r.enviados } : { error: r.error };
}

// 💵 Registrar pago (calendario, solo Diana y Víctor): anticipo, abono o liquidación
// que recibió Diana. Es el mismo registro que "le pagaron a ella" del cuadre:
// COBROS con Recibido_Por = Diana y recibo en PDF por Telegram. monto "todo" = lo que falta.
async function pagoAPeticion(colaborador, body) {
  if (colaborador.rol !== ROLES.ADMIN) return { error: 'Solo Diana y Víctor registran pagos.', codigo: 403 };
  if (!/^rec[A-Za-z0-9]{14}$/.test(body.eventoId || '')) return { error: 'Parámetros inválidos' };
  const f = (await airtableGet(`${TABLES.EVENTOS}/${body.eventoId}`)).fields || {};
  if (f.Autorizacion_Diana !== 'SI') return { error: 'El evento no está autorizado.' };
  return aclarar(colaborador, { eventoId: body.eventoId, tipo: 'pago', monto: body.monto, forma: body.forma, negocio: body.negocio });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'POST') {
    try {
      const colaborador = await requerirSesion(req, res, [ROLES.ADMIN, ROLES.LIDER, ROLES.ENCARGADA]);
      if (!colaborador) return;
      const accionCal = ACCIONES_CALENDARIO[(req.body || {}).accion];
      if (accionCal) {
        if (!C.esEditor(colaborador)) { res.status(403).json({ error: 'Solo Diana, Víctor y la gerente modifican el calendario.' }); return; }
        const r = await accionCal(colaborador, req.body || {});
        if (r.error) { res.status(r.codigo || 400).json({ error: r.error }); return; }
        res.status(200).json({ success: true, ...r });
        return;
      }
      // Fuera de Admin, solo los gerentes (cada uno su negocio) y solo para asignar, invitar staff o editar.
      if (colaborador.rol !== ROLES.ADMIN && !(colaborador.gerente && ['asignar', 'invitar_staff', 'editar'].includes((req.body || {}).accion))) {
        res.status(403).json({ error: 'Tu rol no tiene acceso a esta sección.' });
        return;
      }
      await resolverPedido(req, res, colaborador);
    } catch (err) {
      console.error('Error resolviendo pedido:', err);
      if (esSinSaldo(err)) {
        await avisarSinSaldo('leer comanda en la app');
        res.status(503).json({ error: MENSAJE_SIN_SALDO_EQUIPO });
        return;
      }
      res.status(500).json({ error: 'Error interno, intenta de nuevo' });
    }
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const admin = await requerirSesion(req, res, [ROLES.ADMIN]);
    if (!admin) return;

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
        // Qué lleva: el ✏️ Editar lo muestra para corregirlo (antes llegaba vacío).
        servicios: r.fields.Servicios_Solicitados || '',
        brigadaId: brigadaIds[0] || '',
        encargadaIds: r.fields.Encargada || [],
        vasoMaiz: esVasoMaiz(r.fields),
        // Encargado de producción de El Vaso Maíz y su última respuesta.
        produccionId: (r.fields.Encargado_Produccion || [])[0] || '',
        produccionRespuesta: (r.fields.Produccion_Respuesta || '').trim().split('\n').pop() || '',
        // Equipo de producción y hora en que el encargado avisó "Listo para staff".
        equipoProduccionIds: r.fields.Equipo_Produccion || [],
        produccionLista: r.fields.Produccion_Lista || '',
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
        negocioSugerido: eleccionDeEvento(r.fields),
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
    // Clientes de todos los eventos (los pedidos y las fichas muestran teléfono y correo).
    // Si falla, el dashboard sigue sin esos datos.
    const clientes = await clientesPorId([...new Set(eventosData.records.map(r => (r.fields.Cliente || [])[0]).filter(Boolean))])
      .catch(err => { console.error('No se pudieron leer los clientes:', err.message); return {}; });
    eventos.forEach((ev, i) => {
      const c = clientes[(eventosData.records[i].fields.Cliente || [])[0]] || {};
      ev.clienteNombre = c.Nombre || '';
      ev.clienteTelefono = c.Telefono_WhatsApp || '';
      ev.clienteEmail = c.Email || '';
    });
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
        notas: notasSinConversacion(r.fields.Notas),
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
      .then(cs => cs.filter(c => c.fields.Rol === ROLES.ENCARGADA || gerenciaDe(c.fields)).map(c => ({ id: c.id, nombre: `${c.fields.Nombre || ''}${c.fields.Rol !== ROLES.ENCARGADA ? ` (${puestoGerente(gerenciaDe(c.fields))})` : ''}` })))
      .catch(err => { console.error('No se pudo leer COLABORADORES:', err.message); return []; });
    // Lo mismo que tiene la gerente en su app (Diana es la jefa de todo, 2026-10-29):
    // invitar staff por evento y elegir al encargado de producción. Si falla, se dice.
    let staffError = false;
    const [staffEventos, produccion] = await Promise.all([
      staffParaApp(admin).catch(err => { console.error('No se pudo leer el staff:', err.message); staffError = true; return null; }),
      opcionesProduccion(admin).catch(err => { console.error('No se pudo leer quién hace producción:', err.message); return null; }),
    ]);
    // 💰 Dinero de cada evento (api/_cargos.js), igual que en la ficha de la app. Si falla, se dice.
    const dinero = await dineroParaApp(eventosData.records).catch(err => { console.error('No se pudo leer el dinero de los eventos:', err.message); return null; });
    eventos.forEach(ev => { ev.dinero = dinero ? dinero.get(ev.id) || null : { error: true }; });
    res.status(200).json({ eventos, pedidos, balance, catalogo: catalogoParaDashboard(), manteles: infoManteles(), inventario, personalBase: PERSONAL_BASE_VASO_MAIZ, brigadas, encargadas, staffEventos, staffError, produccion });
  } catch (err) {
    console.error('Error en dashboard-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
