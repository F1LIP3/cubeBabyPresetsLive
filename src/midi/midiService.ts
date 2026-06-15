export interface MidiDeviceInfo {
  id: string;
  name: string;
}

export interface MidiService {
  connect(deviceId?: string): Promise<void>;
  disconnect(): void;
  send(data: number[]): void;
  setMessageHandler(handler: ((data: Uint8Array) => void) | null): void;
  setDisconnectHandler(handler: (() => void) | null): void;
  isNative(): boolean;
}

export async function listMidiDevices(): Promise<MidiDeviceInfo[]> {
  if (typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function') {
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      const devices: MidiDeviceInfo[] = [];
      for (const [id, input] of access.inputs) {
        devices.push({ id, name: input.name || `MIDI Device ${id}` });
      }
      return devices;
    } catch {
      return [];
    }
  }
  return [];
}
