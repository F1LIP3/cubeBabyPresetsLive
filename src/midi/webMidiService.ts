import type { MidiService } from './midiService';

const CUBE_BABY_NAME_PREFIX = 'CUBE_BABY';

function isWebMidiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
}

export class WebMidiService implements MidiService {
  private midiInput: MIDIInput | null = null;
  private midiOutput: MIDIOutput | null = null;
  private messageHandler: ((data: Uint8Array) => void) | null = null;

  async connect(): Promise<void> {
    if (!isWebMidiAvailable()) {
      throw new Error('Web MIDI API is not available on this device. Please use a browser that supports Web MIDI.');
    }
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const inputs = [...access.inputs.values()];
    const outputs = [...access.outputs.values()];

    const matchByName = (name: string | undefined | null) =>
      (name ?? '').toUpperCase().includes(CUBE_BABY_NAME_PREFIX) ||
      (name ?? '').toUpperCase().includes('USB') ||
      (name ?? '').toUpperCase().includes('MIDI');

    let input = inputs.find(p => matchByName(p.name));
    if (!input) input = inputs[0];
    if (!input) throw new Error('No MIDI input devices found. Make sure your Cube Baby is connected.');

    let output = outputs.find(p => matchByName(p.name));
    if (!output) output = outputs[0];
    if (!output) throw new Error('No MIDI output devices found. Make sure your Cube Baby is connected.');

    this.midiInput = input;
    this.midiOutput = output;

    input.onmidimessage = (event: MIDIMessageEvent) => {
      if (event.data && this.messageHandler) {
        this.messageHandler(new Uint8Array(event.data));
      }
    };
  }

  disconnect(): void {
    if (this.midiInput) {
      this.midiInput.onmidimessage = null;
    }
    this.midiInput = null;
    this.midiOutput = null;
  }

  send(data: number[]): void {
    if (!this.midiOutput) throw new Error('Not connected');
    this.midiOutput.send(data);
  }

  setMessageHandler(handler: ((data: Uint8Array) => void) | null): void {
    this.messageHandler = handler;
    if (this.midiInput) {
      this.midiInput.onmidimessage = handler
        ? (event: MIDIMessageEvent) => {
            if (event.data) handler(new Uint8Array(event.data));
          }
        : null;
    }
  }

  isNative(): boolean {
    return false;
  }
}