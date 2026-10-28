// api/pedido.js
// Formulario de respaldo de la landing (index.html), para quien prefiere no
// usar el chat con DiMa. La lógica del pedido vive en api/_pedidos.js.

const { validarPedido, crearPedido } = require('./_pedidos');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = req.body || {};

    // Campo trampa: invisible para personas, los bots suelen llenarlo.
    if (body.sitio_web) { res.status(200).json({ success: true }); return; }

    // El formulario no manda estimado: ese solo lo calcula DiMa en el chat.
    // Si el cliente no dijo que es dentro de la ciudad, Diana revisa cobertura.
    const { error, datos } = validarPedido({ ...body, montoEstimado: null, fueraDeCiudad: body.enCiudad !== 'si' });
    if (error) { res.status(400).json({ error }); return; }

    const { folio } = await crearPedido(datos, { origen: 'formulario' });
    res.status(200).json({ success: true, folio });
  } catch (err) {
    console.error('Error en pedido:', err);
    res.status(500).json({ error: 'No pudimos registrar tu pedido, intenta de nuevo.' });
  }
};
