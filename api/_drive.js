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
// - DiMa LEE cada imagen una vez (Claude con visión: qué es y todo su texto,
//   precios, piezas, fechas) y guarda la lectura en la descripción del archivo
//   en Drive, marcada con MARCA_LECTURA y la huella (md5) de la imagen: si Diana
//   cambia la imagen, se vuelve a leer. Corre después de responder (waitUntil),
//   unas cuantas por vez. Si Diana escribe su propia descripción, esa manda y
//   no se lee la imagen.
//
// Variables: GOOGLE_DRIVE_CARPETA (ID de la carpeta, de la URL) y la cuenta de
// servicio de siempre. La carpeta se comparte con la cuenta de servicio como
// Editor (para guardar las lecturas; con Lector solo se queda en memoria) y en
// el proyecto de Google debe estar activa la Google Drive API.
// Sin la variable no hace nada y DiMa sigue solo con el catálogo del código.
//
// Se guarda en memoria 10 minutos. Si Drive falla, se sigue usando lo último que
// se leyó bien (o nada): nunca debe trabar el chat.

const { google } = require('googleapis');
const { Anthropic } = require('@anthropic-ai/sdk');

const MODELO = 'claude-sonnet-5-5';
const MARCA_LECTURA = '[Leído por DiMa · ';
const MAX_CARACTERES_LECTURA = 1500;
const LECTURAS_POR_VUELTA = 6;
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

// Solo lectura para todo, salvo guardar las lecturas de las imágenes (escribir = true).
function autorizacion(escribir = false) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [escribir ? 'https://www.googleapis.com/auth/drive' : 'https://www.googleapis.com/auth/drive.readonly'],
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
      fields: 'nextPageToken, files(id, name, mimeType, description, modifiedTime, md5Checksum)',
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

// Una foto de la carpeta. La descripción en Drive puede ser:
// - la lectura de DiMa ("[Leído por DiMa · <md5>]\n..."): vale si la imagen no cambió;
// - una descripción que escribió Diana: es el nombre de la foto y no se lee la imagen;
// - nada: se usa el nombre del archivo y la imagen queda pendiente de leer.
function datosFoto(a) {
  const descripcion = (a.description || '').trim();
  const huella = String(a.md5Checksum || a.modifiedTime || '').slice(0, 8);
  const foto = { id: a.id, nombre: sinExtension(a.name), lectura: '', pendiente: false, huella };
  if (descripcion.startsWith(MARCA_LECTURA)) {
    const vigente = descripcion.startsWith(`${MARCA_LECTURA}${huella}]`);
    if (vigente) foto.lectura = descripcion.slice(descripcion.indexOf(']') + 1).trim();
    else foto.pendiente = true;
  } else if (descripcion) {
    foto.nombre = descripcion;
  } else {
    foto.pendiente = true;
  }
  return foto;
}

// Recorre la carpeta raíz y sus subcarpetas hasta MAX_NIVEL de profundidad
// (las subcarpetas en paralelo, para no pasar del tiempo límite). Devuelve
// { secciones: [{ nombre, textos: [{ nombre, texto }], fotos: [{ id, nombre, lectura, pendiente, md5 }] }] }.
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
        seccion.fotos.push(datosFoto(a));
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
  const fotos = secciones.flatMap(s => s.fotos.map(f => ({ id: `drive:${f.id}`, url: urlFoto(f.id), tema: `${f.nombre} (${s.nombre})`, lectura: f.lectura || '' })));
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

// ---------- Lectura de las imágenes ----------

let clienteIA = null;
const ia = () => (clienteIA = clienteIA || new Anthropic());
const leyendo = new Set(); // ids que esta instancia ya está leyendo

const INSTRUCCIONES_LECTURA = `Lees imágenes de la carpeta de la gerencia de Divanna Eventos (mobiliario y decoración) y El Vaso Maíz (snacks para eventos), en Culiacán, para que DiMa, la asistente de ventas, sepa qué contienen.
Escribe en español, texto plano sin markdown, máximo ${MAX_CARACTERES_LECTURA} caracteres:
1) En una línea, qué es: flyer de paquetes, promoción, lista de precios, foto de un montaje, etc., y de qué negocio.
2) Si trae texto, transcríbelo COMPLETO y tal cual: nombres de paquetes, precios, piezas y cantidades, lo que incluye, sabores u opciones, fechas de vigencia, horarios, cargos extra y condiciones. Agrupa cada paquete en su renglón.
3) Si es una foto sin texto, descríbela en una o dos frases: tipo de evento, colores, mobiliario y decoración que se ve.
No pongas teléfonos, WhatsApp, redes sociales ni nombres de personas o familias. No inventes nada que no se vea; si algo no se alcanza a leer, escribe "(ilegible)".`;

