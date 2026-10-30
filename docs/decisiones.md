# Decisiones del proyecto DiMa OS

Una entrada por decisión. Formato: fecha, decisión, por qué, alternativa descartada.

---

## 2026-10-27 — La app nueva es solo interna

**Decisión:** la app es para el equipo (brigadas, Diana, Víctor). Los clientes siguen pidiendo por la landing y por WhatsApp. *(Actualizada abajo: WhatsApp se eliminó.)*
**Por qué:** es donde está el dolor operativo (alertas, estatus, cobros). El cliente ya tiene un canal que funciona.
**Descartado:** app de clientes (catálogo + cotizador) y hacer ambas a la vez. Se puede retomar después.

## 2026-10-27 — Distribución como PWA

**Decisión:** PWA instalable desde el navegador, sin tiendas.
**Por qué:** ya existe y está instalada en los teléfonos de las brigadas, se actualiza sola con cada deploy y no cuesta cuentas de desarrollador (Apple ~$99 USD/año, Google $25 USD).
**Descartado:** app nativa con Expo/React Native. Su ventaja real es el push confiable en iPhone; se cubre con Fase 3.

## 2026-10-27 — La app unificada vive en `/brigadas/`

**Decisión:** evolucionar la PWA actual en vez de crear `/app/`.
**Por qué:** cambiar scope o `start_url` rompe las instalaciones existentes.
**Descartado:** ruta nueva con redirección. Implica que cada brigada reinstale.

## 2026-10-27 — Seguridad antes de funciones nuevas

**Decisión:** Fase 0 (sesión con token firmado, validación en los POST, escape de fórmulas, CORS restringido) va primero.
**Por qué:** `POST /api/brigada-estatus` hoy no valida nada y dispara WhatsApp masivo; agregar más alertas sobre eso amplía el riesgo.

## 2026-10-27 — Alertas de cliente difícil y semáforo Rojo

**Decisión:** dos alertas nuevas hacia Diana y Víctor (originalmente por WhatsApp; ahora por correo y dashboard): una manual desde la app de brigadas y una automática cuando el semáforo pase a Rojo, sin importar si es antes, durante o después del evento.
**Contexto:** evento en El Vaso Maíz con una invitada que no contrató, prepotente con el equipo; los muchachos cedieron un cobro de manteles por presión. Regla acordada: la brigada nunca cede ni cancela un cobro en el momento, escala a Diana.

## CERRADA (ya no aplica) — ¿A qué evento responde Diana cuando hay varias alertas pendientes?

Sin WhatsApp, Diana responde desde el dashboard sobre la tarjeta de cada evento, así que el folio siempre es explícito. Se conserva el texto original:

Cuando Diana contesta por WhatsApp, DiMa reenvía su instrucción a la brigada que reportó. Si hay dos eventos con alerta activa a la vez:
- **(a)** Diana menciona el folio en su respuesta cuando hay más de una pendiente. Más seguro.
- **(b)** Se asume la alerta más reciente. Más simple, riesgoso si coinciden dos eventos el mismo día.

Recomendación: (a), con una excepción: si solo hay una alerta pendiente no se pide folio. **Víctor debe elegir antes de la Fase 2.**

## 2026-10-27 — Se elimina WhatsApp; pedidos solo por la landing

**Decisión:** quitar todo lo de WhatsApp/Twilio (bot DiMa en `api/whatsapp.js`, alertas, balance, CTAs `wa.me`). Los clientes piden con un formulario en la landing (`api/pedido.js`) que crea el EVENTO con `Autorizacion_Diana` = Pendiente; Diana pone monto y checklist y autoriza o rechaza desde el dashboard.
**Avisos:** por correo (Gmail ya conectado, destinatarios en `EMAILS_EQUIPO`) y dentro de las apps: pedidos y balance en el dashboard, emergencias y alertas de seguridad de otras brigadas en la app de brigadas.
**Por qué:** el número propio de WhatsApp seguía atorado (Twilio error 22300, sandbox), la landing mandaba a los clientes al número personal de Diana, y las plantillas aprobadas complicaban cada aviso nuevo.
**Se pierde:** el estimado automático con IA (Diana cotiza a mano), el aviso instantáneo al celular (el correo es menos inmediato; las brigadas solo ven alertas ajenas al abrir o refrescar la app, lo cubre Fase 3) y el mensaje automático al cliente en alertas de seguridad (la app se lo muestra a la brigada para que llame).
**Descartado:** formulario + estimado con IA (se puede agregar después sin cambiar el flujo) y Web Push inmediato (más trabajo; queda en Fase 3).

## 2026-10-27 — DiMa vuelve como chat en la landing; app con roles y PIN

**Decisión:** el botón de la landing dice "Haz aquí tu cotización" y abre un chat con DiMa (`api/dima-chat.js`). DiMa platica, da un estimado con el catálogo y registra el pedido con `Monto_Estimado_IA`; Diana lo confirma en el dashboard (opción a). La app del equipo pide usuario + PIN (tabla COLABORADORES) y muestra la vista según el rol: Admin, Líder de brigada, Asistente y Encargada de evento (El Vaso Maíz, asignada por evento en `EVENTOS.Encargada`). Se distribuye como APK (TWA de la PWA), porque todo el equipo usa Android.
**Por qué:** Víctor quiere la experiencia de DiMa sin depender de WhatsApp, y que cada colaborador vea solo lo que le corresponde. La sesión firmada cierra los hallazgos de seguridad de la Fase 0.
**Detalles:** modelo `claude-opus-5-5` con esfuerzo bajo (chat corto) y respaldo automático ante rechazos; el historial vive en el navegador y se limita a 40 mensajes; los datos de pago ya no están en el prompt. Admin usa `dashboard.html` con la misma sesión. El formulario queda como respaldo si el chat falla.
**Descartado:** app nativa (el APK de la PWA cubre Android y se actualiza solo con cada deploy); login solo con PIN (con usuario + PIN cuesta mucho más adivinar un acceso); guardar la conversación en el servidor (más costo y complejidad; se guarda en `Notas` al registrar el pedido).

