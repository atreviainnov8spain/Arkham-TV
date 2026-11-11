#!/bin/bash
set -euo pipefail

source_dir=$(cd -- "$1" && pwd -P)
output_dir=$2
mkdir -p "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd -P)
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
    --disable-everything --disable-network --disable-ffplay --disable-avdevice \
    --enable-videotoolbox \
    --enable-encoder=h264_videotoolbox,aac \
    --enable-decoder=h264,hevc,mpeg2video,mp2,mp3,aac,aac_latm,ac3,eac3 \
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
