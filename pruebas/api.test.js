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
global.fetch = async (url, opts = {}) => {
  // Las llamadas a Telegram se registran aparte y no consumen respuestas de Airtable.
  if (url.startsWith('https://api.telegram.org/')) {
    telegram.push({ metodo: url.split('/').pop(), body: JSON.parse(opts.body) });
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
const reset = () => { llamadas.length = 0; correos.length = 0; pushes.length = 0; telegram.length = 0; llamadasClaude.length = 0; respuestas = []; respuestasClaude = []; };

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

  reset();
  respuestasClaude = [{ stop_reason: 'tool_use', content: [
    { type: 'tool_use', name: 'registrar_pedido', input: { nombre: 'Ana', telefono: '6671234567', email: null, negocio: 'Divanna Eventos', tipo_evento: 'XV', fecha: '2026-12-12', invitados: 90, ubicacion: 'Las Quintas', servicios: 'Paquete XV\n9 mesas', monto_estimado: 6400 } },
  ] }];
  res = await chat({ historial, folio: 'EVT-123456' });
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
  respuestas = [{ records: [] }, { records: [{ id: 'recCLIENTE0000003', fields: {} }] }, { records: [{}] }, { records: [
    { ...ADMIN, fields: { ...ADMIN.fields, Telegram_Chat_ID: '111' } },
    { ...LIDER, fields: { ...LIDER.fields, Telegram_Chat_ID: '222' } },
  ] }];
  res = resMock();
  await pedido({ method: 'POST', body: { nombre: 'Rosa', telefono: '6679990000', negocio: 'El Vaso Maiz', fecha: '2026-12-20', servicios: 'Paquete 3' } }, res);
  const avisosPedido = telegram.filter(t => t.metodo === 'sendMessage');
  ok(res.code === 200 && avisosPedido.length === 1 && avisosPedido[0].body.chat_id === '111' && avisosPedido[0].body.text.includes('Pedido nuevo'), 'telegram: pedido nuevo solo a los Admin');
})();
