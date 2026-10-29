// api/produccion-diaria.js
// Cron diario (vercel.json, 8:00 de Culiacán = 15:00 UTC): manda por Telegram
// la lista de producción de El Vaso Maíz a cada encargado de producción, dos
// días antes del evento y el mismo día (lógica en api/_produccion.js). No
// repite avisos ya enviados, así que correrlo dos veces no duplica mensajes.
// También se puede llamar a mano con ?secreto=<CRON_SECRET> para probar.

const { avisosDelDia } = require('./_produccion');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const esCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const esManual = req.query && req.query.secreto === process.env.CRON_SECRET;
  if (process.env.CRON_SECRET && !esCron && !esManual) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  try {
    const resultados = await avisosDelDia();
    res.status(200).json({
      success: true,
      resultados: resultados.map(r => ({ tipo: r.tipo, fecha: r.fecha, enviados: r.enviados.length, fallidos: r.fallidos.length })),
    });
  } catch (err) {
    console.error('Error en produccion-diaria:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};
