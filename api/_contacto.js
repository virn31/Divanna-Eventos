// api/_contacto.js
// Tarjeta "Quién te atenderá" para el cliente (Víctor 2026-11-11): al registrar
// el pedido (chat de DiMa y formulario) y en el correo de la cotización
// confirmada, el cliente ve qué gerente lo va a llamar, para darle
// profesionalismo y protegerlo de fraudes.
// - Divanna (mobiliario o decoración): el gerente de Divanna (Eden).
// - Casa Isabella (el salón): el gerente de Casa Isabella (Mario); Eden no lleva esos.
// - El Vaso Maíz: la gerente de El Vaso Maíz (Ángela).
// - Mixto: cada uno por su parte; cualquiera de ellos puede cobrar el anticipo.
// - Si lleva mobiliario o decoración, se avisa que la brigada de entrega y
//   decoración también puede llamarle.
// EXCEPCIÓN a la regla "DiMa no nombra a nadie del equipo" (Víctor 2026-11-11):
// solo aquí, solo el primer nombre y el puesto de los gerentes, nunca teléfonos
// y nunca a Diana. La tarjeta NO va en el texto que DiMa recuerda (historial),
// así que en la plática DiMa sigue sin nombrar a nadie.
// Los nombres salen de COLABORADORES (Rol de gerente, Activo): si cambia el
// gerente, cambia la tarjeta. Si no hay gerente, dice "nuestro equipo".

