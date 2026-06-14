const U32_MAX = 0xffffffff;

function u32Shr(x: number, shift: number): number {
  return (x >>> shift) >>> 0;
}

export function encode(source: Uint8Array): Uint8Array {
  const dest: number[] = [];
  let bitNum = 0;
  let accum = 0;

  for (let i = 0; i < source.length; i++) {
    const b = source[i];
    accum = (accum | (b << (bitNum & 0x1f))) >>> 0;
    bitNum += 1;

    while (true) {
      dest.push(accum & 0x7f);
      accum = u32Shr(accum, 7);
      if (bitNum < 7) break;
      bitNum -= 7;
    }
  }

  dest.push(accum & 0x7f);
  return new Uint8Array(dest);
}

export function decode(source: Uint8Array): Uint8Array {
  const dest: number[] = [];
  let bitNum = 0;
  let lastVal = 0;

  for (let i = 0; i < source.length; i++) {
    const b = source[i];
    const mask = u32Shr(U32_MAX, 32 - bitNum);
    const accum = b & mask;

    if (bitNum > 0) {
      dest.push((lastVal & 0x7f) | (accum << (8 - bitNum)));
    }
    lastVal = b >>> bitNum;
    bitNum = (bitNum + 1) % 8;
  }

  if (lastVal > 0) {
    dest.push(lastVal);
  }

  return new Uint8Array(dest);
}
