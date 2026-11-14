#!/bin/sh
# Run in an Ubuntu build environment. Keep the Noble package indexes isolated.
set -eu
arch=${1:?Indica arm64 o amd64}
destination=${2:?Indica el directorio de salida}
shift 2
case "$arch" in
  arm64) archive=https://ports.ubuntu.com/ubuntu-ports; security=$archive ;;
  amd64) archive=https://archive.ubuntu.com/ubuntu; security=https://security.ubuntu.com/ubuntu ;;
  *) echo "Arquitectura desconocida: $arch" >&2; exit 2 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/lists/partial" "$work/archives/partial" "$destination"
touch "$work/status"
destination=$(realpath "$destination")
chmod 755 "$work"
cat > "$work/sources.list" <<SOURCES
deb [arch=$arch signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $archive noble main universe
deb [arch=$arch signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $archive noble-updates main universe
deb [arch=$arch signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $security noble-security main universe
deb-src [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $archive noble main universe
deb-src [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $archive noble-updates main universe
deb-src [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] $security noble-security main universe
SOURCES
apt() {
  apt-get -o "APT::Architecture=$arch" -o Acquire::Languages=none \
    -o APT::Update::Error-Mode=any -o Acquire::Retries=1 \
    -o "Dir::Etc::sourcelist=$work/sources.list" -o Dir::Etc::sourceparts=- \
    -o "Dir::State::lists=$work/lists" -o "Dir::State::status=$work/status" -o "Dir::Cache=$work" \
    -o Acquire::IndexTargets::deb::DEP-11::DefaultEnabled=false \
    -o APT::Get::List-Cleanup=0 "$@"
}
apt update
cd "$work"
if [ "$#" -eq 0 ]; then
  set -- gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-tools pulseaudio-utils libavfilter9 \
    libass9 libbs2b0 libflite1 liblilv-0-0 libmysofa1 libplacebo338 \
    libpocketsphinx3 libpostproc57 librubberband2 libsphinxbase3t64 \
    libvidstab1.1 libzimg2 libserd-0-0 libsord-0-0 libsratom-0-0 \
    libfftw3-double3 libblas3 liblapack3 libshaderc1 libzix-0-0 \
    libunibreak5 libsamplerate0
  if [ "$arch" = amd64 ]; then set -- "$@" libvpl2; fi
fi
for package do
  shift
  set -- "$@" "$package:$arch"
done
apt download "$@"
for binary in ./*.deb; do
  package=$(dpkg-deb -f "$binary" Package)
  version=$(dpkg-deb -f "$binary" Version)
  apt source --download-only "$package=$version"
done
mv -- ./*.deb "$destination/"
mv -- ./*.dsc ./*.tar.* "$destination/"
