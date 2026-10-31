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

**Actualizado:** 2026-10-30 (cierre de la noche) · **Rama de trabajo:** `main` (todo publicado; `carpeta-drive` y `homepage-logos` ya unidas) · **Producción:** `main` en `03ee9e4` + este cierre, verificada en divanna-eventos.vercel.app (caché `dima-brigadas-v24`). Rama aparte sin publicar: `entrenar-dima`. **355 pruebas pasan.**

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs`, `vercel curl --deployment <url>` entra a Previews protegidos; `vercel redeploy <url> --target preview` sí se puede). Claude no puede `vercel env add` ni redesplegar producción: comando para `!` de Víctor (con `--value "..." --yes`, porque `!` no es interactivo). Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en `Downloadsdima-os-513103-eb75c647cb3d.json` (nunca al repo).

**Publicado hoy en la noche:**
- **Carpeta de Google Drive EN PRODUCCIÓN:** "DiMa – Página y catálogo" de divannaeventos@gmail.com, ID `1AB1H_wSA-hhbHR29D0hwkEi4kpnlx1rK` (= `GOOGLE_DRIVE_CARPETA` en Production y Preview), compartida como Lector con la cuenta de servicio. Subcarpetas: decoraciones (20 fotos), Galería, Temporadas, Promociones, Paquetes Casa Isabella, Paquetes Vaso Maíz, " Divanna" (con espacio al inicio). Verificado: producción sirve las fotos y DiMa las muestra en el chat. Galería y Promociones de la página siguen vacías hasta que Diana suba algo. Ojo: con un ID equivocado Drive devuelve vacío SIN error; para verificar, pedir una foto con `?foto=<id>`.
- **DiMa ya no se repite tras mandar fotos** (venía de 1dae774, los clientes lo veían): recibe lo que ya escribió en el mismo mensaje.
- **Política de pago:** anticipo Divanna mínimo $500, liquidación 24 h antes, depósito en garantía $1,000 solo Divanna (**El Vaso Maíz NO lleva depósito**, verificado en prod). Si preguntan cómo se paga, DiMa da las tres cosas juntas.
- **Logos en el encabezado del homepage** (`03ee9e4`): neón de Divanna + línea dorada + mascota de El Vaso Maíz, como la composición "Eventos con sabor y estilo_VEVENT" de Víctor. Archivos optimizados en `img/logos/` (~60 KB c/u; originales en `OneDriveDesktopotos-homepagelogos`). El neón trae fondo negro: se quita con `mix-blend-mode:screen`. Encabezado 92 px en computadora, 72 px en celular (el menú ☰ se abre justo debajo: no cambiar sin mover `top:72px`). Capturas con Edge headless: no baja de ~500 px de ancho, para celular meter la página en un iframe de 375 px.
- Letreros genéricos vs lona personalizada (en lona personalizada el letrero se cobra aparte: regla del catálogo, correcta), 26 fotos nuevas, `/daño` por Telegram, `/anuncio`.

**Pendientes de Víctor:**
1. Precios en `INVENTARIO.Precio_Reposicion` (sin ellos `/daño` y 💰 Dinero marcan "monto a revisar").
2. Diana sube fotos a Galería/Promociones y Documentos de paquetes/temporadas (guía: `docs/carpeta-drive.md`). Opcional: quitar "sector guadalupe victoria" del nombre de una foto.
3. Borrar en Google Calendar ("DiMa Eventos") EVT-182088, EVT-750236, EVT-413125, EVT-581563.
4. Probar en el teléfono: `/daño`, daño/faltante y cobro desde la ficha, foto de comanda, recibo.
5. Opcional: pestañas EVT-581563 y EVT-182088 en las hojas, duplicado `rec374o2IWhy1bBph` en BALANCES. De antes: "Activar alertas"; compartir "DiMa Eventos" con divannaeventos@gmail.com y Ángela.

**Siguiente:**
1. Revisar que DiMa use bien lo que Diana suba a Drive (documentos de precios mandan sobre el catálogo).
2. DiMa no repide datos al abrir un pedido existente; reconocer y categorizar clientes; Fase 4 proveedores; pago automático.
3. Fotos originales de El Vaso Maíz, Casa Isabella y montajes de Divanna.