## 2026-10-27 — DiMa con Sonnet 5.5, chat acotado y emergencias con push

**Decisión:** el chat usa `claude-sonnet-5-5` (esfuerzo bajo) en vez de Opus 5.5. La plática se acota con cortesía: desde el mensaje 14 del cliente DiMa recibe la instrucción de ir cerrando (repaso, datos, registrar); pasado el 20 se despide y ofrece el formulario; además, freno por IP (2 s entre mensajes, 40 cada 30 min). Las emergencias y alertas de seguridad llegan como notificación push con sonido y vibración aunque la app esté cerrada, y suenan/vibran también con la app abierta.
**Por qué:** pedido de Víctor: bajar costo del chat público sin cortar feo al cliente, y que una emergencia no dependa de que alguien abra la app o el correo.
**Descartado:** límite duro sin aviso (corta al cliente a media cotización); captcha desde el inicio (fricción para clientes reales; queda como opción si hay abuso); límite por IP en Airtable (una escritura por mensaje, más lento y caro).

## 2026-10-27 — Bot de Telegram para el equipo

**Decisión:** bot interno de Telegram (no para clientes). Cada colaborador lo vincula por chat privado con su usuario y PIN de la app; el bot respeta el rol. Emergencias y alertas de seguridad a todo el equipo (menos quien reporta); pedidos nuevos, cambios de pedido y balance solo a Admin. Consultas por comando (`/hoy`, `/eventos`, `/alertas`, `/pedidos`). Las acciones (checklist, estatus) siguen en la app.
**Por qué:** pedido de Víctor; Telegram es gratis, no requiere aprobación de plantillas como WhatsApp y es un canal más para que una emergencia no pase desapercibida.
**Descartado:** grupo de Telegram para todo el equipo (no respeta roles: un asistente vería pedidos y montos); responder con IA en lenguaje libre (más costo; se puede agregar después sobre los mismos comandos); hacer acciones desde Telegram (duplicaría la app y sus permisos).

## 2026-10-27 — Cobertura fuera de la ciudad e instrucciones para el equipo

**Contexto:** en una prueba, un cliente pidió un evento en San Pedro, Navolato y DiMa lo trató como si fuera en Culiacán.
**Decisión:** DiMa distingue la ciudad de Culiacán de todo lo demás (sindicaturas, Navolato, playas, otros municipios). Fuera de la ciudad no confirma cobertura ni inventa costo de traslado: avisa al cliente que Diana lo confirma y marca el pedido `Fuera_De_Ciudad`, que se resalta en el dashboard, el correo y Telegram. El formulario pregunta si el evento es dentro de la ciudad.
Nuevo campo `Instrucciones_Equipo` por evento: DiMa guarda lo que el cliente indique (horario, acceso, referencias) y Diana agrega o corrige desde el dashboard; al guardar se avisa por push y Telegram solo al equipo asignado. La brigada lo ve en la app y en `/hoy`.
**Descartado:** cálculo automático de distancia/costo de traslado (requiere mapas y tarifas que aún no existen; Diana lo decide caso por caso); chat libre entre Diana y la brigada (las instrucciones por evento cubren el caso sin otra herramienta).

## 2026-10-27 — Ubicación GPS en las alertas y confirmación a quien reporta

**Decisión:** emergencias y alertas de seguridad llevan el GPS del teléfono que reporta: link a Google Maps en Telegram, push y correo, y pin de ubicación en Telegram. Mientras la alerta siga activa y la app esté abierta, la ubicación se actualiza cada minuto (sin avisos nuevos) y el dashboard, la app y `/alertas` muestran la última. Quien reporta recibe en Telegram "✅ Tu alerta se envió" con a cuántos llegó.
**Por qué:** Víctor probó una emergencia y no la vio en su Telegram (el sistema no le avisa a quien reporta); además pidió la ubicación en tiempo real para poder ir a ayudar.
**Límite:** una app web no puede seguir mandando la ubicación con la pantalla apagada; el seguimiento continuo requiere la app abierta. La ubicación inicial siempre va si hay permiso.
**Descartado:** "ubicación en tiempo real" nativa de Telegram (la comparte la persona desde su Telegram, no la app); app nativa con GPS en segundo plano (otro proyecto completo).

## 2026-10-27 — DiMa: explicar eventos foráneos, venta cruzada y agregar a un pedido existente

**Contexto (prueba de Víctor):** DiMa no le explicó al cliente que un evento foráneo se valida, no ofreció mobiliario y decoración, y el cliente no tenía cómo agregar cosas a su pedido después.
**Decisión:**
- Foráneos: DiMa debe explicar, en el mismo mensaje en que se entera, que se validan (traslado del equipo ese día, distancia, costo de traslado) y repetirlo en el repaso. Además el servidor detecta nombres de lugares fuera de la ciudad en lo que escribe el cliente y le recuerda a DiMa explicarlo.
- Venta cruzada obligatoria, una vez y antes de pedir datos: Vaso Maíz ↔ mobiliario y decoración de Divanna.
- Cuadro "¿Ya tienes número de pedido?" en la landing: folio + teléfono abren el chat sobre ese pedido. Los cambios se guardan en el evento (Notas e Instrucciones_Equipo) y se avisa a Diana.
- Seguridad: el chat solo acepta cambios con folio firmado por el servidor (HMAC), o verificado con el teléfono del cliente; un folio inventado se ignora.
**Descartado:** reescribir el pedido automáticamente (servicios/monto) con lo que pide el cliente: Diana sigue confirmando cualquier cambio de cotización.

