// api/_productos.js
// Catálogo estructurado de productos y cálculo de capacidad (fase 1 de agenda
// e inventario). Cada producto tiene una clave fija que DiMa usa al registrar
// el pedido y que se guarda en EVENTOS.Productos (JSON).
// - El Vaso Maíz: "piezas" por unidad -> tiempo de preparación y personal.
// - Divanna: "componentes" por unidad -> piezas de mobiliario por categoría
//   (la misma que INVENTARIO.Categoria), para revisar choques de inventario.
// Los precios siguen en _dima-catalogo.js (aquí solo cantidades y tiempos).
// Si se agrega un producto aquí, DiMa lo puede usar sin más cambios.

// Tiempo estándar por pieza de El Vaso Maíz, ya con el montaje descontado
// (decisión de Víctor 2026-10-28: rango de 3 a 4 minutos por pieza).
const MINUTOS_POR_PIEZA = { min: 3, max: 4 };
// Cada paquete de El Vaso Maíz incluye 2 h de servicio.
const HORAS_SERVICIO_VASO_MAIZ = 2;
// Cada equipo de El Vaso Maíz es de 2 personas (se pueden sumar eventuales).
const PERSONAS_POR_EQUIPO = 2;

// Reglas de ocupación del inventario (Víctor, 2026-10-28):
// - mobiliario: sale en la ruta de logística del día del evento (una brigada
//   lleva 2 o 3 pedidos por ruta), así que queda ocupado todo ese día, y
//   regresa a bodega a más tardar a la 1 pm del día siguiente;
// - mantel (textiles): 48 h de lavado después de regresar a bodega;
// - salon (Casa Isabella): solo las horas del evento.
const HORA_REGRESO_SIGUIENTE_DIA = 13;
const HORAS_LAVADO_MANTEL = 48;
const HORAS_SALON = 5;           // Casa Isabella incluye 5 h de evento
const HORA_INICIO_DEFAULT = '14:00'; // si no hay hora, se supone que empieza en la tarde
const ZONA_HORARIA = '-07:00';   // Culiacán (Sinaloa no cambia de horario)
// El equipo de El Vaso Maíz sale unos 30 min antes de que empiece el evento.
const MINUTOS_SALIDA_VASO_MAIZ = 30;

// Categorías donde importa el modelo y el color: cada artículo de INVENTARIO
// es distinto (Copa Globo - Roja no es Copa Globo - Dorada) y la brigada debe
// cargar exactamente lo asignado. Silla Antonella no: grande y chica solo
// cambian el óvalo del respaldo y se mezclan de 10 en 10 por mesa.
const SIN_VARIANTE = ['Silla Antonella', 'Silla Jardín', 'Mesa', 'Tablón', 'Casa Isabella'];
// Requisitos de paquete que aceptan más de una categoría (el paquete dice
// "copa": el cliente elige globo o francesa, y el color).
const ALTERNATIVAS = { 'Copa': ['Copa globo', 'Copa francesa'] };

const CATEGORIAS = {
  'Mesa': 'mobiliario',
  'Silla Jardín': 'mobiliario',
  'Silla Tiffany': 'mobiliario',
  'Silla Antonella': 'mobiliario',
  'Tablón': 'mobiliario',
  'Mantel': 'mantel',
  'Mantel lentejuela': 'mantel',
  'Mantel corrugado': 'mantel',
  'Servilleta': 'mantel',
  'Copa': 'mobiliario',          // requisito genérico de los paquetes (ver ALTERNATIVAS)
  'Copa globo': 'mobiliario',
  'Copa francesa': 'mobiliario',
  'Plato base': 'mobiliario',
  'Plato trinche': 'mobiliario',
  'Plato grueso': 'mobiliario',
  'Vaso': 'mobiliario',
  'Tenedor': 'mobiliario',
  'Cuchara': 'mobiliario',
  'Cuchillo': 'mobiliario',
  'Centro de mesa': 'mobiliario',
  'Aro': 'mobiliario',
  'Mampara': 'mobiliario',
  'Shimmer': 'mobiliario',
  'Mesita': 'mobiliario',
  'Tapete': 'mobiliario',
  'Número LED': 'mobiliario',
  'Letras LED': 'mobiliario',
  'Arco de cerezos': 'mobiliario',
  'Medio arco de cerezos': 'mobiliario',
  'Arco LED': 'mobiliario',
  'Marco de cerezos': 'mobiliario',
  'Túnel de luces': 'mobiliario',
  'Mesa de honor': 'mobiliario',
  'Foto gigante': 'mobiliario',
  'Casa Isabella': 'salon',
};

