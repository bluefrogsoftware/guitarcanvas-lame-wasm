/*
 * Thin documented loader over the Emscripten build of the LAME encoder.
 * Consumers load this module directly (it has no bundler-specific
 * behaviour) and call createLameMp3Encoder to get a stateful encoder
 * bound to one sample rate and bitrate.
 */

import createLameMp3Core from './lame-mp3-core.js';

export const interfaceVersion = 1;

/**
 * @param {{ sampleRate: number, bitrateKbps: number }} options
 * @returns {Promise<{ encode(left: Float32Array, right: Float32Array): Uint8Array, flush(): Uint8Array }>}
 */
export async function createLameMp3Encoder({ sampleRate, bitrateKbps }) {
  const core = await createLameMp3Core();

  const openEncoder = core.cwrap('gc_lame_open', 'number', ['number', 'number']);
  const encodeFrames = core.cwrap('gc_lame_encode', 'number', [
    'number',
    'number',
    'number',
    'number',
    'number',
    'number',
  ]);
  const flushEncoder = core.cwrap('gc_lame_flush', 'number', ['number', 'number', 'number']);

  const handle = openEncoder(sampleRate, bitrateKbps);
  if (handle === 0) {
    throw new Error('guitarcanvas-lame-wasm: gc_lame_open failed to initialise the encoder');
  }

  let flushed = false;

  function writePlanarFloat(samples) {
    const bytes = samples.length * Float32Array.BYTES_PER_ELEMENT;
    const ptr = core._malloc(bytes);
    core.HEAPF32.set(samples, ptr / Float32Array.BYTES_PER_ELEMENT);
    return ptr;
  }

  function readEncodedBytes(ptr, byteLength) {
    return core.HEAPU8.slice(ptr, ptr + byteLength);
  }

  return {
    encode(left, right) {
      if (flushed) {
        throw new Error('guitarcanvas-lame-wasm: encode called after flush');
      }
      if (left.length !== right.length) {
        throw new Error('guitarcanvas-lame-wasm: left and right channels must be the same length');
      }

      const frames = left.length;
      // LAME's documented minimum output buffer size for encode calls.
      const capacity = Math.ceil(1.25 * frames) + 7200;

      const leftPtr = writePlanarFloat(left);
      const rightPtr = writePlanarFloat(right);
      const outPtr = core._malloc(capacity);
      try {
        const written = encodeFrames(handle, leftPtr, rightPtr, frames, outPtr, capacity);
        if (written < 0) {
          throw new Error(`guitarcanvas-lame-wasm: gc_lame_encode failed with code ${written}`);
        }
        return readEncodedBytes(outPtr, written);
      } finally {
        core._free(leftPtr);
        core._free(rightPtr);
        core._free(outPtr);
      }
    },

    flush() {
      if (flushed) {
        throw new Error('guitarcanvas-lame-wasm: flush called more than once');
      }
      flushed = true;

      // LAME's documented minimum output buffer size for the flush call.
      const capacity = 7200;
      const outPtr = core._malloc(capacity);
      try {
        const written = flushEncoder(handle, outPtr, capacity);
        if (written < 0) {
          throw new Error(`guitarcanvas-lame-wasm: gc_lame_flush failed with code ${written}`);
        }
        return readEncodedBytes(outPtr, written);
      } finally {
        core._free(outPtr);
      }
    },
  };
}
