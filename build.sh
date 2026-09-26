#!/usr/bin/env bash
# Reproducible build of the LAME WebAssembly encoder used by Guitar Canvas.
#
# Requires only Docker. Runs entirely inside a pinned emscripten/emsdk
# image so the toolchain version never drifts between machines. Rebuilding
# from a clean clone must reproduce dist/ byte for byte.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pinned by tag and digest so the build toolchain never silently changes.
IMAGE="emscripten/emsdk:3.1.69@sha256:9d6522879357a363ada61862481cc12c5f772d5e9738b8addf95d38490cdc6ea"

mkdir -p "${ROOT_DIR}/dist"

docker run --rm \
  --platform linux/amd64 \
  -v "${ROOT_DIR}:/src:ro" \
  -v "${ROOT_DIR}/dist:/dist" \
  -w /work \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail

    # Build out of tree so the mounted, read-only vendor source is never
    # touched by configure or make artefacts.
    cp -R /src/vendor/lame-3.100 /work/lame-3.100
    cd /work/lame-3.100

    emconfigure ./configure \
      --host=i686-pc-linux-gnu \
      --disable-shared \
      --disable-decoder \
      --disable-frontend \
      --disable-gtktest \
      --disable-nasm

    emmake make -j"$(nproc)" -C libmp3lame

    mkdir -p /work/dist

    emcc /src/src/gc_lame.c \
      -I include -I libmp3lame -I mpglib \
      libmp3lame/.libs/libmp3lame.a \
      -O3 \
      -sMODULARIZE=1 \
      -sEXPORT_ES6=1 \
      -sEXPORT_NAME=createLameMp3Core \
      -sENVIRONMENT=web,worker,node \
      -sALLOW_MEMORY_GROWTH=1 \
      -sEXPORTED_FUNCTIONS=_gc_lame_open,_gc_lame_encode,_gc_lame_flush,_gc_lame_interface_version,_malloc,_free \
      -sEXPORTED_RUNTIME_METHODS=cwrap,ccall,HEAPF32,HEAPU8 \
      -o /work/dist/lame-mp3-core.js

    cp /src/src/lame-mp3.js /work/dist/lame-mp3.js
    cp /work/dist/* /dist/
  '

echo "Built dist/lame-mp3.js, dist/lame-mp3-core.js and dist/lame-mp3-core.wasm"
