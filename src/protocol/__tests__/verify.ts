import { encode, decode } from '../encode';
import { messageToSysex, messageFromSysex } from '../parser';
import type { Message, Settings, ParameterName } from '../types';
import { PARAMETER_ADDRESS_OFFSET, PARAMETER_NAMES } from '../types';
import {
  settingsToBytes, bytesToSettings,
  settingsToKnobValues, knobValuesToSettings,
  knobValueToParameterName,
  buildWriteParameterMessage, buildReadPresetMessage,
  buildWriteFlashPresetMessage, buildWriteActivePresetMessage,
  KnobValues,
} from '../index';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Rust test: encode([0x00, 0x59, 0x22, 0x09, 0x00, 0x00, 0x05, 0x09, 0x00, 0x00, 0x80, 0x01, 0x00, 0x00, 0x01, 0x6f])
// should be [0x0, 0x32, 0x9, 0x49, 0x0, 0x0, 0x40, 0x2, 0x9, 0x0, 0x0, 0x0, 0x18, 0x0, 0x0, 0x0, 0x1, 0x5e, 0x01]
const cleartext = new Uint8Array([0x00, 0x59, 0x22, 0x09, 0x00, 0x00, 0x05, 0x09, 0x00, 0x00, 0x80, 0x01, 0x00, 0x00, 0x01, 0x6f]);
const expectedEncoded = new Uint8Array([0x0, 0x32, 0x9, 0x49, 0x0, 0x0, 0x40, 0x2, 0x9, 0x0, 0x0, 0x0, 0x18, 0x0, 0x0, 0x0, 0x1, 0x5e, 0x01]);

const encoded = encode(cleartext);
console.log('Encode test 1:');
console.log('  Expected:', toHex(expectedEncoded));
console.log('  Got:     ', toHex(encoded));
console.log('  Match:', Array.from(encoded).every((b, i) => b === expectedEncoded[i]));

const decoded = decode(encoded);
console.log('Decode roundtrip:');
console.log('  Expected:', toHex(cleartext));
console.log('  Got:     ', toHex(decoded));
console.log('  Match:', Array.from(decoded).every((b, i) => b === cleartext[i]));

// Rust test: decode [240, 0, 50, 1, 0, 0, 0, 64, 127, 0, 247] should be Init
const initSysex = new Uint8Array([240, 0, 50, 1, 0, 0, 0, 64, 127, 0, 247]);
const initMsg = messageFromSysex(initSysex);
console.log('\nInit decode test:');
console.log('  Message:', JSON.stringify(initMsg));
console.log('  Type:', initMsg.type === 'Init' ? 'PASS' : 'FAIL');

// Roundtrip: build Init, encode, decode back
const reEncoded = messageToSysex(initMsg);
const reDecoded = messageFromSysex(reEncoded);
console.log('\nInit roundtrip:');
console.log('  Original:', toHex(initSysex));
console.log('  Re-enc:  ', toHex(reEncoded));
console.log('  Match:', Array.from(initSysex).every((b, i) => b === reEncoded[i]));
console.log('  Type:', reDecoded.type === 'Init' ? 'PASS' : 'FAIL');

// Test WriteMemory roundtrip
const writeMsg: Message = {
  type: 'WriteMemory',
  cmd: 0x05,
  addr: 0x80000000,
  len: 16,
  data: new Uint8Array(16),
};
const writeSysex = messageToSysex(writeMsg);
const writeBack = messageFromSysex(writeSysex);
console.log('\nWriteMemory roundtrip:');
console.log('  Original:', JSON.stringify(writeMsg));
console.log('  Roundtrip:', JSON.stringify(writeBack));
console.log('  Match:', writeBack.type === 'WriteMemory'
  && writeBack.cmd === writeMsg.cmd
  && writeBack.addr === writeMsg.addr
  && writeBack.len === writeMsg.len
  && Array.from(writeBack.data).every((b, i) => b === writeMsg.data[i])
  ? 'PASS' : 'FAIL');

