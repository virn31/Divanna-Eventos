// Pruebas de los endpoints con Airtable, Gmail, Claude y push simulados.
// Correr con: npm test  (no llama a ningún servicio real).
const path = require('path');
const repo = path.resolve(__dirname, '..');
const Module = require('module');

const correos = [];
const pushes = [];
const llamadasClaude = [];
let respuestasClaude = [];
class APIError extends Error {}
class RateLimitError extends APIError {}
class AnthropicMock {
  constructor() {
    this.beta = { messages: { create: async (params) => { llamadasClaude.push(params); return respuestasClaude.shift(); } } };
  }
}
AnthropicMock.APIError = APIError;
AnthropicMock.RateLimitError = RateLimitError;

const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { correos.push(m); } }) };
  if (req === 'googleapis') {
    return { google: { auth: { JWT: function () {} }, calendar: () => ({ events: {
      insert: async (p) => { googleCal.push({ op: 'insert', ...p }); return { data: { id: 'gcal' + googleCal.length, htmlLink: 'x' } }; },
      update: async (p) => { googleCal.push({ op: 'update', ...p }); return { data: {} }; },
      delete: async (p) => { googleCal.push({ op: 'delete', ...p }); return {}; },
    } }), sheets: () => ({ spreadsheets: { values: { append: async () => ({}) } } }) } };
  }
  if (req === '@anthropic-ai/sdk') return { Anthropic: AnthropicMock };
  if (req === 'web-push') {
    return {
      setVapidDetails() {},
      async sendNotification(sub, payload) {
        if (sub.endpoint.includes('vencida')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
        pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      },
    };
  }
  return origLoad.call(this, req, parent, ...rest);
};

