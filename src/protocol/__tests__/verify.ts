import { encode, decode } from '../encode';
import { messageToSysex, messageFromSysex } from '../parser';
import type { Message, Settings, ParameterName } from '../types';
import { PARAMETER_ADDRESS_OFFSET, PARAMETER_NAMES } from '../types';
import {
  settingsToBytes, bytesToSettings,
  settingsToKnobValues, knobValuesToSettings,
  knobValueToParameterName,
  buildWriteParameterMessage, buildReadPresetMessage,
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
