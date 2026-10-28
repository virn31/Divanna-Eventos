// api/_agenda.js
// Semáforo de disponibilidad (fase 2 de agenda e inventario). Para un evento
// revisa, contra los eventos AUTORIZADOS que se traslapan:
// - Divanna: piezas por categoría y por artículo exacto (modelo y color) contra
//   INVENTARIO, Casa Isabella y cuántas entregas hay ese día;
// - El Vaso Maíz: personas y equipos ocupados en ese horario contra el
//   personal del día (PERSONAL_DIA, o 12 si no hay renglón).
// Los pedidos pendientes no apartan nada: solo se avisa si compiten por lo mismo.
// Resultado: verde (alcanza), amarillo (se puede con proveedor, personal extra
// o revisión a mano) o rojo (no alcanza). Lo usan _pedidos.js al registrar y el
// dashboard, que lo recalcula en cada carga.

const {
  PERSONAS_POR_EQUIPO, MINUTOS_POR_PIEZA,
  inicioEvento, ventanaOcupacion, ventanaPersonalVasoMaiz,
  inventarioRequerido, piezasVasoMaiz, personalVasoMaiz, leerProductos, leerArticulos,
} = require('./_productos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const TABLES = {
  EVENTOS: 'tblzLAin65BZPP2c6',
  INVENTARIO: 'tblG7pqvkyGTzBxx0',
  PERSONAL_DIA: 'tblYKHBvqC32Aec1F',
};

// Datos de Víctor (2026-10-28).
const PERSONAL_BASE_VASO_MAIZ = 12;  // personas por día si no hay renglón en PERSONAL_DIA
const EQUIPOS_VASO_MAIZ = 6;         // máximo de eventos de El Vaso Maíz al mismo tiempo
const BRIGADAS_DIVANNA = 3;          // Ángel, Edén y Mario
const PEDIDOS_POR_RUTA = 3;          // cada brigada lleva 2 o 3 pedidos por ruta
const HORAS_AVISO_PROVEEDOR = 48;    // a proveedores aliados se les pide con 48 h mínimo
const DIAS_VENTANA = 4;              // eventos que pueden traslaparse (manteles: hasta 3 días)

const H = 3600 * 1000;
const NIVELES = { verde: '🟢 Verde', amarillo: '🟡 Amarillo', rojo: '🔴 Rojo' };
const TITULOS = { verde: 'Hay disponibilidad', amarillo: 'Se puede, con condiciones', rojo: 'No alcanza' };

// Las copas globo y francesa se cuentan juntas a nivel categoría (el paquete
// dice "copa"); el modelo y color exactos se revisan por artículo.
const poolDe = (cat) => (cat === 'Copa' || cat.startsWith('Copa ')) ? 'Copa' : cat;
const traslapa = (a, b) => a && b && a.desde < b.hasta && b.desde < a.hasta;

