export interface MidiService {
  connect(): Promise<void>;
  disconnect(): void;
  send(data: number[]): void;
  setMessageHandler(handler: ((data: Uint8Array) => void) | null): void;
  isNative(): boolean;
}
