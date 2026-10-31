# Carpeta de Google Drive para la página y DiMa

Lo que Diana pone en esta carpeta lo usan la página y DiMa en unos 10 minutos, sin tocar código.

## Cómo se acomoda

Una carpeta principal (por ejemplo **DiMa – Página**) con subcarpetas. Los nombres son libres; estos son los recomendados:

| Subcarpeta | Qué va adentro | Dónde se usa |
|---|---|---|
| **Galería** | Fotos de eventos montados | Galería de la página (reemplaza las fotos fijas) y DiMa las puede enseñar |
| **Promociones** | Un documento por promoción, con fechas, y su foto si tiene | Sección "Promociones" de la página (solo aparece si hay algo) y DiMa |
| **Paquetes Divanna** | Documento con paquetes y precios actualizados, y sus fotos | DiMa |
| **Paquetes El Vaso Maíz** | Igual | DiMa |
| **Casa Isabella** | Documento con precios del salón y fotos | DiMa |
| **Temporadas** | Documento con precios de temporada (fechas y qué cambia) | DiMa |

Se pueden hacer subcarpetas dentro de una subcarpeta (por ejemplo **Divanna / Paquetes**), pero no más adentro.

## Reglas sencillas

- **Documentos:** Documentos de Google normales. Escribir como se le explicaría a una clienta: "Túnel de luces a $1,500 del 1 al 30 de noviembre". **Siempre poner fechas** en promociones y temporadas: DiMa solo ofrece lo vigente.
- **Lo de la carpeta manda:** si un documento dice otro precio que el catálogo de DiMa, DiMa usa el del documento.
- **Fotos y flyers:** DiMa **lee cada imagen** (lo que dice y lo que muestra: precios, piezas, fechas) unos minutos después de subirla, y guarda lo que leyó en la **descripción** del archivo (clic derecho → *Información del archivo* → *Detalles*; empieza con "[Leído por DiMa"). Ahí se puede revisar o corregir: si se borra esa marca y se escribe una descripción propia, DiMa usa esa y ya no lee la imagen. Si se reemplaza la imagen, DiMa la vuelve a leer. Lo que dice un flyer manda sobre el catálogo, igual que un documento: si una promoción ya no aplica, hay que quitar su imagen. El nombre del archivo es el título de la foto en la página.
- Para quitar algo, se borra o se saca de la carpeta.
- En la página aparecen solo las fotos de **Galería** y lo de **Promociones**. Lo demás solo lo lee DiMa.

## Configuración (una vez, Víctor)

1. En Google Cloud, proyecto `dima-os-513103`: activar **Google Drive API**.
2. Compartir la carpeta principal con `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com` como **Lector**.
3. Copiar el ID de la carpeta (lo que va después de `/folders/` en la URL) a la variable `GOOGLE_DRIVE_CARPETA` en Vercel (Production) y volver a desplegar.
