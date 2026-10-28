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
**Confirmado:** sube todo, Divanna y El Vaso Maíz. **Por confirmar:** si "entrando el año" termina el 1 de enero o se extiende, y si el traslado también sube. Las promociones de diciembre llegan en carpetas aparte.