// Quita teléfonos aunque el modelo los haya copiado.
const sinTelefonos = (t) => String(t).replace(/(?:\+?52[\s.-]*)?\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '').replace(/\b(?:whats\s*app|tel(?:éfono)?)\s*:?\s*(?=\n|$)/gi, '').replace(/[ \t]+\n/g, '\n').trim();

async function leerUnaImagen(foto) {
  const imagen = await fotoDrive(foto.id);
  if (!imagen) throw new Error('no se pudo bajar la imagen');
  const tipo = /^image\/(jpeg|png|webp|gif)$/.test(imagen.tipo) ? imagen.tipo : 'image/jpeg';
  const r = await ia().beta.messages.create({
    model: MODELO,
    max_tokens: 1500,
    output_config: { effort: 'low' },
    system: INSTRUCCIONES_LECTURA,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: tipo, data: imagen.datos.toString('base64') } },
      { type: 'text', text: `Archivo: "${foto.nombre}". ¿Qué contiene esta imagen?` },
    ] }],
  });
  const texto = sinTelefonos(((r && r.content) || []).filter(b => b.type === 'text').map(b => b.text).join('\n')).slice(0, MAX_CARACTERES_LECTURA);
  if (!texto) throw new Error('la lectura salió vacía');
  return texto;
}

// Lee las imágenes pendientes (unas cuantas por vez) y guarda cada lectura en
// la descripción del archivo en Drive. Devuelve { leidas, fallidas }.
async function leerImagenesPendientes({ maximo = LECTURAS_POR_VUELTA } = {}) {
  if (!configurado()) return { leidas: 0, fallidas: 0 };
  const { secciones } = await contenidoDrive();
  const pendientes = secciones.flatMap(s => s.fotos).filter(f => f.pendiente && !leyendo.has(f.id)).slice(0, maximo);
  if (!pendientes.length) return { leidas: 0, fallidas: 0 };
  pendientes.forEach(f => leyendo.add(f.id));
  const drive = driveGoogle(autorizacion(true));
  let leidas = 0, fallidas = 0;
  // De tres en tres para no tardar de más ni saturar la API.
  for (let i = 0; i < pendientes.length; i += 3) {
    await Promise.all(pendientes.slice(i, i + 3).map(async (foto) => {
      try {
        const lectura = await leerUnaImagen(foto);
        foto.lectura = lectura;
        foto.pendiente = false;
        leidas++;
        await drive.files.update({ fileId: foto.id, requestBody: { description: `${MARCA_LECTURA}${foto.huella}]\n${lectura}` }, fields: 'id' })
          .catch(err => console.error('Drive: no se pudo guardar la lectura de', foto.nombre, '-', err.message));
      } catch (err) {
        fallidas++;
        console.error('Drive: no se pudo leer la imagen', foto.nombre, '-', err.message);
      } finally {
        leyendo.delete(foto.id);
      }
    }));
  }
  return { leidas, fallidas };
}

// Lanza la lectura sin hacer esperar al cliente: Vercel la deja terminar
// después de responder (waitUntil). Fuera de Vercel (pruebas) no hace nada.
function leerImagenesEnSegundoPlano() {
  if (!process.env.VERCEL || !configurado()) return;
  const tarea = leerImagenesPendientes().catch(err => console.error('Drive: error leyendo imágenes -', err.message));
  try {
    require('@vercel/functions').waitUntil(tarea);
  } catch (err) {
    console.error('Drive: waitUntil no disponible -', err.message);
  }
}

// Para las pruebas.
function limpiarCacheDrive() { cache = { datos: null, hora: 0 }; }

module.exports = { configurado, contenidoDrive, contenidoPagina, contenidoDima, fotoDrive, leerImagenesPendientes, leerImagenesEnSegundoPlano, limpiarCacheDrive, MARCA_LECTURA };
