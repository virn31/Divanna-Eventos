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
4. **Líder de brigada en el 📅 calendario:** en los eventos de su brigada puede cambiar fecha u hora, cancelar,
   mandar el recibo y bloquear días de Divanna (solo quita los que bloqueó él). **📋 Ver ficha completa** abre la
   ficha del evento (cliente, dinero, artículos) con **✏️ Editar evento, cliente y pedido** (sin cambiar el monto).
   Diana y Víctor reciben aviso de cada cambio. Los asistentes y encargadas solo ven el calendario.
5. **🚚 Logística (segunda pestaña del 📅 calendario):** entregas y recolecciones de Divanna y servicios de El Vaso
   Maíz del día (o 7 días), por hora o por vehículo, con dirección (abre el mapa), vehículo y avisos (sin vehículo,
   hora sin confirmar, el mismo vehículo en dos lugares a menos de 90 min). Todos la ven; la editan Diana y Víctor
   (todo), Ángela (El Vaso Maíz) y Eden (Divanna) con **✏️ Editar logística**: hora de llegada, vehículo (= brigada),
   recolección y notas del traslado. Casa Isabella no aparece (lugar fijo).
6. **📞 Llamar al cliente:** al registrar su pedido el cliente recibe la tarjeta **"Quién te atenderá"** con el nombre
   y puesto de su gerente (Eden, Mario o Ángela; nunca teléfonos) y el aviso de que la brigada puede llamarle. La
   tarjeta le dice que quien llame del equipo sabrá su número de pedido: **al llamar, di tu nombre y su EVT-…**.

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

**Etapas del staff (por Telegram):** cuando el encargado de producción toca **🚀 Listo para staff**, a cada chica
que confirmó le llegan los botones **Saliendo del almacén → En camino → Llegamos al lugar → Evento en curso →
Evento terminado** (= Cerrado). Basta con que una los toque; solo avanzan, nunca regresan. Si confirma después,
le llegan al confirmar. No se puede salir del almacén si en la app faltan artículos por marcar como cargados.

**🆘 SOS (todos, por Telegram):** botón fijo abajo del chat ("🆘 SOS (manda tu ubicación)", también con `/sos`).
Le llega a todo el equipo (Telegram, push y correo a Diana y Víctor) con la ubicación; si quien lo manda tiene un
evento hoy, el evento queda en emergencia. Después puede escribir qué pasa y también le llega a todos.

| Marca | Significa |
| --- | --- |
| ✅ | Confirmó |
| ⏳ | Invitada, todavía no contesta |
| ❌ | No puede |
| ⛔ | Ya confirmó otro evento a esa hora |
| 📵 | No ha activado su Telegram: tocarla da su enlace otra vez |

## Gerente de El Vaso Maíz

> Hay también gerente de **Divanna** (Eden; no ve los eventos que llevan Casa Isabella) y de **Casa Isabella** (Mario; solo los eventos que llevan el salón). Tienen lo mismo que se describe aquí, menos el staff y la producción, que son solo de El Vaso Maíz. En "👷 Asignar" se puede elegir a cualquiera de los tres gerentes; quien quede asignado ve ese evento aunque no sea de su negocio.

- En la app ve **todos** los eventos autorizados de El Vaso Maíz, aunque no se los asignen.
- En cada uno tiene **👷 Asignar**: elige brigada y encargada y toca **Guardar y avisar**. A ellas les llega el
  aviso con **Confirmar** y a Diana y Víctor se les avisa qué asignó.
- Debajo tiene **🧑‍🍳 Staff**: ve a sus chicas con su marca, elige a las que quiere y toca **Invitar por
  Telegram**. Es lo mismo que `/staff`; las respuestas le llegan por Telegram. Dar de alta a una chica nueva
  sigue siendo `/staff` → **Agregar personal**.
- En **Asignar** también elige al **🍳 Encargado de producción**. Dos días antes le llega por Telegram la lista
  de producción del día (para revisar inventario y reportar insumos) y el mismo día otra para confirmar
  ingredientes. Sus respuestas le llegan a la gerente con copia a Diana y Víctor, y se ven en el evento.
- En **Asignar** también elige el **👩‍🍳 Equipo de producción** (1, 2 o más; pueden estar también en el staff). El
  encargado entra solo al equipo. Solo el encargado tiene **🚀 Listo para staff** en la lista del día: al tocarlo,
  al staff confirmado le llegan por Telegram los botones de sus etapas y lo que marquen se ve en el estatus.
- No ve precios ni pagos de los pedidos.

## Comandas en papel y recibos (Diana, Víctor y la gerente)

- **Foto de la comanda:** mientras se acostumbran a la app, pueden seguir llenando la comanda a mano. Tómenle
  foto y mándenla al bot de Telegram (o en el calendario: **➕ Capturar evento** → **📷 Llenar con la foto de una
  comanda**). DiMa la lee y muestra lo que entendió y lo que no se lee bien. Nada se guarda hasta tocar
  **✅ Guardar evento** (en la app, **Guardar evento**). Si algo está mal, en Telegram contesten **encima** del
  borrador con la corrección ("la fecha es el 28").
