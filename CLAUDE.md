# DiMa OS — instrucciones para Claude Code

Landing con chat de cotización (DiMa) + app interna para **Divanna Eventos** (renta de mobiliario, decoración, venue Casa Isabella) y **El Vaso Maíz** (snacks/paquetes), negocios de Diana en Culiacán, Sinaloa. Operado por Víctor.

Producción: https://divanna-eventos.vercel.app (Vercel, workspace CODECELLS, plan **Hobby**).
Repo: github.com/virn31/Divanna-Eventos

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
- Datos: **Airtable vía REST directo** con `fetch` (base `appkpCfDADzQJ5G9H`). Tablas: EVENTOS `tblzLAin65BZPP2c6`, BRIGADAS `tblwqJrIaC1MsMGNL`, CLIENTES `tblgViisKQRG9TVjh`, COLABORADORES `tblHdz4vqUIlIdkwc`, más INVENTARIO, GASTOS, BALANCES.
- IA: **Claude API con el SDK oficial** `@anthropic-ai/sdk`, modelo `claude-opus-5-5`, en `api/dima-chat.js`. Herramientas con `strict: true` y `tool_choice: auto` (este modelo no acepta tool use forzado). Catálogo y precios en `api/_dima-catalogo.js`.
- **Sin WhatsApp ni Twilio** desde 2026-10-27. Avisos al equipo por **correo** (`enviarCorreoEquipo`, destinatarios en `EMAILS_EQUIPO`) y dentro de la app.
- Sesión de la app: usuario + PIN contra COLABORADORES → token HMAC (`SESSION_SECRET`) en `Authorization: Bearer`. Ver `api/_sesion.js`.
- Integraciones Google en `api/_google-integrations.js` (Calendar, Sheets, Gmail).
- Cron semanal en `vercel.json` (balance, lunes).

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `index.html` | Landing pública. Los botones "Haz aquí tu cotización" abren el chat con DiMa; abajo hay un formulario de respaldo. |
| `api/dima-chat.js` | POST público del chat. El navegador manda el historial (solo texto, máx. 40 mensajes). DiMa da estimados y llama `registrar_pedido` / `mostrar_fotos`. |
| `api/pedido.js` | POST público del formulario de respaldo. Campo trampa `sitio_web` contra bots. |
| `api/_pedidos.js` | Crea CLIENTE + EVENTO (`Autorizacion_Diana` = Pendiente, `Monto_Estimado_IA` si DiMa lo calculó) y avisa por correo. Lo usan el chat y el formulario. |
| `api/sesion.js` + `api/_sesion.js` | Login (usuario + PIN de 6 dígitos), token de 7 días y permisos por rol. Cada llamada revisa en Airtable que el colaborador siga `Activo`. |
| `api/brigada-eventos.js` | GET eventos según el rol (líder/asistente: su brigada; encargada: los de `EVENTOS.Encargada`) + alertas de otras brigadas del día. |
| `api/brigada-estatus.js` | POST carga, estatus logístico, retraso, emergencia, alerta de seguridad. El asistente solo carga y alertas. Avisa por correo. |
| `api/brigada-checklist.js` | POST etapas del evento (líder, encargada, admin). |
| `api/dashboard-eventos.js` | Solo Admin. GET eventos, pedidos por cotizar, último balance. POST autoriza/rechaza: checklist + Calendar + Sheets + correo al cliente. |
| `api/balance-semanal.js` | Cron de balance semanal, enviado por correo. |
| `brigadas/index.html` | **App del equipo** (PWA/APK, scope `/brigadas/`): login y vista según rol. Admin pasa a `dashboard.html`. |
| `brigadas/dashboard.html` | Dashboard de Diana/Víctor (misma sesión, solo Admin). Aquí se cotizan y autorizan los pedidos. |
| `referencias/`, `paquetes/` | Fotos que DiMa muestra en el chat. |
| `docs/apk.md` | Cómo generar el APK de Android a partir de la PWA. |

## Roles (campo `Rol` en COLABORADORES)

