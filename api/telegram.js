// api/telegram.js
// Webhook del bot interno de Telegram del equipo. Cada colaborador lo vincula
// una vez por chat privado con "/entrar usuario PIN" (mismos datos de la app)
// y a partir de ahí puede consultar y recibe avisos según su rol:
//   /hoy      eventos de hoy           /eventos  próximos eventos
//   /alertas  emergencias y seguridad  /pedidos  pedidos por cotizar (Admin)
//   /salir    desvincular Telegram     /ayuda    lista de comandos
//   /instrucciones  manual del equipo por temas, con botones (api/_instrucciones.js)
//   /curso    capacitación por lecciones (api/_curso.js); Admin ve el avance del equipo
//   /mensaje  mensaje directo a Diana y Víctor, con respuesta por el bot (api/_mensajes.js)
//   /daño (o /dano)  daños y faltantes de un evento: DiMa calcula y se registra con ✅ (api/_danos.js)
// La gerente de El Vaso Maíz y los Admin platican con DiMa escribiendo sin comando
// (api/_dima-equipo.js).
//   /staff    coordinadora (o Admin): invitar a las chicas de El Vaso Maíz a un evento
//   /configurar (Admin) activa los botones del bot y la lista de comandos
// El staff (Rol "Staff") solo usa Telegram: recibe invitaciones con botones
// "Sí puedo" / "No puedo" y ve sus eventos confirmados con /hoy y /eventos.
//
// Requiere en Vercel: TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET (Telegram lo
// manda en cada llamada; así nadie más puede hacerse pasar por Telegram).

const { ROLES, iniciarSesion } = require('./_sesion');
const { alcanceDe, leerEventos, alertasEquipoDeHoy, confirmarEvento } = require('./_eventos');
const { telegramApi, enviarTelegram, editarTelegram, responderBoton, borrarMensaje, colaboradorPorChat, guardarChat, enviarTelegramEquipo } = require('./_telegram');
const {
  puedeCoordinar, menuInicio, menuEventos, menuEvento, invitar, responderInvitacion,
  pedirAlta, esRespuestaAlta, agregarStaff, activarStaff, enlaceActivacion,
} = require('./_staff');
const { instrucciones, tema } = require('./_instrucciones');
const { cursoDe, responderCurso, avanceEquipo, invitarAlCurso } = require('./_curso');
const { esRespuestaMensaje, comandoMensaje, botonResponder, atenderRespuesta } = require('./_mensajes');
const { botonProduccion, esRespuestaProduccion, atenderRespuestaProduccion } = require('./_produccion');
const { botonCuadre, esRespuestaCuadre, atenderRespuestaCuadre } = require('./_cuadre');
const Comanda = require('./_comanda');
const { puedeUsarDima, preguntarDima } = require('./_dima-equipo');
const { reportarDanos, botonDanos } = require('./_danos');
const { veDinero } = require('./_cargos');

const AIRTABLE_BASE_ID = 'appkpCfDADzQJ5G9H';
const EVENTOS_TABLE = 'tblzLAin65BZPP2c6';
const URL_APP = 'https://divanna-eventos.vercel.app/brigadas/';

