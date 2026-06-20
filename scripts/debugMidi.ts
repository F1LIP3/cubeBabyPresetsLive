import midi from 'midi';
import { messageToSysex, messageFromSysex } from '../src/protocol/parser';
import {
  buildWriteParameterMessage,
  buildWriteFlashPresetMessage,
  buildWriteActivePresetMessage,
  buildInitMessage,
  buildReadPresetMessage,
} from '../src/protocol/index';
import type { Settings, ParameterName, PresetName, Message } from '../src/protocol/types';

const OUTPUT_NAME = 'USB-Midi';
const INPUT_NAME = 'USB-Midi';

function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // List ports
  const input = new midi.Input();
  const output = new midi.Output();

  console.log('=== MIDI Ports ===');
  for (let i = 0; i < input.getPortCount(); i++) {
    console.log(`  Input ${i}: ${input.getPortName(i)}`);
  }
  for (let i = 0; i < output.getPortCount(); i++) {
    console.log(`  Output ${i}: ${output.getPortName(i)}`);
  }

  // Find Cube Baby ports (first non-Microsoft MIDI device)
  let inPort = -1;
  let outPort = -1;
  for (let i = 0; i < input.getPortCount(); i++) {
    const name = input.getPortName(i);
    if (!name.includes('Microsoft') && !name.includes('Wavetable')) {
      if (inPort === -1) inPort = i;
    }
  }
  for (let i = 0; i < output.getPortCount(); i++) {
    const name = output.getPortName(i);
    if (!name.includes('Microsoft') && !name.includes('Wavetable')) {
      if (outPort === -1) outPort = i;
    }
  }

  if (inPort === -1 || outPort === -1) {
    console.log('\nCube Baby device not found. Connect the pedal via USB.');
    process.exit(1);
  }

  console.log(`\nConnecting to ${output.getPortName(outPort)}...`);

  // Open ports
  input.openPort(inPort);
  output.openPort(outPort);

  input.ignoreTypes(false, false, false); // receive Sysex

  // Message queue
  let lastResponse: Message | null = null;
  let resolveResponse: ((msg: Message) => void) | null = null;

  input.on('message', (_deltaTime: number, raw: number[]) => {
    const rawBytes = new Uint8Array(raw);
    try {
      const msg = messageFromSysex(rawBytes);
      console.log(`  RX: ${msg.type} ${JSON.stringify(msg)}`);
      if (resolveResponse) {
        resolveResponse(msg);
        resolveResponse = null;
      }
    } catch (e) {
      console.log(`  RX raw: ${toHex(rawBytes)} (unparseable: ${e})`);
    }
  });

  async function send(msg: Message): Promise<Message> {
    const sysex = messageToSysex(msg);
    console.log(`TX: ${msg.type} ${JSON.stringify(msg)}`);
    console.log(`  hex: ${toHex(sysex)}`);
    output.sendMessage(Array.from(sysex));

    return new Promise((resolve, reject) => {
      resolveResponse = resolve;
      setTimeout(() => {
        resolveResponse = null;
        reject(new Error('Timeout waiting for response'));
      }, 5000);
    });
  }

  // === TESTS ===
  console.log('\n=== 1. Init ===');
  try {
    const resp = await send(buildInitMessage());
    console.log(`  Init response: ${resp.type}`);
  } catch (e) {
    console.log(`  Init failed: ${e}`);
  }

  await sleep(500);

  console.log('\n=== 2. Read preset A ===');
  try {
    const resp = await send(buildReadPresetMessage('A'));
    console.log(`  Read response: ${resp.type}`);
    if (resp.type === 'MemoryContent') {
      console.log(`  Data: ${toHex(resp.data)}`);
    }
  } catch (e) {
    console.log(`  Read failed: ${e}`);
  }

  await sleep(500);

  // Test: write Mix=0 (delay off) without touching section B
  console.log('\n=== 3. Write Mix=0 (delay off) ===');
  const msgMixOff = buildWriteParameterMessage('A', 'Mix', 0);
  try {
    const resp = await send(msgMixOff);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: write Mix=60 (delay on) without touching section B
  console.log('\n=== 4. Write Mix=60 (delay on) ===');
  const msgMixOn = buildWriteParameterMessage('A', 'Mix', 60);
  try {
    const resp = await send(msgMixOn);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: full 16-byte write to slot A
  console.log('\n=== 5. Full 16-byte write to slot A (0x80000000) ===');
  const testSettings: Settings = {
    type: 0, gain: 4, tone: 8, reverb: 0, feedback: 0,
    volume: 100, time: 16, mix: 60, modulation: 7, cabinet: 0,
    irSection: true, delaySection: true, toneSection: true,
  };
  const msgFull = buildWriteFlashPresetMessage('A', testSettings);
  try {
    const resp = await send(msgFull);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: toggle section B ON
  console.log('\n=== 6. Toggle Section B ON ===');
  const msgSectionBOn = buildWriteParameterMessage('A', 'DelaySection', 1);
  try {
    const resp = await send(msgSectionBOn);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: toggle section B OFF
  console.log('\n=== 7. Toggle Section B OFF ===');
  const msgSectionBOff = buildWriteParameterMessage('A', 'DelaySection', 0);
  try {
    const resp = await send(msgSectionBOff);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: write Modulation param (chorus) without section B
  console.log('\n=== 8. Write Modulation=4 (chorus) with Section B=0 ===');
  const msgModWithSectionBOff = buildWriteParameterMessage('A', 'Modulation', 4);
  try {
    const resp = await send(msgModWithSectionBOff);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Test: write full 16-byte to active area (0x0000)
  console.log('\n=== 9. Full 16-byte write to active area (0x0000) ===');
  const msgActive = buildWriteActivePresetMessage(testSettings);
  try {
    const resp = await send(msgActive);
    console.log(`  Response: ${resp.type}`);
  } catch (e) {
    console.log(`  Write failed: ${e}`);
  }

  await sleep(500);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Tests completed. Listen to the pedal to verify:');
  console.log('  Test 3-4: Mix=0 cuts delay, Mix=60 restores it (no section B change)');
  console.log('  Test 6-7: Section B ON/OFF toggles entire modulation+delay block');
  console.log('  Test 8: Modulation with Section B=0 — chorus should NOT be audible');
  console.log('  Test 5: Full 16-byte write to 0x80000000 — all params at once');
  console.log('  Test 9: Full 16-byte write to 0x0000 — all params at once');

  // Cleanup
  input.closePort();
  output.closePort();
}

main().catch(console.error);
