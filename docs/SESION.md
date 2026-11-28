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

**Actualizado:** 2026-11-28 · **Rama de Estado:** `main` · **Producción:** `main` en `a498841`. **716 pruebas pasan.**

**Hecho el 2026-11-28** (sesión en la nube; detalle en `docs/decisiones.md`, 3 entradas de esa fecha):
- Diana no podía corregir EVT-463812: la tarjeta (resumen "🪑 Divanna") y el inventario salían de los productos que adivinó la comanda (2 arcos, 2 marcos y un túnel de luces que no cotizó) y ✏️ Editar no los cambiaba. De 11 eventos editados a mano, 4 tenían el resumen distinto a lo escrito (EVT-596148, EVT-675139 y EVT-543721 ya pasaron; no se tocaron).
- **Tal cual:** lo que el equipo captura a mano (comanda por Telegram, Leer comanda de la app, formulario del calendario) se copia exactamente como lo escribió Diana; en Divanna solo mobiliario y vajilla pasan al catálogo (`CLAVES_TAL_CUAL` en `_comanda.js`); decoración, paquetes y cambios de mantel se quedan en el texto; lo que no se entienda, DiMa lo pregunta. La tarjeta del dashboard muestra sus renglones (`resumenTalCual`). Al editar el pedido se vuelve a leer (máx. 25 s) y el monto no cambia. La DiMa de la página no cambia.
- Candado general en la comanda (`sinRepetirPaquete`): no repite lo que trae un paquete y sin "túnel" escrito no hay túnel.
- **Anticipo por Telegram con un toque:** al guardar la comanda, botones Efectivo / Transferencia / Depósito (`cd:ae|at|ad` en `_cuadre.js`) registran el monto del papel; ✍️ para otro monto. La nota pasa a "registrado" (no cobra doble).
- Datos corregidos a mano en Airtable: EVT-463812 y EVT-526052 sin productos de catálogo y con el resumen tal cual (el dinero no se tocó). Su evento de Google Calendar puede seguir con la descripción vieja hasta el siguiente cambio del evento.
- Caché de la app: `dima-brigadas-v51`.

**Siguientes pasos:**
1. Confirmar con Diana la próxima comanda por Telegram: renglones tal cual, preguntas de DiMa y botones del anticipo. No se pudo ver el despliegue de Vercel desde la nube (el conector dio 403).
2. Revisar que la relectura al editar no pase de los 60 s de Vercel en un pedido largo.
3. Si Diana quiere que El Vaso Maíz también vaya tal cual: hoy sigue por catálogo porque de ahí sale la lista de producción.
4. Pendientes del 2026-11-23: Diana sube los 2 flyers corregidos (3926) → reemplazar `paquetes/vasomaiz-paquetes-1-a-6.jpg` y `paquetes/vasomaiz-sabritas-preparadas.jpg`; confirmar que DiMa leyó las 8 imágenes nuevas (`node lecturas.js`).
5. Siguen los pendientes del 2026-11-11 (abajo).

**Lo anterior (2026-11-11):**

**Hecho el 2026-11-11** (detalle en `docs/decisiones.md`, entradas de esa fecha):
- Recibo (`api/_sheets.js`): los artículos salen de la descripción del evento (`Items_Detallados_Cotizacion` / `Servicios_Solicitados`), un renglón por línea; después los cambios y extras de mantel con precio, cargos y descuento. "Ambos" sigue por catálogo. Si no caben, se insertan renglones en la pestaña (metadato `dima_renglones_extra`) y el total y lo pagado bajan.
- Reembolsos: en 🔍 Cuadre → 💵 Reembolso (app y Telegram) pregunta "¿todo o cuánto?"; 🔁 Reembolsos tiene 🧾 Últimos pagos con ↩️ Deshacer (solo el último pago de cada persona).
- Mario: corregido a mano en Airtable (pago del 10-nov a $1,118.84; Resistol, Gasolina y Cable otra vez pendientes = $1,100). A él le llegó "ya quedas al corriente": avisarle.
- Calendario: Diana y Víctor también tienen "📋 Abrir ficha completa" (lleva a la ficha en 🗓️ Eventos del dashboard).
- Origen: todos los caminos nuevos lo guardan; los eventos del 2 al 5 de noviembre se quedan sin llenar (decisión de Víctor).
- Se revisó qué le llega a Ángela por Telegram (gerente VM + producción + coordinadora de staff + Brigada El Vaso Maíz). Sin cambios.