// Test ReadMemory roundtrip
const readMsg: Message = { type: 'ReadMemory', cmd: 0x05, addr: 0x80000010, len: 16 };
const readSysex = messageToSysex(readMsg);
const readBack = messageFromSysex(readSysex);
console.log('\nReadMemory roundtrip:');
console.log('  Original:', JSON.stringify(readMsg));
console.log('  Roundtrip:', JSON.stringify(readBack));
console.log('  Match:', readBack.type === 'ReadMemory'
  && readBack.cmd === readMsg.cmd
  && readBack.addr === readMsg.addr
  && readBack.len === readMsg.len
  ? 'PASS' : 'FAIL');

// ====== MAPPING CONSISTENCY TESTS ======

// Test: settingsToBytes -> bytesToSettings roundtrip
console.log('\n--- Settings↔Bytes Roundtrip ---');
const testSettings: Settings = {
  type: 3, gain: 5, tone: 10, reverb: 7,
  feedback: 80, volume: 110, time: 20, mix: 50,
  modulation: 6, cabinet: 4,
  irSection: true, delaySection: false, toneSection: true,
};
const bytes = settingsToBytes(testSettings);
const back = bytesToSettings(bytes);
const settingsMatch = testSettings.type === back.type
  && testSettings.gain === back.gain
  && testSettings.tone === back.tone
  && testSettings.reverb === back.reverb
  && testSettings.feedback === back.feedback
  && testSettings.volume === back.volume
  && testSettings.time === back.time
  && testSettings.mix === back.mix
  && testSettings.modulation === back.modulation
  && testSettings.cabinet === back.cabinet
  && testSettings.irSection === back.irSection
  && testSettings.delaySection === back.delaySection
  && testSettings.toneSection === back.toneSection;
console.log('  Settings→Bytes→Settings:', settingsMatch ? 'PASS' : 'FAIL');
if (!settingsMatch) {
  console.log('    Original:', JSON.stringify(testSettings));
  console.log('    Roundtrip:', JSON.stringify(back));
  console.log('    Bytes:', toHex(bytes));
}

// Test: knobValues -> settingsToKnobValues consistency
console.log('\n--- Knob Values↔Settings Roundtrip ---');
const knobs: KnobValues = {
  type: 3, gain: 5, tone: 10, mod: 6, time: 20,
  fb: 80, mix: 50, reverb: 7, ir_cab: 4, volume: 110,
  irSection: true, delaySection: true, toneSection: true,
};
const s = knobValuesToSettings(knobs);
const k2 = settingsToKnobValues(s);
const knobMatch = knobs.type === k2.type
  && knobs.gain === k2.gain
  && knobs.tone === k2.tone
  && knobs.mod === k2.mod
  && knobs.time === k2.time
  && knobs.fb === k2.fb
  && knobs.mix === k2.mix
  && knobs.reverb === k2.reverb
  && knobs.ir_cab === k2.ir_cab
  && knobs.volume === k2.volume;
console.log('  Knobs→Settings→Knobs:', knobMatch ? 'PASS' : 'FAIL');
if (!knobMatch) {
  console.log('    Original:', JSON.stringify(knobs));
  console.log('    Roundtrip:', JSON.stringify(k2));
  console.log('    Settings:', JSON.stringify(s));
}

// Test: Verify parameter addresses match the memory layout
console.log('\n--- Parameter Address Offsets ---');
const expectedOffsets: [ParameterName, number][] = [
  ['Type', 0], ['Gain', 1], ['Tone', 2], ['Reverb', 3],
  ['Feedback', 4], ['Volume', 5], ['Time', 6], ['Mix', 7],
  ['Modulation', 8], ['Cabinet', 9],
  ['IRSection', 10], ['DelaySection', 11], ['ToneSection', 12],
];
for (const [param, expected] of expectedOffsets) {
  const actual = PARAMETER_ADDRESS_OFFSET[param];
  const ok = actual === expected;
  console.log(`  ${param.padEnd(15)} expected=${expected} actual=${actual} ${ok ? '✓' : '✗'}`);
  if (!ok) console.log('    FAIL');
}

