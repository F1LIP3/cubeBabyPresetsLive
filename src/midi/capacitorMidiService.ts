import type { MidiService } from './midiService';
import Midi from '../plugins/midi';

export class CapacitorMidiService implements MidiService {
  private output: MidiService | null = null;
  private messageHandler: ((data: Uint8Array) => void) | null = null;
  private connectedDeviceId: number | null = null;
  private listener: any = null;

  async connect(deviceId?: string): Promise<void> {
    const perm = await Midi.requestPermission();
    if (!perm.granted) throw new Error('MIDI permission denied');

    const result = await Midi.listDevices();
    const devices = result.devices;
    if (devices.length === 0) throw new Error('No MIDI devices found');

    const device = deviceId
      ? devices.find((d: any) => String(d.id) === deviceId) || devices[0]
      : devices[0];
    this.connectedDeviceId = device.id;

    this.listener = await Midi.addListener('midiMessage', (data: { data: number[] }) => {
      if (this.messageHandler) {
        this.messageHandler(new Uint8Array(data.data));
      }
    });

    await Midi.connect({ deviceId: device.id });
  }

  disconnect(): void {
    Midi.disconnect();
    if (this.listener) {
      this.listener.remove();
      this.listener = null;
    }
    this.connectedDeviceId = null;
  }

  send(data: number[]): void {
    Midi.send({ data });
  }

  setMessageHandler(handler: ((data: Uint8Array) => void) | null): void {
    this.messageHandler = handler;
  }

  setDisconnectHandler(_handler: (() => void) | null): void {
    // Capacitor MIDI doesn't provide disconnect detection
  }

  isNative(): boolean {
    return true;
  }
}
