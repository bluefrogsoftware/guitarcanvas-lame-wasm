// Smoke test for the built dist/lame-mp3.js encoder. Encodes a 2 second
// stereo sine wave at two different block sizes (the canonical 1152-sample
// MPEG frame size, and an odd size that does not divide evenly) and checks
// the result is a clean stream of MPEG-1 Layer III frames at the requested
// bitrate, with no VBR tag and no ID3 tag, within the documented size bound.
import assert from 'node:assert/strict';

import { createLameMp3Encoder, interfaceVersion } from '../dist/lame-mp3.js';

const SAMPLE_RATE = 44100;
const BITRATE_KBPS = 192;
const DURATION_SECONDS = 2;
const TOTAL_FRAMES = SAMPLE_RATE * DURATION_SECONDS;
const TONE_HZ = 440;

// LAME's documented CBR frame size at 192 kbps / 44.1 kHz: floor(144 *
// bitrate / sampleRate) + 1 padding byte.
const MAX_FRAME_BYTES = Math.floor((144 * BITRATE_KBPS * 1000) / SAMPLE_RATE) + 1;
assert.equal(MAX_FRAME_BYTES, 627);

// LAME's own encoder delay (1057 samples) plus flush padding (up to 288
// samples), rounded up with a couple of frames of slack for margin.
const ENCODER_DELAY_AND_FLUSH_SAMPLES = 1105;
const SLACK_FRAMES = 2;

function sizeBoundBytes(pcmFrameCount) {
  const mp3Frames = Math.ceil((pcmFrameCount + ENCODER_DELAY_AND_FLUSH_SAMPLES) / 1152) + SLACK_FRAMES;
  return mp3Frames * MAX_FRAME_BYTES;
}

function generateSineBlock(startFrame, frameCount) {
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const t = (startFrame + i) / SAMPLE_RATE;
    const sample = Math.sin(2 * Math.PI * TONE_HZ * t) * 0.5;
    left[i] = sample;
    right[i] = sample;
  }
  return { left, right };
}

async function encodeInBlocks(blockSize) {
  const encoder = await createLameMp3Encoder({ sampleRate: SAMPLE_RATE, bitrateKbps: BITRATE_KBPS });
  const chunks = [];
  let frame = 0;
  while (frame < TOTAL_FRAMES) {
    const frameCount = Math.min(blockSize, TOTAL_FRAMES - frame);
    const { left, right } = generateSineBlock(frame, frameCount);
    chunks.push(encoder.encode(left, right));
    frame += frameCount;
  }
  chunks.push(encoder.flush());

  assert.throws(() => encoder.encode(new Float32Array(1), new Float32Array(1)), /flush/);

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function assertNoTagMarkers(bytes) {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  for (const marker of ['Xing', 'Info', 'ID3']) {
    assert.equal(text.includes(marker), false, `unexpected ${marker} marker in encoded stream`);
  }
}

const MPEG1_LAYER3_BITRATE_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000, 0];

function assertValidFrameStream(bytes) {
  let offset = 0;
  let frameCount = 0;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff, `expected sync byte at offset ${offset}`);
    assert.equal(bytes[offset + 1] & 0xe0, 0xe0, `expected sync bits at offset ${offset + 1}`);

    const header1 = bytes[offset + 1];
    const versionBits = (header1 >> 3) & 0x3;
    const layerBits = (header1 >> 1) & 0x3;
    assert.equal(versionBits, 0b11, 'expected MPEG version 1');
    assert.equal(layerBits, 0b01, 'expected Layer III');

    const header2 = bytes[offset + 2];
    const bitrateIndex = (header2 >> 4) & 0xf;
    const samplingIndex = (header2 >> 2) & 0x3;
    const padding = (header2 >> 1) & 0x1;

    const bitrateKbps = MPEG1_LAYER3_BITRATE_KBPS[bitrateIndex];
    const sampleRate = MPEG1_SAMPLE_RATES[samplingIndex];
    assert.equal(bitrateKbps, BITRATE_KBPS, 'expected constant 192 kbps frames');
    assert.equal(sampleRate, SAMPLE_RATE, 'expected 44.1 kHz frames');

    const frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
    assert.ok(frameLength > 0, 'frame length must be positive');

    offset += frameLength;
    frameCount += 1;
  }
  assert.equal(offset, bytes.length, 'frames must exactly tile the encoded stream');
  return frameCount;
}

async function main() {
  assert.equal(interfaceVersion, 1);

  const bound = sizeBoundBytes(TOTAL_FRAMES);

  const standardBlocks = await encodeInBlocks(1152);
  assertNoTagMarkers(standardBlocks);
  const standardFrameCount = assertValidFrameStream(standardBlocks);
  assert.ok(standardFrameCount > 0, 'expected at least one encoded frame');
  assert.ok(
    standardBlocks.length <= bound,
    `1152-block output ${standardBlocks.length} bytes exceeded bound ${bound} bytes`,
  );

  const oddBlocks = await encodeInBlocks(577);
  assertNoTagMarkers(oddBlocks);
  const oddFrameCount = assertValidFrameStream(oddBlocks);
  assert.ok(oddFrameCount > 0, 'expected at least one encoded frame');
  assert.ok(
    oddBlocks.length <= bound,
    `odd-block output ${oddBlocks.length} bytes exceeded bound ${bound} bytes`,
  );

  console.log(
    `smoke test passed: ${standardFrameCount} frames (1152-block), ${oddFrameCount} frames (577-block), bound ${bound} bytes`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
