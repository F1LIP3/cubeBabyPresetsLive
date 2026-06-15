const TARGET_SAMPLE_RATE = 48000;
const IR_SAMPLES = 512;
const IR_ROM_SAMPLES = 1024;
const IR_BYTES = IR_SAMPLES * 4;
const IR_ROM_BYTES = IR_ROM_SAMPLES * 4;

export async function processWavFile(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    await ctx.close();
  }

  const channels: Float32Array[] = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  const worker = new Worker(new URL('./irWorker.ts', import.meta.url));
  
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      resolve(e.data.ir as Float32Array);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({
      channels,
      sourceRate: audioBuffer.sampleRate,
      targetRate: TARGET_SAMPLE_RATE,
      irSamples: IR_SAMPLES
    });
  });
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
