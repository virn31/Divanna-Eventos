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
    return { google: { auth: { JWT: function () {} }, calendar: () => ({ events: { insert: async () => ({ data: { htmlLink: 'x' } }) } }), sheets: () => ({ spreadsheets: { values: { append: async () => ({}) } } }) } };
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

const ok = (cond, msg) => { console.log((cond ? 'PASA ' : 'FALLA') + ' - ' + msg); if (!cond) process.exitCode = 1; };
const reset = () => { mapaCaido = false; telegramFalla = false; llamadas.length = 0; correos.length = 0; pushes.length = 0; telegram.length = 0; llamadasClaude.length = 0; respuestas = []; respuestasClaude = []; };

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
  respuestas = [{ records: [] }]; // sin mensaje pendiente de Diana
  res = await chat({ historial, folio: 'EVT-123456', folioFirma: firmar('EVT-123456') });
  ok(res.body.folio === 'EVT-123456' && !llamadas.some(l => l.method === 'POST') && correos.length === 1 && correos[0].subject.includes('Cambio en el pedido EVT-123456'), 'chat: cambios después de registrar no duplican el evento');

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
  respuestas = [ADMIN, { id: 'recEVENTO00000001', fields: { Folio_Evento: 'EVT-1', Fecha_Evento: '2026-12-12', Cliente: ['recCLIENTE0000001'], Servicios_Solicitados: 'a\nb' } }, {}, { fields: { Nombre: 'Ana', Email: 'ana@x.com' } }];
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
  respuestas = [{ records: [{ fields: { Monto: 500 } }] }, { records: [{ fields: { Monto_Estimado_IA: 2000 } }] }, {}];
  res = resMock();
  await balance({ headers: {}, query: {} }, res);
  const bal = llamadas.find(l => l.method === 'POST').body.records[0].fields;
  ok(res.code === 200 && correos.length === 1 && bal.Detalle_Enviado === true, 'balance: correo enviado y registrado');

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
  ok(tgIn.body.text.includes('Hola Ángela') && botonesDe(tgIn).join() === 'in:app,in:eventos,in:alertas,in:staff,in:problemas', 'instrucciones: la coordinadora ve todos los temas, con /staff');

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
  const ADMIN_TG = { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } };
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
