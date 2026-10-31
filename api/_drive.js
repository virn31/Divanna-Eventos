// api/_drive.js
// Carpeta de Google Drive de Diana para que la página y DiMa estén al día sin
// tocar código: paquetes, precios de temporada, promociones y galería.
//
// Cómo la llena Diana (sin formato especial):
// - Cada subcarpeta es un tema ("Promociones", "Paquetes Divanna", "Galeria"...).
//   Se leen hasta 4 niveles adentro ("Divanna / promociones / navidad 2026").
// - Los Documentos de Google (o archivos .txt) de cada carpeta los lee DiMa tal
//   cual. Si contradicen el catálogo del código, manda lo de Drive.
// - Las fotos: el nombre del archivo es su descripción ("XV años rosa y dorado").
//   DiMa las puede mostrar en el chat. Las de una carpeta con "galeria" en el
//   nombre salen en la galería de la página; las de "promo..." en Promociones.
//
// Variables: GOOGLE_DRIVE_CARPETA (ID de la carpeta, de la URL) y la cuenta de
// servicio de siempre. La carpeta se comparte con la cuenta de servicio (Lector
// basta) y en el proyecto de Google debe estar activa la Google Drive API.
// Sin la variable no hace nada y DiMa sigue solo con el catálogo del código.
//
// Se guarda en memoria 10 minutos. Si Drive falla, se sigue usando lo último que
// se leyó bien (o nada): nunca debe trabar el chat.

const { google } = require('googleapis');

const MINUTOS_CACHE = 10;
const ESPERA_MAX_MS = 5000;
const MAX_FOTOS = 80;
const MAX_DOCUMENTOS = 15;
const MAX_NIVEL = 4;
const MAX_CARACTERES_DOC = 6000;
const CARPETA = 'application/vnd.google-apps.folder';
const DOCUMENTO = 'application/vnd.google-apps.document';

let cache = { datos: null, hora: 0 };

const configurado = () => !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_CARPETA);

function autorizacion() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}
const driveGoogle = (auth = autorizacion()) => google.drive({ version: 'v3', auth });

// Sin acentos y en minúsculas, para reconocer "Galería", "GALERIA", "promos"...
const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sinExtension = (n) => String(n || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();

async function listar(drive, carpetaId) {
  const archivos = [];
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${carpetaId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, description, modifiedTime)',
      orderBy: 'name',
      pageSize: 200,
      pageToken,
    });
    archivos.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  return archivos;
}

async function textoDe(drive, archivo) {
  const r = archivo.mimeType === DOCUMENTO
    ? await drive.files.export({ fileId: archivo.id, mimeType: 'text/plain' }, { responseType: 'text' })
    : await drive.files.get({ fileId: archivo.id, alt: 'media' }, { responseType: 'text' });
  return String(r.data || '').replace(/^﻿/, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CARACTERES_DOC);
}

// Recorre la carpeta raíz y sus subcarpetas hasta MAX_NIVEL de profundidad
// (las subcarpetas en paralelo, para no pasar del tiempo límite). Devuelve
// { secciones: [{ nombre, textos: [{ nombre, texto }], fotos: [{ id, nombre }] }] }.
async function leerCarpeta() {
  const drive = driveGoogle();
  const secciones = [];
  let fotos = 0, documentos = 0;

  async function recorrer(carpetaId, nombre, nivel) {
    const archivos = await listar(drive, carpetaId);
    const seccion = { nombre, textos: [], fotos: [] };
    const subcarpetas = [];
    for (const a of archivos) {
      if (a.mimeType === CARPETA) {
        if (nivel < MAX_NIVEL) subcarpetas.push(recorrer(a.id, nombre ? `${nombre} / ${a.name.trim()}` : a.name.trim(), nivel + 1));
      } else if (/^image\//.test(a.mimeType) && fotos < MAX_FOTOS) {
        fotos++;
        seccion.fotos.push({ id: a.id, nombre: (a.description || '').trim() || sinExtension(a.name) });
      } else if ((a.mimeType === DOCUMENTO || a.mimeType === 'text/plain') && documentos < MAX_DOCUMENTOS) {
        documentos++;
        const texto = await textoDe(drive, a);
        if (texto) seccion.textos.push({ nombre: sinExtension(a.name), texto });
      }
    }
    if (seccion.textos.length || seccion.fotos.length) secciones.push({ ...seccion, nombre: nombre || 'General' });
    await Promise.all(subcarpetas);
  }

  await recorrer(process.env.GOOGLE_DRIVE_CARPETA, '', 0);
  return { secciones };
}

