import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CubeBabyMidi } from '../midi/cubeBabyMidi';
import type { PresetName } from '../protocol/types';
import { PRESETS, IR_SLOT_COUNT } from '../protocol/types';
import { Pedal } from './components/Pedal';
import LanguageSelector from './components/LanguageSelector';
import { settingsToKnobValues, knobValuesToSettings, KnobValues } from '../protocol';
import { processWavFile, irToBytes, padIrToRomBytes, irSummary, float32ToWav } from './irProcessor';
import { IR_ROM_SLOT_SIZE } from '../protocol/types';
import { changeLanguage, getDirection } from '../i18n/i18n';
import { listMidiDevices } from '../midi/midiService';
import type { MidiDeviceInfo } from '../midi/midiService';

interface Model {
  id: string;
  name: string;
  knobs: Record<string, [number, number]>;
}

const cubeBabyModel: Model = {
  id: 'cube-baby',
  name: 'Cube Baby',
  knobs: {
    type: [0, 8],
    gain: [0, 7],
    tone: [0, 15],
    mod: [0, 15],
    time: [0, 31],
    fb: [0, 127],
    mix: [0, 118],
    reverb: [0, 15],
    ir_cab: [0, 8],
    volume: [0, 127],
  },
};

const PRESET_COLORS: Record<string, string> = {
  A: '#f39c12',
  B: '#2ecc71',
  C: '#3498db',
};

const EMPTY_KNOBS: KnobValues = {
  type: 0, gain: 0, tone: 0, mod: 0, time: 0,
  fb: 0, mix: 0, reverb: 0, ir_cab: 0, volume: 0,
  irSection: true, delaySection: true, toneSection: true,
};

const FACTORY_DEFAULT_KNOBS: KnobValues = {
  type: 0, gain: 4, tone: 8, mod: 7, time: 16,
  fb: 0, mix: 59, reverb: 8, ir_cab: 0, volume: 100,
  irSection: true, delaySection: true, toneSection: true,
};

const MAX_UNDO_DEPTH = 30;

interface PresetFile {
  format: 'cubebabypreset';
  version: 1;
  preset: PresetName;
  knobs: KnobValues;
  created: string;
}

