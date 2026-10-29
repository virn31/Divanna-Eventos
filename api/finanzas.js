// api/finanzas.js
// Reporte financiero del día (lógica en api/_finanzas.js).
// GET ?fecha=YYYY-MM-DD: el reporte propio de ese día (líder / encargada) y,
//   para Admin y la gerente de El Vaso Maíz, los reportes por revisar.
// GET ?vista=historial: historial mensual por empresa (solo Admin).
// GET ?vista=cuadre y POST aclarar | caja: cuadre por excepción (solo Admin, api/_cuadre.js).
// POST accion: gasto | cobro | quitar | datos | enviar (quien reporta);
//   aprobar | aclaracion | reembolsado (Diana y Víctor).

const { ROLES, requerirSesion } = require('./_sesion');
const F = require('./_finanzas');
const Q = require('./_cuadre');

const ROLES_PERMITIDOS = [ROLES.ADMIN, ROLES.LIDER, ROLES.ENCARGADA];
// Las fotos de tickets llegan comprimidas desde la app (menos de 3 MB).
const ACCIONES_REPORTE = { gasto: F.agregarGasto, cobro: F.agregarCobro, quitar: F.quitar, datos: F.guardarDatos, enviar: F.enviar };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const colaborador = await requerirSesion(req, res, ROLES_PERMITIDOS);
    if (!colaborador) return;

    if (req.method === 'GET') {
      // Historial mensual por empresa (gráfica del dashboard): solo Diana y Víctor.
      // Cuadre por excepción (solo Admin).
      if ((req.query || {}).vista === 'cuadre') {
        if (colaborador.rol !== ROLES.ADMIN) { res.status(403).json({ error: 'Solo Diana y Víctor ven el cuadre.' }); return; }
        res.status(200).json(await Q.vistaCuadre());
        return;
      }
      if ((req.query || {}).vista === 'historial') {
        if (colaborador.rol !== ROLES.ADMIN) { res.status(403).json({ error: 'Solo Diana y Víctor ven el historial.' }); return; }
        res.status(200).json(await F.historialMensual());
        return;
      }
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test((req.query || {}).fecha || '') ? req.query.fecha : F.hoyCuliacan();
      res.status(200).json(await F.vista(colaborador, fecha));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = req.body || {};
    let r;
    if (ACCIONES_REPORTE[body.accion]) {
      if (!F.puedeReportar(colaborador)) { res.status(403).json({ error: 'El reporte del día lo hacen el líder de brigada o la encargada.' }); return; }
      r = await ACCIONES_REPORTE[body.accion](colaborador, body);
    } else if (body.accion === 'aprobar' || body.accion === 'aclaracion') {
      r = await F.revisar(colaborador, body);
    } else if (body.accion === 'aclarar') {
      r = await Q.aclarar(colaborador, body);
    } else if (body.accion === 'caja') {
      r = await Q.destinoCaja(colaborador, body);
    } else if (body.accion === 'reembolsado') {
      r = await F.marcarReembolsado(colaborador, body);
    } else {
      res.status(400).json({ error: 'Acción inválida' });
      return;
    }
    if (r.error) { res.status(r.codigo || 400).json({ error: r.error }); return; }
    res.status(200).json(r);
  } catch (err) {
    console.error('Error en finanzas:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
