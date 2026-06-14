import { encode, decode } from './encode';
import type { Message } from './types';

export const HEADER = new Uint8Array([0x00, 0x59]);

export class DeserializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeserializeError';
  }
}

function parseLeU32(bytes: Uint8Array): number {
  let val = 0;
  for (let i = 0; i < 4; i++) {
    val |= (bytes[i] ?? 0) << (i * 8);
  }
  return val >>> 0;
}

export function calcChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xff;
  }
  return (~sum) & 0xff;
}

export function demangleEnvelope(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new DeserializeError('Input too short');
  if (data[0] !== 0xf0 || data[data.length - 1] !== 0xf7) {
    throw new DeserializeError('Invalid SysEx markers');
  }
  const inner = data.slice(1, -1);
  return decode(inner);
}

export function parseEnvelope(data: Uint8Array): Uint8Array {
  const header = data.slice(0, 2);
  if (header[0] !== HEADER[0] || header[1] !== HEADER[1]) {
    throw new DeserializeError('Invalid header');
  }
  const rest = data.slice(2);
  const checksum = rest[rest.length - 1];
  const body = rest.slice(0, -1);

  const bodyForChecksum = data.slice(6, -1);
  if (checksum !== calcChecksum(bodyForChecksum)) {
    throw new DeserializeError('Invalid checksum');
  }
  return body;
}

export function parseContent(data: Uint8Array): Message {
  if (data.length < 4) throw new DeserializeError('Content too short');

  const msgType = data[0];
  const lenBytes = data.slice(1, 4);
  const contentLen = parseLeU32(new Uint8Array([lenBytes[0], lenBytes[1], lenBytes[2], 0]));
  const content = data.slice(4);

  if (content.length !== contentLen) {
    throw new DeserializeError(`Content length mismatch: expected ${contentLen}, got ${content.length}`);
  }

  switch (msgType) {
    case 0x00: {
      if (content.length === 0) return { type: 'Init' };
      return { type: 'ACK', value: content[0] > 0 };
    }
    case 0x11: {
      if (content.length === 0) return { type: 'RequestNameVersion' };
      const nameBytes = content.slice(0, 16);
      const name = new TextDecoder().decode(nameBytes).replace(/\0+$/, '');
      return { type: 'NameVersion', name, mystery: content.slice(16) };
    }
    case 0x21: {
      const cmd = content[0];
      const addr = parseLeU32(content.slice(1, 5));
      return { type: 'Erase', cmd, addr };
    }
    case 0x22: {
      const cmd = content[0];
      const addr = parseLeU32(content.slice(1, 5));
      const msgLen = parseLeU32(new Uint8Array([content[5], content[6], content[7], 0]));
      const msgData = content.slice(8, 8 + msgLen);
      return { type: 'WriteMemory', cmd, addr, len: msgLen, data: msgData };
    }
    case 0x23: {
      const cmd = content[0];
      const addr = parseLeU32(content.slice(1, 5));
      const msgLen = parseLeU32(new Uint8Array([content[5], content[6], content[7], 0]));
      const msgData = content.slice(8, 8 + msgLen);
      if (msgData.length === 0 && msgLen > 0) {
        return { type: 'ReadMemory', cmd, addr, len: msgLen };
      }
      return { type: 'MemoryContent', cmd, addr, len: msgLen, data: msgData };
    }
    case 0x24: {
      if (content.length === 9) {
        if (content[1] === 0x64) return { type: 'Mystery1' };
        if (content[1] === 0x68) return { type: 'Mystery2' };
        return { type: 'MysteryWrite', reg: content[1], data: content };
      }
      throw new DeserializeError('Unknown message type 0x24 with unexpected length');
    }
    default:
      throw new DeserializeError(`Unknown message type: 0x${msgType.toString(16)}`);
  }
}

export function serializeMessage(msg: Message): { msgType: number; content: Uint8Array } {
  switch (msg.type) {
    case 'Init':
      return { msgType: 0x00, content: new Uint8Array([]) };
    case 'ACK':
      return { msgType: 0x00, content: new Uint8Array([msg.value ? 1 : 0]) };
    case 'WriteMemory': {
      const addrBytes = new Uint8Array(4);
      new DataView(addrBytes.buffer).setUint32(0, msg.addr, true);
      const lenBytes = new Uint8Array([msg.len & 0xff, (msg.len >> 8) & 0xff, (msg.len >> 16) & 0xff]);
      const content = new Uint8Array([msg.cmd, ...addrBytes, ...lenBytes, ...msg.data]);
      return { msgType: 0x22, content };
    }
    case 'ReadMemory': {
      const addrBytes = new Uint8Array(4);
      new DataView(addrBytes.buffer).setUint32(0, msg.addr, true);
      const lenBytes = new Uint8Array([msg.len & 0xff, (msg.len >> 8) & 0xff, (msg.len >> 16) & 0xff]);
      const content = new Uint8Array([msg.cmd, ...addrBytes, ...lenBytes]);
      return { msgType: 0x23, content };
    }
    case 'MemoryContent': {
      const addrBytes = new Uint8Array(4);
      new DataView(addrBytes.buffer).setUint32(0, msg.addr, true);
      const lenBytes = new Uint8Array([msg.len & 0xff, (msg.len >> 8) & 0xff, (msg.len >> 16) & 0xff]);
      const content = new Uint8Array([msg.cmd, ...addrBytes, ...lenBytes, ...msg.data]);
      return { msgType: 0x23, content };
    }
    case 'RequestNameVersion':
      return { msgType: 0x11, content: new Uint8Array([]) };
    case 'NameVersion': {
      const encoder = new TextEncoder();
      const nameBytes = encoder.encode(msg.name.padEnd(16, '\0').slice(0, 16));
      const content = new Uint8Array([...nameBytes, ...msg.mystery]);
      return { msgType: 0x11, content };
    }
    case 'Erase': {
      const addrBytes = new Uint8Array(4);
      new DataView(addrBytes.buffer).setUint32(0, msg.addr, true);
      return { msgType: 0x21, content: new Uint8Array([msg.cmd, ...addrBytes]) };
    }
    case 'Mystery1':
      return { msgType: 0x24, content: new Uint8Array([0x4, 0x64, 0x7, 0, 0, 0x1, 0, 0, 0]) };
    case 'Mystery2':
      return { msgType: 0x24, content: new Uint8Array([0x4, 0x68, 0x7, 0, 0, 0x4, 0x8, 0, 0]) };
    case 'MysteryWrite': {
      const content = new Uint8Array([0x04, msg.reg, 0x07, 0x00, 0x00, ...msg.data]);
      if (content.length !== 9) throw new Error('MysteryWrite content must be 9 bytes');
      return { msgType: 0x24, content };
    }
  }
}

export function messageToSysex(msg: Message): Uint8Array {
  const { msgType, content } = serializeMessage(msg);

  const lenBytes = new Uint8Array([
    content.length & 0xff,
    (content.length >> 8) & 0xff,
    (content.length >> 16) & 0xff,
  ]);

  const cleartext = new Uint8Array([...HEADER, msgType, ...lenBytes, ...content]);
  const checksum = calcChecksum(cleartext.slice(6));
  const fullCleartext = new Uint8Array([...cleartext, checksum]);
  const encoded = encode(fullCleartext);

  return new Uint8Array([0xf0, ...encoded, 0xf7]);
}

export function messageFromSysex(data: Uint8Array): Message {
  const demangled = demangleEnvelope(data);
  const body = parseEnvelope(demangled);
  return parseContent(body);
}
