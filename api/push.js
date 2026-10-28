// api/push.js
// GET: llave pública VAPID para que la app suscriba el teléfono.
// POST: guarda la suscripción del teléfono del colaborador con sesión.
// El envío de las alertas está en api/_push.js.

const { ROLES, requerirSesion } = require('./_sesion');
const { pushConfigurado, guardarSuscripcion } = require('./_push');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    res.status(200).json({ publicKey: pushConfigurado() ? process.env.VAPID_PUBLIC_KEY : null });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const colaborador = await requerirSesion(req, res, Object.values(ROLES));
    if (!colaborador) return;

    const s = (req.body || {}).suscripcion || {};
    const endpointValido = typeof s.endpoint === 'string' && /^https:\/\/[^\s"\\]{10,800}$/.test(s.endpoint);
    const clavesValidas = s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string'
      && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
    if (!endpointValido || !clavesValidas) {
      res.status(400).json({ error: 'Suscripción inválida' });
      return;
    }

    await guardarSuscripcion(colaborador.id, { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error en push:', err);
    res.status(500).json({ error: 'No se pudieron activar las alertas, intenta de nuevo' });
  }
};
