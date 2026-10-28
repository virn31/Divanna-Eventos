// api/_sesion.js
// Sesión de la app interna: cada colaborador entra con su usuario y PIN
// (tabla COLABORADORES) y recibe un token firmado con HMAC que trae su rol.
// Todas las llamadas de la app mandan ese token en el header Authorization.
//
// Requiere SESSION_SECRET en Vercel (texto largo aleatorio). Si se cambia,
// todos tienen que volver a entrar.

const crypto = require('crypto');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const COLABORADORES_TABLE = 'tblHdz4vqUIlIdkwc';

// Nombres exactos de las opciones del campo Rol en COLABORADORES.
const ROLES = {
  ADMIN: 'Admin',
  LIDER: 'Lider de brigada',
  ASISTENTE: 'Asistente',
  ENCARGADA: 'Encargada de evento',
};

const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function firmar(payloadB64) {
  return b64url(crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payloadB64).digest());
}

function crearToken(colaboradorId) {
  const payload = b64url(JSON.stringify({ sub: colaboradorId, exp: Date.now() + DURACION_MS }));
  return `${payload}.${firmar(payload)}`;
}

function leerToken(token) {
  if (!process.env.SESSION_SECRET || typeof token !== 'string') return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = firmar(payload);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const datos = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!datos.sub || !(datos.exp > Date.now())) return null;
    return datos;
  } catch (e) {
    return null;
  }
}

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

function aColaborador(record) {
  const f = record.fields;
  return {
    id: record.id,
    nombre: f.Nombre || '',
    rol: f.Rol || '',
    brigadaId: (f.Brigada || [])[0] || null,
  };
}

// Escapa un texto para usarlo dentro de comillas en filterByFormula.
function textoFormula(valor) {
  return String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Login: devuelve { token, colaborador } o null si el usuario/PIN no coinciden.
async function iniciarSesion(usuario, pin) {
  const formula = encodeURIComponent(
    `AND(LOWER({Usuario}) = "${textoFormula(usuario.toLowerCase())}", {PIN} = "${textoFormula(pin)}", {Activo})`
  );
  const data = await airtableGet(`${COLABORADORES_TABLE}?filterByFormula=${formula}&maxRecords=1`);
  const record = data && data.records[0];
  if (!record || !Object.values(ROLES).includes(record.fields.Rol)) return null;
  return { token: crearToken(record.id), colaborador: aColaborador(record) };
}

// Valida el token del header y que el colaborador siga activo con un rol
// permitido. Si no, responde 401/403 y devuelve null. Se consulta Airtable en
// cada llamada para que desactivar a alguien o cambiarle el rol aplique de inmediato.
async function requerirSesion(req, res, rolesPermitidos) {
  const header = req.headers['authorization'] || '';
  const datos = leerToken(header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!datos) {
    res.status(401).json({ error: 'Tu sesión expiró, vuelve a entrar con tu PIN.' });
    return null;
  }
  const record = await airtableGet(`${COLABORADORES_TABLE}/${encodeURIComponent(datos.sub)}`);
  if (!record || !record.fields.Activo) {
    res.status(401).json({ error: 'Tu acceso ya no está activo. Habla con Diana o Víctor.' });
    return null;
  }
  const colaborador = aColaborador(record);
  if (!rolesPermitidos.includes(colaborador.rol)) {
    res.status(403).json({ error: 'Tu rol no tiene acceso a esta sección.' });
    return null;
  }
  return colaborador;
}

// ¿Puede este colaborador operar este evento? Admin todos; líder y asistente
// los de su brigada; encargada los que tiene asignados en el campo Encargada.
function puedeOperarEvento(colaborador, eventoFields) {
  if (colaborador.rol === ROLES.ADMIN) return true;
  if (colaborador.rol === ROLES.ENCARGADA) return (eventoFields.Encargada || []).includes(colaborador.id);
  return !!colaborador.brigadaId && (eventoFields.Brigada_Asignada || []).includes(colaborador.brigadaId);
}

module.exports = { ROLES, COLABORADORES_TABLE, iniciarSesion, requerirSesion, puedeOperarEvento };
