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
