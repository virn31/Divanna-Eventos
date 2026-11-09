// api/produccion-diaria.js
// (También manda el buenos días diario a Diana y Víctor de api/_cuadre.js: resumen
// del día y preguntas por eventos que no cuadran; los lunes, el efectivo sin destino.
// El buenos días sí se repite si el cron se corre dos veces el mismo día.)
// Cron diario (vercel.json, 8:00 de Culiacán = 15:00 UTC): manda por Telegram
// la lista de producción de El Vaso Maíz a cada encargado de producción, dos
// días antes del evento y el mismo día (lógica en api/_produccion.js). No
// repite avisos ya enviados, así que correrlo dos veces no duplica mensajes.
// También se puede llamar a mano con ?secreto=<CRON_SECRET> para probar.

const { avisosDelDia } = require('./_produccion');
const { preguntasDelDia, preguntaCaja } = require('./_cuadre');

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
    // Cuadre por excepción: un fallo aquí no detiene los avisos de producción.
    const cuadre = await preguntasDelDia().catch(err => { console.error('Error en el cuadre diario:', err.message); return { error: err.message }; });
    const esLunes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mazatlan', weekday: 'short' }).format(new Date()) === 'Mon';
    const caja = esLunes ? await preguntaCaja().catch(err => { console.error('Error en la pregunta de caja:', err.message); return { error: err.message }; }) : null;
    res.status(200).json({
      success: true,
      resultados: resultados.map(r => ({ tipo: r.tipo, fecha: r.fecha, enviados: r.enviados.length, fallidos: r.fallidos.length })),
      cuadre,
      caja,
    });
  } catch (err) {
    console.error('Error en produccion-diaria:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};