interface BankFile {
  format: 'cubebabybank';
  version: 1;
  presets: Record<PresetName, KnobValues>;
  created: string;
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cubebabypreset,.cubebabybank,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    input.click();
  });
}

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

  // Keyboard shortcuts
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

  const pushUndo = useCallback((preset: PresetName) => {
    setUndoStack(prev => {
      const stack = prev[preset] || [];
      return { ...prev, [preset]: [...stack.slice(-(MAX_UNDO_DEPTH - 1)), knobValues] };
    });
    setRedoStack(prev => ({ ...prev, [preset]: [] }));
  }, [knobValues]);

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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo">
            <span className="app-logo-icon">◆</span>
            <h1>{t('app.title')}</h1>
            <span className={`app-badge ${mode}`}>{mode.toUpperCase()}</span>
          </div>
          <div className="app-header-sub">{t('app.editor')}</div>
        </div>
        <div className="app-header-right">
          <div className="status-indicator-mini">
            <span className={`status-dot-mini ${connected ? 'on' : 'off'}`} />
            <span className="status-text-mini">{connected ? t('app.connected') : t('app.offline')}</span>
          </div>
          {!connected ? (
            <button className="btn-connect" onClick={handleConnect} disabled={connecting}>
              {connecting ? t('app.connecting') : t('app.connect')}
            </button>
          ) : (
            <button className="btn-disconnect" onClick={handleDisconnect}>
              {t('app.disconnect')}
            </button>
          )}
        </div>
      </header>

      {connected && connecting && (
        <div className="skeleton-container">
          <div className="skeleton-preset-bar">
            <div className="skeleton-circle" />
            <div className="skeleton-circle" />
            <div className="skeleton-circle" />
            <div className="skeleton-mode" />
          </div>
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-toolbar">
            <div className="skeleton-btn" />
            <div className="skeleton-btn" />
            <div className="skeleton-btn" />
            <div className="skeleton-btn" />
            <div className="skeleton-btn" />
          </div>
        </div>
      )}
      {connected && !connecting && (
        <><div className="preset-bar">
            <div className="preset-selector">
              {PRESETS.map(p => (
                <button
                  key={p}
                  className={`preset-btn ${selectedPreset === p ? 'active' : ''}`}
                  style={{ '--preset-color': PRESET_COLORS[p] } as React.CSSProperties}
                  onClick={() => handleSelectPreset(p)}
                  disabled={loading}
                >
                  <span className="preset-btn-letter">{p}</span>
                </button>
              ))}
            </div>
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === 'preset' ? 'active' : ''}`}
                onClick={() => setMode('preset')}
              >
                {t('preset.modePreset')}
              </button>
              <button
                className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
                onClick={() => setMode('live')}
              >
                {t('preset.modeLive')}
              </button>
            </div>
          </div>

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

          <div className="toolbar">
            <button
              className={`btn btn-primary btn-xs ${isDirty ? 'btn-dirty' : ''}`}
              onClick={handleSave}
              disabled={saving || loading}
              title={`${t('preset.save')} (Ctrl+S)`}
            >
              {saving ? t('preset.saving') : isDirty ? `${t('preset.save')}*` : t('preset.save')}
            </button>
            {isDirty && <button className="btn btn-xs btn-revert" onClick={handleRevert} title={t('preset.revert')}>↩</button>}
            <button className="btn btn-xs btn-undo" onClick={handleUndo} disabled={(undoStack[selectedPreset]?.length || 0) === 0} title={t('preset.undo') + ' (Ctrl+Z)'}>↩</button>
            <button className="btn btn-xs btn-redo" onClick={handleRedo} disabled={(redoStack[selectedPreset]?.length || 0) === 0} title={t('preset.redo') + ' (Ctrl+Shift+Z)'}>↪</button>
            <button className="btn btn-secondary btn-xs" onClick={handleExportPreset} title={t('preset.export') + ' (Ctrl+E)'}>
              {t('preset.export')}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleExportBank} title={t('preset.bank')}>
              {t('preset.bank')}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleImport} disabled={importing} title={t('preset.import') + ' (Ctrl+I)'}>
              {importing ? t('preset.importing') : t('preset.import')}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleRefreshAll} title={t('preset.refresh')}>
              {t('preset.refresh')}
            </button>
            <button className="btn btn-xs btn-danger" onClick={handleFactoryReset} title={t('preset.factoryReset')}>↺</button>
          </div>

          <details className="ir-lab" open={irLabOpen} onToggle={e => { const v = (e.target as HTMLDetailsElement).open; setIrLabOpen(v); localStorage.setItem('irLabOpen', v ? 'open' : 'closed'); }}>
            <summary className="ir-lab-summary">
              <span className="ir-lab-toggle">▼</span>
              {t('ir.title')}
            </summary>
            <div className="ir-lab-content">
              <div className="ir-upload-section">
                <div className="ir-upload-row">
                  <button className="btn btn-xs btn-primary" onClick={handleIRSelectFile} disabled={irStatus === 'processing'}>
                    {irFile ? t('ir.changeFile') : t('ir.selectFile')}
                  </button>
                  <span className="ir-file-name">{irFile ? irFile.name : t('ir.noFile')}</span>
                </div>
                {irPreprocessed && (
                  <div className="ir-upload-preview">
                    <span className="ir-preview-text">{t('ir.processed', { samples: 512, peak: Math.max(...Array.from(irPreprocessed).map(Math.abs)).toFixed(3) })}</span>
                  </div>
                )}
                <div className="ir-upload-row">
                  <label className="ir-label">{t('ir.slot')}</label>
                  <select className="ir-select" value={irSlot} onChange={e => setIrSlot(Number(e.target.value))} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'}>
                    {Array.from({ length: IR_SLOT_COUNT }, (_, i) => (
                      <option key={i} value={i}>{t('ir.slotOption', { number: i + 1 })}{irNames[i] ? ` — ${irNames[i]}` : ''}</option>
                    ))}
                  </select>
                  <button className="btn btn-xs" onClick={handleIRDownloadBackup} disabled={!midiRef.current || irStatus === 'processing' || irStatus === 'writing'} title={t('ir.backup')}>
                    {t('ir.backup')}
                  </button>
                </div>
                <div className="ir-upload-row">
                  <label className="ir-label">{t('ir.dist')}</label>
                  <input className="ir-range" type="range" min="0" max="1" step="0.01" value={irDistance} onChange={e => setIrDistance(parseFloat(e.target.value))} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'} />
                  <span className="ir-range-value">{irDistance.toFixed(2)}</span>
                </div>
                <div className="ir-upload-row">
                  <label className="ir-label">{t('ir.name')}</label>
                  <input className="ir-input" type="text" value={irName} onChange={e => setIrName(e.target.value)} placeholder={t('ir.namePlaceholder', { number: irSlot + 1 })} maxLength={32} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'} />
                </div>
                <div className="ir-upload-row">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleIRUpload}
                    disabled={!irPreprocessed || !midiRef.current || irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'}
                  >
                    {irStatus === 'erasing' ? t('ir.erasing') :
                     irStatus === 'writing' ? `${Math.round(irProgress.current / irProgress.total * 100)}%` :
                     irStatus === 'verifying' ? t('ir.verifying') :
                     irStatus === 'done' ? t('ir.done') :
                     t('ir.upload')}
                  </button>
                  {(irStatus === 'writing' || irStatus === 'erasing' || irStatus === 'verifying') && (
                    <div className="ir-progress-bar">
                      <div className="ir-progress-fill" style={{ width: `${(irProgress.current / irProgress.total) * 100}%` }} />
                    </div>
                  )}
                </div>
              </div>

              {Object.keys(irNames).length > 0 && (
                <div className="ir-names-list">
                  {Array.from({ length: IR_SLOT_COUNT }, (_, i) => irNames[i] ? (
                    <div key={i} className="ir-name-entry" onClick={() => handleIRLoadSlot(i)} title={t('ir.clickToLoad')}>
                      <span className="ir-name-slot">{t('ir.slotLabel', { number: i + 1 })}</span>
                      <span className="ir-name-label">{irNames[i]}</span>
                      <button className="btn btn-xs btn-danger" onClick={e => { e.stopPropagation(); const u = { ...irNames }; delete u[i]; saveIrNames(u); }} title={t('ir.removeName')}>✕</button>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>
          </details>

          <div className="status-msg">
            <span className={`status-msg-dot ${statusType}`} />
            <span>{status || t('status.ready')}</span>
          </div>

          <button className="btn btn-xs" onClick={() => setShowHelp(true)} title={t('help.title')}>?</button>
          {showHelp && (
            <div className="help-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
              <div className="help-modal">
                <button className="btn btn-xs btn-danger" onClick={() => setShowHelp(false)} title={t('help.close')}>?</button>
                <h2>{t('help.appTitle')}</h2>
                <p className="help-desc">{t('help.appDesc')}</p>
                
                <h3>{t('help.features')}</h3>
                <ul className="help-features">
                  <li>{t('help.feature1')}</li>
                  <li>{t('help.feature2')}</li>
                  <li>{t('help.feature3')}</li>
                  <li>{t('help.feature4')}</li>
                  <li>{t('help.feature5')}</li>
                  <li>{t('help.feature6')}</li>
                </ul>
                
                <h3>{t('help.irTitle')}</h3>
                <p>{t('help.irDesc')}</p>
                <ul className="help-features">
                  <li>{t('help.irFeature1')}</li>
                  <li>{t('help.irFeature2')}</li>
                  <li>{t('help.irFeature3')}</li>
                  <li>{t('help.irFeature4')}</li>
                </ul>
                
                <h3>{t('help.protocol')}</h3>
                <p dangerouslySetInnerHTML={{ __html: t('help.protocolDesc', { link: '<a href="https://github.com/pferreir/cuvave-midi" target="_blank" rel="noopener noreferrer">pferreir/cuvave-midi</a>' }) }} />
                <p dangerouslySetInnerHTML={{ __html: t('help.protocolDoc', { file: '<code>knowledge_base.md</code>' }) }} />
                
                <h3>{t('help.hardware')}</h3>
                <p>{t('help.hardwareDesc')}</p>
                
                <h3>{t('help.version')}</h3>
                <p>v0.3.2 — {t('help.license')}</p>
              </div>
            </div>
          )}
                    <details className="debug-section">
            <summary className="debug-summary" onClick={(e) => { e.preventDefault(); setShowDebug(!showDebug); }}>
              <span className="debug-toggle">{showDebug ? '▼' : '▶'}</span>
              {t('debug.title')} {debugLog.length > 0 && `(${debugLog.length})`}
            </summary>
            <div className="debug-content">
              <div className="debug-actions">
                <button className="btn btn-xs btn-danger" onClick={() => setDebugLog([])}>{t('debug.clear')}</button>
                <button className="btn btn-xs btn-secondary" onClick={handleIRScan} disabled={!connected}>{t('debug.scan')}</button>
              </div>
              {debugLog.length > 0 && (
                <div className="debug-log">
                  {debugLog.map((r, i) => <div key={i} className="debug-line">{r}</div>)}
                </div>
              )}
            </div>
          </details>
        </>
      )}

      {!connected && (
        <div className="welcome">
          <div className="welcome-icon">◆</div>
          <h2>{t('welcome.title')}</h2>
          <p>{t('welcome.desc')}</p>
          <ul className="welcome-features">
            <li>{t('welcome.feature1')}</li>
            <li>{t('welcome.feature2')}</li>
            <li>{t('welcome.feature3')}</li>
            <li>{t('welcome.feature4')}</li>
          </ul>
          {midiDevices.length > 1 && (
            <div className="welcome-midi-devices">
              <label>{t('welcome.midiDevice')}: </label>
              <select className="pedal-select welcome-select" value={selectedMidiDeviceId} onChange={e => setSelectedMidiDeviceId(e.target.value)}>
                {midiDevices.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          {midiDevices.length === 0 && !connecting && (
            <p className="welcome-no-devices">{t('welcome.noMidiDevices')}</p>
          )}
          <div className="welcome-language">
            <label>{t('welcome.language')}: </label>
            <LanguageSelector />
          </div>
          <button className="btn-connect btn-connect-large" onClick={handleConnect} disabled={connecting}>
            {connecting ? t('app.connecting') : t('app.connect')}
          </button>
          {status && (
            <div className={`status-msg welcome-status ${statusType}`}>
              <span className={`status-msg-dot ${statusType}`} />
              <span>{status}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
