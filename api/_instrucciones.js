// api/_instrucciones.js
// Manual del equipo por Telegram: /instrucciones contesta con un menú de temas
// en botones (in:<tema>) y cada botón manda ese tema con el menú otra vez, como
// una plática. Los temas dependen del rol: el staff de El Vaso Maíz solo ve lo
// suyo, /staff solo aparece a quien coordina y "Gerente" solo a la gerente de
// El Vaso Maíz. manualTexto() junta todo para que DiMa lo use al contestar. Es el mismo contenido que
// docs/manual-equipo.md; si cambia uno, actualiza el otro.
// Texto plano (el bot no usa parse_mode).

const { ROLES } = require('./_sesion');

const URL_APP = 'https://divanna-eventos.vercel.app/brigadas/';

const TEMAS = {
  app: {
    boton: '📱 Instalar la app',
    texto: () =>
      '📱 Instalar la app (una sola vez)\n\n' +
      `1. En tu teléfono abre Chrome y entra a ${URL_APP}\n` +
      '2. Toca el menú ⋮ (arriba a la derecha) y luego "Instalar app" o "Agregar a pantalla principal".\n' +
      '3. Abre DiMa Equipo desde el ícono nuevo y entra con tu usuario y tu PIN (los mismos de este bot).\n' +
      '4. Toca "Activar alertas" y luego "Permitir": así te suenan las emergencias aunque tengas la app cerrada.\n' +
      '5. La primera vez que lances una alerta te pedirá tu ubicación: toca "Permitir" (mejor "Mientras se usa la app").\n\n' +
      'Tu PIN no se lo compartas a nadie.',
  },
  eventos: {
    boton: '🗓️ Mis eventos',
    texto: () =>
      '🗓️ Tus eventos\n\n' +
      'Cuando te asignan un evento te llega un mensaje aquí con el botón "✅ Confirmar". Confírmalo siempre: así Diana y Víctor saben que ya lo viste. ' +
      'También puedes confirmarlo en la app con "👍 Enterado".\n\n' +
      'En la app, cada evento trae:\n' +
      '• Hora de inicio, personas que se necesitan e instrucciones. Si cambian las instrucciones te llega otro aviso.\n' +
      '• Checklist de carga: toca cada cosa al subirla. No puedes pasar a "Salió del almacén" hasta marcar todo.\n' +
      '• Estatus: cámbialo conforme avanzas (salida, llegada, montaje, recolección).\n\n' +
      'Aquí en Telegram: /hoy te dice tus eventos de hoy y /eventos los próximos.',
  },
  alertas: {
    boton: '🆘 Alertas',
    texto: () =>
      '🆘 Alertas (botones de cada evento en la app)\n\n' +
      '🚦 Retraso: tráfico, el cliente cambió la hora, algo normal. Queda en el evento para Diana y Víctor.\n' +
      '🆘 Emergencia: choque, falla del vehículo, accidente. Le llega a todo el equipo con sonido y tu ubicación.\n' +
      '⚠️ Seguridad: una zona peligrosa en la ciudad. Le llega a todo el equipo con tu ubicación, y la app te da el mensaje para el cliente.\n\n' +
      'Cuando pase, vuelve a tocar el mismo botón para quitarla. Deja la app abierta mientras siga activa: tu ubicación se actualiza cada minuto.\n\n' +
      '/alertas te dice las emergencias y alertas de hoy.',
  },
  staff: {
    boton: '🧑‍🍳 Invitar a las chicas',
    texto: () =>
      '🧑‍🍳 Invitar a las chicas con /staff\n\n' +
      'Dar de alta a una chica (una vez por chica):\n' +
      '1. Escribe /staff y toca "➕ Agregar personal".\n' +
      '2. Contesta con su nombre y teléfono, por ejemplo: Isabella López 6671234567\n' +
      '3. Te doy un enlace personal para ella. Mándaselo por mensaje: solo lo toca y le da "Iniciar".\n' +
      '4. Cuando lo haga te aviso "📲 Isabella ya activó sus mensajes". Sin ese toque no le puedo escribir.\n\n' +
      'Invitarlas a un evento:\n' +
      '1. Escribe /staff y toca "📋 Asignar a evento". Salen los próximos eventos de El Vaso Maíz con cuántas van confirmadas.\n' +
      '2. Toca el evento, toca los nombres que quieres (se marcan ☑️) y luego "📨 Invitar".\n' +
      '3. A cada una le llegan los datos (sin montos) y los botones "✅ Sí puedo" / "❌ No puedo".\n' +
      '4. Cada respuesta te llega a ti ("✅ Isabella confirmó … 3 de 4") y al completarse, "🎉 Equipo completo".\n\n' +
      'Marcas en la lista: ✅ confirmó · ⏳ invitada · ❌ no puede · ⛔ ya tiene otro evento a esa hora · 📵 no ha activado su Telegram (tócala y te doy su enlace otra vez).',
  },
  gerente: {
    boton: '⭐ Soy gerente',
    texto: () =>
      '⭐ Gerente de El Vaso Maíz\n\n' +
      '• En la app ves TODOS los eventos autorizados de El Vaso Maíz, aunque no te los asignen a ti.\n' +
      '• En cada evento de El Vaso Maíz tienes "👷 Asignar": eliges la brigada y la encargada y tocas "Guardar y avisar". A ellas les llega el aviso con "✅ Confirmar" y a Diana y Víctor les aviso qué asignaste.\n' +
      '• Debajo tienes "🧑‍🍳 Staff": ves a tus chicas con su marca, eliges a las que quieres y tocas "📨 Invitar por Telegram". Es lo mismo que /staff; las respuestas te llegan aquí. Para dar de alta a una chica nueva sigue siendo /staff → "➕ Agregar personal".\n' +
      '• En "👷 Asignar" también eliges al "🍳 Encargado de producción". Dos días antes le llega por Telegram la lista de lo que hay que preparar para que revise inventario, y el mismo día otra para confirmar ingredientes. Lo que conteste te llega aquí (con copia a Diana y Víctor) y lo ves en el evento.\n' +
      '• Si un cliente cambia su pedido te suena la app y te llega aquí ("✏️ Cambio en el pedido"). Diana lo confirma; entonces al equipo le llega "🔄 Cambió el pedido" y tienen que volver a tocar "Enterado". Los cambios se piden con 24 h de anticipación; si faltan menos, llega como URGENTE.\n' +
      '• Comandas en papel de El Vaso Maíz: tómales foto y mándamela aquí. Te muestro lo que leí; si algo está mal, contéstame encima con la corrección, y tocas "✅ Guardar evento". También en el calendario: "➕ Capturar evento" → "📷 Llenar con la foto de una comanda".\n' +
      '• Cuando se registra un anticipo o un pago de El Vaso Maíz te llega aquí el recibo en PDF para mandárselo al cliente; también con "🧾 Mandar recibo" en el evento del calendario.\n' +
      '• No ves precios ni pagos de los pedidos: eso lo llevan Diana y Víctor.',
  },
  mensajes: {
    boton: '💬 DiMa y mensajes',
    texto: (rol, gerente) =>
      '💬 DiMa y mensajes\n\n' +
      (gerente || rol === ROLES.ADMIN
        ? 'DiMa es tu asistente: pregúntale lo que sea de la plataforma o de tus eventos. Escríbele aquí mismo, sin comando, o en la app con "💬 Pregúntale a DiMa". Si no sabe algo, te lo dice.\n\n'
        : '') +
      'Para escribirles directo a Diana y Víctor: /mensaje y tu texto (por ejemplo: /mensaje Mañana llego tarde). Les llega con un botón para contestarte y su respuesta te llega aquí.\n\n' +
      '/curso te da la capacitación por lecciones, a tu ritmo.',
  },
  reporte: {
    boton: '💰 Reporte del día',
    texto: () =>
      '💰 Reporte del día (al terminar tu día)\n\n' +
      'En la app toca 💰 (arriba, junto a salir):\n' +
      '1. Gastos: qué compraste, cuánto, la categoría y si fue con dinero del negocio o con tu dinero (ese te lo reembolsan). Toma foto del ticket.\n' +
      '2. Cobros: de qué evento, cuánto y si fue efectivo, transferencia o depósito (foto del comprobante).\n' +
      '3. Cierre: el efectivo que le entregaste a Diana y los insumos que se usaron o sobraron.\n' +
      '4. Toca "📨 Enviar a Diana". Ella lo aprueba o te pide una aclaración (te llega aquí); si pide aclaración, corrígelo y vuelve a enviarlo.\n\n' +
      'Puedes hacer el de hoy o el de ayer. Ya aprobado no se puede cambiar.',
  },
  invitaciones: {
    boton: '📨 Mis invitaciones',
    texto: () =>
      '📨 Tus invitaciones\n\n' +
      'Aquí te llegan las invitaciones a eventos de El Vaso Maíz con los datos del evento y a qué hora llegar antes para preparar.\n\n' +
      '• Toca "✅ Sí puedo" o "❌ No puedo". Tu respuesta le llega a tu coordinadora.\n' +
      '• /hoy te dice tus eventos confirmados de hoy y /eventos los próximos.\n' +
      '• Si ya no puedes ir a uno que confirmaste, avísale a tu coordinadora.',
  },
  problemas: {
    boton: '🛠️ Si algo falla',
    texto: (rol) =>
      '🛠️ Si algo falla\n\n' +
      (rol === ROLES.STAFF
        ? '• No te llegan invitaciones: pídele a tu coordinadora tu enlace y tócalo otra vez.\n' +
          '• Los botones no hacen nada: avísale a tu coordinadora.\n'
        : '• "Usuario o PIN incorrecto": escribe tu usuario todo junto, sin acentos ni espacios, y el PIN sin espacios. Si sigue, pídele a Víctor que lo revise.\n' +
          '• Los botones de Telegram no hacen nada: avísale a Víctor (tiene que activarlos).\n' +
          '• No te suenan las emergencias: en la app toca "Activar alertas", y en los ajustes del teléfono permite las notificaciones de DiMa Equipo con sonido y sin "No molestar".\n' +
          '• No ves un evento: revisa con /eventos. Si no aparece, todavía no te lo asignan.\n' +
          '• Una chica no recibe la invitación: en la lista del evento sale con 📵; tócala y reenvíale su enlace.\n') +
      '\nPara cualquier otra duda, escríbele a Víctor o a Diana.',
  },
};

