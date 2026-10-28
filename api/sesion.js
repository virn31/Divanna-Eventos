// api/sesion.js
// Login de la app interna con usuario + PIN (tabla COLABORADORES).
// Devuelve el token de sesión y lo que la app necesita para mostrar la vista
// según el rol. Ver api/_sesion.js.

const { iniciarSesion } = require('./_sesion');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    if (!process.env.SESSION_SECRET) {
      console.error('Falta SESSION_SECRET en Vercel');
      res.status(500).json({ error: 'La app no está configurada todavía. Avisa a Víctor.' });
      return;
    }

    const usuario = String((req.body || {}).usuario || '').trim().toLowerCase();
    const pin = String((req.body || {}).pin || '').trim();

    // Formatos cerrados: así nada raro llega a la fórmula de Airtable.
    if (!/^[a-z0-9._-]{2,30}$/.test(usuario) || !/^\d{6}$/.test(pin)) {
      res.status(400).json({ error: 'Escribe tu usuario y tu PIN de 6 dígitos.' });
      return;
    }

    const sesion = await iniciarSesion(usuario, pin);
    if (!sesion) {
      // Pausa en cada intento fallido para frenar a quien intente adivinar PINs.
      await new Promise(r => setTimeout(r, 1500));
      res.status(401).json({ error: 'Usuario o PIN incorrecto.' });
      return;
    }

    res.status(200).json(sesion);
  } catch (err) {
    console.error('Error en sesion:', err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo' });
  }
};