const VM = 'El Vaso Maiz';
const DV = 'Divanna Eventos';

// Paquetes de mesas: mesas, sillas, manteles, plato base, copa y servilleta por persona.
function mesas(personas, silla, mantel, conCubiertos) {
  const c = {
    'Mesa': personas / 10,
    [mantel]: personas / 10,
    'Plato base': personas,
    'Copa': personas,
    'Servilleta': personas,
  };
  if (silla) c[silla] = personas;
  if (conCubiertos) Object.assign(c, { 'Tenedor': personas, 'Cuchara': personas, 'Cuchillo': personas });
  return c;
}

const PRODUCTOS = {
  // ---------- El Vaso Maíz (piezas a preparar) ----------
  vm_paquete_1: { nombre: 'Paquete 1 de El Vaso Maíz (55 pz)', negocio: VM, piezas: 55 },
  vm_paquete_2: { nombre: 'Paquete 2 de El Vaso Maíz (75 pz)', negocio: VM, piezas: 75 },
  vm_paquete_3: { nombre: 'Paquete 3 de El Vaso Maíz (90 pz)', negocio: VM, piezas: 90 },
  vm_paquete_4: { nombre: 'Paquete 4 de El Vaso Maíz (100 pz)', negocio: VM, piezas: 100 },
  vm_paquete_5: { nombre: 'Paquete 5 de El Vaso Maíz (120 pz)', negocio: VM, piezas: 120 },
  vm_sabritas_preparadas: { nombre: 'Sabritas preparadas (por pieza)', negocio: VM, piezas: 1 },
  vm_raspado: { nombre: 'Raspado (por pieza)', negocio: VM, piezas: 1 },
  vm_elote_forrado: { nombre: 'Elote forrado (por pieza)', negocio: VM, piezas: 1 },
  vm_maruchan: { nombre: 'Maruchan preparada (por pieza)', negocio: VM, piezas: 1 },
  vm_pieza: { nombre: 'Otra pieza suelta de El Vaso Maíz (fresas, esquite, etc.)', negocio: VM, piezas: 1 },

  // ---------- Divanna: mobiliario por pieza ----------
  dv_mesa_10_jardin: { nombre: 'Mesa con 10 sillas Jardinera y mantel', negocio: DV, componentes: { 'Mesa': 1, 'Silla Jardín': 10, 'Mantel': 1 } },
  dv_mesa_mantel: { nombre: 'Mesa con mantel, sin sillas', negocio: DV, componentes: { 'Mesa': 1, 'Mantel': 1 } },
  dv_silla_jardin: { nombre: 'Silla Jardinera', negocio: DV, componentes: { 'Silla Jardín': 1 } },
  dv_silla_tiffany: { nombre: 'Silla Tiffany', negocio: DV, componentes: { 'Silla Tiffany': 1 } },
  dv_silla_antonella: { nombre: 'Silla Antonella', negocio: DV, componentes: { 'Silla Antonella': 1 } },
  dv_mantel: { nombre: 'Mantel extra', negocio: DV, componentes: { 'Mantel': 1 } },
  dv_mantel_corrugado: { nombre: 'Mantel corrugado', negocio: DV, componentes: { 'Mantel corrugado': 1 } },
  dv_copa_globo: { nombre: 'Copa globo', negocio: DV, componentes: { 'Copa globo': 1 } },
  dv_copa_francesa: { nombre: 'Copa francesa', negocio: DV, componentes: { 'Copa francesa': 1 } },
  dv_plato_base: { nombre: 'Plato base (porta plato)', negocio: DV, componentes: { 'Plato base': 1 } },
  dv_plato_trinche: { nombre: 'Plato trinche', negocio: DV, componentes: { 'Plato trinche': 1 } },
  dv_vaso: { nombre: 'Vaso', negocio: DV, componentes: { 'Vaso': 1 } },
  dv_servilleta: { nombre: 'Servilleta', negocio: DV, componentes: { 'Servilleta': 1 } },
  dv_kit_cubiertos: { nombre: 'Kit de cubiertos (tenedor, cuchara y cuchillo)', negocio: DV, componentes: { 'Tenedor': 1, 'Cuchara': 1, 'Cuchillo': 1 } },
  dv_tenedor: { nombre: 'Tenedor', negocio: DV, componentes: { 'Tenedor': 1 } },
  dv_cuchara: { nombre: 'Cuchara', negocio: DV, componentes: { 'Cuchara': 1 } },
  dv_cuchillo: { nombre: 'Cuchillo', negocio: DV, componentes: { 'Cuchillo': 1 } },
  dv_personalizado: { nombre: 'Personalizado en plato', negocio: DV },

  // ---------- Divanna: paquetes de mesas por personas ----------
  dv_paq20_jardin_basico: { nombre: 'Paquete 20 personas, sillas Jardín, básico', negocio: DV, componentes: mesas(20, 'Silla Jardín', 'Mantel', false) },
  dv_paq20_antonella: { nombre: 'Paquete 20 personas, sillas Antonella, mantel básico', negocio: DV, componentes: mesas(20, 'Silla Antonella', 'Mantel', true) },
  dv_paq20_antonella_lentejuela: { nombre: 'Paquete 20 personas, sillas Antonella, mantel lentejuela', negocio: DV, componentes: mesas(20, 'Silla Antonella', 'Mantel lentejuela', true) },
  dv_paq20_tiffany_lentejuela: { nombre: 'Paquete 20 personas, sillas Tiffany, mantel lentejuela corrugado', negocio: DV, componentes: mesas(20, 'Silla Tiffany', 'Mantel corrugado', true) },
  dv_paq20_decoracion: { nombre: 'Paquete 20 personas + decoración (aro o mampara), silla a elección', negocio: DV, sillaAEleccion: true, componentes: { ...mesas(20, null, 'Mantel', true), 'Aro': 1, 'Mesita': 1, 'Tapete': 1 } },
  dv_paq50_jardin_basico: { nombre: 'Paquete 50 personas, sillas Jardín, básico', negocio: DV, componentes: mesas(50, 'Silla Jardín', 'Mantel', false) },
  dv_paq50_tiffany_jardin: { nombre: 'Paquete 50 personas, sillas Tiffany o Jardín a elección, con cubiertos', negocio: DV, sillaAEleccion: true, componentes: mesas(50, null, 'Mantel', true) },
  dv_paq50_tiffany_lentejuela: { nombre: 'Paquete 50 personas, sillas Tiffany, mantel lentejuela corrugado', negocio: DV, componentes: mesas(50, 'Silla Tiffany', 'Mantel corrugado', true) },
  dv_paq50_antonella: { nombre: 'Paquete 50 personas, sillas Antonella, mantel básico', negocio: DV, componentes: mesas(50, 'Silla Antonella', 'Mantel', true) },
  dv_paq50_antonella_lujo: { nombre: 'Paquete 50 personas, sillas Antonella, mantel lentejuela de lujo y centro de mesa', negocio: DV, componentes: { ...mesas(50, 'Silla Antonella', 'Mantel lentejuela', true), 'Centro de mesa': 5 } },

  // ---------- Divanna: combos de cristalería ----------
  dv_crist50_trinche: { nombre: 'Cristalería 50 personas: plato trinche, vaso y tenedor', negocio: DV, componentes: { 'Plato trinche': 50, 'Vaso': 50, 'Tenedor': 50 } },
  dv_crist50_grueso: { nombre: 'Cristalería 50 personas: plato grueso, vaso y tenedor', negocio: DV, componentes: { 'Plato grueso': 50, 'Vaso': 50, 'Tenedor': 50 } },
  dv_crist100: { nombre: 'Cristalería 100 personas: plato base, copa, servilleta, cubiertos y personalizado', negocio: DV, componentes: { 'Plato base': 100, 'Copa': 100, 'Servilleta': 100, 'Tenedor': 100, 'Cuchara': 100, 'Cuchillo': 100 } },

  // ---------- Divanna: decoración ----------
  dv_aro: { nombre: 'Decoración Aro', negocio: DV, componentes: { 'Aro': 1, 'Mesita': 1, 'Tapete': 1 } },
  dv_mampara_lisa: { nombre: 'Mampara lisa', negocio: DV, componentes: { 'Mampara': 1, 'Mesita': 2, 'Tapete': 1 } },
  dv_mampara_lona: { nombre: 'Mampara con lona personalizada', negocio: DV, componentes: { 'Mampara': 1, 'Mesita': 2, 'Tapete': 1 } },
  dv_shimmer: { nombre: 'Shimmer panel 3D', negocio: DV, componentes: { 'Shimmer': 1, 'Mesita': 1, 'Tapete': 1 } },
  dv_mesita_extra: { nombre: 'Mesita de herrería extra', negocio: DV, componentes: { 'Mesita': 1 } },
  dv_numero_led: { nombre: 'Número LED gigante (por dígito)', negocio: DV, componentes: { 'Número LED': 1 } },
  dv_lona: { nombre: 'Lona personalizada', negocio: DV },
  dv_figura_coroplast: { nombre: 'Figura de coroplast', negocio: DV },
  dv_tapete_liso: { nombre: 'Tapete liso (upgrade)', negocio: DV },
  dv_arco_cerezos: { nombre: 'Arco de cerezos', negocio: DV, componentes: { 'Arco de cerezos': 1 } },
  dv_tunel_luces: { nombre: 'Túnel de luces 4 m', negocio: DV, componentes: { 'Túnel de luces': 1 } },
  dv_tunel_marco_cerezos: { nombre: 'Túnel de luces 4 m con marco de cerezos', negocio: DV, componentes: { 'Túnel de luces': 1, 'Marco de cerezos': 1 } },
  dv_tunel_6_arcos: { nombre: 'Túnel de 6 medios arcos de cerezos con 3 arcos LED', negocio: DV, componentes: { 'Medio arco de cerezos': 6, 'Arco LED': 3 } },
  dv_paquete_boda: { nombre: 'Paquete de decoración para boda', negocio: DV, componentes: { 'Mesa de honor': 1, 'Marco de cerezos': 1, 'Arco de cerezos': 1, 'Foto gigante': 1, 'Letras LED': 3 } },
  dv_paquete_xv: { nombre: 'Paquete para XV años', negocio: DV, componentes: { 'Mesa de honor': 1, 'Marco de cerezos': 1, 'Arco de cerezos': 1, 'Foto gigante': 1, 'Letras LED': 2 } },
  dv_casa_isabella: { nombre: 'Renta de Casa Isabella (salón)', negocio: DV, componentes: { 'Casa Isabella': 1 } },

  otro: { nombre: 'Otro (descríbelo en la nota)', negocio: null },
};

