#!/bin/bash
# Build the three helpers used by the macOS assistant. Whisper can use Metal on Apple Silicon.
set -euo pipefail
whisper=$(cd "$1" && pwd)
llama=$(cd "$2" && pwd)
ffmpeg=$(cd "$3" && pwd)
mkdir -p "$4"
out=$(cd "$4" && pwd)
cmake=${CMAKE:-cmake}
jobs=${ARKHAM_BUILD_JOBS:-5}
build() {
  local arch=$1 dir="$out/$1"
  mkdir -p "$dir/audio"
  local flags=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=12.3
    "-DCMAKE_OSX_ARCHITECTURES=$arch" -DCMAKE_SYSTEM_PROCESSOR="$arch"
    -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_METAL=OFF -DGGML_OPENMP=OFF
    -DGGML_BLAS=OFF -DGGML_ACCELERATE=OFF -DGGML_CCACHE=OFF)
  if [[ "$arch" == x86_64 ]]; then
    flags+=(-DGGML_AVX2=OFF -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF)
  fi
  local text_build="$dir/llama-$(basename "$llama")"
  "$cmake" -S "$llama" -B "$text_build" "${flags[@]}" -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_NUMBER=11556 \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF
  "$cmake" --build "$text_build" --target llama-completion --parallel "$jobs"
  if [[ "${ARKHAM_BUILD_TEXT_ONLY:-0}" == 1 ]]; then return; fi
  local speech_flags=("${flags[@]}")
  if [[ "$arch" == arm64 ]]; then
    speech_flags+=(-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON)
  fi
  "$cmake" -S "$whisper" -B "$dir/whisper" "${speech_flags[@]}" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
  "$cmake" --build "$dir/whisper" --target whisper-cli --parallel "$jobs"
  cd "$dir/audio"
  local target=$arch
  [ "$arch" != arm64 ] || target=aarch64
  "$ffmpeg/configure" --arch="$target" --cc=/usr/bin/clang --enable-cross-compile --target-os=darwin \
    --extra-cflags="-arch $arch -mmacosx-version-min=12.3" \
    --extra-ldflags="-arch $arch -mmacosx-version-min=12.3" \
    --disable-everything --disable-autodetect --disable-debug --disable-doc --disable-network \
    --disable-ffplay --disable-ffprobe --disable-avdevice --disable-x86asm \
    --enable-demuxer=mov --enable-decoder=aac --enable-muxer=wav --enable-encoder=pcm_s16le \
    --enable-protocol=file --enable-filter=aresample,aformat
  /usr/bin/make -j "$jobs" ffmpeg
}
build arm64 >"$out/arm64.log" 2>&1 &
arm_pid=$!
build x86_64 >"$out/x86_64.log" 2>&1 &
intel_pid=$!
failed=0
wait "$arm_pid" || failed=1
wait "$intel_pid" || failed=1
if (( failed )); then
  tail -40 "$out/arm64.log" "$out/x86_64.log" >&2
  exit 1
fi
for pair in "llama-$(basename "$llama")/bin/llama-completion" whisper/bin/whisper-cli audio/ffmpeg; do
  name=${pair##*/}
  if [[ "${ARKHAM_BUILD_TEXT_ONLY:-0}" == 1 && "$name" != llama-completion ]]; then
    [[ "$name" != ffmpeg ]] || name=arkham-ai-audio
    test -x "$out/$name"
    continue
  fi
  [[ "$name" != ffmpeg ]] || name=arkham-ai-audio
  /usr/bin/lipo -create "$out/arm64/$pair" "$out/x86_64/$pair" -output "$out/$name"
done
cp "$whisper/LICENSE" "$out/whisper-LICENSE"
cp "$llama/LICENSE" "$out/llama-LICENSE"