## 2026-10-27 — Diana responde al cliente a través de DiMa; preferencia de contacto

**Decisión:** en los foráneos DiMa pregunta si el cliente quiere esperar la respuesta en el chat o prefiere mensaje o llamada (`Preferencia_Contacto`, visible en dashboard, correo y Telegram). Diana escribe en el dashboard un "Mensaje para el cliente"; DiMa se lo entrega tal cual: si el cliente sigue con el chat abierto aparece solo (revisión cada 30 s sin costo de IA) y si regresa después con su número de pedido, DiMa se lo da al inicio. Se marca como entregado para no repetirlo.
**Por qué:** pedido de Víctor tras probar un foráneo: el cliente se quedaba sin saber si esperar, y Diana no tenía cómo contestarle por el mismo canal.
**Descartado:** mandar el mensaje al cliente por SMS o WhatsApp (se quitó WhatsApp y SMS cuesta y requiere proveedor; si el cliente prefiere mensaje o llamada, Diana lo contacta directo con el teléfono del pedido).

## 2026-10-27 — Aproximado de traslado para eventos foráneos

**Regla de Víctor:** se mide desde la salida de Culiacán; ~$10 por km, ida y vuelta, en dos ocasiones (llevar y regresar, recoger y regresar) => km x $10 x 4.
**Decisión:** herramienta `estimar_traslado` que DiMa usa solo cuando el cliente pregunta por el traslado. Geocodifica el destino y traza la ruta con OpenStreetMap (gratis, sin llave) y cuenta solo los km desde que la ruta sale del límite oficial de Culiacán Rosales. DiMa lo presenta como estimado y aclara que la cotización final la confirma el equipo de logística.
**Pendiente:** Víctor compara algunos destinos con Google. Prueba inicial: San Pedro 4 km (el límite oficial llega casi a Aguaruto), Navolato 19, Imala 21, Costa Rica 25, Altata 47, Eldorado 54.
**Descartado (por ahora):** Google Maps Distance Matrix (requiere llave y facturación; se puede cambiar después sin tocar el chat); que DiMa calcule distancias de memoria (poco confiable).

## 2026-10-27 — Límite de servicio: 35 km desde la salida de Culiacán

**Decisión (Víctor):** por ahora no se da servicio a más de 35 km, por seguridad del equipo y por costos. DiMa revisa la distancia en cuanto el evento es foráneo y, si pasa el límite, lo explica con amabilidad y no registra el pedido. El servidor lo vuelve a verificar al registrar (chat y formulario). La página lo dice en "Zona de cobertura".
**Detalle:** si el mapa no responde, el pedido se registra y logística valida la distancia (no se pierde un cliente por una falla técnica).

## 2026-10-28 — Precios: paquetes primero

**Contexto (prueba de Víctor):** para 100 personas con sillas Antonella, mantelería y cristalería DiMa sumó piezas sueltas ($5,700 de mesas/sillas + cristalería aparte) en lugar de usar el paquete de 50 personas Antonella ($5,400, que ya incluye mantel, plato, copa, servilletas, cubiertos y personalizados).
**Decisión:** cuando lo pedido coincide con un paquete, DiMa cotiza con paquetes completos y los combina (50 + 20) para llegar a los invitados; solo suma piezas sueltas para lo que el paquete no trae. Ejemplo en el prompt: 100 personas Antonella = 2 x $5,400 = $10,800 + extras.
**Abierto:** el catálogo dice que los paquetes son fijos "excepto diciembre"; falta que Víctor diga cómo se cotiza en diciembre.

## 2026-10-28 — Temporada alta de fin de año

**Decisión (Víctor):** una semana antes de Navidad y hasta entrando el año los precios suben 70% y no se manejan paquetes regulares; el aumento se justifica con sutileza por la demanda de trabajo.
**Cómo quedó:** del 18 de diciembre al 1 de enero según la fecha del evento (`api/_temporada.js`); aplica a Divanna y a El Vaso Maíz. DiMa cotiza por pieza x 1.7 y lo explica como "tarifa de temporada". Recordatorio automático si el cliente menciona fechas de temporada; pedidos marcados en Notas, correo, Telegram y dashboard.
**Confirmado:** sube todo, Divanna y El Vaso Maíz. Termina el 1 de enero inclusive. El traslado no sube: se mantiene km x $10 x 4. Las promociones de diciembre llegan en carpetas aparte.

## 2026-10-28 — Agenda e inventario, fase 1: hora y productos estructurados

