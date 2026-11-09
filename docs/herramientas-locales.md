# Herramientas y trucos de esta máquina (Windows de Víctor)

Notas operativas que antes vivían en la memoria de Claude. Leer solo cuando se necesite.

## Git
- Sin identidad global: `git -c user.name=virn31 -c user.email=virn31@gmail.com commit` (y `merge`).
- No hay `gh`: los merges se hacen con git local.
- En Git Bash los heredocs pueden colapsar `\n`: escribir scripts con la herramienta Write.

## Vercel (CLI enlazada con `vercel link --project divanna-eventos --scope codecells`)
- `vercel ls`, `vercel env ls` (solo nombres), `vercel logs -e production -s 48h --json` (filtrar, no volcar todo).
- `vercel curl --deployment <url>` entra a Previews protegidos; en Git Bash `vercel curl /ruta` necesita `MSYS_NO_PATHCONV=1`.
- `vercel redeploy <url> --target preview` sí se permite. Claude NO puede `vercel env add` ni redesplegar producción: darle a Víctor el comando para `!` (no interactivo: `--value "..." --yes`; rutas `/c/Users/...`).
- El conector MCP de Vercel no entra al proyecto (403/404): usar la CLI.
- Variables sensitive (`GOOGLE_CALENDAR_ID`, token de Airtable) salen `[SENSITIVE]` en `env pull`.

## Google
- Cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`; llave JSON en Downloads (nunca al repo). El proyecto `dima-os-513103` no está en virn31 ni vivamedik836.
- Carpeta Drive "DiMa – Página y catálogo": ID `1AB1H_wSA-hhbHR29D0hwkEi4kpnlx1rK`. Con ID equivocado Drive devuelve vacío sin error → verificar con `?foto=<id>`.
- Claude no puede tocar Google Calendar directo: Víctor borra a mano.

## Herramientas fuera del repo (`Proyectos\herramientas-dima`)
- `_llaves.js` lee credenciales sin imprimirlas; `airtable.js`, `drive.js`, `probar-drive.js`, `mover-carpeta.js` (`--mover`), `reiniciar-finanzas.js` (sin `--borrar` solo cuenta), `lecturas.js`, `bajar-fotos.js`.
- `OneDrive\Desktop\DIVANNA HOMEPAGE\keys\airtable dima os.txt` está VACÍO (0 bytes): `airtable.js` no funciona hasta que Víctor pegue el token. Claude no lee credenciales (lo bloquea el clasificador).
- No hay token de Telegram local: para probar el bot, Víctor manda `/hoy`.

## Capturas de pantalla
- Edge headless: `msedge --headless=new --screenshot`, mínimo ~500 px de ancho (celular = iframe de 375 px).
- `--screenshot` no espera JS: verificar con `--dump-dom` + atributo `data-prueba`. Página larga: `--window-size=1200,7600` y recortar con `recortar.ps1`.
- No hay Pillow ni ImageMagick: imágenes con PowerShell `System.Drawing`.

## Teléfonos
- ZTE Axon 60 lite (Ángel) bloquea el APK por Security Lock → instalar la PWA desde Chrome.
