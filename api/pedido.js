// api/pedido.js
// Recibe el formulario "Cotiza tu evento" de la landing (index.html).
// Busca o crea al CLIENTE por teléfono, crea el EVENTO con
// Autorizacion_Diana = "Pendiente" para que aparezca en el dashboard, y avisa
// por correo a Diana y Víctor. La cotización la arma Diana a mano en el dashboard.

const { enviarCorreoEquipo } = require('./_google-integrations');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = req.body || {};

    // Campo trampa: invisible para personas, los bots suelen llenarlo.
    if (body.sitio_web) { res.status(200).json({ success: true }); return; }

    const nombre = texto(body.nombre, 80);
    const telefonoDigitos = texto(body.telefono, 30).replace(/\D/g, '');
    const email = texto(body.email, 120);
    const negocio = texto(body.negocio, 40);
    const tipoEvento = texto(body.tipoEvento, 60);
    const fecha = texto(body.fecha, 10);
    const invitados = parseInt(body.invitados, 10);
    const ubicacion = texto(body.ubicacion, 150);
    const servicios = texto(body.servicios, 1500);

    if (!nombre || telefonoDigitos.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !servicios) {
      res.status(400).json({ error: 'Revisa tu nombre, teléfono (10 dígitos), fecha y lo que necesitas.' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'El correo no parece válido.' });
      return;
    }

    const diezDigitos = telefonoDigitos.slice(-10);
    const telefono = `+52${diezDigitos}`;

    // 1. Cliente existente o nuevo
    let cliente = await buscarClientePorTelefono(diezDigitos);
    if (!cliente) {
      const fields = { Nombre: nombre, Telefono_WhatsApp: telefono, Tipo_Cliente: 'Particular', Nivel: 'Nuevo' };
      if (email) fields.Email = email;
      const data = await airtableRequest(TABLES.CLIENTES, {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields }] }),
      });
      cliente = data.records[0];
    } else if (email && !cliente.fields.Email) {
      await airtableRequest(TABLES.CLIENTES, {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ id: cliente.id, fields: { Email: email } }] }),
      });
    }

    // 2. Evento pendiente de cotizar
    const folio = `EVT-${Date.now().toString().slice(-6)}`;
    const notas = [
      'Pedido desde la página web.',
      tipoEvento ? `Tipo de evento: ${tipoEvento}` : '',
      negocio && !NEGOCIOS_VALIDOS.includes(negocio) ? `Negocio solicitado: ${negocio}` : '',
    ].filter(Boolean).join('\n');

    const eventoFields = {
      Folio_Evento: folio,
      Estado: 'Nuevo contacto',
      Cliente: [cliente.id],
      Fecha_Evento: fecha,
      Servicios_Solicitados: servicios,
      Autorizacion_Diana: 'Pendiente',
      Notas: notas,
    };
    if (NEGOCIOS_VALIDOS.includes(negocio)) eventoFields.Negocio = negocio;
    if (ubicacion) eventoFields.Ubicacion = ubicacion;
    if (invitados > 0 && invitados < 100000) eventoFields.Invitados = invitados;

    await airtableRequest(TABLES.EVENTOS, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: eventoFields }] }),
    });

    // 3. Aviso al equipo. Si el correo falla el pedido ya quedó guardado y
    // aparece en el dashboard, así que no se le marca error al cliente.
    await enviarCorreoEquipo({
      asunto: `🎉 Pedido nuevo ${folio} - ${nombre}`,
      texto:
        `Llegó un pedido nuevo desde la página.\n\n` +
        `Folio: ${folio}\n` +
        `Cliente: ${nombre}\n` +
        `Teléfono: ${telefono}\n` +
        `Correo: ${email || 'no lo dio'}\n` +
        `Negocio: ${negocio || 'sin especificar'}\n` +
        `Tipo de evento: ${tipoEvento || 'sin especificar'}\n` +
        `Fecha: ${fecha}\n` +
        `Invitados: ${invitados > 0 ? invitados : 'sin especificar'}\n` +
        `Ubicación: ${ubicacion || 'sin especificar'}\n\n` +
        `Lo que necesita:\n${servicios}\n\n` +
        `Cotízalo en el dashboard: https://divanna-eventos.vercel.app/brigadas/dashboard.html`,
    });

    res.status(200).json({ success: true, folio });
  } catch (err) {
    console.error('Error en pedido:', err);
    res.status(500).json({ error: 'No pudimos registrar tu pedido, intenta de nuevo.' });
  }
};
