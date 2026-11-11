# Arkham TV

![Arkham TV, televisión terrestre en directo y grabaciones locales](docs/store/banner.png)

Arkham TV permite **ver y grabar la TDT en abierto** con un sintonizador USB AVerMedia AVerTV Volar compatible y una antena. Incluye guía de programación, selección de pista de audio, ecualizador de diez bandas, sincronización por canal, favoritos y perfiles de sintonización. La interfaz está disponible en español e inglés.

El proyecto está pensado para quienes tienen un **A835 o A835B** y han dejado de poder usarlo con su software habitual. Arkham TV permite seguir aprovechando el sintonizador con un portátil y una antena, también al viajar. Los perfiles guardan la lista de canales de cada lugar.

[Descargas de la versión 1.8.22](https://github.com/atreviainnov8spain/Arkham-TV/releases/tag/v1.8.22) · [Historial de cambios](assets/changelog.json) · [Licencia](LICENSE.md)

## Capturas

![En directo, con controles de volumen y vúmetro estéreo](docs/store/01-live.png)

| Guía TV | Ecualizador |
| --- | --- |
| ![Guía de programación recibida por antena](docs/store/02-tv-guide.png) | ![Ecualizador de diez bandas](docs/store/03-equalizer.png) |

| Sintonizador | Configuración |
| --- | --- |
| ![Búsqueda de canales y listas guardadas](docs/store/04-tuner.png) | ![Sincronización de audio y preferencias de grabación](docs/store/05-settings.png) |

## Instalación

### Ubuntu Desktop

Descarga el paquete `.deb` de la release que corresponda a tu equipo. Ejecuta solo el comando de tu arquitectura desde la carpeta de descargas.

| Equipo | Arquitectura | Archivo |
| --- | --- | --- |
| PC Intel o AMD de 64 bits | amd64 | `Arkham-TV-1.8.22-Ubuntu-Intel-x86_64.deb` |
| Ubuntu ARM64, incluido Parallels en Apple Silicon | arm64 | `Arkham-TV-1.8.22-Ubuntu-ARM64.deb` |

```sh
# PC Intel o AMD
sudo apt install ./Arkham-TV-1.8.22-Ubuntu-Intel-x86_64.deb

# Ubuntu ARM64
sudo apt install ./Arkham-TV-1.8.22-Ubuntu-ARM64.deb
```

Abre **Arkham TV** desde el menú de aplicaciones. El paquete incorpora el lector DVB, FFmpeg y FFprobe. APT instala las dependencias del escritorio, entre ellas Python 3, GTK 3, WebKitGTK 4.1 y los complementos GStreamer para H.264 y AAC.

La edición `.deb` usa el acceso que Ubuntu concede al usuario de la sesión gráfica a los dispositivos DVB. Puedes comprobar el sintonizador ejecutando `arkham-tv --diagnostico` con tu usuario habitual. El paquete Snap tiene su propio sistema de permisos.

### Flatpak de prueba para ARM64

El [paquete local de prueba](https://github.com/atreviainnov8spain/Arkham-TV/releases/tag/v1.8.22-flatpak.1) usa el entorno de ejecución de GNOME 49 y mantiene la versión 1.8.22. Instálalo desde la carpeta de descargas en un sistema ARM64 con Flatpak.

```sh
flatpak install --user --bundle ./Arkham-TV-1.8.22-ARM64-test.flatpak
flatpak run io.github.atreviainnov8spain.ArkhamTVTest
```

El paquete de prueba incluye acceso a dispositivos para que Arkham TV use `/dev/dvb`. Sigue necesitando que Linux detecte el sintonizador y que la sesión de escritorio tenga acceso al adaptador. [Preparación de la publicación en Flathub](docs/flathub-preparacion.md)

### macOS

Descarga `Arkham-TV-1.8.22-macOS-Universal.zip`, descomprímelo y abre **Arkham TV.app**. Requiere macOS 12.3 o posterior y admite Intel y Apple Silicon. El instalador original lleva firma local *ad hoc*. La edición para macOS incluye Python, las herramientas multimedia y el lector USB.

## Sintonizador y grabaciones

| Plataforma | Modelos admitidos | Controlador |
| --- | --- | --- |
| Ubuntu | A835 (`07ca:a835`, `07ca:b835`) y A835B (`07ca:1835`, `07ca:2835`, `07ca:3835`, `07ca:4835`) | `dvb_usb_af9035` del kernel |
| macOS | A835 (`07ca:a835`) | Controlador USB del proyecto sobre IOKit |

Conecta la antena al sintonizador. En el primer arranque, Arkham TV busca servicios DVB-T entre los canales UHF 21 y 48. En **Sintonizador** puedes ajustar el rango y guardar listas para distintas ubicaciones. La guía usa los horarios y las sinopsis que envía cada emisora. La recepción de DVB-T2 requiere otro hardware.

El sintonizador recibe una frecuencia UHF cada vez. **Grabar** permite elegir pista de audio y resolución de salida entre 480p, 720p, 1080p y 4K. El archivo se guarda como MP4 con vídeo H.264 y audio AAC estéreo. Si la resolución de salida supera a la de la emisión, se amplía la imagen. Mantén la aplicación abierta y el equipo despierto para las grabaciones programadas.

## Arquitectura

```text
Antena DVB-T → AVerMedia USB → flujo MPEG-TS
                              ├─ SI/EIT → canales y guía TV
                              └─ FFmpeg → HLS local y grabaciones MP4
                                            └─ WebKit → imagen y audio
```

| Componente | Función |
| --- | --- |
| [app.py](app.py) | Servidor HTTP local, sintonía, procesos de vídeo, API y ciclo de grabación. Escucha en `127.0.0.1`. |
| [native/](native) | Detección USB, lector DVB, análisis de tablas MPEG-TS, guía, pistas de audio y grabaciones. |
| [linux/](linux) | Ventana GTK con WebKitGTK y GStreamer, lector C del dispositivo DVB y empaquetado para Ubuntu. |
| [macos/](macos) | Ventana en Swift y WebKit, integración con macOS y empaquetado universal. |
| [web/](web) | Interfaz HTML, CSS y JavaScript, reproductor HLS, sincronización de audio, temas y traducciones. |
| [assets/](assets) | Iconos, recursos gráficos, catálogo de canales, versión e historial bilingüe. |

En Ubuntu, el servidor local se abre al iniciar la ventana. El lector utiliza `frontend`, `demux` y `dvr` del adaptador DVB que coincide con el identificador USB. FFmpeg prepara la emisión HLS y las grabaciones. El vúmetro muestra los niveles de la emisión, mientras que WebKit y GStreamer gestionan la reproducción por la salida de audio del sistema.

Los ajustes se guardan en `${XDG_DATA_HOME:-~/.local/share}/arkham-tv` en Ubuntu y en `~/Library/Application Support/Arkham TV Desktop` en macOS. La aplicación usa por defecto la carpeta de vídeos del usuario para las grabaciones. La consulta opcional de fichas de cine envía a OMDb el título y, si se indica, el año.

## Compilar la edición de Ubuntu

Los scripts de [linux/](linux) construyen FFmpeg y FFprobe estáticos con Zig, FFmpeg 8.1.2 y x264. Instala también `make` y `pkg-config`. Para compilar en x86-64 con ensamblador optimizado, instala `nasm`. El empaquetador usa Python 3 y produce el ejecutable portátil y su `.deb`.

El instalador original permite recuperar los archivos fuente de las dependencias y sus licencias con `arkham-tv --fuentes`. Descomprime los archivos de FFmpeg y x264 y ajusta las rutas del ejemplo. Repite la compilación de los códecs para `aarch64` si también quieres generar el paquete ARM64.

```sh
ZIG=/ruta/a/zig
FFMPEG_SRC=/ruta/a/ffmpeg-8.1.2
X264_SRC=/ruta/a/x264-stable
MEDIA=/ruta/a/compilacion/media

sh linux/build-media.sh "$ZIG" "$FFMPEG_SRC" "$X264_SRC" "$MEDIA" x86_64
python3 linux/package.py "$ZIG" "$MEDIA" \
  /ruta/a/ffmpeg-8.1.2.tar.xz /ruta/a/x264.tar.gz \
  --arch x86_64 --output dist
```

Para macOS, [macos/build-ffmpeg.sh](macos/build-ffmpeg.sh) compila para ambas arquitecturas con las herramientas de Xcode. [macos/package.py](macos/package.py) documenta las rutas de entrada del framework oficial de Python 3.13, los binarios de FFmpeg y el firmware AF9035 verificado. El ZIP adjunto a la release es el instalador original.

## Diagnóstico en Ubuntu

```sh
lsusb -d 07ca:
ls -l /dev/dvb/adapter*/frontend*
arkham-tv --diagnostico
```

Si usas Parallels, asigna el A835 a Ubuntu desde **Dispositivos → USB**. Si el USB aparece pero Ubuntu no crea el adaptador DVB, comprueba el controlador y el firmware que indique el diagnóstico. Si ves movimiento en el vúmetro pero no oyes el directo, revisa la salida seleccionada y el volumen de Arkham TV en **Configuración → Sonido** de Ubuntu.

## Créditos y licencia

Desarrollo de **Óscar Peña de San Antonio**. Beta tester y contribuciones de **Pedro Miñano**. El código se distribuye bajo GPL-2.0-or-later. Los componentes y recursos de terceros conservan sus avisos y licencias. [Licencia](LICENSE.md) · [Fuentes de los logotipos de canales](assets/canales/FUENTES.md)