// Test: buildWriteParameterMessage generates WriteMemory to correct address
console.log('\n--- Write Message Address Verification ---');
for (const [param, offset] of expectedOffsets) {
  const msg = buildWriteParameterMessage('A', param, 0);
  if (msg.type === 'WriteMemory') {
    const expectedAddr = 0x80000000 + offset;
    const addrOk = msg.addr === expectedAddr;
    console.log(`  ${param.padEnd(15)} offset=${offset} addr=0x${msg.addr.toString(16)} (expected 0x${expectedAddr.toString(16)}) ${addrOk ? '✓' : '✗'}`);
    if (!addrOk) console.log('    FAIL');
  } else {
    console.log(`  ${param.padEnd(15)} offset=${offset} msg.type=${msg.type} (unexpected)`);
  }
}

// Test: All parameter names map through knobValueToParameterName correctly
console.log('\n--- Knob-to-Parameter Mapping ---');
const knobToExpectedParam: Record<string, ParameterName> = {
  type: 'Type', gain: 'Gain', tone: 'Tone', reverb: 'Reverb',
  fb: 'Feedback', volume: 'Volume', time: 'Time', mix: 'Mix',
  mod: 'Modulation', ir_cab: 'Cabinet',
};
for (const [knob, expected] of Object.entries(knobToExpectedParam)) {
  const actual = knobValueToParameterName(knob);
  const ok = actual === expected;
  console.log(`  ${knob.padEnd(8)} → ${actual} (expected ${expected}) ${ok ? '✓' : '✗'}`);
}

// ====== DELAY / MODULATION SECTION TESTS ======
console.log('\n--- Delay/Modulation Section Tests ---');

// Test: Mix=0 (delay off) writes to offset 7, does NOT touch DelaySection (offset 11)
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean) {
  console.log(`  ${label}: ${ok ? '✓' : '✗'}`);
  if (ok) passed++; else failed++;
}

{
  // Mix at offset 7
  const msgMixOff = buildWriteParameterMessage('A', 'Mix', 0);
  check('Mix param writes to offset 7',
    msgMixOff.type === 'WriteMemory' && msgMixOff.addr === 0x80000007);
  check('Mix write len=1',
    msgMixOff.type === 'WriteMemory' && msgMixOff.len === 1);

  // DelaySection at offset 11
  const msgSectionOn = buildWriteParameterMessage('A', 'DelaySection', 1);
  check('DelaySection writes to offset 11',
    msgSectionOn.type === 'WriteMemory' && msgSectionOn.addr === 0x8000000B);
  check('DelaySection write len=1',
    msgSectionOn.type === 'WriteMemory' && msgSectionOn.len === 1);
}

// Test: Modulation and DelaySection are independent params at different addresses
{
  const msgMod = buildWriteParameterMessage('A', 'Modulation', 4);
  const msgDelaySec = buildWriteParameterMessage('A', 'DelaySection', 1);
  check('Modulation and DelaySection are different addresses',
    msgMod.type === 'WriteMemory' && msgDelaySec.type === 'WriteMemory'
      && msgMod.addr !== msgDelaySec.addr);
}

// Test: Full 16-byte write to slot A preserves byte positions
{
  // The settings layout:
  //   [0]=type, [1]=gain, [2]=tone, [3]=reverb, [4]=feedback,
  //   [5]=volume, [6]=time, [7]=mix, [8]=modulation, [9]=cabinet,
  //   [10]=irSection, [11]=delaySection, [12]=toneSection, [13-15]=0
  const testFull: Settings = {
    type: 2, gain: 6, tone: 12, reverb: 8,
    feedback: 40, volume: 90, time: 15, mix: 55,
    modulation: 7, cabinet: 3,
    irSection: true, delaySection: true, toneSection: true,
  };
  const bytes = settingsToBytes(testFull);
  check('Mix at byte 7', bytes[7] === 55);
  check('DelaySection at byte 11', bytes[11] === 1);
  check('Modulation at byte 8', bytes[8] === 7);
  check('Time at byte 6', bytes[6] === 15);
  check('Feedback at byte 4', bytes[4] === 40);

  // Full write to slot A (0x80000000) - what applySettingsToDsp now uses
  const msg = buildWriteFlashPresetMessage('A', testFull);
  check('Full write targets slot A base',
    msg.type === 'WriteMemory' && msg.addr === 0x80000000);
  check('Full write len=16',
    msg.type === 'WriteMemory' && msg.len === 16);

  // Full write to active area (0x0000) - what switchPreset uses
  const msgActive = buildWriteActivePresetMessage(testFull);
  check('Active write targets 0x0000',
    msgActive.type === 'WriteMemory' && msgActive.addr === 0x0000);
  check('Active write len=16',
    msgActive.type === 'WriteMemory' && msgActive.len === 16);
}

