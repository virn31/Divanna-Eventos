// api/_pedidos.js
// Crea un pedido de cliente: busca o crea al CLIENTE por teléfono, crea el
// EVENTO con Autorizacion_Diana = "Pendiente" para que aparezca en el dashboard,
// y avisa por correo a Diana y Víctor. Lo usan el chat de DiMa (api/dima-chat.js)
// y el formulario de respaldo (api/pedido.js).

const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarTelegramEquipo } = require('./_telegram');
const { ROLES } = require('./_sesion');
const { enTemporadaAlta, textoTemporada } = require('./_temporada');
const { normalizarProductos, capacidadEvento, inicioEvento } = require('./_productos');
const { revisarDisponibilidad, textoDisponibilidad, camposDisponibilidad } = require('./_agenda');

// Plazo que DiMa le promete al cliente para confirmar su cotización.
const HORAS_RESPUESTA = 12;

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  CLIENTES: 'tblgViisKQRG9TVjh',
  EVENTOS: 'tblzLAin65BZPP2c6',
};

// Opciones reales del singleSelect Negocio en EVENTOS. "Ambos" no existe como
// opción: se deja sin Negocio y se anota en Notas.
const NEGOCIOS_VALIDOS = ['Divanna Eventos', 'El Vaso Maiz'];

// Valores que manda DiMa -> opciones reales de EVENTOS.Preferencia_Contacto.
const PREFERENCIAS = {
  esperar_en_chat: 'Esperar en el chat',
  mensaje: 'Mensaje',
  llamada: 'Llamada',
};