const llamadas = [];
const googleCal = [];
let bloqueosPrueba = [];
let bloqueoLeido = null;
let llenosPrueba = []; // eventos autorizados que lee diasLlenos (días sin cupo)
let respuestas = [];
const telegram = [];
let mapaCaido = false;
let telegramFalla = false;
global.fetch = async (url, opts = {}) => {
  if (url.startsWith('https://nominatim.openstreetmap.org/') || url.startsWith('https://router.project-osrm.org/')) {
    if (mapaCaido) return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    if (url.includes('nominatim')) {
      const q = decodeURIComponent(url);
      const lugar = q.includes('Las Quintas') ? { lat: '24.7905', lon: '-107.3805', display_name: 'Las Quintas, Culiacán Rosales, Culiacán, Sinaloa' }
        : q.includes('Eldorado') ? { lat: '24.3236', lon: '-107.3642', display_name: 'Eldorado, Culiacán, Sinaloa' }
        : { lat: '24.7734', lon: '-107.5504', display_name: 'San Pedro, Navolato, Sinaloa, México' };
      return { ok: true, status: 200, json: async () => [lugar] };
    }
    // Ruta en línea recta del centro (dentro de la ciudad) al destino de la URL,
    // con distancia por carretera = 1.3 x la distancia en línea recta.
    const [, destino] = url.split('/driving/')[1].split('?')[0].split(';');
    const [lngD, latD] = destino.split(',').map(Number);
    const pasos = 60;
    const coords = Array.from({ length: pasos + 1 }, (_, i) => [-107.3940 + (lngD + 107.3940) * i / pasos, 24.8091 + (latD - 24.8091) * i / pasos]);
    const rad = Math.PI / 180;
    const recta = 2 * 6371000 * Math.asin(Math.sqrt(Math.sin((latD - 24.8091) * rad / 2) ** 2 + Math.cos(24.8091 * rad) * Math.cos(latD * rad) * Math.sin((lngD + 107.3940) * rad / 2) ** 2));
    return { ok: true, status: 200, json: async () => ({ routes: [{ distance: recta * 1.3, geometry: { coordinates: coords } }] }) };
  }
  // DIAS_BLOQUEADOS tiene su propia respuesta (el chat la consulta en cada mensaje):
  // las lecturas no consumen respuestas de Airtable; las escrituras se registran.
  if (url.includes('tblHSdMCxW2kkiiC9')) {
    if (opts.method && opts.method !== 'GET') {
      llamadas.push({ url: decodeURIComponent(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, status: 200, json: async () => (opts.method === 'POST' ? { records: [{ id: 'recBLOQUEONUEVO01' }] } : bloqueoLeido || {}), text: async () => '' };
    }
    const unico = /tblHSdMCxW2kkiiC9\/rec/.test(url);
    return { ok: true, status: 200, json: async () => (unico ? bloqueoLeido || {} : { records: bloqueosPrueba }), text: async () => '' };
  }
  // La lectura de días llenos (diasLlenos) tiene su propia respuesta.
  if (decodeURIComponent(url).includes('NOT({Cancelado}), NOT(IS_BEFORE({Fecha_Evento}')) {
    return { ok: true, status: 200, json: async () => ({ records: llenosPrueba }), text: async () => '' };
  }
  // Las llamadas a Telegram se registran aparte y no consumen respuestas de Airtable.
  if (url.startsWith('https://api.telegram.org/')) {
    telegram.push({ metodo: url.split('/').pop(), body: JSON.parse(opts.body) });
    if (telegramFalla) return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }), text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
  }
  llamadas.push({ url: decodeURIComponent(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const r = respuestas.shift() || { records: [] };
  return { ok: true, status: 200, json: async () => r, text: async () => '' };
};

function resMock() {
  const r = { code: null, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

process.env.EMAILS_EQUIPO = 'diana@example.com, victor@example.com';
process.env.GMAIL_USER = 'dima@example.com';
process.env.SESSION_SECRET = 'secreto-de-prueba';
process.env.VAPID_PUBLIC_KEY = 'publica';
process.env.VAPID_PRIVATE_KEY = 'privada';
process.env.VAPID_SUBJECT = 'mailto:prueba@example.com';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'cuenta@prueba.iam.gserviceaccount.com';
process.env.GOOGLE_PRIVATE_KEY = 'llave-de-prueba';
process.env.GOOGLE_CALENDAR_ID = 'calendario@prueba.com';

const ok = (cond, msg) => { console.log((cond ? 'PASA ' : 'FALLA') + ' - ' + msg); if (!cond) process.exitCode = 1; };
const reset = () => { require(path.join(repo, 'api/_calendario.js')).olvidarLlenos(); llenosPrueba = []; googleCal.length = 0; bloqueosPrueba = []; bloqueoLeido = null; mapaCaido = false; telegramFalla = false; llamadas.length = 0; correos.length = 0; pushes.length = 0; telegram.length = 0; llamadasClaude.length = 0; respuestas = []; respuestasClaude = []; };

const ADMIN = { id: 'recCOLAB000000001', fields: { Nombre: 'Diana', Rol: 'Admin', Activo: true } };
const LIDER = { id: 'recCOLAB000000002', fields: { Nombre: 'Juan', Rol: 'Lider de brigada', Activo: true, Brigada: ['recBRIGADA0000001'] } };
const ASIST = { id: 'recCOLAB000000003', fields: { Nombre: 'Luis', Rol: 'Asistente', Activo: true, Brigada: ['recBRIGADA0000001'] } };
const ENCARG = { id: 'recCOLAB000000004', fields: { Nombre: 'Ana', Rol: 'Encargada de evento', Activo: true } };

(async () => {
  const pedido = require(path.join(repo, 'api/pedido.js'));
  const dash = require(path.join(repo, 'api/dashboard-eventos.js'));
  const estatus = require(path.join(repo, 'api/brigada-estatus.js'));
  const checklist = require(path.join(repo, 'api/brigada-checklist.js'));
  const eventosApi = require(path.join(repo, 'api/brigada-eventos.js'));
  const balance = require(path.join(repo, 'api/balance-semanal.js'));
  const sesionApi = require(path.join(repo, 'api/sesion.js'));
  const chatApi = require(path.join(repo, 'api/dima-chat.js'));
  const pushApi = require(path.join(repo, 'api/push.js'));
  const telegramApi = require(path.join(repo, 'api/telegram.js'));
  const produccionApi = require(path.join(repo, 'api/produccion-diaria.js'));
  // Cada llamada al chat simula una IP distinta para no chocar con el límite por IP.
  let ipN = 0;
  const chat = (body) => { const r = resMock(); return chatApi({ method: 'POST', body, headers: { 'x-forwarded-for': `10.0.0.${++ipN}` } }, r).then(() => r); };

  // Login real contra Airtable simulado, para obtener tokens válidos.
  async function login(colab) {
    reset();
    respuestas = [{ records: [colab] }];
    const res = resMock();
    await sesionApi({ method: 'POST', body: { usuario: 'Diana', pin: '123456' } }, res);
    return res;
  }
  const auth = (token) => ({ authorization: `Bearer ${token}` });

  // ---------- Login ----------
  let res = await login(ADMIN);
  const tokenAdmin = res.body.token;
  ok(res.code === 200 && tokenAdmin && res.body.colaborador.rol === 'Admin', 'login correcto devuelve token y rol');
  ok(llamadas[0].url.includes('LOWER({Usuario}) = "diana"') && llamadas[0].url.includes('{Activo}'), 'login busca usuario en minúsculas y solo activos');
  const tokenLider = (await login(LIDER)).body.token;
  const tokenAsist = (await login(ASIST)).body.token;
  const tokenEnc = (await login(ENCARG)).body.token;
  reset();
  res = resMock();
  await sesionApi({ method: 'POST', body: { usuario: 'diana', pin: '12"34' } }, res);
  ok(res.code === 400 && llamadas.length === 0, 'PIN con formato inválido: 400 sin tocar Airtable');

  // ---------- Pedido por formulario ----------
  reset();
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000001', fields: {} }] }, { records: [{}] }];
  res = resMock();
  await pedido({ method: 'POST', body: { nombre: 'Ana <b>', telefono: '667 123 4567', email: 'ana@x.com', negocio: 'Ambos', tipoEvento: 'XV', fecha: '2026-12-12', invitados: '80', ubicacion: 'Las Quintas', servicios: '10 mesas\n80 sillas' } }, res);
  const ev = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  ok(res.code === 200 && /^EVT-\d{6}$/.test(res.body.folio), 'formulario: 200 con folio');
  ok(ev.Autorizacion_Diana === 'Pendiente' && !ev.Negocio && ev.Notas.includes('Negocio solicitado: Ambos') && !('Monto_Estimado_IA' in ev), 'formulario: evento pendiente, sin estimado');
  ok(correos.length === 1 && correos[0].html.includes('Ana &lt;b&gt;'), 'formulario: correo al equipo con HTML escapado');
  reset();
  res = resMock();
  await pedido({ method: 'POST', body: { sitio_web: 'spam', nombre: 'Bot' } }, res);
  ok(res.code === 200 && llamadas.length === 0 && correos.length === 0, 'formulario: bot ignorado');

  // ---------- Chat con DiMa ----------
  const historial = [{ rol: 'cliente', texto: 'Hola, quiero cotizar unos XV' }];
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'text', text: '¡Qué emoción! Mira este paquete.' },
    { type: 'tool_use', name: 'mostrar_fotos', input: { ids: ['paquete-xv', 'paquetes-vasomaiz'] } },
  ] }];
  res = await chat({ historial });
  const p = llamadasClaude[0];
  ok(res.code === 200 && res.body.texto.includes('paquete') && res.body.fotos.includes('/referencias/paquete-xv-6000.jpg') && res.body.fotos.length === 4, 'chat: texto y fotos (XV + 3 de Vaso Maíz)');
  ok(p.model === 'claude-sonnet-5-5' && p.fallbacks === 'default' && p.betas.includes('server-side-fallback-2026-07-01') && p.tool_choice.type === 'auto' && p.output_config.effort === 'low', 'chat: modelo, respaldo y tool_choice auto');
  ok(p.tools.every(t => t.strict === true) && p.system.includes('CATÁLOGO REAL') && !p.system.includes('4830'), 'chat: tools estrictos, catálogo sin datos de tarjeta');
  ok(p.messages.length === 1 && p.messages[0].role === 'user' && llamadas.length === 0, 'chat: solo texto en el historial, sin tocar Airtable');

  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 80, ubicacion: 'Las Quintas', servicios: 'Paquete XV\n8 mesas', monto_estimado: 6000 } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000002', fields: {} }] }, { records: [{}] }];
  res = await chat({ historial: [...historial, { rol: 'dima', texto: '¿Me das tu nombre?' }, { rol: 'cliente', texto: 'Ana, 6671234567' }] });
  const evChat = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  ok(res.code === 200 && /^EVT-\d{6}$/.test(res.body.folio) && res.body.texto.includes(res.body.folio), 'chat: registrar_pedido crea el pedido y devuelve folio');
  ok(evChat.Monto_Estimado_IA === 6000 && evChat.Negocio === 'Divanna Eventos' && evChat.Notas.includes('Conversación con DiMa') && evChat.Notas.includes('Cliente: Ana, 6671234567'), 'chat: guarda estimado y la conversación en Notas');

  // ---------- Agenda: hora y productos estructurados ----------
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Rosa', telefono: '6679990001', email: null, negocio: 'Ambos', tipo_evento: 'Cumpleaños', fecha: '2026-11-21', hora_inicio: '18:00', horas_servicio: 2, invitados: 100, ubicacion: 'Las Quintas', servicios: 'Paquete 5\n2 paquetes 50 Antonella', productos: [{ clave: 'vm_paquete_5', cantidad: 1, nota: null }, { clave: 'dv_paq50_antonella', cantidad: 2, nota: 'manteles rosa' }, { clave: 'inventada', cantidad: 3, nota: null }], monto_estimado: 14200, fuera_de_ciudad: false, indicaciones: null, preferencia_contacto: 'no_preguntado' } },
  ] }];
  // Cliente, cliente nuevo, evento creado; luego eventos cercanos, inventario y personal del semáforo.
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000003', fields: {} }] }, { records: [{ id: 'recEVTNUEVO000001' }] },
    { records: [] }, { records: [{ id: 'recINVTIFF0000001', fields: { Item: 'Silla Antonella grande', Categoria: 'Silla Antonella', Cantidad_Total: 113 } }] }, { records: [] }];
  res = await chat({ historial });
  const patchSemaforo = llamadas.find(l => l.method === 'PATCH' && l.body.records[0].id === 'recEVTNUEVO000001');
  ok(patchSemaforo && patchSemaforo.body.records[0].fields.Disponibilidad === '🟡 Amarillo' && patchSemaforo.body.records[0].fields.Disponibilidad_Detalle.includes('Sin conteo en INVENTARIO'), 'semáforo: al registrar se guarda en el evento (aquí amarillo: faltan conteos)');
  ok(correos.some(c => c.text.includes('🟡 Amarillo') && c.text.includes('Confirmar al cliente antes de')), 'semáforo: el aviso a Diana trae el semáforo y el plazo de 12 h');
  ok(res.body.texto.includes('Ya tenemos todos los datos') && res.body.texto.includes('no mayor a 12 horas') && !res.body.texto.includes('Amarillo'), 'DiMa: al cliente le dice que ya están los datos y que se le confirma en 12 h, sin semáforo');
  const evAgenda =llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  const esquema = llamadasClaude[0].tools.find(t => t.name === 'registrar_pedido').input_schema;
  ok(esquema.required.includes('hora_inicio') && esquema.required.includes('productos') && esquema.properties.productos.items.properties.clave.enum.includes('dv_paq50_antonella'), 'agenda: DiMa debe mandar hora y productos con claves del catálogo');
  ok(llamadasClaude[0].system.includes('a qué hora empieza'), 'agenda: DiMa pregunta la hora del evento');
  ok(evAgenda.Hora_Inicio === '18:00' && evAgenda.Horas_Servicio === 2 && JSON.parse(evAgenda.Productos).length === 2, 'agenda: guarda hora y productos (descarta claves desconocidas)');
  ok(evAgenda.Piezas_Vaso_Maiz === 120 && evAgenda.Personal_Requerido === 4 && evAgenda.Resumen_Capacidad.includes('10 Mesa') && evAgenda.Resumen_Capacidad.includes('100 Silla Antonella'), 'agenda: 120 piezas en 2 h = 4 personas; 2 paquetes de 50 = 10 mesas y 100 sillas');
  ok(correos.some(c => c.text.includes('a las 18:00') && c.text.includes('3 a 4 personas')), 'agenda: el correo a Diana trae la hora y el personal');

  // ---------- Capacidad (api/_productos.js) ----------
  const prod = require(path.join(repo, 'api/_productos.js'));
  ok(prod.personalVasoMaiz(120, 2).personas === 4 && prod.personalVasoMaiz(120, 2).personasMin === 3 && prod.personalVasoMaiz(120, 3).personas === 3, 'capacidad: 120 piezas = 3 a 4 personas en 2 h, 3 en 3 h');
  ok(prod.personalVasoMaiz(55, 2).personas === 2 && prod.personalVasoMaiz(0, 2) === null, 'capacidad: nunca menos de un equipo de 2; sin piezas no aplica');
  const unEquipo = prod.personalVasoMaiz(120, 2).horasUnEquipo;
  ok(unEquipo.min === 3 && unEquipo.max === 4, 'capacidad: un equipo de 2 tarda de 3 a 4 h con 120 piezas');
  ok(JSON.stringify(prod.normalizarProductos([{ clave: 'dv_silla_tiffany', cantidad: 10 }, { clave: 'dv_silla_tiffany', cantidad: 5 }, { clave: 'x', cantidad: 1 }, { clave: 'dv_aro', cantidad: -1 }])) === '[{"clave":"dv_silla_tiffany","cantidad":15}]', 'productos: junta repetidos y descarta claves o cantidades inválidas');
  const iso = (v) => [new Date(v.desde).toISOString(), new Date(v.hasta).toISOString()].join(' ');
  ok(iso(prod.ventanaOcupacion({ fecha: '2026-11-14', horaInicio: '18:00' }, 'Silla Tiffany')) === '2026-11-14T07:00:00.000Z 2026-11-15T20:00:00.000Z', 'ocupación: mobiliario todo el día del evento (ruta de logística) hasta la 1 pm del día siguiente');
  ok(iso(prod.ventanaOcupacion({ fecha: '2026-11-14', horaInicio: '18:00' }, 'Mantel')).endsWith('2026-11-17T20:00:00.000Z'), 'ocupación: manteles 48 h de lavado después de regresar a bodega');
  ok(iso(prod.ventanaPersonalVasoMaiz({ fecha: '2026-11-14', horaInicio: '18:00', horasServicio: 2 })) === '2026-11-15T00:30:00.000Z 2026-11-15T03:00:00.000Z', 'ocupación: el equipo de El Vaso Maíz sale 30 min antes y termina con el servicio');
  const inv = [
    { id: 'recINVCOPA0000001', nombre: 'Copa Globo - Roja', categoria: 'Copa globo', total: 109 },
    { id: 'recINVCOPA0000002', nombre: 'Copa Francesa - Dorada', categoria: 'Copa francesa', total: 56 },
    { id: 'recINVMANT0000001', nombre: 'Mantel - Rojo', categoria: 'Mantel', total: 20 },
    { id: 'recINVMANT0000002', nombre: 'Mantel - Negro', categoria: 'Mantel', total: 27 },
    { id: 'recINVSILL0000001', nombre: 'Silla Antonella grande', categoria: 'Silla Antonella', total: 113 },
    { id: 'recINVSILL0000002', nombre: 'Silla Antonella chica', categoria: 'Silla Antonella', total: 78 },
  ];
  const arts = prod.normalizarArticulos([{ id: 'recINVCOPA0000001', cantidad: 50 }, { id: 'recINVCOPA0000001', cantidad: 10 }, { id: 'recFALSO000000001', cantidad: 5 }, { id: 'recINVMANT0000001', cantidad: 10 }], inv);
  ok(arts.length === 2 && arts[0].cantidad === 60 && arts[0].nombre === 'Copa Globo - Roja', 'artículos: solo de INVENTARIO, con nombre exacto, repetidos se juntan');
  const req2 = prod.inventarioRequerido([{ clave: 'dv_paq50_antonella', cantidad: 2 }]);
  ok(prod.textoPorAsignar(prod.coberturaArticulos(req2, [], inv)) === '10 Mantel, 100 Copa', 'cobertura: el paquete pide modelo y color de copas y manteles; Antonella grande/chica no');
  ok(prod.textoPorAsignar(prod.coberturaArticulos(req2, arts, inv)) === '100 Copa (60 asignadas)', 'cobertura: manteles cubiertos y copas a medias');
  ok(iso(prod.ventanaOcupacion({ fecha: '2026-11-14', horaInicio: '18:00' }, 'Casa Isabella')) === '2026-11-15T00:00:00.000Z 2026-11-15T07:00:00.000Z', 'ocupación: Casa Isabella solo las horas del evento');
  ok(prod.capacidadEvento([{ clave: 'dv_paq50_tiffany_jardin', cantidad: 1 }]).resumen.includes('Falta indicar la silla'), 'capacidad: avisa si el paquete deja la silla a elección y no se indicó');
  ok(prod.CLAVES.every(c => Object.keys(prod.PRODUCTOS[c].componentes || {}).every(cat => prod.CATEGORIAS[cat])), 'catálogo: todos los componentes usan categorías conocidas');

  // ---------- Semáforo de agenda (api/_agenda.js) ----------
  const agendaMod = require(path.join(repo, 'api/_agenda.js'));
  const ahoraPrueba = Date.parse('2026-11-01T12:00:00-07:00');
  const evA = (o) => ({ id: 'recX', folio: 'EVT-X', negocio: '', fecha: '2026-11-14', horaInicio: '18:00', horasServicio: 2, productos: [], articulos: [], personal: 0, autorizacion: 'Pendiente', ...o });
  const semaforo = (ev, otros = [], extra = {}) => agendaMod.evaluarDisponibilidad(ev, { otros, inventario: inv.concat([
    { id: 'recINVTIFF0000001', nombre: 'Silla Tiffany de fierro', categoria: 'Silla Tiffany', total: 90 },
    { id: 'recINVTIFF0000002', nombre: 'Silla Tiffany de plástico', categoria: 'Silla Tiffany', total: 80 },
    { id: 'recINVCASA0000001', nombre: 'Casa Isabella (salón)', categoria: 'Casa Isabella', total: 1 },
  ]), ahora: ahoraPrueba, ...extra });
  const vm120 = [{ clave: 'vm_paquete_5', cantidad: 1 }];
  let s1 = semaforo(evA({ productos: vm120 }));
  ok(s1.nivel === 'verde' && !s1.motivos.length, 'semáforo: Vaso Maíz 120 piezas sin otros eventos = verde');
  s1 = semaforo(evA({ productos: vm120 }), [evA({ id: 'recA1', folio: 'EVT-A1', autorizacion: 'SI', horaInicio: '17:00', personal: 6 }), evA({ id: 'recA2', folio: 'EVT-A2', autorizacion: 'SI', horaInicio: '19:00', personal: 4 })]);
  ok(s1.nivel === 'amarillo' && s1.motivos[0].texto.includes('quedan 2 libres') && s1.motivos[0].texto.includes('EVT-A1'), 'semáforo: con 10 de 12 personas ocupadas en ese horario = amarillo, dice con quién');
  s1 = semaforo(evA({ productos: vm120 }), [evA({ id: 'recA1', autorizacion: 'SI', horaInicio: '17:00', personal: 6 }), evA({ id: 'recA2', autorizacion: 'SI', horaInicio: '19:00', personal: 4 })], { personalPorFecha: { '2026-11-14': 11 } });
  ok(s1.nivel === 'rojo', 'semáforo: si PERSONAL_DIA baja el cupo y no queda ni un equipo = rojo');
  s1 = semaforo(evA({ productos: vm120 }), [evA({ id: 'recA1', autorizacion: 'SI', horaInicio: '10:00', personal: 10 })]);
  ok(s1.nivel === 'verde', 'semáforo: un evento en la mañana no ocupa el personal de la tarde');
  s1 = semaforo(evA({ productos: vm120 }), [evA({ id: 'recP1', folio: 'EVT-P1', autorizacion: 'Pendiente', horaInicio: '18:00', personal: 10 })]);
  ok(s1.nivel === 'verde' && s1.motivos.some(m => m.nivel === 'info' && m.texto.includes('EVT-P1')), 'semáforo: los pendientes no apartan, solo avisan que compiten');

  const tiff = (n) => [{ clave: 'dv_silla_tiffany', cantidad: n }];
  s1 = semaforo(evA({ productos: tiff(50) }), [evA({ id: 'recA3', folio: 'EVT-A3', autorizacion: 'SI', fecha: '2026-11-13', productos: tiff(150) })]);
  ok(s1.nivel === 'amarillo' && s1.motivos[0].texto.includes('faltan 30') && s1.motivos[0].texto.includes('proveedor'), 'semáforo: sillas del día anterior aún no regresan (1 pm): faltan 30, pedir a proveedor');
  s1 = semaforo(evA({ productos: tiff(50) }), [evA({ id: 'recA3', autorizacion: 'SI', fecha: '2026-11-13', productos: tiff(150) })], { ahora: Date.parse('2026-11-13T20:00:00-07:00') });
  ok(s1.nivel === 'rojo' && s1.motivos[0].texto.includes('menos de 48 h'), 'semáforo: si faltan menos de 48 h ya no da tiempo con proveedor = rojo');
  s1 = semaforo(evA({ productos: tiff(50) }), [evA({ id: 'recA3', autorizacion: 'SI', fecha: '2026-11-12', productos: tiff(150) })]);
  ok(s1.nivel === 'verde', 'semáforo: sillas de hace dos días ya regresaron');
  const manteles = [{ clave: 'dv_mantel', cantidad: 30 }];
  s1 = semaforo(evA({ productos: manteles }), [evA({ id: 'recA4', autorizacion: 'SI', fecha: '2026-11-12', productos: manteles })]);
  ok(s1.nivel === 'amarillo' && s1.motivos[0].texto.startsWith('Mantel'), 'semáforo: manteles de hace dos días siguen en lavado (48 h)');
  const casa = [{ clave: 'dv_casa_isabella', cantidad: 1 }];
  s1 = semaforo(evA({ productos: casa }), [evA({ id: 'recA5', folio: 'EVT-A5', autorizacion: 'SI', horaInicio: '16:00', productos: casa })]);
  ok(s1.nivel === 'rojo' && s1.motivos[0].texto.includes('Casa Isabella ya está apartada'), 'semáforo: Casa Isabella apartada en ese horario = rojo');
  ok(semaforo(evA({ productos: casa }), [evA({ id: 'recA5', autorizacion: 'SI', horaInicio: '09:00', productos: casa })]).nivel === 'verde', 'semáforo: Casa Isabella en la mañana y en la noche no chocan');
  const rojas = (n) => [{ id: 'recINVCOPA0000001', nombre: 'Copa Globo - Roja', categoria: 'Copa globo', cantidad: n }];
  s1 = semaforo(evA({ productos: [{ clave: 'dv_copa_globo', cantidad: 50 }], articulos: rojas(50) }), [evA({ id: 'recA6', folio: 'EVT-A6', autorizacion: 'SI', productos: [{ clave: 'dv_copa_globo', cantidad: 80 }], articulos: rojas(80) })]);
  ok(s1.nivel === 'amarillo' && s1.motivos.some(m => m.texto.startsWith('Copa Globo - Roja') && m.texto.includes('faltan 21')), 'semáforo: revisa el modelo y color exactos (Copa Globo - Roja: faltan 21)');
  s1 = semaforo(evA({ productos: [{ clave: 'dv_aro', cantidad: 1 }] }));
  ok(s1.nivel === 'amarillo' && s1.motivos[0].texto.includes('Sin conteo en INVENTARIO: Aro'), 'semáforo: lo que no tiene conteo en INVENTARIO pide revisión a mano');
  ok(semaforo(evA({})).nivel === 'amarillo', 'semáforo: sin productos no hay verde');

  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete XV\n9 mesas', monto_estimado: 6400 } },
  ] }];
  const firmar = (f) => require('crypto').createHmac('sha256', process.env.SESSION_SECRET).update(`folio:${f}`).digest('base64url').slice(0, 32);
  // Pedido todavía sin cotizar, para dentro de varios días. (Telegram se configura
  // solo para estos casos; las pruebas de abajo lo esperan sin configurar.)
  process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba';
  const enDiasCambio = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const SUB_ADMIN = { id: 'recSUB00000000009', fields: { Endpoint: 'https://push.example/admin', Colaborador: [ADMIN.id], Claves: '{"p256dh":"a","auth":"b"}' } };
  const ADMIN_TG = { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } };
  const EV_CAMBIO = { id: 'recEVENTOCAMBIO01', fields: { Folio_Evento: 'EVT-123456', Fecha_Evento: enDiasCambio(10), Hora_Inicio: '18:00', Negocio: 'Divanna Eventos', Autorizacion_Diana: 'Pendiente', Servicios_Solicitados: 'Paquete viejo', Notas: 'notas' } };
  respuestas = [{ records: [] }, { records: [EV_CAMBIO] }, {}, { records: [ADMIN_TG] }, { records: [ADMIN_TG] }, { records: [ADMIN] }, { records: [SUB_ADMIN] }];
  res = await chat({ historial, folio: 'EVT-123456', folioFirma: firmar('EVT-123456') });
  const patchCambioCli = llamadas.find(l => l.method === "PATCH");
  const cambioGuardado = patchCambioCli && JSON.parse(patchCambioCli.body.records[0].fields.Cambio_Cliente);
  ok(res.body.folio === 'EVT-123456' && !llamadas.some(l => l.method === 'POST') && correos.length === 1 && correos[0].subject.includes('Cambio en el pedido EVT-123456'), 'chat: cambios después de registrar no duplican el evento');
  ok(patchCambioCli && patchCambioCli.body.records[0].fields.Servicios_Solicitados === 'Paquete XV\n9 mesas' && cambioGuardado.estado === 'aplicado' && cambioGuardado.antes === 'Paquete viejo' && !cambioGuardado.urgente,
    'cambio: en un pedido sin cotizar se actualizan los servicios (antes se quedaban los viejos) y queda a la vista');
  ok(pushes.length === 1 && pushes[0].payload.titulo.includes('Cambio en el pedido EVT-123456') && pushes[0].payload.url === '/brigadas/dashboard.html'
    && telegram.some(t => t.body.chat_id === '111' && t.body.text.includes('Así lo quiere ahora')),
    'cambio: a Diana y Víctor les suena la app (push) y les llega Telegram');
  ok(res.body.texto.includes('al menos 24 horas de anticipación') && !res.body.texto.includes('no podemos garantizarlo'), 'cambio: DiMa le recuerda al cliente que los cambios se piden con 24 h de anticipación');

  // Pedido ya autorizado de El Vaso Maíz a menos de 24 h: queda pendiente y urgente; avisa también a la gerente.
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete 5', monto_estimado: 3400 } },
  ] }];
  const GER_CAMBIO = { id: 'recCOLABGERENTE01', fields: { Nombre: 'Ángela', Rol: 'Lider de brigada', Activo: true, Gerente_Vaso_Maiz: true, Telegram_Chat_ID: '444' } };
  const EV_URGENTE = { id: 'recEVENTOCAMBIO02', fields: { ...EV_CAMBIO.fields, Fecha_Evento: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date(Date.now() + 3 * 3600000)),
    Hora_Inicio: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mazatlan', hour: '2-digit', minute: '2-digit' }).format(new Date(Date.now() + 3 * 3600000)),
    Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI', Servicios_Solicitados: 'Paquete 3' } };
  // Después del PATCH: gerencia, Telegram (Admin y gerente), push activos (Admin y gerente), suscripciones (Admin y gerente).
  respuestas = [{ records: [] }, { records: [EV_URGENTE] }, {}, { records: [ADMIN_TG, GER_CAMBIO] }, { records: [ADMIN_TG, GER_CAMBIO] }, { records: [ADMIN_TG, GER_CAMBIO] }, { records: [ADMIN, GER_CAMBIO] }, { records: [ADMIN, GER_CAMBIO] }, { records: [] }, { records: [] }];
  res = await chat({ historial, folio: 'EVT-123456', folioFirma: firmar('EVT-123456') });
  const patchUrg = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const cambioUrg = JSON.parse(patchUrg.Cambio_Cliente);
  const aGerente = telegram.find(t => t.body.chat_id === '444');
  ok(cambioUrg.estado === 'pendiente' && cambioUrg.urgente && !('Servicios_Solicitados' in patchUrg) && !('Productos' in patchUrg),
    'cambio: en un pedido autorizado no se toca nada hasta que Diana lo confirme; con menos de 24 h va urgente');
  ok(aGerente && aGerente.body.text.startsWith('⚠️ URGENTE') && !aGerente.body.text.includes('$') && telegram.some(t => t.body.chat_id === '111' && t.body.text.includes('$3,400')),
    'cambio: a la gerente le llega (sin montos) junto con Diana y Víctor');
  ok(res.body.texto.includes('menos de 24 horas') && res.body.texto.includes('no podemos garantizarlo') && res.body.texto.includes('urgente'),
    'cambio: con menos de 24 h DiMa le dice al cliente que no se puede garantizar y que va como urgente');

  // Si no se puede guardar, DiMa no dice "listo".
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete XV', monto_estimado: null } },
  ] }];
  respuestas = [{ records: [] }, { records: [] }, { records: [ADMIN_TG] }];
  res = await chat({ historial, folio: 'EVT-123456', folioFirma: firmar('EVT-123456') });
  ok(res.body.texto.includes('no pude guardar tu cambio') && !res.body.texto.startsWith('Listo') && telegram.some(t => t.body.chat_id === '111' && t.body.text.includes('NO se pudo guardar') && t.body.text.includes('Paquete XV')),
    'cambio: si no se pudo guardar, DiMa lo dice y la gerencia recibe lo que pidió');
  delete process.env.TELEGRAM_BOT_TOKEN;

  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '123', email: null, negocio: 'Ambos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: null, ubicacion: '', servicios: 'x', monto_estimado: null } },
  ] }];
  res = await chat({ historial });
  ok(res.code === 200 && !res.body.folio && res.body.texto.includes('teléfono') && llamadas.length === 0, 'chat: teléfono inválido no registra y pide el dato');

  reset();
  respuestasClaude = [{ stop_reason: 'refusal', content: [] }];
  res = await chat({ historial });
  ok(res.code === 200 && res.body.texto.includes('no te puedo ayudar'), 'chat: rechazo de seguridad da respuesta amable');

  reset();
  res = await chat({ historial: [{ rol: 'dima', texto: 'hola' }] });
  ok(res.code === 400 && llamadasClaude.length === 0, 'chat: historial que no empieza por el cliente se rechaza');
  const conversacion = (n) => Array.from({ length: n * 2 - 1 }, (_, i) => ({ rol: i % 2 ? 'dima' : 'cliente', texto: 'x' }));
  res = await chat({ historial: conversacion(21) });
  ok(res.code === 200 && res.body.limite === true && res.body.texto.includes('no quiero quitarte más tiempo') && llamadasClaude.length === 0, 'chat: pasado el límite, despedida amable sin llamar a Claude');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hagamos un repaso.' }] }];
  res = await chat({ historial: conversacion(15) });
  const ultimo = llamadasClaude[0].messages[llamadasClaude[0].messages.length - 1];
  ok(res.code === 200 && !res.body.limite && ultimo.role === 'system' && ultimo.content.includes('cerrando'), 'chat: desde el mensaje 14 DiMa recibe la instrucción de ir cerrando');
  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola' }] }];
  res = await chat({ historial: conversacion(5) });
  ok(llamadasClaude[0].messages.every(m => m.role !== 'system'), 'chat: conversación corta sin instrucción de cierre');
  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Último' }] }];
  res = await chat({ historial: conversacion(20) });
  ok(res.body.limite === true, 'chat: el mensaje 20 marca la conversación como terminada');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'b' }] }];
  const mismaIp = { 'x-forwarded-for': '192.168.1.1' };
  const r1 = resMock(); await chatApi({ method: 'POST', body: { historial }, headers: mismaIp }, r1);
  const r2 = resMock(); await chatApi({ method: 'POST', body: { historial }, headers: mismaIp }, r2);
  ok(r1.code === 200 && r2.code === 429 && llamadasClaude.length === 1, 'chat: dos mensajes seguidos de la misma IP, el segundo espera (429)');

  // ---------- Dashboard (solo Admin) ----------
  reset();
  res = resMock();
  await dash({ method: 'GET', query: {}, headers: {} }, res);
  ok(res.code === 401, 'dashboard sin token: 401');
  reset();
  respuestas = [LIDER];
  res = resMock();
  await dash({ method: 'GET', query: {}, headers: auth(tokenLider) }, res);
  ok(res.code === 403, 'dashboard con rol Líder: 403');
  reset();
  respuestas = [{ ...ADMIN, fields: { ...ADMIN.fields, Activo: false } }];
  res = resMock();
  await dash({ method: 'GET', query: {}, headers: auth(tokenAdmin) }, res);
  ok(res.code === 401, 'admin desactivado en Airtable: 401 aunque el token sea válido');
  reset();
  res = resMock();
  await dash({ method: 'GET', query: {}, headers: auth(tokenAdmin.slice(0, -2) + 'xx') }, res);
  ok(res.code === 401 && llamadas.length === 0, 'token alterado: 401');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-12-12', Cliente: ['recCLIENTE0000001'], Servicios_Solicitados: 'a\nb' } }, {}, { fields: { Nombre: 'Ana', Email: 'ana@x.com' } }, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-12-12', Hora_Inicio: '18:00', Horas_Servicio: 2, Ubicacion: 'Las Quintas', Autorizacion_Diana: 'SI', Monto_Estimado_IA: 4500, Servicios_Solicitados: '10 mesas' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'autorizar', monto: '4500', items: '10 mesas\n\n80 sillas ' } }, res);
  const patch = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && res.body.googleOk && patch.Autorizacion_Diana === 'SI' && patch.Monto_Estimado_IA === 4500 && patch.Checklist_Items === '10 mesas\n80 sillas', 'admin autoriza: SI, monto y checklist');
  ok(correos.length === 1 && correos[0].to === 'ana@x.com', 'admin autoriza: correo de cotización al cliente');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-12-12', Servicios_Solicitados: 'Paquete 3' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'autorizar', monto: '3000', items: 'Paquete 3', horaInicio: '17:30', horasServicio: '3', productos: [{ clave: 'vm_paquete_3', cantidad: 1, nota: null }] } }, res);
  const patchAgenda = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchAgenda.Hora_Inicio === '17:30' && patchAgenda.Horas_Servicio === 3 && patchAgenda.Piezas_Vaso_Maiz === 90 && patchAgenda.Personal_Requerido === 2, 'admin autoriza con hora y productos: 90 piezas en 3 h = 2 personas');
  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'agenda', horaInicio: '', productos: [] } }, res);
  const patchBorra = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchBorra.Hora_Inicio === '' && patchBorra.Productos === '' && patchBorra.Personal_Requerido === 0, 'admin: guardar agenda vacía borra hora y productos');
  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } },
    { records: [{ id: 'recINVCOPA0000001', fields: { Item: 'Copa Globo - Roja', Categoria: 'Copa globo', Cantidad_Total: 109 } }] }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'agenda', articulos: [{ id: 'recINVCOPA0000001', cantidad: 50 }, { id: 'recINVENTADO00001', cantidad: 9 }] } }, res);
  const patchArt = JSON.parse(llamadas.find(l => l.method === 'PATCH').body.records[0].fields.Articulos);
  ok(res.code === 200 && patchArt.length === 1 && patchArt[0].nombre === 'Copa Globo - Roja' && patchArt[0].cantidad === 50 && llamadas.some(l => l.url.includes('tblG7pqvkyGTzBxx0')), 'admin: asigna modelo y color exactos desde INVENTARIO (ignora artículos que no existen)');

  reset();
  respuestas = [
    ADMIN,
    { records: [] },
    { records: [{ id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Autorizacion_Diana: 'Pendiente', Cliente: ['recCLIENTE0000001'], Monto_Estimado_IA: 6000 } }] },
    { records: [{ id: 'recCLIENTE0000001', fields: { Nombre: 'Ana' } }] },
    { records: [] },
  ];
  res = resMock();
  await dash({ method: 'GET', query: {}, headers: auth(tokenAdmin) }, res);
  ok(res.code === 200 && res.body.pedidos[0].montoEstimado === 6000 && res.body.pedidos[0].clienteNombre === 'Ana', 'dashboard GET: pedido con estimado de DiMa');

  // ---------- App de brigadas por rol ----------
  reset();
  respuestas = [LIDER, { id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Edén', EVENTOS: ['recEVENTO00000001'] } }, { records: [] }, { records: [{ id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } }] }];
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenLider) }, res);
  ok(res.code === 200 && res.body.brigada.nombre === 'Edén' && res.body.eventos.length === 1 && res.body.colaborador.rol === 'Lider de brigada', 'líder ve los eventos de su brigada');

  reset();
  respuestas = [ENCARG, { id: ENCARG.id, fields: { fld52PrtsNA4CnRw2: ['recEVENTO00000009'] } }, { records: [] }, { records: [{ id: 'recEVENTO00000009', fields: { Folio_Evento: 'EVT-9' } }] }];
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenEnc) }, res);
  ok(res.code === 200 && res.body.brigada === null && res.body.eventos[0].folio === 'EVT-9' && llamadas[1].url.includes('returnFieldsByFieldId=true'), 'encargada ve solo sus eventos asignados');

  // Vista equipo del Admin: ve la app como una brigada concreta y recibe las opciones.
  reset();
  respuestas = [
    ADMIN,
    { id: 'recBRIGADA0000002', fields: { Nombre_Brigada: 'Norte', EVENTOS: ['recEVENTO00000005'] } },
    { records: [] },
    { records: [{ id: 'recEVENTO00000005', fields: { Folio_Evento: 'EVT-5' } }] },
    { records: [{ id: 'recBRIGADA0000002', fields: { Nombre_Brigada: 'Norte' } }] },
    { records: [{ id: ENCARG.id, fields: { Nombre: 'Ana' } }] },
  ];
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenAdmin), query: { brigada: 'recBRIGADA0000002' } }, res);
  ok(res.code === 200 && res.body.brigada.nombre === 'Norte' && res.body.eventos[0].folio === 'EVT-5' && res.body.opciones.brigadas.length === 1 && res.body.opciones.encargadas[0].nombre === 'Ana', 'admin: vista equipo como una brigada, con opciones para elegir');
  reset();
  respuestas = [LIDER, { id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Edén', EVENTOS: [] } }, { records: [] }];
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenLider), query: { brigada: 'recBRIGADA0000002' } }, res);
  ok(res.code === 200 && res.body.brigada.nombre === 'Edén' && !res.body.opciones, 'líder no puede ver otra brigada con ?brigada=');

  const eventoBrigada = { fields: { Folio_Evento: 'EVT-1', Brigada_Asignada: ['recBRIGADA0000001'] } };
  reset();
  respuestas = [
    LIDER, eventoBrigada, {},
    { records: [ADMIN, LIDER, ASIST] },
    { records: [
      { id: 'recSUB00000000001', fields: { Endpoint: 'https://push.example/admin', Colaborador: [ADMIN.id], Claves: '{"p256dh":"a","auth":"b"}' } },
      { id: 'recSUB00000000002', fields: { Endpoint: 'https://push.example/lider', Colaborador: [LIDER.id], Claves: '{"p256dh":"a","auth":"b"}' } },
      { id: 'recSUB00000000003', fields: { Endpoint: 'https://push.example/vencida', Colaborador: [ASIST.id], Claves: '{"p256dh":"a","auth":"b"}' } },
      { id: 'recSUB00000000004', fields: { Endpoint: 'https://push.example/exempleado', Colaborador: ['recCOLAB000000099'], Claves: '{"p256dh":"a","auth":"b"}' } },
    ] },
    {},
  ];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'emergencia', valor: true, motivo: 'choque' } }, res);
  ok(res.code === 200 && correos.length === 1 && correos[0].text.includes('Reporta: Juan'), 'líder lanza emergencia: correo con su nombre');
  ok(pushes.length === 1 && pushes[0].endpoint.endsWith('/admin') && pushes[0].payload.titulo.includes('EMERGENCIA'), 'emergencia: push a activos, no a quien reporta ni a inactivos');
  ok(llamadas.some(l => l.method === 'DELETE' && l.url.includes('recSUB00000000003')), 'emergencia: borra la suscripción vencida');

  reset();
  respuestas = [LIDER, { fields: { Brigada_Asignada: ['recOTRABRIGADA001'] } }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000002', tipo: 'retraso', valor: true, motivo: 'x' } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'PATCH'), 'líder no puede tocar eventos de otra brigada');

  reset();
  respuestas = [ASIST];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenAsist), body: { eventoId: 'recEVENTO00000001', tipo: 'estatus_logistico', valor: 'En camino' } }, res);
  ok(res.code === 403, 'asistente no cambia el estatus logístico');
  reset();
  respuestas = [ASIST, eventoBrigada, {}];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenAsist), body: { eventoId: 'recEVENTO00000001', tipo: 'checklist_item', valor: '0', motivo: 'marcar' } }, res);
  ok(res.code === 200 && llamadas.some(l => l.method === 'PATCH'), 'asistente sí marca la carga');
  reset();
  respuestas = [ASIST];
  res = resMock();
  await checklist({ method: 'POST', headers: auth(tokenAsist), body: { eventoId: 'recEVENTO00000001', etapa: 'salida', valor: true } }, res);
  ok(res.code === 403, 'asistente no marca etapas del evento');

  reset();
  respuestas = [ENCARG, { fields: { Encargada: [ENCARG.id] } }, {}];
  res = resMock();
  await checklist({ method: 'POST', headers: auth(tokenEnc), body: { eventoId: 'recEVENTO00000009', etapa: 'montaje', valor: true } }, res);
  ok(res.code === 200, 'encargada marca etapas de su evento');
  reset();
  respuestas = [ENCARG, { fields: { Encargada: ['recOTRACOLAB00001'] } }];
  res = resMock();
  await checklist({ method: 'POST', headers: auth(tokenEnc), body: { eventoId: 'recEVENTO00000008', etapa: 'montaje', valor: true } }, res);
  ok(res.code === 403, 'encargada no toca eventos de otra encargada');

  // ---------- Pedido existente (folio + teléfono) y folio firmado ----------
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 80, ubicacion: 'Centro', servicios: 'Paquete XV\n10 mesas', monto_estimado: 6200, fuera_de_ciudad: false, indicaciones: null } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000010', fields: {} }] }, { records: [{}] }];
  res = await chat({ historial, folio: 'EVT-654321', folioFirma: 'firma-inventada-aaaaaaaaaaaaaaaa' });
  ok(llamadas.some(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')) && !correos.some(c => c.subject.includes('Cambio en el pedido EVT-654321')), 'chat: un folio sin firma válida no permite tocar ese pedido');

  reset();
  respuestas = [{ records: [] }];
  res = await chat({ historial, pedidoExistente: { folio: 'EVT-111111', telefono: '6670000000' } });
  ok(res.code === 400 && llamadasClaude.length === 0, 'chat: folio y teléfono que no coinciden se rechazan');

  reset();
  respuestas = [
    { records: [{ id: 'recEVENTO00000007', fields: { Folio_Evento: 'EVT-777777', Cliente: ['recCLIENTE0000009'], Fecha_Evento: '2026-12-01', Servicios_Solicitados: 'Paquete 3', Autorizacion_Diana: 'SI' } }] },
    { id: 'recCLIENTE0000009', fields: { Nombre: 'Rosa', Telefono_WhatsApp: '+526679990000' } },
  ];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claro, ¿qué le agregamos?' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'quiero agregar sillas' }], pedidoExistente: { folio: 'evt-777777', telefono: '667 999 0000' } });
  const avisoPedido = llamadasClaude[0].messages[llamadasClaude[0].messages.length - 1];
  ok(res.code === 200 && res.body.folio === 'EVT-777777' && res.body.folioFirma === firmar('EVT-777777') && avisoPedido.role === 'system' && avisoPedido.content.includes('Paquete 3') && avisoPedido.content.includes('ya confirmó'), 'chat: pedido existente verificado, DiMa recibe su contenido y el folio queda firmado');

  reset();
  respuestas = [{ records: [] }, { records: [{ id: 'recEVENTO00000007', fields: { Folio_Evento: 'EVT-777777', Notas: 'previas', Instrucciones_Equipo: '' } }] }, {}];
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Rosa', telefono: '6679990000', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'Fiesta', fecha: '2026-12-01', invitados: 90, ubicacion: 'Centro', servicios: 'Paquete 3\n20 sillas', monto_estimado: 3000, fuera_de_ciudad: false, indicaciones: 'Tocar el timbre de la casa azul' } },
  ] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'agrega 20 sillas' }], folio: 'EVT-777777', folioFirma: firmar('EVT-777777') });
  const patchCambio = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(patchCambio.Notas.startsWith('previas') && patchCambio.Notas.includes('20 sillas') && patchCambio.Instrucciones_Equipo === 'Del cliente: Tocar el timbre de la casa azul' && !llamadas.some(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')), 'chat: el cambio se guarda en el evento existente, sin crear otro');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'Es una boda en San Pedro, Navolato' }] });
  const avisoForaneo = llamadasClaude[0].messages[llamadasClaude[0].messages.length - 1];
  ok(avisoForaneo.role === 'system' && avisoForaneo.content.includes('se validan'), 'chat: al mencionar San Pedro, DiMa recibe el recordatorio de explicar la validación');
  ok(llamadasClaude[0].system.includes('VENTA CRUZADA') && llamadasClaude[0].system.includes('mobiliario'), 'chat: DiMa tiene la regla de venta cruzada');

  // ---------- Preferencia de contacto y mensajes de Diana al cliente ----------
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Luz', telefono: '6672223344', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'Cumpleaños', fecha: '2026-11-20', invitados: 60, ubicacion: 'San Pedro, Navolato', servicios: 'Paquete 3', monto_estimado: 2700, fuera_de_ciudad: true, indicaciones: null, preferencia_contacto: 'llamada' } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000011', fields: {} }] }, { records: [{}] }];
  res = await chat({ historial });
  const evPref = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  ok(evPref.Preferencia_Contacto === 'Llamada' && correos[0].text.includes('Cómo quiere la respuesta: Llamada'), 'chat: la preferencia de contacto del cliente queda en el pedido y le llega a Diana');
  ok(llamadasClaude[0].system.includes('¿quieres esperar aquí la respuesta de la cotización') && llamadasClaude[0].tools.find(t => t.name === 'registrar_pedido').input_schema.required.includes('preferencia_contacto'), 'chat: DiMa pregunta en foráneos si espera en el chat o lo contactan');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'mensaje_cliente', mensaje: 'Sí llegamos, traslado $500' } }, res);
  const patchMsg = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchMsg.Mensaje_Para_Cliente === 'Sí llegamos, traslado $500' && patchMsg.Mensaje_Cliente_Entregado === false, 'dashboard: Diana deja un mensaje para el cliente');

  reset();
  respuestas = [{ records: [{ id: 'recEVENTO00000001', fields: { Mensaje_Para_Cliente: 'Sí llegamos, traslado $500' } }] }, {}];
  res = await chat({ accion: 'revisar', folio: 'EVT-123456', folioFirma: firmar('EVT-123456') });
  const marcado = llamadas.find(l => l.method === 'PATCH');
  ok(res.code === 200 && res.body.mensaje === 'Sí llegamos, traslado $500' && marcado.body.records[0].fields.Mensaje_Cliente_Entregado === true && llamadasClaude.length === 0, 'chat: el cliente que espera recibe el mensaje de Diana y se marca entregado (sin llamar a Claude)');
  reset();
  res = await chat({ accion: 'revisar', folio: 'EVT-123456', folioFirma: 'inventada' });
  ok(res.code === 400 && llamadas.length === 0, 'chat: revisar sin folio firmado se rechaza');

  reset();
  respuestas = [
    { records: [{ id: 'recEVENTO00000007', fields: { Folio_Evento: 'EVT-777777', Cliente: ['recCLIENTE0000009'], Fecha_Evento: '2026-12-01', Servicios_Solicitados: 'Paquete 3', Mensaje_Para_Cliente: 'El traslado a San Pedro son $500' } }] },
    { id: 'recCLIENTE0000009', fields: { Nombre: 'Rosa', Telefono_WhatsApp: '+526679990000' } },
    {},
  ];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Diana te manda decir que el traslado son $500.' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'hola, ¿ya hay respuesta?' }], pedidoExistente: { folio: 'EVT-777777', telefono: '6679990000' } });
  const ultimoAviso = llamadasClaude[0].messages[llamadasClaude[0].messages.length - 1];
  ok(ultimoAviso.content.includes('El traslado a San Pedro son $500') && llamadas.some(l => l.method === 'PATCH' && l.body.records[0].fields.Mensaje_Cliente_Entregado === true), 'chat: el cliente que regresa con su folio recibe el mensaje pendiente de Diana');

  // ---------- DiMa nunca menciona a Diana con el cliente ----------
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Eva', telefono: '6675556677', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'Fiesta', fecha: '2026-12-05', invitados: 40, ubicacion: 'Navolato', servicios: 'Paquete 1', monto_estimado: 1500, fuera_de_ciudad: true, indicaciones: null, preferencia_contacto: 'esperar_en_chat' } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000012', fields: {} }] }, { records: [{}] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'Es en Navolato' }] });
  const promptCompleto = llamadasClaude[0].system + JSON.stringify(llamadasClaude[0].messages) + JSON.stringify(llamadasClaude[0].tools);
  ok(!/Diana/.test(res.body.texto), 'chat: el texto que ve el cliente al registrar no menciona a Diana');
  ok((promptCompleto.match(/Diana/g) || []).length === 1 && promptCompleto.includes('nunca menciones a nadie del equipo por su nombre'), 'chat: lo único sobre Diana en el prompt es la regla de no nombrarla');
  res = await chat({ historial: Array.from({ length: 41 }, (_, i) => ({ rol: i % 2 ? 'dima' : 'cliente', texto: 'x' })) });
  ok(!/Diana/.test(res.body.texto), 'chat: la despedida por límite no menciona a Diana');

  // ---------- Cobertura e instrucciones ----------
  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Luz', telefono: '6672223344', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'Cumpleaños', fecha: '2026-11-20', invitados: 60, ubicacion: 'San Pedro, Navolato', servicios: 'Paquete 3', monto_estimado: 2700, fuera_de_ciudad: true, indicaciones: 'Montar a las 5 pm, casa con portón verde' } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000004', fields: {} }] }, { records: [{}] }];
  res = await chat({ historial });
  const evFuera = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  ok(evFuera.Fuera_De_Ciudad === true && evFuera.Instrucciones_Equipo === 'Del cliente: Montar a las 5 pm, casa con portón verde', 'chat: fuera de la ciudad e indicaciones del cliente quedan en el evento');
  ok(res.body.texto.includes('fuera de la ciudad') && correos[0].subject.includes('fuera de la ciudad') && correos[0].text.includes('FUERA DE LA CIUDAD'), 'chat: cliente y Diana reciben el aviso de cobertura');
  ok(llamadasClaude[0].system.includes('COBERTURA') && llamadasClaude[0].system.includes('San Pedro') && llamadasClaude[0].tools.find(t => t.name === 'registrar_pedido').input_schema.required.includes('fuera_de_ciudad'), 'chat: DiMa tiene las reglas de cobertura y el campo para marcarlo');

  reset();
  respuestas = [
    ADMIN,
    { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-11-20', Brigada_Asignada: ['recBRIGADA0000001'], Instrucciones_Equipo: '' } },
    {},
    { records: [LIDER, ASIST, ADMIN] },
    { records: [LIDER, ASIST, ADMIN] },
    { records: [
      { id: 'recSUB00000000010', fields: { Endpoint: 'https://push.example/lider', Colaborador: [LIDER.id], Claves: '{"p256dh":"a","auth":"b"}' } },
      { id: 'recSUB00000000011', fields: { Endpoint: 'https://push.example/admin', Colaborador: [ADMIN.id], Claves: '{"p256dh":"a","auth":"b"}' } },
    ] },
  ];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'instrucciones', instrucciones: 'Llevar extensión de 20 m' } }, res);
  const patchInstr = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchInstr.Instrucciones_Equipo === 'Llevar extensión de 20 m' && res.body.avisados === 2, 'dashboard: guarda instrucciones y avisa a los 2 de la brigada');
  ok(pushes.length === 1 && pushes[0].endpoint.endsWith('/lider') && pushes[0].payload.cuerpo.includes('extensión'), 'instrucciones: push solo al equipo asignado, no a Admin');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Instrucciones_Equipo: 'Igual' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'instrucciones', instrucciones: 'Igual' } }, res);
  ok(res.code === 200 && res.body.avisados === 0 && pushes.length === 0, 'instrucciones sin cambios: no se vuelve a avisar');

  reset();
  respuestas = [LIDER];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', accion: 'instrucciones', instrucciones: 'x' } }, res);
  ok(res.code === 403, 'instrucciones: solo Admin las puede escribir');

  // ---------- Asignar brigada y encargada ----------
  reset();
  const ENCARG2 = { id: 'recCOLAB000000005', fields: { Nombre: 'Rosa', Rol: 'Encargada de evento', Activo: false } };
  respuestas = [
    ADMIN,
    { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-11-20', Ubicacion: 'Las Quintas', Encargada: [ENCARG.id] } },
    { records: [LIDER, ASIST, ADMIN, ENCARG] },
    {},
    { records: [LIDER, ASIST, ADMIN, ENCARG] },
    { records: [{ id: 'recSUB00000000010', fields: { Endpoint: 'https://push.example/lider', Colaborador: [LIDER.id], Claves: '{"p256dh":"a","auth":"b"}' } }] },
  ];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: 'recBRIGADA0000001', encargadaIds: [ENCARG.id, ENCARG2.id, LIDER.id] } }, res);
  const patchAsig = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && JSON.stringify(patchAsig.Brigada_Asignada) === '["recBRIGADA0000001"]' && JSON.stringify(patchAsig.Encargada) === JSON.stringify([ENCARG.id]), 'asignar: guarda la brigada y solo encargadas activas con ese rol');
  ok(res.body.avisados === 2 && pushes.length === 1 && pushes[0].payload.titulo.includes('EVT-1'), 'asignar: avisa solo a los que se acaban de sumar (no a la encargada que ya estaba)');
  ok(res.body.porPush === 1 && res.body.porTelegram === 0 && res.body.conTelegram === 0 && res.body.sinTelegram.join() === 'Juan,Luis' && res.body.erroresAvisos[0].includes('sin configurar'), 'asignar: responde lo que de verdad se entregó y a quién le falta Telegram');
  ok(patchAsig.Enterado_Por === '' && patchAsig.Enterado_Hora === null, 'asignar: al cambiar el equipo se borra el Enterado anterior');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Brigada_Asignada: ['recBRIGADA0000001'] } }, { records: [LIDER, ASIST] }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: '', encargadaIds: [] } }, res);
  const patchQuitar = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchQuitar.Brigada_Asignada.length === 0 && patchQuitar.Encargada.length === 0 && res.body.avisados === 0, 'asignar: se puede dejar sin brigada, sin avisos');

  reset();
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: {} }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: 'x"); DROP', encargadaIds: [] } }, res);
  ok(res.code === 400 && !llamadas.some(l => l.method === 'PATCH'), 'asignar: rechaza una brigada inválida');

  reset();
  respuestas = [LIDER];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: '', encargadaIds: [] } }, res);
  ok(res.code === 403, 'asignar: solo Admin');

  // ---------- Suscripción push ----------
  reset();
  res = resMock();
  await pushApi({ method: 'GET', headers: {} }, res);
  ok(res.body.publicKey === 'publica', 'push GET: llave pública');
  reset();
  respuestas = [LIDER, { records: [] }, {}];
  res = resMock();
  await pushApi({ method: 'POST', headers: auth(tokenLider), body: { suscripcion: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123xyz', keys: { p256dh: 'p', auth: 'a' } } } }, res);
  const alta = llamadas.find(l => l.method === 'POST');
  ok(res.code === 200 && alta && alta.body.records[0].fields.Colaborador[0] === LIDER.id, 'push POST: guarda la suscripción del colaborador');
  reset();
  res = resMock();
  await pushApi({ method: 'POST', headers: {}, body: {} }, res);
  ok(res.code === 401, 'push POST sin sesión: 401');

  // ---------- Balance semanal ----------
  reset();
  // Reportes aprobados, gastos (uno a mano, uno de reporte aprobado con dinero propio, uno de reporte sin aprobar), cobros, eventos.
  respuestas = [
    { records: [{ id: 'recREPORTEAPROB01', fields: { Efectivo_Entregado: 1500 } }] },
    { records: [{ fields: { Monto: 500 } }, { fields: { Monto: 300, Reporte: ['recREPORTEAPROB01'], Pagado_Con: 'Dinero propio' } }, { fields: { Monto: 200, Reporte: ['recREPORTEPENDI01'] } }] },
    { records: [{ fields: { Monto: 1000, Forma: 'Efectivo', Reporte: ['recREPORTEAPROB01'] } }, { fields: { Monto: 999, Forma: 'Efectivo', Reporte: ['recREPORTEPENDI01'] } }] },
    { records: [{ fields: { Monto_Estimado_IA: 2000 } }] },
    {},
  ];
  res = resMock();
  await balance({ headers: {}, query: {} }, res);
  const bal = llamadas.find(l => l.method === 'POST').body.records[0].fields;
  ok(res.code === 200 && correos.length === 1 && bal.Detalle_Enviado === true, 'balance: correo enviado y registrado');
  ok(bal.Gastos_Totales === 800 && bal.Detalle_Completo.includes('Total cobrado: $1,000') && bal.Detalle_Completo.includes('efectivo entregado a Diana: $1,500')
    && bal.Detalle_Completo.includes('Reembolsos pendientes (gastos con dinero propio): $300') && bal.Detalle_Completo.includes('1 gasto ($200) en reportes sin aprobar'),
    'balance: solo cuentan los gastos y cobros de reportes aprobados (más los capturados a mano) y avisa lo pendiente');
  ok(bal.Por_Cobrar === 2000 && bal.Detalle_Completo.includes('Por cobrar a clientes (eventos de la semana): $2,000 en 1 evento'), 'balance: incluye lo por cobrar a clientes y lo guarda');

  // Por cobrar evento por evento.
  const { calcularPorCobrar } = require(path.join(repo, 'api/_finanzas.js'));
  const pc = calcularPorCobrar([
    { id: 'recPCEVENTO00001', fields: { Monto_Estimado_IA: 5000, Estatus_Pago: 'Liquidado 100%' } },
    { id: 'recPCEVENTO00002', fields: { Monto_Estimado_IA: 5000, Estatus_Pago: 'Pagado - Transferencia' } },
    { id: 'recPCEVENTO00003', fields: { Monto_Estimado_IA: 5000, Monto_Adeudado: 1200, Estatus_Pago: 'Pendiente - Efectivo' } },
    { id: 'recPCEVENTO00004', fields: { Monto_Estimado_IA: 3000 } },
    { id: 'recPCEVENTO00005', fields: { Monto_Estimado_IA: 2000, Cancelado: true } },
  ], [
    { fields: { Evento: ['recPCEVENTO00004'], Monto: 1000, Reporte: ['recREPAPROBADO01'] } },
    { fields: { Evento: ['recPCEVENTO00004'], Monto: 500, Reporte: ['recREPPENDIENTE1'] } },
  ], new Set(['recREPAPROBADO01']));
  ok(pc.total === 3200 && pc.eventos === 2, 'por cobrar: pagado y liquidado en 0, usa el monto adeudado si existe, resta solo cobros aprobados y no cuenta cancelados');

  // ---------- Bot de Telegram del equipo ----------
  process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto-webhook';
  delete process.env.VAPID_PUBLIC_KEY;
  const tgHeaders = { 'x-telegram-bot-api-secret-token': 'secreto-webhook' };
  const msg = (texto, chatId = 555, tipo = 'private') => ({ message: { message_id: 9, chat: { id: chatId, type: tipo }, text: texto } });
  const respuestaTg = () => telegram.filter(t => t.metodo === 'sendMessage').map(t => t.body.text).join('\n');

  reset();
  res = resMock();
  await telegramApi({ method: 'POST', headers: {}, body: msg('/hoy') }, res);
  ok(res.code === 401 && telegram.length === 0, 'telegram: sin el secreto del webhook, 401');

  reset();
  respuestas = [{ records: [LIDER] }, { records: [] }, {}];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/entrar Juan 123456') }, res);
  const vinculo = llamadas.find(l => l.method === 'PATCH');
  ok(res.code === 200 && telegram[0].metodo === 'deleteMessage' && vinculo && vinculo.body.records[0].fields.Telegram_Chat_ID === '555' && respuestaTg().includes('vinculado'), 'telegram: /entrar borra el mensaje con el PIN y vincula');

  reset();
  respuestas = [{ records: [] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/hoy') }, res);
  ok(respuestaTg().includes('/entrar') && !llamadas.some(l => l.url.includes('tblzLAin65BZPP2c6')), 'telegram: sin vincular no muestra eventos, explica /entrar');

  reset();
  respuestas = [{ records: [LIDER] }, { id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Edén', EVENTOS: ['recEVENTO00000001'] } }, { records: [{ id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-10-27', Ubicacion: 'Las Quintas', Emergencia: true, Motivo_Emergencia: 'llanta' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/hoy') }, res);
  ok(respuestaTg().includes('EVT-1') && respuestaTg().includes('llanta') && llamadas[2].url.includes('DATESTR({Fecha_Evento})'), 'telegram: /hoy del líder muestra sus eventos de hoy');

  reset();
  respuestas = [{ records: [LIDER] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/pedidos') }, res);
  ok(respuestaTg().includes('solo para Diana y Víctor') && llamadas.length === 1, 'telegram: /pedidos negado a quien no es Admin');

  reset();
  respuestas = [{ records: [ADMIN] }, { records: [{ fields: { Folio_Evento: 'EVT-7', Fecha_Evento: '2026-12-01', Servicios_Solicitados: 'Paquete XV', Monto_Estimado_IA: 6000 } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/pedidos') }, res);
  ok(respuestaTg().includes('EVT-7') && respuestaTg().includes('$6,000'), 'telegram: /pedidos del Admin lista los pendientes con estimado');

  reset();
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/entrar Juan 123456', -100, 'group') }, res);
  ok(telegram.some(t => t.metodo === 'deleteMessage') && respuestaTg().includes('privado') && llamadas.length === 0, 'telegram: en grupo no vincula y borra el PIN');

  reset();
  respuestas = [
    LIDER, eventoBrigada, {},
    { records: [
      { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } },
      { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } },
    ] },
  ];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'emergencia', valor: true, motivo: 'choque' } }, res);
  const avisos = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && avisos.length === 1 && avisos[0].body.chat_id === '111' && avisos[0].body.text.includes('EMERGENCIA'), 'telegram: emergencia llega al equipo menos a quien reporta');

  reset();
  // Después de crear el evento: eventos cercanos, inventario y personal (semáforo), luego colaboradores de Telegram.
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000003', fields: {} }] }, { records: [{}] }, { records: [] }, { records: [] }, { records: [] }, { records: [
    { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } },
    { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } },
  ] }];
  res = resMock();
  await pedido({ method: 'POST', body: { nombre: 'Rosa', telefono: '6679990000', negocio: 'El Vaso Maiz', fecha: '2026-12-20', servicios: 'Paquete 3' } }, res);
  const avisosPedido = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && avisosPedido.length === 1 && avisosPedido[0].body.chat_id === '111' && avisosPedido[0].body.text.includes('Pedido nuevo'), 'telegram: pedido nuevo solo a los Admin');

  // ---------- Staff de El Vaso Maíz por Telegram (/staff) ----------
  const ANGELA = { id: 'recCOLAB000000005', fields: { Nombre: 'Ángela', Rol: 'Encargada de evento', Activo: true, Coordina_Staff: true, Telegram_Chat_ID: '777' } };
  const ISA = { id: 'recCOLAB000000006', fields: { Nombre: 'Isabella', Rol: 'Staff', Activo: true, Coordinadora: [ANGELA.id], Telegram_Chat_ID: '888' } };
  const KAR = { id: 'recCOLAB000000007', fields: { Nombre: 'Karla', Rol: 'Staff', Activo: true, Coordinadora: [ANGELA.id], Telegram_Chat_ID: '999' } };
  const ZOE = { id: 'recCOLAB000000008', fields: { Nombre: 'Zoe', Rol: 'Staff', Activo: true, Coordinadora: ['recCOLABOTRA00001'], Telegram_Chat_ID: '444' } };
  const EVVM = { id: 'recEVTVASO0000001', fields: { Folio_Evento: 'EVT-500001', Fecha_Evento: '2026-11-21', Hora_Inicio: '18:00', Horas_Servicio: 2, Ubicacion: 'Las Quintas', Piezas_Vaso_Maiz: 120, Personal_Requerido: 2, Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI', Monto_Estimado_IA: 3400 } };
  const boton = (dato, chatId) => ({ callback_query: { id: 'cb1', data: dato, message: { message_id: 50, chat: { id: chatId, type: 'private' }, text: 'Invitación original' } } });
  const enviados = (metodo) => telegram.filter(t => t.metodo === metodo);

  reset();
  respuestas = [{ records: [ISA] }];
  res = resMock();
  await sesionApi({ method: 'POST', body: { usuario: 'isabella', pin: '123456' } }, res);
  ok(res.code === 403 && res.body.error.includes('Telegram') && !res.body.token, 'staff: no entra a la app, se le indica usar Telegram');

  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/staff', 777) }, res);
  const menu0 = enviados('sendMessage')[0];
  ok(menu0 && menu0.body.reply_markup.inline_keyboard[0].map(b => b.text + '|' + b.callback_data).join(',') === '➕ Agregar personal|st:a,📋 Asignar a evento|st:l', 'staff: /staff abre el menú con Agregar personal y Asignar a evento');

  reset();
  respuestas = [{ records: [ANGELA] }, { records: [EVVM] }, { records: [] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('st:l', 777) }, res);
  const menu1 = enviados('editMessageText')[0];
  ok(menu1 && menu1.body.reply_markup.inline_keyboard[0][0].callback_data === 'st:e:recEVTVASO0000001:0' && menu1.body.reply_markup.inline_keyboard[0][0].text.includes('EVT-500001'), 'staff: Asignar muestra los eventos de El Vaso Maíz como botones');

  // Agregar personal: nombre y teléfono, sin usuario ni PIN.
  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('st:a', 777) }, res);
  const pide = enviados('sendMessage')[0];
  ok(pide && pide.body.text.startsWith('➕ Nuevo personal') && pide.body.reply_markup.force_reply === true, 'staff: Agregar pide nombre y teléfono con respuesta directa');

  const respuestaAlta = (texto) => ({ message: { message_id: 10, chat: { id: 777, type: 'private' }, text: texto, reply_to_message: { from: { is_bot: true }, text: pide.body.text } } });
  reset();
  respuestas = [{ records: [ANGELA] }, { records: [ISA] }, { records: [{ id: 'recCOLABNUEVA0001' }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: respuestaAlta('Sofía Ramírez 667 555 1234') }, res);
  const altaStaff = llamadas.find(l => l.method === 'POST' && l.url.includes('tblHdz4vqUIlIdkwc'));
  const campoAlta = altaStaff && altaStaff.body.records[0].fields;
  ok(campoAlta && campoAlta.Nombre === 'Sofía Ramírez' && campoAlta.Celular === '+526675551234' && campoAlta.Rol === 'Staff' && campoAlta.Coordinadora[0] === ANGELA.id && campoAlta.Activo && !campoAlta.PIN && !campoAlta.Usuario, 'staff: Agregar da de alta con nombre y teléfono, Rol Staff y Coordinadora Ángela, sin usuario ni PIN');
  const enlaceSofia = (respuestaTg().match(/https:\/\/t\.me\/dimaclnbot\?start=(s_recCOLABNUEVA0001_[A-Za-z0-9_-]{12})/) || [])[1];
  ok(!!enlaceSofia, 'staff: Ángela recibe el enlace personal para mandárselo');

  reset();
  respuestas = [{ records: [ANGELA] }, { records: [{ ...ISA, fields: { ...ISA.fields, Celular: '+526671112233', Telegram_Chat_ID: '' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: respuestaAlta('Isa 6671112233') }, res);
  ok(respuestaTg().includes('ya está agregada') && respuestaTg().includes('start=s_') && !llamadas.some(l => l.method === 'POST'), 'staff: no duplica a quien ya está con ese teléfono y le recuerda el enlace');

  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: respuestaAlta('Sofía') }, res);
  ok(respuestaTg().includes('No entendí') && !llamadas.some(l => l.method === 'POST'), 'staff: sin teléfono válido no da de alta');

  // La chica toca el enlace: /start <código> vincula su Telegram sin códigos que escribir.
  const SOFIA = { id: 'recCOLABNUEVA0001', fields: { Nombre: 'Sofía Ramírez', Rol: 'Staff', Activo: true, Coordinadora: [ANGELA.id] } };
  reset();
  respuestas = [SOFIA, { records: [] }, {}, ANGELA];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg(`/start ${enlaceSofia}`, 333) }, res);
  const vinculaSofia = llamadas.find(l => l.method === 'PATCH');
  ok(vinculaSofia && vinculaSofia.body.records[0].id === SOFIA.id && vinculaSofia.body.records[0].fields.Telegram_Chat_ID === '333', 'staff: al tocar el enlace queda vinculado su Telegram');
  ok(enviados('sendMessage').some(t => t.body.chat_id === 333 && t.body.text.includes('¡Hola Sofía Ramírez!')) && enviados('sendMessage').some(t => t.body.chat_id === '777' && t.body.text.includes('ya activó sus mensajes')), 'staff: bienvenida a la chica y aviso a Ángela');

  reset();
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg(`/start ${enlaceSofia.slice(0, -1)}x`, 333) }, res);
  ok(!llamadas.some(l => l.method === 'PATCH') && respuestaTg().includes('/entrar'), 'staff: un enlace alterado no vincula');

  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton(`st:k:${SOFIA.id}`, 777) }, res);
  ok(respuestaTg().includes(`start=${enlaceSofia}`), 'staff: tocar a quien no ha activado sus mensajes da de nuevo su enlace');

  reset();
  respuestas = [{ records: [ANGELA] }, EVVM, { records: [ISA, KAR, ZOE] }, { records: [] }, { records: [EVVM] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('st:e:recEVTVASO0000001:0', 777) }, res);
  const menu2 = enviados('editMessageText')[0];
  const botonesMenu2 = menu2 ? menu2.body.reply_markup.inline_keyboard.flat() : [];
  ok(botonesMenu2.some(b => b.text === '⬜ Isabella' && b.callback_data === 'st:e:recEVTVASO0000001:1') && botonesMenu2.some(b => b.text === '⬜ Karla' && b.callback_data === 'st:e:recEVTVASO0000001:2') && !botonesMenu2.some(b => b.text.includes('Zoe')), 'staff: el evento muestra solo las chicas de Ángela, cada toque marca o desmarca');
  ok(menu2.body.text.includes('Se necesitan 2 personas') && enviados('answerCallbackQuery').length === 1, 'staff: dice cuántas personas necesita el evento y responde el toque');

  reset();
  respuestas = [{ records: [ANGELA] }, EVVM, { records: [ISA, KAR, ZOE] }, { records: [] }, { records: [EVVM] },
    { records: [{ id: 'recINVITA00000001' }] }, { records: [{ id: 'recINVITA00000002' }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('st:i:recEVTVASO0000001:3', 777) }, res);
  const invIsa = enviados('sendMessage').find(t => t.body.chat_id === '888');
  const altaInv = llamadas.find(l => l.method === 'POST' && l.url.includes('tblvTVcC3NMt5ddjr'));
  ok(invIsa && invIsa.body.text.startsWith('Hola Isabella 👋 Ángela te programó un evento') && invIsa.body.text.includes('EVT-500001') && invIsa.body.text.includes('salida 5:30 pm') && invIsa.body.text.includes('confírmame si puedes acudir, para que llegues antes (salida 5:30 pm) y prepares todo para el evento'), 'staff: a Isabella le llega la invitación con los datos del evento');
  ok(!invIsa.body.text.includes('3400') && !invIsa.body.text.includes('3,400'), 'staff: la invitación no trae montos del cliente');
  ok(invIsa.body.reply_markup.inline_keyboard[0].map(b => b.callback_data).join(',') === 'inv:s:recINVITA00000001,inv:n:recINVITA00000001', 'staff: la invitación trae botones Sí puedo / No puedo');
  ok(altaInv && altaInv.body.records[0].fields.Estado === 'Invitada' && altaInv.body.records[0].fields.Colaborador[0] === ISA.id && enviados('sendMessage').some(t => t.body.chat_id === '999'), 'staff: se registran las invitaciones de Isabella y Karla');
  ok(enviados('editMessageText')[0].body.text.includes('Invitaciones enviadas: Isabella, Karla'), 'staff: Ángela ve a quién se le envió');

  const INV1 = { id: 'recINVITA00000001', fields: { Evento: [EVVM.id], Colaborador: [ISA.id], Invito: [ANGELA.id], Estado: 'Invitada', Fecha_Evento: '2026-11-21' } };
  reset();
  respuestas = [{ records: [ISA] }, INV1, EVVM, { records: [] }, { records: [EVVM] }, {}, ANGELA, { records: [{ ...INV1, fields: { ...INV1.fields, Estado: 'Confirmó' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('inv:s:recINVITA00000001', 888) }, res);
  const confirma = llamadas.find(l => l.method === 'PATCH');
  const avisoAngela = enviados('sendMessage').find(t => t.body.chat_id === '777');
  ok(confirma && confirma.body.records[0].fields.Estado === 'Confirmó' && avisoAngela && avisoAngela.body.text.includes('✅ Isabella confirmó EVT-500001') && avisoAngela.body.text.includes('1 de 2'), 'staff: Isabella confirma y a Ángela le llega el aviso con cuántas van');
  ok(enviados('editMessageText')[0].body.chat_id === 888 && enviados('editMessageText')[0].body.text.includes('Confirmaste'), 'staff: el mensaje de Isabella cambia a "Confirmaste" y se quitan los botones');

  reset();
  respuestas = [{ records: [KAR] }, INV1];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('inv:s:recINVITA00000001', 999) }, res);
  ok(enviados('answerCallbackQuery')[0].body.text.includes('no es tuya') && !llamadas.some(l => l.method === 'PATCH'), 'staff: nadie puede contestar una invitación ajena');

  reset();
  respuestas = [{ records: [{ ...ISA }] }, { records: [{ ...INV1, fields: { ...INV1.fields, Estado: 'Confirmó' } }] }, { records: [EVVM] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/eventos', 888) }, res);
  ok(respuestaTg().includes('EVT-500001') && !respuestaTg().includes('💰'), 'staff: /eventos muestra sus eventos confirmados, sin pagos');

  reset();
  respuestas = [{ records: [LIDER] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/staff') }, res);
  ok(respuestaTg().includes('solo para Ángela, Diana y Víctor') && llamadas.length === 1, 'staff: /staff solo para Ángela (Coordina_Staff), Diana y Víctor');

  // ---------- /instrucciones: manual por temas con botones ----------
  const botonesDe = (t) => (t.body.reply_markup ? t.body.reply_markup.inline_keyboard.flat().map(b => b.callback_data) : []);
  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/instrucciones', 777) }, res);
  let tgIn = telegram.find(t => t.metodo === 'sendMessage');
  ok(tgIn.body.text.includes('Hola Ángela') && botonesDe(tgIn).join() === 'in:app,in:eventos,in:alertas,in:reporte,in:staff,in:mensajes,in:problemas', 'instrucciones: la coordinadora ve todos los temas, con /staff y el reporte del día');

  reset();
  respuestas = [{ records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/instrucciones', 222) }, res);
  tgIn = telegram.find(t => t.metodo === 'sendMessage');
  ok(!botonesDe(tgIn).includes('in:staff') && botonesDe(tgIn).includes('in:eventos'), 'instrucciones: un líder sin Coordina_Staff no ve /staff');

  reset();
  respuestas = [{ records: [ISA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/instrucciones', 888) }, res);
  tgIn = telegram.find(t => t.metodo === 'sendMessage');
  ok(botonesDe(tgIn).join() === 'in:invitaciones,in:problemas', 'instrucciones: las chicas del staff solo ven sus temas');

  reset();
  respuestas = [{ records: [ANGELA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('in:staff', 777) }, res);
  tgIn = telegram.find(t => t.metodo === 'sendMessage');
  ok(tgIn.body.text.includes('Agregar personal') && !botonesDe(tgIn).includes('in:staff') && botonesDe(tgIn).includes('in:app'), 'instrucciones: el botón manda el tema y el menú de los demás');

  reset();
  respuestas = [{ records: [ISA] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('in:staff', 888) }, res);
  ok(!telegram.some(t => t.metodo === 'sendMessage') && telegram.some(t => t.metodo === 'answerCallbackQuery'), 'instrucciones: un tema que no le toca no se manda');

  // ---------- Gerente de El Vaso Maíz ----------
  const GERENTE = { id: 'recCOLAB000000008', fields: { Nombre: 'Ángela G', Rol: 'Lider de brigada', Activo: true, Brigada: ['recBRIGADA0000003'], Coordina_Staff: true, Gerente_Vaso_Maiz: true, Telegram_Chat_ID: '444' } };
  const ADMIN_T = { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } };
  const ADMIN2_T = { id: 'recCOLAB000000009', fields: { Nombre: 'Víctor', Rol: 'Admin', Activo: true, Telegram_Chat_ID: '112' } };
  const BRIGADA_VM = { id: 'recBRIGADA0000003', fields: { Nombre_Brigada: 'Brigada El Vaso Maíz', EVENTOS: ['recEVENTO0000VM01'] } };
  const EV_STAFF = { id: 'recEVENTO0000VM01', fields: { Folio_Evento: 'EVT-VM1', Fecha_Evento: '2026-11-21', Hora_Inicio: '18:00', Horas_Servicio: 2, Ubicacion: 'Las Quintas', Piezas_Vaso_Maiz: 100, Personal_Requerido: 2, Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI' } };
  const EV_STAFF_CHOCA = { id: 'recEVENTO0000VM09', fields: { Folio_Evento: 'EVT-VM9', Fecha_Evento: '2026-11-21', Hora_Inicio: '18:30', Horas_Servicio: 2, Ubicacion: 'Chapultepec', Piezas_Vaso_Maiz: 80, Personal_Requerido: 2, Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI' } };
  const CHICA_G = { id: 'recCOLABCHICA0001', fields: { Nombre: 'Lucía', Rol: 'Staff', Activo: true, Coordinadora: [GERENTE.id], Telegram_Chat_ID: '555' } };
  const CHICA_SIN_TG = { id: 'recCOLABCHICA0002', fields: { Nombre: 'Mariana', Rol: 'Staff', Activo: true, Coordinadora: [GERENTE.id] } };
  const CHICA_OCUPADA = { id: 'recCOLABCHICA0003', fields: { Nombre: 'Paola', Rol: 'Staff', Activo: true, Coordinadora: [GERENTE.id], Telegram_Chat_ID: '556' } };
  const ZOE_OTRA = { id: 'recCOLABCHICA0004', fields: { Nombre: 'Zoe', Rol: 'Staff', Activo: true, Coordinadora: ['recCOLABOTRA00001'], Telegram_Chat_ID: '557' } };
  const tokenGer = (await login(GERENTE)).body.token;

  reset();
  respuestas = [
    GERENTE, BRIGADA_VM,
    { records: [{ id: 'recEVENTO0000VM01' }, { id: 'recEVENTO0000VM02' }] },
    { records: [] },
    { records: [{ id: 'recEVENTO0000VM02', fields: { Folio_Evento: 'EVT-VM2', Negocio: 'El Vaso Maiz', Encargada: [ENCARG.id] } }] },
    // Staff de la gerente: eventos de El Vaso Maíz, sus chicas y las invitaciones.
    { records: [EV_STAFF, EV_STAFF_CHOCA] },
    { records: [CHICA_G, CHICA_SIN_TG, CHICA_OCUPADA, ZOE_OTRA] },
    { records: [{ id: 'recINVITA00000020', fields: { Evento: [EV_STAFF_CHOCA.id], Colaborador: [CHICA_OCUPADA.id], Estado: 'Confirmó', Fecha_Evento: '2026-11-21' } }] },
    // Quién puede ser encargado de producción.
    { records: [CHICA_G, ZOE_OTRA, ENCARG] },
    { records: [{ id: 'recBRIGADA0000003', fields: { Nombre_Brigada: 'Brigada El Vaso Maíz' } }] },
    { records: [ENCARG] },
  ];
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenGer), query: {} }, res);
  ok(JSON.stringify((res.body.opcionesAsignar.produccion || []).map(p => p.nombre + ':' + p.conTelegram)) === JSON.stringify(['Ana:false', 'Lucía:true']),
    'producción: la gerente puede elegir a su staff y a las encargadas como encargado de producción (no al staff de otra coordinadora)');
  const consultaEventos = llamadas.find(l => l.url.includes('RECORD_ID()="recEVENTO0000VM02"'));
  ok(res.code === 200 && res.body.colaborador.gerente && consultaEventos && consultaEventos.url.includes('RECORD_ID()="recEVENTO0000VM01"'), 'gerente: ve los eventos de su brigada y todos los de El Vaso Maíz');
  ok(res.body.eventos[0].vasoMaiz && res.body.eventos[0].encargadaIds[0] === ENCARG.id && res.body.opcionesAsignar.encargadas.length === 1, 'gerente: recibe las opciones para asignar');
  const staffApp = res.body.staffEventos && res.body.staffEventos[EV_STAFF.id];
  const estadoDe = (id) => staffApp.chicas.find(c => c.id === id) || {};
  ok(staffApp && staffApp.necesita === 2 && estadoDe(CHICA_G.id).estado === 'libre' && estadoDe(CHICA_SIN_TG.id).estado === 'sin_telegram'
    && estadoDe(CHICA_OCUPADA.id).estado === 'choque' && estadoDe(CHICA_OCUPADA.id).choqueFolio === 'EVT-VM9' && !estadoDe(ZOE_OTRA.id).estado && res.body.staffError === false,
    'gerente: la app recibe su staff por evento (libre, sin Telegram, ocupada a esa hora; no las de otra coordinadora)');

  reset();
  respuestas = [GERENTE, BRIGADA_VM];
  // STAFF_EVENTO no responde.
  const fetchOriginal = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes('tblvTVcC3NMt5ddjr') ? { ok: false, status: 500, text: async () => 'caída', json: async () => ({}) } : fetchOriginal(url, opts));
  res = resMock();
  await eventosApi({ method: 'GET', headers: auth(tokenGer), query: {} }, res);
  global.fetch = fetchOriginal;
  ok(res.code === 200 && res.body.staffError === true && res.body.staffEventos === null, 'gerente: si no se puede leer el staff la app lo dice, no muestra la lista vacía');

  // Invitar staff desde la app (lo mismo que /staff en Telegram).
  reset();
  respuestas = [
    GERENTE,
    EV_STAFF,
    { records: [EV_STAFF, EV_STAFF_CHOCA] },
    { records: [CHICA_G, CHICA_SIN_TG, CHICA_OCUPADA, ZOE_OTRA] },
    { records: [{ id: 'recINVITA00000020', fields: { Evento: [EV_STAFF_CHOCA.id], Colaborador: [CHICA_OCUPADA.id], Estado: 'Confirmó', Fecha_Evento: '2026-11-21' } }] },
    { records: [{ id: 'recINVITA00000021' }] },
  ];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_STAFF.id, accion: 'invitar_staff', colaboradorIds: [CHICA_G.id, CHICA_SIN_TG.id, CHICA_OCUPADA.id, ZOE_OTRA.id] } }, res);
  const altasApp = llamadas.filter(l => l.method === 'POST' && l.url.includes('tblvTVcC3NMt5ddjr'));
  const invApp = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '555');
  ok(res.code === 200 && JSON.stringify(res.body.enviadas) === JSON.stringify(['Lucía']) && altasApp.length === 1
    && altasApp[0].body.records[0].fields.Colaborador[0] === CHICA_G.id && altasApp[0].body.records[0].fields.Invito[0] === GERENTE.id,
    'gerente: desde la app invita solo a quien se puede (no sin Telegram, no ocupada, no de otra coordinadora)');
  ok(invApp && invApp.body.text.startsWith('Hola Lucía 👋 Ángela G te programó un evento') && invApp.body.reply_markup.inline_keyboard[0].map(b => b.callback_data).join(',') === 'inv:s:recINVITA00000021,inv:n:recINVITA00000021',
    'gerente: a la chica le llega la misma invitación de Telegram con Sí puedo / No puedo');

  reset();
  respuestas = [GERENTE, { id: 'recEVENTO0000DV01', fields: { Folio_Evento: 'EVT-DV1', Negocio: 'Divanna Eventos' } }, { records: [EV_STAFF] }, { records: [CHICA_G] }, { records: [] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: 'recEVENTO0000DV01', accion: 'invitar_staff', colaboradorIds: [CHICA_G.id] } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'POST') && !telegram.some(t => t.metodo === 'sendMessage'), 'gerente: no invita staff a eventos que no son de El Vaso Maíz autorizados');

  reset();
  respuestas = [GERENTE, EV_STAFF];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_STAFF.id, accion: 'invitar_staff', colaboradorIds: [] } }, res);
  ok(res.code === 400 && !telegram.length, 'gerente: invitar sin elegir a nadie no manda nada');

  // ---------- Encargado de producción de El Vaso Maíz ----------
  const hoyCln = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date());
  const enDias = (n) => { const d = new Date(`${hoyCln}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const EV_PROD = { id: 'recEVENTOPROD0001', fields: { Folio_Evento: 'EVT-PR1', Fecha_Evento: enDias(2), Hora_Inicio: '18:00', Ubicacion: 'Las Quintas', Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI', Piezas_Vaso_Maiz: 150,
    Productos: JSON.stringify([{ clave: 'vm_paquete_3', cantidad: 1 }, { clave: 'vm_raspado', cantidad: 50 }, { clave: 'vm_pieza', cantidad: 10, nota: 'fresas extra' }]),
    Encargado_Produccion: [CHICA_G.id], Instrucciones_Equipo: 'Sin picante para niños' } };

  reset();
  respuestas = [{ records: [EV_PROD] }, CHICA_G, {}, { records: [] }, { records: [] }];
  res = resMock();
  await produccionApi({ method: 'GET', headers: {}, query: {} }, res);
  const avisoPrevio = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '555');
  const marcaPrevio = llamadas.find(l => l.method === 'PATCH' && l.url.includes('tblzLAin65BZPP2c6'));
  ok(res.code === 200 && avisoPrevio && avisoPrevio.body.text.startsWith('Hola Lucía 👋 esta es la producción que necesitamos para el')
    && avisoPrevio.body.text.includes('• Fresas con crema: 15') && avisoPrevio.body.text.includes('• Raspados: 50') && avisoPrevio.body.text.includes('10 pieza(s) suelta(s) de EVT-PR1: fresas extra')
    && avisoPrevio.body.text.includes('Total: 150 piezas') && avisoPrevio.body.text.includes('📌 Sin picante para niños') && avisoPrevio.body.text.includes('verifica el inventario y repórtame las necesidades de insumos'),
    'producción: dos días antes le llega al encargado la lista desglosada (paquetes, piezas sueltas con su nota) y las instrucciones');
  ok(botonesDe(avisoPrevio).join() === `pr:o:previo:${enDias(2)},pr:f:previo:${enDias(2)}` && !avisoPrevio.body.text.includes('$')
    && marcaPrevio && marcaPrevio.body.records[0].fields.Produccion_Avisos.startsWith(`previo:${CHICA_G.id} `),
    'producción: el aviso previo trae "Tenemos todo / Reportar insumos", no trae montos y queda anotado');

  reset();
  respuestas = [{ records: [{ ...EV_PROD, fields: { ...EV_PROD.fields, Produccion_Avisos: `previo:${CHICA_G.id} 2026-10-29T15:00:00Z` } }] }, { records: [] }, { records: [] }];
  res = resMock();
  await produccionApi({ method: 'GET', headers: {}, query: {} }, res);
  ok(res.code === 200 && !telegram.length && !llamadas.some(l => l.method === 'PATCH'), 'producción: si el cron corre otra vez no repite el aviso');

  const EV_HOY = { ...EV_PROD, fields: { ...EV_PROD.fields, Fecha_Evento: hoyCln } };
  reset();
  respuestas = [{ records: [] }, { records: [] }, { records: [EV_HOY] }, CHICA_G, {}];
  res = resMock();
  await produccionApi({ method: 'GET', headers: {}, query: {} }, res);
  const avisoHoy = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '555');
  ok(avisoHoy && avisoHoy.body.text.startsWith('Hola Lucía 👋 esta es la producción del día de hoy') && avisoHoy.body.text.includes('confirma si tenemos todos los ingredientes')
    && botonesDe(avisoHoy).join() === `pr:o:dia:${hoyCln},pr:f:dia:${hoyCln}`, 'producción: el mismo día le llega la producción de hoy para confirmar ingredientes');

  reset();
  respuestas = [{ records: [{ ...EV_PROD, fields: { ...EV_PROD.fields, Encargado_Produccion: [CHICA_SIN_TG.id] } }] }, CHICA_SIN_TG, { records: [] }, { records: [] },
    { records: [GERENTE, ADMIN_T] }, { records: [GERENTE, ADMIN_T] }];
  res = resMock();
  await produccionApi({ method: 'GET', headers: {}, query: {} }, res);
  ok(telegram.some(t => t.body.chat_id === '444' && t.body.text.includes('No pude mandar la lista de producción a:') && t.body.text.includes('Mariana') && t.body.text.includes('no ha activado su Telegram')),
    'producción: si el encargado no tiene Telegram, la gerente se entera');

  // Respuestas del encargado.
  const botonPr = (dato) => ({ callback_query: { id: 'cb9', data: dato, message: { message_id: 70, chat: { id: 555, type: 'private' }, text: 'Lista de producción' } } });
  reset();
  respuestas = [{ records: [CHICA_G] }, { records: [EV_PROD] }, {}, { records: [GERENTE, ADMIN_T] }, { records: [GERENTE, ADMIN_T] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: botonPr(`pr:o:previo:${enDias(2)}`) }, res);
  const respTodo = llamadas.find(l => l.method === 'PATCH');
  ok(respTodo && respTodo.body.records[0].fields.Produccion_Respuesta.includes('✅ Lucía: tenemos todo')
    && ['444', '111'].every(id => telegram.some(t => t.metodo === 'sendMessage' && t.body.chat_id === id && t.body.text.includes('Lucía confirmó que tenemos todo') && t.body.text.includes('EVT-PR1')))
    && telegram.some(t => t.metodo === 'editMessageText' && t.body.text.includes('Respondiste que tenemos todo')),
    'producción: "Tenemos todo" queda anotado y le llega a la gerente con copia a Diana y Víctor');

  reset();
  respuestas = [{ records: [CHICA_G] }, { records: [EV_PROD] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: botonPr(`pr:f:previo:${enDias(2)}`) }, res);
  const pideInsumos = telegram.find(t => t.metodo === 'sendMessage');
  ok(pideInsumos && pideInsumos.body.text.startsWith('📝 Insumos que faltan para la producción del') && pideInsumos.body.text.includes(`(${enDias(2)})`) && pideInsumos.body.reply_markup.force_reply,
    'producción: "Reportar insumos" le pide escribir lo que falta');

  reset();
  respuestas = [{ records: [CHICA_G] }, { records: [EV_PROD] }, {}, { records: [GERENTE, ADMIN_T] }, { records: [GERENTE, ADMIN_T] }];
  res = resMock();
  const respuestaInsumos = msg('3 kg de fresa y 2 botes de crema', 555);
  respuestaInsumos.message.reply_to_message = { from: { is_bot: true }, text: pideInsumos.body.text };
  await telegramApi({ method: 'POST', headers: tgHeaders, body: respuestaInsumos }, res);
  ok(llamadas.some(l => l.method === 'PATCH' && l.body.records[0].fields.Produccion_Respuesta.includes('📝 Lucía: faltan 3 kg de fresa'))
    && telegram.some(t => t.body.chat_id === '444' && t.body.text.includes('reporta que faltan') && t.body.text.includes('3 kg de fresa y 2 botes de crema'))
    && respuestaTg().includes('Se lo mandé a la gerente'), 'producción: los insumos que faltan quedan anotados y le llegan a la gerencia');

  reset();
  respuestas = [{ records: [ZOE_OTRA] }, { records: [EV_PROD] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: botonPr(`pr:o:previo:${enDias(2)}`) }, res);
  ok(!llamadas.some(l => l.method === 'PATCH') && telegram.some(t => t.metodo === 'answerCallbackQuery' && t.body.text.includes('ya no está a tu cargo')),
    'producción: alguien que no es el encargado no puede responder');

  // Asignar el encargado desde la app.
  const EV_LEJOS = { id: 'recEVENTOPROD0002', fields: { Folio_Evento: 'EVT-PR2', Fecha_Evento: enDias(10), Negocio: 'El Vaso Maiz' } };
  reset();
  respuestas = [GERENTE, EV_LEJOS, { records: [CHICA_G, ENCARG] }, { records: [GERENTE, ENCARG, CHICA_G] }, {}, { records: [ADMIN_T] }, CHICA_G];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_LEJOS.id, accion: 'asignar', brigadaId: '', encargadaIds: [], produccionId: CHICA_G.id } }, res);
  const patchProd = llamadas.find(l => l.method === 'PATCH');
  ok(res.code === 200 && patchProd && JSON.stringify(patchProd.body.records[0].fields.Encargado_Produccion) === JSON.stringify([CHICA_G.id])
    && telegram.some(t => t.body.chat_id === '555' && t.body.text.includes('te toca la producción de EVT-PR2') && t.body.text.includes('Dos días antes'))
    && JSON.stringify(res.body.produccion.enviados) === JSON.stringify(['Lucía']) && telegram.some(t => t.body.chat_id === '111' && t.body.text.includes('producción: Lucía')),
    'producción: la gerente asigna al encargado desde la app; si faltan más de 2 días le llega un aviso corto');

  reset();
  respuestas = [GERENTE, { ...EV_PROD, fields: { ...EV_PROD.fields, Encargado_Produccion: [] } }, { records: [CHICA_G, ENCARG] }, { records: [GERENTE, ENCARG, CHICA_G] }, {},
    { records: [ADMIN_T] }, { records: [EV_PROD] }, CHICA_G, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_PROD.id, accion: 'asignar', brigadaId: '', encargadaIds: [], produccionId: CHICA_G.id } }, res);
  ok(res.code === 200 && telegram.some(t => t.body.chat_id === '555' && t.body.text.includes('esta es la producción que necesitamos')),
    'producción: si se asigna con 2 días o menos, la lista le llega en ese momento');

  reset();
  respuestas = [GERENTE, EV_LEJOS, { records: [CHICA_G, ENCARG] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_LEJOS.id, accion: 'asignar', brigadaId: '', encargadaIds: [], produccionId: ZOE_OTRA.id } }, res);
  ok(res.code === 400 && !llamadas.some(l => l.method === 'PATCH'), 'producción: no se puede poner de encargado a alguien fuera de las opciones');

  // ---------- Diana confirma o descarta el cambio del cliente ----------
  const CAMBIO_PEND = { estado: 'pendiente', pedidoEl: '2026-10-29T18:00:00Z', urgente: false, antes: 'Paquete 3', servicios: 'Paquete 5 y 50 raspados',
    indicaciones: 'Llegar por la puerta lateral', montoEstimado: 4650, horaInicio: '19:00', horasServicio: 2, productos: [{ clave: 'vm_paquete_5', cantidad: 1 }, { clave: 'vm_raspado', cantidad: 50 }] };
  const LIDER_CAMBIO = { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } };
  const EV_PEND = { id: 'recEVENTOCAMBIO03', fields: { Folio_Evento: 'EVT-CM1', Fecha_Evento: enDias(10), Hora_Inicio: '18:00', Negocio: 'Divanna Eventos', Autorizacion_Diana: 'SI',
    Brigada_Asignada: ['recBRIGADA0000001'], Servicios_Solicitados: 'Paquete 3', Enterado_Por: 'Juan', Cambio_Cliente: JSON.stringify(CAMBIO_PEND), Notas: 'n' } };
  reset();
  respuestas = [ADMIN, EV_PEND, { records: [ADMIN, LIDER_CAMBIO] }, {}, { records: [ADMIN, LIDER_CAMBIO] }, { records: [ADMIN_T, LIDER_CAMBIO] }, { records: [] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: EV_PEND.id, accion: 'confirmar_cambio' } }, res);
  const aplicado = (llamadas.find(l => l.method === 'PATCH') || { body: { records: [{ fields: {} }] } }).body.records[0].fields;
  const avisoLider = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '222');
  ok(res.code === 200 && aplicado.Servicios_Solicitados === 'Paquete 5 y 50 raspados' && aplicado.Hora_Inicio === '19:00' && aplicado.Piezas_Vaso_Maiz === 170
    && JSON.parse(aplicado.Cambio_Cliente).estado === 'confirmado' && aplicado.Enterado_Por === '' && aplicado.Instrucciones_Equipo === 'Del cliente: Llegar por la puerta lateral',
    'cambio: al confirmar se aplica (servicios, hora, productos, indicaciones) y el equipo vuelve a confirmar "Enterado"');
  ok(avisoLider && avisoLider.body.text.startsWith('🔄 Cambió el pedido EVT-CM1') && avisoLider.body.text.includes('Paquete 5 y 50 raspados') && !avisoLider.body.text.includes('4650') && !avisoLider.body.text.includes('$')
    && botonesDe(avisoLider).join() === `cf:${EV_PEND.id}` && res.body.avisados === 1,
    'cambio: al confirmar se avisa a la brigada con lo nuevo (sin montos) y botón Confirmar');

  reset();
  respuestas = [ADMIN, EV_PEND, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: EV_PEND.id, accion: 'descartar_cambio' } }, res);
  const descartado = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && JSON.parse(descartado.Cambio_Cliente).estado === 'descartado' && !('Servicios_Solicitados' in descartado) && !telegram.length,
    'cambio: descartar no aplica nada ni avisa al equipo');

  reset();
  respuestas = [ADMIN, { ...EV_PEND, fields: { ...EV_PEND.fields, Cambio_Cliente: JSON.stringify({ ...CAMBIO_PEND, estado: 'confirmado' }) } }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: EV_PEND.id, accion: 'confirmar_cambio' } }, res);
  ok(res.code === 409 && !llamadas.some(l => l.method === 'PATCH'), 'cambio: no se confirma dos veces');

  reset();
  respuestas = [GERENTE];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: EV_PEND.id, accion: 'confirmar_cambio' } }, res);
  ok(res.code === 403 && llamadas.length === 1, 'cambio: solo Diana y Víctor confirman cambios');

  // Diana es la jefa de todo: invita a cualquier chica y elige producción desde el dashboard.
  reset();
  respuestas = [ADMIN, EV_STAFF, { records: [EV_STAFF] }, { records: [ZOE_OTRA] }, { records: [] }, { records: [{ id: 'recINVITA00000030' }] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: EV_STAFF.id, accion: 'invitar_staff', colaboradorIds: [ZOE_OTRA.id] } }, res);
  ok(res.code === 200 && JSON.stringify(res.body.enviadas) === JSON.stringify(['Zoe']) && telegram.some(t => t.body.chat_id === '557' && t.body.text.startsWith('Hola Zoe 👋 Diana te programó')),
    'Diana: invita desde el dashboard a cualquier chica del staff (también las de otra coordinadora)');

  reset();
  respuestas = [ADMIN, EV_LEJOS, { records: [ZOE_OTRA, ENCARG] }, { records: [ADMIN, ZOE_OTRA] }, {}, ZOE_OTRA];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: EV_LEJOS.id, accion: 'asignar', brigadaId: '', encargadaIds: [], produccionId: ZOE_OTRA.id } }, res);
  ok(res.code === 200 && JSON.stringify(llamadas.find(l => l.method === 'PATCH').body.records[0].fields.Encargado_Produccion) === JSON.stringify([ZOE_OTRA.id])
    && telegram.some(t => t.body.chat_id === '557' && t.body.text.includes('te toca la producción de EVT-PR2')),
    'Diana: elige al encargado de producción desde el dashboard');

  // ---------- Reporte financiero del día ----------
  const finanzasApi = require(path.join(repo, 'api/finanzas.js'));
  const fin = (token, body, metodo = 'POST', query = {}) => { const r = resMock(); return finanzasApi({ method: metodo, headers: auth(token), body, query }, r).then(() => r); };
  const BRIG_FIN = { id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Brigada Edén', EVENTOS: ['recEVENTOFINAN001'] } };
  const EV_FIN = { id: 'recEVENTOFINAN001', fields: { Folio_Evento: 'EVT-FN1', Fecha_Evento: hoyCln, Negocio: 'Divanna Eventos', Ubicacion: 'Las Quintas', Monto_Adeudado: 1000 } };
  const REP_FIN = { id: 'recREPORTEDIA0001', fields: { Fecha: hoyCln, Colaborador: [LIDER.id], Estado: 'Abierto', Negocio: 'Divanna Eventos', GASTOS: ['recGASTOFINAN0001'], COBROS: ['recCOBROFINAN0001'], Efectivo_Entregado: 500 } };
  const GASTO_FIN = { id: 'recGASTOFINAN0001', fields: { Concepto: 'Gasolina', Monto: 300, Categoria: 'Combustible', Negocio: 'Divanna Eventos', Pagado_Con: 'Dinero propio', Reporte: [REP_FIN.id], Reportado_Por: [LIDER.id], Fecha: hoyCln } };
  const COBRO_FIN = { id: 'recCOBROFINAN0001', fields: { Monto: 1000, Forma: 'Efectivo', Negocio: 'Divanna Eventos', Evento: [EV_FIN.id], Reporte: [REP_FIN.id], Fecha: hoyCln } };
  const fotoPrueba = { tipo: 'image/jpeg', base64: Buffer.from('foto-de-ticket').toString('base64'), nombre: 'ticket.jpg' };

  reset();
  respuestas = [LIDER, BRIG_FIN, { records: [EV_FIN] }, { records: [] }, { records: [{ id: REP_FIN.id, fields: { Estado: 'Abierto' } }] }, { records: [{ id: 'recGASTONUEVO0001' }] }, {}];
  res = await fin(tokenLider, { accion: 'gasto', fecha: hoyCln, concepto: 'Gasolina', categoria: 'Combustible', monto: '$300', pagadoCon: 'Dinero propio', foto: fotoPrueba });
  const altaRep = llamadas.find(l => l.method === 'POST' && l.url.includes('tbllUK2N9ZDv2Bpdt'));
  const altaGasto = llamadas.find(l => l.method === 'POST' && l.url.includes('tblfuEW0oiX4xTw7T'));
  const subida = llamadas.find(l => l.url.includes('content.airtable.com'));
  ok(res.code === 200 && altaRep && altaRep.body.records[0].fields.Colaborador[0] === LIDER.id && altaRep.body.records[0].fields.Estado === 'Abierto'
    && altaGasto.body.records[0].fields.Monto === 300 && altaGasto.body.records[0].fields.Pagado_Con === 'Dinero propio' && altaGasto.body.records[0].fields.Reporte[0] === REP_FIN.id
    && altaGasto.body.records[0].fields.Negocio === 'Divanna Eventos' && altaGasto.body.records[0].fields.Reportado_Por[0] === LIDER.id,
    'reporte: el líder agrega un gasto (dinero propio) y se crea su reporte del día');
  ok(subida && subida.url.includes('/recGASTONUEVO0001/Attachments/uploadAttachment') && subida.body.contentType === 'image/jpeg', 'reporte: la foto del ticket se sube al gasto');

  reset();
  respuestas = [LIDER, BRIG_FIN, { records: [EV_FIN] }];
  res = await fin(tokenLider, { accion: 'gasto', fecha: hoyCln, concepto: 'Gasolina', categoria: 'Combustible', monto: '300', pagadoCon: '' });
  ok(res.code === 400 && res.body.error.includes('dinero del negocio o con dinero propio') && !llamadas.some(l => l.method === 'POST'), 'reporte: el gasto debe decir si fue con dinero propio o del negocio');

  reset();
  respuestas = [LIDER, BRIG_FIN, { records: [EV_FIN] }, { records: [REP_FIN] }, { records: [{ id: 'recCOBRONUEVO0001' }] }];
  res = await fin(tokenLider, { accion: 'cobro', fecha: hoyCln, eventoId: EV_FIN.id, monto: '1000', forma: 'Efectivo' });
  const altaCobro = llamadas.find(l => l.method === 'POST' && l.url.includes('tblb8ADFukpm6nRZV'));
  ok(res.code === 200 && altaCobro.body.records[0].fields.Evento[0] === EV_FIN.id && altaCobro.body.records[0].fields.Forma === 'Efectivo' && altaCobro.body.records[0].fields.Negocio === 'Divanna Eventos',
    'reporte: el líder registra un cobro de su evento');

  reset();
  respuestas = [LIDER, BRIG_FIN, { records: [EV_FIN] }];
  res = await fin(tokenLider, { accion: 'cobro', fecha: hoyCln, eventoId: 'recEVENTOAJENO001', monto: '1000', forma: 'Efectivo' });
  ok(res.code === 400 && !llamadas.some(l => l.method === 'POST'), 'reporte: no se puede registrar un cobro de un evento que no es suyo');

  reset();
  respuestas = [LIDER, { records: [REP_FIN] }, REP_FIN, { records: [GASTO_FIN] }, { records: [COBRO_FIN] }, {}, { records: [ADMIN_T] }, { records: [ADMIN_T] }, { records: [ADMIN] }, { records: [] }];
  res = await fin(tokenLider, { accion: 'enviar', fecha: hoyCln });
  const envio = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const avisoEnvio = telegram.find(t => t.body.chat_id === '111');
  ok(res.code === 200 && envio.Estado === 'Enviado' && envio.Total_Gastos === 300 && envio.Total_Cobros === 1000 && envio.Reembolso_Pendiente === 300,
    'reporte: al enviarlo se calculan los totales y queda Enviado');
  ok(avisoEnvio && avisoEnvio.body.text.includes('Reporte del día de Juan') && avisoEnvio.body.text.includes('⚠️ 1 sin ticket') && avisoEnvio.body.text.includes('Efectivo entregado a Diana: $500')
    && avisoEnvio.body.text.includes('Pagó con dinero propio: $300'), 'reporte: a Diana le llega el resumen (con gastos sin ticket y reembolso)');

  const LIDER_TG_FIN = { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } };
  const REP_ENVIADO = { ...REP_FIN, fields: { ...REP_FIN.fields, Estado: 'Enviado' } };
  reset();
  respuestas = [ADMIN, REP_ENVIADO, REP_ENVIADO, { records: [GASTO_FIN] }, { records: [COBRO_FIN] }, {}, LIDER_TG_FIN, { records: [ADMIN, LIDER] }, { records: [] }];
  res = await fin(tokenAdmin, { accion: 'aprobar', reporteId: REP_FIN.id });
  const aprob = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && aprob.Estado === 'Aprobado' && aprob.Revision.includes('Diana: ✅ aprobado') && telegram.some(t => t.body.chat_id === '222' && t.body.text.includes('aprobó tu reporte') && t.body.text.includes('Te deben $300')),
    'reporte: Diana lo aprueba y a quien reportó le llega el aviso con lo que le deben');

  reset();
  respuestas = [ADMIN];
  res = await fin(tokenAdmin, { accion: 'aclaracion', reporteId: REP_FIN.id, comentario: '' });
  ok(res.code === 400 && res.body.error.includes('aclarar'), 'reporte: pedir aclaración requiere decir qué');

  reset();
  respuestas = [LIDER];
  res = await fin(tokenLider, { accion: 'aprobar', reporteId: REP_FIN.id });
  ok(res.code === 403 && !llamadas.some(l => l.method === 'PATCH'), 'reporte: el líder no puede aprobar reportes');

  reset();
  respuestas = [ASIST];
  res = await fin(tokenAsist, { accion: 'gasto', fecha: hoyCln });
  ok(res.code === 403 && llamadas.length === 1, 'reporte: el asistente no hace el reporte');

  reset();
  respuestas = [ADMIN, { ...REP_FIN, fields: { ...REP_FIN.fields, Estado: 'Aprobado' } }];
  res = await fin(tokenAdmin, { accion: 'aprobar', reporteId: REP_FIN.id });
  ok(res.code === 409 && !llamadas.some(l => l.method === 'PATCH'), 'reporte: un reporte aprobado no se vuelve a revisar');

  // La gerente ve de un reporte "Ambos" solo lo de El Vaso Maíz.
  const REP_AMBOS = { id: 'recREPORTEAMBOS01', fields: { Fecha: hoyCln, Colaborador: [LIDER.id], Estado: 'Enviado', Negocio: 'Ambos', GASTOS: ['recGASTOVM0000001', 'recGASTODV0000001'], COBROS: ['recCOBRODV0000001'] } };
  reset();
  respuestas = [GERENTE, { records: [] }, BRIGADA_VM, { records: [] }, { records: [] }, { records: [] },
    { records: [REP_AMBOS] },
    { records: [{ id: 'recGASTOVM0000001', fields: { Monto: 100, Negocio: 'El Vaso Maiz', Reporte: [REP_AMBOS.id] } }, { id: 'recGASTODV0000001', fields: { Monto: 900, Negocio: 'Divanna Eventos', Reporte: [REP_AMBOS.id] } }] },
    { records: [{ id: 'recCOBRODV0000001', fields: { Monto: 5000, Negocio: 'Divanna Eventos', Reporte: [REP_AMBOS.id] } }] },
    { records: [LIDER] }];
  res = await fin(tokenGer, undefined, 'GET', { fecha: hoyCln });
  const vistaGer = res.body.revision && res.body.revision.pendientes[0];
  ok(res.code === 200 && vistaGer && vistaGer.totalGastos === 100 && vistaGer.gastos.length === 1 && vistaGer.cobros.length === 0 && vistaGer.soloVasoMaiz && res.body.revision.puedeAprobar === false,
    'reporte: la gerente ve la administración de El Vaso Maíz (no lo de Divanna) y no aprueba');

  reset();
  respuestas = [
    GERENTE,
    { id: 'recEVENTO0000VM02', fields: { Folio_Evento: 'EVT-VM2', Negocio: 'El Vaso Maiz' } },
    { records: [GERENTE, ENCARG] },
    {},
    { records: [] },
    { records: [ADMIN_T] },
  ];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: 'recEVENTO0000VM02', accion: 'asignar', brigadaId: '', encargadaIds: [ENCARG.id] } }, res);
  const patchGer = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const avisoGer = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '111');
  ok(res.code === 200 && JSON.stringify(patchGer.Encargada) === JSON.stringify([ENCARG.id]) && avisoGer && avisoGer.body.text.includes('Ángela G asignó EVT-VM2'), 'gerente: asigna un evento de El Vaso Maíz y se avisa a los Admin');

  reset();
  respuestas = [GERENTE, { id: 'recEVENTO0000DV01', fields: { Folio_Evento: 'EVT-DV1', Negocio: 'Divanna Eventos' } }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: 'recEVENTO0000DV01', accion: 'asignar', brigadaId: '', encargadaIds: [] } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'PATCH'), 'gerente: no puede asignar eventos de Divanna');

  reset();
  respuestas = [GERENTE];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { eventoId: 'recEVENTO0000VM02', accion: 'autorizar', monto: 100, items: 'x' } }, res);
  ok(res.code === 403 && llamadas.length === 1, 'gerente: no autoriza pedidos ni ve el dashboard');

  // ---------- DiMa para el equipo (app y Telegram) ----------
  reset();
  respuestas = [GERENTE, { ...BRIGADA_VM, fields: { ...BRIGADA_VM.fields, EVENTOS: [] } }, { records: [] }];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Con /staff tocas Asignar a evento.' }] }];
  res = resMock();
  await chatApi({ method: 'POST', headers: auth(tokenGer), body: { modo: 'equipo', historial: [{ rol: 'yo', texto: '¿Cómo invito a las chicas?' }] } }, res);
  ok(res.code === 200 && res.body.texto === 'Con /staff tocas Asignar a evento.', 'DiMa equipo: la gerente pregunta desde la app');
  ok(llamadasClaude[0].system.includes('gerente de El Vaso Maíz') && llamadasClaude[0].system.includes('Agregar personal') && llamadasClaude[0].messages.slice(-1)[0].role === 'user' && !llamadasClaude[0].tools, 'DiMa equipo: sabe el manual de su rol y no tiene herramientas');
  ok(!llamadasClaude[0].system.includes('HISTORIAL POR MES') && llamadasClaude[0].system.includes('No hablas de precios'), 'DiMa equipo: a la gerente no le da el dinero de las empresas');

  // ---------- Historial mensual por empresa (gráfica de Diana y DiMa) ----------
  const EVS_HIST = { records: [
    { id: 'recHISTEVENTO0001', fields: { Fecha_Evento: '2026-07-10', Negocio: 'Divanna Eventos', Monto_Estimado_IA: 5000 } },
    { id: 'recHISTEVENTO0002', fields: { Fecha_Evento: '2026-07-20', Piezas_Vaso_Maiz: 90, Monto_Estimado_IA: 2700 } },
    { id: 'recHISTEVENTO0003', fields: { Fecha_Evento: '2026-08-01', Monto_Estimado_IA: 100 } },
  ] };
  const GASTOS_HIST = { records: [
    { fields: { Fecha: '2026-07-11', Negocio: 'Divanna Eventos', Monto: 1000 } },
    { fields: { Fecha: '2026-07-12', Negocio: 'Divanna Eventos', Monto: 999, Reporte: ['recREPORTEPENDI01'] } },
  ] };
  const COBROS_HIST = { records: [{ fields: { Fecha: '2026-07-10', Negocio: 'Divanna Eventos', Monto: 5000, Reporte: ['recREPORTEAPROB01'] } }] };
  const APROB_HIST = { records: [{ id: 'recREPORTEAPROB01', fields: { Estado: 'Aprobado' } }] };
  reset();
  respuestas = [ADMIN, EVS_HIST, GASTOS_HIST, COBROS_HIST, APROB_HIST];
  res = resMock();
  await require(path.join(repo, 'api/finanzas.js'))({ method: 'GET', headers: auth(tokenAdmin), query: { vista: 'historial' } }, res);
  const julio = res.body.meses && res.body.meses[0];
  ok(res.code === 200 && julio.mes === '2026-07' && julio['Divanna Eventos'].ingresos === 5000 && julio['Divanna Eventos'].gastos === 1000 && julio['Divanna Eventos'].utilidad === 4000
    && julio['Divanna Eventos'].cobrado === 5000 && julio['El Vaso Maiz'].eventos === 1 && julio['El Vaso Maiz'].ingresos === 2700 && res.body.sinNegocio === 1
    && res.body.meses[res.body.meses.length - 1].mes === hoyCln.slice(0, 7),
    'historial: por mes y empresa, sin gastos de reportes sin aprobar, sin adivinar el negocio y con los meses hasta hoy');

  reset();
  respuestas = [LIDER];
  res = resMock();
  await require(path.join(repo, 'api/finanzas.js'))({ method: 'GET', headers: auth(tokenLider), query: { vista: 'historial' } }, res);
  ok(res.code === 403 && llamadas.length === 1, 'historial: solo Diana y Víctor lo ven');

  reset();
  respuestas = [ADMIN, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, EVS_HIST, GASTOS_HIST, COBROS_HIST, APROB_HIST];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Divanna tuvo su mejor mes en julio.' }] }];
  res = resMock();
  await chatApi({ method: 'POST', headers: auth(tokenAdmin), body: { modo: 'equipo', historial: [{ rol: 'yo', texto: 'Dame el balance, ¿cuáles son las mejores temporadas?' }] } }, res);
  const sistemaAdmin = llamadasClaude[0] && llamadasClaude[0].system;
  ok(res.code === 200 && sistemaAdmin.includes('HISTORIAL POR MES') && sistemaAdmin.includes('jul 2026 · Divanna Eventos: 1 eventos, ingresos contratados $5,000')
    && sistemaAdmin.includes('MEJORES MESES') && sistemaAdmin.includes('con menos de 12 meses no afirmes'),
    'DiMa equipo: a Diana le da el historial por empresa y los mejores meses, aclarando cuántos meses hay');

  // ---------- Cuadre por excepción ----------
  const ayer = enDias(-1);
  const CLI1 = 'recCLIENTEPEPE001';
  const EQ1 = { id: 'recEVCUADRE000001', fields: { Folio_Evento: 'EVT-Q1', Fecha_Evento: ayer, Monto_Estimado_IA: 5000, Negocio: 'Divanna Eventos', Autorizacion_Diana: 'SI', Cliente: [CLI1], COBROS: ['recCOBROQ0000001'], Brigada_Asignada: ['recBRIGADA0000001'] } };
  const EQ2 = { id: 'recEVCUADRE000002', fields: { Folio_Evento: 'EVT-Q2', Fecha_Evento: ayer, Monto_Estimado_IA: 2000, Autorizacion_Diana: 'SI', Cuadre_Estado: 'Debe' } };
  const EQ3 = { id: 'recEVCUADRE000003', fields: { Folio_Evento: 'EVT-Q3', Fecha_Evento: ayer, Monto_Estimado_IA: 1000, Autorizacion_Diana: 'SI', Cuadre_Estado: 'Cuadrado' } };
  const EQ4 = { id: 'recEVCUADRE000004', fields: { Folio_Evento: 'EVT-Q4', Fecha_Evento: ayer, Monto_Estimado_IA: 1000, Autorizacion_Diana: 'SI' } };
  const EQ5 = { id: 'recEVCUADRE000005', fields: { Folio_Evento: 'EVT-Q5', Fecha_Evento: ayer, Monto_Estimado_IA: 900, Cancelado: true, Cliente: [CLI1] } };
  const CQ1 = { id: 'recCOBROQ0000001', fields: { Evento: [EQ1.id], Monto: 3000, Forma: 'Efectivo', Recibido_Por: 'Brigada', Reporte: ['recREPQAPROB0001'] } };
  const CQ3 = { id: 'recCOBROQ0000003', fields: { Evento: [EQ3.id], Monto: 1500, Forma: 'Efectivo', Recibido_Por: 'Diana' } };
  const datosQ = () => [
    { records: [EQ1, EQ2, EQ3, EQ4, EQ5] },
    { records: [CQ1, CQ3] },
    { records: [{ id: 'recREPQAPROB0001', fields: { Efectivo_Entregado: 3000, Fecha: hoyCln } }] },
    { records: [{ fields: { Monto: 1800, Evento_Relacionado: [EQ4.id] } }] },
    { records: [{ fields: { Tipo: 'Depósito al banco', Monto: 2000, Fecha: hoyCln } }] },
    { records: [{ id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Brigada Edén' } }] },
  ];
  reset();
  respuestas = [ADMIN, ...datosQ(), { records: [{ id: CLI1, fields: { Nombre: 'Pepe' } }] }];
  res = await fin(tokenAdmin, undefined, 'GET', { vista: 'cuadre' });
  const vq = res.body;
  ok(res.code === 200 && vq.porAclarar.map(e => e.folio).join() === 'EVT-Q1,EVT-Q4' && vq.porAclarar[0].saldo === 2000 && vq.porAclarar[0].cliente === 'Pepe'
    && vq.deben.map(e => e.folio).join() === 'EVT-Q2' && vq.cobradoDeMas.map(e => e.folio).join() === 'EVT-Q3' && vq.conPerdida.map(e => e.folio).join() === 'EVT-Q4',
    'cuadre: detecta lo que no cuadra, lo que se debe, lo cobrado de más y los eventos con pérdida');
  ok(vq.efectivo.entregadoBrigadas === 3000 && vq.efectivo.pagadoEfectivo === 1500 && vq.efectivo.sinDestino === 2500 && vq.clientes[0].cliente === 'Pepe' && vq.clientes[0].cancelados === 1,
    'cuadre: efectivo sin destino (entregado + pagos en efectivo − destinos) y clientes a vigilar');

  reset();
  respuestas = [LIDER];
  res = await fin(tokenLider, undefined, 'GET', { vista: 'cuadre' });
  ok(res.code === 403 && llamadas.length === 1, 'cuadre: solo Diana y Víctor lo ven');

  reset();
  respuestas = [ADMIN, EQ1, { records: [CQ1] }, { records: [{ id: 'recCOBRODIANA001' }] }, {}];
  res = await fin(tokenAdmin, { accion: 'aclarar', eventoId: EQ1.id, tipo: 'pago', monto: 'todo', forma: 'Efectivo' });
  const pagoDiana = llamadas.find(l => l.method === 'POST' && l.url.includes('tblb8ADFukpm6nRZV'));
  const cuadrado = llamadas.find(l => l.method === 'PATCH');
  ok(res.code === 200 && pagoDiana.body.records[0].fields.Monto === 2000 && pagoDiana.body.records[0].fields.Recibido_Por === 'Diana' && pagoDiana.body.records[0].fields.Forma === 'Efectivo'
    && cuadrado.body.records[0].fields.Cuadre_Estado === 'Cuadrado' && cuadrado.body.records[0].fields.Cuadre_Notas.includes('le pagaron $2,000 (Efectivo)'),
    'cuadre: "me pagaron todo" registra el pago a Diana por lo que faltaba y el evento queda cuadrado');

  reset();
  respuestas = [...datosQ(), { records: [{ id: CLI1, fields: { Nombre: 'Pepe' } }] }, { records: [ADMIN_T] }, {}, {}];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Buenos días, Diana! Que hoy sea un día bonito. Te cuento con cariño: las cuentas de ayer no cuadraron en dos eventos. Va el detalle 👇' }] }];
  const Qmod = require(path.join(repo, 'api/_cuadre.js'));
  const rq = await Qmod.preguntasDelDia();
  const mensajesQ = telegram.filter(t => t.metodo === 'sendMessage' && t.body.chat_id === '111');
  const preguntaQ = mensajesQ.find(t => t.body.text.includes('EVT-Q1'));
  ok(rq.preguntados === 2 && mensajesQ[0].body.text.startsWith('¡Buenos días, Diana!') && !botonesDe(mensajesQ[0]).length
    && llamadasClaude[0].messages[0].content.includes('Escríbele a Diana') && llamadasClaude[0].messages[0].content.includes('NO pongas montos'),
    'cuadre: primero un saludo amistoso con su nombre, escrito por DiMa sin cifras');
  ok(preguntaQ && preguntaQ.body.text.includes('el evento de Pepe (EVT-Q1)') && preguntaQ.body.text.includes('Brigada Edén reportó $3,000') && preguntaQ.body.text.includes('Me faltan $2,000')
    && botonesDe(preguntaQ).join() === `cd:pe:${EQ1.id},cd:pt:${EQ1.id},cd:pm:${EQ1.id},cd:d:${EQ1.id},cd:x:${EQ1.id},cd:o:${EQ1.id}`
    && llamadas.some(l => l.method === 'PATCH' && l.body.records[0].fields.Cuadre_Preguntado === hoyCln),
    'cuadre: luego el detalle con números exactos, la brigada sin acusarla y los botones; no vuelve a preguntar');

  // Si DiMa mete cifras en el saludo (o falla), se usa un saludo de respaldo.
  reset();
  respuestas = [...datosQ(), { records: [{ id: CLI1, fields: { Nombre: 'Pepe' } }] }, { records: [ADMIN_T] }, {}, {}];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola Diana, faltan $2,000 en EVT-Q1.' }] }];
  await Qmod.preguntasDelDia();
  const saludoResp = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '111');
  ok(saludoResp && saludoResp.body.text.includes('Diana') && !saludoResp.body.text.includes('$') && !saludoResp.body.text.includes('EVT-'),
    'cuadre: si el saludo trae cifras o folios se descarta y sale uno de respaldo');

  const botonQ = (dato) => ({ callback_query: { id: 'cbQ', data: dato, message: { message_id: 80, chat: { id: 111, type: 'private' }, text: 'EVT-Q1 no cuadra' } } });
  reset();
  respuestas = [{ records: [ADMIN_T] }, EQ1, { records: [CQ1] }, { records: [{ id: 'recCOBRODIANA002' }] }, {}];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: botonQ(`cd:pt:${EQ1.id}`) }, res);
  ok(llamadas.some(l => l.method === 'POST' && l.body.records[0].fields.Forma === 'Transferencia' && l.body.records[0].fields.Monto === 2000)
    && telegram.some(t => t.metodo === 'editMessageText' && t.body.text.includes('Ya cuadra')), 'cuadre: Diana contesta con un botón de Telegram y queda anotado');

  reset();
  respuestas = [{ records: [ADMIN_T] }, EQ1, { records: [CQ1] }, { records: [{ id: 'recCOBRODIANA003' }] }, {}];
  res = resMock();
  const escritoQ = msg('1500 transferencia', 111);
  escritoQ.message.reply_to_message = { from: { is_bot: true }, text: `✍️ ¿Cuánto te pagaron y cómo? EVT-Q1 (${EQ1.id})` };
  await telegramApi({ method: 'POST', headers: tgHeaders, body: escritoQ }, res);
  ok(llamadas.some(l => l.method === 'POST' && l.body.records[0].fields.Monto === 1500 && l.body.records[0].fields.Forma === 'Transferencia')
    && respuestaTg().includes('Todavía falta $500'), 'cuadre: "otra cantidad" escrita se registra y dice cuánto falta');

  reset();
  respuestas = [{ records: [ADMIN_T] }, ...datosQ(), { records: [{ id: 'recCAJA000000001' }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: botonQ('cj:ret') }, res);
  const retiro = llamadas.find(l => l.method === 'POST' && l.url.includes('tbl9UVlnxzfXscnW5'));
  ok(retiro && retiro.body.records[0].fields.Tipo === 'Retiro personal' && retiro.body.records[0].fields.Monto === 2500 && retiro.body.records[0].fields.Registrado_Por === 'Diana',
    'cuadre: el efectivo sin destino queda anotado (aquí, retiro personal) sin juzgar');

  reset();
  respuestas = [{ records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: { callback_query: { id: 'cbQ2', data: `cd:pe:${EQ1.id}`, message: { message_id: 81, chat: { id: 222, type: 'private' }, text: 'x' } } } }, res);
  ok(!llamadas.some(l => l.method === 'POST' || l.method === 'PATCH') && telegram.some(t => t.metodo === 'answerCallbackQuery' && t.body.text.includes('solo para Diana y Víctor')),
    'cuadre: nadie más puede contestar el cuadre');

  // ---------- Calendario del equipo ----------
  const LIDER_CAL = { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } };
  const BRIG_CAL = { id: 'recBRIGADA0000001', fields: { Nombre_Brigada: 'Brigada Edén' } };
  const EV_CAL = { id: 'recEVENTOCALEN001', fields: { Folio_Evento: 'EVT-CL1', Fecha_Evento: '2026-12-01', Hora_Inicio: '18:00', Horas_Servicio: 2, Negocio: 'Divanna Eventos', Autorizacion_Diana: 'SI', Ubicacion: 'Las Quintas', Brigada_Asignada: ['recBRIGADA0000001'], Monto_Estimado_IA: 9000, Notas: 'n' } };
  const EV_CAL_VM = { id: 'recEVENTOCALEN002', fields: { Folio_Evento: 'EVT-CL2', Fecha_Evento: '2026-12-03', Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI', Piezas_Vaso_Maiz: 90 } };
  const calApi = require(path.join(repo, 'api/brigada-eventos.js'));

  reset();
  respuestas = [ADMIN, EV_CAL, {}, { records: [ADMIN, LIDER_CAL] }, { records: [] }, { records: [ADMIN_T, LIDER_CAL] },
    { ...EV_CAL, fields: { ...EV_CAL.fields, Fecha_Evento: '2026-12-05', Hora_Inicio: '19:00', Horas_Servicio: 3 } }, BRIG_CAL, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { accion: 'calendario_mover', eventoId: EV_CAL.id, fecha: '2026-12-05', hora: '19:00', horasServicio: 3 } }, res);
  const movido = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const avisoMov = telegram.find(t => t.body.chat_id === '222');
  const enGoogle = googleCal.find(g => g.op === 'insert');
  ok(res.code === 200 && movido.Fecha_Evento === '2026-12-05' && movido.Hora_Inicio === '19:00' && movido.Horas_Servicio === 3 && movido.Enterado_Por === ''
    && avisoMov && avisoMov.body.text.includes('Se movió EVT-CL1') && avisoMov.body.text.includes('Antes: martes 1 dic 18:00') && avisoMov.body.text.includes('Ahora: sábado 5 dic 19:00'),
    'calendario: Diana mueve un evento, se borra el Enterado y la brigada recibe antes y ahora');
  ok(enGoogle && enGoogle.requestBody.start.dateTime === '2026-12-05T19:00:00' && enGoogle.requestBody.end.dateTime === '2026-12-05T22:00:00' && enGoogle.requestBody.summary.includes('EVT-CL1')
    && enGoogle.requestBody.description.includes('Brigada: Brigada Edén') && !enGoogle.requestBody.description.includes('9000') && res.body.google.ok,
    'calendario: se refleja en Google Calendar con hora, duración y brigada, sin montos');

  reset();
  respuestas = [GERENTE, EV_CAL];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { accion: 'calendario_mover', eventoId: EV_CAL.id, fecha: '2026-12-05' } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'PATCH'), 'calendario: la gerente no modifica eventos de Divanna');

  reset();
  respuestas = [LIDER];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenLider), body: { accion: 'calendario_mover', eventoId: EV_CAL.id, fecha: '2026-12-05' } }, res);
  ok(res.code === 403 && llamadas.length === 1, 'calendario: el líder ve pero no modifica');

  reset();
  respuestas = [ADMIN, { ...EV_CAL, fields: { ...EV_CAL.fields, Google_Evento_ID: 'gcalVIEJO' } }, {}, { records: [ADMIN, LIDER_CAL] }, { records: [] }, { records: [ADMIN_T, LIDER_CAL] },
    { ...EV_CAL, fields: { ...EV_CAL.fields, Cancelado: true, Autorizacion_Diana: 'NO', Google_Evento_ID: 'gcalVIEJO' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { accion: 'calendario_cancelar', eventoId: EV_CAL.id, motivo: 'El cliente lo canceló' } }, res);
  const cancel = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && cancel.Cancelado === true && cancel.Autorizacion_Diana === 'NO' && cancel.Estado === 'Cerrado' && cancel.Notas.includes('CANCELADO por Diana')
    && telegram.some(t => t.body.chat_id === '222' && t.body.text.includes('Se canceló EVT-CL1') && t.body.text.includes('El cliente lo canceló'))
    && googleCal.some(g => g.op === 'delete' && g.eventId === 'gcalVIEJO'),
    'calendario: cancelar marca el expediente (sin borrarlo), avisa al equipo y lo quita de Google');

  reset();
  respuestas = [ADMIN, EV_CAL];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { accion: 'calendario_cancelar', eventoId: EV_CAL.id, motivo: '' } }, res);
  ok(res.code === 400 && res.body.error.includes('motivo') && !llamadas.some(l => l.method === 'PATCH'), 'calendario: cancelar pide el motivo');

  reset();
  respuestas = [GERENTE];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { accion: 'bloquear_dia', fecha: '2026-12-24', negocio: 'Ambos', motivo: 'Navidad' } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'POST'), 'calendario: la gerente solo bloquea días de El Vaso Maíz');

  reset();
  respuestas = [GERENTE];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { accion: 'bloquear_dia', fecha: '2026-12-24', negocio: 'El Vaso Maiz', motivo: 'Navidad' } }, res);
  const bloqueo = llamadas.find(l => l.method === 'POST' && l.url.includes('tblHSdMCxW2kkiiC9'));
  ok(res.code === 200 && bloqueo && bloqueo.body.records[0].fields.Fecha === '2026-12-24' && bloqueo.body.records[0].fields.Negocio === 'El Vaso Maiz' && bloqueo.body.records[0].fields.Creado_Por === 'Ángela G'
    && googleCal.some(g => g.op === 'insert' && g.requestBody.summary.includes('No disponible') && g.requestBody.start.date === '2026-12-24'),
    'calendario: la gerente bloquea un día de El Vaso Maíz y sale en Google');

  reset();
  respuestas = [ASIST, { records: [EV_CAL, EV_CAL_VM] }, { records: [BRIG_CAL] }];
  bloqueosPrueba = [{ id: 'recBLOQUEOPRUEBA1', fields: { Fecha: '2026-12-24', Negocio: 'El Vaso Maiz', Motivo: 'Navidad' } }];
  res = resMock();
  await calApi({ method: 'GET', headers: auth(tokenAsist), query: { vista: 'calendario', mes: '2026-12' } }, res);
  ok(res.code === 200 && res.body.eventos.length === 2 && res.body.puedeEditar === false && res.body.eventos.every(e => !e.editable && !('monto' in e) && !JSON.stringify(e).includes('9000'))
    && res.body.eventos[0].brigada === 'Brigada Edén' && res.body.bloqueos[0].motivo === 'Navidad',
    'calendario: el asistente ve todos los eventos y los días bloqueados, sin montos y sin poder editar');

  reset();
  respuestas = [GERENTE, { records: [EV_CAL, EV_CAL_VM] }, { records: [BRIG_CAL] }];
  res = resMock();
  await calApi({ method: 'GET', headers: auth(tokenGer), query: { vista: 'calendario', mes: '2026-12' } }, res);
  ok(res.code === 200 && res.body.puedeEditar && res.body.eventos.find(e => e.folio === 'EVT-CL1').editable === false && res.body.eventos.find(e => e.folio === 'EVT-CL2').editable === true,
    'calendario: la gerente puede editar solo los de El Vaso Maíz');

  // ➕ Capturar evento (los que se apartaron fuera del chat).
  reset();
  respuestas = [GERENTE, { records: [] }, { records: [{ id: 'recCLIENTENUEVO01', fields: { Nombre: 'Laura Pérez' } }] }, { records: [{ id: 'recEVCAPTURA00001' }] }, {},
    { id: 'recEVCAPTURA00001', fields: { Folio_Evento: 'EVT-CAP', Fecha_Evento: '2026-12-20', Hora_Inicio: '17:00', Horas_Servicio: 2, Negocio: 'El Vaso Maiz', Autorizacion_Diana: 'SI', Ubicacion: 'Las Quintas' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { accion: 'capturar_evento', clienteNombre: 'Laura Pérez', clienteTelefono: '667 123 4567', negocio: 'El Vaso Maiz',
    fecha: '2026-12-20', hora: '17:00', horasServicio: 2, ubicacion: 'Las Quintas', invitados: 80, servicios: 'Paquete 3\nRaspados', productos: [{ clave: 'vm_paquete_3', cantidad: 1 }],
    montoContratado: '$4,500', anticipo: '1000', formaAnticipo: 'Transferencia' } }, res);
  const evCap = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  const antCap = llamadas.find(l => l.method === 'POST' && l.url.includes('tblb8ADFukpm6nRZV'));
  ok(res.code === 200 && evCap.Autorizacion_Diana === 'SI' && evCap.Monto_Estimado_IA === 4500 && evCap.Checklist_Items === 'Paquete 3\nRaspados' && evCap.Piezas_Vaso_Maiz === 90
    && evCap.Cliente[0] === 'recCLIENTENUEVO01' && res.body.clienteNuevo === true,
    'capturar: la gerente captura un evento de El Vaso Maíz ya autorizado, con checklist y producción');
  ok(antCap && antCap.body.records[0].fields.Monto === 1000 && antCap.body.records[0].fields.Recibido_Por === 'Diana' && antCap.body.records[0].fields.Forma === 'Transferencia'
    && googleCal.some(g => g.op === 'insert' && g.requestBody.start.dateTime === '2026-12-20T17:00:00'),
    'capturar: el anticipo queda como pago recibido (cuadre) y el evento sale en Google');

  reset();
  respuestas = [ADMIN, { records: [{ id: 'recCLIENTEVIEJO01', fields: { Nombre: 'Decoraciones Luna', Telefono_WhatsApp: '+526671112233' } }] }, { records: [{ id: 'recEVCAPTURA00002' }] },
    { id: 'recEVCAPTURA00002', fields: { Folio_Evento: 'EVT-CP2', Fecha_Evento: '2026-12-21', Negocio: 'Divanna Eventos', Autorizacion_Diana: 'SI' } }, {}];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { accion: 'capturar_evento', clienteNombre: 'Luna', clienteTelefono: '6671112233', negocio: 'Divanna Eventos',
    fecha: '2026-12-21', servicios: '10 mesas', montoContratado: 3000 } }, res);
  ok(res.code === 200 && res.body.clienteNuevo === false && !llamadas.some(l => l.method === 'POST' && l.url.includes('tblgViisKQRG9TVjh'))
    && llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields.Cliente[0] === 'recCLIENTEVIEJO01',
    'capturar: si el teléfono ya existe, usa ese cliente (no lo duplica)');

  reset();
  respuestas = [GERENTE];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenGer), body: { accion: 'capturar_evento', clienteNombre: 'X', clienteTelefono: '6671112233', negocio: 'Divanna Eventos', fecha: '2026-12-21', servicios: 'x', montoContratado: 3000 } }, res);
  ok(res.code === 403 && llamadas.length === 1, 'capturar: la gerente no captura eventos de Divanna');

  reset();
  respuestas = [ADMIN];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { accion: 'capturar_evento', clienteNombre: 'X', clienteTelefono: '6671112233', negocio: 'Divanna Eventos', fecha: '2026-12-21', servicios: 'x', montoContratado: 3000, anticipo: 5000, formaAnticipo: 'Efectivo' } }, res);
  ok(res.code === 400 && res.body.error.includes('anticipo') && llamadas.length === 1, 'capturar: el anticipo no puede ser mayor que lo contratado');

  // DiMa no registra un pedido nuevo en un día bloqueado.
  reset();
  bloqueosPrueba = [{ id: 'recBLOQUEOPRUEBA1', fields: { Fecha: '2026-12-12', Negocio: 'Ambos', Motivo: 'Vacaciones' } }];
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete XV', monto_estimado: 6400 } },
  ] }];
  res = await chat({ historial });
  ok(res.body.texto.includes('ya no tenemos disponibilidad') && !llamadas.some(l => l.method === 'POST') && !res.body.folio && llamadasClaude[0].messages.some(m => typeof m.content === 'string' && m.content.includes('DÍAS NO DISPONIBLES')),
    'calendario: DiMa sabe los días bloqueados y no registra un pedido nuevo en uno');

  // ---------- Día lleno ----------
  const evDia = (i, negocio, extra = {}) => ({ id: `recEVLLENO${String(i).padStart(7, '0')}`, fields: { Fecha_Evento: '2026-12-12', Negocio: negocio, Autorizacion_Diana: 'SI', ...extra } });
  const nueveDv = Array.from({ length: 9 }, (_, i) => evDia(i, 'Divanna Eventos'));
  const cupo8 = agendaMod.cupoDelDia('2026-12-12', nueveDv.slice(0, 8).map(agendaMod.eventoParaAgenda));
  const cupo9 = agendaMod.cupoDelDia('2026-12-12', nueveDv.map(agendaMod.eventoParaAgenda));
  ok(!cupo8['Divanna Eventos'].lleno && cupo9['Divanna Eventos'].lleno && !cupo9['El Vaso Maiz'].lleno, 'día lleno: Divanna se llena con 9 entregas (3 brigadas x 3)');
  const seisVm = Array.from({ length: 6 }, (_, i) => evDia(i, 'El Vaso Maiz', { Personal_Requerido: 2 }));
  ok(agendaMod.cupoDelDia('2026-12-12', seisVm.map(agendaMod.eventoParaAgenda))['El Vaso Maiz'].lleno
    && !agendaMod.cupoDelDia('2026-12-12', seisVm.slice(0, 5).map(agendaMod.eventoParaAgenda))['El Vaso Maiz'].lleno
    && agendaMod.cupoDelDia('2026-12-12', seisVm.slice(0, 2).map(agendaMod.eventoParaAgenda), { '2026-12-12': 5 })['El Vaso Maiz'].lleno,
    'día lleno: El Vaso Maíz se llena con 6 equipos o cuando ya no cabe otro equipo en el personal del día');

  reset();
  llenosPrueba = nueveDv;
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete XV', monto_estimado: 6400 } },
  ] }];
  res = await chat({ historial });
  ok(res.body.texto.includes('ya no tenemos cupo') && !res.body.texto.includes('Diana') && !llamadas.some(l => l.method === 'POST') && !res.body.folio
    && llamadasClaude[0].messages.some(m => typeof m.content === 'string' && m.content.includes('DÍAS SIN CUPO') && m.content.includes('2026-12-12 (Divanna)')),
    'día lleno: DiMa sabe los días sin cupo y no registra un pedido nuevo de ese negocio');

  reset();
  llenosPrueba = nueveDv;
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'El Vaso Maiz', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete 3', monto_estimado: 3000 } },
  ] }];
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000009', fields: {} }] }, { records: [{ id: 'recEVTNUEVO000009' }] }];
  res = await chat({ historial });
  ok(/^EVT-[0-9]{6}$/.test(res.body.folio || ''), 'día lleno: si solo Divanna está llena, El Vaso Maíz sí recibe pedidos ese día');

  reset();
  llenosPrueba = nueveDv;
  respuestas = [{ records: [ADMIN, { id: 'recGERENTEPRUEB1', fields: { Rol: 'Lider de brigada', Gerente_Vaso_Maiz: true, Activo: true } }] }];
  const calMod = require(path.join(repo, 'api/_calendario.js'));
  const avisoLleno = await calMod.avisarSiLleno('2026-12-12', 'Divanna Eventos');
  ok(avisoLleno && avisoLleno.lleno && avisoLleno.negocios.join() === 'Divanna Eventos' && avisoLleno.detalle.includes('9 de 9 entregas')
    && llamadas.some(l => l.url.includes('tblHdz4vqUIlIdkwc')),
    'día lleno: al llenarse un día se avisa a la gerencia (Divanna: solo Admin)');

  reset();
  llenosPrueba = nueveDv.slice(0, 3);
  ok((await calMod.avisarSiLleno('2026-12-12', 'Divanna Eventos')).lleno === false && llamadas.length === 0, 'día lleno: si aún hay cupo no avisa a nadie');

  reset();
  respuestas = [LIDER];
  res = resMock();
  await chatApi({ method: 'POST', headers: auth(tokenLider), body: { modo: 'equipo', historial: [{ rol: 'yo', texto: 'hola' }] } }, res);
  ok(res.code === 403 && llamadasClaude.length === 0, 'DiMa equipo: canal exclusivo de la gerencia');

  reset();
  respuestas = [{ records: [GERENTE] }, { ...BRIGADA_VM, fields: { ...BRIGADA_VM.fields, EVENTOS: [] } }, { records: [] }];
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Usa el botón Emergencia.' }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('¿Qué hago si hay un choque?', 444) }, res);
  ok(llamadasClaude.length === 1 && telegram.some(t => t.metodo === 'sendMessage' && t.body.chat_id === 444 && t.body.text === 'Usa el botón Emergencia.'), 'DiMa equipo: la gerente le escribe en Telegram sin comando');

  reset();
  respuestas = [{ records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('hola', 222) }, res);
  ok(llamadasClaude.length === 0 && telegram.find(t => t.metodo === 'sendMessage').body.text.includes('/curso'), 'DiMa equipo: un líder sin gerencia recibe la ayuda, no a DiMa');

  // ---------- Curso por Telegram ----------
  reset();
  respuestas = [{ records: [GERENTE] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/curso', 444) }, res);
  let tgCu = telegram.find(t => t.metodo === 'sendMessage');
  ok(tgCu.body.text.includes('Lección 1 de 6') && botonesDe(tgCu).join() === 'cu:r:0:0,cu:r:0:1,cu:r:0:2', 'curso: la gerente empieza con la lección 1 de 6');

  reset();
  respuestas = [{ records: [GERENTE] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('cu:r:0:1', 444) }, res);
  const respMal = telegram.find(t => t.metodo === 'answerCallbackQuery');
  ok(respMal.body.show_alert && respMal.body.text.includes('Intenta otra vez') && !llamadas.some(l => l.method === 'PATCH'), 'curso: respuesta equivocada explica y no avanza');

  reset();
  respuestas = [{ records: [GERENTE] }, {}, { records: [ADMIN_T] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('cu:r:0:0', 444) }, res);
  const patchCu = llamadas.find(l => l.method === 'PATCH').body.records[0];
  ok(patchCu.id === GERENTE.id && patchCu.fields.Curso_Avance === 1, 'curso: al acertar se guarda el avance');
  ok(telegram.some(t => t.metodo === 'sendMessage' && t.body.chat_id === '111' && t.body.text.includes('pasó la lección 1 de 6')) && telegram.some(t => t.metodo === 'sendMessage' && t.body.chat_id === 444 && t.body.text.includes('Lección 2 de 6')), 'curso: avisa a los Admin y manda la siguiente lección');

  reset();
  respuestas = [{ records: [ADMIN_T] }, { records: [GERENTE, LIDER] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/curso', 111) }, res);
  tgCu = telegram.find(t => t.metodo === 'sendMessage');
  ok(tgCu.body.text.includes('Ángela G: 0 de 6') && tgCu.body.text.includes('Juan: 0 de 4 (sin Telegram)') && botonesDe(tgCu).join() === `cu:inv:${GERENTE.id}`, 'curso: el Admin ve el avance del equipo');

  // ---------- Mensajes directos ----------
  reset();
  respuestas = [{ records: [GERENTE] }, { records: [ADMIN_T, ADMIN2_T] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: msg('/mensaje Mañana llego tarde', 444) }, res);
  const aAdmins = telegram.filter(t => t.metodo === 'sendMessage' && ['111', '112'].includes(t.body.chat_id));
  ok(aAdmins.length === 2 && aAdmins[0].body.text.includes('Mensaje de Ángela G (Gerente de El Vaso Maíz)') && aAdmins[0].body.text.includes('Mañana llego tarde') && botonesDe(aAdmins[0]).join() === `rs:${GERENTE.id}`, 'mensaje: le llega a Diana y Víctor con Responder');
  ok(telegram.some(t => t.body.chat_id === 444 && t.body.text.includes('Se lo mandé a Diana y Víctor')), 'mensaje: quien escribe recibe confirmación');

  reset();
  respuestas = [{ records: [ADMIN_T] }, GERENTE];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton(`rs:${GERENTE.id}`, 111) }, res);
  const pregunta = telegram.find(t => t.metodo === 'sendMessage');
  ok(pregunta.body.text === `↩️ Respuesta para Ángela G (${GERENTE.id}):` && pregunta.body.reply_markup.force_reply, 'mensaje: Responder pide el texto encima');

  reset();
  respuestas = [{ records: [ADMIN_T] }, GERENTE, { records: [ADMIN_T, ADMIN2_T] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: { message: { message_id: 10, chat: { id: 111, type: 'private' }, text: 'Sí, sin problema', reply_to_message: { from: { is_bot: true }, text: pregunta.body.text } } } }, res);
  const aElla = telegram.find(t => t.metodo === 'sendMessage' && t.body.chat_id === '444');
  ok(aElla && aElla.body.text.includes('Diana te respondió') && aElla.body.text.includes('Sí, sin problema') && botonesDe(aElla).join() === 'rs:eq', 'mensaje: la respuesta del Admin le llega a ella con Responder');
  ok(telegram.some(t => t.body.chat_id === '112' && t.body.text.includes('Diana le respondió a Ángela G')) && !telegram.some(t => t.body.chat_id === '111' && t.body.text.includes('le respondió')), 'mensaje: el otro Admin recibe copia');

  reset();
  respuestas = [{ records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] }];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: { message: { message_id: 11, chat: { id: 222, type: 'private' }, text: 'hola', reply_to_message: { from: { is_bot: true }, text: pregunta.body.text } } } }, res);
  ok(!telegram.some(t => t.body.chat_id === '444') && telegram.find(t => t.metodo === 'sendMessage').body.text.includes('Solo Diana y Víctor'), 'mensaje: nadie más puede contestar como Admin');

  // ---------- Botón "Confirmar" de los avisos de un evento ----------
  reset();
  respuestas = [
    { records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] },
    { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Ubicacion: 'Las Quintas', Fecha_Evento: '2026-11-20', Brigada_Asignada: ['recBRIGADA0000001'] } },
    {},
    { records: [{ ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } }] },
  ];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('cf:recEVENTO00000001', 222) }, res);
  const patchCf = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const avisoCf = telegram.find(t => t.metodo === 'sendMessage');
  const editCf = telegram.find(t => t.metodo === 'editMessageText');
  const respCf = telegram.find(t => t.metodo === 'answerCallbackQuery');
  ok(res.code === 200 && patchCf.Enterado_Por === 'Juan' && !!patchCf.Enterado_Hora, 'confirmar: el botón de Telegram guarda el Enterado');
  ok(avisoCf && avisoCf.body.chat_id === '111' && avisoCf.body.text.includes('Juan está enterado de EVT-1'), 'confirmar: avisa a los Admin');
  ok(editCf && editCf.body.text.includes('✅ Confirmado por Juan') && editCf.body.reply_markup.inline_keyboard.length === 0 && respCf.body.text.includes('confirmado'), 'confirmar: el mensaje queda marcado y sin botón');

  reset();
  respuestas = [
    { records: [{ ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } }] },
    { id: 'recEVENTO00000009', fields: { Folio_Evento: 'EVT-9', Brigada_Asignada: ['recBRIGADA0000002'] } },
  ];
  res = resMock();
  await telegramApi({ method: 'POST', headers: tgHeaders, body: boton('cf:recEVENTO00000009', 222) }, res);
  const respNo = telegram.find(t => t.metodo === 'answerCallbackQuery');
  ok(!llamadas.some(l => l.method === 'PATCH') && respNo.body.show_alert && respNo.body.text.includes('ya no está asignado'), 'confirmar: no se puede en un evento de otra brigada');

  // ---------- Avisos de asignación por Telegram y "Enterado" ----------
  const LIDER_TG = { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } };
  reset();
  // Después del PATCH: colaboradores activos (push), colaboradores con Telegram, suscripciones push.
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } }, { records: [LIDER_TG, ADMIN_TG] }, {}, { records: [LIDER_TG, ADMIN_TG] }, { records: [LIDER_TG, ADMIN_TG] }, { records: [] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: 'recBRIGADA0000001', encargadaIds: [] } }, res);
  const tgAsig = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && res.body.porTelegram === 1 && res.body.conTelegram === 1 && tgAsig.length === 1 && tgAsig[0].body.chat_id === '222' && tgAsig[0].body.text.includes('Enterado'), 'asignar: Telegram entregado al líder y contado');
  ok(JSON.stringify(tgAsig[0].body.reply_markup) === JSON.stringify({ inline_keyboard: [[{ text: '✅ Confirmar', callback_data: 'cf:recEVENTO00000001' }]] }), 'asignar: el Telegram lleva el botón Confirmar del evento');

  reset();
  telegramFalla = true;
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1' } }, { records: [LIDER_TG] }, {}, { records: [LIDER_TG] }, { records: [LIDER_TG] }, { records: [] }];
  res = resMock();
  await dash({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', accion: 'asignar', brigadaId: 'recBRIGADA0000001', encargadaIds: [] } }, res);
  ok(res.code === 200 && res.body.porTelegram === 0 && res.body.conTelegram === 1 && res.body.erroresAvisos.some(e => e.includes('Juan') && e.includes('chat not found')), 'asignar: si Telegram no entrega, dice a quién y por qué');

  reset();
  respuestas = [ASIST, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Ubicacion: 'Las Quintas', Brigada_Asignada: ['recBRIGADA0000001'] } }, {}, { records: [LIDER_TG, ADMIN_TG] }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenAsist), body: { eventoId: 'recEVENTO00000001', tipo: 'enterado' } }, res);
  const patchEnt = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const tgEnt = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && patchEnt.Enterado_Por === 'Luis' && !!patchEnt.Enterado_Hora, 'enterado: guarda quién y cuándo (también el asistente)');
  ok(tgEnt.length === 1 && tgEnt[0].body.chat_id === '111' && tgEnt[0].body.text.includes('Luis está enterado de EVT-1'), 'enterado: avisa solo a los Admin por Telegram');

  reset();
  respuestas = [LIDER, { id: 'recEVENTO00000009', fields: { Folio_Evento: 'EVT-9', Brigada_Asignada: ['recBRIGADA0000002'] } }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000009', tipo: 'enterado' } }, res);
  ok(res.code === 403 && !llamadas.some(l => l.method === 'PATCH'), 'enterado: no se puede en un evento de otra brigada');

  // ---------- Ubicación en tiempo real de las alertas ----------
  const ubicLider = { lat: 24.7701234, lng: -107.6012345, precision: 15 };
  const conTelegram = [
    { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } },
    { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } },
  ];
  reset();
  respuestas = [LIDER, eventoBrigada, {}, { records: conTelegram }, { records: conTelegram }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'emergencia', valor: true, motivo: 'choque', ubicacion: ubicLider } }, res);
  const patchUbic = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const mensajesTg = telegram.filter(t => t.metodo === 'sendMessage');
  const pines = telegram.filter(t => t.metodo === 'sendLocation');
  ok(res.code === 200 && patchUbic.Ubicacion_Alerta === '24.770123,-107.601234' && patchUbic.Ubicacion_Alerta_Hora, 'ubicación: la emergencia guarda el GPS de quien reporta');
  ok(mensajesTg[0].body.chat_id === '111' && mensajesTg[0].body.text.includes('maps.google.com/?q=24.770123,-107.601234') && pines.length === 1 && pines[0].body.chat_id === '111' && pines[0].body.latitude === 24.770123, 'ubicación: Telegram lleva link al mapa y pin, solo al equipo');
  ok(mensajesTg.length === 2 && mensajesTg[1].body.chat_id === '222' && mensajesTg[1].body.text.includes('Tu alerta se envió') && res.body.enviados.porTelegram === 1, 'ubicación: quien reporta recibe la confirmación en Telegram');

  reset();
  respuestas = [LIDER, eventoBrigada, {}, { records: conTelegram }, { records: conTelegram }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'emergencia', valor: true, motivo: 'choque' } }, res);
  ok(telegram.find(t => t.metodo === 'sendMessage').body.text.includes('Sin ubicación GPS') && !telegram.some(t => t.metodo === 'sendLocation'), 'ubicación: sin GPS la alerta sale igual y lo dice');

  reset();
  respuestas = [ASIST, { fields: { ...eventoBrigada.fields, Emergencia: true } }, {}];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenAsist), body: { eventoId: 'recEVENTO00000001', tipo: 'ubicacion', ubicacion: { lat: 24.78, lng: -107.6 } } }, res);
  ok(res.code === 200 && res.body.activa === true && llamadas.find(l => l.method === 'PATCH').body.records[0].fields.Ubicacion_Alerta === '24.78,-107.6' && telegram.length === 0, 'ubicación: actualización cada minuto guarda la posición sin mandar avisos');

  reset();
  respuestas = [LIDER, eventoBrigada];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'ubicacion', ubicacion: ubicLider } }, res);
  ok(res.code === 200 && res.body.activa === false && !llamadas.some(l => l.method === 'PATCH'), 'ubicación: sin alerta activa no se guarda (y la app deja de mandarla)');

  reset();
  respuestas = [LIDER, eventoBrigada];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'ubicacion', ubicacion: { lat: 'x', lng: 500 } } }, res);
  ok(res.code === 400, 'ubicación: coordenadas inválidas se rechazan');

  // ---------- Resolver alertas ----------
  reset();
  respuestas = [ADMIN, { fields: { ...eventoBrigada.fields, Emergencia: true, Motivo_Emergencia: 'choque', Ubicacion: 'Centro' } }, {}, { records: conTelegram }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenAdmin), body: { eventoId: 'recEVENTO00000001', tipo: 'emergencia', valor: false } }, res);
  const patchRes = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  const avisosRes = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && patchRes.Emergencia === false && patchRes.Motivo_Emergencia === 'choque', 'resolver: Admin apaga la emergencia y se conserva el motivo como historial');
  ok(avisosRes.length === 2 && avisosRes.every(t => t.body.text.includes('Se resolvió la emergencia')) && pushes.length === 0, 'resolver: aviso de cierre por Telegram a todos, sin push');

  reset();
  respuestas = [LIDER, { fields: { ...eventoBrigada.fields, Zona_Alerta_Seguridad: 'Obregón', Estatus_Logistico: 'Retraso - situación de seguridad en la ciudad' } }, {}, { records: conTelegram }];
  res = resMock();
  await estatus({ method: 'POST', headers: auth(tokenLider), body: { eventoId: 'recEVENTO00000001', tipo: 'alerta_seguridad', valor: false } }, res);
  const patchSeg = llamadas.find(l => l.method === 'PATCH').body.records[0].fields;
  ok(res.code === 200 && patchSeg.Zona_Alerta_Seguridad === '' && patchSeg.Estatus_Logistico === 'En camino' && telegram.some(t => t.body.text && t.body.text.includes('Se levantó la alerta de seguridad')), 'resolver: la alerta de seguridad se levanta y el estatus regresa a En camino');

  // ---------- Aproximado de traslado (km desde la salida x $10 x 4) ----------
  const { estimarTraslado, dentroDeCiudad } = require(path.join(repo, 'api/_traslado.js'));
  ok(dentroDeCiudad([-107.3940, 24.8091]) && !dentroDeCiudad([-107.5504, 24.7734]), 'traslado: el centro está dentro de la ciudad y San Pedro fuera');
  const tr = await estimarTraslado('San Pedro, Navolato');
  ok(tr.ok && !tr.dentroDeCiudad && tr.kmDesdeSalida > 0 && tr.kmDesdeSalida < 20 && tr.costo === Math.round(tr.kmDesdeSalida * 40 / 10) * 10, 'traslado: solo cuenta los km fuera de la ciudad y cobra km x $10 x 4');
  const trCiudad = await estimarTraslado('Las Quintas');
  ok(trCiudad.ok && trCiudad.dentroDeCiudad && trCiudad.costo === 0, 'traslado: dentro de la ciudad no hay costo');

  reset();
  respuestasClaude = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'estimar_traslado', input: { destino: 'San Pedro, Navolato' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: `Aproximado: ${tr.kmDesdeSalida} km, traslado $${tr.costo}. Es un estimado; la cotización final te la confirma el equipo de logística.` }] },
  ];
  res = await chat({ historial: [{ rol: 'cliente', texto: '¿Cuánto me cobran de traslado a San Pedro?' }] });
  const segunda = llamadasClaude[1];
  const resultadoTool = segunda && segunda.messages[segunda.messages.length - 1].content[0];
  ok(llamadasClaude.length === 2 && resultadoTool.type === 'tool_result' && resultadoTool.tool_use_id === 'tu_1' && resultadoTool.content.includes('x $10 x 4'), 'chat: DiMa pide el aproximado y recibe km y costo para responder');
  ok(res.body.texto.includes('equipo de logística') && !llamadas.length, 'chat: la respuesta del aproximado aclara que logística confirma, sin crear pedido');

  reset();
  mapaCaido = true;
  respuestasClaude = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_2', name: 'estimar_traslado', input: { destino: 'San Pedro' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'El equipo de logística te confirma el costo.' }] },
  ];
  res = await chat({ historial: [{ rol: 'cliente', texto: '¿y el traslado?' }] });
  ok(llamadasClaude[1].messages[llamadasClaude[1].messages.length - 1].content[0].content.startsWith('Sin resultado'), 'chat: si el mapa falla, DiMa no recibe un número inventado');
  ok(llamadasClaude[0].system.includes('APROXIMADO DE TRASLADO') && llamadasClaude[0].tools.some(t => t.name === 'estimar_traslado'), 'chat: DiMa tiene la regla y la herramienta de traslado');

  // ---------- Límite de servicio: 35 km desde la salida de Culiacán ----------
  reset();
  const lejos = await estimarTraslado('Eldorado');
  ok(lejos.ok && lejos.kmDesdeSalida > 35 && lejos.fueraDeCobertura === true && tr.fueraDeCobertura === false, 'límite: Eldorado queda fuera de los 35 km y San Pedro dentro');

  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'tu_3', name: 'registrar_pedido', input: { nombre: 'Leo', telefono: '6671112233', email: null, negocio: 'Divanna Eventos', tipo_evento: 'Boda', fecha: '2026-12-12', invitados: 150, ubicacion: 'Eldorado', servicios: 'Paquete boda', monto_estimado: 6500, fuera_de_ciudad: true, indicaciones: null, preferencia_contacto: 'llamada' } },
  ] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'boda en Eldorado' }] });
  ok(!llamadas.some(l => l.method === 'POST') && !res.body.folio && res.body.texto.includes('35 km') && res.body.texto.includes('seguridad'), 'límite: el chat no registra un evento a más de 35 km y explica por qué');

  reset();
  res = resMock();
  await pedido({ method: 'POST', body: { nombre: 'Leo', telefono: '6671112233', negocio: 'Divanna Eventos', fecha: '2026-12-12', ubicacion: 'Eldorado', enCiudad: 'no', servicios: 'Paquete boda' } }, res);
  ok(res.code === 400 && res.body.error.includes('35 km') && !llamadas.some(l => l.method === 'POST'), 'límite: el formulario rechaza un evento a más de 35 km');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'hola' }] });
  ok(llamadasClaude[0].system.includes('PAQUETES PRIMERO') && llamadasClaude[0].system.includes('2 x paquete de 50 personas Antonella ($5,400) = $10,800'), 'precios: DiMa cotiza con paquetes completos antes que piezas sueltas');
  ok(llamadasClaude[0].system.includes('Más de 35 km NO se atiende') && !llamadasClaude[0].system.includes('caso por caso'), 'límite: DiMa tiene la regla de no atender a más de 35 km');

  // ---------- Temporada alta de fin de año (18 dic - 1 ene, +70%, sin paquetes) ----------
  const { enTemporadaAlta } = require(path.join(repo, 'api/_temporada.js'));
  ok(!enTemporadaAlta('2026-12-17') && enTemporadaAlta('2026-12-18') && enTemporadaAlta('2027-01-01') && !enTemporadaAlta('2027-01-02'), 'temporada: del 18 de diciembre al 1 de enero');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Para esas fechas manejamos tarifa de temporada.' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'Es para el 20 de diciembre' }] });
  const avisoTemp = llamadasClaude[0].messages[llamadasClaude[0].messages.length - 1];
  ok(llamadasClaude[0].system.includes('TEMPORADA ALTA DE FIN DE AÑO') && llamadasClaude[0].system.includes('multiplica por 1.7') && avisoTemp.role === 'system' && avisoTemp.content.includes('+70%'), 'temporada: DiMa tiene la regla y recibe el recordatorio al oír "20 de diciembre"');
  ok(llamadasClaude[0].system.includes('El costo de traslado NO sube en temporada') && avisoTemp.content.includes('el traslado no sube'), 'temporada: el traslado se mantiene igual');
  ok(llamadasClaude[0].system.includes('NO aplican en TEMPORADA ALTA'), 'temporada: el catálogo aclara que los paquetes no aplican en temporada alta');

  reset();
  respuestasClaude = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }];
  res = await chat({ historial: [{ rol: 'cliente', texto: 'Es para el 10 de diciembre' }] });
  ok(llamadasClaude[0].messages.every(m => m.role !== 'system'), 'temporada: el 10 de diciembre no dispara el recordatorio');

  reset();
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000013', fields: {} }] }, { records: [{}] }];
  res = resMock();
  await pedido({ method: 'POST', body: { nombre: 'Sol', telefono: '6674445566', negocio: 'Divanna Eventos', fecha: '2026-12-24', enCiudad: 'si', servicios: 'Mesas para 50' } }, res);
  const evTemp = llamadas.find(l => l.method === 'POST' && l.url.includes('tblzLAin65BZPP2c6')).body.records[0].fields;
  ok(res.code === 200 && evTemp.Notas.includes('Temporada alta') && correos[0].text.includes('TEMPORADA ALTA'), 'temporada: el pedido del 24 de diciembre llega marcado a Diana');
})();
