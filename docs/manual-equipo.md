# Manual del equipo: app DiMa Equipo y bot de Telegram

Es el mismo contenido que el bot manda con `/instrucciones` (`api/_instrucciones.js`): si cambia uno,
actualiza el otro. Primera versión escrita para Ángela (coordinadora de El Vaso Maíz), 2026-10-28.

## Para qué sirve

- **La app** (https://divanna-eventos.vercel.app/brigadas/) es para operar el evento: confirmar que lo viste,
  marcar lo que se carga, cambiar el estatus y lanzar alertas.
- **El bot de Telegram** (@dimaclnbot) es para avisos y para el equipo: llegan los eventos asignados y las
  emergencias, y con `/staff` la coordinadora invita a las chicas y ve quién puede ir.
- Las chicas de El Vaso Maíz no usan la app: todo les llega por Telegram.

## Primeros pasos (una sola vez)

Usuario y PIN de 6 dígitos los da Víctor (tabla COLABORADORES). El PIN no se comparte.

**Instalar la app**

1. En el teléfono abrir **Chrome** y entrar a https://divanna-eventos.vercel.app/brigadas/
2. Menú de tres puntos → **Instalar app** o **Agregar a pantalla principal**.
3. Abrir **DiMa Equipo** desde el ícono y entrar con usuario y PIN.
4. **Activar alertas** → **Permitir** (suenan las emergencias aunque la app esté cerrada).
5. La primera alerta pide ubicación: **Permitir** (mejor "Mientras se usa la app").

**Vincular Telegram**

1. Buscar **@dimaclnbot** y tocar **Iniciar**.
2. Escribir `/entrar usuario PIN`. El bot borra ese mensaje en cuanto lo lee.
3. `/instrucciones` muestra este manual por temas, con botones.

## Eventos

Al asignar un evento llega un Telegram con el botón **Confirmar**; también se puede confirmar en la app con
**Enterado, ya vi este evento**. Diana y Víctor ven quién confirmó.

1. **Instrucciones:** cada evento muestra hora de inicio, personas, instrucciones y lo que hay que llevar. Si
   cambian, llega otro aviso para confirmar.
2. **Checklist de carga:** marcar cada cosa al subirla; no se puede pasar a "Salió del almacén" sin marcar todo.
3. **Estatus:** cambiarlo conforme se avanza (salida, llegada, montaje, recolección).

| Botón | Cuándo usarlo | Quién se entera |
| --- | --- | --- |
| Retraso | Tráfico, el cliente cambió la hora, algo normal | Queda en el evento para Diana y Víctor |
| Emergencia | Choque, falla del vehículo, accidente | Todo el equipo, con sonido y ubicación |
| Seguridad | Una zona peligrosa en la ciudad | Todo el equipo, con ubicación; la app da el mensaje para el cliente |

Para quitar la alerta se vuelve a tocar el mismo botón. Con la app abierta la ubicación se actualiza cada minuto.

## Invitar a las chicas con /staff (coordinadora)

**Dar de alta a una chica (una vez):** `/staff` → **Agregar personal** → contestar con nombre y teléfono
(`Isabella López 6671234567`) → el bot da un enlace personal; mandárselo para que lo toque y le dé
**Iniciar**. Llega "Isabella ya activó sus mensajes".

**Invitar a un evento:** `/staff` → **Asignar a evento** → tocar el evento → tocar los nombres → **Invitar**.
A cada una le llegan los datos (sin montos), la hora de llegada y **Sí puedo / No puedo**. Las respuestas le
llegan a la coordinadora ("Isabella confirmó EVT-… · 3 de 4") y al completarse, "Equipo completo".

| Marca | Significa |
| --- | --- |
| ✅ | Confirmó |
| ⏳ | Invitada, todavía no contesta |
| ❌ | No puede |
| ⛔ | Ya confirmó otro evento a esa hora |
| 📵 | No ha activado su Telegram: tocarla da su enlace otra vez |

## Gerente de El Vaso Maíz

- En la app ve **todos** los eventos autorizados de El Vaso Maíz, aunque no se los asignen.
- En cada uno tiene **👷 Asignar**: elige brigada y encargada y toca **Guardar y avisar**. A ellas les llega el
  aviso con **Confirmar** y a Diana y Víctor se les avisa qué asignó.
- Debajo tiene **🧑‍🍳 Staff**: ve a sus chicas con su marca, elige a las que quiere y toca **Invitar por
  Telegram**. Es lo mismo que `/staff`; las respuestas le llegan por Telegram. Dar de alta a una chica nueva
  sigue siendo `/staff` → **Agregar personal**.
- En **Asignar** también elige al **🍳 Encargado de producción**. Dos días antes le llega por Telegram la lista
  de producción del día (para revisar inventario y reportar insumos) y el mismo día otra para confirmar
  ingredientes. Sus respuestas le llegan a la gerente con copia a Diana y Víctor, y se ven en el evento.
- No ve precios ni pagos de los pedidos.

## Cambios que pide el cliente

- Cuando un cliente cambia su pedido, a Diana y Víctor (y a la gerente si es de El Vaso Maíz) les suena la app
  y les llega Telegram. Si el pedido ya estaba autorizado, Diana lo revisa y toca **Confirmar cambio** o
  **Descartar** en el dashboard.
- Al confirmarse, al equipo del evento le llega "🔄 Cambió el pedido" con lo nuevo y el botón **Confirmar**; en
  la app sale el aviso y lo que hay que llevar ya está actualizado. Hay que volver a tocar **Enterado**.
- Los cambios se piden con 24 horas de anticipación; si faltan menos, llegan marcados como **URGENTE**.

## DiMa, curso y mensajes

- **DiMa** (gerente y Admin): en la app con **💬 Pregúntale a DiMa**, o en Telegram escribiendo sin comando.
  Contesta dudas de la plataforma y de sus eventos; no hace cambios.
- **/curso**: capacitación por lecciones con práctica y pregunta. Diana y Víctor ven el avance con `/curso`.
- **/mensaje** y el texto: les llega a Diana y Víctor con **Responder**; su respuesta llega por el bot.

## Comandos y si algo falla

| Comando | Qué hace |
| --- | --- |
| `/hoy` | Eventos de hoy |
| `/eventos` | Próximos eventos |
| `/instrucciones` | Este manual por temas |
| `/curso` | Capacitación por lecciones (Admin: avance del equipo) |
| `/mensaje` | Mensaje directo a Diana y Víctor |
| `/staff` | Dar de alta e invitar a las chicas (coordinadora, Admin) |
| `/alertas` | Emergencias y alertas de seguridad de hoy |
| `/ayuda` | Lo que puede hacer cada quien |
| `/salir` | Desvincular este Telegram |

| Si pasa esto | Hacer esto |
| --- | --- |
| "Usuario o PIN incorrecto" | Usuario todo junto, sin acentos ni espacios; PIN sin espacios. Si sigue, Víctor lo revisa. |
| Los botones de Telegram no hacen nada | Un Admin escribe `/configurar` en el bot. |
| Una chica no recibe la invitación | Sale con 📵: tocarla y reenviarle su enlace. |
| No suenan las emergencias | **Activar alertas** en la app y permitir notificaciones de DiMa Equipo con sonido, sin "No molestar". |
| No se ve un evento | Revisar con `/eventos`; si no aparece, todavía no está asignado. |
