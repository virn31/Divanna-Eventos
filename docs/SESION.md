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

**Actualizado:** 2026-10-30 (noche) · **Rama de trabajo:** `carpeta-drive` (6 commits sobre `main`, pusheada, SIN merge, sin probar en real) · **Producción:** `main` en `b388265` (caché `dima-brigadas-v23`; en la rama ya es v24). Rama aparte sin publicar: `entrenar-dima`. **352 pruebas pasan.**

**Acceso:** Vercel por CLI (`vercel ls`, `vercel env ls`, `vercel logs -e production -s 48h --json`); Claude no puede `vercel env add` ni `vercel redeploy`: se le da a Víctor el comando para `!`. Las variables sensitive salen `[SENSITIVE]` en `vercel env pull`. Google: cuenta de servicio `dima-calendar-sheets@dima-os-513103.iam.gserviceaccount.com`, llave local en `Downloads\dima-os-513103-eb75c647cb3d.json` (nunca al repo).

**En la rama `carpeta-drive` (tarde del 30 oct):**
- **Carpeta de Google Drive** (`api/_drive.js`, guía para Diana en `docs/carpeta-drive.md`): DiMa lee los Documentos (mandan sobre el catálogo) y muestra fotos; la página saca Galería y Promociones de ahí. Caché 10 min; si Drive falla, catálogo del código.
- **Letreros:** el incluido es genérico; nombre o personaje = lona personalizada con cargo extra.
- **Política de pago:** anticipo de Divanna mínimo $500, liquidación 24 h antes, depósito en garantía del mobiliario **$1,000** (decidido por Víctor), se regresa al recoger; DiMa pregunta quién entrega en la recolección.
- **26 fotos nuevas** de Víctor en `referencias/` (nombres y teléfonos pixelados).
- **`/daño` por Telegram** (`api/_danos.js`): perdido 100%, daño menor 10% de `Precio_Reposicion`, borrador con ✅ Registrar / ❌ Cancelar.
- **`/anuncio`**: Diana y Víctor escriben a todo el equipo (sin staff).

**Drive, verificado 30 oct noche:** la Drive API ya responde con la llave de la cuenta de servicio, pero la cuenta **solo ve las hojas `Divanna_Pedidos` y `VasoMaiz_Pedidos`: ninguna carpeta está compartida con ella todavía**. Falta también `GOOGLE_DRIVE_CARPETA` en Vercel (no existe).

**Pendientes de Víctor:**
1. Compartir la carpeta de Drive (Lector o Editor) con la cuenta de servicio de arriba, exactamente ese correo.
2. Poner `GOOGLE_DRIVE_CARPETA` en Vercel (Production y Preview) con el ID de la carpeta (lo de la URL después de `/folders/`): `vercel env add GOOGLE_DRIVE_CARPETA production`.
3. Borrar en Google Calendar ("DiMa Eventos") los 4 eventos de prueba: EVT-182088, EVT-750236, EVT-413125, EVT-581563.
4. Precios de reposición en `INVENTARIO.Precio_Reposicion` (sin ellos `/daño` y 💰 Dinero no calculan).
5. Probar en el teléfono: daño/faltante, cobro desde la ficha, foto de comanda, recibo.
6. Opcional: borrar pestañas EVT-581563 y EVT-182088 en las hojas y el duplicado `rec374o2IWhy1bBph` en BALANCES. De antes: todos tocan "Activar alertas"; compartir "DiMa Eventos" con divannaeventos@gmail.com y Ángela.

**Siguiente:**
1. Con la carpeta compartida y la variable puesta: verificar con la llave local que la cuenta ve la carpeta y sus subcarpetas, probar en Preview (chat con DiMa + galería/promociones de la página) y, si Víctor lo pide, unir `carpeta-drive` a `main`.
2. Anotar en `docs/decisiones.md` lo de Drive y la política de pago si falta.
3. Fotos originales de El Vaso Maíz, Casa Isabella y montajes de Divanna.
4. De antes: DiMa no repide datos al abrir un pedido existente; reconocer y categorizar clientes; Fase 4 proveedores; pago automático.