- **Admin** (Diana, Víctor): dashboard completo.
- **Lider de brigada**: eventos de su brigada; todo lo operativo.
- **Asistente**: eventos de su brigada; solo checklist de carga y alertas (emergencia/seguridad).
- **Encargada de evento** (El Vaso Maíz): los eventos donde está en `EVENTOS.Encargada`; lo mismo que un líder.

Alta de alguien: fila en COLABORADORES con Usuario, PIN de 6 dígitos, Rol, Brigada (si aplica) y Activo. Baja: desmarcar Activo (aplica en la siguiente acción).

## Reglas que ya costaron caro

1. Todo texto que viene de clientes (chat, formulario) se escapa antes de pintarlo con `innerHTML` (`esc()` en las apps, `escapar()` en la landing) o en correos (`escapeHtml`).
2. Los campos de Airtable deben existir con el nombre exacto. Ya hubo un bug por `Monto_Cotizacion` (el real es `Monto_Estimado_IA`). Verifica el esquema antes de escribir un campo nuevo.
3. Vercel Hobby limita a **12 funciones serverless** por deployment. Hoy hay 8 rutas en `api/`: dima-chat, pedido, sesion, brigada-eventos, brigada-estatus, brigada-checklist, dashboard-eventos, balance-semanal (los archivos con `_` no cuentan).
4. La PWA ya está instalada con scope `/brigadas/` y el APK apunta ahí. **No cambies el scope ni el `start_url`** sin plan de migración.
5. El `CACHE_NAME` del service worker (hoy `dima-brigadas-v2`) debe subir de versión cuando cambie cualquier archivo del app shell, o los teléfonos seguirán sirviendo la versión vieja.
6. Con `claude-opus-5-5`: nada de `tool_choice` `any`/`tool`, nada de `budget_tokens` ni `temperature`. El historial del chat se manda solo como texto, sin bloques de thinking.
7. Los datos de pago (cuenta/tarjeta) **no** van en el prompt de DiMa: se mandan con la cotización confirmada por Diana.

## Hallazgos de seguridad abiertos

1. `POST /api/dima-chat` y `POST /api/pedido` son públicos y no tienen límite de envíos. El chat además cuesta por llamada a Claude. Si llega abuso: límite por IP (p. ej. Vercel Firewall / rate limiting) o captcha.
2. Los PIN están en texto plano en COLABORADORES (para que Víctor los administre desde Airtable). Quien tenga acceso a la base los ve.
3. El login frena intentos fallidos con una pausa, pero no bloquea la cuenta tras varios intentos.

Corregidos el 2026-10-27: endpoints de brigada sin validación, inyección en `filterByFormula` del código de brigada, códigos en query string y `Access-Control-Allow-Origin: *` en los endpoints de la app.

## Siguientes fases

- **Alertas nuevas:** botón "Situación con cliente" (solo a Diana/Víctor), `Estatus_Semaforo` con alerta al pasar a Rojo, instrucción de Diana a la brigada desde el dashboard.
- **Notificaciones push** (Web Push en la PWA/APK): hoy las otras brigadas solo ven una emergencia al abrir o refrescar la app.
- Asignar `Encargada` y brigada a un evento desde el dashboard (hoy se hace en Airtable).

## Pendientes de contexto

- Variables de Vercel sin uso que se pueden borrar: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `DIANA_WHATSAPP_NUMBER`, `VICTOR_WHATSAPP_NUMBER`, `ENFORCE_TWILIO_SIGNATURE`, `DASHBOARD_ACCESS_CODES`. **`ANTHROPIC_API_KEY` sí se usa** (chat de DiMa).
- Variables nuevas necesarias: `SESSION_SECRET`, `EMAILS_EQUIPO`.
- Ya nadie escribe en CONVERSACIONES (log de WhatsApp) ni en `BRIGADAS.Codigo_Acceso`. La conversación del chat queda en `EVENTOS.Notas`. El campo `Enviado_WhatsApp` de BALANCES queda histórico.
