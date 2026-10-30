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

**Actualizado:** 2026-10-30 (cierre) · **Rama de trabajo:** `main` (todo publicado; ramas del día `arreglos-apk` y `homepage` ya unidas) · **Producción:** `main` en `1dae774` + este cierre, despliegue verificado (caché `dima-brigadas-v23`). Rama aparte sin publicar: `entrenar-dima`. **335 pruebas pasan.**

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs -e production -s 48h --json`); Claude no puede `vercel env add` ni `vercel redeploy`. Las variables marcadas sensitive salen como `[SENSITIVE]` en `vercel env pull` (por ejemplo `GOOGLE_CALENDAR_ID`): no se pueden leer. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en `Downloads\dima-os-513103-eb75c647cb3d.json` (nunca al repo); entra a las dos hojas (`Divanna_Pedidos`, `VasoMaiz_Pedidos`).

**Publicado hoy:**
- **Comanda por foto** arreglada (app y Telegram daban error): la API rechazaba `forma_anticipo` con enum + null. Prueba que revisa el esquema.
- **💵 Registrar pago** en el calendario (Diana y Víctor): anticipo, abono o liquidación como pago a Diana + recibo PDF.
- **Ficha de identificación por evento** (app del equipo y dashboard de Diana): ficha corta que se abre al tocarla. **💰 Dinero** (líder, encargada, gerente, Admin; no asistente): total, pagado, falta, cliente y teléfono; registrar cobro (la brigada al reporte del día, también de otro día con `desdeFicha`; Admin con `registrar_pago`); **daños y faltantes** con `INVENTARIO.Precio_Reposicion` (o monto a mano marcado para revisar), suman al total del cuadre y del recibo, aviso a Admin por Telegram. Código: `api/_cargos.js`, `brigadas/dinero.js`. Campos nuevos: `INVENTARIO.Precio_Reposicion`, `EVENTOS.Cargos_Extra`, `EVENTOS.Cargos_Extra_Total`.
- **DiMa ya no se traba después de mandar fotos**: sabe de qué es cada foto, la comenta y no repite las que el cliente ya vio.
- **La conversación con DiMa ya no se muestra** en el dashboard (sigue en `EVENTOS.Notas`).
- **Homepage nuevo** inspirado en DuoFankaar: titular grande, cinta de fotos, servicios numerados (con Casa Isabella), paquetes con precio "desde", galería real, preguntas frecuentes, botón flotante en celular. Fotos en `img/home/` recortadas sin texto ni teléfonos. Precios copiados de `_dima-catalogo.js` (si cambian, actualizar los dos).

**Limpieza para iniciar en real (30 oct):** los 5 eventos eran prueba (Víctor lo confirmó). EVT-182088, EVT-750236, EVT-413125 y EVT-581563 quedaron Cancelado + Autorización NO + Cerrado (EVT-358132 ya lo estaba), sin avisar al equipo. Se borraron sus 2 anticipos de prueba en COBROS. En las hojas, los renglones EVT-581563 y EVT-182088 dicen "Cancelado (prueba)". No se tocaron: reportes del día (parecen gastos reales), clientes de prueba, el renglón 2 de cada hoja ni las pestañas EVT-.

**Pendientes de Víctor:**
1. **Borrar en Google Calendar ("DiMa Eventos") los 4 eventos de prueba:** EVT-182088 (26 dic), EVT-750236 (20 dic), EVT-413125 (5 nov), EVT-581563 (15 dic). Claude no tiene el ID del calendario.
2. Poner **precios de reposición** en INVENTARIO (`Precio_Reposicion`).
3. Probar en el teléfono: daño/faltante, cobro desde la ficha, foto de comanda (Descartar si es prueba), recibo.
4. Si quiere, borrar en las hojas las pestañas EVT-581563 y EVT-182088 y sus renglones, y en BALANCES el duplicado `rec374o2IWhy1bBph`.
5. De antes: todos tocan "Activar alertas"; compartir "DiMa Eventos" con divannaeventos@gmail.com y Ángela.

**Siguiente (pedido de Víctor):**
1. **Carpeta en Google Drive con subcarpetas** para que la página y DiMa sean dinámicas: paquetes actualizados, precios por temporada, promociones (con fechas) y galería. DECIDIDO: Google Drive (Diana sube sola). Antes: activar **Google Drive API** en `dima-os-513103` y compartir la carpeta como Editor con la cuenta de servicio. Propuesta de estructura: `divanna/paquetes`, `vaso-maiz/paquetes`, `casa-isabella`, `promociones`, `temporadas`, `galeria`. Ojo: no hay funciones libres (12 de 12); leerlo desde `dima-chat` o una acción existente, con caché.
2. Fotos originales de El Vaso Maíz, Casa Isabella y montajes de Divanna (Instagram/Facebook no se pueden leer sin sesión; Chrome con la extensión estaba desconectado).
3. Pendientes de antes: DiMa no repide datos al abrir un pedido existente; reconocer y categorizar clientes; Fase 4 proveedores; pago automático.
