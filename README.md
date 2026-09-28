# guitarcanvas-lame-wasm

A WebAssembly build of the LAME MP3 encoder, used by Guitar Canvas to encode
recorded audio to MP3 entirely in the browser (and in the Capacitor mobile
app), with no server round trip.

## What is vendored

- `vendor/lame-3.100/`: the unmodified upstream LAME 3.100 source tree, as
  released on SourceForge.
- `vendor/lame-3.100.tar.gz.sha256`: the SHA-256 checksum of the upstream
  `lame-3.100.tar.gz` release tarball, `ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`.
  Verified independently against the SHA-512 published in the Gentoo
  `media-sound/lame` package `Manifest` (`0844b9eadb4aacf8000444621451277de365041cc1d97b7f7a589da0b7a23899310afd4e4d81114b9912aa97832621d20588034715573d417b2923948c08634b`),
  which matches the downloaded tarball exactly.
- `LICENSE`: LAME's own licence text (`COPYING` from the vendored source),
  the GNU Library General Public License, version 2 or later
  (SPDX: `LGPL-2.0-or-later`).

## Wrapper interface, version 1

`src/gc_lame.c` wraps `libmp3lame` with four functions:

- `int gc_lame_interface_version(void)`: returns `1`. Callers should check
  this before using any other function, so a future incompatible wrapper
  change is caught instead of silently misinterpreted.
- `lame_global_flags *gc_lame_open(int sample_rate, int bitrate_kbps)`:
  opens an encoder configured for two channels, constant bitrate, no
  Xing/Info VBR tag and no automatic ID3 tag. Returns `NULL` on failure.
- `int gc_lame_encode(lame_global_flags *gfp, const float *left, const float *right, int frames, unsigned char *out, int capacity)`:
  encodes `frames` samples of planar, 32-bit float PCM in the range
  `+/-1.0` (via `lame_encode_buffer_ieee_float`) into `out`. Returns the
  number of bytes written, or a negative code on failure.
- `int gc_lame_flush(lame_global_flags *gfp, unsigned char *out, int capacity)`:
  flushes any buffered audio into `out`, then closes and frees the encoder
  handle. Returns the number of bytes written, or a negative code on
  failure. The handle must not be used again after this call.

`src/lame-mp3.js` is the thin, documented loader that calls this interface
through the Emscripten-generated bindings and exposes:

```js
export const interfaceVersion = 1;

export async function createLameMp3Encoder({ sampleRate, bitrateKbps }) {
  // returns { encode(left: Float32Array, right: Float32Array): Uint8Array, flush(): Uint8Array }
}
```

`encode` throws on any negative wrapper return code, and throws if called
after `flush`. `flush` throws if called more than once.

## Building

Prerequisites: Docker only. No local Emscripten install is required or used.

```sh
./build.sh
```

This builds inside the pinned `emscripten/emsdk` image (tag and digest fixed
in `build.sh`, `linux/amd64`, which runs under emulation on Apple Silicon).
It configures and builds `libmp3lame` out of tree, so the mounted vendor
source is never modified, then links `src/gc_lame.c` against the static
library with:

- `-sMODULARIZE -sEXPORT_ES6`: emits an ES module exporting a factory
  function, so the core is loaded with a plain `import`.
- `-sENVIRONMENT=web,worker,node`: usable from the browser main thread, a
  Web Worker, and Node (for tests).
- `-sALLOW_MEMORY_GROWTH`: the encoder's memory needs grow with input size,
  which is unbounded ahead of time.

Output: `dist/lame-mp3.js` (the loader, copied verbatim from `src/`),
`dist/lame-mp3-core.js` and `dist/lame-mp3-core.wasm` (the Emscripten glue
and the compiled encoder). All three are committed, so consumers of this
package need no toolchain of their own. Re-running `build.sh` reproduces
`dist/` byte for byte.

The `.js` extension is used for all three files, rather than `.mjs`, so that
every platform's static file handler (including Capacitor's bundled web
assets on iOS and Android) serves them with a JavaScript MIME type without
extra configuration.

## How Guitar Canvas loads this package

The app depends on this repository directly by commit:

```json
"guitarcanvas-lame-wasm": "git+https://github.com/bluefrogsoftware/guitarcanvas-lame-wasm.git#<commit sha>"
```

An `npm` `postinstall` step copies `dist/lame-mp3.js`, `dist/lame-mp3-core.js`
and `dist/lame-mp3-core.wasm` into the app's `public/assets/lame-mp3/`
(gitignored), so they ship as ordinary static files served at
`/assets/lame-mp3/` on the web build and inside the Capacitor bundle for iOS
and Android. `mp3Encoder.ts` in the app loads `lame-mp3.js` from that fixed
path with a dynamic `import()`.

### Relinking after a change here

1. Run `./build.sh` in this repository.
2. Commit the updated `dist/` output and push.
3. In the app, update the `guitarcanvas-lame-wasm` dependency in
   `app/package.json` to the new commit SHA and run `npm install`, which
   re-runs `postinstall` and copies the three files into
   `public/assets/lame-mp3/` for web.
4. In the app, run `npm run licences:generate` to regenerate the licence
   manifest with the package's upstream LAME attribution, then run
   `npm run build`. For the iOS and Android Capacitor bundles, run
   `npx cap sync` so the updated static assets are copied into the native
   project's bundled web directory before the next native build.

## Licence and the written offer

LAME is licensed under the GNU Library General Public License, version 2 or
later. This repository redistributes the unmodified upstream source
(`vendor/lame-3.100/`) alongside the compiled WebAssembly build (`dist/`),
which satisfies the LGPL's source-availability requirement for anyone who
has this repository.

For the compiled WebAssembly binary as shipped inside the Guitar Canvas web
and mobile applications, Blue Frog Software Pty Ltd additionally offers, for
at least three years after the application version containing it is no
longer distributed, to provide the complete corresponding LAME source code
on request, at no charge beyond the cost of the distribution medium, by
contacting support@guitarcanvas.app.