const CLAVES = Object.keys(PRODUCTOS);
const MAX_RENGLONES = 40;
const MAX_CANTIDAD = 5000;

// Limpia lo que manda DiMa o el dashboard: solo claves conocidas, cantidades
// enteras positivas, nota corta. Junta renglones repetidos sin nota.
function normalizarProductos(lista) {
  if (!Array.isArray(lista)) return [];
  const salida = [];
  for (const p of lista.slice(0, MAX_RENGLONES)) {
    if (!p || !PRODUCTOS[p.clave]) continue;
    const cantidad = Math.floor(Number(p.cantidad));
    if (!(cantidad > 0) || cantidad > MAX_CANTIDAD) continue;
    const nota = String(p.nota == null ? '' : p.nota).trim().slice(0, 150);
    const igual = !nota && salida.find(s => s.clave === p.clave && !s.nota);
    if (igual) igual.cantidad = Math.min(MAX_CANTIDAD, igual.cantidad + cantidad);
    else salida.push(nota ? { clave: p.clave, cantidad, nota } : { clave: p.clave, cantidad });
  }
  return salida;
}

// Lee EVENTOS.Productos (JSON). Si está vacío o roto, lista vacía.
function leerProductos(texto) {
  try { return normalizarProductos(JSON.parse(texto || '[]')); } catch (e) { return []; }
}

