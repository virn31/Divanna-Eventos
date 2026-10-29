# Continuidad entre sesiones de trabajo

Este archivo es la memoria del proyecto entre una sesión de Claude Code y la siguiente.
Víctor dice **"cerrar"** al terminar el día y **"continuar"** al día siguiente.

- Repo de trabajo (fuera de OneDrive): `C:\Users\virn3\Proyectos\Divanna-Eventos`
- Remoto: https://github.com/virn31/Divanna-Eventos
- Rama de trabajo actual: `staff-telegram` (nunca trabajar directo en `main`; `main` es producción).

## Cuando Víctor dice "cerrar"

1. Correr `npm test` en el repo de trabajo. Si algo falla, decirlo y anotarlo abajo en "Estado".
2. Actualizar la sección **Estado** de este archivo (reemplazarla, no apilar):
   fecha, rama, qué se hizo en la sesión, qué quedó a medias (archivo y qué falta),
   decisiones pendientes de Víctor, y los siguientes pasos concretos en orden.
3. Si se tomó una decisión de diseño, agregar su entrada en `docs/decisiones.md`.
4. `git add -A`, commit con mensaje en español que resuma la sesión, y `git push` de la rama.
   No hacer merge a `main` ni push a `main` sin que Víctor lo pida.
5. Responderle a Víctor en pocas líneas: qué quedó guardado, el commit y lo pendiente.

## Cuando Víctor dice "continuar"

1. Ir al repo de trabajo y sincronizar: `git fetch`, `git checkout <rama de Estado>`, `git pull`.
   Revisar `git status`: si hay cambios sin commitear, avisar antes de tocar nada.
2. Leer `CLAUDE.md`, la sección **Estado** de este archivo y `git log --oneline -10`.
3. Si `package.json` cambió o no existe `node_modules`, correr `npm install`. Luego `npm test`.
4. Decirle a Víctor en pocas líneas dónde quedamos y cuál es el siguiente paso, y seguir con él.

## Estado

**Actualizado:** 2026-10-28 (cierre de la noche) · **Rama de trabajo:** `main` (todo publicado; ramas de hoy ya unidas) · **Producción:** `main` con el merge de `gerente-vaso-maiz` (merges locales, sin PR). Rama aparte sin publicar: `entrenar-dima` (Entrenar a DiMa desde el dashboard).

**Publicado hoy (en orden):**
- Asignar brigada y encargada desde el dashboard (`asignar`), con conteo real de avisos entregados por Telegram/push y el motivo si falla.
- Al autorizar, el mensaje dice qué falló de Google (Calendar, Sheets, correo) y por qué.
- Botón "👍 Enterado" en la app y "✅ Confirmar" en los avisos de Telegram (`EVENTOS.Enterado_Por`/`Enterado_Hora`); se avisa a los Admin.
- `/staff` (rama `staff-telegram`): staff de El Vaso Maíz por Telegram, invitaciones "Sí puedo / No puedo".
- `/instrucciones`: manual por temas con botones (`api/_instrucciones.js` = `docs/manual-equipo.md`).
- Gerente de El Vaso Maíz (`COLABORADORES.Gerente_Vaso_Maiz`, Ángela): ve y asigna todos los eventos de El Vaso Maíz desde su app; DiMa interna (app "💬 Pregúntale a DiMa" y Telegram sin comando); `/curso` (6 lecciones, `Curso_Avance`); `/mensaje` con "↩️ Responder".
- `CACHE_NAME` = `dima-brigadas-v7`. 210 pruebas pasan.

**Airtable hoy:** campos nuevos `EVENTOS.Enterado_Por`, `EVENTOS.Enterado_Hora`, `COLABORADORES.Gerente_Vaso_Maiz`, `COLABORADORES.Curso_Avance`. Alta de Ángel (Brigada Ángel), Eden ligado a Brigada Edén, Ángela (usuario `angela`, Lider de Brigada El Vaso Maíz, `Coordina_Staff` y `Gerente_Vaso_Maiz`). Se borraron los 3 eventos de prueba y sus clientes.

**Pendiente de Víctor (siguiente sesión):**
1. Escribir `/configurar` al bot (activa los botones y agrega `/instrucciones`, `/curso`, `/mensaje` a la lista). Sin esto los botones de Telegram no responden.
2. `/curso` → "📨 Angela Samano" para mandarle su primera lección.
3. Conectar Google Calendar/Sheets: cuenta de servicio, compartir el calendario de divannaeventos@gmail.com y la hoja, variables `GOOGLE_*` en Vercel y redeploy (pasos en la conversación y en `api/_google-integrations.js`). Hoy al autorizar falla Calendar/Sheets.
4. Alta de las chicas de El Vaso Maíz (Ángela con `/staff` → Agregar personal) y de José (asistente de Brigada Edén) si va a usar la app.
5. Teléfono de Ángel (ZTE con "Security Lock"): instalar la app desde Chrome, no el APK.
6. Lo anterior: conteos de INVENTARIO, proveedores aliados, rutas de Divanna, PIN de Diana, `VAPID_*`, `assetlinks.json`, limpieza de Twilio.

**Siguientes pasos:**
- Prueba completa con un pedido nuevo: chat de DiMa → autorizar → asignar a una brigada → Confirmar en Telegram → ver "Enterado" en el dashboard.
- Decidir si se publica `entrenar-dima`.
- Fase 3: gastos y entradas por brigada. Fase 4: proveedores y compras. Fase 5: recordatorios de checklist por Telegram.
