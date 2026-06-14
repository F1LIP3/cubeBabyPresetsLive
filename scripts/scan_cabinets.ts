import { CubeBabyMidi } from '../src/midi/cubeBabyMidi';
import { IR_DATA_ROM_ADDR, IR_SLOT_SIZE, IR_SLOT_COUNT } from '../src/protocol/types';

function float32Array(buf: Uint8Array): string {
  const f32 = new Float32Array(buf.buffer);
  const parts: string[] = [];
  for (let i = 0; i < Math.min(f32.length, 64); i++) {
    parts.push(f32[i].toFixed(6));
  }
  return `[${parts.join(', ')}]`;
}

function hexDump(buf: Uint8Array, len: number = 64): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    parts.push(buf[i].toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

function asciiDump(buf: Uint8Array, len: number = 128): string {
  let s = '';
  for (let i = 0; i < Math.min(buf.length, len); i++) {
    const b = buf[i];
    s += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
  }
  return s;
}

async function main() {
  const baby = new CubeBabyMidi();
  console.log('Connecting...');
  await baby.connect();
  console.log('Connected!\n');

  // 1. Read all 8 slots at 0x00069000 (first 64 bytes each)
  console.log('=== SLOT DATA (first 64 bytes as float32) ===');
  for (let slot = 0; slot < IR_SLOT_COUNT; slot++) {
    const addr = IR_DATA_ROM_ADDR + slot * IR_SLOT_SIZE;
    const data = await baby.readIRFromRom(slot, 64);
    const f32 = new Float32Array(data.buffer);
    // Check if this looks like IR data (not all zeros/NaN)
    const hasValid = Array.from(f32.slice(0, 8)).some(v => v > 0.001 || v < -0.001);
    console.log(`Slot ${slot} @ 0x${addr.toString(16)}: ${float32Array(data)}`);
    console.log(`  ASCII: "${asciiDump(data, 64)}"`);
  }

  // 2. Read 8192 bytes from slot 0 to see if there's more than 2048
  console.log('\n=== SLOT 0: 8192 BYTE DUMP ===');
  try {
    const bigData = await baby.readIRFromRom(0, 8192);
    console.log(`Read ${bigData.length} bytes from slot 0 start`);
    // Check sections
    for (let off = 0; off < 8192; off += 256) {
      const chunk = bigData.slice(off, Math.min(off + 256, 8192));
      const f32 = new Float32Array(chunk.buffer);
      const ascii = asciiDump(chunk, 256);
      // Check for interesting patterns
      const hasStrings = /[A-Za-z]{4,}/.test(ascii);
      const hasAudio = f32.some(v => v > 0.01 || v < -0.01);
      if (hasStrings || hasAudio || off < 1024) {
        console.log(`  Offset ${off}: ASCII="${ascii}"`);
        if (off < 256) console.log(`    float32: ${float32Array(chunk.slice(0, 32))}`);
      }
    }
  } catch (e: any) {
    console.log(`  8192 read failed: ${e.message}`);
  }

  // 3. Read data BEFORE 0x00069000 to find metadata/cabinet table
  console.log('\n=== SCAN BEFORE CABINET AREA ===');
  const scanOffsets = [0x00000000, 0x00001000, 0x00002000, 0x00003000, 0x00004000,
                       0x00005000, 0x00006000, 0x00007000, 0x00008000, 0x00009000,
                       0x0000A000, 0x0000B000, 0x0000C000, 0x0000D000, 0x0000E000,
                       0x0000F000, 0x00010000, 0x00020000, 0x00030000, 0x00040000,
                       0x00050000, 0x00060000, 0x00061000, 0x00062000, 0x00063000,
                       0x00064000, 0x00065000, 0x00066000, 0x00067000, 0x00068000,
                       0x00068800, 0x00069000];
  for (const offset of scanOffsets) {
    try {
      const data = await baby.readIRFromRom(0, 64);
      // We can't control the address in readIRFromRom — it always reads from slot base
      // Let me read with explicit address
    } catch {}
  }

  // Use explicit ReadMemory for scanning
  console.log('\n=== SCAN WITH EXPLICIT ADDRESSES (cmd=0, 64 bytes each) ===');
  for (const offset of [0x00068000, 0x00068800, 0x00069000, 0x00069800]) {
    try {
      const msg = await baby.sendAndWait({
        type: 'ReadMemory', cmd: 0,
        addr: offset, len: 64,
      });
      if (msg.type === 'MemoryContent') {
        const ascii = asciiDump(msg.data, 64);
        const f32 = new Float32Array(msg.data.buffer);
        console.log(`0x${offset.toString(16)}: float32=${float32Array(msg.data)}`);
        console.log(`  ASCII: "${ascii}"`);
      }
    } catch (e: any) {
      console.log(`0x${offset.toString(16)}: error: ${e.message}`);
    }
  }

  // 4. Try to find the "patchCAB" string marker in memory
  console.log('\n=== SEARCH FOR "patchCAB" MARKER ===');
  // Search around the cabinet area
  for (let addr = 0x00060000; addr < 0x00080000; addr += 0x1000) {
    try {
      const msg = await baby.sendAndWait({
        type: 'ReadMemory', cmd: 0,
        addr, len: 64,
      });
      if (msg.type === 'MemoryContent') {
        const ascii = asciiDump(msg.data, 64);
        if (/patchCAB|CAB|Tweed|Deluxe|Showman|Roland|Marshall|Vox|Twin/.test(ascii)) {
          console.log(`FOUND at 0x${addr.toString(16)}: "${ascii}"`);
        }
      }
    } catch {}
  }

  baby.disconnect();
  console.log('\nDone');
}

main().catch(console.error);
