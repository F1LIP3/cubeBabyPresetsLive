import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CubeBabyMidi } from '../midi/cubeBabyMidi';
import type { PresetName } from '../protocol/types';
import { IR_SLOT_COUNT, IR_ROM_SLOT_SIZE } from '../protocol/types';
import { Pedal } from './components/Pedal';
import { WelcomeScreen } from './components/WelcomeScreen';
import { HelpModal } from './components/HelpModal';
import { DebugPanel } from './components/DebugPanel';
import { StatusBar } from './components/StatusBar';
import { AppHeader } from './components/AppHeader';
import { PresetBar } from './components/PresetBar';
import { Toolbar } from './components/Toolbar';
import { IRSection } from './components/IRSection';
import { SkeletonLoader } from './components/SkeletonLoader';
import { settingsToKnobValues, knobValuesToSettings } from '../protocol';
import type { KnobValues } from '../protocol';
import { processWavFile, irToBytes, padIrToRomBytes, irSummary, float32ToWav } from './irProcessor';
import { changeLanguage, getDirection } from '../i18n/i18n';
import { listMidiDevices } from '../midi/midiService';
import type { MidiDeviceInfo } from '../midi/midiService';
import { cubeBabyModel, EMPTY_KNOBS, FACTORY_DEFAULT_KNOBS, MAX_UNDO_DEPTH } from './constants';
import type { PresetFile, BankFile } from './helpers';
import { downloadJson, loadFile } from './helpers';

