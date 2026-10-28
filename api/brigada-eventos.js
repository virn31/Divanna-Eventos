// api/brigada-eventos.js
// Devuelve los eventos activos (no cerrados) que el colaborador puede ver según
// su rol -- los de su brigada (líder/asistente) o los que tiene asignados
// (encargada de evento) -- más las emergencias y alertas de seguridad que
// otras brigadas reportaron hoy. Requiere sesión (api/_sesion.js); la lógica
// de alcance por rol está en api/_eventos.js.

const { ROLES, requerirSesion } = require('./_sesion');
const { alcanceDe, leerEventos, alertasEquipoDeHoy } = require('./_eventos');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, [ROLES.LIDER, ROLES.ASISTENTE, ROLES.ENCARGADA, ROLES.ADMIN]);
    if (!colaborador) return;

    const { brigada, eventoIds } = await alcanceDe(colaborador);
    const alertasEquipo = await alertasEquipoDeHoy(eventoIds);
    const eventos = await leerEventos(eventoIds);

    res.status(200).json({
      colaborador: { nombre: colaborador.nombre, rol: colaborador.rol },
      brigada,
      eventos,
      alertasEquipo,
    });
  } catch (err) {
    console.error('Error en brigada-eventos:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
