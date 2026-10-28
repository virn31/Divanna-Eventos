# Bot de Telegram del equipo

**Bot:** [@dimaclnbot](https://t.me/dimaclnbot) (creado con BotFather el 2026-10-27).

Bot interno (no es para clientes). Cada colaborador lo vincula una vez con su usuario y PIN
de la app, y desde ahí:

- Recibe las **emergencias y alertas de seguridad** (todo el equipo, menos quien la reporta).
- Diana y Víctor (Admin) reciben además los **pedidos nuevos**, los **cambios** que piden los
  clientes en el chat de DiMa y el **balance semanal**.
- Consultas: `/hoy`, `/eventos`, `/alertas`, `/pedidos` (solo Admin), `/salir`, `/ayuda`.

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

## Staff de El Vaso Maíz (`/staff`)

Las chicas de El Vaso Maíz no usan la app: todo les llega por Telegram.

**Alta (una vez por persona, en Airtable > COLABORADORES):** Nombre, Usuario (minúsculas, sin
espacios), PIN de 6 dígitos, **Rol = Staff**, **Coordinadora = Ángela** (o quien la dirija) y
**Activo**. Luego ella abre @dimaclnbot y escribe `/entrar suusuario suPIN`.

**Quién puede usar `/staff`:** solo Ángela, Diana y Víctor. Ángela necesita su renglón en COLABORADORES
(por ejemplo Rol "Encargada de evento") con la casilla **Coordina_Staff** marcada, y vincular su Telegram.

**Cómo se usa:**

1. Escribe `/staff`: aparecen los próximos eventos autorizados de El Vaso Maíz con cuántas
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
