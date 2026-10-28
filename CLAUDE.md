# DiMa OS — instrucciones para Claude Code

Landing con chat de cotización (DiMa) + app interna para **Divanna Eventos** (renta de mobiliario, decoración, venue Casa Isabella) y **El Vaso Maíz** (snacks/paquetes), negocios de Diana en Culiacán, Sinaloa. Operado por Víctor.

Producción: https://divanna-eventos.vercel.app (Vercel, workspace CODECELLS, plan **Hobby**).
Repo: github.com/virn31/Divanna-Eventos · copia de trabajo: `C:\Users\virn3\Proyectos\Divanna-Eventos`

**Sesiones:** cuando Víctor diga "cerrar" o "continuar", sigue `docs/SESION.md` (ahí está también el estado del trabajo en curso).

## Cómo trabajar aquí

- **Cambios quirúrgicos.** Toca solo lo necesario. No reformatees ni reorganices archivos que no son parte de la tarea.
- **Documenta decisiones** en `docs/decisiones.md` (fecha, decisión, por qué, alternativa descartada). Una entrada por decisión.
- Habla en español con Víctor. Comentarios de código en español, como el resto del repo.
- Antes de cambiar algo que ya funciona en producción, di qué se rompería si falla y cómo revertirlo.
- Nunca imprimas ni commitees secretos. Las variables de entorno solo se nombran, no se copian valores.
- Este repo es producción real con clientes y brigadas usándolo. Un deploy roto afecta eventos en curso.

## Stack (no cambiarlo sin decisión documentada)

