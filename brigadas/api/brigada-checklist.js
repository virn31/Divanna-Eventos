// api/brigada-checklist.js
// Actualiza una etapa del checklist (salida/llegada/montaje/recoleccion)
// de un evento específico.

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS_TABLE = 'tblzLAin65BZPP2c6';

const CHECKLIST_FIELD_MAP = {
  salida: 'Checklist_Salida',
  llegada: 'Checklist_Llegada',
  montaje: 'Checklist_Montaje',
  recoleccion: 'Checklist_Recoleccion',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { eventoId, etapa, valor } = req.body || {};
    const campo = CHECKLIST_FIELD_MAP[etapa];

    if (!eventoId || !campo || typeof valor !== 'boolean') {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }

    const airRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTOS_TABLE}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{ id: eventoId, fields: { [campo]: valor } }],
      }),
    });

    if (!airRes.ok) throw new Error(`Airtable error ${airRes.status}: ${await airRes.text()}`);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error en brigada-checklist:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
