import type { MidiService } from './midiService';

const CUBE_BABY_NAME_PREFIX = 'CUBE_BABY';

function isWebMidiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
}

export class WebMidiService implements MidiService {
  private midiInput: MIDIInput | null = null;
  private midiOutput: MIDIOutput | null = null;
  private messageHandler: ((data: Uint8Array) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private midiAccess: MIDIAccess | null = null;

  async connect(deviceId?: string): Promise<void> {
    if (!isWebMidiAvailable()) {
      throw new Error('Web MIDI API is not available on this device. Please use a browser that supports Web MIDI.');
    }
    this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
    const inputs = [...this.midiAccess.inputs.values()];
    const outputs = [...this.midiAccess.outputs.values()];

    let input: MIDIInput | undefined;
    let output: MIDIOutput | undefined;

    if (deviceId) {
      input = inputs.find(p => p.id === deviceId);
      output = outputs.find(p => p.id === deviceId);
      if (!input) input = inputs.find(p => p.id === deviceId);
      if (!output) output = outputs.find(p => p.id === deviceId);
    }

    if (!input) {
      const matchByName = (name: string | undefined | null) =>
        (name ?? '').toUpperCase().includes(CUBE_BABY_NAME_PREFIX) ||
        (name ?? '').toUpperCase().includes('USB') ||
        (name ?? '').toUpperCase().includes('MIDI');
      input = inputs.find(p => matchByName(p.name));
    }
    if (!input) input = inputs[0];
    if (!input) throw new Error('No MIDI input devices found. Make sure your Cube Baby is connected.');

    if (!output) {
      const matchByName = (name: string | undefined | null) =>
        (name ?? '').toUpperCase().includes(CUBE_BABY_NAME_PREFIX) ||
        (name ?? '').toUpperCase().includes('USB') ||
        (name ?? '').toUpperCase().includes('MIDI');
      output = outputs.find(p => matchByName(p.name));
    }
    if (!output) output = outputs[0];
    if (!output) throw new Error('No MIDI output devices found. Make sure your Cube Baby is connected.');

    this.midiInput = input;
    this.midiOutput = output;

    input.onmidimessage = (event: MIDIMessageEvent) => {
      if (event.data && this.messageHandler) {
        this.messageHandler(new Uint8Array(event.data));
      }
    };

    // Listen for device disconnection
    this.midiAccess.onstatechange = (event: Event) => {
      const e = event as MIDIConnectionEvent;
      if (e.port && e.port.state === 'disconnected') {
        if (e.port === this.midiInput || e.port === this.midiOutput) {
          this.disconnectHandler?.();
        }
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

  setDisconnectHandler(handler: (() => void) | null): void {
    this.disconnectHandler = handler;
  }

  isNative(): boolean {
    return false;
  }
}