function piezasVasoMaiz(lista) {
  return lista.reduce((t, p) => t + (PRODUCTOS[p.clave].piezas || 0) * p.cantidad, 0);
}

// Personal para preparar las piezas en las horas de servicio. "personas" usa
// el tiempo alto (4 min) para no quedarse corto; nunca menos de un equipo.
function personalVasoMaiz(piezas, horas) {
  if (!(piezas > 0)) return null;
  const h = horas > 0 ? horas : HORAS_SERVICIO_VASO_MAIZ;
  const minutos = { min: piezas * MINUTOS_POR_PIEZA.min, max: piezas * MINUTOS_POR_PIEZA.max };
  const necesarias = m => Math.max(PERSONAS_POR_EQUIPO, Math.ceil(m / (h * 60)));
  return {
    piezas,
    horas: h,
    personas: necesarias(minutos.max),
    personasMin: necesarias(minutos.min),
    // Cuánto tardaría un solo equipo (2 personas) en preparar todo.
    horasUnEquipo: { min: minutos.min / PERSONAS_POR_EQUIPO / 60, max: minutos.max / PERSONAS_POR_EQUIPO / 60 },
  };
}

// Piezas de inventario de Divanna por categoría.
function inventarioRequerido(lista) {
  const total = {};
  for (const p of lista) {
    for (const [cat, n] of Object.entries(PRODUCTOS[p.clave].componentes || {})) {
      total[cat] = (total[cat] || 0) + n * p.cantidad;
    }
  }
  return total;
}

