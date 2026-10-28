# DiMa OS — instrucciones para Claude Code

Landing con pedidos + apps internas para **Divanna Eventos** (renta de mobiliario, decoración, venue Casa Isabella) y **El Vaso Maíz** (snacks/paquetes), negocios de Diana en Culiacán, Sinaloa. Operado por Víctor.

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
- Datos: **Airtable vía REST directo** con `fetch` (base `appkpCfDADzQJ5G9H`). Tablas: EVENTOS `tblzLAin65BZPP2c6`, BRIGADAS `tblwqJrIaC1MsMGNL`, más CLIENTES, INVENTARIO, GASTOS, BALANCES (ver `api/pedido.js`, `api/dashboard-eventos.js` y `api/balance-semanal.js`).
- **Sin WhatsApp ni Twilio** desde 2026-10-27 (ver `docs/decisiones.md`). Avisos al equipo por **correo** (`enviarCorreoEquipo`, destinatarios en `EMAILS_EQUIPO`) y dentro de las apps.
- Integraciones Google en `api/_google-integrations.js` (Calendar, Sheets, Gmail).
- Cron semanal en `vercel.json` (balance, lunes).

## Mapa del repo

| Ruta | Qué es |
|---|---|
| `index.html` | Landing pública de marketing con formulario de pedido (`#pedido`). |
| `api/pedido.js` | POST público del formulario: crea CLIENTE + EVENTO (`Autorizacion_Diana` = Pendiente) y avisa por correo. Campo trampa `sitio_web` contra bots. |
| `api/brigada-eventos.js` | GET eventos de una brigada, login por código (`Codigo_Acceso` en BRIGADAS). También devuelve las emergencias/alertas de seguridad de otras brigadas del día. |
| `api/brigada-estatus.js` | POST checklist, estatus logístico, retraso, emergencia, alerta de seguridad. Avisa por correo a Diana y Víctor. |
| `api/brigada-checklist.js` | POST checklist de montaje. |
| `api/dashboard-eventos.js` | GET vista general Diana/Víctor (eventos, pedidos por cotizar, último balance), login contra `DASHBOARD_ACCESS_CODES`. POST autoriza/rechaza un pedido: checklist + Calendar + Sheets + correo al cliente. |
| `api/balance-semanal.js` | Cron de balance semanal, enviado por correo. |
| `brigadas/index.html` | **PWA de brigadas** (manifest + service worker, scope `/brigadas/`). |
| `brigadas/dashboard.html` | Dashboard de Diana/Víctor, página aparte. Aquí Diana cotiza y autoriza los pedidos de la landing. |
| `referencias/`, `paquetes/` | Fotos del banco de imágenes de DiMa. |

## Reglas que ya costaron caro

1. Todo texto que viene del formulario público (ubicación, servicios, notas, nombre) se escapa antes de pintarlo con `innerHTML` (función `esc()` en las apps) o en correos (`escapeHtml`).
2. Los campos de Airtable deben existir con el nombre exacto. Ya hubo un bug por `Monto_Cotizacion` (el real es `Monto_Estimado_IA`). Verifica el esquema antes de escribir un campo nuevo.
3. Vercel Hobby limita a **12 funciones serverless** por deployment. Hoy hay 6 rutas en `api/`: pedido, brigada-eventos, brigada-estatus, brigada-checklist, dashboard-eventos, balance-semanal (los archivos con `_` no cuentan). Antes de crear funciones nuevas, considera ampliar las existentes.
4. Los clientes ya tienen la PWA de brigadas instalada con scope `/brigadas/`. **No cambies el scope ni el `start_url`** sin plan de migración: se romperían las instalaciones.
5. El `CACHE_NAME` del service worker (`dima-brigadas-v1`) debe subir de versión cuando cambie cualquier archivo del app shell, o los teléfonos seguirán sirviendo la versión vieja.

## Hallazgos de seguridad abiertos (revisados el 2026-10-27, no corregidos todavía)

Se documentan aquí para atenderlos en la Fase 0 del plan. No los arregles de pasada dentro de otra tarea.

