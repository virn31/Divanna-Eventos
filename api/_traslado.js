// api/_traslado.js
// Aproximado del costo de traslado para eventos fuera de la ciudad.
// Regla de Víctor: se mide desde la salida de Culiacán (lo que mida el mapa),
// a $10 por km, ida y vuelta, en dos ocasiones (ir a dejar y regresar, ir a
// recoger y regresar) => km desde la salida x $10 x 4.
//
// La distancia es por carretera con OpenStreetMap (geocodificación con
// Nominatim y ruta con OSRM, gratis y sin llave). La "salida" es el punto
// donde la ruta deja el límite oficial de Culiacán Rosales (_culiacan-limite.json,
// tomado de OpenStreetMap, relación 11107084). Suele quedar a pocos km de lo
// que marca Google; siempre se presenta como aproximado.

const LIMITE_CIUDAD = require('./_culiacan-limite.json');

const PRECIO_POR_KM = 10;
// Límite de servicio: no se atienden eventos a más de 35 km de la salida de
// Culiacán (decisión de Víctor, por seguridad y por costos).
const LIMITE_KM = 35;
const VIAJES = 4; // 2 viajes redondos
const CENTRO_CULIACAN = [-107.3940, 24.8091]; // [lng, lat]
// Rectángulo de Sinaloa para que la búsqueda no encuentre otro "San Pedro".
const CAJA_SINALOA = '-109.5,27.1,-105.3,22.4';
const AGENTE = 'DiMa-Divanna/1.0 (dima.divanna@gmail.com)';

async function getJson(url, ms = 8000) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es' }, signal: control.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(reloj);
  }
}

// ¿El punto [lng, lat] está dentro de alguno de los polígonos de la ciudad?
function dentroDeCiudad([x, y]) {
  return LIMITE_CIUDAD.some(anillo => {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  });
}

function metros([lng1, lat1], [lng2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

async function geocodificar(destino) {
  const q = encodeURIComponent(`${destino}, Sinaloa, México`);
  const resultados = await getJson(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=mx&viewbox=${CAJA_SINALOA}&bounded=1`
  );
  const r = resultados[0];
  return r ? { punto: [Number(r.lon), Number(r.lat)], nombre: r.display_name.split(',').slice(0, 3).join(',').trim() } : null;
}

// Devuelve { ok: true, lugar, kmDesdeSalida, costo, dentroDeCiudad, fueraDeCobertura } o { ok: false, motivo }.
async function estimarTraslado(destino) {
  const texto = String(destino || '').trim().slice(0, 120);
  if (!texto) return { ok: false, motivo: 'Falta el lugar del evento.' };
  try {
    const lugar = await geocodificar(texto);
    if (!lugar) return { ok: false, motivo: 'No encontré ese lugar en el mapa.' };
    if (dentroDeCiudad(lugar.punto)) {
      return { ok: true, lugar: lugar.nombre, dentroDeCiudad: true, kmDesdeSalida: 0, costo: 0, fueraDeCobertura: false };
    }

    const coords = `${CENTRO_CULIACAN.join(',')};${lugar.punto.join(',')}`;
    const ruta = await getJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const r = ruta.routes && ruta.routes[0];
    if (!r) return { ok: false, motivo: 'No encontré una ruta por carretera a ese lugar.' };

    // Recorre la ruta y suma lo que queda fuera de la ciudad desde que sale
    // por primera vez (la "salida de Culiacán").
    const puntos = r.geometry.coordinates;
    let totalGeo = 0;
    let fueraGeo = 0;
    let yaSalio = false;
    for (let i = 1; i < puntos.length; i++) {
      const tramo = metros(puntos[i - 1], puntos[i]);
      totalGeo += tramo;
      if (!yaSalio && !dentroDeCiudad(puntos[i])) yaSalio = true;
      if (yaSalio) fueraGeo += tramo;
    }
    // Se escala a la distancia oficial de la ruta (la geometría es simplificada).
    const kmDesdeSalida = totalGeo > 0 ? Math.round(((r.distance * fueraGeo) / totalGeo) / 1000) : Math.round(r.distance / 1000);
    const costo = Math.round((kmDesdeSalida * PRECIO_POR_KM * VIAJES) / 10) * 10;
    return { ok: true, lugar: lugar.nombre, dentroDeCiudad: false, kmDesdeSalida, costo, fueraDeCobertura: kmDesdeSalida > LIMITE_KM };
  } catch (err) {
    console.error('Error estimando traslado:', err.message);
    return { ok: false, motivo: 'No pude consultar el mapa en este momento.' };
  }
}

module.exports = { estimarTraslado, dentroDeCiudad, PRECIO_POR_KM, VIAJES, LIMITE_KM };
