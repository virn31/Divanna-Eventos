# APK de Android para el equipo

La app del equipo es la PWA de `/brigadas/`. El APK es esa misma app empaquetada como
Trusted Web Activity (TWA): abre la página en pantalla completa, sin barra del navegador,
y se actualiza sola con cada deploy (no hay que reinstalar el APK por cambios de la app).

## Generarlo (una sola vez)

1. Con el deploy ya en producción, entra a https://www.pwabuilder.com y pon
   `https://divanna-eventos.vercel.app/brigadas/`.
2. Elige **Android → Generate package**. Opciones:
   - Package ID: `app.vercel.divanna_eventos.equipo` (o el que prefieras; no se puede cambiar después).
   - App name: `DiMa Equipo`.
   - **Notifications: Enable** (notification delegation). Sin esto las alertas de emergencia no suenan con la app cerrada.
   - Signing key: **Create new**. Guarda el archivo `.keystore` y sus contraseñas fuera del repo
     (por ejemplo en un gestor de contraseñas). Sin esa llave no se pueden publicar actualizaciones del APK.
3. Descarga el zip. Trae el `.apk` (para instalar directo) y `assetlinks.json`.
4. Copia `assetlinks.json` al repo en `.well-known/assetlinks.json` y haz deploy.
   Sin ese archivo el APK funciona, pero muestra la barra del navegador arriba.

## Instalarlo en los teléfonos

Manda el `.apk` a cada colaborador (Drive, correo o cable). Al abrirlo, Android pide permitir
"instalar apps de fuentes desconocidas" para esa app; se acepta una vez.
Después cada quien entra con su usuario y PIN (tabla COLABORADORES en Airtable) y toca **Activar alertas**.
Para que la emergencia lleve la ubicación, la primera vez que se lance una alerta el teléfono pide
permiso de ubicación: hay que **Permitir** (mejor "Mientras se usa la app"). Si se negó por error:
Ajustes > Apps > DiMa Equipo > Permisos > Ubicación. Si al regenerar el APK PWABuilder ofrece
**Location delegation**, actívalo.

Para que las emergencias se oigan: el teléfono no debe estar en "No molestar" para esta app, y en
Ajustes > Apps > DiMa Equipo > Notificaciones deben estar permitidas con sonido.

## Notas

- No cambies `scope` ni `start_url` en `brigadas/manifest.json`: el APK apunta ahí.
- Publicarla en Google Play es opcional (cuenta de desarrollador de $25 USD, una vez) y usa el mismo paquete.
