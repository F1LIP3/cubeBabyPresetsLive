import { useState, useCallback, useRef } from 'react';
import type { KnobValues } from '../../protocol';
import type { CubeBabyMidi } from '../../midi/cubeBabyMidi';
import { processWavFile, irToBytes, padIrToRomBytes, float32ToWav } from '../irProcessor';
import { IR_SLOT_COUNT, IR_ROM_SLOT_SIZE } from '../../protocol/types';

export interface IRActions {
  irFile: File | null;
  irSlot: number;
  irName: string;
  irStatus: 'idle' | 'processing' | 'erasing' | 'writing' | 'verifying' | 'done' | 'error';
  irProgress: { current: number; total: number };
  irNames: Record<number, string>;
  irPreprocessed: Float32Array | null;
  irDistance: number;
  activeCustomSlot: number | null;
  irLabOpen: boolean;
  setIrSlot: React.Dispatch<React.SetStateAction<number>>;
  setIrName: React.Dispatch<React.SetStateAction<string>>;
  setIrDistance: React.Dispatch<React.SetStateAction<number>>;
  setIrLabOpen: (v: boolean) => void;
  handleIRFileSelected: (file: File) => Promise<void>;
  handleIRSelectFile: () => void;
  handleIRUpload: () => Promise<void>;
  handleIRDownloadBackup: () => Promise<void>;
  handleIRLoadSlot: (slot: number) => Promise<void>;
  handleIRScan: () => Promise<void>;
  handleIRDeleteName: (slot: number) => void;
}

