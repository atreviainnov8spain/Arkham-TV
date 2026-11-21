#!/bin/bash
# Build the CPU-only local AI helpers for both Ubuntu packages.
set -euo pipefail
zig=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
whisper=$(cd "$2" && pwd)
llama=$(cd "$3" && pwd)
ffmpeg=$(cd "$4" && pwd)
mkdir -p "$5"
out=$(cd "$5" && pwd)
cmake=${CMAKE:-cmake}
jobs=${ARKHAM_BUILD_JOBS:-5}
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$out/zig-cache}"

build() {
  local arch=$1 dir="$out/$1"
  mkdir -p "$dir/bin" "$dir/audio"
  export ZIG_LOCAL_CACHE_DIR="$dir/zig-cache"
  for tool in cc c++; do
    printf '#!/bin/sh\nexec "%s" %s -target %s-linux-musl "$@"\n' "$zig" "$tool" "$arch" >"$dir/$tool"
    chmod +x "$dir/$tool"
  done
  for tool in ar ranlib; do
    printf '#!/bin/sh\nexec "%s" %s "$@"\n' "$zig" "$tool" >"$dir/$tool"
    chmod +x "$dir/$tool"
  done
  local flags=(-DCMAKE_SYSTEM_NAME=Linux "-DCMAKE_SYSTEM_PROCESSOR=$arch"
    "-DCMAKE_C_COMPILER=$dir/cc" "-DCMAKE_CXX_COMPILER=$dir/c++"
    "-DCMAKE_AR=$dir/ar" "-DCMAKE_RANLIB=$dir/ranlib"
    -DCMAKE_C_FLAGS=-fno-sanitize=undefined -DCMAKE_CXX_FLAGS=-fno-sanitize=undefined
    "-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG" "-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG"
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXE_LINKER_FLAGS=-static
    -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
    -DGGML_BLAS=OFF -DGGML_LLAMAFILE=OFF -DGGML_CCACHE=OFF)
  if [[ "$arch" == x86_64 ]]; then
    flags+=(-DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_BMI2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF)
  fi
  if [[ "${ARKHAM_BUILD_SIMD_ONLY:-0}" == 1 ]]; then
    [[ "$arch" == x86_64 ]] || return 0
    local optimized=("${flags[@]}" -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON)
    "$cmake" -S "$whisper" -B "$dir/whisper-avx2" "${optimized[@]}" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
    "$cmake" --build "$dir/whisper-avx2" --target whisper-cli --parallel "$jobs"
    cp "$dir/whisper-avx2/bin/whisper-cli" "$dir/bin/whisper-cli-avx2"
    "$cmake" -S "$llama" -B "$dir/llama-avx2" "${optimized[@]}" -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_NUMBER=11556 \
      -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF
    "$cmake" --build "$dir/llama-avx2" --target llama-completion --parallel "$jobs"
    cp "$dir/llama-avx2/bin/llama-completion" "$dir/bin/llama-completion-avx2"
    return
  fi
  local text_build="$dir/llama-$(basename "$llama")"
  "$cmake" -S "$llama" -B "$text_build" "${flags[@]}" -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_NUMBER=11556 \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF
  "$cmake" --build "$text_build" --target llama-completion --parallel "$jobs"
  cp "$text_build/bin/llama-completion" "$dir/bin/"
  if [[ "${ARKHAM_BUILD_TEXT_ONLY:-0}" == 1 ]]; then
    test -x "$dir/bin/arkham-ai-audio" && test -x "$dir/bin/whisper-cli"
    return
  fi
  "$cmake" -S "$whisper" -B "$dir/whisper" "${flags[@]}" -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
  "$cmake" --build "$dir/whisper" --target whisper-cli --parallel "$jobs"
  cd "$dir/audio"
  "$ffmpeg/configure" --arch="$arch" --target-os=linux --enable-cross-compile \
    --cc="$dir/cc" --ar="$dir/ar" --ranlib="$dir/ranlib" --extra-ldflags='-static -s' \
    --disable-everything --disable-autodetect --disable-debug --disable-doc --disable-network --disable-stripping \
    --disable-ffplay --disable-ffprobe --disable-avdevice --disable-x86asm \
    --enable-demuxer=mov --enable-decoder=aac --enable-muxer=wav --enable-encoder=pcm_s16le \
    --enable-protocol=file --enable-filter=aresample,aformat
  make -j "$jobs" ffmpeg
  cp ffmpeg "$dir/bin/arkham-ai-audio"
  cp "$dir/whisper/bin/whisper-cli" "$dir/bin/"
}

build aarch64 >"$out/arm64.log" 2>&1 &
arm=$!
build x86_64 >"$out/amd64.log" 2>&1 &
intel=$!
failed=0
wait "$arm" || failed=1
wait "$intel" || failed=1
if (( failed )); then
  tail -50 "$out/arm64.log" "$out/amd64.log" >&2
  exit 1
fi
cp "$whisper/LICENSE" "$out/whisper-LICENSE"
cp "$llama/LICENSE" "$out/llama-LICENSE"
if [[ "${ARKHAM_BUILD_SIMD_ONLY:-0}" != 1 ]]; then
  ARKHAM_BUILD_SIMD_ONLY=1 build x86_64 >"$out/amd64-avx2.log" 2>&1 || {
    tail -50 "$out/amd64-avx2.log" >&2
    exit 1
  }
fi