const ROL_TEXTO = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.LIDER]: 'Líder de brigada',
  [ROLES.ASISTENTE]: 'Asistente',
  [ROLES.ENCARGADA]: 'Encargada de evento',
  [ROLES.STAFF]: 'Staff de El Vaso Maíz',
};
const URL_WEBHOOK = 'https://divanna-eventos.vercel.app/api/telegram';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fechaCorta(iso) {
  if (!iso) return 'sin fecha';
  const [, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

function horaCorta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mazatlan' });
}

function lineaUbicacion(e) {
  return e.ubicacionAlerta ? `📍 https://maps.google.com/?q=${e.ubicacionAlerta}${e.ubicacionAlertaHora ? ' (' + horaCorta(e.ubicacionAlertaHora) + ')' : ''}` : null;
}

function textoEvento(ev, rol) {
  // El staff no ve pagos ni montos del cliente.
  if (rol === ROLES.STAFF) {
    return [
      `📅 ${fechaCorta(ev.fecha)}${ev.horaInicio ? ' · ' + ev.horaInicio : ''} · ${ev.folio}`,
      `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
      ev.instrucciones ? `📌 ${ev.instrucciones}` : null,
    ].filter(Boolean).join('\n');
  }
  const lineas = [
    `📅 ${fechaCorta(ev.fecha)} · ${ev.folio}${ev.negocio ? ' · ' + ev.negocio : ''}`,
    `📍 ${ev.ubicacion || 'Ubicación por confirmar'}`,
    `🚚 ${ev.estatusLogistico}${ev.invitados ? ' · 👥 ' + ev.invitados : ''}`,
  ];
  if (ev.fueraDeCiudad) lineas.push('🛣️ Fuera de la ciudad');
  if (ev.instrucciones) lineas.push(`📌 ${ev.instrucciones}`);
  if (ev.estatusPago) lineas.push(`💰 ${ev.estatusPago}${ev.montoAdeudado ? ' · debe $' + ev.montoAdeudado : ''}`);
  if (ev.retraso && ev.motivoRetraso) lineas.push(`🚦 Retraso: ${ev.motivoRetraso}`);
  if (ev.emergencia) lineas.push(`🆘 Emergencia: ${ev.motivoEmergencia || 'sin detalle'}`);
  if (ev.zonaAlertaSeguridad) lineas.push(`⚠️ Seguridad: ${ev.zonaAlertaSeguridad}`);
  if ((ev.emergencia || ev.zonaAlertaSeguridad) && lineaUbicacion(ev)) lineas.push(lineaUbicacion(ev));
  return lineas.join('\n');
}

function ayuda(colaborador) {
  if (!colaborador) {
    return 'Hola, soy el bot del equipo de Divanna Eventos y El Vaso Maíz.\n\n' +
      'Para vincular tu cuenta escribe:\n/entrar tuusuario tuPIN\n\n' +
      'Son los mismos datos de la app. Borro tu mensaje en cuanto lo leo para que tu PIN no quede en el chat.';
  }
  if (colaborador.rol === ROLES.STAFF) {
    return `${colaborador.nombre} (${ROL_TEXTO[ROLES.STAFF]})\n\n` +
      '/hoy — tus eventos confirmados de hoy\n/eventos — tus próximos eventos confirmados\n/instrucciones — cómo funciona todo\n/salir — desvincular este Telegram\n\n' +
      'Aquí te llegan las invitaciones a eventos: contesta con los botones "Sí puedo" o "No puedo".';
  }
  const comandos = [
    '/hoy — tus eventos de hoy',
    '/eventos — tus próximos eventos',
    '/alertas — emergencias y alertas de seguridad de hoy',
  ];
  if (colaborador.rol === ROLES.ADMIN || colaborador.coordinaStaff) comandos.push('/staff — invitar al staff de El Vaso Maíz a un evento');
  if (colaborador.rol === ROLES.ADMIN) comandos.push('/pedidos — pedidos por cotizar', '/anuncio texto — mensaje a todo el equipo (sin staff)', '/configurar — activar botones y comandos del bot');
  comandos.push('/instrucciones — cómo funciona todo');
  comandos.push(colaborador.rol === ROLES.ADMIN ? '/curso — avance de la capacitación del equipo' : '/curso — tu capacitación por lecciones');
  if (colaborador.rol !== ROLES.ADMIN) comandos.push('/mensaje — escribirles directo a Diana y Víctor');
  if (veDinero(colaborador)) comandos.push('/daño — anotar lo que se rompió o faltó en un evento');
  comandos.push('/salir — desvincular este Telegram');
  const puesto = colaborador.gerente ? 'Gerente de El Vaso Maíz' : (ROL_TEXTO[colaborador.rol] || colaborador.rol);
  return `${colaborador.nombre} (${puesto})\n\n${comandos.join('\n')}\n\n` +
    (puedeUsarDima(colaborador) ? '💬 Para preguntarle a DiMa, escríbele aquí sin comando.\n' : '') +
    `Aquí te llegan las emergencias${colaborador.rol === ROLES.ADMIN ? ', los pedidos nuevos y el balance semanal' : ''}.\n` +
    `Para marcar checklist o cambiar estatus usa la app: ${URL_APP}`;
}

async function listaEventos(colaborador, soloHoy) {
  const { eventoIds } = await alcanceDe(colaborador);
  const eventos = await leerEventos(eventoIds, { soloHoy });
  if (!eventos.length) return soloHoy ? 'No tienes eventos hoy. 🙌' : 'No tienes eventos próximos.';
  const mostrados = eventos.slice(0, 10);
  const extra = eventos.length > mostrados.length ? `\n\n…y ${eventos.length - mostrados.length} más en la app.` : '';
  return `${soloHoy ? 'Tus eventos de hoy' : 'Tus próximos eventos'}:\n\n${mostrados.map(ev => textoEvento(ev, colaborador.rol)).join('\n\n')}${extra}`;
}

async function listaAlertas() {
  const alertas = await alertasEquipoDeHoy([]);
  if (!alertas.length) return 'Sin emergencias ni alertas de seguridad hoy. ✅';
  return 'Alertas de hoy:\n\n' + alertas.map(a => [
    a.emergencia ? `🆘 ${a.folio} (${a.ubicacion || 'sin ubicación'}): ${a.motivoEmergencia || 'sin detalle'}` : null,
    a.zonaAlertaSeguridad ? `⚠️ ${a.folio}: zona ${a.zonaAlertaSeguridad}` : null,
    lineaUbicacion(a),
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function listaPedidos() {
  const formula = encodeURIComponent(`AND({Autorizacion_Diana} = "Pendiente", {Estado} != "Cerrado")`);
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${EVENTOS_TABLE}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Fecha_Evento&sort%5B0%5D%5Bdirection%5D=asc`,
    { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  const { records } = await res.json();
  if (!records.length) return 'No hay pedidos por cotizar. ✅';
  return `Pedidos por cotizar (${records.length}):\n\n` + records.slice(0, 10).map(r => {
    const f = r.fields;
    const servicios = (f.Servicios_Solicitados || '').split('\n').filter(Boolean);
    return `📝 ${f.Folio_Evento || ''} · ${fechaCorta(f.Fecha_Evento)}\n` +
      `${servicios.slice(0, 3).join(', ')}${servicios.length > 3 ? '…' : ''}` +
      (f.Monto_Estimado_IA ? `\nEstimado DiMa: $${Number(f.Monto_Estimado_IA).toLocaleString('es-MX')}` : '');
  }).join('\n\n') + `\n\nCotízalos en ${URL_APP}`;
}

async function entrar(chatId, mensaje, argumentos) {
  // El mensaje trae el PIN: se borra primero, pase lo que pase.
  await borrarMensaje(chatId, mensaje.message_id);
  const [usuarioRaw, pin] = argumentos;
  const usuario = String(usuarioRaw || '').toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(usuario) || !/^\d{6}$/.test(String(pin || ''))) {
    return 'Escríbelo así: /entrar tuusuario 123456';
  }
  const sesion = await iniciarSesion(usuario, String(pin));
  if (!sesion) {
    // Pausa en cada intento fallido para frenar a quien intente adivinar PINs.
    await new Promise(r => setTimeout(r, 1500));
    return 'Usuario o PIN incorrecto.';
  }
  // Si este Telegram estaba vinculado a otra persona, se le quita.
  const anterior = await colaboradorPorChat(chatId);
  if (anterior && anterior.id !== sesion.colaborador.id) await guardarChat(anterior.id, '');
  await guardarChat(sesion.colaborador.id, chatId);
  return `Listo, quedó vinculado tu Telegram. (Borré tu mensaje con el PIN.)\n\n${ayuda(sesion.colaborador)}`;
}

// Vuelve a registrar el webhook para recibir también los toques de botones
// (callback_query) y actualiza la lista de comandos. Usa las mismas variables
// de Vercel, así no hay que correr nada a mano.
async function configurarBot() {
  const webhook = await telegramApi('setWebhook', {
    url: URL_WEBHOOK,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
  const comandos = await telegramApi('setMyCommands', {
    commands: [
      { command: 'hoy', description: 'Tus eventos de hoy' },
      { command: 'eventos', description: 'Tus próximos eventos' },
      { command: 'staff', description: 'Invitar staff de El Vaso Maíz a un evento' },
      { command: 'alertas', description: 'Emergencias y alertas de hoy' },
      { command: 'pedidos', description: 'Pedidos por cotizar (Admin)' },
      { command: 'instrucciones', description: 'Cómo funciona todo (manual)' },
      { command: 'curso', description: 'Capacitación por lecciones' },
      { command: 'mensaje', description: 'Escribirles directo a Diana y Víctor' },
      { command: 'dano', description: 'Anotar daños o faltantes de un evento' },
      { command: 'ayuda', description: 'Qué puedo hacer' },
      { command: 'salir', description: 'Desvincular este Telegram' },
    ],
  });
  return webhook.ok && comandos.ok
    ? '✅ Listo: el bot ya acepta botones y tiene la lista de comandos actualizada (incluye /staff).'
    : `⚠️ No se pudo configurar todo (webhook: ${webhook.ok ? 'ok' : webhook.status}, comandos: ${comandos.ok ? 'ok' : comandos.status}).`;
}

// Toques de botones: menú de /staff (st:...), respuestas a invitaciones (inv:...)
// "Confirmar" de los avisos de un evento (cf:eventoId), temas de /instrucciones (in:tema),
// respuestas del curso (cu:...), "Responder" de los mensajes directos (rs:...)
// y respuestas del encargado de producción (pr:...).
async function atenderBoton(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const mensajeId = cb.message && cb.message.message_id;
  const dato = String(cb.data || '');
  if (!chatId) return responderBoton(cb.id);

  const colaborador = await colaboradorPorChat(chatId);
  if (!colaborador) return responderBoton(cb.id, 'Primero vincula tu Telegram con /entrar.', true);

  const [tipo, accion, id, sel] = dato.split(':');
  // Comanda leída de foto: Guardar (g) o Descartar (x).
  if (tipo === 'cm' && (accion === 'g' || accion === 'x')) {
    await responderBoton(cb.id, accion === 'g' ? 'Guardando…' : '');
    const r = await Comanda.atenderBoton(accion, id, colaborador);
    if (r.texto) await editarTelegram(chatId, mensajeId, cb.message.text || '');
    await enviarTelegram(chatId, r.texto || `⚠️ ${r.aviso}`);
    return;
  }
  if (tipo === 'dn') {
    // Borrador de /daño: Registrar (s) o Cancelar (x), dn:<acción>:<evento>:<lote>.
    const r = await botonDanos(colaborador, accion, id, sel);
    await responderBoton(cb.id, r.aviso, !!r.alerta);
    if (r.textoFinal) await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n${r.textoFinal}`);
    return;
  }
  if (tipo === 'inv' && (accion === 's' || accion === 'n')) {
    const r = await responderInvitacion(colaborador, id, accion === 's');
    await responderBoton(cb.id, r.aviso, !!r.alerta);
    if (r.textoFinal) await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n${r.textoFinal}`);
    return;
  }

  if (tipo === 'cu') {
    if (accion === 'inv') {
      if (colaborador.rol !== ROLES.ADMIN || !/^rec[A-Za-z0-9]{14}$/.test(id || '')) return responderBoton(cb.id);
      await responderBoton(cb.id);
      await enviarTelegram(chatId, await invitarAlCurso(id, colaborador));
      return;
    }
    if (accion !== 'r' || colaborador.rol === ROLES.STAFF) return responderBoton(cb.id);
    const r = await responderCurso(colaborador, await puedeCoordinar(colaborador), Number(id), Number(sel));
    await responderBoton(cb.id, r.aviso, !!r.alerta);
    if (r.siguiente) {
      await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n${r.aviso}`);
      await enviarTelegram(chatId, r.siguiente.texto, r.siguiente.botones);
    }
    return;
  }

  if (tipo === 'cd' || tipo === 'cj') {
    // Cuadre del dinero: Diana dice qué pasó con lo que falta (cd:<acción>:<evento>) o con el efectivo (cj:<destino>).
    const r = await botonCuadre(chatId, colaborador, tipo, accion, id);
    await responderBoton(cb.id, r.aviso, !!r.alerta);
    if (r.textoFinal) await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n${r.textoFinal}`);
    return;
  }

  if (tipo === 'pr') {
    // Encargado de producción: "Tenemos todo" / "Reportar insumos" (pr:o|f:<tipo>:<fecha>).
    const r = await botonProduccion(chatId, colaborador, accion, id, sel);
    await responderBoton(cb.id, r.aviso, !!r.alerta);
    if (r.textoFinal) await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n${r.textoFinal}`);
    return;
  }

  if (tipo === 'rs') {
    await responderBoton(cb.id);
    const r = await botonResponder(chatId, colaborador, accion);
    if (r) await enviarTelegram(chatId, r);
    return;
  }

  if (tipo === 'in') {
    const r = tema(colaborador, await puedeCoordinar(colaborador), accion);
    await responderBoton(cb.id);
    if (r) await enviarTelegram(chatId, r.texto, r.botones);
    return;
  }

  if (tipo === 'cf') {
    if (!/^rec[A-Za-z0-9]{14}$/.test(accion || '')) return responderBoton(cb.id);
    const r = await confirmarEvento(colaborador, accion);
    if (!r) return responderBoton(cb.id, 'Este evento ya no está asignado a ti.', true);
    await responderBoton(cb.id, 'Listo, quedó confirmado');
    await editarTelegram(chatId, mensajeId, `${cb.message.text || ''}\n\n✅ Confirmado por ${colaborador.nombre || 'ti'}`);
    return;
  }

  if (tipo === 'st') {
    if (!(await puedeCoordinar(colaborador))) return responderBoton(cb.id, 'Esta opción es solo para Ángela, Diana y Víctor.', true);
    if (accion === 'x') {
      const avisos = { c: 'Ya confirmó.', i: 'Ya está invitada; esperando respuesta.', o: 'Ya confirmó otro evento a esa hora.', t: 'No ha vinculado su Telegram: pídele que entre a @dimaclnbot.' };
      return responderBoton(cb.id, avisos[id] || '', true);
    }
    if (accion === 'a') {
      // Mensaje nuevo con respuesta forzada: Ángela contesta encima con nombre y teléfono.
      const alta = pedirAlta();
      await responderBoton(cb.id);
      await telegramApi('sendMessage', { chat_id: chatId, text: alta.texto, reply_markup: { force_reply: true, input_field_placeholder: alta.respuestaForzada } });
      return;
    }
    if (accion === 'k') {
      // Enlace de activación de una chica que aún no abre el bot.
      await responderBoton(cb.id);
      if (/^rec[A-Za-z0-9]{14}$/.test(id || '')) {
        await enviarTelegram(chatId, `Mándale este enlace por mensaje; solo tiene que tocarlo y darle "Iniciar" en Telegram:\n${enlaceActivacion(id)}`);
      }
      return;
    }
    const menu = accion === 'm' ? menuInicio()
      : accion === 'l' ? await menuEventos()
      : accion === 'e' ? await menuEvento(colaborador, id, sel)
      : accion === 'i' ? await invitar(colaborador, id, sel)
      : null;
    await responderBoton(cb.id, accion === 'i' ? 'Invitaciones enviadas' : '');
    if (menu) await editarTelegram(chatId, mensajeId, menu.texto, menu.botones);
    return;
  }
  return responderBoton(cb.id);
}

// /anuncio <texto>: Diana o Víctor le mandan un mensaje a todo el equipo con
// Telegram vinculado (Admin, líderes, asistentes y encargadas; el staff no).
// El texto va tal cual, con sus saltos de línea. Responde a cuántos les llegó.
const ROLES_ANUNCIO = [ROLES.ADMIN, ROLES.LIDER, ROLES.ASISTENTE, ROLES.ENCARGADA];
async function anunciar(cuerpo) {
  if (!cuerpo) return 'Escribe el anuncio después del comando, en el mismo mensaje:\n/anuncio Hola equipo, …\nLe llega a todas las brigadas, encargadas, Diana y Víctor (el staff no).';
  if (cuerpo.length > 3800) return `El anuncio es muy largo (${cuerpo.length} letras). El máximo es 3,800: divídelo en dos.`;
  const errores = [];
  const enviados = await enviarTelegramEquipo({ texto: cuerpo, roles: ROLES_ANUNCIO, errores });
  return `📣 Anuncio enviado a ${enviados} persona${enviados === 1 ? '' : 's'} del equipo.${errores.length ? `\n⚠️ No les llegó a: ${errores.join(' · ')}` : ''}\nQuien no tiene Telegram vinculado no lo recibe.`;
}

async function responder(mensaje) {
  const chatId = mensaje.chat.id;
  const texto = String(mensaje.text || '').trim();
  const [primera, ...argumentos] = texto.split(/\s+/);
  const comando = (primera || '').toLowerCase().replace(/@.*$/, '');

  if (comando === '/entrar') return entrar(chatId, mensaje, argumentos);
  // Enlace de activación del staff (t.me/<bot>?start=...): vincula sin usuario ni PIN.
  if (comando === '/start' && argumentos[0]) {
    const bienvenida = await activarStaff(chatId, argumentos[0]);
    if (bienvenida) return bienvenida;
  }

  const colaborador = await colaboradorPorChat(chatId);
  if (!colaborador) return ayuda(null);

  // Respuesta al "➕ Nuevo personal" de /staff: nombre y teléfono.
  if (esRespuestaAlta(mensaje)) {
    return (await puedeCoordinar(colaborador)) ? agregarStaff(colaborador, texto) : 'Esta opción es solo para Ángela, Diana y Víctor.';
  }

  // Corrección de una comanda leída, escrita encima del borrador.
  if (Comanda.esRespuestaComanda(mensaje)) return Comanda.atenderCorreccion(mensaje, colaborador);

  // Monto o explicación del cuadre, escritos encima de la pregunta de DiMa.
  if (esRespuestaCuadre(mensaje)) return atenderRespuestaCuadre(mensaje, colaborador);

  // Insumos que faltan, escritos encima de la pregunta del aviso de producción.
  if (esRespuestaProduccion(mensaje)) return atenderRespuestaProduccion(mensaje, colaborador);

  // Respuesta encima de una pregunta de /mensaje o de "↩️ Responder".
  if (esRespuestaMensaje(mensaje)) return atenderRespuesta(mensaje, colaborador);

  switch (comando) {
    case '/hoy': return listaEventos(colaborador, true);
    case '/curso':
      if (colaborador.rol === ROLES.STAFF) return ayuda(colaborador);
      return colaborador.rol === ROLES.ADMIN ? avanceEquipo() : cursoDe(colaborador, await puedeCoordinar(colaborador));
    case '/mensaje': return comandoMensaje(chatId, colaborador, argumentos.join(' '));
    case '/daño':
    case '/dano':
      await telegramApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      return reportarDanos(colaborador, texto.slice(primera.length).trim());
    case '/eventos': return listaEventos(colaborador, false);
    case '/instrucciones': return instrucciones(colaborador, await puedeCoordinar(colaborador));
    case '/alertas': return colaborador.rol === ROLES.STAFF ? ayuda(colaborador) : listaAlertas();
    case '/staff':
      return (await puedeCoordinar(colaborador)) ? menuInicio()
        : 'Esta opción es solo para Ángela, Diana y Víctor.';
    case '/configurar':
      return colaborador.rol === ROLES.ADMIN ? configurarBot() : 'Esa opción es solo para Diana y Víctor.';
    case '/pedidos':
      return colaborador.rol === ROLES.ADMIN ? listaPedidos() : 'Esa consulta es solo para Diana y Víctor.';
    case '/anuncio':
      return colaborador.rol === ROLES.ADMIN ? anunciar(texto.slice(primera.length).trim()) : 'Esa opción es solo para Diana y Víctor.';
    case '/salir':
      await guardarChat(colaborador.id, '');
      return 'Listo, desvinculé este Telegram. Ya no te llegarán avisos aquí. Para volver: /entrar tuusuario tuPIN';
    default:
      // Sin comando: la gerente y los Admin platican con DiMa.
      if (!texto.startsWith('/') && puedeUsarDima(colaborador)) return platicarConDima(chatId, mensaje, colaborador);
      return ayuda(colaborador);
  }
}

// DiMa en Telegram no guarda la plática: si contestas encima de un mensaje del
// bot, ese mensaje va como contexto.
async function platicarConDima(chatId, mensaje, colaborador) {
  await telegramApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const previo = mensaje.reply_to_message;
  const historial = [
    ...(previo && previo.from && previo.from.is_bot && previo.text ? [{ rol: 'yo', texto: '(Contesto a tu mensaje anterior)' }, { rol: 'dima', texto: previo.text }] : []),
    { rol: 'yo', texto: mensaje.text },
  ];
  const r = await preguntarDima(colaborador, historial, { coordina: await puedeCoordinar(colaborador) });
  return r.texto || 'No te entendí bien, ¿me lo dices de otra forma?';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const secreto = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secreto || req.headers['x-telegram-bot-api-secret-token'] !== secreto) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // Toque de un botón (solo por chat privado).
  const boton = (req.body || {}).callback_query;
  if (boton) {
    try {
      if (boton.message && boton.message.chat && boton.message.chat.type === 'private') await atenderBoton(boton);
      else await responderBoton(boton.id);
    } catch (err) {
      console.error('Error en botón de telegram:', err);
      await responderBoton(boton.id, 'Tuve un problema. Intenta de nuevo en un momento.', true).catch(() => {});
    }
    res.status(200).json({ ok: true });
    return;
  }

  const mensaje = (req.body || {}).message;
  // Siempre 200 a Telegram (si no, reintenta el mismo mensaje una y otra vez).
  if (!mensaje || !mensaje.chat || (typeof mensaje.text !== 'string' && !Comanda.esFotoComanda(mensaje))) { res.status(200).json({ ok: true }); return; }

  try {
    if (mensaje.chat.type !== 'private') {
      if (typeof mensaje.text !== 'string') { res.status(200).json({ ok: true }); return; }
      // Si alguien escribe su PIN en un grupo, se intenta borrar.
      if (mensaje.text.toLowerCase().startsWith('/entrar')) await borrarMensaje(mensaje.chat.id, mensaje.message_id);
      if (mensaje.text.startsWith('/')) {
        await enviarTelegram(mensaje.chat.id, 'Escríbeme por mensaje privado: aquí no puedo mostrar información del equipo.');
      }
    } else {
      // Foto de una comanda en papel: DiMa la lee y deja un borrador con botones.
      let respuesta;
      if (Comanda.esFotoComanda(mensaje)) {
        const colaborador = await colaboradorPorChat(mensaje.chat.id);
        respuesta = colaborador ? await Comanda.atenderFoto(mensaje, colaborador) : 'Primero vincula tu Telegram con /entrar usuario PIN.';
      } else {
        respuesta = await responder(mensaje);
      }
      if (respuesta && typeof respuesta === 'object') await enviarTelegram(mensaje.chat.id, respuesta.texto, respuesta.botones);
      else if (respuesta) await enviarTelegram(mensaje.chat.id, respuesta);
    }
  } catch (err) {
    console.error('Error en telegram:', err);
    await enviarTelegram(mensaje.chat.id, 'Tuve un problema para responder. Intenta de nuevo en un momento.').catch(() => {});
  }
  res.status(200).json({ ok: true });
};
