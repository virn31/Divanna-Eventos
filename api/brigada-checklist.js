// api/brigada-checklist.js
// Actualiza una etapa del checklist (salida/llegada/montaje/recoleccion)
// de un evento específico. Requiere sesión: líder, encargada del evento o admin.

const { ROLES, requerirSesion, puedeOperarEvento } = require('./_sesion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS_TABLE = 'tblzLAin65BZPP2c6';

const CHECKLIST_FIELD_MAP = {
  salida: 'Checklist_Salida',
  llegada: 'Checklist_Llegada',
  montaje: 'Checklist_Montaje',
  recoleccion: 'Checklist_Recoleccion',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, [ROLES.LIDER, ROLES.ENCARGADA, ROLES.ADMIN]);
    if (!colaborador) return;

    const { eventoId, etapa, valor } = req.body || {};
    const campo = CHECKLIST_FIELD_MAP[etapa];

    if (!/^rec[A-Za-z0-9]{14}$/.test(eventoId || '') || !campo || typeof valor !== 'boolean') {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }

    const eventoRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTOS_TABLE}/${eventoId}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
    });
    if (!eventoRes.ok) throw new Error(`Airtable error ${eventoRes.status}: ${await eventoRes.text()}`);
    const evento = await eventoRes.json();
    if (!puedeOperarEvento(colaborador, evento.fields)) {
      res.status(403).json({ error: 'Este evento no está asignado a ti.' });
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
