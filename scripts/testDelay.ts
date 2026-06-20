import midi from 'midi';
import { messageToSysex, messageFromSysex } from '../src/protocol/parser';
import {
  buildWriteParameterMessage,
  buildWriteFlashPresetMessage,
  buildInitMessage,
  buildReadPresetMessage,
} from '../src/protocol/index';
import type { Settings, Message } from '../src/protocol/types';

function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForKey(): Promise<void> {
  process.stdin.setRawMode && process.stdin.setRawMode(true);
  return new Promise(resolve => {
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode && process.stdin.setRawMode(false);
      resolve();
    });
  });
}

async function main() {
  const input = new midi.Input();
  const output = new midi.Output();

  // Find non-Microsoft MIDI ports
  let inPort = -1, outPort = -1;
  for (let i = 0; i < input.getPortCount(); i++) {
    if (!input.getPortName(i).includes('Microsoft')) inPort = i;
  }
  for (let i = 0; i < output.getPortCount(); i++) {
    if (!output.getPortName(i).includes('Microsoft')) outPort = i;
  }

  if (inPort === -1 || outPort === -1) {
    console.log('Device not found');
    process.exit(1);
  }

  input.openPort(inPort);
  output.openPort(outPort);
  input.ignoreTypes(false, false, false);

  let resolveResponse: ((msg: Message) => void) | null = null;
  input.on('message', (_dt: number, raw: number[]) => {
    try {
      const msg = messageFromSysex(new Uint8Array(raw));
      if (resolveResponse) {
        resolveResponse(msg);
        resolveResponse = null;
      }
    } catch {}
  });

  async function send(msg: Message): Promise<Message> {
    const sysex = messageToSysex(msg);
    output.sendMessage(Array.from(sysex));
    return new Promise((resolve, reject) => {
      resolveResponse = resolve;
      setTimeout(() => { resolveResponse = null; reject(new Error('timeout')); }, 5000);
    });
  }

  async function phase(label: string, action: () => Promise<void>): Promise<void> {
    console.log(`\n=== ${label} ===`);
    await action();
    console.log('Press any key when done listening...');
    await waitForKey();
  }

  // Init
  await send(buildInitMessage());
  await sleep(300);

  // Read current preset
  const readResp = await send(buildReadPresetMessage('A'));

  // =========== MANUAL PHASE-BY-PHASE TEST ===========
  // Phase 1: Set section B ON, modulation=7 (neutral), delay params set
  await phase('PHASE 1: Set baseline — section B ON, mod=7, delay ON', async () => {
    const baseline: Settings = {
      type: 0, gain: 4, tone: 8, reverb: 0, feedback: 30,
      volume: 100, time: 20, mix: 60, modulation: 7, cabinet: 0,
      irSection: true, delaySection: true, toneSection: true,
    };
    await send(buildWriteFlashPresetMessage('A', baseline));
    console.log('  Sent full write: time=20 fb=30 mix=60 mod=7 delaySection=1');
    console.log('  => You should hear: DELAY repeats, NO chorus/phaser');
  });

  // Phase 2: Enable chorus (modulation=4) while keeping delay
  await phase('PHASE 2: Enable chorus (mod=4)', async () => {
    await send(buildWriteParameterMessage('A', 'Modulation', 4));
    console.log('  Sent modulation=4 (chorus ON)');
    console.log('  => You should hear: CHORUS + DELAY together');
  });

  // Phase 3: Turn chorus OFF (mod=7) — delay should still be audible
  await phase('PHASE 3: Disable chorus (mod=7)', async () => {
    await send(buildWriteParameterMessage('A', 'Modulation', 7));
    console.log('  Sent modulation=7 (neutral)');
    console.log('  => DOES THE DELAY CONTINUE? YES / NO');
  });

  // Phase 4: Mute delay (mix=0) — no effect left in section B
  await phase('PHASE 4: Mute delay (mix=0)', async () => {
    await send(buildWriteParameterMessage('A', 'Mix', 0));
    console.log('  Sent mix=0');
    console.log('  => Delay should STOP');
  });

  // Phase 5: Restore delay (mix=60)
  await phase('PHASE 5: Restore delay (mix=60)', async () => {
    await send(buildWriteParameterMessage('A', 'Mix', 60));
    console.log('  Sent mix=60');
    console.log('  => Delay should RETURN');
  });

  // Phase 6: Toggle section B OFF
  await phase('PHASE 6: Section B OFF (DelaySection=0)', async () => {
    await send(buildWriteParameterMessage('A', 'DelaySection', 0));
    console.log('  Sent DelaySection=0');
    console.log('  => Everything in section B should STOP (no delay, no chorus)');
  });

  // Phase 7: Toggle section B ON
  await phase('PHASE 7: Section B ON (DelaySection=1)', async () => {
    await send(buildWriteParameterMessage('A', 'DelaySection', 1));
    console.log('  Sent DelaySection=1');
    console.log('  => With mod=7 and mix=60, delay should RETURN');
  });

  console.log('\n=== DONE ===');
  console.log('Answer format:');
  console.log('  Phase 3: Did delay continue?');
  console.log('  Phase 6: Did everything stop?');
  console.log('  Phase 7: Did delay come back?');

  // Cleanup
  input.closePort();
  output.closePort();
}

main().catch(console.error);
