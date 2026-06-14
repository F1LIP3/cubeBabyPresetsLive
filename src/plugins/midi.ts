import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

export interface MidiDeviceInfo {
  id: number;
  name: string;
  inputPorts: number;
  outputPorts: number;
}

export interface MidiPlugin {
  listDevices(): Promise<{ devices: MidiDeviceInfo[] }>;
  connect(options: { deviceId: number }): Promise<void>;
  disconnect(): Promise<void>;
  send(options: { data: number[] }): Promise<void>;
  requestPermission(): Promise<{ granted: boolean }>;

  addListener(
    eventName: 'midiMessage',
    handler: (data: { data: number[] }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'midiConnected',
    handler: (data: { name: string; id: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'midiError',
    handler: (data: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Midi = registerPlugin<MidiPlugin>('Midi');

export default Midi;
