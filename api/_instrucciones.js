// api/_instrucciones.js
// Manual del equipo por Telegram: /instrucciones contesta con un menú de temas
// en botones (in:<tema>) y cada botón manda ese tema con el menú otra vez, como
// una plática. Los temas dependen del rol: el staff de El Vaso Maíz solo ve lo
// suyo y /staff solo aparece a quien coordina. Es el mismo contenido que
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
  return ['app', 'eventos', 'alertas', ...(coordina ? ['staff'] : []), 'problemas'];
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
  return { texto: `${TEMAS[clave].texto(colaborador.rol)}\n\n¿Algo más?`, botones: menu(temas, clave) };
}

module.exports = { instrucciones, tema };