async function airtableRequest(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

function texto(valor, max) {
  return String(valor == null ? '' : valor).trim().slice(0, max);
}

// Busca por los últimos 10 dígitos para encontrar también a los clientes que
// llegaron por WhatsApp (guardados como "whatsapp:+521...").
async function buscarClientePorTelefono(diezDigitos) {
  const formula = encodeURIComponent(
    `RIGHT(REGEX_REPLACE({Telefono_WhatsApp} & "", "[^0-9]", ""), 10) = "${diezDigitos}"`
  );
  const data = await airtableRequest(`${TABLES.CLIENTES}?filterByFormula=${formula}&maxRecords=1`);
  return data.records[0] || null;
}

// Valida y normaliza los datos. Devuelve { error } o { datos }.
function validarPedido(entrada) {
  const datos = {
    nombre: texto(entrada.nombre, 80),
    telefonoDigitos: texto(entrada.telefono, 30).replace(/\D/g, ''),
    email: texto(entrada.email, 120),
    negocio: texto(entrada.negocio, 40),
    tipoEvento: texto(entrada.tipoEvento, 60),
    fecha: texto(entrada.fecha, 10),
    invitados: parseInt(entrada.invitados, 10),
    ubicacion: texto(entrada.ubicacion, 150),
    servicios: texto(entrada.servicios, 1500),
    montoEstimado: Number(entrada.montoEstimado),
    fueraDeCiudad: entrada.fueraDeCiudad === true,
    indicaciones: texto(entrada.indicaciones, 800),
    preferenciaContacto: PREFERENCIAS[entrada.preferenciaContacto] || null,
    horaInicio: /^([01]\d|2[0-3]):[0-5]\d$/.test(texto(entrada.horaInicio, 5)) ? texto(entrada.horaInicio, 5) : '',
    horasServicio: Number(entrada.horasServicio) >= 0.5 && Number(entrada.horasServicio) <= 24 ? Number(entrada.horasServicio) : null,
    productos: normalizarProductos(entrada.productos),
  };
  if (!datos.nombre || datos.telefonoDigitos.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || !datos.servicios) {
    return { error: 'Revisa tu nombre, teléfono (10 dígitos), fecha y lo que necesitas.' };
  }
  if (datos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) {
    return { error: 'El correo no parece válido.' };
  }
  return { datos };
}

// Campos de agenda y capacidad del evento (hora, productos estructurados,
// piezas y personal de El Vaso Maíz, mobiliario de Divanna). Solo incluye
// lo que se conoce, para no borrar datos al registrar un cambio.
function camposAgenda(datos) {
  const fields = {};
  if (datos.horaInicio) fields.Hora_Inicio = datos.horaInicio;
  if (datos.horasServicio) fields.Horas_Servicio = datos.horasServicio;
  if (datos.productos && datos.productos.length) {
    const c = capacidadEvento(datos.productos, datos.horasServicio);
    fields.Productos = JSON.stringify(datos.productos);
    fields.Piezas_Vaso_Maiz = c.piezas;
    fields.Personal_Requerido = c.personal;
    fields.Resumen_Capacidad = c.resumen;
  }
  return fields;
}

// origen: 'formulario' o 'chat'. notasExtra: texto adicional para Notas (ej. la conversación).
async function crearPedido(datos, { origen, notasExtra = '' }) {
  const diezDigitos = datos.telefonoDigitos.slice(-10);
  const telefono = `+52${diezDigitos}`;

  // 1. Cliente existente o nuevo
  let cliente = await buscarClientePorTelefono(diezDigitos);
  if (!cliente) {
    const fields = { Nombre: datos.nombre, Telefono_WhatsApp: telefono, Tipo_Cliente: 'Particular', Nivel: 'Nuevo' };
    if (datos.email) fields.Email = datos.email;
    const data = await airtableRequest(TABLES.CLIENTES, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }] }),
    });
    cliente = data.records[0];
  } else if (datos.email && !cliente.fields.Email) {
    await airtableRequest(TABLES.CLIENTES, {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id: cliente.id, fields: { Email: datos.email } }] }),
    });
  }

  // 2. Evento pendiente de cotizar
  const folio = `EVT-${Date.now().toString().slice(-6)}`;
  const montoValido = datos.montoEstimado > 0 && datos.montoEstimado < 10000000;
  const notas = [
    origen === 'chat' ? 'Pedido armado con DiMa en la página web.' : 'Pedido desde el formulario de la página web.',
    datos.tipoEvento ? `Tipo de evento: ${datos.tipoEvento}` : '',
    datos.negocio && !NEGOCIOS_VALIDOS.includes(datos.negocio) ? `Negocio solicitado: ${datos.negocio}` : '',
    enTemporadaAlta(datos.fecha) ? `🎄 Temporada alta (${textoTemporada()}): sin paquetes regulares.` : '',
    notasExtra,
  ].filter(Boolean).join('\n');

  const eventoFields = {
    Folio_Evento: folio,
    Estado: 'Nuevo contacto',
    Cliente: [cliente.id],
    Fecha_Evento: datos.fecha,
    Servicios_Solicitados: datos.servicios,
    Autorizacion_Diana: 'Pendiente',
    Notas: notas.slice(0, 90000),
  };
  if (NEGOCIOS_VALIDOS.includes(datos.negocio)) eventoFields.Negocio = datos.negocio;
  if (datos.ubicacion) eventoFields.Ubicacion = datos.ubicacion;
  if (datos.invitados > 0 && datos.invitados < 100000) eventoFields.Invitados = datos.invitados;
  if (montoValido) eventoFields.Monto_Estimado_IA = datos.montoEstimado;
  if (datos.fueraDeCiudad) eventoFields.Fuera_De_Ciudad = true;
  if (datos.indicaciones) eventoFields.Instrucciones_Equipo = `Del cliente: ${datos.indicaciones}`;
  if (datos.preferenciaContacto) eventoFields.Preferencia_Contacto = datos.preferenciaContacto;
  const agenda = camposAgenda(datos);
  Object.assign(eventoFields, agenda);

  const creado = await airtableRequest(TABLES.EVENTOS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: eventoFields }] }),
  });
  const eventoId = creado && creado.records && creado.records[0] && creado.records[0].id;

  // 3. Semáforo de agenda: se guarda en el evento y va en los avisos. Si falla,
  // el pedido sigue registrado y el dashboard lo recalcula al abrirse.
  let disponibilidad = null;
  try {
    disponibilidad = await revisarDisponibilidad({
      id: eventoId, folio, negocio: eventoFields.Negocio || '', fecha: datos.fecha,
      horaInicio: datos.horaInicio, horasServicio: datos.horasServicio,
      productos: datos.productos || [], articulos: [], personal: agenda.Personal_Requerido || 0,
    });
    if (eventoId) {
      await airtableRequest(TABLES.EVENTOS, {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ id: eventoId, fields: camposDisponibilidad(disponibilidad) }] }),
      });
    }
  } catch (err) {
    console.error('No se pudo revisar la disponibilidad:', err.message);
  }
  const textoSemaforo = disponibilidad ? `${textoDisponibilidad(disponibilidad)}\n` : '⚪ No se pudo revisar la agenda: revísala en el dashboard.\n';
  // A DiMa le toca prometer respuesta en 12 h o menos.
  const limite = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mazatlan' }).format(new Date(Date.now() + HORAS_RESPUESTA * 3600 * 1000));
  const avisoLimite = `⏱️ Confirmar al cliente antes de: ${limite}\n`;

  // 4. Aviso a Diana y Víctor (correo + Telegram). Si fallan, el pedido ya
  // quedó guardado y aparece en el dashboard: no se le marca error al cliente.
  const avisoFuera = textoSemaforo + avisoLimite +
    (enTemporadaAlta(datos.fecha) ? `🎄 TEMPORADA ALTA (${textoTemporada()}): sin paquetes regulares.\n` : '') +
    (datos.fueraDeCiudad ? '⚠️ FUERA DE LA CIUDAD: revisar cobertura y costo de traslado.\n' : '') +
    (datos.preferenciaContacto ? `📞 Cómo quiere la respuesta: ${datos.preferenciaContacto}\n` : '');
  const avisoTelegram = enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🎉 Pedido nuevo ${folio} (${origen === 'chat' ? 'chat con DiMa' : 'formulario'})\n` + avisoFuera +
      `${datos.nombre} · ${telefono}\n` +
      `📅 ${datos.fecha}${datos.horaInicio ? ' · 🕒 ' + datos.horaInicio : ''}${datos.invitados > 0 ? ' · 👥 ' + datos.invitados : ''}${datos.ubicacion ? ' · 📍 ' + datos.ubicacion : ''}\n` +
      (montoValido ? `Estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n` : '') +
      `\n${datos.servicios}\n` +
      (agenda.Resumen_Capacidad ? `\n${agenda.Resumen_Capacidad}\n` : '') +
      (datos.indicaciones ? `\n📌 ${datos.indicaciones}\n` : '') +
      `\nCotízalo en https://divanna-eventos.vercel.app/brigadas/`,
  });
  await enviarCorreoEquipo({
    asunto: `🎉 Pedido nuevo ${folio} - ${datos.nombre}${datos.fueraDeCiudad ? ' (fuera de la ciudad)' : ''}`,
    texto:
      `Llegó un pedido nuevo desde la página (${origen === 'chat' ? 'chat con DiMa' : 'formulario'}).\n\n` + avisoFuera +
      `Folio: ${folio}\n` +
      `Cliente: ${datos.nombre}\n` +
      `Teléfono: ${telefono}\n` +
      `Correo: ${datos.email || 'no lo dio'}\n` +
      `Negocio: ${datos.negocio || 'sin especificar'}\n` +
      `Tipo de evento: ${datos.tipoEvento || 'sin especificar'}\n` +
      `Fecha: ${datos.fecha}${datos.horaInicio ? ' a las ' + datos.horaInicio : ''}\n` +
      `Invitados: ${datos.invitados > 0 ? datos.invitados : 'sin especificar'}\n` +
      `Ubicación: ${datos.ubicacion || 'sin especificar'}\n` +
      (montoValido ? `Estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n` : '') +
      `\nLo que necesita:\n${datos.servicios}\n\n` +
      (agenda.Resumen_Capacidad ? `Capacidad:\n${agenda.Resumen_Capacidad}\n\n` : '') +
      (datos.indicaciones ? `Indicaciones del cliente:\n${datos.indicaciones}\n\n` : '') +
      `Cotízalo en la app: https://divanna-eventos.vercel.app/brigadas/`,
  });
  await avisoTelegram;

  return { folio, disponibilidad };
}