export function useIR(
  midiRef: React.MutableRefObject<CubeBabyMidi | null>,
  setStatusMsg: (msg: string, type?: 'info' | 'success' | 'error') => void,
  log: (msg: string) => void,
  setKnobValues: React.Dispatch<React.SetStateAction<KnobValues>>,
): IRActions {
  const [irFile, setIrFile] = useState<File | null>(null);
  const [irSlot, setIrSlot] = useState(0);
  const [irName, setIrName] = useState('');
  const [irStatus, setIrStatus] = useState<'idle' | 'processing' | 'erasing' | 'writing' | 'verifying' | 'done' | 'error'>('idle');
  const [irProgress, setIrProgress] = useState({ current: 0, total: 100 });
  const [irNames, setIrNames] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('irNames') || '{}'); } catch { return {}; }
  });
  const [irPreprocessed, setIrPreprocessed] = useState<Float32Array | null>(null);
  const [irDistance, setIrDistance] = useState(0.7);
  const [activeCustomSlot, setActiveCustomSlot] = useState<number | null>(null);
  const [irLabOpen, setIrLabOpen] = useState(() => localStorage.getItem('irLabOpen') !== 'closed');

  const saveIrData = useCallback((slot: number, f32: Float32Array) => {
    const bytes = new Uint8Array(f32.buffer);
    localStorage.setItem(`irData_${slot}`, btoa(String.fromCharCode(...bytes)));
  }, []);

  const loadIrData = useCallback((slot: number): Float32Array | null => {
    const b64 = localStorage.getItem(`irData_${slot}`);
    if (!b64) return null;
    try {
      return new Float32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer);
    } catch { return null; }
  }, []);

  const saveIrNames = useCallback((names: Record<number, string>) => {
    setIrNames(names);
    localStorage.setItem('irNames', JSON.stringify(names));
  }, []);

  const downloadBlob = useCallback((data: ArrayBuffer, filename: string) => {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleIRFileSelected = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.wav')) { setStatusMsg('Please select a .wav file', 'error'); return; }
    setIrFile(file);
    setIrStatus('processing');
    setIrPreprocessed(null);
    try {
      const ir = await processWavFile(file);
      setIrPreprocessed(ir);
      setIrStatus('idle');
      log(`WAV processed: ${file.name}, ${ir.length} samples`);
      setStatusMsg(`Ready: ${file.name}`, 'success');
    } catch (e: any) {
      setIrStatus('error');
      setStatusMsg(`Failed to process WAV: ${e.message}`, 'error');
    }
  }, [setStatusMsg, log]);

  const handleIRSelectFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav';
    input.onchange = () => { if (input.files?.[0]) handleIRFileSelected(input.files[0]); };
    input.click();
  }, [handleIRFileSelected]);

  const handleIRUpload = useCallback(async () => {
    if (!midiRef.current || !irPreprocessed) return;
    const slot = irSlot;
    const name = irName.trim() || `Custom IR ${slot + 1}`;
    const romBytes = padIrToRomBytes(irPreprocessed);
    const totalChunks = Math.ceil(romBytes.length / 128);
    setIrProgress({ current: 0, total: 100 });
    try {
      saveIrData(slot, irPreprocessed);
      setIrStatus('erasing');
      await midiRef.current.eraseIRRomSector(slot);
      await new Promise(r => setTimeout(r, 500));
      setIrProgress({ current: 10, total: 100 });
      setIrStatus('writing');
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * 128;
        const chunk = romBytes.slice(offset, Math.min(offset + 128, romBytes.length));
        setIrProgress({ current: 10 + Math.round((i + 1) / totalChunks * 80), total: 100 });
        await midiRef.current.sendAndWait({
          type: 'WriteMemory', cmd: 0,
          addr: 0x00069000 + slot * IR_ROM_SLOT_SIZE + offset,
          len: chunk.length, data: chunk,
        });
        await new Promise(r => setTimeout(r, 100));
      }
      setIrStatus('verifying');
      setIrProgress({ current: 100, total: 100 });
      saveIrNames({ ...irNames, [slot]: name });
      setIrStatus('done');
      setStatusMsg(`IR "${name}" saved to ROM slot ${slot}`, 'success');
    } catch (e: any) {
      setIrStatus('error');
      setStatusMsg(`Upload failed: ${e.message}`, 'error');
    }
  }, [midiRef, irPreprocessed, irSlot, irName, irNames, saveIrNames, saveIrData, setStatusMsg]);

  const handleIRDownloadBackup = useCallback(async () => {
    if (!midiRef.current) return;
    try {
      let f32 = loadIrData(irSlot);
      if (!f32) {
        const data = await midiRef.current.readIRFromRom(irSlot, IR_ROM_SLOT_SIZE);
        f32 = new Float32Array(data.buffer, 0, 512);
        saveIrData(irSlot, f32);
      }
      downloadBlob(float32ToWav(f32).buffer as ArrayBuffer, `ir_slot${irSlot}_${irNames[irSlot] || 'backup'}.wav`);
      setStatusMsg(`Backup of slot ${irSlot} downloaded`, 'success');
    } catch (e: any) { setStatusMsg(`Backup failed: ${e.message}`, 'error'); }
  }, [midiRef, irSlot, irNames, loadIrData, saveIrData, downloadBlob, setStatusMsg]);

  const handleIRLoadSlot = useCallback(async (slot: number) => {
    if (!midiRef.current) return;
    const name = irNames[slot] || `Slot ${slot + 1}`;
    try {
      let f32 = loadIrData(slot);
      if (!f32) {
        const romData = await midiRef.current.readIRFromRom(slot, IR_ROM_SLOT_SIZE);
        f32 = new Float32Array(romData.buffer, 0, 512);
        saveIrData(slot, f32);
      }
      await midiRef.current.writeIRToRam(irToBytes(f32));
      await midiRef.current.writeParameterLive('Cabinet', 0);
      await midiRef.current.setIRDistance(irDistance);
      setActiveCustomSlot(slot);
      setKnobValues(prev => ({ ...prev, ir_cab: 0 }));
      setStatusMsg(`"${name}" loaded to RAM`, 'success');
    } catch (e: any) { setStatusMsg(`Failed to load slot ${slot}: ${e.message}`, 'error'); }
  }, [midiRef, irNames, irDistance, saveIrData, loadIrData, setStatusMsg, setKnobValues]);

  const handleIRScan = useCallback(async () => {
    if (!midiRef.current) return;
    const baby = midiRef.current;
    log('=== SCAN IR SLOTS ===');
    for (let slot = 0; slot < IR_SLOT_COUNT; slot++) {
      try {
        const data = await baby.readIRFromRom(slot, 64);
        const slotF32 = new Float32Array(data.buffer as ArrayBuffer).slice(0, 4);
        log(`Slot ${slot}: [${Array.from(slotF32).map(v => v.toFixed(4)).join(', ')}]`);
      } catch (e: any) { log(`Slot ${slot}: error ${e.message}`); }
    }
    log('=== SCAN DONE ===');
  }, [midiRef, log]);

  const handleIRDeleteName = useCallback((slot: number) => {
    const u = { ...irNames };
    delete u[slot];
    saveIrNames(u);
  }, [irNames, saveIrNames]);

  const setIrLabOpenWrapped = useCallback((v: boolean) => {
    setIrLabOpen(v);
    localStorage.setItem('irLabOpen', v ? 'open' : 'closed');
  }, []);

  return {
    irFile, irSlot, irName, irStatus, irProgress, irNames, irPreprocessed, irDistance, activeCustomSlot, irLabOpen,
    setIrSlot, setIrName, setIrDistance,
    setIrLabOpen: setIrLabOpenWrapped,
    handleIRFileSelected, handleIRSelectFile, handleIRUpload,
    handleIRDownloadBackup, handleIRLoadSlot, handleIRScan, handleIRDeleteName,
  };
}
