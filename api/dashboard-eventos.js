// api/dashboard-eventos.js
// Vista general para Diana y Víctor: TODAS las brigadas, TODOS los eventos
// activos del día (y próximos), con su estatus logístico, retrasos,
// emergencias, alertas de seguridad, y estatus de pago -- todo en tiempo real.
// Login separado del de brigadas: se valida contra DASHBOARD_ACCESS_CODES
// (variable de entorno, lista separada por comas, ej. "DIANA2026,VICTOR2026").

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
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
    const codigosValidos = (process.env.DASHBOARD_ACCESS_CODES || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

    if (!codigo || !codigosValidos.includes(codigo)) {
      res.status(401).json({ error: 'Código no válido' });
      return;
    }

    // Traemos todas las brigadas (para el nombre/vehículo/líder de cada una)
    const brigadasData = await airtableGet(`${TABLES.BRIGADAS}`);
    const brigadasPorId = {};
    brigadasData.records.forEach(b => { brigadasPorId[b.id] = b.fields; });

    // Traemos todos los eventos no cerrados
    const eventFormula = encodeURIComponent('{Estado} != "Cerrado"');
    const eventosData = await airtableGet(
      `${TABLES.EVENTOS}?filterByFormula=${eventFormula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`
    );

    const eventos = eventosData.records.map(r => {
      const brigadaIds = r.fields.Brigada_Asignada || [];
      const brigadaInfo = brigadaIds.length ? brigadasPorId[brigadaIds[0]] : null;

      return {
        id: r.id,
        folio: r.fields.Folio_Evento || '',
        negocio: r.fields.Negocio || '',
        fecha: r.fields.Fecha_Evento || '',
        ubicacion: r.fields.Ubicacion || '',
        invitados: r.fields.Invitados || null,
        brigadaNombre: brigadaInfo ? brigadaInfo.Nombre_Brigada : 'Sin asignar',
        brigadaLider: brigadaInfo ? brigadaInfo.Lider : '',
        estatusLogistico: r.fields.Estatus_Logistico || 'Preparando',
        retraso: !!r.fields.Retraso,
        motivoRetraso: r.fields.Motivo_Retraso || '',
        emergencia: !!r.fields.Emergencia,
        motivoEmergencia: r.fields.Motivo_Emergencia || '',
        zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
        etaConfirmado: r.fields.ETA_Confirmado_Brigada || '',
        estatusPago: r.fields.Estatus_Pago || '',
        montoAdeudado: r.fields.Monto_Adeudado || null,
        autorizacionDiana: r.fields.Autorizacion_Diana || '',
      };
    });

    res.status(200).json({ eventos });
  } catch (err) {
    console.error('Error en dashboard-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
