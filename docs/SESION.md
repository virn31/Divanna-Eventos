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

**Actualizado:** 2026-11-10 · **Rama de Estado:** `tema-sobrio-y-carga` · **Producción:** `main` en GitHub sigue en `c948836` (caché v36). **547 pruebas pasan.**

**Publicación a medias:** la unión `c89f670` ("Publicar: marcar la carga sin repintar y tema sobrio de la app") está hecha en `main` **local**, pero el push a `main` no se hizo (permiso de despliegue negado a Claude). Víctor: `! git push origin main` desde el repo. Si al continuar `main` local ya no tiene esa unión, rehacerla: `git switch main`, `git pull`, `git merge --no-ff tema-sobrio-y-carga`. Revertir después de publicar: `git revert -m 1 c89f670` y push.

**Hecho el 2026-11-10** (commit `bad8413`; detalle en `docs/decisiones.md`, entrada de esa fecha):
- Cargar: marcar un artículo es instantáneo (contador N/M y aviso "Falta marcar todo"), sin repintar ni perder el scroll; ignora doble toque; si falla revierte con mensaje.
- Tema sobrio en `brigadas/index.html` y `tema.css`: solo Inter 400-700; radios `--radio-sm/md/lg` (10/14/18); emojis de estado → SVG (`ICONOS`/`ico()`); marca solo como acento; campos 16 px y controles 44 px; login sin degradado; `theme-color` `#080707`; `tema.css` sin `!important`. Caché `dima-brigadas-v38`.
- Efecto en el dashboard: vuelven la franja de color de cada evento, el rojo de emergencias y las rayas de días bloqueados (los `!important` los tapaban).
- Verificado en local con Playwright y datos inventados (390 px y escritorio): sin texto cortado ni encimados.

**Siguientes pasos, en orden:**
1. Víctor: `git push origin main` y esperar el deploy de Vercel; confirmar caché v38 en `https://divanna-eventos.vercel.app/brigadas/sw.js`.
2. En un teléfono (cerrar y abrir la APK): marcar 3 artículos en Cargar sin que salte la lista; ver pestañas, alertas y el dashboard con la franja de color.
3. Pendientes visuales: emojis de `dinero.js`/`alertas.js` y de toasts; `manifest.json` aún con `#0c0b10`; la barra del dashboard se sale en teléfono (`dashboard.html`); revisar con datos reales si la etiqueta de El Vaso Maíz sale morada.
4. Lo que seguía del 2026-11-09: `/configurar` y `/reglas` (deben salir 4); probar `/entrenamiento` y `/desactivar`; aviso de compras a Ángela a las 8:00; Eden, Mario y Ángela prueban en el teléfono; `Origen` en captura manual; en ~4 semanas decidir si DiMa es rentable.

**Decisiones pendientes de Víctor:**
- CONVERSACIONES: 37 filas vacías (la última del 17-jul) y ningún código la usa; las pláticas van en `EVENTOS.Notas`. ¿Se deja o se vuelve a llenar?
- Recetas por producto, si se quiere que el aviso de compras diga kilos y litros.
- "(ayer)" en el resumen: la cuenta incluye todos los eventos pasados sin aclarar, no solo los de ayer. ¿Se deja o se cuenta solo ayer?
- `api/_dima-catalogo.js:111` aún dice "mesa cuadrada o redonda"; hoy manda la regla de sillas. ¿Se corrige el catálogo?
- Casa Isabella: confirmar mesa extra de fin de semana ($500) y tope de $4,500 para 70 a 80 personas, que no vienen en los flyers.

**Idea aprobada para después (2026-11-06):** decirle a DiMa "agrega tambor plateado, $250, tenemos 4" y que quede en una tabla PRODUCTOS de Airtable. Requiere pasar el catálogo a Airtable. Faltan tambores y figuras de coroplast de varias medidas.

**Pendientes viejos de Víctor:** precios en `INVENTARIO.Precio_Reposicion`; borrar en Google Calendar EVT-182088, EVT-750236, EVT-413125, EVT-581563; los 2 flyers de Casa Isabella leídos como "de la competencia" (borrar su descripción en Drive para que se relean); probar en teléfono `/daño`, cobro desde la ficha, foto de comanda, recibo y "Activar alertas".

**Regla (incidente 2026-11-03):** nunca poner en Airtable un Rol que producción no conozca todavía.

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs`, `vercel curl --deployment <url>`). Claude no puede `vercel env add` ni redesplegar producción: comando para `!` de Víctor. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en Downloads (nunca al repo). Herramientas locales fuera del repo en `Proyectos\herramientas-dima`. El token de `keys\airtable dima os.txt` da 403 en esta base. Git en esta máquina: commit y merge con `-c user.name=virn31 -c user.email=virn31@gmail.com`.
