# Preparación de Arkham TV 1.8.22 para Flathub

## Comunidad a la que se dirige

Arkham TV está pensada para quienes tienen un sintonizador USB AVerMedia AVerTV Volar HD **A835 o A835B** y han dejado de poder usarlo con su software habitual. El proyecto busca prolongar la vida útil de ese hardware y que sus propietarios puedan seguir viendo y grabando la TDT en abierto con un portátil y una antena, también cuando viajan. Los perfiles de sintonización permiten guardar los canales de cada lugar.

## Versión de origen

- [Código e historial de la versión](https://github.com/atreviainnov8spain/Arkham-TV/tree/v1.8.22), commit `37fb4ba2aeef544da0b19167982b2ac0ca98b770`.
- [Instaladores originales y sumas SHA-256](https://github.com/atreviainnov8spain/Arkham-TV/releases/tag/v1.8.22). Los `.deb` son las ediciones nativas de Ubuntu. Flathub debe construir su propio paquete a partir de fuentes accesibles.
- [Revisión de prueba para Flatpak ARM64](https://github.com/atreviainnov8spain/Arkham-TV/releases/tag/v1.8.22-flatpak.1). Usa GNOME 49 y las herramientas multimedia de la versión original. La aplicación conserva el número 1.8.22.
- El repositorio es público. La revisión de prueba incluye el ajuste de arranque de Flatpak en el commit `d5182e210f53d2856c28b7dc235f256b5f19eb95`. El archivo de código de esa revisión y las cinco capturas se pueden descargar sin iniciar sesión. [Archivo de código](https://github.com/atreviainnov8spain/Arkham-TV/archive/refs/tags/v1.8.22-flatpak.1.tar.gz)

## Material de la ficha

La interfaz de **Arkham TV** está disponible en **español e inglés**. La licencia del código es **GPL-2.0-or-later**. Usa el texto de la ficha actual como referencia de contenido y adapta las menciones a Ubuntu, al formato de paquete y a las resoluciones probadas. [Ficha actual en inglés](https://github.com/atreviainnov8spain/Arkham-TV/blob/v1.8.22/docs/store/listing-en.md)

[Recursos originales de la tienda](https://github.com/atreviainnov8spain/Arkham-TV/tree/v1.8.22/docs/store), en orden: En directo, Guía TV, Ecualizador, Sintonizador y Configuración. La captura de En directo abre la galería. Conserva las mismas secciones al volver a capturarlas en la ventana nativa de Linux, con título, bordes y sombra. Las capturas actuales muestran solo la interfaz. El banner promocional queda como referencia de marca para el README. En Flathub, usa los campos de marca de AppStream y URLs de capturas fijadas a la etiqueta o a un commit. [Guía de metadatos](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines) · [Guía de capturas](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/quality-guidelines)

## DVB y audio

La edición de Linux identifica el A835 o A835B por USB y usa el controlador DVB del kernel. El lector accede a los nodos `frontend`, `demux` y `dvr` bajo `/dev/dvb`. La opción USB de Flatpak expone los nodos bajo `/dev/bus/usb`. Con el lector actual, el acceso a `/dev/dvb` requiere revisar el permiso general de dispositivos de Flatpak con Flathub. Si se acepta el permiso en el paquete, hay que comprobar que el usuario de la sesión ya tiene acceso al dispositivo en el sistema anfitrión. [Permisos de dispositivos de Flatpak](https://docs.flatpak.org/en/latest/sandbox-permissions.html#device-access)

El vúmetro muestra niveles de la emisión. En Ubuntu ARM64 en Parallels, el Flatpak de prueba reconoció el A835 con un perfil nuevo y sin permisos añadidos mediante `flatpak override`. La búsqueda encontró tres canales con la antena disponible. En TV Hospitalet se midieron cuatro segundos de audio en la salida de PipeWire, con señal en ambos canales y sin muestras saturadas en esa medición. La recepción UHF fue intermitente durante la prueba.

Antes de dar por terminado el Flatpak, prueba un primer arranque desde una cuenta de escritorio sin ajustes previos. Comprueba que detecta el A835 sin pedir al usuario que autorice DVB ni aplique un `flatpak override`, sintoniza una emisión y verifica la salida estéreo del sistema. Repite en ARM64 y x86-64. Prueba también que el selector de carpeta da acceso a la ubicación elegida y que se puede grabar y volver a reproducir.

## Envío

1. El mantenedor elige el ID de aplicación, prepara el manifiesto y añade los metadatos AppStream y el archivo `.desktop` al proyecto.
2. Comprueba la compilación local y la instalación con Flatpak Builder. Valida el manifiesto y los metadatos con las herramientas de Flathub. Documenta los permisos que necesita la aplicación.
3. El mantenedor abre la solicitud desde GitHub contra la rama `new-pr` de `flathub/flathub`. Declara las contribuciones de IA que estén incluidas. Flathub exige que el manifiesto y la solicitud los prepare y envíe el mantenedor sin asistencia de IA en esos materiales. [Requisitos](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy) · [Proceso de envío](https://docs.flathub.org/docs/for-app-authors/submission)

La revisión ARM64 es un paquete local de prueba. La compilación del manifiesto definitivo y la validación en x86-64 quedan pendientes.
