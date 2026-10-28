# Continuidad entre sesiones de trabajo

Este archivo es la memoria del proyecto entre una sesión de Claude Code y la siguiente.
Víctor dice **"cerrar"** al terminar el día y **"continuar"** al día siguiente.

- Repo de trabajo (fuera de OneDrive): `C:\Users\virn3\Proyectos\Divanna-Eventos`
- Remoto: https://github.com/virn31/Divanna-Eventos
- Rama de trabajo actual: `quitar-whatsapp` (nunca trabajar directo en `main`; `main` es producción).

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

**Actualizado:** 2026-10-27 (noche) · **Rama:** `vista-equipo-admin` (sin merge) · **Producción:** `main` en b027b48 = PR #1 fusionado.

**En producción (PR #1, ya fusionado por Víctor):**
- Sin WhatsApp. Landing con chat de DiMa (Claude Sonnet 5.5), formulario de respaldo.
- App del equipo con usuario + PIN y roles; dashboard para Admin; alertas push; bot de Telegram.
- Verificado en producción: landing con chat, login, endpoint de Telegram, `/api/whatsapp` ya no existe.
- Telegram conectado a producción (`setWebhook` a `https://divanna-eventos.vercel.app/api/telegram`). Víctor ya vinculado.
- APK generado con PWABuilder e instalado en el teléfono de Víctor.
- Airtable limpio para pruebas: EVENTOS y COTIZACIONES vacías (se borraron 2 eventos falsos). CLIENTES conserva "Dr Victor Ivan" (prueba).
- COLABORADORES: `victor` (Admin, con PIN, Telegram vinculado) y `diana` (Admin, **falta que Víctor le ponga PIN**).

**En la rama `vista-equipo-admin` (falta publicar):**
- "Vista equipo" para Admin: botón en el dashboard que abre la app como la ve cada brigada o encargada, con "Como asistente". 55 pruebas pasan.

**Pendiente de Víctor:**
1. PIN de Diana en Airtable; pasarle el APK; que se vincule en @dimaclnbot.
2. Variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` en Vercel (Production y Preview) + Redeploy. Hoy `/api/push` devuelve `publicKey: null`: el push no funciona aún (Telegram y correo sí).
3. Dar de alta brigadas y encargadas en COLABORADORES (los códigos viejos ya no sirven).
4. Subir `assetlinks.json` del zip de PWABuilder a `.well-known/` (pedirle la ruta del archivo) para quitar la barra del navegador en el APK.
5. Limpieza: webhook de Twilio y variables viejas de Vercel.

**Siguientes pasos:**
- Publicar la rama `vista-equipo-admin` (PR o merge con permiso de Víctor).
- Pruebas de punta a punta con datos falsos: cotización por chat → autorizar en dashboard → evento asignado a una brigada de prueba → checklist → emergencia (push/Telegram/correo).
- Opcional: fijar la versión de Node en `package.json` (Vercel avisa por `"node": ">=18"`).
- Fases siguientes en `CLAUDE.md`.
