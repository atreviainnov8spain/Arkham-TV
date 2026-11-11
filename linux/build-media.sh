#!/bin/sh
# Cross-compile the bundled Linux media tools using Zig and upstream sources.
set -eu

zig=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
ffmpeg_source=$(cd "$2" && pwd)
x264_source=$(cd "$3" && pwd)
mkdir -p "$4"
output=$(cd "$4" && pwd)
arch=$5
case "$arch" in x86_64|aarch64) ;; *) exit 2 ;; esac
build="$output/$arch"
asm_flag=
if [ "$arch" = x86_64 ] && ! command -v nasm >/dev/null 2>&1; then
  asm_flag=--disable-asm
fi
mkdir -p "$build/x264" "$build/ffmpeg" "$build/bin"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$output/zig-cache}"
export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-$build/zig-cache}"
for tool in cc ar ranlib; do
  target=
  [ "$tool" != cc ] || target="-target $arch-linux-musl"
  printf '#!/bin/sh\nexec "%s" %s %s "$@"\n' "$zig" "$tool" "$target" > "$build/$tool"
  chmod +x "$build/$tool"
done

cd "$build/x264"
CC="$build/cc" AR="$build/ar" RANLIB="$build/ranlib" "$x264_source/configure" \
  --host="$arch-linux-musl" --prefix="$build/prefix" --enable-static \
  ${asm_flag:+"$asm_flag"} --disable-cli --disable-opencl --disable-avs --disable-swscale \
  --bit-depth=8 --chroma-format=420
make -j "${ARKHAM_BUILD_JOBS:-5}"
make install

cd "$build/ffmpeg"
PKG_CONFIG_PATH="$build/prefix/lib/pkgconfig" "$ffmpeg_source/configure" \
  --arch="$arch" --target-os=linux --enable-cross-compile \
  --cc="$build/cc" --ar="$build/ar" --ranlib="$build/ranlib" \
  --extra-ldflags='-static -s' --pkg-config-flags=--static \
  --disable-autodetect --disable-doc --disable-debug --disable-stripping \
  ${asm_flag:+"$asm_flag"} --disable-network --disable-ffplay --disable-avdevice \
  --disable-everything --enable-gpl --enable-libx264 \
  --enable-encoder=libx264,aac \
  --enable-decoder=h264,hevc,mpeg2video,mp2,mp3,aac,aac_latm,ac3,eac3 \
  --enable-parser=h264,hevc,mpegvideo,mpegaudio,aac,aac_latm,ac3 \
  --enable-demuxer=mpegts,hls,mov --enable-muxer=hls,mpegts,mp4,mov \
  --enable-protocol=file,pipe --enable-filter=bwdif,fps,scale,format,aresample,adelay,tpad,aformat,volume,equalizer,alimiter,astats,ametadata,asplit,acrossover,amerge,asetnsamples,anullsink
make -j "${ARKHAM_BUILD_JOBS:-5}" ffmpeg ffprobe
cp ffmpeg ffprobe "$build/bin/"
