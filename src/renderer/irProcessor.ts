const TARGET_SAMPLE_RATE = 48000;
const IR_SAMPLES = 512;
const IR_ROM_SAMPLES = 1024;
const IR_BYTES = IR_SAMPLES * 4;
const IR_ROM_BYTES = IR_ROM_SAMPLES * 4;

function resample(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate) return src;
  const ratio = dstRate / srcRate;
  const dst = new Float32Array(Math.round(src.length * ratio));
  for (let i = 0; i < dst.length; i++) {
    const pos = i / ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, src.length - 1);
    const frac = pos - lo;
    dst[i] = src[lo] + (src[hi] - src[lo]) * frac;
  }
  return dst;
}

export async function processWavFile(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }

  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Mix down to mono
  const mono = new Float32Array(length);
  if (numChannels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    for (let ch = 0; ch < numChannels; ch++) {
      const chData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += chData[i] / numChannels;
    }
  }

  // Resample to 48kHz
  const resampled = resample(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

  // Trim/pad to exactly 512 samples
  const ir = new Float32Array(IR_SAMPLES);
  const copyLen = Math.min(resampled.length, IR_SAMPLES);
  ir.set(resampled.subarray(0, copyLen));

  // Normalize peak to 1.0
  let peak = 0;
  for (let i = 0; i < IR_SAMPLES; i++) {
    const abs = Math.abs(ir[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    for (let i = 0; i < IR_SAMPLES; i++) ir[i] /= peak;
  }

  return ir;
}

export function irToBytes(ir: Float32Array): Uint8Array {
  return new Uint8Array(ir.buffer);
}

export function padIrToRomBytes(ir: Float32Array): Uint8Array {
  // Each ROM cabinet: 4B flag(0x01,0,0,0) + 4B volume(float32) + 4088B audio(1022 samples)
  var romBytes = new Uint8Array(IR_ROM_BYTES);
  // Flag
  romBytes[0] = 0x01;
  // Volume (default 0.7)
  var volBuf = new ArrayBuffer(4);
  new DataView(volBuf).setFloat32(0, 0.7, true);
  var volBytes = new Uint8Array(volBuf);
  romBytes[4] = volBytes[0];
  romBytes[5] = volBytes[1];
  romBytes[6] = volBytes[2];
  romBytes[7] = volBytes[3];
  // Audio: pad 512 samples to 1022 samples (4088 bytes)
  var audioSamples = 1022;
  var audioF32 = new Float32Array(audioSamples);
  var copyLen = Math.min(ir.length, audioSamples);
  audioF32.set(ir.subarray(0, copyLen));
  var audioBytes = new Uint8Array(audioF32.buffer);
  romBytes.set(audioBytes, 8);
  return romBytes;
}

export function bytesToIr(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function irSummary(ir: Float32Array): string {
  return Array.from(ir.slice(0, 8)).map(v => v.toFixed(4)).join(', ');
}

export function float32ToWav(ir: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Uint8Array {
  const numSamples = ir.length;
  const dataSize = numSamples * 4;
  const headerSize = 44;
  const buf = new ArrayBuffer(headerSize + dataSize);
  const dv = new DataView(buf);

  // RIFF header
  writeStr(dv, 0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(dv, 8, 'WAVE');

  // fmt chunk (PCM float32)
  writeStr(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);        // chunk size
  dv.setUint16(20, 3, true);         // IEEE float
  dv.setUint16(22, 1, true);         // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true); // byte rate
  dv.setUint16(32, 4, true);         // block align
  dv.setUint16(34, 32, true);        // bits per sample

  // data chunk
  writeStr(dv, 36, 'data');
  dv.setUint32(40, dataSize, true);

  // Samples
  const view = new Float32Array(buf, headerSize, numSamples);
  view.set(ir);

  return new Uint8Array(buf);
}

function writeStr(dv: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i));
}

export { IR_SAMPLES, IR_BYTES, IR_ROM_SAMPLES, IR_ROM_BYTES, TARGET_SAMPLE_RATE };