// Temas que le tocan a cada quien, en orden.
function temasDe(colaborador, coordina) {
  if (colaborador.rol === ROLES.STAFF) return ['invitaciones', 'problemas'];
  const reporta = colaborador.rol === ROLES.LIDER || colaborador.rol === ROLES.ENCARGADA;
  return ['app', 'eventos', 'alertas', ...(reporta ? ['reporte'] : []), ...(colaborador.gerente ? ['gerente'] : []), ...(coordina ? ['staff'] : []), 'mensajes', 'problemas'];
}

function menu(temas, actual = null) {
  const botones = temas.filter(t => t !== actual).map(t => ({ texto: TEMAS[t].boton, dato: `in:${t}` }));
  const filas = [];
  for (let i = 0; i < botones.length; i += 2) filas.push(botones.slice(i, i + 2));
  return filas;
}

// /instrucciones: saludo y menú de temas.
function instrucciones(colaborador, coordina) {
  const nombre = (colaborador.nombre || '').split(' ')[0];
  return {
    texto: `Hola${nombre ? ' ' + nombre : ''} 👋 Te explico cómo funciona todo. ¿Qué quieres saber?`,
    botones: menu(temasDe(colaborador, coordina)),
  };
}

// Toque de un botón in:<tema>. Null si el tema no existe o no le toca.
function tema(colaborador, coordina, clave) {
  const temas = temasDe(colaborador, coordina);
  if (!temas.includes(clave)) return null;
  return { texto: `${TEMAS[clave].texto(colaborador.rol, colaborador.gerente)}\n\n¿Algo más?`, botones: menu(temas, clave) };
}

// Todo el manual que le toca a este colaborador, en un solo texto (para DiMa).
function manualTexto(colaborador, coordina) {
  return temasDe(colaborador, coordina).map(t => TEMAS[t].texto(colaborador.rol, colaborador.gerente)).join('\n\n');
}

module.exports = { instrucciones, tema, manualTexto };