**Contexto:** Víctor quiere saber en segundos si un evento se puede agendar: El Vaso Maíz depende del personal (6 equipos de 2, más eventuales: 8 a 12 personas por semana) y Divanna del mobiliario disponible. Hasta hoy EVENTOS solo tenía la fecha y lo pedido era texto libre.
**Datos de Víctor:** 3 a 4 minutos por pieza de El Vaso Maíz (ya con montaje); el mobiliario regresa a más tardar a la 1 pm del día siguiente; los manteles tardan 2 días más (lavado); proveedores aliados: ~10% menos que nuestro precio publicado, pedir con 48 h mínimo (ideal una semana); no hay caja chica.
**Decisión:**
- EVENTOS guarda `Hora_Inicio`, `Horas_Servicio` y `Productos` (JSON con claves del catálogo), más lo calculado: `Piezas_Vaso_Maiz`, `Personal_Requerido`, `Resumen_Capacidad`. DiMa pregunta la hora y manda los productos con clave; Diana los ajusta en el dashboard.
- Personal: piezas x 4 min / (horas x 60), redondeado hacia arriba, mínimo un equipo de 2. Se muestra también con 3 min ("3 a 4 personas").
- `INVENTARIO.Categoria` agrupa los artículos (todas las Tiffany, todos los manteles, etc.). Antonella grande y chica cuentan juntas: solo cambia el óvalo del respaldo y se mezclan de 10 en 10 por mesa.
- **Modelo, color y cantidad exactos (Víctor):** generalizar las copas es lo que causa confusión y atrasos. Copa globo y copa francesa son categorías distintas y, en todo lo que tiene más de un artículo en INVENTARIO (copas, manteles, platos base, Tiffany de fierro o plástico), Diana asigna en el dashboard los artículos exactos (`EVENTOS.Articulos`). El dashboard avisa lo que falta asignar ("🎨 Falta asignar modelo y color: 100 Copa") y la brigada ve en la app "📦 Cargar exacto". DiMa anota en la nota el modelo y color que eligió el cliente.
- Ocupación: el mobiliario de Divanna sale en una ruta de logística (2 o 3 pedidos por ruta), así que queda ocupado todo el día del evento y regresa a bodega a más tardar a la 1 pm del día siguiente; manteles y servilletas 48 h más de lavado desde que llegan a bodega; Casa Isabella solo las horas del evento (1 unidad en INVENTARIO). El equipo de El Vaso Maíz sale 30 min antes del evento.
**Por qué:** sin hora no hay choques que detectar y sin productos estructurados no se puede contar nada. Es la base de la fase 2 (semáforo de disponibilidad).
**Descartado:** tablas PRODUCTOS/COMPONENTES/EVENTO_ITEMS en Airtable. El catálogo vive en `api/_productos.js` igual que los precios (`_dima-catalogo.js`), y los productos del evento van en un campo JSON para que la disponibilidad de un rango de fechas salga de una sola consulta a Airtable.
**Confirmado por Víctor:** 1 pm del día siguiente; lavado de 48 h desde la recepción en bodega; El Vaso Maíz sale 30 min antes. Sin hora registrada se supone que el evento empieza a las 2 pm.
**Pendiente para fase 2:** las rutas de Divanna (cuántos pedidos caben en una ruta y por brigada) y el personal disponible por día.

## 2026-10-28 — Agenda, fase 2: semáforo de disponibilidad y respuesta en 12 h

**Decisión (Víctor):** automatizar la revisión de agenda para que Diana vea de inmediato si un pedido está en verde, y que DiMa le diga al cliente que ya están todos los datos y que se le confirma en un lapso no mayor a 12 horas.
**Cómo quedó:**
- Al registrar un pedido (chat o formulario) se calcula el semáforo contra los eventos autorizados que se traslapan y se guarda en `EVENTOS.Disponibilidad` y `Disponibilidad_Detalle`; va al inicio del aviso de Telegram y del correo, con la hora límite para confirmar al cliente. El dashboard lo recalcula en cada carga (cambia si Diana autoriza otro pedido) y muestra el plazo de 12 h o si ya se venció.
- Divanna: piezas por categoría y por artículo exacto contra INVENTARIO, con las ventanas de ocupación de la fase 1; Casa Isabella; más de 9 entregas el mismo día (3 brigadas x 3 pedidos por ruta) es amarillo.
- El Vaso Maíz: pico de personas y equipos ocupados en el horario del evento contra el cupo del día (`PERSONAL_DIA`, 12 si no hay renglón) y los 6 equipos.
- Rojo solo cuando no hay salida: Casa Isabella ocupada, faltan piezas y quedan menos de 48 h para pedirlas a un proveedor, o no queda ni un equipo de El Vaso Maíz.
**Decidido sin respuesta explícita (recomendación aceptada al pedir "vamos a hacerlo"):** cupo base 12 personas; solo los autorizados apartan (los pendientes se avisan como competencia); en rojo DiMa registra igual y Diana decide.
**Descartado:** que DiMa vea el semáforo y le diga algo distinto al cliente (puede equivocarse con datos incompletos y el cliente ya tiene una respuesta clara: 12 h); que los pendientes aparten inventario (un pedido que nunca se paga bloquearía fechas).
**Límite actual:** mientras falten conteos en INVENTARIO (cubiertos, servilletas, decoración), los paquetes salen en amarillo "sin conteo". Los eventos autorizados sin productos registrados también piden revisión a mano.

## 2026-10-28 — Staff de El Vaso Maíz por Telegram (`/staff`)

**Decisión (Víctor):** subequipos: las chicas que trabajan bajo la dirección de Ángela. Todo por Telegram: Ángela escribe `/staff`, elige el evento, elige cuántas y cuáles chicas, y a cada una le llega "Hola Isabella, Ángela te programó un evento … porfa confírmame si puedes acudir".
**Cómo quedó:** Rol nuevo "Staff" (solo Telegram; la app les responde 403) y campo `Coordinadora` en COLABORADORES; tabla STAFF_EVENTO con el estado de cada invitación (Invitada, Confirmó, No puede). Botones de Telegram (inline keyboard) para elegir y para contestar; la selección viaja en el propio botón, sin guardar estado. No se puede invitar a quien ya confirmó otro evento a la misma hora ni a quien no ha vinculado Telegram. Las chicas no ven montos ni datos de pago. El dashboard muestra por evento cuántas confirmaron de las que se necesitan.
**Requisito técnico:** el webhook tenía `allowed_updates: ["message"]`; los botones necesitan `callback_query`. Comando `/configurar` (Admin) lo vuelve a registrar con las variables de Vercel, sin pasos manuales.
**Descartado:** grupo de Telegram con todas las chicas (todas verían todo y no hay confirmación individual); que Ángela escriba los nombres a mano (errores de dedo; los botones evitan elegir a alguien ocupado).
**Permiso (Víctor):** `/staff` solo para Ángela, Diana y Víctor: Admin o la casilla `COLABORADORES.Coordina_Staff` (solo Ángela). La invitación pide confirmar para llegar antes (con la hora de salida) y preparar todo para el evento.
**Alta simplificada (Víctor):** `/staff` tiene dos botones: **Agregar** (nombre y teléfono) y **Asignar** (lista del personal agregado). Las chicas no llevan usuario, PIN ni código: el bot da un enlace personal firmado (HMAC con `SESSION_SECRET`) y con un toque en "Iniciar" queda vinculado su Telegram. Límite de Telegram: un bot no puede escribirle primero a nadie ni buscarlo por teléfono.
**Pendiente:** el reparto equitativo automático (sugerir a quién invitar según su carga) y la disponibilidad que cada chica marque por día, de la propuesta de logística.