const H = 3600 * 1000;

function inicioEvento(fecha, horaInicio) {
  const hora = /^\d{2}:\d{2}$/.test(horaInicio || '') ? horaInicio : HORA_INICIO_DEFAULT;
  const inicio = Date.parse(`${fecha}T${hora}:00${ZONA_HORARIA}`);
  return Number.isNaN(inicio) ? null : inicio;
}

// Ventana en la que una categoría queda ocupada por un evento (ms desde epoch).
function ventanaOcupacion({ fecha, horaInicio, horasServicio }, categoria) {
  const inicio = inicioEvento(fecha, horaInicio);
  if (inicio === null) return null;
  const regla = CATEGORIAS[categoria] || 'mobiliario';
  if (regla === 'salon') {
    return { desde: inicio - H, hasta: inicio + Math.max(horasServicio || 0, HORAS_SALON) * H + H };
  }
  const dia = Date.parse(`${fecha}T00:00:00${ZONA_HORARIA}`);
  const regreso = dia + (24 + HORA_REGRESO_SIGUIENTE_DIA) * H;
  return { desde: dia, hasta: regla === 'mantel' ? regreso + HORAS_LAVADO_MANTEL * H : regreso };
}

// Ventana en la que el personal de El Vaso Maíz está ocupado: sale 30 min antes
// y termina al acabar el servicio (el regreso se cuenta en la fase de agenda).
function ventanaPersonalVasoMaiz({ fecha, horaInicio, horasServicio }) {
  const inicio = inicioEvento(fecha, horaInicio);
  if (inicio === null) return null;
  const h = horasServicio > 0 ? horasServicio : HORAS_SERVICIO_VASO_MAIZ;
  return { desde: inicio - MINUTOS_SALIDA_VASO_MAIZ * 60 * 1000, hasta: inicio + h * H };
}

// Artículos exactos (modelo y color) que Diana asigna a un evento, tomados de
// INVENTARIO: [{ id, nombre, categoria, cantidad }]. "inventario" es la lista
// de INVENTARIO con categoría; solo se aceptan artículos que existan ahí.
function normalizarArticulos(lista, inventario) {
  if (!Array.isArray(lista)) return [];
  const porId = new Map((inventario || []).map(i => [i.id, i]));
  const salida = [];
  for (const a of lista.slice(0, MAX_RENGLONES)) {
    const item = a && porId.get(a.id);
    const cantidad = Math.floor(Number(a && a.cantidad));
    if (!item || !(cantidad > 0) || cantidad > MAX_CANTIDAD) continue;
    const igual = salida.find(s => s.id === item.id);
    if (igual) igual.cantidad = Math.min(MAX_CANTIDAD, igual.cantidad + cantidad);
    else salida.push({ id: item.id, nombre: item.nombre, categoria: item.categoria, cantidad });
  }
  return salida;
}

function leerArticulos(texto) {
  try {
    const lista = JSON.parse(texto || '[]');
    return Array.isArray(lista) ? lista.filter(a => a && a.id && a.nombre && a.cantidad > 0) : [];
  } catch (e) { return []; }
}