export default function App() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dir = getDirection(i18n.language);
  }, [i18n.language]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetName>('A');
  const [mode, setMode] = useState<'live' | 'preset'>('preset');
  const [knobValues, setKnobValues] = useState<KnobValues>(EMPTY_KNOBS);
  const [allKnobs, setAllKnobs] = useState<Record<PresetName, KnobValues>>(() => { try { const saved = localStorage.getItem(`allKnobs`); if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.A && parsed.B && parsed.C) return parsed; } } catch (e) { } return { A: EMPTY_KNOBS, B: EMPTY_KNOBS, C: EMPTY_KNOBS }; });
  useEffect(() => { localStorage.setItem(`allKnobs`, JSON.stringify(allKnobs)); }, [allKnobs]);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [showDebug, setShowDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const midiRef = useRef<CubeBabyMidi | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoStack, setUndoStack] = useState<Record<PresetName, KnobValues[]>>({ A: [], B: [], C: [] });
  const [redoStack, setRedoStack] = useState<Record<PresetName, KnobValues[]>>({ A: [], B: [], C: [] });
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
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
  const isDirty = useMemo(() => {
    return JSON.stringify(knobValues) !== JSON.stringify(allKnobs[selectedPreset]);
  }, [knobValues, allKnobs, selectedPreset]);

  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedMidiDeviceId, setSelectedMidiDeviceId] = useState<string>('');

  // Scan MIDI devices on mount
  useEffect(() => {
    listMidiDevices().then(devices => {
      setMidiDevices(devices);
      if (devices.length > 0 && !selectedMidiDeviceId) {
        setSelectedMidiDeviceId(devices[0].id);
      }
    });
  }, []);

  const setStatusMsg = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(msg);
    setStatusType(type);
  }, []);

  const log = useCallback((msg: string) => {
    setDebugLog(prev => [...prev, msg]);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setStatusMsg(t('app.connecting'));
    try {
      const baby = new CubeBabyMidi();
      baby.onUnsolicited = (msg) => {
        log(`Unsolicited: ${JSON.stringify(msg)}`);
      };
      baby.onDisconnect = () => {
        setConnected(false);
        setKnobValues(EMPTY_KNOBS);
        setStatusMsg(t('status.deviceDisconnected'), 'error');
        log('MIDI device disconnected');
      };
      await baby.connect(selectedMidiDeviceId || undefined);
      midiRef.current = baby;
      // Set initial empty values
      setAllKnobs({ A: { ...EMPTY_KNOBS }, B: { ...EMPTY_KNOBS }, C: { ...EMPTY_KNOBS } });
      setKnobValues({ ...EMPTY_KNOBS });
      setConnected(true);

      // Read presets sequentially ? pedal can only handle one SysEx at a time
      const presets: Record<string, any> = {};
      let loadedCount = 0;
      for (const preset of ['A', 'B', 'C'] as const) {
        try {
          const settings = await baby.readPreset(preset);
          presets[preset] = settingsToKnobValues(settings);
          loadedCount++;
          log(`Read preset ${preset} successfully`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log(`Failed to read preset ${preset}: ${message}`);
          presets[preset] = { ...EMPTY_KNOBS };
        }
      }
      
      setAllKnobs({ A: presets['A'], B: presets['B'], C: presets['C'] });
      setKnobValues(presets['A']);
      setStatusMsg(t('status.connected', { loaded: loadedCount, total: 3 }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(t('status.connectionFailed', { message }), 'error');
    } finally {
      setConnecting(false);
    }
  }, [log, setStatusMsg, t]);

  const handleDisconnect = useCallback(() => {
    if (midiRef.current) {
      midiRef.current.disconnect();
      midiRef.current = null;
    }
    setConnected(false);
    setKnobValues(EMPTY_KNOBS);
    setAllKnobs({ A: EMPTY_KNOBS, B: EMPTY_KNOBS, C: EMPTY_KNOBS });
    setStatusMsg(t('status.disconnected'));
  }, [setStatusMsg, t]);

  // Also ensure the disconnect handler gets re-wired when t changes
  useEffect(() => {
    if (midiRef.current) {
      midiRef.current.onDisconnect = () => {
        setConnected(false);
        setKnobValues(EMPTY_KNOBS);
        setStatusMsg(t('status.deviceDisconnected'), 'error');
        log('MIDI device disconnected');
      };
    }
  }, [t, setStatusMsg, log]);

  const handleSelectPreset = useCallback(async (preset: PresetName) => {
    console.log(`[UI] Preset button clicked: ${preset}`, midiRef.current ? "MIDI Connected" : "MIDI NULL");
    setSelectedPreset(preset);
    const cached = allKnobs[preset];
    setKnobValues(cached);
    if (midiRef.current) {
      try {
        const settings = knobValuesToSettings(cached);
        await midiRef.current.switchPreset(preset, settings);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Switch preset ${preset} failed: ${message}`);
      }
    }
    setStatusMsg(t('status.switched', { name: preset }), 'info');
  }, [allKnobs, setStatusMsg, log, t]);

  const handleSave = useCallback(async () => {
    if (!midiRef.current) return;
    setSaving(true);
    setStatusMsg(t('status.loadingPreset', { name: selectedPreset }));
    try {
      const settings = knobValuesToSettings(knobValues);
      await midiRef.current.saveActivePresetToSlot(selectedPreset, settings);
      setAllKnobs(prev => ({ ...prev, [selectedPreset]: knobValues }));
      setStatusMsg(t('status.savedToPedal', { name: selectedPreset }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(t('status.saveFailed', { message }), 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedPreset, knobValues, setStatusMsg]);

  const handleExportPreset = useCallback(() => {
    const file: PresetFile = {
      format: 'cubebabypreset',
      version: 1,
      preset: selectedPreset,
      knobs: knobValues,
      created: new Date().toISOString(),
    };
    downloadJson(file, `cube-baby-${selectedPreset}.cubebabypreset`);
    setStatusMsg(t('status.exportedPreset', { name: selectedPreset }), 'success');
  }, [selectedPreset, knobValues, setStatusMsg, t]);

  const handleExportBank = useCallback(() => {
    const file: BankFile = {
      format: 'cubebabybank',
      version: 1,
      presets: { ...allKnobs, [selectedPreset]: knobValues },
      created: new Date().toISOString(),
    };
    downloadJson(file, 'cube-baby-bank.cubebabybank');
    setStatusMsg(t('status.exportedBank'), 'success');
  }, [allKnobs, selectedPreset, knobValues, setStatusMsg, t]);

  const handleImport = useCallback(async () => {
    if (!midiRef.current) return;
    setImporting(true);
    try {
      const text = await loadFile();
      const data = JSON.parse(text);

      if (data.format === 'cubebabypreset') {
        const file = data as PresetFile;
        const target = file.preset as PresetName;
        setKnobValues(file.knobs);
        setSelectedPreset(target);
        const settings = knobValuesToSettings(file.knobs);
        await midiRef.current.saveActivePresetToSlot(target, settings);
        setAllKnobs(prev => ({ ...prev, [target]: file.knobs }));
        // Apply to DSP
        await midiRef.current.applySettingsToDsp(settings);
        setStatusMsg(t('status.importedPreset', { name: target }), 'success');
      } else if (data.format === 'cubebabybank') {
        const file = data as BankFile;
        for (const [p, knobs] of Object.entries(file.presets)) {
          const preset = p as PresetName;
          const settings = knobValuesToSettings(knobs);
          await midiRef.current.saveActivePresetToSlot(preset, settings);
          setAllKnobs(prev => ({ ...prev, [preset]: knobs }));
        }
        const first = Object.keys(file.presets)[0] as PresetName;
        setKnobValues(file.presets[first]);
        setSelectedPreset(first);
        setStatusMsg(t('status.importedBank'), 'success');
      } else {
        setStatusMsg(t('status.unknownFormat'), 'error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(t('status.importFailed', { message }), 'error');
    } finally {
      setImporting(false);
    }
  }, [setStatusMsg, t]);

  const pushUndo = useCallback((preset: PresetName) => {
    setUndoStack(prev => {
      const stack = prev[preset] || [];
      return { ...prev, [preset]: [...stack.slice(-(MAX_UNDO_DEPTH - 1)), knobValues] };
    });
    setRedoStack(prev => ({ ...prev, [preset]: [] }));
  }, [knobValues]);

  const handleRevert = useCallback(() => {
    const saved = allKnobs[selectedPreset];
    if (saved) {
      pushUndo(selectedPreset);
      setKnobValues(saved);
      setStatusMsg(t('status.reverted', { name: selectedPreset }), 'info');
      if (midiRef.current) {
        const settings = knobValuesToSettings(saved);
        midiRef.current.applySettingsToDsp(settings).catch(() => {});
      }
    }
  }, [selectedPreset, allKnobs, pushUndo, setStatusMsg, t]);

  const handleFactoryReset = useCallback(async () => {
    pushUndo(selectedPreset);
    setKnobValues(FACTORY_DEFAULT_KNOBS);
    setAllKnobs(prev => ({ ...prev, [selectedPreset]: FACTORY_DEFAULT_KNOBS }));
    if (midiRef.current) {
      try {
        const settings = knobValuesToSettings(FACTORY_DEFAULT_KNOBS);
        await midiRef.current.saveActivePresetToSlot(selectedPreset, settings);
        setStatusMsg(t('status.resetToDefaults', { name: selectedPreset }), 'success');
      } catch {
        setStatusMsg(t('status.saveFailed', { message: 'MIDI write failed' }), 'error');
      }
    }
  }, [selectedPreset, pushUndo, setStatusMsg, t]);

  const handleRefreshAll = useCallback(async () => {
    if (!midiRef.current) return;
    setLoading(true);
    try {
      const all = await midiRef.current.readAllPresets();
      const knobsA = settingsToKnobValues(all.A);
      const knobsB = settingsToKnobValues(all.B);
      const knobsC = settingsToKnobValues(all.C);
      setAllKnobs({ A: knobsA, B: knobsB, C: knobsC });
      setKnobValues(selectedPreset === 'A' ? knobsA : selectedPreset === 'B' ? knobsB : knobsC);
      setStatusMsg(t('status.presetsRefreshed'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(t('status.refreshFailed', { message }), 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedPreset, setStatusMsg]);

  const handleKnobChange = useCallback((_name: string, _value: number) => {
    setKnobValues(prev => ({ ...prev, [_name]: _value }));
  }, []);

  const handleIRScan = useCallback(async () => {
    if (!midiRef.current) return;
    const baby = midiRef.current;
    log('=== SCAN IR SLOTS ===');
    for (let slot = 0; slot < IR_SLOT_COUNT; slot++) {
      try {
        const data = await baby.readIRFromRom(slot, 64);
        const f32 = new Float32Array(data.buffer);
        const s8 = f32.slice(0, 8).map(v => v.toFixed(4)).join(', ');
        const ascii = Array.from(data.slice(0, 32)).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        log(`Slot ${slot}: [${s8}] "${ascii}"`);
      } catch (e: any) { log(`Slot ${slot}: error ${e.message}`); }
    }
    // Read 8192 bytes from slot 0 start
    try {
      log('--- Reading 8192 bytes from 0x00069000 ---');
      const big = await baby.readIRFromRom(0, 8192);
      for (let off = 0; off < 8192; off += 256) {
        const chunk = big.slice(off, off + 256);
        const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        if (/[A-Za-z]{3,}/.test(ascii)) log(`  @${off}: "${ascii.trim()}"`);
      }
    } catch (e: any) { log(`8192 read error: ${e.message}`); }
    // Scan for cabinet names
    log('--- Scanning for metadata ---');
    for (const addr of [0x00068000, 0x00068800, 0x00069000, 0x00069800, 0x0006A000, 0x0006A800]) {
      try {
        const r = await baby.sendAndWait({ type: 'ReadMemory', cmd: 0, addr, len: 64 });
        if (r.type === 'MemoryContent') {
          const ascii = Array.from(r.data.slice(0, 32)).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
          const f32 = new Float32Array(r.data.buffer);
          const s8 = f32.slice(0, 4).map(v => v.toFixed(4)).join(', ');
          log(`  @0x${addr.toString(16)}: [${s8}] "${ascii}"`);
        }
      } catch {}
    }
    log('=== SCAN DONE ===');
  }, [midiRef, log]);

  const saveIrData = useCallback((slot: number, f32: Float32Array) => {
    const bytes = new Uint8Array(f32.buffer);
    localStorage.setItem(`irData_${slot}`, btoa(String.fromCharCode(...bytes)));
  }, []);

  const loadIrData = useCallback((slot: number): Float32Array | null => {
    const b64 = localStorage.getItem(`irData_${slot}`);
    if (!b64) return null;
    try {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Float32Array(bytes.buffer);
    } catch { return null; }
  }, []);

  const handleKnobChangeEnd = useCallback((name: string, value: number) => {
    if (!midiRef.current) return;
    pushUndo(selectedPreset);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!midiRef.current) return;
      try {
        await midiRef.current.writeSingleKnob(name, value);
      } catch {
        // Write may fail if pedal isn't in the right mode
      }
    }, 50);
  }, [selectedPreset, pushUndo]);

  const handleUndo = useCallback(() => {
    const stack = undoStack[selectedPreset] || [];
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setUndoStack(prevStack => {
      const s = prevStack[selectedPreset] || [];
      return { ...prevStack, [selectedPreset]: s.slice(0, -1) };
    });
    setRedoStack(prevStack => ({
      ...prevStack,
      [selectedPreset]: [...(prevStack[selectedPreset] || []), knobValues],
    }));
    setKnobValues(prev);
    if (midiRef.current) {
      const paramNames = Object.keys(prev).filter(k => k !== 'irSection' && k !== 'delaySection' && k !== 'toneSection');
      for (const param of paramNames) {
        const val = prev[param as keyof KnobValues] as number;
        midiRef.current.writeSingleKnob(param, val).catch(() => {});
      }
    }
  }, [selectedPreset, undoStack, knobValues]);

  const handleRedo = useCallback(() => {
    const stack = redoStack[selectedPreset] || [];
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack(prevStack => {
      const s = prevStack[selectedPreset] || [];
      return { ...prevStack, [selectedPreset]: s.slice(0, -1) };
    });
    setUndoStack(prevStack => ({
      ...prevStack,
      [selectedPreset]: [...(prevStack[selectedPreset] || []), knobValues],
    }));
    setKnobValues(next);
    if (midiRef.current) {
      const paramNames = Object.keys(next).filter(k => k !== 'irSection' && k !== 'delaySection' && k !== 'toneSection');
      for (const param of paramNames) {
        const val = next[param as keyof KnobValues] as number;
        midiRef.current.writeSingleKnob(param, val).catch(() => {});
      }
    }
  }, [selectedPreset, redoStack, knobValues]);

  const handleFootswitch = useCallback(async (section: 'A' | 'B' | 'C') => {
    if (!midiRef.current) return;
    try {
      if (mode === 'preset') {
        await handleSelectPreset(section);
      } else {
        const field = section === 'A' ? 'irSection' : section === 'B' ? 'delaySection' : 'toneSection';
        const newVal = !knobValues[field];
        setKnobValues(prev => ({ ...prev, [field]: newVal }));
        await midiRef.current.toggleSection(section, newVal);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Footswitch ${section} failed: ${message}`);
    }
  }, [mode, knobValues, handleSelectPreset, log]);

  const downloadBlob = useCallback((data: ArrayBuffer, filename: string) => {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const saveIrNames = useCallback((names: Record<number, string>) => {
    setIrNames(names);
    localStorage.setItem('irNames', JSON.stringify(names));
  }, []);

  const handleIRFileSelected = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setStatusMsg('Please select a .wav file', 'error');
      return;
    }
    setIrFile(file);
    setIrStatus('processing');
    setIrPreprocessed(null);
    setStatusMsg('Processing WAV file...');
    try {
      const ir = await processWavFile(file);
      setIrPreprocessed(ir);
      setIrStatus('idle');
      const peak = Math.max(...Array.from(ir).map(Math.abs));
      setStatusMsg(`Ready: ${file.name} (peak=${peak.toFixed(3)}, samples=${ir.length})`, 'success');
      log(`WAV processed: ${file.name}, ${ir.length} samples, peak=${peak.toFixed(4)}`);
      log(`First 8 samples: ${irSummary(ir)}`);
    } catch (e: any) {
      setIrStatus('error');
      setStatusMsg(`Failed to process WAV: ${e.message}`, 'error');
      log(`WAV error: ${e.message}`);
    }
  }, [setStatusMsg, log]);

  const handleIRUpload = useCallback(async () => {
    if (!midiRef.current || !irPreprocessed) return;
    const slot = irSlot;
    const name = irName.trim() || `Custom IR ${slot + 1}`;
    // Pad 512-sample IR to 1024 samples (4096 bytes) for ROM storage
    const romBytes = padIrToRomBytes(irPreprocessed);
    const totalChunks = Math.ceil(romBytes.length / 128);
    setIrProgress({ current: 0, total: 100 });

    try {
      // 1. Save to localStorage first (for playback without pedal reads)
      saveIrData(slot, irPreprocessed);

      // 2. Erase ROM sector
      setIrStatus('erasing');
      setStatusMsg(`Erasing ROM slot ${slot}...`);
      await midiRef.current.eraseIRRomSector(slot);
      await new Promise(r => setTimeout(r, 500));
      log(`ROM slot ${slot} erased`);
      setIrProgress({ current: 10, total: 100 });

      // 3. Write 4096 bytes to ROM (32 chunks of 128)
      setIrStatus('writing');
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * 128;
        const end = Math.min(offset + 128, romBytes.length);
        const chunk = romBytes.slice(offset, end);
        setIrProgress({ current: 10 + Math.round((i + 1) / totalChunks * 80), total: 100 });
        setStatusMsg(`Writing IR slot ${slot} (${i + 1}/${totalChunks})...`);
        await midiRef.current.sendAndWait({
          type: 'WriteMemory', cmd: 0,
          addr: 0x00069000 + slot * IR_ROM_SLOT_SIZE + offset,
          len: chunk.length, data: chunk,
        });
        await new Promise(r => setTimeout(r, 100));
      }
      log(`ROM slot ${slot}: ${totalChunks} chunks written (${romBytes.length} bytes)`);

      // 4. Verify (read first 8 bytes)
      setIrStatus('verifying');
      setIrProgress({ current: 90, total: 100 });
      setStatusMsg('Verifying...');
      await new Promise(r => setTimeout(r, 300));
      setIrProgress({ current: 100, total: 100 });
      const verifyData = await midiRef.current.readIRFromRom(slot, 8);
      const verifyF32 = new Float32Array(verifyData.buffer);
      const expectedFirst = irPreprocessed[0];
      const actualFirst = verifyF32[0];
      if (Math.abs(expectedFirst - actualFirst) > 0.01) {
        log(`ROM verify mismatch: expected ${expectedFirst.toFixed(4)}, got ${actualFirst.toFixed(4)}`);
      } else {
        log(`ROM verified: first sample ${actualFirst.toFixed(4)}`);
      }

      // 5. Save name
      const updated = { ...irNames, [slot]: name };
      saveIrNames(updated);

      setIrStatus('done');
      setStatusMsg(`IR "${name}" saved to ROM slot ${slot}`, 'success');
      log(`Upload complete: slot ${slot}, "${name}"`);
    } catch (e: any) {
      setIrStatus('error');
      setStatusMsg(`Upload failed: ${e.message}`, 'error');
      log(`Upload error: ${e.message}`);
    }
  }, [midiRef, irPreprocessed, irSlot, irName, irNames, saveIrNames, saveIrData, setStatusMsg, log]);

  const handleIRSelectFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleIRFileSelected(file);
    };
    input.click();
  }, [handleIRFileSelected]);

  const handleIRDownloadBackup = useCallback(async () => {
    if (!midiRef.current) return;
    const slot = irSlot;
    try {
      let f32 = loadIrData(slot);
      if (!f32) {
        setStatusMsg(`Reading ROM slot ${slot} (4096 bytes)...`);
        const data = await midiRef.current.readIRFromRom(slot, IR_ROM_SLOT_SIZE);
        // Take first 512 samples (our IR), discard the zero-padded tail
        f32 = new Float32Array(data.buffer, 0, 512);
        saveIrData(slot, f32);
      }
      const wav = float32ToWav(f32);
      downloadBlob(wav.buffer, `ir_slot${slot}_${irNames[slot] || 'backup'}.wav`);
      setStatusMsg(`Backup of slot ${slot} downloaded as WAV`, 'success');
    } catch (e: any) {
      setStatusMsg(`Backup failed: ${e.message}`, 'error');
    }
  }, [midiRef, irSlot, irNames, loadIrData, saveIrData, downloadBlob, setStatusMsg]);

  const handleIRLoadSlot = useCallback(async (slot: number) => {
    if (!midiRef.current) return;
    const name = irNames[slot] || `Slot ${slot + 1}`;
    try {
      setStatusMsg(`Loading ${name} to RAM...`);
      let f32 = loadIrData(slot);
      if (!f32) {
        setStatusMsg(`Reading ${name} from ROM...`);
        const romData = await midiRef.current.readIRFromRom(slot, IR_ROM_SLOT_SIZE);
        f32 = new Float32Array(romData.buffer, 0, 512);
        saveIrData(slot, f32);
      }
      const bytes = irToBytes(f32);
      await midiRef.current.writeIRToRam(bytes);
      await midiRef.current.writeParameterLive('Cabinet', 0);
      await midiRef.current.setIRDistance(irDistance);
      setActiveCustomSlot(slot);
      setKnobValues(prev => ({ ...prev, ir_cab: 0 }));
      setStatusMsg(`"${name}" loaded to RAM`, 'success');
    } catch (e: any) {
      setStatusMsg(`Failed to load slot ${slot}: ${e.message}`, 'error');
    }
  }, [midiRef, irNames, irDistance, saveIrData, loadIrData, setStatusMsg, setActiveCustomSlot, setKnobValues]);

  // Keyboard shortcuts (placed after all handlers to avoid TDZ)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShowHelp(prev => !prev);
        return;
      }
      if (e.key === 'Escape') {
        setShowHelp(false);
        return;
      }
      if (connected && !connecting) {
        if (e.key === '1') { handleSelectPreset('A'); return; }
        if (e.key === '2') { handleSelectPreset('B'); return; }
        if (e.key === '3') { handleSelectPreset('C'); return; }
        if (ctrlOrCmd && e.key === 's') { e.preventDefault(); handleSave(); return; }
        if (ctrlOrCmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
        if (ctrlOrCmd && e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo(); return; }
        if (ctrlOrCmd && e.key === 'Z') { e.preventDefault(); handleRedo(); return; }
        if (ctrlOrCmd && e.key === 'e') { e.preventDefault(); handleExportPreset(); return; }
        if (ctrlOrCmd && e.key === 'i') { e.preventDefault(); handleImport(); return; }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [connected, connecting, handleSelectPreset, handleSave, handleUndo, handleRedo, handleExportPreset, handleImport]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="app">
      <AppHeader connected={connected} connecting={connecting} mode={mode} onConnect={handleConnect} onDisconnect={handleDisconnect} />

      {connected && connecting && <SkeletonLoader />}
      {connected && !connecting && (
        <>
          <PresetBar selectedPreset={selectedPreset} mode={mode} loading={loading} onSelectPreset={handleSelectPreset} onModeChange={setMode} />

          <div className="pedal-container">
            <Pedal
              model={cubeBabyModel}
              knobValues={{
                type: knobValues.type,
                gain: knobValues.gain,
                tone: knobValues.tone,
                mod: knobValues.mod,
                time: knobValues.time,
                fb: knobValues.fb,
                mix: knobValues.mix,
                reverb: knobValues.reverb,
                ir_cab: knobValues.ir_cab,
                volume: knobValues.volume,
              }}
              sections={{
                A: knobValues.irSection,
                B: knobValues.delaySection,
                C: knobValues.toneSection,
              }}
              mode={mode}
              selectedPreset={selectedPreset}
              onChange={handleKnobChange}
              onChangeEnd={handleKnobChangeEnd}
              onFootswitch={handleFootswitch}
              disabled={false}
            />
          </div>

          <Toolbar
            isDirty={isDirty}
            saving={saving}
            loading={loading}
            importing={importing}
            undoCount={undoStack[selectedPreset]?.length || 0}
            redoCount={redoStack[selectedPreset]?.length || 0}
            selectedPreset={selectedPreset}
            handlers={{
              onSave: handleSave,
              onRevert: handleRevert,
              onUndo: handleUndo,
              onRedo: handleRedo,
              onExportPreset: handleExportPreset,
              onExportBank: handleExportBank,
              onImport: handleImport,
              onRefreshAll: handleRefreshAll,
              onFactoryReset: handleFactoryReset,
            }}
          />

          <IRSection
            irSlot={irSlot}
            irName={irName}
            irStatus={irStatus}
            irProgress={irProgress}
            irDistance={irDistance}
            irFile={irFile}
            irPreprocessed={irPreprocessed}
            irNames={irNames}
            connected={connected}
            open={irLabOpen}
            onToggle={v => { setIrLabOpen(v); localStorage.setItem('irLabOpen', v ? 'open' : 'closed'); }}
            onSlotChange={setIrSlot}
            onNameChange={setIrName}
            onDistanceChange={setIrDistance}
            handlers={{
              onSelectFile: handleIRSelectFile,
              onUpload: handleIRUpload,
              onDownloadBackup: handleIRDownloadBackup,
              onLoadSlot: handleIRLoadSlot,
              onDeleteName: (slot) => { const u = { ...irNames }; delete u[slot]; saveIrNames(u); },
            }}
          />

          <StatusBar status={status} statusType={statusType} />

          <button className="btn btn-xs" onClick={() => setShowHelp(true)} title={t('help.title')}>?</button>
          <HelpModal show={showHelp} onClose={() => setShowHelp(false)} />
          <DebugPanel
            showDebug={showDebug}
            debugLog={debugLog}
            connected={connected}
            onToggle={() => setShowDebug(v => !v)}
            onClear={() => setDebugLog([])}
            onScanIR={handleIRScan}
          />
        </>
      )}

      {!connected && (
        <WelcomeScreen
          connecting={connecting}
          status={status}
          statusType={statusType}
          midiDevices={midiDevices}
          selectedMidiDeviceId={selectedMidiDeviceId}
          onConnect={handleConnect}
          onDeviceChange={setSelectedMidiDeviceId}
        />
      )}
    </div>
  );
}