## 2026-10-28 — Gerente de El Vaso Maíz, DiMa para el equipo, curso y mensajes directos

**Decisión (Víctor):** Ángela es la gerente de El Vaso Maíz; hay que darle su lugar, capacitarla por Telegram hasta que domine la plataforma, darle un canal exclusivo con DiMa desde su app y que pueda mandarles mensajes directos a Diana y Víctor.
**Cómo quedó (las cuatro opciones recomendadas):**
- Casilla `COLABORADORES.Gerente_Vaso_Maiz` (no un rol nuevo, para no tocar las listas de permisos de cada endpoint): ve y opera todos los eventos autorizados de El Vaso Maíz (negocio o piezas de El Vaso Maíz) aunque no se los asignen, y desde su app asigna brigada y encargada solo en esos eventos (se avisa a los Admin). Sin dashboard, precios ni pagos.
- DiMa interna (`api/_dima-equipo.js`): en la app ("💬 Pregúntale a DiMa", `POST /api/dima-chat` con `modo: "equipo"`, sin función nueva) y en Telegram (mensaje sin comando). Solo gerente y Admin. Conoce el manual de su rol y sus próximos eventos, sin montos; no hace cambios. Límite de 60 preguntas al día por persona (en memoria).
- `/curso`: 6 lecciones para la gerente (4 a 6 según el rol), cada una con práctica y pregunta de opción múltiple; avance en `COLABORADORES.Curso_Avance` y aviso a los Admin por lección. Admin ve el avance y le manda a cada quien su lección.
- `/mensaje`: ida y vuelta por el bot con "↩️ Responder"; el otro Admin recibe copia. El staff no lo usa (habla con su coordinadora).
**Descartado:** rol "Gerente" nuevo (había que agregarlo en cada `requerirSesion`); que la gerente entre al dashboard (tiene precios, pagos y datos de clientes); guardar la plática de DiMa en Airtable (costo y datos; en Telegram el contexto es el mensaje al que se contesta).

## 2026-10-29 — Encargado de producción de El Vaso Maíz

**Decisión (Víctor):** habrá un encargado de producción; la gerente lo designa y por Telegram le llega la lista de producción dos días antes ("verifica el inventario y repórtame las necesidades de insumos") y el mismo día ("confirma si tenemos todos los ingredientes").
**Cómo quedó (opciones elegidas por Víctor):** uno por evento (`EVENTOS.Encargado_Produccion`, se elige en "Asignar" de la app de la gerente); si tiene dos eventos el mismo día le llega un solo mensaje. Cron diario a las 8:00 de Culiacán (`api/produccion-diaria.js`). Las respuestas ("Tenemos todo" / "Reportar insumos" con texto) le llegan a la gerente con copia a Diana y Víctor y quedan en `Produccion_Respuesta`. Puede ser encargado: el staff de la gerente, las encargadas de evento o la gerente.
**Lista de producción:** los paquetes se desglosan con el catálogo real (`PRODUCTOS[].contenido` en `_productos.js`, igual a `_dima-catalogo.js`; si cambia un paquete hay que cambiar ambos). La "pieza suelta" sin desglose sale con su nota tal cual; sin nota, dice que se pregunte a la gerente (no se adivina). Sin montos.
**Descartado:** un encargado fijo para todos los eventos (Víctor prefirió por evento); un cron por cada aviso (el plan Hobby corre crons una vez al día, así que uno solo manda los dos tipos); una función nueva para las respuestas (van por el webhook de Telegram existente).
**Pendiente:** Diana no elige al encargado desde el dashboard (solo la gerente desde la app); confirmar que `CRON_SECRET` existe en Vercel (si no, el endpoint queda abierto, aunque no repite avisos).

## 2026-10-29 — La gerente invita staff desde la app

**Decisión (Víctor):** Ángela, además de asignar brigada, asigna staff desde su app. Caja "🧑‍🍳 Staff" en cada evento autorizado de El Vaso Maíz, con el mismo código que `/staff` (`estadosChicas` / `invitarChicas` en `_staff.js`). El alta de chicas nuevas sigue por `/staff` (necesita el enlace de Telegram). Sin función nueva (`invitar_staff` en `dashboard-eventos`).

## 2026-10-29 — Cambios de pedido visibles y avisados; regla de 24 horas

