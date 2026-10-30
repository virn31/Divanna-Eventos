// api/brigada-eventos.js
// Devuelve los eventos activos (no cerrados) que el colaborador puede ver según
// su rol -- los de su brigada (líder/asistente) o los que tiene asignados
// (encargada de evento) -- más las emergencias y alertas de seguridad que
// otras brigadas reportaron hoy. Requiere sesión (api/_sesion.js); la lógica
// de alcance por rol está en api/_eventos.js.
//
// Admin ("vista equipo"): ve todos los eventos, o los de una brigada
// (?brigada=rec...) o de una encargada (?encargada=rec...), tal como los ve
// esa persona, y recibe la lista de brigadas y encargadas para elegir.
// La gerente de El Vaso Maíz recibe esa misma lista para asignar sus eventos,
// y el estado de su staff en cada evento (staffEventos) para invitarlas.

const { ROLES, requerirSesion } = require('./_sesion');
const { alcanceDe, leerEventos, alertasEquipoDeHoy, opcionesVista } = require('./_eventos');
const { staffParaApp } = require('./_staff');
const { vistaMes } = require('./_calendario');
const { opcionesProduccion: opcionesDeProduccion } = require('./_produccion');
const { veDinero, inventarioParaCargos } = require('./_cargos');

const ID_REGISTRO = /^rec[A-Za-z0-9]{14}$/;

// Para un Admin que quiere ver la app como una brigada o encargada, arma un
// colaborador "de vista" con ese alcance. Para todos los demás no cambia nada.
function alcanceSolicitado(colaborador, query) {
  if (colaborador.rol !== ROLES.ADMIN) return colaborador;
  const brigada = String(query.brigada || '');
  const encargada = String(query.encargada || '');
  if (ID_REGISTRO.test(brigada)) return { ...colaborador, rol: ROLES.LIDER, brigadaId: brigada };
  if (ID_REGISTRO.test(encargada)) return { ...colaborador, rol: ROLES.ENCARGADA, id: encargada };
  return colaborador;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, [ROLES.LIDER, ROLES.ASISTENTE, ROLES.ENCARGADA, ROLES.ADMIN]);
    if (!colaborador) return;

    // Calendario del equipo (?vista=calendario&mes=YYYY-MM): todos ven todo, sin montos.
    if ((req.query || {}).vista === 'calendario') {
      const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.mes || '') ? req.query.mes : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date()).slice(0, 7);
      res.status(200).json(await vistaMes(colaborador, mes));
      return;
    }

    // Artículos para anotar un daño o faltante (se pide al abrir ese formulario).
    if ((req.query || {}).vista === 'inventario') {
      if (!veDinero(colaborador)) { res.status(403).json({ error: 'Solo el líder o la encargada anotan daños y faltantes.' }); return; }
      res.status(200).json({ articulos: await inventarioParaCargos() });
      return;
    }
    const { brigada, eventoIds } = await alcanceDe(alcanceSolicitado(colaborador, req.query || {}));
    const alertasEquipo = await alertasEquipoDeHoy(eventoIds);
    const eventos = await leerEventos(eventoIds, { conDinero: veDinero(colaborador) });
    // La gerente también ve e invita al staff de sus eventos. Si no se puede
    // leer, se dice (staffError) en vez de mostrar la lista vacía.
    let staffEventos = null, staffError = false, opcionesProduccion = null;
    if (colaborador.gerente && colaborador.rol !== ROLES.ADMIN) {
      staffEventos = await staffParaApp(colaborador).catch(err => { console.error('No se pudo leer el staff:', err.message); staffError = true; return null; });
      opcionesProduccion = await opcionesDeProduccion(colaborador).catch(err => { console.error('No se pudo leer quién hace producción:', err.message); return null; });
    }

    res.status(200).json({
      colaborador: { nombre: colaborador.nombre, rol: colaborador.rol, gerente: !!colaborador.gerente, veDinero: veDinero(colaborador) },
      brigada,
      eventos,
      alertasEquipo,
      ...(colaborador.rol === ROLES.ADMIN ? { opciones: await opcionesVista() } : {}),
      // La gerente asigna brigada y encargada a los eventos de El Vaso Maíz.
      ...(colaborador.gerente && colaborador.rol !== ROLES.ADMIN ? { opcionesAsignar: { ...(await opcionesVista()), produccion: opcionesProduccion }, staffEventos, staffError } : {}),
    });
  } catch (err) {
    console.error('Error en brigada-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