- Frontend: **HTML/CSS/JS vanilla**, sin framework ni build step. Archivos estáticos servidos por Vercel.
- Backend: funciones serverless en `api/*.js`, **CommonJS** (`module.exports = async (req, res) => ...`), Node >= 18.
- Datos: **Airtable vía REST directo** con `fetch` (base `appkpCfDADzQJ5G9H`). Tablas: EVENTOS `tblzLAin65BZPP2c6`, BRIGADAS `tblwqJrIaC1MsMGNL`, CLIENTES `tblgViisKQRG9TVjh`, COLABORADORES `tblHdz4vqUIlIdkwc`, INVENTARIO `tblG7pqvkyGTzBxx0`, PERSONAL_DIA `tblYKHBvqC32Aec1F`, más GASTOS, BALANCES.
- IA: **Claude API con el SDK oficial** `@anthropic-ai/sdk`, modelo `claude-sonnet-5-5` (esfuerzo `low`), en `api/dima-chat.js`. Herramientas con `strict: true` y `tool_choice: auto` (este modelo no acepta tool use forzado). Catálogo y precios en `api/_dima-catalogo.js`.
- **Sin WhatsApp ni Twilio** desde 2026-10-27. Avisos al equipo por **correo** (`enviarCorreoEquipo`, destinatarios en `EMAILS_EQUIPO`) y dentro de la app.
- Emergencias y alertas de seguridad: **Web Push** (`web-push`, llaves `VAPID_*`) con sonido y vibración aunque la app esté cerrada, más sonido/vibración con la app abierta (`brigadas/alertas.js`).
- **Bot de Telegram interno** (solo equipo, no clientes): avisos y consultas según rol. Ver `docs/telegram.md`.
- Sesión de la app: usuario + PIN contra COLABORADORES → token HMAC (`SESSION_SECRET`) en `Authorization: Bearer`. Ver `api/_sesion.js`.
- Integraciones Google en `api/_google-integrations.js` (Calendar, Sheets, Gmail).
- Cron semanal en `vercel.json` (balance, lunes).

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `index.html` | Landing pública. Los botones "Haz aquí tu cotización" abren el chat con DiMa; abajo hay un formulario de respaldo. |
| `api/dima-chat.js` | POST público del chat. Acepta `pedidoExistente: {folio, telefono}` (se verifica contra el teléfono del cliente) y `folio` + `folioFirma` (HMAC con `SESSION_SECRET`): solo con folio firmado un cambio se guarda en el evento existente. Detecta lugares foráneos en lo que escribe el cliente y se lo recuerda a DiMa. El navegador manda el historial (solo texto). DiMa da estimados y llama `registrar_pedido` / `mostrar_fotos`. Desde el mensaje 14 del cliente va cerrando; pasado el 20 se despide y ofrece el formulario. Límite por IP en memoria. |
| `api/pedido.js` | POST público del formulario de respaldo. Campo trampa `sitio_web` contra bots. |
| `api/_pedidos.js` | Crea CLIENTE + EVENTO (`Autorizacion_Diana` = Pendiente, `Monto_Estimado_IA` si DiMa lo calculó) y avisa por correo. Lo usan el chat y el formulario. |
| `api/_productos.js` | Catálogo estructurado (claves de producto, piezas de El Vaso Maíz, mobiliario por categoría de Divanna) y cálculo de capacidad: personal por piezas y horas, inventario requerido, ventana de ocupación. DiMa manda los productos con estas claves; se guardan en `EVENTOS.Productos`. |
| `api/_agenda.js` | Semáforo de disponibilidad: cruza un evento con los eventos AUTORIZADOS que se traslapan (inventario por categoría y por artículo exacto, Casa Isabella, entregas de Divanna por día, personal y equipos de El Vaso Maíz contra `PERSONAL_DIA`). Lo usan `_pedidos.js` al registrar (guarda `Disponibilidad`) y el dashboard (en vivo). |
| `api/_staff.js` | Staff de El Vaso Maíz por Telegram: `/staff` (solo Admin o `Coordina_Staff`: Ángela, Diana y Víctor) lista eventos autorizados de El Vaso Maíz, se eligen chicas con botones y se les manda la invitación con "Sí puedo / No puedo"; las respuestas le llegan a quien invitó. Tabla STAFF_EVENTO `tblvTVcC3NMt5ddjr`. La selección viaja en el `callback_data` (máscara de bits). |
| `api/sesion.js` + `api/_sesion.js` | Login (usuario + PIN de 6 dígitos), token de 7 días y permisos por rol. Cada llamada revisa en Airtable que el colaborador siga `Activo`. |
| `api/brigada-eventos.js` | GET eventos según el rol (líder/asistente: su brigada; encargada: los de `EVENTOS.Encargada`) + alertas de otras brigadas del día. |
| `api/brigada-estatus.js` | POST carga, estatus logístico, retraso, emergencia, alerta de seguridad. El asistente solo carga y alertas. Emergencia/seguridad: push a todo el equipo + correo. |
| `api/telegram.js` + `api/_telegram.js` | Webhook del bot del equipo (`/entrar usuario PIN`, `/hoy`, `/eventos`, `/alertas`, `/pedidos`, `/salir`) y envío de avisos. Vincula el chat en `COLABORADORES.Telegram_Chat_ID`. Valida `TELEGRAM_WEBHOOK_SECRET`. |
| `api/_eventos.js` | Qué eventos ve cada rol y alertas del día; lo usan la app y el bot. |
| `api/push.js` + `api/_push.js` | Suscripción del teléfono a las alertas (tabla PUSH_SUSCRIPCIONES `tblSyRGsMwcSnkcAR`) y envío. Solo a colaboradores activos, nunca a quien reporta. |
| `api/brigada-checklist.js` | POST etapas del evento (líder, encargada, admin). |
| `api/dashboard-eventos.js` | Solo Admin. GET eventos, pedidos por cotizar, último balance. POST autoriza/rechaza: checklist + Calendar + Sheets + correo al cliente. |
| `api/balance-semanal.js` | Cron de balance semanal, enviado por correo. |
| `brigadas/index.html` | **App del equipo** (PWA/APK, scope `/brigadas/`): login y vista según rol. Admin pasa a `dashboard.html`. |
| `brigadas/dashboard.html` | Dashboard de Diana/Víctor (misma sesión, solo Admin). Aquí se cotizan y autorizan los pedidos. |
| `brigadas/alertas.js` | Botón "Activar alertas", suscripción push y sonido/vibración con la app abierta. Lo usan index y dashboard. |
| `brigadas/sw.js` | Service worker: caché del app shell + recibe el push y muestra la notificación (vibración, `requireInteraction`). |
| `pruebas/api.test.js` | `npm test`: prueba los endpoints con Airtable, Gmail, Claude y push simulados. Correrlo antes de cada commit. |
| `docs/SESION.md` | Protocolo "cerrar"/"continuar" y estado del trabajo en curso. |
| `referencias/`, `paquetes/` | Fotos que DiMa muestra en el chat. |
| `docs/apk.md` | Cómo generar el APK de Android a partir de la PWA. |

## Roles (campo `Rol` en COLABORADORES)

- **Admin** (Diana, Víctor): dashboard completo y **Vista equipo** (`/brigadas/?vista=equipo`): la app como la ve cada brigada o encargada, con opción "Como asistente".
- **Lider de brigada**: eventos de su brigada; todo lo operativo.
- **Asistente**: eventos de su brigada; solo checklist de carga y alertas (emergencia/seguridad).
- **Encargada de evento** (El Vaso Maíz): los eventos donde está en `EVENTOS.Encargada`; lo mismo que un líder.
- **Staff** (chicas de El Vaso Maíz): **solo Telegram**, la app les responde 403. Cada una tiene su `Coordinadora` (ej. Ángela) en COLABORADORES; reciben invitaciones por `/staff` y con `/hoy` y `/eventos` ven solo lo que confirmaron, sin pagos ni montos.

