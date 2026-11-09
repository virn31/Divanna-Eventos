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

**Actualizado:** 2026-11-09 · **Rama de Estado:** `entrenar-dima` (igual a `main` más este commit de estado) · **Producción:** `main` en `b3c9c2b`, caché v36, **542 pruebas pasan**. Revertir lo publicado: `git revert -m 1 b3c9c2b` y push.

**Hecho y publicado el 2026-11-09** (detalle en `docs/decisiones.md`, dos entradas de esa fecha):
- `/entrenamiento`, `/reglas` y `/desactivar N` en Telegram, solo Admin (`api/_entrenamiento.js`). Solo guarda con ✅ o con "sí" contestado encima del borrador; un "sí" suelto no confirma.
- Panel "🧠 Entrenar a DiMa y ver sus reglas" en Inicio del dashboard de Admin, con las reglas activas abiertas.
- 4 reglas activas en CORRECCIONES_DIMA (autor Víctor): manteles, mesas y paquetes, sillas, y estilos ("avisa que primero tiene que quedar confirmado").
- Nota `PENDIENTE COLORES:` → `COLORES DEFINIDOS:` y `PROVEEDOR EXTERNO:` en `EVENTOS.Instrucciones_Equipo` (`api/_colores.js`); aviso al gerente de Divanna.
- Selector de manteles: Liso con 16 colores; corrugado y lentejuela con color escrito. La clave interna sigue siendo `basico`.
- Eden sin Casa Isabella aunque se la asignen (alcance, operación y calendario). Eden, Mario y Ángela ven todo su negocio. Origen manual = primer nombre de quien capturó.
- Aviso de compras a la gerente de El Vaso Maíz a 7 y 2 días (`avisosCompras`, cron diario 8:00). Dice productos y piezas, no kilos: no hay recetas.
- Resumen de Telegram: "N eventos no cuadran (ayer)". `.gitignore` con `.claude/` y `*.bak`.

**A medias:** nada de código. Este commit de estado está solo en `entrenar-dima`; en `main` este archivo sigue con el estado anterior hasta la próxima publicación.

**Verificado en producción:** caché v36, panel de reglas, selector y 401 sin sesión. **Sin probar en real:** comandos del bot, nota de colores con un cliente y el aviso de compras.

**Siguientes pasos, en orden:**
1. Víctor: `/configurar` en Telegram y `/reglas` (deben salir 4).
2. Probar `/entrenamiento` con una regla de prueba y quitarla con `/desactivar`.
3. Revisar que a Ángela le llegue el aviso de compras en el cron de las 8:00 (si hay eventos de El Vaso Maíz autorizados en los próximos 7 días).
4. Eden, Mario y Ángela prueban en el teléfono (cerrar y abrir la APK): sus eventos, 👷 Asignar, ✏️ Editar, 💵 Cobrar; Eden sin Casa Isabella.
5. Evento de prueba capturado a mano: `Origen` = nombre de quien capturó.
6. En ~4 semanas, con el balance por origen, decidir si DiMa es rentable. Víctor: `/login` con el plan Pro y bajar el límite de gasto en la consola.

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
