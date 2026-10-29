# Continuidad entre sesiones de trabajo

Este archivo es la memoria del proyecto entre una sesión de Claude Code y la siguiente.
Víctor dice **"cerrar"** al terminar el día y **"continuar"** al día siguiente.

- Repo de trabajo (fuera de OneDrive): `C:\Users\virn3\Proyectos\Divanna-Eventos`
- Remoto: https://github.com/virn31/Divanna-Eventos
- Rama de trabajo actual: `staff-telegram` (nunca trabajar directo en `main`; `main` es producción).

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

**Actualizado:** 2026-10-28 (noche) · **Rama:** `staff-telegram` (sin merge) · **Producción:** `main` en ed74908 = fase 1 de agenda + semáforo (merges locales, sin PR).

**En producción:** todo lo de los PR #1 a #4 (sin WhatsApp, chat de DiMa, app con roles y PIN, push, Telegram, vista equipo, GPS, pedido existente, mensaje de Diana al cliente, traslado, 35 km, paquetes primero, temporada alta) y la fase 1 de agenda. Verificado: chat de DiMa responde con la API real.

**En la rama `staff-telegram` (falta publicar):** staff de El Vaso Maíz por Telegram: Rol "Staff", `COLABORADORES.Coordinadora`, tabla STAFF_EVENTO, `/staff` con botones, invitaciones "Sí puedo / No puedo", avisos a la coordinadora, `/configurar` (Admin) para activar los botones. 157 pruebas pasan. Después de publicar: Diana o Víctor escriben `/configurar`; alta de Ángela y las chicas en COLABORADORES.

**Fase 2 (semáforo, ya en producción):**
- `api/_agenda.js`: semáforo 🟢/🟡/🔴 contra eventos autorizados que se traslapan (inventario por categoría y artículo exacto, Casa Isabella, entregas por día, personal y equipos de El Vaso Maíz). Tabla nueva `PERSONAL_DIA` (cupo por día; 12 si no hay renglón).
- Al registrar se guarda en `EVENTOS.Disponibilidad`/`Disponibilidad_Detalle` y va en Telegram y correo con la hora límite (12 h). Dashboard: semáforo en vivo en pedidos y eventos, conteo por color y plazo de 12 h (avisa si se venció).
- DiMa y el formulario: "ya tenemos todos los datos… en un lapso no mayor a 12 horas te confirmamos". El cliente nunca ve el semáforo.
- 143 pruebas pasan.

**Fase 1 (ya en producción):**
- `api/_productos.js`: catálogo con claves, piezas de El Vaso Maíz (3 a 4 min por pieza, equipos de 2), mobiliario por categoría y ventanas de ocupación (mobiliario todo el día del evento hasta la 1 pm del día siguiente; manteles +48 h; Casa Isabella solo las horas; Vaso Maíz sale 30 min antes).
- DiMa pregunta la hora y registra `productos` con clave; EVENTOS guarda `Hora_Inicio`, `Horas_Servicio`, `Productos`, `Piezas_Vaso_Maiz`, `Personal_Requerido`, `Resumen_Capacidad`.
- Modelo, color y cantidad exactos: `EVENTOS.Articulos` (artículos de INVENTARIO). Dashboard: editor de hora, productos y artículos, aviso "🎨 Falta asignar modelo y color". App: "🕒 Empieza", personas y "📦 Cargar exacto". `CACHE_NAME` = `dima-brigadas-v5`.
- Airtable (base de producción, solo campos y datos nuevos): 7 campos en EVENTOS, `INVENTARIO.Categoria` con 87 artículos de Divanna clasificados (copas en "Copa globo" y "Copa francesa"), Casa Isabella como 1 unidad.

**Pendiente de Víctor:**
1. Conteos que faltan en INVENTARIO (por la tarde): aros, mamparas, shimmer, mesitas, tapetes, arcos, túneles, letras/números LED, mesa de honor, cubiertos, vasos, platos trinche/grueso, servilletas, manteles de lentejuela y corrugado, centros de mesa. Un renglón por modelo y color, con su `Categoria`.
2. Lista de proveedores aliados (precio = ~10% menos que el nuestro, pedir con 48 h mínimo, ideal una semana).
3. Rutas de Divanna: cuántos pedidos caben por ruta y por brigada (hoy 2 o 3).
4. Lo anterior de PIN de Diana, variables `VAPID_*`, alta de brigadas, `assetlinks.json` y limpieza de Twilio (ver decisiones y CLAUDE.md).

**Siguientes pasos:**
- Publicar `agenda-semaforo` con permiso de Víctor y probar: pedido de prueba por el chat, semáforo en Telegram/correo y en el dashboard, plazo de 12 h; autorizar con artículos exactos y ver "Cargar exacto" en la app.
- Afinar el semáforo con los conteos completos de INVENTARIO y los datos de rutas.
- Fase 3: gastos y entradas por brigada (`MOVIMIENTOS`, origen del dinero, reembolsos). Fase 4: proveedores y compras de insumos. Fase 5: recordatorios de checklist por Telegram (7, 3 y 1 día antes).