**Problema (prueba de Víctor):** un cliente cambió su pedido desde la página; llegó el Telegram a los Admin pero no sonó la app (no había push), el cambio solo quedaba al final de Notas (no se veía en el dashboard ni en la app, y `Servicios_Solicitados` seguía con lo viejo) y nadie del equipo se enteraba. Además, si guardar fallaba, DiMa igual decía "listo".
**Decisión (Víctor, opciones recomendadas):** al momento se avisa a Diana, Víctor y la gerente (si es de El Vaso Maíz) por app (push) y Telegram; el equipo del evento se entera cuando Diana confirma el cambio en el dashboard. Los cambios se piden con 24 h de anticipación: con menos, DiMa le dice al cliente que no se puede garantizar y lo pasa como URGENTE (no se rechaza).
**Cómo quedó:** `EVENTOS.Cambio_Cliente` (JSON con estado aplicado/pendiente/confirmado/descartado, lo de antes y lo nuevo). Pedido sin cotizar: se aplica directo. Pedido autorizado: pendiente → Confirmar (aplica servicios, hora, productos e indicaciones, borra Enterado, avisa al equipo con Confirmar y reenvía la producción si ya se había mandado) o Descartar (Diana se lo explica al cliente con "Mensaje para el cliente"). El monto nunca va a la app del equipo.
**Descartado:** avisar a todo el equipo en cuanto el cliente lo pide (podrían preparar algo no aprobado); rechazar los cambios con menos de 24 h (Víctor prefiere que la gerencia decida).
**Pendiente:** al confirmar no se recalculan los artículos exactos (`EVENTOS.Articulos`) ni el monto: Diana los ajusta a mano.

## 2026-10-29 — Diana tiene todas las funciones de la gerente

**Decisión (Víctor):** "Diana es la jefa de todo": todo lo que puede hacer Ángela lo puede hacer Diana. Como Admin ya asignaba brigada y encargada, recibía las respuestas de producción y los cambios de pedido; faltaban en su dashboard invitar staff por evento (antes solo por /staff), elegir al encargado de producción y "Pregúntale a DiMa" (antes solo en Telegram). Se agregaron con el mismo código que usa la app de la gerente; Diana ve a todo el staff, no solo al de una coordinadora.

## 2026-10-29 — Reporte financiero del día (fase 3)

**Decisión (Víctor):** cada brigada hace su reporte **al final del día** en la app: gastos con foto del ticket y si se pagaron con **dinero del negocio o propio** (el propio queda como reembolso pendiente), cobros recibidos (con comprobante), efectivo entregado a Diana e insumos usados o sobrantes. **Diana aprueba** cada reporte o pide aclaración; solo lo aprobado cuenta en el balance. Diana y Víctor ven todo; **Ángela ve la administración completa de El Vaso Maíz** (de un reporte con los dos negocios, solo lo suyo) y no aprueba.
**Cómo quedó:** tablas REPORTES_DIA y COBROS; GASTOS (que ya existía y estaba vacía) ganó Reporte, Pagado_Con, Reembolsado y Reportado_Por. Lo hacen el líder de brigada y la encargada (no el asistente). Se puede reportar hoy o ayer. Fotos reducidas en el teléfono y subidas con la API de contenido de Airtable. El balance semanal ahora separa gastos aprobados, cobros reales, efectivo entregado, reembolsos pendientes y lo que falta aprobar, y avisa si no pudo leer algo (antes un fallo daba $0 en silencio).
**Costo:** `api/finanzas.js` usa la última función del plan Hobby (12 de 12).
**Pendiente:** recordatorio automático en la noche a quien no haya enviado su reporte; los insumos son texto libre (no descuentan inventario).

## 2026-10-29 — Dashboard de Diana más claro, historial por empresa y temporadas con DiMa

**Decisión (Víctor):** el dashboard de Diana debe ser más amigable y claro: letra más grande, gastos en rojo y en negritas, saldo a favor en azul y en negritas, y una gráfica del balance con historial mensual de las dos empresas; si Diana le pide un balance a DiMa, que le diga las mejores temporadas de cada una.
**Cómo quedó:** letra del dashboard +12.5%; montos que salen en rojo (`--gasto`) y lo que entra en azul (`--favor`), en negritas; el balance semanal como tres cifras grandes (ingresos, gastos, saldo a favor/en contra). Gráfica "Cómo van las empresas, mes por mes" (`GET /api/finanzas?vista=historial`, solo Admin, sin función nueva): Divanna azul `#3987e5` y El Vaso Maíz naranja `#d95926` (validados para daltonismo), una sola escala, selector ingresos/gastos/utilidad/eventos/cobrado, detalle al pasar el mouse, tabla y los 3 mejores meses de cada empresa. DiMa (solo con Admin) recibe el historial y puede hablar de dinero; con menos de 12 meses dice que es lo que se ve hasta ahora, no una temporada que se repite.
**Definiciones:** "ingresos contratados" = monto de eventos autorizados por mes del evento (lo pactado, no lo cobrado); gastos = capturados a mano o de reportes aprobados; cobrado = cobros de reportes aprobados. Eventos sin negocio definido no se adivinan: se cuentan aparte.

## 2026-10-29 — Calendario del equipo y Google Calendar controlado por DiMa

**Decisión (Víctor):** terminar Google Calendar para que DiMa lo controle; que todos vean el calendario en su app y solo Diana, Ángela y Víctor lo modifiquen. Opciones elegidas: todos ven todo (sin montos); Ángela solo modifica El Vaso Maíz; se puede mover fecha y hora, cambiar horas de servicio, cancelar y bloquear días.
**Cómo quedó:** calendario mensual propio en la app y el dashboard (no un Google embebido: obligaría a hacer público el calendario o a dar cuenta de Google a cada brigada). Google es espejo de un solo sentido: lo crea/actualiza/borra la plataforma; lo que se edite en Google no regresa. Cancelar no borra el expediente. Días bloqueados respetados por DiMa y por el servidor (pedidos nuevos).
**Google:** la llave que estaba en Vercel no correspondía a la cuenta de servicio (invalid_grant: account not found) y el calendario no estaba compartido con ella. Se carga la del JSON `dima-os-513103-eb75c647cb3d.json` y `GOOGLE_CALENDAR_ID=divannaeventos@gmail.com`.
**Descartado:** sincronización de dos sentidos con Google (requiere webhooks y otra función de Vercel; ya son 12 de 12).

