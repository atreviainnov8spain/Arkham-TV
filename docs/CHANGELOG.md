# Historial de Arkham TV

## 1.12 · macOS y Linux ARM64 / Intel-AMD

- Nuevo Universo de canales en Three.js dentro de Análisis de señal: frecuencias como planetas, inspector, selección de canal y visualización de la recepción.
- Transcripción en párrafos continuos o guion con marcas de tiempo de color; exportación en Markdown y texto con tiempos opcionales.
- Parakeet TDT v3 INT8 y Qwen3-ASR 0.6B INT8 como modelos de voz experimentales descargables, junto a los tamaños de Whisper.
- Separación de voces opcional para grabaciones, con etiquetas anónimas renombrables. El directo no utiliza esta separación.
- Distintivos DIRECTO y GRABACIÓN, datos de origen y modelo empleado.
- Limpieza del panel tras finalizar conservando la sesión y el audio pendiente.
- Cola local de audio, protección de reproducción en Linux y motores AVX2 para procesadores compatibles. Whisper con Metal se conserva en macOS.

Los modelos se descargan y activan desde Configuración. La separación de voces está desactivada por defecto y requiere sus modelos adicionales.

## 1.11 · Transcripciones e IA local

- Asistente lateral para transcribir el audio de la emisión y consultar el texto.
- Biblioteca de Transcripciones IA, chat sobre sesiones guardadas y exportación.
- Modelos locales de voz y texto descargables bajo demanda.
- Controles independientes para aplicar ajustes de imagen y ecualización.

## 1.10 · HDMI y controles de imagen

- Capturadoras HDMI USB en macOS y Linux ARM64 / Intel-AMD.
- Modos de imagen y un ajuste personal guardable; Estándar conserva la imagen original.
- Desentrelazado y ajustes de audio HDMI.

El historial de versiones anteriores está en [los datos de cambios de la aplicación](../assets/changelog.json). Las notas específicas de cada plataforma están en [Linux](../linux/release.json) y [macOS](../macos/release.json).
