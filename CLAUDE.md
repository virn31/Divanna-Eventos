# DiMa OS — instrucciones para Claude Code

Landing con chat de cotización (DiMa) + app del equipo (PWA/APK) + bot de Telegram @dimaclnbot para **Divanna Eventos** (mobiliario, decoración, venue Casa Isabella) y **El Vaso Maíz** (snacks), negocios de Diana en Culiacán. Operado por Víctor.

Producción: https://divanna-eventos.vercel.app (Vercel Hobby, scope codecells). `main` = producción (se despliega sola).

**Sesiones:** "cerrar" / "continuar" → `docs/SESION.md` (ahí está el estado del trabajo).
**Detalle de cada módulo, roles y reglas completas:** `docs/arquitectura.md`. Léelo por secciones (busca con Grep), solo lo que la tarea necesite.

## Cómo trabajar aquí

- Cambios quirúrgicos; no reformatear lo que no es parte de la tarea.
- Decisiones en `docs/decisiones.md` (fecha, decisión, por qué, alternativa). No leerlo entero: buscar con Grep.
- Español con Víctor; comentarios de código en español.
- Producción real con clientes y brigadas: antes de tocar algo que funciona, di qué se rompe si falla y cómo revertir.
- Nunca imprimir ni commitear secretos; variables de entorno solo por nombre.
- `npm test` antes de cada commit. Commits con `git -c user.name=virn31 -c user.email=virn31@gmail.com commit` (también en merge).
- **Ahorro de contexto:** no leer imágenes salvo que haga falta; `vercel logs` siempre con filtros (`-s`, `--json` + grep) y no volcar todo; no leer `pruebas/api.test.js` entero.

## Stack (no cambiarlo sin decisión documentada)

- HTML/CSS/JS vanilla sin build. Backend `api/*.js` CommonJS, Node >= 18 (archivos con `_` = módulos, no rutas).
- Airtable REST con `fetch`, base `appkpCfDADzQJ5G9H` (IDs de tablas en `docs/arquitectura.md`).
- Claude API (`@anthropic-ai/sdk`), `claude-sonnet-5-5` esfuerzo `low`, en `api/dima-chat.js`; catálogo/precios en `api/_dima-catalogo.js`.
- Sin WhatsApp ni Twilio. Avisos: correo, Web Push (`VAPID_*`), Telegram interno (`docs/telegram.md`).
- Sesión: usuario + PIN contra COLABORADORES → token HMAC (`api/_sesion.js`).
- Google: `_calendario.js`, `_sheets.js`, `_drive.js`, `_google-integrations.js`. Crons en `vercel.json`.

## Mapa rápido

- `index.html` landing · `api/dima-chat.js` chat público · `api/pedido.js` formulario · `api/_pedidos.js` crea cliente+evento
- `api/_productos.js` catálogo y capacidad · `api/_agenda.js` semáforo y día lleno · `api/_calendario.js` calendario + Google
- `api/finanzas.js`/`_finanzas.js` reportes del día · `_cuadre.js` cuadre · `_cargos.js` dinero y daños · `_danos.js` /daño
- `_sheets.js` hojas y recibo PDF · `_comanda.js` comanda por foto · `_drive.js` carpeta de Diana (galería, promos)
- `_cambios.js` cambios del cliente · `_correcciones.js`/`_entrenamiento.js` reglas de DiMa (/entrenamiento) · `_colores.js` nota de colores · `_produccion.js` producción VM · `_staff.js` /staff · `_curso.js` · `_mensajes.js` · `_instrucciones.js` (= `docs/manual-equipo.md`, actualizar ambos)
- `api/telegram.js`/`_telegram.js` bot · `_eventos.js` qué ve cada rol · `_dima-equipo.js` DiMa interna · `push.js`/`_push.js`
- `brigadas/index.html` app · `brigadas/dashboard.html` dashboard Admin · `brigadas/sw.js` service worker · `pruebas/api.test.js`

Roles: Admin (Diana, Víctor), Lider de brigada, Asistente, Encargada, Gerentes por negocio con Rol `Gerente El Vaso Maiz` / `Gerente Divanna` (sin Casa Isabella) / `Gerente Casa Isabella`; por dentro cuentan como líder (`rolDe` en `api/_sesion.js`); la casilla vieja `Gerente_Vaso_Maiz` sigue valiendo, Staff (solo Telegram). Detalle en `docs/arquitectura.md`.

## Reglas que ya costaron caro (resumen; detalle en `docs/arquitectura.md`)

1. Texto de clientes se escapa antes de `innerHTML` (`esc()` / `escapar()`) y en correos (`escapeHtml`).
2. Campos de Airtable con nombre exacto: verificar esquema antes de escribir uno nuevo (ej. `Monto_Estimado_IA`, no `Monto_Cotizacion`).
3. **12 funciones serverless = el máximo de Hobby, ya usadas.** Ruta nueva = juntar con una existente.
4. No cambiar scope `/brigadas/` ni `start_url` de la PWA.
5. Subir `CACHE_NAME` de `brigadas/sw.js` (hoy `dima-brigadas-v39`) al cambiar cualquier archivo del app shell.
6. `claude-sonnet-5-5`: sin `tool_choice` any/tool, sin `thinking: disabled`, `budget_tokens` ni `temperature`; historial solo texto.
7. Datos de pago nunca en el prompt de DiMa.
8. Con el cliente DiMa no nombra a nadie del equipo (hay prueba que falla si dice "Diana").
9. Nunca generalizar modelo ni color (copas, manteles, platos, Tiffany): Diana asigna en `EVENTOS.Articulos`.
10. Cobertura: límite duro 35 km desde la salida de Culiacán; fuera de la ciudad → `Fuera_De_Ciudad`, confirma Diana.
11. Webhook de Telegram con `message` y `callback_query` (o `/configurar`).
12. Temporada alta 18-dic a 1-ene: +70%, sin paquetes (`api/_temporada.js`).
13. NO llamar `/api/balance-semanal` para probar: manda el balance real.

## Seguridad abierta

Límite por IP del chat solo en memoria y `/api/pedido` sin límite; PIN en texto plano en Airtable; login sin bloqueo tras varios intentos.