// Pedido existente: el cliente da su folio y su teléfono para agregar o
// cambiar algo. Devuelve el resumen del pedido solo si el teléfono coincide
// con el del cliente del pedido (así nadie toca un pedido ajeno).
async function verificarPedido(folio, telefono) {
  const folioLimpio = String(folio || '').trim().toUpperCase();
  const diezDigitos = String(telefono || '').replace(/\D/g, '').slice(-10);
  if (!/^EVT-\d{6}$/.test(folioLimpio) || diezDigitos.length < 10) return null;

  const formula = encodeURIComponent(`{Folio_Evento} = "${folioLimpio}"`);
  const data = await airtableRequest(`${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1`);
  const r = data.records[0];
  const clienteId = r && (r.fields.Cliente || [])[0];
  if (!clienteId) return null;
  const cliente = await airtableRequest(`${TABLES.CLIENTES}/${clienteId}`);
  if (String(cliente.fields.Telefono_WhatsApp || '').replace(/\D/g, '').slice(-10) !== diezDigitos) return null;

  const f = r.fields;
  return {
    id: r.id,
    folio: folioLimpio,
    nombre: cliente.fields.Nombre || '',
    negocio: f.Negocio || '',
    fecha: f.Fecha_Evento || '',
    horaInicio: f.Hora_Inicio || '',
    ubicacion: f.Ubicacion || '',
    invitados: f.Invitados || null,
    servicios: f.Servicios_Solicitados || '',
    instrucciones: f.Instrucciones_Equipo || '',
    autorizado: f.Autorizacion_Diana === 'SI',
    fueraDeCiudad: !!f.Fuera_De_Ciudad,
    mensajeDiana: f.Mensaje_Para_Cliente && !f.Mensaje_Cliente_Entregado ? f.Mensaje_Para_Cliente : '',
  };
}

