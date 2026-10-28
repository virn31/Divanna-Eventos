// api/_pedidos.js
// Crea un pedido de cliente: busca o crea al CLIENTE por teléfono, crea el
// EVENTO con Autorizacion_Diana = "Pendiente" para que aparezca en el dashboard,
// y avisa por correo a Diana y Víctor. Lo usan el chat de DiMa (api/dima-chat.js)
// y el formulario de respaldo (api/pedido.js).

const { enviarCorreoEquipo } = require('./_google-integrations');
const { enviarTelegramEquipo } = require('./_telegram');
const { ROLES } = require('./_sesion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  CLIENTES: 'tblgViisKQRG9TVjh',
  EVENTOS: 'tblzLAin65BZPP2c6',
};

// Opciones reales del singleSelect Negocio en EVENTOS. "Ambos" no existe como
// opción: se deja sin Negocio y se anota en Notas.
const NEGOCIOS_VALIDOS = ['Divanna Eventos', 'El Vaso Maiz'];

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
  };
  if (!datos.nombre || datos.telefonoDigitos.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) || !datos.servicios) {
    return { error: 'Revisa tu nombre, teléfono (10 dígitos), fecha y lo que necesitas.' };
  }
  if (datos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) {
    return { error: 'El correo no parece válido.' };
  }
  return { datos };
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

  await airtableRequest(TABLES.EVENTOS, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: eventoFields }] }),
  });

  // 3. Aviso a Diana y Víctor (correo + Telegram). Si fallan, el pedido ya
  // quedó guardado y aparece en el dashboard: no se le marca error al cliente.
  const avisoFuera = datos.fueraDeCiudad ? '⚠️ FUERA DE LA CIUDAD: revisar cobertura y costo de traslado.\n' : '';
  const avisoTelegram = enviarTelegramEquipo({
    roles: [ROLES.ADMIN],
    texto: `🎉 Pedido nuevo ${folio} (${origen === 'chat' ? 'chat con DiMa' : 'formulario'})\n` + avisoFuera +
      `${datos.nombre} · ${telefono}\n` +
      `📅 ${datos.fecha}${datos.invitados > 0 ? ' · 👥 ' + datos.invitados : ''}${datos.ubicacion ? ' · 📍 ' + datos.ubicacion : ''}\n` +
      (montoValido ? `Estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n` : '') +
      `\n${datos.servicios}\n` +
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
      `Fecha: ${datos.fecha}\n` +
      `Invitados: ${datos.invitados > 0 ? datos.invitados : 'sin especificar'}\n` +
      `Ubicación: ${datos.ubicacion || 'sin especificar'}\n` +
      (montoValido ? `Estimado de DiMa: $${datos.montoEstimado.toLocaleString('es-MX')}\n` : '') +
      `\nLo que necesita:\n${datos.servicios}\n\n` +
      (datos.indicaciones ? `Indicaciones del cliente:\n${datos.indicaciones}\n\n` : '') +
      `Cotízalo en la app: https://divanna-eventos.vercel.app/brigadas/`,
  });
  await avisoTelegram;

  return { folio };
}

module.exports = { validarPedido, crearPedido };
