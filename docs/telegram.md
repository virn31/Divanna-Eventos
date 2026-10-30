# Bot de Telegram del equipo

**Bot:** [@dimaclnbot](https://t.me/dimaclnbot) (creado con BotFather el 2026-10-27).

Bot interno (no es para clientes). Cada colaborador lo vincula una vez con su usuario y PIN
de la app, y desde ahí:

- Recibe las **emergencias y alertas de seguridad** (todo el equipo, menos quien la reporta).
- Diana y Víctor (Admin) reciben además los **pedidos nuevos**, los **cambios** que piden los
  clientes en el chat de DiMa y el **balance semanal**.
- Consultas: `/hoy`, `/eventos`, `/alertas`, `/pedidos` (solo Admin), `/salir`, `/ayuda`.
- `/anuncio texto` (solo Admin): manda el texto tal cual, con sus saltos de línea, a todo el equipo con Telegram vinculado (Admin, líderes, asistentes y encargadas; el staff no) y responde a cuántos les llegó.

Para marcar checklist o cambiar estatus se sigue usando la app.

## Crear el bot (una sola vez, lo hace Víctor)

1. En Telegram abre **@BotFather** (el oficial, con palomita azul) y manda `/newbot`.
2. Nombre visible: `DiMa Equipo`. Usuario: `dimaclnbot` (ya creado).
3. BotFather te da un **token** (algo como `123456:ABC...`). Es la llave del bot: no la compartas
   ni la pegues en chats.
4. Manda a BotFather `/setjoingroups`, elige el bot y luego `Disable` (el bot solo trabaja por privado).

## Variables en Vercel (Production)

| Key | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | el token de BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | un texto aleatorio; genéralo como el `SESSION_SECRET`: en PowerShell `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" \| Set-Clipboard` y pega con Ctrl+V |

Guarda también el `TELEGRAM_WEBHOOK_SECRET` en un lugar seguro: lo necesitas en el paso siguiente.

## Conectar el bot con la página (después del merge a producción)

El bot solo funciona con la URL de producción (los previews de Vercel están protegidos y Telegram
no puede entrar). En PowerShell, en tu computadora:

```powershell
$token = Read-Host "Token del bot"
$secreto = Read-Host "TELEGRAM_WEBHOOK_SECRET"
Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook" -Method Post -ContentType "application/json" -Body (@{ url = "https://divanna-eventos.vercel.app/api/telegram"; secret_token = $secreto; allowed_updates = @("message", "callback_query") } | ConvertTo-Json)
Invoke-RestMethod "https://api.telegram.org/bot$token/setMyCommands" -Method Post -ContentType "application/json" -Body (@{ commands = @(
  @{ command = "hoy"; description = "Tus eventos de hoy" },
  @{ command = "eventos"; description = "Tus próximos eventos" },
  @{ command = "alertas"; description = "Emergencias y alertas de hoy" },
  @{ command = "pedidos"; description = "Pedidos por cotizar (Admin)" },
  @{ command = "ayuda"; description = "Qué puedo hacer" },
  @{ command = "salir"; description = "Desvincular este Telegram" }
) } | ConvertTo-Json -Depth 4)
```

Las dos respuestas deben decir `ok : True`. Si cambias el token o el secreto, repite este paso.

## Cómo se vincula cada colaborador

1. Busca **@dimaclnbot** en Telegram (o abre https://t.me/dimaclnbot) y toca **Iniciar**.
2. Escribe `/entrar tuusuario tuPIN` (los mismos de la app). El bot borra ese mensaje en cuanto lo
   lee, para que el PIN no quede en el chat.
3. Listo. Para desvincular: `/salir`. Si alguien deja el equipo, basta con desmarcar `Activo` en
   COLABORADORES: deja de recibir avisos y el bot ya no le responde.

## Manual con /instrucciones

Cualquiera vinculado escribe `/instrucciones` y el bot le contesta con un menú de temas en botones
(instalar la app, eventos, alertas, `/staff` si coordina, si algo falla); cada botón manda ese tema y el
menú otra vez. Las chicas del staff solo ven sus temas. El texto vive en `api/_instrucciones.js` y es el
mismo que `docs/manual-equipo.md`. Para que salga en la lista de comandos de Telegram, un Admin vuelve a
escribir `/configurar`.

## Botón "Confirmar" en los avisos de un evento

Cuando a una brigada o encargada se le asigna un evento desde el dashboard, o se le mandan
instrucciones, el Telegram trae el botón **✅ Confirmar**. Al tocarlo queda "Enterado" en el
evento (lo mismo que el botón de la app), el mensaje se marca "✅ Confirmado por …" y a Diana y
Víctor les llega el aviso. Solo funciona si el bot acepta botones: después de publicar, un Admin
escribe `/configurar` una vez. Las chicas de El Vaso Maíz confirman con "Sí puedo / No puedo"
en su invitación de `/staff`.

## Staff de El Vaso Maíz (`/staff`)

Las chicas de El Vaso Maíz no usan la app: todo les llega por Telegram.

**Alta, sin usuario ni PIN:** en `/staff` toca **➕ Agregar personal** y contesta con nombre y
teléfono (ej. `Isabella López 6671234567`). El bot la da de alta (Rol Staff, Coordinadora = Ángela)
y te da un **enlace personal** (`t.me/dimaclnbot?start=…`). Mándaselo por mensaje: ella solo lo toca
y le da **Iniciar** en Telegram, una sola vez. A Ángela le llega "📲 Isabella ya activó sus mensajes".
(Telegram no deja que un bot le escriba a alguien que nunca lo abrió; por eso ese único toque.)
Si la pierde, en la lista del evento toca su nombre con 📵 y el bot te da el enlace otra vez.

**Quién puede usar `/staff`:** solo Ángela, Diana y Víctor. Ángela necesita su renglón en COLABORADORES
(por ejemplo Rol "Encargada de evento") con la casilla **Coordina_Staff** marcada, y vincular su Telegram.

**Cómo se usa:**

1. Escribe `/staff` y toca **📋 Asignar a evento**: aparecen los próximos eventos autorizados de El Vaso Maíz con cuántas
   chicas van confirmadas de las que se necesitan.
2. Toca un evento: aparecen sus chicas. ✅ confirmó · ⏳ invitada · ❌ no pudo · ⛔ ya tiene otro
   evento a esa hora · 📵 no ha vinculado su Telegram.
3. Toca los nombres que quiere (☑️) y luego **📨 Invitar**.
4. A cada una le llega: "Hola Isabella 👋 Ángela te programó un evento: …" con los datos (sin
   montos ni datos de pago), "Porfa confírmame si puedes acudir, para que llegues antes (salida …)
   y prepares todo para el evento" y los botones **✅ Sí puedo / ❌ No puedo**.
5. Cada respuesta le llega a la coordinadora ("✅ Isabella confirmó EVT-… · 3 de 4"), y cuando
   se completa: "🎉 Equipo completo". Diana lo ve en el dashboard en cada evento.

Diana y Víctor (Admin) ven a todas las chicas; Ángela, a las que tienen Coordinadora = Ángela.

**Activar los botones (una sola vez, después de publicar):** Diana o Víctor escriben
`/configurar` en el bot. Responde "✅ Listo" cuando el webhook ya acepta los botones.

## Daños y faltantes (`/daño` o `/dano`)

Líder, encargada, gerente y Admin (`veDinero`). DiMa (Claude, herramienta `anotar_danos`, `strict`) reconoce el evento (sus eventos de los últimos 5 días y mañana, o el folio escrito) y los artículos de INVENTARIO; el monto lo calcula el servidor con `Precio_Reposicion`: perdido al 100%, daño menor al 10% (`PORCENTAJE_DANO_MENOR` en `api/_cargos.js`). El borrador queda en `EVENTOS.Cargos_Extra` con `pendiente` y `lote` (no suma al total) y el mensaje trae `dn:s|x:<evento>:<lote>`. Registrar lo confirma, suma a `Cargos_Extra_Total` y avisa a los Admin; Cancelar lo borra. Solo quien lo anotó o un Admin. Artículos sin precio quedan marcados para que Diana ponga el monto. La lista de comandos (`dano`) se actualiza con `/configurar`.
