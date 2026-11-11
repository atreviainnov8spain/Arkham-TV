#!/bin/sh
set -eu

package=$1
payload_size=$2
shift 2
umask 077
mode=${1:-}
data=
case "$mode" in
  ''|--sin-navegador|--preparar|--diagnostico|--version|--fuentes) ;;
  --preparar-ventana)
    sudo apt-get update
    exec sudo apt-get install python3-gi gir1.2-gtk-3.0 gir1.2-gstreamer-1.0 gir1.2-webkit2-4.1 \
      gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav ;;
  --help|-h)
    printf '%s\n' 'Abre la ventana de Arkham TV en Ubuntu.' '  --preparar       Instala el firmware del A835 o A835B si falta.' \
      '  --preparar-ventana  Instala las bibliotecas de la ventana y los códecs de Ubuntu.' \
      '  --diagnostico    Comprueba el sintonizador y las herramientas.' \
      '  --sin-navegador  Inicia el servidor y muestra la dirección en Terminal.' \
      '  --fuentes        Extrae las fuentes de los componentes incluidos.' \
      '  --version        Muestra la versión de Arkham TV.'
    exit 0 ;;
  *) printf 'Opción desconocida: %s\n' "$mode" >&2; exit 2 ;;
esac

storage="${XDG_DATA_HOME:-$HOME/.local/share}/arkham-tv"
if [ "$mode" = --sin-navegador ]; then
  data=$storage
  mkdir -p -- "$data"
  exec 9>"$data/instance.lock"
  if ! flock -n 9; then
    for attempt in 1 2 3 4 5; do
      port=$(cat "$data/port" 2>/dev/null || true)
      case "$port" in
        ''|*[!0-9]*) sleep 1 ;;
        *)
          url="http://127.0.0.1:$port"
          printf 'Arkham TV · %s\n' "$url"
          exit 0 ;;
      esac
    done
    printf 'Arkham TV ya se está iniciando.\n' >&2
    exit 1
  fi
  rm -f -- "$data/port"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/arkham-tv.XXXXXX")
child=
cleanup() {
  if [ -n "${data:-}" ]; then rm -f -- "$data/port"; fi
  rm -rf -- "$work"
}
stop() {
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup EXIT
trap stop INT TERM HUP
tail -c "$payload_size" -- "$package" | tar -xzf - -C "$work"

case "$mode" in
  --version) printf 'Arkham TV %s\n' "$(cat "$work/assets/version.txt")"; exit 0 ;;
  --fuentes)
    sources=$(mktemp -d "$PWD/Arkham-TV-Fuentes.XXXXXX")
    cp -R "$work/sources/." "$sources/"
    printf 'Fuentes guardadas en %s\n' "$sources"
    exit 0 ;;
esac

if [ ! -x /usr/bin/python3 ]; then
  printf 'Arkham TV necesita el Python 3 de Ubuntu. Instálalo con sudo apt install python3.\n' >&2
  exit 1
fi
export PATH="$work/bin:$PATH" PYTHONDONTWRITEBYTECODE=1
cd "$work"
case "$mode" in
  --preparar) /usr/bin/python3 -B preparar.py; exit $? ;;
  --diagnostico)
    /usr/bin/python3 -B -c 'from app import probe; import json; print(json.dumps(probe(), ensure_ascii=False, indent=2))'
    ffmpeg -version | sed -n '1p'
    exit 0 ;;
esac

if [ "$mode" = '' ]; then
  # X11 permits positioning and keeping the mini player above the desktop.
  if [ -n "${DISPLAY:-}" ]; then export GDK_BACKEND="${GDK_BACKEND:-x11}"; fi
  # Parallels can decode video but display a black frame on WebKit's DMA-BUF path.
  if [ "$(systemd-detect-virt --vm 2>/dev/null || true)" = parallels ]; then
    export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
    export WEBKIT_GST_DMABUF_SINK_DISABLED="${WEBKIT_GST_DMABUF_SINK_DISABLED:-1}"
  fi
  /usr/bin/python3 -B desktop.py "$storage" &
else
  /usr/bin/python3 -B app.py --data-dir "$data" --ready-file "$data/port" --idle-timeout 120 &
fi
child=$!
wait "$child"