Alta de alguien: fila en COLABORADORES con Usuario, PIN de 6 dígitos, Rol, Brigada (si aplica) y Activo. Baja: desmarcar Activo (aplica en la siguiente acción).

## Reglas que ya costaron caro

1. Todo texto que viene de clientes (chat, formulario) se escapa antes de pintarlo con `innerHTML` (`esc()` en las apps, `escapar()` en la landing) o en correos (`escapeHtml`).
2. Los campos de Airtable deben existir con el nombre exacto. Ya hubo un bug por `Monto_Cotizacion` (el real es `Monto_Estimado_IA`). Verifica el esquema antes de escribir un campo nuevo.
3. Vercel Hobby limita a **12 funciones serverless** por deployment. Hoy hay 10 rutas en `api/`: dima-chat, pedido, sesion, push, telegram, brigada-eventos, brigada-estatus, brigada-checklist, dashboard-eventos, balance-semanal (los archivos con `_` no cuentan).
4. La PWA ya está instalada con scope `/brigadas/` y el APK apunta ahí. **No cambies el scope ni el `start_url`** sin plan de migración.
5. El `CACHE_NAME` del service worker (hoy `dima-brigadas-v5`) debe subir de versión cuando cambie cualquier archivo del app shell, o los teléfonos seguirán sirviendo la versión vieja.
6. Con `claude-sonnet-5-5`: nada de `tool_choice` `any`/`tool`, nada de `thinking: disabled`, `budget_tokens` ni `temperature`. El historial del chat se manda solo como texto, sin bloques de thinking; la instrucción de cierre va como mensaje `role: "system"` al final, sin guardarse en el historial.
14. **Temporada alta** (`api/_temporada.js`): del 18 de diciembre al 1 de enero (fecha del EVENTO), precios por pieza +70% y sin paquetes regulares (Divanna y El Vaso Maíz). DiMa lo explica con sutileza (temporada de más demanda). El traslado no sube. Los pedidos llegan marcados "🎄 Temporada alta". Para cambiar fechas o porcentaje se edita solo `TEMPORADA_ALTA`.
13. **Aproximado de traslado** (`api/_traslado.js`): km por carretera desde la salida de Culiacán x $10 x 4 (ir a dejar y regresar, ir a recoger y regresar). Ruta con OpenStreetMap (Nominatim + OSRM, gratis, sin llave); la "salida" es donde la ruta deja el límite oficial de Culiacán Rosales (`api/_culiacan-limite.json`). DiMa solo lo da si el cliente lo pide, siempre como estimado que confirma logística. Si crece el volumen o se quiere la distancia exacta de Google, cambiar a Google Maps Distance Matrix (requiere llave y cuenta de facturación).
12. **Con el cliente, DiMa no nombra a nadie del equipo** (ni a Diana): dice "el equipo de logística" (cobertura, traslado, disponibilidad) o "la gerencia" (precios, confirmar la cotización). Hay una prueba que falla si un texto al cliente dice "Diana". Dentro de la app, Telegram y correos internos sí se usa el nombre.
15. **Agenda y capacidad** (`api/_productos.js`): cada evento guarda `Hora_Inicio`, `Horas_Servicio` y `Productos` (JSON con claves del catálogo); al guardar se recalculan `Piezas_Vaso_Maiz`, `Personal_Requerido` (piezas x 4 min / horas de servicio, mínimo 2) y `Resumen_Capacidad`. El mobiliario cuenta por `INVENTARIO.Categoria` (deben coincidir con `CATEGORIAS`); sale en ruta de logística y está ocupado todo el día del evento hasta la 1 pm del día siguiente, los manteles 48 h más de lavado y Casa Isabella solo las horas del evento; el equipo de El Vaso Maíz sale 30 min antes. **Nunca generalizar modelo ni color:** donde una categoría tiene varios artículos (copas globo/francesa, manteles, platos, Tiffany), Diana asigna los artículos exactos en `EVENTOS.Articulos` y la brigada ve "📦 Cargar exacto"; solo Antonella grande/chica se mezclan. Producto nuevo = agregarlo en `PRODUCTOS` (y su precio en `_dima-catalogo.js`).
16. **Semáforo** (`api/_agenda.js`): 🟢 alcanza; 🟡 se puede con proveedor (faltan piezas y hay más de 48 h), con personal extra, o hay que revisar a mano (artículos sin conteo, eventos sin productos, más de 9 entregas de Divanna); 🔴 Casa Isabella apartada, piezas faltantes con menos de 48 h, o El Vaso Maíz sin un equipo libre (6 equipos; cupo de `PERSONAL_DIA`, 12 si no hay renglón). Solo los eventos autorizados apartan; los pendientes salen como aviso. El cliente nunca ve el semáforo: DiMa le dice que ya están todos los datos y que se le confirma en un lapso no mayor a 12 horas (`HORAS_RESPUESTA` en `_pedidos.js`); el dashboard muestra el plazo y avisa si se venció.
17. **Botones de Telegram:** el webhook debe aceptar `callback_query` además de `message`. Si se vuelve a registrar el webhook a mano, incluir ambos en `allowed_updates`; o un Admin escribe `/configurar` en el bot y lo hace solo (también actualiza la lista de comandos).
7. Los datos de pago (cuenta/tarjeta) **no** van en el prompt de DiMa: se mandan con la cotización confirmada por Diana.
8. **Cobertura:** **límite duro de 35 km desde la salida de Culiacán** (seguridad y costos): más lejos no se da servicio y el servidor no registra el pedido (chat y formulario), aunque DiMa no lo haya revisado; si el mapa no responde, se registra y logística valida. Servicio normal dentro de la ciudad de Culiacán. Fuera de la ciudad (sindicaturas, Navolato y San Pedro, playas) DiMa no confirma: marca `EVENTOS.Fuera_De_Ciudad` y Diana confirma cobertura y costo de traslado. Las reglas viven en el prompt de `api/dima-chat.js`.
10. **Ubicación de las alertas:** al lanzar emergencia/seguridad la app manda el GPS (`Ubicacion_Alerta`, `Ubicacion_Alerta_Hora`); Telegram lleva link y pin del mapa, el push abre el mapa. Mientras la alerta siga activa y la app esté abierta en un teléfono que no sea Admin, se actualiza cada minuto (`tipo: "ubicacion"`, sin avisos). Quien reporta no recibe su propia alerta, pero sí una confirmación "✅ Tu alerta se envió" en Telegram. Las alertas se apagan tocando otra vez su botón en la app o con "Marcar resuelta" en el dashboard; al resolver se avisa por Telegram, sin push.
11. **Diana → cliente vía DiMa:** en el dashboard, "💬 Mensaje para el cliente" guarda `EVENTOS.Mensaje_Para_Cliente`. Si el cliente sigue con el chat abierto, la página revisa cada 30 s (`accion: "revisar"`, sin llamar a Claude) y lo muestra; si regresa después con folio + teléfono, DiMa se lo entrega al inicio. Al entregarse se marca `Mensaje_Cliente_Entregado`. En foráneos DiMa pregunta si el cliente espera en el chat o prefiere mensaje/llamada (`Preferencia_Contacto`).
9. **Instrucciones para el equipo:** `EVENTOS.Instrucciones_Equipo`. DiMa guarda las indicaciones del cliente ("Del cliente: ..."); Diana las edita en el dashboard y al guardar se avisa por push y Telegram solo a la brigada/encargada asignada. Se muestran en la app y en `/hoy` de Telegram.

