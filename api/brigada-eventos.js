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

const { ROLES, requerirSesion } = require('./_sesion');
const { alcanceDe, leerEventos, alertasEquipoDeHoy, opcionesVista } = require('./_eventos');

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

    const { brigada, eventoIds } = await alcanceDe(alcanceSolicitado(colaborador, req.query || {}));
    const alertasEquipo = await alertasEquipoDeHoy(eventoIds);
    const eventos = await leerEventos(eventoIds);

    res.status(200).json({
      colaborador: { nombre: colaborador.nombre, rol: colaborador.rol },
      brigada,
      eventos,
      alertasEquipo,
      ...(colaborador.rol === ROLES.ADMIN ? { opciones: await opcionesVista() } : {}),
    });
  } catch (err) {
    console.error('Error en brigada-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
