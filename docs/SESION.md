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

**Actualizado:** 2026-11-01 (tarde) · **Rama de trabajo:** `main` (todo publicado; `pie-fotos-genericas` y `portarretratos` ya unidas) · **Producción:** `main` en `07e22aa` + este cierre. Rama aparte sin publicar: `entrenar-dima`. **364 pruebas pasan.**

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs`, `vercel curl --deployment <url>`). Claude no puede `vercel env add` ni redesplegar producción: comando para `!` de Víctor. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en Downloads (nunca al repo). Herramientas locales fuera del repo en `Proyectos\herramientas-dima` (`drive.js` árbol, `lecturas.js`, `mover-carpeta.js`, `bajar-fotos.js`, `probar-promos.js`/`probar-portarretrato.js` para probar la página en Edge con Drive simulado). Git en esta máquina: commit y merge con `-c user.name=virn31 -c user.email=virn31@gmail.com`.

**Publicado el 31-oct y 1-nov:**
- Drive se lee hasta 4 niveles; DiMa **lee cada imagen** con visión y guarda la lectura en la descripción del archivo; precios vigentes de El Vaso Maíz (lista de Diana del 31-oct).
- **Página sin nombres de archivo:** promociones ("Lo que tenemos ahorita.") y galería llevan solo el botón **Cotizar →**, que abre el chat con la pregunta escrita (sale de la lectura de DiMa).
- **Galería por bloques:** cada subcarpeta de Drive "Galería" es un bloque con título. Se movieron "casa isabella" (14 fotos) y "elvasomaiz" (10) de la raíz a Galería. Verificado en producción.
- **Portarretratos:** las tarjetas 02 (El Vaso Maíz) y 03 (Casa Isabella) pasan al azar las fotos de su carpeta cada 4 s, sin flyers con precios.
- **Paquetes:** foto en las tarjetas de El Vaso Maíz (`img/home/vasomaiz-fresas-vasos.jpg`) y Casa Isabella (`img/home/casa-isabella-alberca.jpg`).
- Prompts para generar imágenes de El Vaso Maíz: `Downloads\Prompts imagenes El Vaso Maiz.txt` (no subirlas a carpetas que DiMa enseña como producto real).

**Pendientes de Víctor:**
1. **Precios de Casa Isabella en conflicto:** los flyers en Drive (Galería / casa isabella) dicen 30 personas $1,800 lunes a jueves, y viernes a domingo 30 personas $3,000 / 50 personas $4,000. El catálogo (`_dima-catalogo.js`) y la tarjeta de la página dicen $1,500 / $2,500. Lo de Drive manda sobre el catálogo, así que DiMa puede estar cotizando con el flyer. Decidir cuál vale y alinear catálogo + página (o quitar el flyer viejo de Drive).
2. Los 2 flyers de Casa Isabella se leyeron como "de la competencia"; ya se corrigió la instrucción, pero las lecturas viejas siguen hasta que cambie la imagen (borrar su descripción en Drive para que se relean).
3. De antes: precios en `INVENTARIO.Precio_Reposicion`; borrar en Google Calendar EVT-182088, EVT-750236, EVT-413125, EVT-581563; probar en el teléfono `/daño`, cobro desde la ficha, foto de comanda y recibo; "Activar alertas".

**Siguiente:**
1. Resolver los precios de Casa Isabella (punto 1).
2. Reconocer y categorizar clientes; Fase 4 proveedores; pago automático.
