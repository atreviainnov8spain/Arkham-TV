#!/bin/bash
set -euo pipefail

upstream_dir=$(cd -- "$1" && pwd -P)
output_dir=$2
mkdir -p "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd -P)
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
source_dir=$(mktemp -d "$output_dir/ffmpeg-source.XXXXXX")
trap 'rm -rf -- "$source_dir"' EXIT
cp -R "$upstream_dir/." "$source_dir/"
/usr/bin/patch -d "$source_dir" -p1 -i "$script_dir/avfoundation-audio-queue.patch"
sdk=$(/usr/bin/xcrun --show-sdk-path)

compile() {
  local arch=$1
  mkdir -p "$output_dir/$arch"
  cd -- "$output_dir/$arch"
  "$source_dir/configure" \
    --arch="$arch" --target-os=darwin --enable-cross-compile \
    --cc=/usr/bin/clang --sysroot="$sdk" \
    --extra-cflags="-arch $arch -mmacosx-version-min=12.3" \
    --extra-ldflags="-arch $arch -mmacosx-version-min=12.3" \
    --disable-autodetect --disable-doc --disable-debug --disable-x86asm \
    --disable-everything --disable-network --disable-ffplay \
    --enable-avfoundation --enable-indev=avfoundation \
    --enable-videotoolbox \
    --enable-encoder=h264_videotoolbox,aac \
    --enable-decoder=h264,hevc,mpeg2video,mp2,mp3,aac,aac_latm,ac3,eac3,rawvideo,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le \
    --enable-parser=h264,hevc,mpegvideo,mpegaudio,aac,aac_latm,ac3 \
    --enable-demuxer=mpegts,mov --enable-muxer=hls,mp4,mov,mpegts \
    --enable-protocol=file,pipe \
    --enable-filter=bwdif,fps,scale,format,aresample,adelay,tpad,aformat,volume,equalizer,alimiter,astats,ametadata,asplit,acrossover,amerge,asetnsamples,anullsink
  /usr/bin/make -j "${ARKHAM_BUILD_JOBS:-5}" ffmpeg ffprobe
}

compile arm64 > "$output_dir/arm64.log" 2>&1 &
arm_build=$!
compile x86_64 > "$output_dir/x86_64.log" 2>&1 &
intel_build=$!
arm_status=0
intel_status=0
wait "$arm_build" || arm_status=$?
wait "$intel_build" || intel_status=$?
if (( arm_status != 0 || intel_status != 0 )); then
  tail -40 "$output_dir/arm64.log" "$output_dir/x86_64.log" >&2
  exit 1
fi
for tool in ffmpeg ffprobe; do
  /usr/bin/lipo -create "$output_dir/arm64/$tool" "$output_dir/x86_64/$tool" -output "$output_dir/$tool"
done
grep -qx '#define CONFIG_AVFOUNDATION_INDEV 1' "$output_dir/arm64/config_components.h"
grep -qx '#define CONFIG_AVFOUNDATION_INDEV 1' "$output_dir/x86_64/config_components.h"
