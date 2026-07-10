// api/brigada-eventos.js
// Recibe un código de brigada, lo valida contra Airtable, y devuelve
// sus eventos activos (no cerrados) ordenados por fecha.

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  EVENTOS: 'tblzLAin65BZPP2c6',
};

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const codigo = (req.query.codigo || '').trim().toUpperCase();
    if (!codigo) { res.status(400).json({ error: 'Falta el código de brigada' }); return; }

    // 1. Validar el código contra BRIGADAS
    const formula = encodeURIComponent(`{Codigo_Acceso} = "${codigo}"`);
    const brigadaData = await airtableGet(`${TABLES.BRIGADAS}?filterByFormula=${formula}&maxRecords=1`);
    const brigada = brigadaData.records[0];

    if (!brigada) {
      res.status(401).json({ error: 'Código no válido' });
      return;
    }

    // 2. Buscar eventos asignados a esta brigada, no cerrados
    const eventFormula = encodeURIComponent(
      `AND(FIND("${brigada.id}", ARRAYJOIN({Brigada_Asignada})), {Estado} != "Cerrado")`
    );
    const eventosData = await airtableGet(
      `${TABLES.EVENTOS}?filterByFormula=${eventFormula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`
    );

    const eventos = eventosData.records.map(r => ({
      id: r.id,
      folio: r.fields.Folio_Evento || '',
      negocio: r.fields.Negocio || '',
      fecha: r.fields.Fecha_Evento || '',
      estado: r.fields.Estado || '',
      servicios: r.fields.Servicios_Solicitados || '',
      invitados: r.fields.Invitados || null,
      ubicacion: r.fields.Ubicacion || '',
      checklist: {
        salida: !!r.fields.Checklist_Salida,
        llegada: !!r.fields.Checklist_Llegada,
        montaje: !!r.fields.Checklist_Montaje,
        recoleccion: !!r.fields.Checklist_Recoleccion,
      },
    }));

    res.status(200).json({
      brigada: {
        id: brigada.id,
        nombre: brigada.fields.Nombre_Brigada || '',
        lider: brigada.fields.Lider || '',
        vehiculo: brigada.fields.Vehiculo || '',
      },
      eventos,
    });
  } catch (err) {
    console.error('Error en brigada-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