## Hallazgos de seguridad abiertos

1. `POST /api/dima-chat` tiene límite por IP solo en memoria de cada instancia (freno básico) y `POST /api/pedido` no tiene límite. Si llega abuso: regla de rate limiting en el Firewall de Vercel o captcha.
2. Los PIN están en texto plano en COLABORADORES (para que Víctor los administre desde Airtable). Quien tenga acceso a la base los ve.
3. El login frena intentos fallidos con una pausa, pero no bloquea la cuenta tras varios intentos.

Corregidos el 2026-10-27: endpoints de brigada sin validación, inyección en `filterByFormula` del código de brigada, códigos en query string y `Access-Control-Allow-Origin: *` en los endpoints de la app.

## Siguientes fases

- **Alertas nuevas:** botón "Situación con cliente" (solo a Diana/Víctor), `Estatus_Semaforo` con alerta al pasar a Rojo, instrucción de Diana a la brigada desde el dashboard.
- Asignar `Encargada` y brigada a un evento desde el dashboard (hoy se hace en Airtable).

## Pendientes de contexto

- Variables de Vercel sin uso que se pueden borrar: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `DIANA_WHATSAPP_NUMBER`, `VICTOR_WHATSAPP_NUMBER`, `ENFORCE_TWILIO_SIGNATURE`, `DASHBOARD_ACCESS_CODES`. **`ANTHROPIC_API_KEY` sí se usa** (chat de DiMa).
- Variables nuevas necesarias: `SESSION_SECRET`, `EMAILS_EQUIPO`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (las VAPID generadas están en la carpeta local `keys\vapid-dima.txt` de Víctor, nunca en el repo), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`.
- Ya nadie escribe en CONVERSACIONES (log de WhatsApp) ni en `BRIGADAS.Codigo_Acceso`. La conversación del chat queda en `EVENTOS.Notas`. El campo `Enviado_WhatsApp` de BALANCES queda histórico.