## 2026-10-29 — "Por cobrar" en el balance

**Decisión (Víctor):** el balance de la semana debe mostrar lo por cobrar, en verde oliva, antes del saldo a favor.
**Cálculo (evento por evento, eventos autorizados de la semana):** Pagado o Liquidado 100% = 0; si hay `Monto_Adeudado`, ese; si no, contratado menos cobros de reportes aprobados. Cancelados no cuentan. Se guarda en `BALANCES.Por_Cobrar` el lunes y el dashboard lo recalcula en vivo (si no puede, muestra el del lunes y lo dice).
**Límite conocido:** los anticipos pagados directo a Diana no están registrados como cobro; en esos eventos sale de más hasta marcarlo pagado o capturar el monto adeudado.

## 2026-10-29 — Cuadre del dinero por excepción

**Decisión (Víctor):** al final todo debe cuadrar y se debe detectar si algo no cuadra; solo Diana y Víctor lo ven; DiMa ayuda a analizar (contratado, abonado, pagado, gasto) y a ver dónde hay fuga y si se mete "dinero bueno al malo". **No un solo libro:** eso es lo que Diana hace hoy y por eso hay fugas (mucha carga). Mejor: cuando un evento cierra incompleto, preguntarle a Diana si le pagaron a ella o dónde quedó el dinero. Ella es la jefa y hace lo que quiera con el dinero, pero debe quedar dónde, cómo y cuándo.
**Cómo quedó (opciones elegidas):** pregunta al día siguiente del evento a las 8:00 (mismo cron de producción, sin función nueva), por Telegram con botones y en el dashboard ("🔍 Cuadre"); los lunes, el efectivo sin destino (depósito, gasto del negocio, retiro personal, sigue en caja). Sus respuestas se registran como cobro recibido por Diana, deuda, descuento o nota. El cuadre arranca el 2026-10-29 (antes no hay cobros registrados). DiMa (Admin) analiza fugas, eventos con pérdida y clientes que deben o cancelan; propone correcciones y las aplica Diana. "Por cobrar" ya descuenta lo pagado a Diana y los descuentos.

## 2026-10-29 — Rediseño visual del equipo (estilo Pulse)

