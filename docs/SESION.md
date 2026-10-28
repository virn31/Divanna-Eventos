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

**Publicado (PR #3, `vista-equipo-admin`):** vista equipo para Admin, cobertura fuera de la ciudad, instrucciones para el equipo, ubicación GPS en alertas, desactivar alertas y "Marcar resuelta".

**En la rama `dima-pedido-existente` (falta publicar):**
- DiMa explica la validación de eventos foráneos (prompt + recordatorio automático al detectar lugares como San Pedro/Navolato).
- Venta cruzada obligatoria antes de pedir datos.
- Cuadro "¿Ya tienes número de pedido?" en la landing (folio + teléfono) para agregar cosas o indicaciones; se guardan en el evento y avisan a Diana. Folio firmado para que nadie toque pedidos ajenos.
- DiMa pregunta en foráneos si el cliente espera en el chat o prefiere mensaje/llamada (`Preferencia_Contacto`).
- Diana deja "Mensaje para el cliente" en el dashboard; DiMa lo entrega en el chat (en vivo cada 30 s o cuando el cliente regresa con su folio). Campos `Preferencia_Contacto`, `Mensaje_Para_Cliente`, `Mensaje_Cliente_Entregado`.
- Con el cliente DiMa ya no menciona a Diana: dice "el equipo de logística" o "la gerencia".
- Aproximado de traslado (`api/_traslado.js`): km desde la salida de Culiacán x $10 x 4 con rutas de OpenStreetMap; DiMa lo da solo si el cliente lo pide. **Pendiente de Víctor:** comparar con Google (San Pedro dio 4 km desde la salida, puede ser bajo).
- Límite duro de 35 km desde la salida de Culiacán (chat, formulario y página); más lejos no se registra el pedido.
- Precios: regla de "paquetes primero" (100 personas Antonella = 2 x $5,400 = $10,800 + extras).
- Temporada alta (18 dic - 1 ene, fecha del evento): +70%, sin paquetes regulares, explicado con sutileza. Confirmado por Víctor: aplica a todos los servicios (Divanna y El Vaso Maíz). **Por confirmar:** fecha final (¿1 de enero o más?) y si el traslado también sube.
- **Mañana Víctor sube carpetas con las promociones de diciembre**: agregarlas a DiMa (como `referencias/`: fotos + textos y precios) y que DiMa las ofrezca en temporada.
- 104 pruebas pasan.
- Airtable: EVENTOS vacía para pruebas nuevas (se borraron los eventos de prueba).

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
