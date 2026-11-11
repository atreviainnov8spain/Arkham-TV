#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  printf 'Instala FFmpeg con Homebrew y vuelve a abrir este archivo.\n\n  brew install ffmpeg\n'
  exit 1
fi

mkdir -p .datos
firmware=.datos/dvb-usb-af9035-02.fw
expected=9e0d15915387b8bddaaf4db978d3f891c2fb34d0db165191e88443f909158c2f

verified() {
  printf '%s  %s\n' "$expected" "$1" | /usr/bin/shasum -a 256 -c --status
}

if [[ ! -f "$firmware" ]] || ! verified "$firmware"; then
  download=$(mktemp .datos/af9035.XXXXXX)
  trap 'rm -f "$download"' EXIT
  curl --fail --location --silent --show-error --max-time 60 \
    https://raw.githubusercontent.com/LibreELEC/dvb-firmware/master/firmware/dvb-usb-af9035-02.fw \
    --output "$download"
  if ! verified "$download"; then
    printf 'El firmware descargado no coincide con la suma SHA-256 esperada.\n' >&2
    exit 1
  fi
  mv "$download" "$firmware"
fi
printf 'Firmware listo. Abre iniciar.command.\n'