- En Telegram no hace falta decir cómo se pagó el anticipo: el evento se guarda y el anticipo queda anotado
  para registrarlo en la app con **💵 Registrar pago** (ahí sale el recibo).
- **Mantel:** en la comanda, el espacio de "Mantel" lleva el **tipo y el color** (ej. "básico beige",
  "lentejuela dorado"), no la cantidad: los manteles salen de las mesas (uno por mesa). Si ahí solo va un
  número, DiMa avisa que falta el tipo y el color.
- **Manteles en la app:** cada mesa trae su mantel básico. En "🧺 Mantel" se pone cada tipo (básico,
  lentejuela o corrugado) con su color y cantidad; al poner las mesas sale solo el básico con la cantidad de mesas. El precio se calcula solo y sale desglosado en el recibo.
- **Pedido escrito:** en Telegram, `/comanda` y el pedido en el mismo mensaje; en la app, "📝 Llenar con el pedido
  escrito". Si falta algo (tipo y color del mantel, color de los cerezos, temática de los personalizados…), DiMa
  pregunta y no deja guardar hasta que se conteste.
- La gerente solo puede capturar comandas de El Vaso Maíz.
- **Recibo:** cuando se registra un anticipo o un pago, a Diana y Víctor (y a la gerente si es de El Vaso Maíz)
  les llega por Telegram el recibo en PDF para reenviárselo al cliente. También se pide cuando quieran con
  **🧾 Mandar recibo** en el evento del calendario.

## Cambios que pide el cliente

- Cuando un cliente cambia su pedido, a Diana y Víctor (y a la gerente si es de El Vaso Maíz) les suena la app
  y les llega Telegram. Si el pedido ya estaba autorizado, Diana lo revisa y toca **Confirmar cambio** o
  **Descartar** en el dashboard.
- Al confirmarse, al equipo del evento le llega "🔄 Cambió el pedido" con lo nuevo y el botón **Confirmar**; en
  la app sale el aviso y lo que hay que llevar ya está actualizado. Hay que volver a tocar **Enterado**.
- Los cambios se piden con 24 horas de anticipación; si faltan menos, llegan marcados como **URGENTE**.

## Reporte financiero del día

- **Gastos (todo el equipo, aunque ese día no haya eventos):** lo más fácil es mandar la **foto del ticket al bot de Telegram**: DiMa lee el total y lo anota en el reporte del día con dinero del negocio; **👛 Lo pagué yo** si fue con dinero propio (se reembolsa), **🗑️ Borrar** si se equivocó. También `/gasto 350 gasolina` (con botón **📷 Agregar foto del ticket** para mandarla después). Si se anotó sin foto (Telegram o app), **`/ticket`** muestra los gastos propios sin foto de los últimos 14 días: se toca uno y se responde con la foto. Diana y los gerentes ponen "gasto" en el pie de la foto (sin eso se lee como comanda). Si no hubo eventos ese día, el reporte le llega solo a Diana.
- En la app: el líder de brigada, la encargada, los gerentes y los asistentes tocan **💰** (arriba, junto a salir). Al elegir la foto del ticket, DiMa llena monto, concepto y categoría; se revisa, se elige **dinero del negocio o dinero propio** y se agrega. El asistente solo anota gastos.
- **Cobros:** de qué evento, monto, efectivo / transferencia / depósito y foto del comprobante.
- **Cierre:** efectivo entregado a Diana e insumos que se usaron o sobraron. Luego **Enviar a Diana**.
- Diana lo **aprueba** o **pide aclaración** (llega por Telegram) desde el dashboard; solo lo aprobado cuenta en el balance
  del lunes. Ahí también marca los **reembolsos** hechos. Ángela ve la administración de El Vaso Maíz.

## Daños y faltantes (al recoger)

- El líder, la encargada, la gerente o Diana y Víctor le escriben a DiMa por Telegram: **/daño** + folio + qué pasó
  (ej. `/daño EVT-123 se rompieron 3 copas globo y un mantel quedó manchado`).
- Lo **roto, perdido o que ya no sirve** se cobra completo; el **daño menor** (mancha, rayón) al **10%** del precio de reposición.
- DiMa muestra la cuenta con **✅ Registrar** / **❌ Cancelar**. Al registrar se suma a lo que debe el cliente y Diana queda avisada.
- También en la app: en el evento, **💰 Dinero → Anotar daño o faltante** (con "¿Qué pasó?": completo o daño menor).

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
| `/sos` | Emergencia: deja abajo el botón 🆘 que manda tu ubicación a todo el equipo (todos) |
| `/ayuda` | Lo que puede hacer cada quien |
| `/salir` | Desvincular este Telegram |

| Si pasa esto | Hacer esto |
| --- | --- |
| "Usuario o PIN incorrecto" | Usuario todo junto, sin acentos ni espacios; PIN sin espacios. Si sigue, Víctor lo revisa. |
| Los botones de Telegram no hacen nada | Un Admin escribe `/configurar` en el bot. |
| Una chica no recibe la invitación | Sale con 📵: tocarla y reenviarle su enlace. |
| No suenan las emergencias | **Activar alertas** en la app y permitir notificaciones de DiMa Equipo con sonido, sin "No molestar". |
| No se ve un evento | Revisar con `/eventos`; si no aparece, todavía no está asignado. |
