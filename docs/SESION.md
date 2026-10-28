# Continuidad entre sesiones de trabajo

Este archivo es la memoria del proyecto entre una sesión de Claude Code y la siguiente.
Víctor dice **"cerrar"** al terminar el día y **"continuar"** al día siguiente.

- Repo de trabajo (fuera de OneDrive): `C:\Users\virn3\Proyectos\Divanna-Eventos`
- Remoto: https://github.com/virn31/Divanna-Eventos
- Rama de trabajo actual: `agenda-inventario` (nunca trabajar directo en `main`; `main` es producción).

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

**Actualizado:** 2026-10-28 (tarde) · **Rama:** `agenda-inventario` (sin merge) · **Producción:** `main` en 13f1aa3 = PR #4 (`dima-pedido-existente`) fusionado.

**En producción:** todo lo de los PR #1 a #4: sin WhatsApp, chat de DiMa, app del equipo con roles y PIN, alertas push, bot de Telegram, vista equipo, GPS en alertas, pedido existente con folio, mensaje de Diana al cliente, traslado aproximado, límite de 35 km, paquetes primero y temporada alta.

**En la rama `agenda-inventario` (fase 1 de agenda e inventario, falta publicar):**
- `api/_productos.js`: catálogo con claves, piezas de El Vaso Maíz (3 a 4 min por pieza, equipos de 2), mobiliario por categoría y ventanas de ocupación (mobiliario todo el día del evento hasta la 1 pm del día siguiente; manteles +48 h; Casa Isabella solo las horas; Vaso Maíz sale 30 min antes).
- DiMa pregunta la hora y registra `productos` con clave; EVENTOS guarda `Hora_Inicio`, `Horas_Servicio`, `Productos`, `Piezas_Vaso_Maiz`, `Personal_Requerido`, `Resumen_Capacidad`.
- Modelo, color y cantidad exactos: `EVENTOS.Articulos` (artículos de INVENTARIO). Dashboard: editor de hora, productos y artículos, aviso "🎨 Falta asignar modelo y color". App: "🕒 Empieza", personas y "📦 Cargar exacto". `CACHE_NAME` = `dima-brigadas-v5`.
- Airtable (base de producción, solo campos y datos nuevos): 7 campos en EVENTOS, `INVENTARIO.Categoria` con 87 artículos de Divanna clasificados (copas en "Copa globo" y "Copa francesa"), Casa Isabella como 1 unidad.
- 126 pruebas pasan.

**Pendiente de Víctor:**
1. Conteos que faltan en INVENTARIO (por la tarde): aros, mamparas, shimmer, mesitas, tapetes, arcos, túneles, letras/números LED, mesa de honor, cubiertos, vasos, platos trinche/grueso, servilletas, manteles de lentejuela y corrugado, centros de mesa. Un renglón por modelo y color, con su `Categoria`.
2. Lista de proveedores aliados (precio = ~10% menos que el nuestro, pedir con 48 h mínimo, ideal una semana).
3. Rutas de Divanna: cuántos pedidos caben por ruta y por brigada (hoy 2 o 3).
4. Lo anterior de PIN de Diana, variables `VAPID_*`, alta de brigadas, `assetlinks.json` y limpieza de Twilio (ver decisiones y CLAUDE.md).

**Siguientes pasos:**
- Publicar `agenda-inventario` (PR con permiso de Víctor) y probar en el dashboard: autorizar un pedido con hora, productos y artículos exactos; ver "Cargar exacto" en la app.
- Fase 2: semáforo de disponibilidad (🟢/🟡/🔴) cruzando eventos que se traslapan con INVENTARIO por artículo y con el personal del día; DiMa lo consulta antes de registrar.
- Fase 3: gastos y entradas por brigada (`MOVIMIENTOS`, origen del dinero, reembolsos). Fase 4: proveedores y compras de insumos. Fase 5: recordatorios de checklist por Telegram (7, 3 y 1 día antes).