const { COLABORADORES_TABLE, GERENCIAS, gerenciaDe, puestoGerente } = require('./_sesion');
const { PRODUCTOS, leerProductos } = require('./_productos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const NEGOCIOS = { DV: 'Divanna Eventos', VM: 'El Vaso Maiz', AMBOS: 'Ambos' };
const AREA = {
  [GERENCIAS.DV]: 'Mobiliario y decoración',
  [GERENCIAS.CI]: 'Salón Casa Isabella',
  [GERENCIAS.VM]: 'Snacks de El Vaso Maíz',
};
const CACHE_MS = 10 * 60 * 1000;
let cache = { hasta: 0, nombres: null };

// Primer nombre de cada gerente activo, por gerencia. Si falla, {} (la tarjeta dice "nuestro equipo").
async function gerentesActivos() {
  if (cache.nombres && Date.now() < cache.hasta) return cache.nombres;
  const nombres = {};
  try {
    let offset = '';
    do {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${COLABORADORES_TABLE}?filterByFormula=${encodeURIComponent('{Activo}')}&fields%5B%5D=Nombre&fields%5B%5D=Rol&fields%5B%5D=Gerente_Vaso_Maiz&pageSize=100${offset ? '&offset=' + offset : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
      if (!res.ok) throw new Error(`Airtable error ${res.status}`);
      const data = await res.json();
      (data.records || []).forEach(r => {
        const g = gerenciaDe(r.fields);
        const primero = String(r.fields.Nombre || '').trim().split(/\s+/)[0];
        if (g && primero && !nombres[g]) nombres[g] = primero.charAt(0).toUpperCase() + primero.slice(1);
      });
      offset = data.offset || '';
    } while (offset);
    cache = { hasta: Date.now() + CACHE_MS, nombres };
  } catch (err) {
    console.error('Tarjeta de contacto: no se pudieron leer los gerentes:', err.message);
  }
  return nombres;
}

// Qué partes lleva el pedido: { casa, divanna, vasoMaiz, brigada }.
// productos: lista del catálogo ([{ clave }]) o el JSON de EVENTOS.Productos.
function partesDelPedido({ productos, servicios, negocio } = {}) {
  const lista = Array.isArray(productos) ? productos : leerProductos(productos);
  const deNegocio = (n) => lista.some(p => PRODUCTOS[p.clave] && PRODUCTOS[p.clave].negocio === n && p.clave !== 'dv_casa_isabella');
  const casa = lista.some(p => p.clave === 'dv_casa_isabella') || /casa\s*isabella/i.test(String(servicios || ''));
  const sinCatalogo = !lista.some(p => PRODUCTOS[p.clave] && PRODUCTOS[p.clave].negocio);
  // Mobiliario o decoración de Divanna (fuera del salón). Sin catálogo, por el negocio del pedido.
  const divanna = deNegocio(NEGOCIOS.DV) || (sinCatalogo && !casa && (negocio === NEGOCIOS.DV || negocio === NEGOCIOS.AMBOS));
  const vasoMaiz = deNegocio(NEGOCIOS.VM) || (sinCatalogo && (negocio === NEGOCIOS.VM || negocio === NEGOCIOS.AMBOS));
  return { casa, divanna, vasoMaiz, brigada: divanna };
}

// Tarjeta del pedido: { personas: [{ nombre, puesto, area }], brigada, folio }.
async function contactoDelPedido(pedido = {}, folio = '') {
  const partes = partesDelPedido(pedido);
  const nombres = await gerentesActivos();
  const gerencias = [];
  // Con el salón lo lleva el gerente de Casa Isabella (también su decoración).
  if (partes.casa) gerencias.push(GERENCIAS.CI);
  else if (partes.divanna) gerencias.push(GERENCIAS.DV);
  if (partes.vasoMaiz) gerencias.push(GERENCIAS.VM);
  const personas = gerencias.filter(g => nombres[g]).map(g => ({
    nombre: nombres[g],
    puesto: puestoGerente(g),
    area: g === GERENCIAS.CI && partes.divanna ? 'Salón Casa Isabella y decoración' : AREA[g],
  }));
  return { personas, brigada: partes.brigada, folio: String(folio || '') };
}

// Frases de la tarjeta (las mismas en el chat, el formulario y el correo).
function frasesContacto(c) {
  const varios = c.personas.length > 1;
  return {
    titulo: 'Quién te atenderá',
    llamada: c.personas.length
      ? `${varios ? 'Te llamarán' : 'Te llamará'} para confirmar tu cotización, el anticipo y los detalles de tu evento.`
      : 'Nuestro equipo te llamará para confirmar tu cotización, el anticipo y los detalles de tu evento.',
    brigada: c.brigada ? 'Antes de tu evento, nuestra brigada de entrega y decoración también podría llamarte para confirmar la dirección, el acceso o el horario. Si tienes alguna duda, con gusto te atiende.' : '',
    seguridad: `Por tu seguridad: quien te llame de nuestro equipo sabrá tu número de pedido${c.folio ? ` (${c.folio})` : ''}. Si alguien no lo sabe, no le des datos ni hagas depósitos, y escríbenos en la página en "¿Ya tienes número de pedido?".`,
  };
}

// Versión en texto (para correos y respaldo).
function textoContacto(c) {
  const f = frasesContacto(c);
  return [
    `📇 ${f.titulo}`,
    ...c.personas.map(p => `• ${p.nombre} · ${p.puesto} (${p.area})`),
    f.llamada,
    f.brigada ? `🚚 ${f.brigada}` : '',
    `🔒 ${f.seguridad}`,
  ].filter(Boolean).join('\n');
}

const escapeHtml = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Versión HTML para el correo de la cotización confirmada.
function htmlContacto(c) {
  const f = frasesContacto(c);
  return `
        <div style="margin:20px 0; padding:16px 18px; border:1px solid #e9e3f5; border-radius:12px; background:#faf8fd;">
          <p style="margin:0 0 10px; font-size:0.8em; letter-spacing:.08em; text-transform:uppercase; color:#7c3aed; font-weight:bold;">${escapeHtml(f.titulo)}</p>
          ${c.personas.map(p => `<p style="margin:0 0 8px;"><strong style="font-size:1.05em;">${escapeHtml(p.nombre)}</strong><br><span style="color:#555;">${escapeHtml(p.puesto)} · ${escapeHtml(p.area)}</span></p>`).join('')}
          <p style="margin:8px 0 0; color:#333;">${escapeHtml(f.llamada)}</p>
          ${f.brigada ? `<p style="margin:8px 0 0; color:#333;">🚚 ${escapeHtml(f.brigada)}</p>` : ''}
          <p style="margin:12px 0 0; font-size:0.85em; color:#777;">🔒 ${escapeHtml(f.seguridad)}</p>
        </div>`;
}

// Lo que recibe la página (chat y formulario): la tarjeta con sus frases ya armadas.
const tarjetaParaCliente = (c) => ({ ...c, frases: frasesContacto(c) });

const olvidarGerentes = () => { cache = { hasta: 0, nombres: null }; };

module.exports = { contactoDelPedido, tarjetaParaCliente, partesDelPedido, frasesContacto, textoContacto, htmlContacto, olvidarGerentes };
