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

**Actualizado:** 2026-11-03 noche · **Producción:** `main` en `fea6518` (caché v31). Ramas sin publicar: `produccion-staff-etapas` (para Ángela), `entrenar-dima`. **407 pruebas pasan** en `main`.

**Publicado 2026-11-03 noche, `main` fea6518 (rama `cobro-visible`):** caja **💵 Cobrar** en cada tarjeta (forma de pago, "Liquidó todo" o abono; se pliega al guardar; no sale si ya está pagado). Liquidado + recogido = `Estado Cerrado` (`cerrarSiTermino` en `api/_cargos.js`, al cobrar y al marcar recolección). Pagos desde el dashboard no cierran solos. Decisión en `docs/decisiones.md`. No probado en teléfono. Revertir: `git revert -m 1 fea6518`. Roles ya puestos: Eden `Gerente Divanna`, Mario `Gerente Casa Isabella`, Ángela `Lider de brigada` + casilla; ya entran y ven sus eventos.

**Incidente 2026-11-03 noche — "se cayeron los PIN":** a Eden, Ángela y Mario se les puso en Airtable un Rol "Gerente …" antes de publicar la rama que lo reconoce → "Usuario o PIN incorrecto" en la APK. Mario además tenía Activo desmarcado. Se corrigió con otro Claude con acceso a Airtable (roles de vuelta a `Lider de brigada`, Activo de Mario) y luego se **publicó `gerentes-por-negocio`** (`main` f6cc9da, caché v30; incluye 20f7adb: el Rol se lee sin espacios, porque en Airtable la opción es " Gerente Divanna"). **Regla:** nunca poner en Airtable un Rol que producción no conozca todavía. Revertir: `git revert -m 1 f6cc9da` y roles a `Lider de brigada`. Falta: en Airtable poner Eden → `Gerente Divanna` y Mario → `Gerente Casa Isabella` (Ángela sigue `Lider de brigada` + casilla) y probar en sus teléfonos que ven sus eventos. El token de Airtable de `keys\airtable dima os.txt` da 403 en esta base (no sirve). `produccion-staff-etapas`: al unirle `main` ya trae v31 → subir a v32.

**Arreglo publicado 2026-11-03, `main` f9f3138 (rama `arreglo-editar-pedido`):** en el dashboard, el ✏️ Editar de los eventos autorizados mostraba vacía la casilla "qué lleva" (el GET no mandaba `Servicios_Solicitados` en `eventos`). Solo cambia el API, sin subir caché. Revertir: `git revert -m 1 f9f3138`. Confirmado con Víctor: Ángela edita solo El Vaso Maíz desde la APK; Diana y Víctor desde el dashboard (no se le abre el dashboard a Ángela).

**Publicado hoy (2026-11-03), `main` f6584ea (rama `editar-pedido`):**
- ✏️ **Editar evento, cliente y pedido**: además de cliente/fecha/lugar/invitados, ahora se cambia **qué lleva** (un artículo por línea; en evento autorizado es también la lista de carga y se conservan las palomitas de lo que no cambió) y el **monto contratado** (solo Diana y Víctor, en el dashboard). Ángela en la app, solo El Vaso Maíz, sin monto.
- Casilla "avisar al equipo" (marcada por defecto): mismo aviso que un cambio del cliente confirmado (Telegram con Confirmar, push, se borra "Enterado", se reenvía producción). Google Calendar se actualiza. Decisión en `docs/decisiones.md` 2026-11-03.
- Caché **v29**. No probado en teléfono ni contra Airtable real. Revertir: `git revert -m 1 f6584ea`.

**Publicado el 2026-11-02, `main` 1f38c60 (rama `editar-evento-cliente`):**
- En la app **todos** (líder, asistente, encargada, gerente) ven nombre, teléfono (toca para llamar) y correo del cliente al inicio de Resumen: el encargado atiende al cliente de principio a fin.
- **✏️ Editar evento y cliente** (nombre, teléfono, correo, ubicación, fecha, invitados, fuera de la ciudad): Diana y Víctor en el dashboard (eventos y pedidos); Ángela en la app, solo eventos de El Vaso Maíz. Fecha o lugar nuevos se pasan a Google Calendar. Ojo: nombre/teléfono/correo son del registro de CLIENTES (cambian en todos los eventos de ese cliente).
- Verificado que producción sirve la versión nueva (caché v27). No probado en teléfono ni contra Airtable real. Revertir: `git revert -m 1 1f38c60`.
- El staff (solo Telegram) no ve el teléfono del cliente; Víctor no lo pidió.

**Rama `produccion-staff-etapas` (para Ángela, El Vaso Maíz; detalle en `docs/decisiones.md` 2026-11-02):**
- Equipo de producción en "Asignar"; solo el encargado tiene **🚀 Listo para staff**; etapas por Telegram para el staff (`Estatus_Logistico`); **🆘 SOS** por Telegram (`/sos`, `api/_etapas.js`).
- Se le unió `main` hasta 1f38c60 (caché v28). **Al volver a unirle `main` (trae v29) subir la caché a v30** y correr pruebas (las de `editar` y `_cambios.js` cambiaron).
- **BLOQUEA PUBLICAR:** crear en Airtable, tabla EVENTOS, `Equipo_Produccion` (link a COLABORADORES, varios) y `Produccion_Lista` (fecha con hora). Sin ellos falla "Guardar y avisar" de la app.

**Siguiente, en orden:**
1. Víctor, Diana y Ángela prueban en el teléfono ✏️ Editar con el pedido (cerrar y abrir la APK si no aparece) y que a la brigada le llegue el aviso con Confirmar.
2. Crear los 2 campos de Airtable → probar `produccion-staff-etapas` en Preview (asignar equipo, Listo para staff, etapas, SOS con ubicación) → unir a `main` → `/configurar` en el bot → decidir si se manda a todos el botón 🆘.
3. Reconocer y categorizar clientes; Fase 4 proveedores; pago automático.

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs`, `vercel curl --deployment <url>`). Claude no puede `vercel env add` ni redesplegar producción: comando para `!` de Víctor. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en Downloads (nunca al repo). Herramientas locales fuera del repo en `Proyectos\herramientas-dima` (`drive.js` árbol, `lecturas.js`, `mover-carpeta.js`, `bajar-fotos.js`, `probar-promos.js`/`probar-portarretrato.js` para probar la página en Edge con Drive simulado). Git en esta máquina: commit y merge con `-c user.name=virn31 -c user.email=virn31@gmail.com`.

**Pendientes de Víctor:**
1. ~~Precios de Casa Isabella~~ RESUELTO 2026-11-01 (ddb8c00): valen los de los flyers (L-J $1,800 sin mantel, salida 10 pm, mesa extra $400; V-D $3,000 / 50 personas $4,000). Por confirmar: mesa extra de fin de semana ($500) y tope de $4,500 para 70 a 80 personas, que no vienen en los flyers.
2. Los 2 flyers de Casa Isabella se leyeron como "de la competencia"; ya se corrigió la instrucción, pero las lecturas viejas siguen hasta que cambie la imagen (borrar su descripción en Drive para que se relean).
3. De antes: precios en `INVENTARIO.Precio_Reposicion`; borrar en Google Calendar EVT-182088, EVT-750236, EVT-413125, EVT-581563; probar en el teléfono `/daño`, cobro desde la ficha, foto de comanda y recibo; "Activar alertas".
