# Continuidad entre sesiones de trabajo

Este archivo es la memoria del proyecto entre una sesión de Claude Code y la siguiente.
Víctor dice **"cerrar"** al terminar el día y **"continuar"** al día siguiente.

- Repo de trabajo (fuera de OneDrive): `C:\Users\virn3\Proyectos\Divanna-Eventos`
- Remoto: https://github.com/virn31/Divanna-Eventos
- Rama de trabajo: una rama por tema, que se une a `main` cuando Víctor pide publicar (`main` es producción y Vercel la despliega sola).

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

**Actualizado:** 2026-10-29 (cierre de la mañana) · **Rama de trabajo:** `main` (todo publicado; ramas del día ya unidas: `staff-en-app`, `diana-jefa`, `reporte-dia`) · **Producción:** `main` en `f926847`, despliegue verificado (caché `dima-brigadas-v11`). Rama aparte sin publicar: `entrenar-dima`. **257 pruebas pasan.**

**Acceso a Vercel (nuevo):** CLI instalada y enlazada (`vercel login` de Víctor; `.vercel/` y `.env.local` ignorados). Claude puede ver `vercel ls`, `vercel env ls` (solo nombres) y `vercel logs -e production -s 48h --json`. El sistema de permisos NO deja a Claude guardar secretos (`vercel env add`) ni desplegar a mano (`vercel redeploy`): se le pasa a Víctor el comando para `!` (en Git Bash usar rutas `/c/Users/...`). El conector MCP de Vercel sigue sin entrar al proyecto.

**Publicado hoy:**
- Ángela (gerente) desde la app: invita staff por evento (mismo código que `/staff`) y elige al **encargado de producción**; 🚗 junto al vehículo en el encabezado.
- **Encargado de producción:** cron diario 8:00 (`api/produccion-diaria.js`): lista desglosada por producto 2 días antes y el mismo día por Telegram, con "Tenemos todo / Reportar insumos"; respuestas a Ángela + Diana y Víctor.
- **Cambios de pedido:** `EVENTOS.Cambio_Cliente`; suenan en la app (push) y Telegram a Diana, Víctor y Ángela; Diana confirma o descarta en el dashboard y al confirmar se avisa al equipo (vuelven a tocar Enterado) y se reenvía la producción. DiMa: cambios con 24 h de anticipación; con menos, URGENTE. Si no se guarda, DiMa lo dice.
- **Diana tiene todo lo de Ángela** en el dashboard (staff, producción, "Pregúntale a DiMa").
- **Reporte financiero del día (fase 3):** 💰 en la app (líder y encargada): gastos con foto (dinero del negocio o propio), cobros, efectivo entregado, insumos → Diana aprueba o pide aclaración y marca reembolsos; Ángela ve la administración de El Vaso Maíz. Balance semanal solo cuenta lo aprobado. `api/finanzas.js` = función **12 de 12**.
- **Arreglado en Vercel:** faltaban `VAPID_*` (los avisos al teléfono NUNCA habían funcionado) y `CRON_SECRET` (los crons estaban abiertos). Ya cargados y desplegados.

**Airtable hoy:** EVENTOS `Encargado_Produccion`, `Produccion_Avisos`, `Produccion_Respuesta`, `Cambio_Cliente`; tablas nuevas REPORTES_DIA `tbllUK2N9ZDv2Bpdt` y COBROS `tblb8ADFukpm6nRZV`; GASTOS `Reporte`, `Pagado_Con`, `Reembolsado`, `Reportado_Por`.

**Pendiente de Víctor:**
1. **Todos tocan "Activar alertas"** en la app (antes no había llaves; nadie quedó suscrito). Cerrar y abrir la app para cargar la versión nueva.
2. **Borrar en BALANCES el duplicado** "Semana 2026-10-19 a 2026-10-25" creado hoy (`rec374o2IWhy1bBph`), que Claude generó por error al llamar el balance. Dejar el del 26-oct.
3. Probar con datos reales: un cambio de pedido desde la página (debe sonar a Diana), un reporte del día con **foto real** del ticket, y asignar un encargado de producción.
4. Google Calendar/Sheets: "invalid_grant: account not found" (la llave en Vercel no corresponde a la cuenta de servicio). Volver a bajar el JSON y cargar correo + llave del mismo archivo; Sheets espera los PDF de cotización.
5. Lo anterior: `/curso` → Ángela, alta de las chicas y de José, teléfono de Ángel (PWA desde Chrome), conteos de INVENTARIO, PIN de Diana, limpiar variables de Twilio/WhatsApp en Vercel.

**Siguiente (esta tarde, pedido de Víctor):**
1. **Identificador de los eventos:** hoy solo sale el folio; agregar **nombre y teléfono del cliente** (app, dashboard, Telegram).
2. **DiMa no debe volver a pedir los datos del evento** cuando el cliente abre su pedido desde la página para cambiarlo: debe tomarlos del expediente (hoy `verificarPedido` ya da fecha, hora, lugar y servicios, pero DiMa los vuelve a preguntar; revisar el aviso en `api/dima-chat.js` y el flujo de `registrar_pedido`).
3. **Reconocer al cliente por celular y nombre** y categorizarlo: decoradores (precio especial), clientes frecuentes, malos clientes (no pagan, cancelan sin aviso). Ya existen en CLIENTES `Es_Decorador`, `Semaforo_Cliente` (Verde/Amarillo/Rojo), `Tipo_Cliente`, `Nivel`, `Trust_Score`, `Pricing_Profile` y en EVENTOS `Requiere_Liquidacion_Anticipada`: revisar qué se usa antes de crear nada nuevo.
4. Después: recordatorio nocturno a quien no envió su reporte del día; decidir si se publica `entrenar-dima`; Fase 4 (proveedores y compras) y Fase 5 (recordatorios de checklist). Toda ruta nueva de Vercel requiere juntar funciones (ya son 12).
