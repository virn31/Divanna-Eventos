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

    // 2. Buscar eventos asignados a esta brigada.
    // Usamos el campo de vínculo directo (array de IDs) en vez de una fórmula
    // ARRAYJOIN, porque Airtable resuelve ARRAYJOIN sobre un vínculo devolviendo
    // el NOMBRE del registro vinculado, no su ID — comparar por ID ahí nunca coincide.
    const eventoIds = brigada.fields.EVENTOS || [];
    if (eventoIds.length === 0) {
      res.status(200).json({
        brigada: {
          id: brigada.id,
          nombre: brigada.fields.Nombre_Brigada || '',
          lider: brigada.fields.Lider || '',
          vehiculo: brigada.fields.Vehiculo || '',
        },
        eventos: [],
      });
      return;
    }

    const idsFormula = eventoIds.map(id => `RECORD_ID()="${id}"`).join(',');
    const eventFormula = encodeURIComponent(`AND(OR(${idsFormula}), {Estado} != "Cerrado")`);
    const eventosData = await airtableGet(
      `${TABLES.EVENTOS}?filterByFormula=${eventFormula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`
    );

    const eventos = eventosData.records.map(r => {
      const itemsRaw = (r.fields.Checklist_Items || '').split('\n').map(s => s.trim()).filter(Boolean);
      let marcados = [];
      try { marcados = JSON.parse(r.fields.Checklist_Items_Marcados || '[]'); } catch (e) { marcados = []; }

      return {
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
        checklistItems: itemsRaw.map((texto, i) => ({ texto, marcado: marcados.includes(i) })),
        estatusLogistico: r.fields.Estatus_Logistico || 'Preparando',
        retraso: !!r.fields.Retraso,
        motivoRetraso: r.fields.Motivo_Retraso || '',
        emergencia: !!r.fields.Emergencia,
        motivoEmergencia: r.fields.Motivo_Emergencia || '',
        zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
        etaConfirmado: r.fields.ETA_Confirmado_Brigada || '',
        estatusPago: r.fields.Estatus_Pago || '',
        montoAdeudado: r.fields.Monto_Adeudado || null,
      };
    });

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
