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
- **Fotos:** el **nombre del archivo es la descripción** que ven la clienta y DiMa ("XV años rosa y dorado.jpg"). Sin teléfonos ni nombres de niños en la foto.
- Para quitar algo, se borra o se saca de la carpeta.
- En la página aparecen solo las fotos de **Galería** y lo de **Promociones**. Lo demás solo lo lee DiMa.

## Configuración (una vez, Víctor)

1. En Google Cloud, proyecto `dima-os-513103`: activar **Google Drive API**.
2. Compartir la carpeta principal con `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com` como **Lector**.
3. Copiar el ID de la carpeta (lo que va después de `/folders/` en la URL) a la variable `GOOGLE_DRIVE_CARPETA` en Vercel (Production) y volver a desplegar.