async function airtableGet(path) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function todasLasPaginas(path) {
  const registros = [];
  let offset = '';
  do {
    const data = await airtableGet(`${path}&pageSize=100${offset ? '&offset=' + offset : ''}`);
    registros.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return registros;
}

// EVENTOS (registro de Airtable) -> lo que necesita el semáforo.
function eventoParaAgenda(r) {
  const f = r.fields || {};
  return {
    id: r.id,
    folio: f.Folio_Evento || '',
    negocio: f.Negocio || '',
    fecha: f.Fecha_Evento || '',
    horaInicio: f.Hora_Inicio || '',
    horasServicio: f.Horas_Servicio || null,
    productos: leerProductos(f.Productos),
    articulos: leerArticulos(f.Articulos),
    personal: f.Personal_Requerido || 0,
    autorizacion: f.Autorizacion_Diana || '',
    servicios: f.Servicios_Solicitados || '',
  };
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function cargarEventosCercanos(fecha) {
  const formula = `AND({Autorizacion_Diana} != "NO", IS_AFTER({Fecha_Evento}, DATETIME_PARSE("${sumarDias(fecha, -DIAS_VENTANA)}")), IS_BEFORE({Fecha_Evento}, DATETIME_PARSE("${sumarDias(fecha, DIAS_VENTANA)}")))`;
  const registros = await todasLasPaginas(`${TABLES.EVENTOS}?filterByFormula=${encodeURIComponent(formula)}`);
  return registros.map(eventoParaAgenda);
}

// Artículos de INVENTARIO con categoría (mobiliario de Divanna).
async function cargarInventario() {
  const registros = await todasLasPaginas(`${TABLES.INVENTARIO}?filterByFormula=${encodeURIComponent('{Categoria} != ""')}`);
  return registros.map(r => ({
    id: r.id,
    nombre: r.fields.Item || '',
    categoria: r.fields.Categoria || '',
    total: r.fields.Cantidad_Total || 0,
  })).sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

// { 'YYYY-MM-DD': personas } desde PERSONAL_DIA.
async function cargarPersonal() {
  const registros = await todasLasPaginas(`${TABLES.PERSONAL_DIA}?filterByFormula=${encodeURIComponent('{Personas} >= 0')}`);
  const mapa = {};
  registros.forEach(r => { if (r.fields.Fecha) mapa[r.fields.Fecha] = r.fields.Personas || 0; });
  return mapa;
}

// Piezas que ocupa un evento por "pool" de categoría: lo que piden sus
// productos o lo que tiene asignado con modelo y color, lo que sea mayor.
function usoPorPool(ev) {
  const uso = {};
  for (const [cat, n] of Object.entries(inventarioRequerido(ev.productos))) {
    uso[poolDe(cat)] = (uso[poolDe(cat)] || 0) + Math.ceil(n);
  }
  const asignado = {};
  for (const a of ev.articulos) asignado[poolDe(a.categoria)] = (asignado[poolDe(a.categoria)] || 0) + a.cantidad;
  for (const [p, n] of Object.entries(asignado)) uso[p] = Math.max(uso[p] || 0, n);
  return uso;
}

const usaDivanna = (ev) => Object.keys(usoPorPool(ev)).length > 0;
const folios = (lista) => lista.map(e => e.folio || 'sin folio').join(', ');

// Evalúa un evento. "otros" son los eventos cercanos (puede incluir al mismo
// evento: se excluye por id). Devuelve { nivel, motivos: [{ nivel, texto }] }.
function evaluarDisponibilidad(ev, { otros = [], inventario = [], personalPorFecha = {}, ahora = Date.now() } = {}) {
  const motivos = [];
  const agregar = (nivel, texto) => motivos.push({ nivel, texto });
  const inicio = inicioEvento(ev.fecha, ev.horaInicio);
  if (inicio === null) return { nivel: 'amarillo', motivos: [{ nivel: 'amarillo', texto: 'Sin fecha válida: no se pudo revisar la agenda.' }] };

  const horasFaltan = (inicio - ahora) / H;
  const demasiadoPronto = horasFaltan < HORAS_AVISO_PROVEEDOR;
  const resto = otros.filter(o => o.id !== ev.id);
  const autorizados = resto.filter(o => o.autorizacion === 'SI');
  const pendientes = resto.filter(o => o.autorizacion === 'Pendiente');
  if (!ev.horaInicio) agregar('info', 'Sin hora registrada: se supuso que empieza a las 2 pm.');

  // ---------- Divanna: inventario ----------
  const uso = usoPorPool(ev);
  if (Object.keys(uso).length) {
    const totalPool = {};
    inventario.forEach(i => { totalPool[poolDe(i.categoria)] = (totalPool[poolDe(i.categoria)] || 0) + i.total; });
    const sinConteo = [];

    for (const [pool, necesita] of Object.entries(uso)) {
      if (!(pool in totalPool)) { sinConteo.push(pool); continue; }
      const ventana = ventanaOcupacion(ev, pool);
      const ocupan = (lista) => lista.filter(o => traslapa(ventanaOcupacion(o, pool), ventana) && usoPorPool(o)[pool]);
      const conAutorizados = ocupan(autorizados);
      const ocupado = conAutorizados.reduce((t, o) => t + usoPorPool(o)[pool], 0);
      const libre = totalPool[pool] - ocupado;
      if (necesita > libre) {
        const faltan = necesita - Math.max(libre, 0);
        const detalle = `${pool}: se necesitan ${necesita}, hay ${totalPool[pool]} y ${ocupado} están en otros eventos${conAutorizados.length ? ' (' + folios(conAutorizados) + ')' : ''}; faltan ${faltan}`;
        if (pool === 'Casa Isabella') agregar('rojo', `Casa Isabella ya está apartada en ese horario (${folios(conAutorizados)}).`);
        else if (demasiadoPronto) agregar('rojo', `${detalle}, y faltan menos de ${HORAS_AVISO_PROVEEDOR} h para pedirlas a un proveedor aliado.`);
        else agregar('amarillo', `${detalle}: pedirlas a un proveedor aliado (con ${HORAS_AVISO_PROVEEDOR} h mínimo, ideal una semana).`);
        continue;
      }
      const compiten = ocupan(pendientes);
      const pendiente = compiten.reduce((t, o) => t + usoPorPool(o)[pool], 0);
      if (necesita > libre - pendiente) {
        agregar('info', `${pool}: alcanza, pero si también se autoriza ${folios(compiten)} faltarían ${necesita - (libre - pendiente)}.`);
      }
    }

    // Modelo y color exactos.
    const porId = new Map(inventario.map(i => [i.id, i]));
    for (const a of ev.articulos) {
      const item = porId.get(a.id);
      if (!item) continue;
      const ventana = ventanaOcupacion(ev, a.categoria);
      const conMismo = autorizados.filter(o => traslapa(ventanaOcupacion(o, a.categoria), ventana) && o.articulos.some(x => x.id === a.id));
      const ocupado = conMismo.reduce((t, o) => t + o.articulos.filter(x => x.id === a.id).reduce((s, x) => s + x.cantidad, 0), 0);
      const libre = item.total - ocupado;
      if (a.cantidad > libre) {
        const texto = `${item.nombre}: se asignaron ${a.cantidad}, hay ${item.total} y ${ocupado} están en ${folios(conMismo)}; faltan ${a.cantidad - Math.max(libre, 0)}`;
        agregar(demasiadoPronto ? 'rojo' : 'amarillo', `${texto}. Cambiar de color o pedir a un proveedor.`);
      }
    }

    if (sinConteo.length) agregar('amarillo', `Sin conteo en INVENTARIO: ${sinConteo.join(', ')}. Revisar a mano.`);

    const sinProductos = autorizados.filter(o => o.fecha === ev.fecha && !o.productos.length && !o.articulos.length && o.negocio !== 'El Vaso Maiz');
    if (sinProductos.length) agregar('amarillo', `Ese día hay ${sinProductos.length} evento(s) autorizado(s) sin productos registrados (${folios(sinProductos)}): revisar a mano lo que se llevan.`);

    const entregas = autorizados.filter(o => o.fecha === ev.fecha && usaDivanna(o)).length + 1;
    const capacidad = BRIGADAS_DIVANNA * PEDIDOS_POR_RUTA;
    if (entregas > capacidad) agregar('amarillo', `Ese día ya serían ${entregas} entregas de Divanna (capacidad aprox. ${capacidad}: ${BRIGADAS_DIVANNA} brigadas x ${PEDIDOS_POR_RUTA} pedidos por ruta).`);
  }

  // ---------- El Vaso Maíz: personal ----------
  const piezas = piezasVasoMaiz(ev.productos);
  if (piezas > 0) {
    const necesita = personalVasoMaiz(piezas, ev.horasServicio);
    const ventana = ventanaPersonalVasoMaiz(ev);
    const conVentana = (lista) => lista
      .filter(o => o.personal > 0)
      .map(o => ({ o, v: ventanaPersonalVasoMaiz(o) }))
      .filter(x => traslapa(x.v, ventana));
    // Pico de personas y equipos ocupados durante nuestra ventana.
    const pico = (lista) => {
      const puntos = [ventana.desde, ...lista.map(x => Math.max(x.v.desde, ventana.desde))];
      let personas = 0, equipos = 0;
      for (const p of puntos) {
        const activos = lista.filter(x => x.v.desde <= p && p < x.v.hasta);
        personas = Math.max(personas, activos.reduce((t, x) => t + x.o.personal, 0));
        equipos = Math.max(equipos, activos.length);
      }
      return { personas, equipos };
    };
    const ocupados = conVentana(autorizados);
    const { personas: ocupadas, equipos } = pico(ocupados);
    const cupo = personalPorFecha[ev.fecha] != null ? personalPorFecha[ev.fecha] : PERSONAL_BASE_VASO_MAIZ;
    const libres = cupo - ocupadas;
    const conQuien = ocupados.length ? ` (${folios(ocupados.map(x => x.o))})` : '';

    if (equipos >= EQUIPOS_VASO_MAIZ) {
      agregar('rojo', `El Vaso Maíz: los ${EQUIPOS_VASO_MAIZ} equipos ya están ocupados en ese horario${conQuien}.`);
    } else if (libres < PERSONAS_POR_EQUIPO) {
      agregar('rojo', `El Vaso Maíz: no queda personal libre en ese horario (cupo ${cupo}, ocupadas ${ocupadas}${conQuien}).`);
    } else if (libres < necesita.personas) {
      const horas = Math.round(piezas * MINUTOS_POR_PIEZA.max / libres / 60 * 2) / 2;
      agregar('amarillo', `El Vaso Maíz: se necesitan ${necesita.personas} personas y quedan ${libres} libres${conQuien}. Con ${libres} la preparación tarda ~${horas} h; o sumar eventuales (cupo del día: ${cupo}).`);
    } else {
      const compiten = conVentana(pendientes);
      const conPendientes = pico([...ocupados, ...compiten]).personas;
      if (compiten.length && cupo - conPendientes < necesita.personas) {
        agregar('info', `El Vaso Maíz: alcanza el personal, pero si también se autoriza ${folios(compiten.map(x => x.o))} no alcanzaría.`);
      }
    }
  }

  if (!ev.productos.length && !ev.articulos.length) {
    agregar('amarillo', 'Sin productos registrados: no se pudo revisar inventario ni personal.');
  }
  if (ev.productos.some(p => p.clave === 'otro')) agregar('info', 'Hay productos fuera del catálogo: revisarlos a mano.');

  const nivel = motivos.some(m => m.nivel === 'rojo') ? 'rojo' : motivos.some(m => m.nivel === 'amarillo') ? 'amarillo' : 'verde';
  const orden = { rojo: 0, amarillo: 1, info: 2 };
  motivos.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return { nivel, motivos };
}

function textoDisponibilidad(resultado) {
  if (!resultado) return '';
  return [`${NIVELES[resultado.nivel]} · ${TITULOS[resultado.nivel]}`, ...resultado.motivos.map(m => `• ${m.texto}`)].join('\n');
}

// Campos para guardar en EVENTOS.
function camposDisponibilidad(resultado) {
  return {
    Disponibilidad: NIVELES[resultado.nivel],
    Disponibilidad_Detalle: resultado.motivos.map(m => `• ${m.texto}`).join('\n'),
  };
}

// Revisión completa con datos de Airtable (al registrar un pedido).
async function revisarDisponibilidad(ev) {
  const [otros, inventario, personalPorFecha] = await Promise.all([
    cargarEventosCercanos(ev.fecha),
    cargarInventario(),
    cargarPersonal(),
  ]);
  return evaluarDisponibilidad(ev, { otros, inventario, personalPorFecha });
}

module.exports = {
  NIVELES,
  TITULOS,
  PERSONAL_BASE_VASO_MAIZ,
  eventoParaAgenda,
  cargarInventario,
  cargarPersonal,
  evaluarDisponibilidad,
  textoDisponibilidad,
  camposDisponibilidad,
  revisarDisponibilidad,
};
