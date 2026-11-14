# Arkham TV en Snap Store

| Campo | Valor |
| --- | --- |
| Nombre del Snap | arkham-tv |
| Título | Arkham TV |
| Resumen | Watch and record live TV on Linux with a tuner or USB HDMI capture |
| Licencia | GPL-2.0-or-later |
| Compatibilidad del código local | Sintonizadores DVB-T/T2 y capturadoras USB con vídeo V4L2 y audio PulseAudio/PipeWire |
| Arquitecturas | ARM64 y AMD64 (Intel o AMD de 64 bits) |
| Descripción | [Texto de la ficha en inglés](store/listing-en.md) |
| Historial | [Changelog](../assets/changelog.json) |
| Categoría | Photo and Video |
| Imágenes | [Capturas para la ficha](store/live/) |

El paquete incluye los códecs de vídeo y audio. Snap instala los componentes gráficos GNOME y Mesa que declare el paquete. Ubuntu controla el sintonizador y su firmware. El Snap compilado con este código usa `dvb` para acceder al sintonizador y comprueba su identidad USB a partir del `uevent` asociado al dispositivo DVB. La conexión automática de `dvb` en instalaciones de la tienda requiere la aprobación de Snapcraft.

## Compilación local

En Ubuntu, usa como entrada un ejecutable portátil de la arquitectura correspondiente generado con este código. Su contenido incluye FFmpeg, FFprobe, el lector DVB y sus fuentes.

```sh
snap/fetch-codecs.sh arm64 /var/tmp/arkham-codecs/arm64
python3 snap/build.py arm64 dist/1.10/Arkham-TV-1.10-Ubuntu-ARM64 /var/tmp/arkham-codecs/arm64 dist/1.10
snap/fetch-codecs.sh amd64 /var/tmp/arkham-codecs/amd64
python3 snap/build.py amd64 dist/1.10/Arkham-TV-1.10-Ubuntu-Intel-x86_64 /var/tmp/arkham-codecs/amd64 dist/1.10
```

Para probar el paquete local ARM64 con confinamiento, usa estos comandos en una máquina de pruebas.

```sh
sudo snap install --dangerous dist/1.10/arkham-tv_1.10_arm64.snap
sudo snap connect arkham-tv:dvb
snap run arkham-tv --diagnostico
snap run arkham-tv
```

Para probar los permisos HDMI desde una instalación limpia, abre **Entrada HDMI**, guarda `arkham-tv-hdmi.deb` y ábrelo con el **Centro de aplicaciones** para instalar el auxiliar. Vuelve a Arkham TV, pulsa **Comprobar instalación** y elige **Permitir**. Ubuntu muestra un diálogo de administrador. Al cancelarlo, los permisos pendientes siguen desconectados. Al aceptar, Arkham TV vuelve a consultar la capturadora.

El nombre está registrado en la tienda. Tras validar el primer arranque y la sintonización, sube cada arquitectura como revisión y actualiza la ficha con `snap/publish-metadata.py` usando el entorno Python de Snapcraft y una sesión autenticada. El script lee el historial reciente del proyecto y verifica las imágenes guardadas. Usa capturas de emisiones reales con `--screenshots-dir`. Una vez validadas las revisiones, publícalas en el canal que corresponda. Los usuarios de un sintonizador DVB pueden conectar su interfaz manualmente.