// Por cada categoría que pide el evento: cuántas piezas requiere, cuántas ya
// tienen modelo y color asignados, y si hace falta asignarlos (la categoría
// tiene más de un artículo en INVENTARIO, o el paquete deja elegir el modelo).
function coberturaArticulos(requerido, articulos, inventario) {
  const asignables = {};
  for (const a of articulos) asignables[a.categoria] = (asignables[a.categoria] || 0) + a.cantidad;
  const variantes = (cat) => (inventario || []).filter(i => i.categoria === cat).length;
  // Primero las categorías específicas, después las genéricas ("Copa"), para no contar dos veces.
  const orden = Object.keys(requerido).sort((a, b) => (ALTERNATIVAS[a] ? 1 : 0) - (ALTERNATIVAS[b] ? 1 : 0));
  return orden.map(cat => {
    const req = Math.ceil(requerido[cat]);
    let asignado = 0;
    for (const c of ALTERNATIVAS[cat] || [cat]) {
      const usar = Math.min(asignables[c] || 0, req - asignado);
      asignado += usar;
      asignables[c] = (asignables[c] || 0) - usar;
    }
    const necesitaVariante = !SIN_VARIANTE.includes(cat) && (!!ALTERNATIVAS[cat] || variantes(cat) > 1);
    return { categoria: cat, requerido: req, asignado, necesitaVariante };
  });
}

// Lo que falta asignar con modelo y color, en texto: "100 Copa (50 asignadas), 10 Mantel".
function textoPorAsignar(cobertura) {
  return cobertura
    .filter(c => c.necesitaVariante && c.asignado < c.requerido)
    .map(c => `${c.requerido} ${c.categoria}${c.asignado ? ` (${c.asignado} asignadas)` : ''}`)
    .join(', ');
}

function horasTexto(h) {
  const redondo = Math.round(h * 2) / 2;
  return `${String(redondo).replace('.5', '½')} h`;
}

function nombreProducto(clave) {
  return PRODUCTOS[clave] ? PRODUCTOS[clave].nombre : clave;
}

// Líneas legibles de los productos: "2 × Paquete 50 personas... (nota)".
function textoProductos(lista) {
  return lista.map(p => `${p.cantidad} × ${nombreProducto(p.clave)}${p.nota ? ' (' + p.nota + ')' : ''}`).join('\n');
}

// Lo que se guarda en EVENTOS al registrar o ajustar un pedido.
function capacidadEvento(lista, horasServicio) {
  const piezas = piezasVasoMaiz(lista);
  const personal = personalVasoMaiz(piezas, horasServicio);
  const inventario = inventarioRequerido(lista);
  const lineas = [];
  if (personal) {
    lineas.push(`🌽 El Vaso Maíz: ${piezas} piezas · ${personal.personasMin === personal.personas ? personal.personas : personal.personasMin + ' a ' + personal.personas} personas para ${horasTexto(personal.horas)} de servicio` +
      ` (un equipo de ${PERSONAS_POR_EQUIPO} tardaría ${horasTexto(personal.horasUnEquipo.min)} a ${horasTexto(personal.horasUnEquipo.max)})`);
  }
  const cats = Object.entries(inventario);
  if (cats.length) lineas.push('🪑 Divanna: ' + cats.map(([c, n]) => `${Math.ceil(n)} ${c}`).join(', '));
  if (lista.some(p => PRODUCTOS[p.clave].sillaAEleccion) && !Object.keys(inventario).some(c => c.startsWith('Silla'))) {
    lineas.push('⚠️ Falta indicar la silla elegida del paquete.');
  }
  if (lista.some(p => p.clave === 'otro')) lineas.push('ℹ️ Hay productos fuera del catálogo: revísalos a mano.');
  return {
    piezas,
    personal: personal ? personal.personas : 0,
    inventario,
    resumen: lineas.join('\n'),
  };
}

// Lista para el dashboard (selector de productos).
function catalogoParaDashboard() {
  return CLAVES.map(clave => ({ clave, nombre: PRODUCTOS[clave].nombre, negocio: PRODUCTOS[clave].negocio || '' }));
}

module.exports = {
  MINUTOS_POR_PIEZA,
  HORAS_SERVICIO_VASO_MAIZ,
  PERSONAS_POR_EQUIPO,
  CATEGORIAS,
  SIN_VARIANTE,
  ALTERNATIVAS,
  PRODUCTOS,
  CLAVES,
  normalizarProductos,
  leerProductos,
  piezasVasoMaiz,
  personalVasoMaiz,
  inventarioRequerido,
  inicioEvento,
  ventanaOcupacion,
  ventanaPersonalVasoMaiz,
  normalizarArticulos,
  leerArticulos,
  coberturaArticulos,
  textoPorAsignar,
  textoProductos,
  capacidadEvento,
  catalogoParaDashboard,
};
