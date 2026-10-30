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

**Actualizado:** 2026-10-29 (cierre de la noche) · **Rama de trabajo:** `main` (todo publicado; ramas del día ya unidas: `dia-lleno`, `sheets` y las de la tarde) · **Producción:** `main` en `6eb4bdc`, despliegue verificado (caché `dima-brigadas-v20`). Rama aparte sin publicar: `entrenar-dima`. **314 pruebas pasan.**

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs -e production -s 48h --json`); Claude no puede `vercel env add` ni `vercel redeploy`: se le da a Víctor el comando con `!`. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`; el proyecto `dima-os-513103` NO está en las cuentas de Chrome de Claude (virn31, vivamedik836), Víctor entra con otra. API de Sheets activa; la de Drive no (no hace falta). Llave local en `Downloads\dima-os-513103-eb75c647cb3d.json` (nunca al repo).

**Publicado en la tarde/noche:**
- **Cuadre del dinero** (solo Diana y Víctor), **calendario del equipo** + Google Calendar "DiMa Eventos" (cuenta virn31), ➕ **Capturar evento**, **rediseño visual** (negro puro, tarjetas, pestañas, Inter; `brigadas/tema.css`).
- **Día lleno** (`cupoDelDia`/`diasLlenos` en `_agenda.js`): Divanna con 9 entregas, El Vaso Maíz con 6 equipos o sin personal. Calendario marca LLENO, aviso a Diana/Víctor (y Ángela si es VM), DiMa no ofrece el día y dice "Lamentablemente esa fecha la tenemos llena y ya no podemos cubrir tu evento" + hasta 3 fechas libres. **Casa Isabella** apartada → "esa fecha ya no está disponible" + fechas libres del salón (todo el día, conservador).
- **Google Sheets de pedidos** (`api/_sheets.js`): hojas Divanna_Pedidos y VasoMaiz_Pedidos (Hojas de Google de Víctor, compartidas como Editor; `GOOGLE_SHEET_DIVANNA`, `GOOGLE_SHEET_VASOMAIZ` en Vercel). Por evento: pestaña de recibo con el folio EVT + renglón en "Pedidos". `GOOGLE_SHEET_ID` ya no se usa.
- **Recibo en PDF por Telegram** al registrar anticipo/pago (captura, cuadre, reporte aprobado) o con 🧾 **Mandar recibo** en el calendario.
- **Comanda en papel por foto** (`api/_comanda.js`): foto a @dimaclnbot o 📷 en ➕ Capturar evento; DiMa la lee con visión, muestra dudas, guarda solo al confirmar; foto en `EVENTOS.Foto_Comanda`.
- DiMa en el chat pide dirección exacta y modelo/color de cada producto.

**Airtable hoy:** tablas MOVIMIENTOS_CAJA `tbl9UVlnxzfXscnW5`, DIAS_BLOQUEADOS `tblHSdMCxW2kkiiC9`, COMANDAS_FOTO `tblNYrh2wjsYgHfmf`; EVENTOS `Cuadre_Estado`, `Cuadre_Notas`, `Cuadre_Preguntado`, `Descuento`, `Cancelado`, `Google_Evento_ID`, `En_Sheets`, `Foto_Comanda`; COBROS `Recibido_Por`.

**Sin probar en real (Víctor lo hace):**
1. Diana toca **🔄 Pasar los eventos a Google** en el calendario (20 por vez) para meter a las hojas los eventos ya autorizados.
2. Foto de una comanda real a @dimaclnbot: revisar qué tan bien la lee (Descartar si es prueba).
3. 🧾 Mandar recibo en un evento autorizado: revisar el PDF que llega.
4. Lo anterior: todos tocan "Activar alertas"; borrar en BALANCES el duplicado `rec374o2IWhy1bBph`; compartir "DiMa Eventos" con divannaeventos@gmail.com y Ángela.

**Siguiente (pedido de Víctor para mañana):**
1. **Mejorar la experiencia de usuario del homepage** (https://divanna-eventos.vercel.app/, `index.html`): "me gusta, pero lo podemos mejorar". Empezar revisándolo en el navegador (móvil y escritorio) y proponer mejoras concretas antes de tocar; respetar marca y colores; el chat con DiMa y el formulario de respaldo deben seguir funcionando igual.
2. Pendientes de antes: identificador de eventos con nombre y teléfono del cliente; DiMa no repide datos al abrir un pedido existente; reconocer y categorizar clientes (decoradores, frecuentes, malos).
3. Después: Fase 4 proveedores (brigada propone, Diana aprueba), pago automático (procesador sin decidir; no hay funciones libres: 12 de 12).