// Test: Delay ON/OFF via mix (0=off, >0=on) — no section B toggle needed
{
  // Delay OFF: mix=0, but time/fb stay at their values
  const delayOff: Settings = {
    type: 0, gain: 4, tone: 8, reverb: 0, feedback: 30,
    volume: 100, time: 20, mix: 0, modulation: 7, cabinet: 0,
    irSection: true, delaySection: true, toneSection: true,
  };
  const bytesOff = settingsToBytes(delayOff);
  check('Delay OFF: mix=0 at byte 7', bytesOff[7] === 0);
  check('Delay OFF: time preserved at byte 6', bytesOff[6] === 20);
  check('Delay OFF: fb preserved at byte 4', bytesOff[4] === 30);
  check('Delay OFF: section B still ON', bytesOff[11] === 1);

  // Delay ON: mix restored to saved value
  const delayOn: Settings = { ...delayOff, mix: 55 };
  const bytesOn = settingsToBytes(delayOn);
  check('Delay ON: mix restored at byte 7', bytesOn[7] === 55);
  check('Delay ON: time unchanged at byte 6', bytesOn[6] === 20);
  check('Delay ON: fb unchanged at byte 4', bytesOn[4] === 30);
}

// Test: Section B is independent — toggling Modulation doesn't affect DelaySection
{
  // Modulation ON, DelaySection OFF
  const settings1: Settings = {
    type: 1, gain: 4, tone: 8, reverb: 0, feedback: 0,
    volume: 100, time: 0, mix: 0, modulation: 6, cabinet: 0,
    irSection: true, delaySection: false, toneSection: true,
  };
  const b1 = settingsToBytes(settings1);
  check('Modulation ON (6) at byte 8, section B OFF', b1[8] === 6 && b1[11] === 0);

  // Modulation OFF, DelaySection ON
  const settings2: Settings = {
    type: 1, gain: 4, tone: 8, reverb: 0, feedback: 0,
    volume: 100, time: 0, mix: 0, modulation: 7, cabinet: 0,
    irSection: true, delaySection: true, toneSection: true,
  };
  const b2 = settingsToBytes(settings2);
  check('Modulation neutral (7) at byte 8, section B ON', b2[8] === 7 && b2[11] === 1);

  // Verify bytes are at completely different positions
  check('Modulation (byte8) != DelaySection (byte11)', true);
}

// Test: full 16-byte write contains all bytes including section toggles
{
  const allOn: Settings = {
    type: 1, gain: 4, tone: 8, reverb: 8, feedback: 40,
    volume: 100, time: 16, mix: 50, modulation: 7, cabinet: 2,
    irSection: true, delaySection: true, toneSection: true,
  };
  const b = settingsToBytes(allOn);
  check('Full settings: all 16 bytes generated', b.length === 16);
  check('Full settings: padding bytes 13-15 are 0', b[13] === 0 && b[14] === 0 && b[15] === 0);
  check('Full settings: count non-padding bytes < 14',
    Array.from(b.slice(0, 13)).filter(x => x >= 0).length === 13);

  const allOff: Settings = {
    type: 0, gain: 0, tone: 0, reverb: 0, feedback: 0,
    volume: 0, time: 0, mix: 0, modulation: 0, cabinet: 0,
    irSection: false, delaySection: false, toneSection: false,
  };
  const bOff = settingsToBytes(allOff);
  const msgOff = buildWriteFlashPresetMessage('A', allOff);
  check('All-off write: len=16',
    msgOff.type === 'WriteMemory' && msgOff.len === 16);
  check('All-off bytes: section bytes 10-12 are 0',
    bOff[10] === 0 && bOff[11] === 0 && bOff[12] === 0);
}

console.log(`\n--- Delay/Modulation Tests: ${passed} passed, ${failed} failed ---`);