function conTiempoLimite(promesa) {
  let t;
  return Promise.race([promesa, new Promise((_, no) => { t = setTimeout(() => no(new Error('Drive tardó demasiado')), ESPERA_MAX_MS); })])
    .finally(() => clearTimeout(t));
}

// Contenido de la carpeta (con caché). Nunca lanza error.
async function contenidoDrive() {
  if (!configurado()) return { secciones: [] };
  if (cache.datos && Date.now() - cache.hora < MINUTOS_CACHE * 60000) return cache.datos;
  try {
    cache = { datos: await conTiempoLimite(leerCarpeta()), hora: Date.now() };
  } catch (err) {
    console.error('No se pudo leer la carpeta de Drive:', err.message);
    // Se reintenta en 1 minuto, mientras tanto lo último bueno.
    cache = { datos: cache.datos || { secciones: [] }, hora: Date.now() - (MINUTOS_CACHE - 1) * 60000 };
  }
  return cache.datos;
}

const esGaleria = (s) => normal(s.nombre).includes('galeria');
const esPromocion = (s) => normal(s.nombre).includes('promo');
const urlFoto = (id) => `/api/dima-chat?foto=${encodeURIComponent(id)}`;

// Lo que ve la página (sin los textos internos que no son promociones).
async function contenidoPagina() {
  const { secciones } = await contenidoDrive();
  const fotos = (filtro) => secciones.filter(filtro).flatMap(s => s.fotos).map(f => ({ url: urlFoto(f.id), nombre: f.nombre }));
  return {
    galeria: fotos(esGaleria),
    promociones: {
      fotos: fotos(esPromocion),
      textos: secciones.filter(esPromocion).flatMap(s => s.textos.map(t => t.texto)),
    },
  };
}

// Texto para el prompt de DiMa y las fotos que puede mostrar (id "drive:<id>").
async function contenidoDima() {
  const { secciones } = await contenidoDrive();
  const fotos = secciones.flatMap(s => s.fotos.map(f => ({ id: `drive:${f.id}`, url: urlFoto(f.id), tema: `${f.nombre} (${s.nombre})` })));
  const textos = secciones.filter(s => s.textos.length)
    .map(s => `## ${s.nombre}\n${s.textos.map(t => `### ${t.nombre}\n${t.texto}`).join('\n\n')}`).join('\n\n');
  return { textos, fotos, hayPromociones: secciones.some(s => esPromocion(s) && (s.textos.length || s.fotos.length)) };
}

// Baja una foto para servirla desde la página. Solo fotos que están en la
// carpeta: con este endpoint no se puede leer ningún otro archivo de la cuenta.
async function fotoDrive(id) {
  const { secciones } = await contenidoDrive();
  if (!secciones.some(s => s.fotos.some(f => f.id === id))) return null;
  const auth = autorizacion();
  const drive = driveGoogle(auth);
  const meta = await drive.files.get({ fileId: id, fields: 'mimeType, size, thumbnailLink' });
  // Una foto de celular puede pasar los 4.5 MB que Vercel deja responder: se usa
  // la miniatura de Drive a 1600 px; el original solo si es chico.
  if (meta.data.thumbnailLink) {
    const { token } = await auth.getAccessToken();
    const r = await fetch(meta.data.thumbnailLink.replace(/=s\d+$/, '=s1600'), { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) return { tipo: r.headers.get('content-type') || 'image/jpeg', datos: Buffer.from(await r.arrayBuffer()) };
  }
  if (Number(meta.data.size) > 4 * 1024 * 1024) return null;
  const r = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
  return { tipo: meta.data.mimeType || 'image/jpeg', datos: Buffer.from(r.data) };
}

// Para las pruebas.
function limpiarCacheDrive() { cache = { datos: null, hora: 0 }; }

module.exports = { configurado, contenidoDrive, contenidoPagina, contenidoDima, fotoDrive, limpiarCacheDrive };