1. `POST /api/brigada-estatus` **no valida ningún código**. Cualquiera que conozca un `eventoId` de Airtable puede disparar alertas de emergencia que llegan por correo a Diana y Víctor y aparecen en la app de todas las brigadas.
2. `POST /api/brigada-checklist` tiene el mismo problema: tampoco valida ningún código, cualquiera puede alterar el checklist de un evento.
3. **Inyección en fórmulas de Airtable:** `brigada-eventos.js` mete el código tecleado directo en `filterByFormula` (`{Codigo_Acceso} = "${codigo}"`). Un código con comillas puede alterar la fórmula. Hay que escapar `"` y `\` antes de interpolar.
4. `Access-Control-Allow-Origin: *` en todos los endpoints. Debe restringirse al dominio de producción.
5. Los códigos viajan por query string (`?codigo=...`) y quedan en logs de Vercel. Moverlos a un header. (El POST de `dashboard-eventos` ya lo manda en el body.)
6. `POST /api/pedido` es público y solo tiene campo trampa contra bots, sin límite de envíos. Si llega spam, agregar límite por IP o captcha.

## Plan de la app interna

Decisión de Víctor (2026-10-27): **app interna únicamente**. Los pedidos de clientes entran **solo por el formulario de la landing**; WhatsApp se eliminó del sistema.
Distribución: **PWA** (sin preferencia expresada; es lo que ya existe, no requiere tiendas ni cuentas de pago).

### Fase 0 — Blindaje (antes de agregar funciones)
Corregir los 5 hallazgos de arriba. Introducir un mecanismo único de sesión: el código se valida una vez en un endpoint de login, que devuelve un token firmado de corta duración (HMAC con un secreto nuevo en Vercel, p. ej. `SESSION_SECRET`) y el rol (`brigada` o `admin`). Todas las llamadas posteriores llevan el token en un header. Víctor debe crear `SESSION_SECRET` en Vercel (Claude Code no puede editar variables de entorno).

### Fase 1 — App unificada
Evolucionar `/brigadas/` (mismo scope y `start_url`) para que sea la única app: login único → según el rol aparecen las vistas.
- Rol `brigada`: sus eventos, checklist, estatus, alertas (lo que hay hoy).
- Rol `admin` (Diana/Víctor): pestaña Dashboard con todos los eventos y brigadas (hoy `dashboard.html`).
- Dejar `dashboard.html` funcionando con redirección hasta confirmar que nadie lo usa directo.

### Fase 2 — Alertas nuevas
- Botón **"Situación con cliente"** (motivos predefinidos + detalle) que avisa a Diana y Víctor por correo y en el dashboard. Solo a ellos, no a toda la brigada.
- Campo nuevo `Estatus_Semaforo` (Verde/Amarillo/Rojo) en EVENTOS y alerta automática a Diana/Víctor cuando pase a Rojo, en cualquier momento (antes, durante o después del evento). Hoy el semáforo solo existe como bloqueo implícito al montar (`Requiere_Liquidacion_Anticipada` + `Estatus_Pago`), no como campo guardado.
- Instrucción de Diana a la brigada que reportó, desde el dashboard hacia la app de la brigada (ya no por WhatsApp).

### Fase 3 — Notificaciones push (opcional)
Web Push desde la PWA para que las alertas lleguen sin abrir la app ni el correo. En iPhone solo funciona con la app instalada y iOS 16.4 o superior. Hoy las otras brigadas solo ven una emergencia al abrir o refrescar su app, por eso esta fase gana prioridad.

## Pendientes de contexto (no son parte de la app, pero afectan)

- Variables de Vercel que quedan sin uso tras quitar WhatsApp y se pueden borrar: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `DIANA_WHATSAPP_NUMBER`, `VICTOR_WHATSAPP_NUMBER`, `ENFORCE_TWILIO_SIGNATURE`, `ANTHROPIC_API_KEY`.
- Tablas de Airtable que ya nadie escribe: CONVERSACIONES (log de WhatsApp). El campo `Enviado_WhatsApp` de BALANCES queda histórico.