// Mensaje que Diana dejó para el cliente y que aún no se entrega, o null.
async function mensajeDianaPendiente(folio) {
  const formula = encodeURIComponent(`AND({Folio_Evento} = "${folio}", {Mensaje_Para_Cliente} != "", NOT({Mensaje_Cliente_Entregado}))`);
  const data = await airtableRequest(`${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1`);
  const r = data.records[0];
  return r ? { id: r.id, mensaje: r.fields.Mensaje_Para_Cliente } : null;
}

async function marcarMensajeEntregado(eventoId) {
  await airtableRequest(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: eventoId, fields: { Mensaje_Cliente_Entregado: true } }] }),
  });
}

// Los cambios de pedido se piden con 24 h de anticipación (decisión de Víctor
// 2026-10-29). Con menos, se registran igual pero marcados como urgentes.
const HORAS_ANTICIPACION_CAMBIO = 24;

// Horas que faltan para que empiece el evento (null si no hay fecha válida).
function horasParaEvento(fecha, horaInicio) {
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? inicioEvento(fecha, horaInicio) : null;
  return inicio === null ? null : (inicio - Date.now()) / 3600000;
}

function cambioUrgente(fecha, horaInicio) {
  const h = horasParaEvento(fecha, horaInicio);
  return h !== null && h < HORAS_ANTICIPACION_CAMBIO;
}

// EVENTOS.Cambio_Cliente (JSON) -> objeto, o null si no hay o no se entiende.
function leerCambio(texto) {
  try {
    const c = JSON.parse(texto || 'null');
    return c && typeof c === 'object' && typeof c.servicios === 'string' ? c : null;
  } catch (e) { return null; }
}

