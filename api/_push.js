// api/_push.js
// Notificaciones push de la app del equipo (emergencias y alertas de seguridad).
// Llegan aunque la app esté cerrada o el teléfono bloqueado, con sonido y
// vibración (ver el evento "push" en brigadas/sw.js).
//
// Requiere en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT
// (mailto:...). Las suscripciones viven en la tabla PUSH_SUSCRIPCIONES.

const webpush = require('web-push');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  SUSCRIPCIONES: 'tblSyRGsMwcSnkcAR',
  COLABORADORES: 'tblHdz4vqUIlIdkwc',
};

function pushConfigurado() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

async function airtable(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Todas las páginas de una consulta (Airtable devuelve máximo 100 por página).
async function todos(path) {
  const registros = [];
  let offset = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const data = await airtable(`${path}${offset ? `${sep}offset=${encodeURIComponent(offset)}` : ''}`);
    registros.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return registros;
}

// Guarda (o actualiza) la suscripción de un teléfono para un colaborador.
async function guardarSuscripcion(colaboradorId, suscripcion) {
  const formula = encodeURIComponent(`{Endpoint} = "${suscripcion.endpoint}"`);
  const existentes = await airtable(`${TABLES.SUSCRIPCIONES}?filterByFormula=${formula}&maxRecords=1`);
  const fields = {
    Endpoint: suscripcion.endpoint,
    Colaborador: [colaboradorId],
    Claves: JSON.stringify(suscripcion.keys),
  };
  if (existentes.records[0]) {
    await airtable(TABLES.SUSCRIPCIONES, {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id: existentes.records[0].id, fields }] }),
    });
  } else {
    await airtable(TABLES.SUSCRIPCIONES, { method: 'POST', body: JSON.stringify({ records: [{ fields }] }) });
  }
}

// Manda la alerta a los teléfonos de todos los colaboradores activos, menos
// el de quien la reportó. Nunca lanza error: si falla, se reporta en logs y el
// correo sigue siendo el respaldo.
// soloColaboradores: si se pasa (lista de IDs), solo a esas personas.
// url: a dónde lleva tocar la notificación (por defecto, la app).
async function enviarPushEquipo({ titulo, cuerpo, excluirColaboradorId, soloColaboradores = null, url = null }) {
  if (!pushConfigurado()) {
    console.error('Push sin configurar: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT');
    return 0;
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

    const activos = new Set(
      (await todos(`${TABLES.COLABORADORES}?filterByFormula=${encodeURIComponent('{Activo}')}&fields%5B%5D=Nombre`)).map(r => r.id)
    );
    const suscripciones = (await todos(TABLES.SUSCRIPCIONES)).filter(r => {
      const colab = (r.fields.Colaborador || [])[0];
      return colab && activos.has(colab) && colab !== excluirColaboradorId && r.fields.Endpoint && r.fields.Claves
        && (!soloColaboradores || soloColaboradores.includes(colab));
    });

    const payload = JSON.stringify({ titulo, cuerpo, url });
    const vencidas = [];
    let enviadas = 0;
    await Promise.all(suscripciones.map(async (r) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.fields.Endpoint, keys: JSON.parse(r.fields.Claves) },
          payload,
          { TTL: 60 * 60, urgency: 'high' }
        );
        enviadas++;
      } catch (err) {
        // 404/410: el teléfono ya no acepta esta suscripción (app desinstalada, permiso quitado).
        if (err.statusCode === 404 || err.statusCode === 410) vencidas.push(r.id);
        else console.error('Error enviando push:', err.statusCode, err.body || err.message);
      }
    }));

    for (let i = 0; i < vencidas.length; i += 10) {
      const ids = vencidas.slice(i, i + 10).map(id => `records%5B%5D=${id}`).join('&');
      await airtable(`${TABLES.SUSCRIPCIONES}?${ids}`, { method: 'DELETE' }).catch(e => console.error('No se pudieron borrar suscripciones vencidas:', e.message));
    }
    return enviadas;
  } catch (err) {
    console.error('Error en enviarPushEquipo:', err.message);
    return 0;
  }
}

module.exports = { pushConfigurado, guardarSuscripcion, enviarPushEquipo };
