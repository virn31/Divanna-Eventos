// api/brigada-eventos.js
// Devuelve los eventos activos (no cerrados) que el colaborador puede ver según
// su rol -- los de su brigada (líder/asistente) o los que tiene asignados
// (encargada de evento) -- más las emergencias y alertas de seguridad que
// otras brigadas reportaron hoy. Requiere sesión (api/_sesion.js).

const { ROLES, COLABORADORES_TABLE, requerirSesion } = require('./_sesion');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  BRIGADAS: 'tblwqJrIaC1MsMGNL',
  EVENTOS: 'tblzLAin65BZPP2c6',
};
// Vínculo inverso COLABORADORES -> EVENTOS (lado del campo EVENTOS.Encargada).
const CAMPO_EVENTOS_DE_ENCARGADA = 'fld52PrtsNA4CnRw2';

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fecha de hoy en Culiacán (YYYY-MM-DD). TODAY() de Airtable usa UTC y por la
// tarde ya marcaría el día siguiente.
function hoyCuliacan() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
}

// Emergencias y alertas de seguridad activas hoy en eventos de OTRAS brigadas.
// Si falla no bloquea la app: el colaborador sigue viendo sus propios eventos.
async function alertasEquipoDeHoy(eventoIdsPropios) {
  try {
    const formula = encodeURIComponent(
      `AND(DATESTR({Fecha_Evento}) = "${hoyCuliacan()}", {Estado} != "Cerrado", OR({Emergencia}, {Zona_Alerta_Seguridad} != ""))`
    );
    const data = await airtableGet(`${TABLES.EVENTOS}?filterByFormula=${formula}`);
    return data.records
      .filter(r => !eventoIdsPropios.includes(r.id))
      .map(r => ({
        folio: r.fields.Folio_Evento || '',
        ubicacion: r.fields.Ubicacion || '',
        emergencia: !!r.fields.Emergencia,
        motivoEmergencia: r.fields.Motivo_Emergencia || '',
        zonaAlertaSeguridad: r.fields.Zona_Alerta_Seguridad || '',
      }));
  } catch (err) {
    console.error('No se pudieron obtener las alertas del equipo:', err);
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, [ROLES.LIDER, ROLES.ASISTENTE, ROLES.ENCARGADA, ROLES.ADMIN]);
    if (!colaborador) return;

    // 1. IDs de los eventos que le tocan.
    // Se usa el campo de vínculo directo (array de IDs) en vez de una fórmula
    // ARRAYJOIN, porque Airtable resuelve ARRAYJOIN sobre un vínculo devolviendo
    // el NOMBRE del registro vinculado, no su ID — comparar por ID ahí nunca coincide.
    let brigada = null;
    let eventoIds = [];
    if (colaborador.rol === ROLES.ENCARGADA) {
      const registro = await airtableGet(`${COLABORADORES_TABLE}/${colaborador.id}?returnFieldsByFieldId=true`);
      eventoIds = registro.fields[CAMPO_EVENTOS_DE_ENCARGADA] || [];
    } else if (colaborador.brigadaId) {
      const b = await airtableGet(`${TABLES.BRIGADAS}/${colaborador.brigadaId}`);
      brigada = {
        id: b.id,
        nombre: b.fields.Nombre_Brigada || '',
        lider: b.fields.Lider || '',
        vehiculo: b.fields.Vehiculo || '',
      };
      eventoIds = b.fields.EVENTOS || [];
    }

    const respuestaBase = {
      colaborador: { nombre: colaborador.nombre, rol: colaborador.rol },
      brigada,
    };
    const alertasEquipo = await alertasEquipoDeHoy(eventoIds);

    if (eventoIds.length === 0) {
      res.status(200).json({ ...respuestaBase, eventos: [], alertasEquipo });
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

    res.status(200).json({ ...respuestaBase, eventos, alertasEquipo });
  } catch (err) {
    console.error('Error en brigada-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