**Siguientes pasos, en orden:**
1. Víctor: mandar 🧾 Mandar recibo de EVT-715919 (debe traer las 6 cosas) y revisar que el total quede en su lugar la primera vez que salga un pedido largo (ej. EVT-732433, 13 líneas): la inserción de renglones no se probó contra la hoja real.
2. Avisarle a Mario que se le deben $1,100; probar un abono en Cuadre y ↩️ Deshacer en un caso real.
3. Preguntarle a Eden qué eventos capturó el 11-nov: en Airtable solo hay 2 suyos (EVT-933849, EVT-566367, del 10-nov) y ninguna comanda en borrador.
4. Pendientes visuales: emojis de `dinero.js`/`alertas.js` y de toasts; `manifest.json` aún con `#0c0b10`; la barra del dashboard se sale en teléfono.
5. Lo que seguía del 2026-11-09: `/configurar` y `/reglas` (deben salir 4); probar `/entrenamiento` y `/desactivar`; Eden, Mario y Ángela prueban en el teléfono; en ~4 semanas decidir si DiMa es rentable.

**Decisiones pendientes de Víctor:**
- Recibo de eventos "Ambos": hoy sale por catálogo (la descripción mezcla los dos negocios). ¿Se reparte a mano o se deja así?
- CONVERSACIONES: 37 filas vacías (la última del 17-jul) y ningún código la usa; las pláticas van en `EVENTOS.Notas`. ¿Se deja o se vuelve a llenar?
- Recetas por producto, si se quiere que el aviso de compras diga kilos y litros.
- "(ayer)" en el resumen: la cuenta incluye todos los eventos pasados sin aclarar, no solo los de ayer. ¿Se deja o se cuenta solo ayer?
- `api/_dima-catalogo.js:111` aún dice "mesa cuadrada o redonda"; hoy manda la regla de sillas. ¿Se corrige el catálogo?
- Casa Isabella: confirmar mesa extra de fin de semana ($500) y tope de $4,500 para 70 a 80 personas, que no vienen en los flyers.

**Idea aprobada para después (2026-11-06):** decirle a DiMa "agrega tambor plateado, $250, tenemos 4" y que quede en una tabla PRODUCTOS de Airtable. Requiere pasar el catálogo a Airtable. Faltan tambores y figuras de coroplast de varias medidas.

**Pendientes viejos de Víctor:** precios en `INVENTARIO.Precio_Reposicion`; borrar en Google Calendar EVT-182088, EVT-750236, EVT-413125, EVT-581563; los 2 flyers de Casa Isabella leídos como "de la competencia" (borrar su descripción en Drive para que se relean); probar en teléfono `/daño`, cobro desde la ficha, foto de comanda y "Activar alertas".

**Reglas:** nunca poner en Airtable un Rol que producción no conozca todavía (incidente 2026-11-03). No agregar renglones a mano en la pestaña de un recibo: DiMa escribiría el total en la fila vieja.

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs`, `vercel curl --deployment <url>`). Claude no puede `vercel env add` ni redesplegar producción: comando para `!` de Víctor. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en Downloads (nunca al repo). Herramientas locales fuera del repo en `Proyectos\herramientas-dima`. El token de `keys\airtable dima os.txt` da 403 en esta base. Git en esta máquina: commit y merge con `-c user.name=virn31 -c user.email=virn31@gmail.com`. En las sesiones en la nube Airtable se usa por el conector (MCP), sin token.
