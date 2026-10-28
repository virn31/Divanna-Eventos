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

**Actualizado:** 2026-10-27 · **Rama:** `quitar-whatsapp` · **PR:** sin abrir (no hay `gh` en la PC; se abre desde https://github.com/virn31/Divanna-Eventos/compare/main...quitar-whatsapp?expand=1)

**Hecho (en la rama, nada en producción):**
- WhatsApp/Twilio eliminado. Avisos al equipo por correo + dentro de la app.
- Landing: "Haz aquí tu cotización" abre el chat con DiMa (`api/dima-chat.js`, Claude Sonnet 5.5, esfuerzo bajo). DiMa estima con el catálogo y registra el pedido; Diana lo confirma en el dashboard. Formulario de respaldo.
- Chat acotado: desde el mensaje 14 del cliente DiMa va cerrando; al pasar 20 se despide y ofrece el formulario; límite por IP (2 s entre mensajes, 40 cada 30 min, en memoria).
- App del equipo con usuario + PIN (tabla COLABORADORES) y roles: Admin, Líder de brigada, Asistente, Encargada de evento.
- Emergencias y alertas de seguridad: push con sonido y vibración (app cerrada o teléfono bloqueado) + sonido/vibración con la app abierta + correo. Tabla PUSH_SUSCRIPCIONES.
- Bot de Telegram interno (`api/telegram.js`, `docs/telegram.md`): vincular con `/entrar usuario PIN`, consultas por rol, emergencias a todo el equipo y pedidos/cambios/balance a Admin.
- Airtable: creadas COLABORADORES y PUSH_SUSCRIPCIONES, y los campos EVENTOS.Encargada y COLABORADORES.Telegram_Chat_ID. COLABORADORES está **vacía**.
- 53 pruebas locales pasan (`npm test`). Nada probado aún contra Claude, Airtable, Telegram ni Vercel reales.

**Pendiente de Víctor (antes del merge):**
1. Vercel → variables (Production y Preview): `SESSION_SECRET` (✅ hecho 2026-10-27), `EMAILS_EQUIPO` (instrucciones dadas), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (están en `DIVANNA HOMEPAGE\keys\vapid-dima.txt`, no subirlas al repo), `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` (crear el bot con BotFather, ver `docs/telegram.md`). Confirmar `ANTHROPIC_API_KEY`.
2. Llenar COLABORADORES (Usuario, PIN de 6 dígitos, Rol, Brigada, Activo). Sin esto nadie entra a la app tras el merge.
3. Abrir el PR y probar el preview: cotización completa con DiMa, login con cada rol, activar alertas y lanzar una emergencia de prueba.

**Siguientes pasos (después del merge):**
- Generar el APK (`docs/apk.md`, con notificaciones activadas), poner `.well-known/assetlinks.json`.
- Conectar el webhook de Telegram con producción (comandos en `docs/telegram.md`) y que cada colaborador se vincule.
- Apagar el webhook de Twilio y borrar variables viejas (lista en `CLAUDE.md`).
- Opcional: regla de rate limiting en el Firewall de Vercel para `/api/dima-chat`.
- Fases siguientes en `CLAUDE.md` (situación con cliente, semáforo, asignar encargada desde el dashboard).