**Decisión (Víctor):** solo apariencia, más amigable para el colaborador: negro puro, tarjetas flotantes, feed vertical, fichas con pestañas, carga animada y tipografía Inter, respetando los colores que ya tenemos y lo hecho para el dashboard de Diana. Sin redes sociales ni fotos de clientes.
**Cómo quedó:** `brigadas/tema.css` (lo cargan app y dashboard al final): fondo `#080707`, tarjetas `#1A1A1A`/`#222222` de 20 px con sombra, títulos `#F8F7F6` en Inter 800, secundarios `#B1A5A3`; esqueletos animados en lugar de "Cargando…"; tarjetas que entran suave y el pedido autorizado se desvanece. En la app, cada evento es una ficha con pestañas Resumen · Cargar (con contador) · Tareas (etapas); Retraso/Emergencia/Seguridad y "Enterado" quedan siempre fuera de las pestañas; el asistente abre en Cargar. Respeta `prefers-reduced-motion`.
**Descartado:** cambiar colores de datos (el rojo de acción #C82D32 chocaba con el de gastos); deslizar para aprobar (se mantiene el botón, más seguro con dinero).

## 2026-10-29 — Aviso de día lleno

**Decisión:** un día está lleno cuando ya no cabe un evento más del negocio: Divanna con 9 entregas autorizadas (3 brigadas x 3 pedidos por ruta, el mismo umbral que pone el semáforo en amarillo); El Vaso Maíz con 6 equipos ocupados o cuando el personal del día ya no alcanza para otro equipo de 2. Solo cuentan los eventos autorizados y no cancelados. Al llenarse (al autorizar, capturar a mano o mover un evento) se avisa por Telegram y push a Diana y Víctor, y a la gerente si es El Vaso Maíz; el calendario lo marca LLENO; DiMa deja de ofrecer ese día y el servidor no registra pedidos nuevos de ese negocio ahí. La captura manual sí lo permite, con advertencia.

**Por qué:** Víctor pidió saber cuándo ya no se pueden agregar más eventos; con bloqueos manuales dependía de que alguien se acordara.

**Descartado:** contar por turnos/horas (más exacto, pero hoy no se sabe cómo se reparten las brigadas en el día; es conservador a propósito) y bloquear también la captura manual (Diana es la jefa y a veces mete uno más con proveedor o personal extra).

## 2026-10-29 — Mensaje al cliente en día lleno y Casa Isabella apartada

**Decisión:** con día lleno DiMa dice "Lamentablemente esa fecha la tenemos llena y ya no podemos cubrir tu evento"; si lo que se pide es Casa Isabella y ya está apartada, "esa fecha ya no está disponible". En los dos casos el servidor ofrece hasta 3 fechas libres a una semana o menos. Casa Isabella se considera ocupada todo el día si hay un evento autorizado con el salón.

**Por qué:** lo pidió Víctor; antes DiMa no sabía si el salón estaba apartado y solo Diana lo veía en el semáforo después de recibir el pedido.

**Descartado:** revisar el salón por horas (podrían caber dos eventos de 5 h en un día, pero se deja conservador como el resto del día lleno). Se usa "tu" en vez de "su" porque DiMa le habla de tú al cliente.

## 2026-10-29 — Google Sheets de pedidos con las plantillas de Diana

**Decisión:** una hoja de Google por negocio, hecha con las plantillas Divanna_Pedidos y VasoMaiz_Pedidos. Por cada evento autorizado DiMa crea una pestaña de recibo (copia de la plantilla, nombre = folio EVT) y un renglón en la lista "Pedidos"; lo actualiza con cada cambio del evento. Solo se usa el folio EVT (se deja la numeración del recibo de papel). Sustituye el renglón que se agregaba en `GOOGLE_SHEET_ID`.

**Por qué:** lo pidió Víctor con las dos plantillas; así los recibos salen solos con los datos de la app.

**Descartado:** solo la lista (el recibo seguiría a mano), PDF (más trabajo y otra ruta; se puede descargar de Sheets), y numeración propia en Sheets o dos números (Víctor eligió solo el folio EVT). En "Ambos" no se reparte el total entre negocios: queda en blanco y Diana lo divide.

**Nota:** la plantilla de El Vaso Maíz restaba `B32-B33` (celdas vacías) en "Resto a pagar"; en las pestañas que crea DiMa se escribe `D32-D33`.

## 2026-10-29 — Recibo en PDF por Telegram y comandas en papel por foto

**Decisión:** (1) Cuando se registra un anticipo o un pago, DiMa actualiza la hoja del negocio y manda la pestaña del recibo en PDF por Telegram a Diana y Víctor (y a la gerente si es de El Vaso Maíz); ellos se la reenvían al cliente. (2) Diana puede seguir llenando comandas a mano: manda la foto al bot o la sube en "➕ Capturar evento"; DiMa la lee con visión, muestra lo leído y las dudas, y solo se guarda al confirmar. La foto queda en el evento. (3) En el chat DiMa pide también nombre completo, dirección exacta y modelo/color de cada producto para que la comanda salga completa.

**Por qué:** lo pidió Víctor: el recibo debe salir en cuanto hay anticipo y Diana necesita tiempo para dejar el papel.

**Descartado:** mandar el recibo directo al cliente (no hay WhatsApp ni canal al cliente; lo reenvía el equipo), imagen en vez de PDF (el PDF sale directo de Sheets, sin librerías), y guardar la comanda sin confirmar (la letra a mano se lee mal a veces; un error crea un evento falso).

## 2026-10-30 — Dinero del evento en la ficha de la app, daños y faltantes

**Decisión:** en la app del equipo cada evento se ve primero como una ficha corta (negocio, folio, lugar, hora, cliente y lo que falta por cobrar) y al tocarla se abre todo. Una pestaña "💰 Dinero" muestra contratado, daños y faltantes, descuento, pagado y lo que falta, con el nombre y teléfono del cliente. Desde ahí se registra el cobro (anticipo, abono o liquidación) y se anotan daños o faltantes, que se suman al total al momento con `INVENTARIO.Precio_Reposicion` (si el artículo no tiene precio, quien lo anota escribe el monto y queda marcado para que Diana lo revise). Lo ven líder, encargada y gerente; el asistente y el staff no. El cobro de la brigada entra a su reporte del día (Diana lo aprueba al recibir el dinero); el de Diana o Víctor queda como pago a Diana con recibo por Telegram. Los cargos se guardan en `EVENTOS.Cargos_Extra` (JSON) y `Cargos_Extra_Total`, que se suma a lo contratado en el cuadre y en el recibo. Cada cargo avisa a los Admin por Telegram; lo quita Diana o quien lo anotó.

**Por qué:** lo pidió Víctor: las brigadas entregan y cobran en efectivo en el momento, y deben poder marcar el pago y cobrar los daños sin llamar a Diana. Cambia la regla anterior de "la gerente sin precios ni pagos".

**Descartado:** que el encargado escriba siempre el monto del daño (cada quien cobraría distinto), que el cobro cuente directo sin pasar por el reporte del día (Diana perdería el control del efectivo) y que también lo vea el asistente.

## 2026-10-30 — Comanda por foto: forma de pago sin null

**Decisión:** `forma_anticipo` en la herramienta `datos_comanda` es una lista de texto con "No se sabe" en vez de `['string', 'null']` con `null` en el enum.

**Por qué:** la API de Claude rechaza ese esquema (error 400): la foto de la comanda fallaba siempre, en la app ("Error interno") y en Telegram. Hay una prueba que revisa que ningún enum lleve null.

## 2026-10-30 — Homepage nuevo inspirado en DuoFankaar

**Decisión:** titular editorial grande, cinta de fotos en dos filas, servicios numerados (mobiliario, snacks, Casa Isabella, DiMa), paquetes con precio "desde", galería real, preguntas frecuentes y botón flotante "Cotiza con DiMa" en el celular. Las fotos salen de `referencias/` recortadas sin texto ni teléfonos (`img/home/`, 19–77 KB cada una); no se usan los volantes con WhatsApp ni la foto con el nombre de un niño. Los botones de cada paquete abren el chat con la pregunta escrita (no se envía sola). El chat, "Agregar a mi pedido" y el formulario no cambian.

**Por qué:** lo pidió Víctor con la referencia https://www.awwwards.com/duofankaar/ y las observaciones de la revisión (galería vacía, sin botón de cotizar a la mano, sin precios, "3,000 eventos" repetido, tono defensivo, Casa Isabella ausente, sin preguntas frecuentes).

**Descartado:** GSAP u otra librería de animación (sin paso de compilación; bastan CSS e IntersectionObserver, y se respeta "reducir movimiento"), pantalla de carga (frena al cliente) y testimonios (no hay reales que mostrar).
