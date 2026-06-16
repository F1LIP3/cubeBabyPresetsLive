/// <reference lib="webworker" />

self.onmessage = function(e) {
  const { channels, sourceRate, targetRate, irSamples } = e.data;
  
  // 1. Mix down to mono
  let mono = new Float32Array(channels[0].length);
  if (channels.length === 1) {
    mono.set(channels[0]);
  } else {
    for (let i = 0; i < mono.length; i++) {
      for (let ch = 0; ch < channels.length; ch++) {
        mono[i] += channels[ch][i] / channels.length;
      }
    }
  }

  // 2. Resample
  const ratio = targetRate / sourceRate;
  const dstLength = Math.round(mono.length * ratio);
  const resampled = new Float32Array(dstLength);
  for (let i = 0; i < dstLength; i++) {
    const pos = i / ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, mono.length - 1);
    const frac = pos - lo;
    resampled[i] = mono[lo] + (mono[hi] - mono[lo]) * frac;
  }

  // 3. Trim/pad to exactly irSamples
  const ir = new Float32Array(irSamples);
  const copyLen = Math.min(resampled.length, irSamples);
  ir.set(resampled.subarray(0, copyLen));

  // 4. Normalize peak to 1.0
  let peak = 0;
  for (let i = 0; i < irSamples; i++) {
    const abs = Math.abs(ir[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    for (let i = 0; i < irSamples; i++) ir[i] /= peak;
  }

  self.postMessage({ ir }, [ir.buffer]);
};