// Guarda en el evento lo que el cliente agregó o cambió después de registrar
// el pedido. Siempre queda en Notas (historial) y en Cambio_Cliente (lo que se
// muestra en el dashboard y la app):
// - Pedido pendiente de cotizar: el cambio se aplica de una vez (servicios,
//   productos, hora, estimado, indicaciones) y queda como "aplicado".
// - Pedido ya autorizado: no se toca lo que ya tiene; queda "pendiente" hasta
//   que Diana lo confirme o descarte en el dashboard.
// Devuelve { eventoId, autorizado, urgente, negocio, fecha, campos } o lanza
// error si no se pudo guardar (quien llama debe decirlo, no fingir que quedó).
async function registrarCambioCliente(folio, { servicios, indicaciones, montoEstimado, transcripcion, preferenciaContacto, horaInicio, horasServicio, productos }) {
  const formula = encodeURIComponent(`{Folio_Evento} = "${folio}"`);
  const data = await airtableRequest(`${TABLES.EVENTOS}?filterByFormula=${formula}&maxRecords=1`);
  const r = data.records[0];
  if (!r) throw new Error(`No existe el evento ${folio}`);
  const autorizado = r.fields.Autorizacion_Diana === 'SI';
  const urgente = cambioUrgente(r.fields.Fecha_Evento, r.fields.Hora_Inicio);
  const fecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mazatlan' }).format(new Date());
  const notaCambio = [
    `\n--- Cambio pedido por el cliente en el chat (${fecha})${urgente ? ' ⚠️ URGENTE: menos de 24 h antes del evento' : ''}${autorizado ? ' · pendiente de confirmar por la gerencia' : ''} ---`,
    `Así lo quiere ahora:\n${servicios}`,
    montoEstimado > 0 ? `Nuevo estimado de DiMa: $${Number(montoEstimado).toLocaleString('es-MX')}` : '',
    indicaciones ? `Indicaciones: ${indicaciones}` : '',
    transcripcion ? `Conversación:\n${transcripcion}` : '',
  ].filter(Boolean).join('\n');

  const cambio = {
    estado: autorizado ? 'pendiente' : 'aplicado',
    pedidoEl: new Date().toISOString(),
    urgente,
    antes: r.fields.Servicios_Solicitados || '',
    servicios: String(servicios || ''),
    indicaciones: indicaciones || '',
    montoEstimado: montoEstimado > 0 ? Number(montoEstimado) : null,
    horaInicio: horaInicio || '',
    horasServicio: horasServicio || null,
    productos: productos || [],
  };
  const fields = { Notas: `${r.fields.Notas || ''}${notaCambio}`.slice(-90000), Cambio_Cliente: JSON.stringify(cambio) };
  if (preferenciaContacto) fields.Preferencia_Contacto = preferenciaContacto;
  if (!autorizado) {
    // Todavía no se cotiza: Diana ve directo el pedido como quedó.
    if (cambio.servicios) fields.Servicios_Solicitados = cambio.servicios;
    if (cambio.montoEstimado) fields.Monto_Estimado_IA = cambio.montoEstimado;
    Object.assign(fields, camposAgenda({ horaInicio, horasServicio, productos: productos || [] }));
    if (indicaciones && !(r.fields.Instrucciones_Equipo || '').includes(indicaciones)) {
      fields.Instrucciones_Equipo = `${r.fields.Instrucciones_Equipo ? r.fields.Instrucciones_Equipo + '\n' : ''}Del cliente: ${indicaciones}`;
    }
  }
  await airtableRequest(TABLES.EVENTOS, {
    method: 'PATCH',
    body: JSON.stringify({ records: [{ id: r.id, fields }] }),
  });
  return { eventoId: r.id, autorizado, urgente, negocio: r.fields.Negocio || '', fecha: r.fields.Fecha_Evento || '', campos: r.fields };
}

// Notas sin la plática con DiMa, para mostrar en la app: la conversación sigue
// guardada completa en EVENTOS.Notas, pero en pantalla basta el resumen del
// pedido. Cada "Conversación:" llega hasta el siguiente "--- Cambio ..." o al final.
function notasSinConversacion(notas) {
  const fuera = [];
  let enPlatica = false;
  for (const linea of String(notas || '').split('\n')) {
    if (/^Conversación( con DiMa)?:\s*$/.test(linea)) { enPlatica = true; continue; }
    if (/^--- Cambio /.test(linea)) enPlatica = false;
    if (!enPlatica) fuera.push(linea);
  }
  return fuera.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  notasSinConversacion,
  HORAS_RESPUESTA,
  validarPedido,
  camposAgenda,
  crearPedido,
  buscarClientePorTelefono,
  verificarPedido,
  registrarCambioCliente,
  leerCambio,
  cambioUrgente,
  horasParaEvento,
  HORAS_ANTICIPACION_CAMBIO,
  mensajeDianaPendiente,
  marcarMensajeEntregado,
};
