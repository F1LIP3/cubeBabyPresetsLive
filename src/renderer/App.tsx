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
import { VirtualPresetBar } from './components/VirtualPresetBar';
import { settingsToKnobValues, knobValuesToSettings } from '../protocol';
import type { KnobValues } from '../protocol';
import { processWavFile, irToBytes, padIrToRomBytes, irSummary, float32ToWav } from './irProcessor';
import { changeLanguage, getDirection } from '../i18n/i18n';
import { listMidiDevices } from '../midi/midiService';
import type { MidiDeviceInfo } from '../midi/midiService';
import { cubeBabyModel, EMPTY_KNOBS, FACTORY_DEFAULT_KNOBS, MAX_UNDO_DEPTH } from './constants';
import type { VirtualPreset, PresetBank } from './types';
import type { PresetFile, BankFile } from './helpers';
import { downloadJson, loadFile } from './helpers';

let nextVirtualId = 1;
function genVirtualId(): string {
  while (localStorage.getItem(`vp_exists_${nextVirtualId}`)) nextVirtualId++;
  const id = `vp_${nextVirtualId}`;
  nextVirtualId++;
  return id;
}

function getDefaultVirtualPresets(): VirtualPreset[] {
  const now = new Date().toISOString();
  return [
    { id: 'vp_1', name: 'Clean', knobs: { type: 0, gain: 2, tone: 8, mod: 0, time: 8, fb: 0, mix: 40, reverb: 8, ir_cab: 0, volume: 100, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
    { id: 'vp_2', name: 'Crunch', knobs: { type: 3, gain: 5, tone: 10, mod: 0, time: 8, fb: 0, mix: 40, reverb: 6, ir_cab: 0, volume: 100, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
    { id: 'vp_3', name: 'Lead', knobs: { type: 5, gain: 7, tone: 12, mod: 4, time: 20, fb: 35, mix: 50, reverb: 10, ir_cab: 0, volume: 110, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
  ];
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
  const [presetBank, setPresetBank] = useState<PresetBank>(() => {
    return (localStorage.getItem('presetBank') as PresetBank) || 'hardware';
  });
  const [knobValues, setKnobValues] = useState<KnobValues>(EMPTY_KNOBS);
  const [allKnobs, setAllKnobs] = useState<Record<PresetName, KnobValues>>(() => { try { const saved = localStorage.getItem(`allKnobs`); if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.A && parsed.B && parsed.C) return parsed; } } catch (e) { } return { A: EMPTY_KNOBS, B: EMPTY_KNOBS, C: EMPTY_KNOBS }; });
  useEffect(() => { localStorage.setItem(`allKnobs`, JSON.stringify(allKnobs)); }, [allKnobs]);
  const [virtualPresets, setVirtualPresets] = useState<VirtualPreset[]>(() => {
    try {
      const saved = localStorage.getItem('virtualPresets');
      if (saved) {
        const parsed = JSON.parse(saved) as VirtualPreset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach(p => { const num = parseInt(p.id.replace('vp_', '')); if (num >= nextVirtualId) nextVirtualId = num + 1; });
          return parsed;
        }
      }
    } catch {}
    return getDefaultVirtualPresets();
  });
  useEffect(() => { localStorage.setItem('virtualPresets', JSON.stringify(virtualPresets)); }, [virtualPresets]);
  const [selectedVirtualPresetId, setSelectedVirtualPresetId] = useState<string | null>(() => {
    const saved = localStorage.getItem('selectedVirtualPresetId');
    if (saved) return saved;
    return 'vp_1';
  });
  useEffect(() => { if (selectedVirtualPresetId) localStorage.setItem('selectedVirtualPresetId', selectedVirtualPresetId); }, [selectedVirtualPresetId]);
  useEffect(() => { localStorage.setItem('presetBank', presetBank); }, [presetBank]);

  const savedKnobs = useMemo(() => {
    if (presetBank === 'virtual') {
      const vp = virtualPresets.find(p => p.id === selectedVirtualPresetId);
      return vp ? vp.knobs : EMPTY_KNOBS;
    }
    return allKnobs[selectedPreset] || EMPTY_KNOBS;
  }, [presetBank, virtualPresets, selectedVirtualPresetId, allKnobs, selectedPreset]);

  const isDirty = useMemo(() => {
    return JSON.stringify(knobValues) !== JSON.stringify(savedKnobs);
  }, [knobValues, savedKnobs]);

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
  const [undoStack, setUndoStack] = useState<Record<string, KnobValues[]>>(() => {
    const hw: Record<string, KnobValues[]> = { A: [], B: [], C: [] };
    const saved = localStorage.getItem('virtUndoStack');
    if (saved) try { return { ...hw, ...JSON.parse(saved) }; } catch {}
    return hw;
  });
  const [redoStack, setRedoStack] = useState<Record<string, KnobValues[]>>(() => {
    const hw: Record<string, KnobValues[]> = { A: [], B: [], C: [] };
    const saved = localStorage.getItem('virtRedoStack');
    if (saved) try { return { ...hw, ...JSON.parse(saved) }; } catch {}
    return hw;
  });

  const currentUndoKey: string = presetBank === 'virtual' ? (selectedVirtualPresetId || '__none') : selectedPreset;

  useEffect(() => {
    const virtUndo: Record<string, KnobValues[]> = {};
    const virtRedo: Record<string, KnobValues[]> = {};
    for (const [k, v] of Object.entries(undoStack)) {
      if (k !== 'A' && k !== 'B' && k !== 'C') { virtUndo[k] = v; }
    }
    for (const [k, v] of Object.entries(redoStack)) {
      if (k !== 'A' && k !== 'B' && k !== 'C') { virtRedo[k] = v; }
    }
    if (Object.keys(virtUndo).length) localStorage.setItem('virtUndoStack', JSON.stringify(virtUndo));
    if (Object.keys(virtRedo).length) localStorage.setItem('virtRedoStack', JSON.stringify(virtRedo));
  }, [undoStack, redoStack]);

  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedMidiDeviceId, setSelectedMidiDeviceId] = useState<string>('');

  useEffect(() => {
    listMidiDevices().then(devices => {
      setMidiDevices(devices);
      if (devices.length > 0 && !selectedMidiDeviceId) {
        setSelectedMidiDeviceId(devices[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (presetBank === 'virtual' && virtualPresets.length > 0 && !selectedVirtualPresetId) {
      setSelectedVirtualPresetId(virtualPresets[0].id);
      setKnobValues(virtualPresets[0].knobs);
    }
  }, [presetBank]);

  const setStatusMsg = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(msg);
    setStatusType(type);
  }, []);

  const log = useCallback((msg: string) => {
    setDebugLog(prev => [...prev, msg]);
  }, []);

  const handleBankChange = useCallback((bank: PresetBank) => {
    setPresetBank(bank);
    if (bank === 'virtual' && virtualPresets.length > 0) {
      const targetId = selectedVirtualPresetId || virtualPresets[0].id;
      setSelectedVirtualPresetId(targetId);
      const vp = virtualPresets.find(p => p.id === targetId);
      if (vp) {
        setKnobValues(vp.knobs);
        if (midiRef.current) {
          const settings = knobValuesToSettings(vp.knobs);
          midiRef.current.applySettingsToDsp(settings).catch(() => {});
        }
      }
    }
  }, [virtualPresets, selectedVirtualPresetId, midiRef]);

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
      setAllKnobs({ A: { ...EMPTY_KNOBS }, B: { ...EMPTY_KNOBS }, C: { ...EMPTY_KNOBS } });
      setKnobValues({ ...EMPTY_KNOBS });
      setConnected(true);

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
  }, [log, setStatusMsg, t, selectedMidiDeviceId]);

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

  const loadKnobsToPedal = useCallback(async (knobs: KnobValues) => {
    if (!midiRef.current) return;
    try {
      const settings = knobValuesToSettings(knobs);
      await midiRef.current.applySettingsToDsp(settings);
    } catch {}
  }, [midiRef]);

  const handleSelectPreset = useCallback(async (preset: PresetName) => {
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

  const handleSelectVirtualPreset = useCallback(async (id: string) => {
    const vp = virtualPresets.find(p => p.id === id);
    if (!vp) return;
    setSelectedVirtualPresetId(id);
    setKnobValues(vp.knobs);
    await loadKnobsToPedal(vp.knobs);
    setStatusMsg(t('status.switched', { name: vp.name }), 'info');
  }, [virtualPresets, loadKnobsToPedal, setStatusMsg, t]);

  const handleAddVirtualPreset = useCallback(() => {
    if (virtualPresets.length >= 50) {
      setStatusMsg('Maximum 50 virtual presets', 'error');
      return;
    }
    const newName = `Preset ${virtualPresets.length + 1}`;
    const now = new Date().toISOString();
    const newVp: VirtualPreset = {
      id: genVirtualId(),
      name: newName,
      knobs: { ...knobValues },
      created: now,
      updated: now,
    };
    setVirtualPresets(prev => [...prev, newVp]);
    setSelectedVirtualPresetId(newVp.id);
    setStatusMsg(t('virtual.added'), 'success');
  }, [virtualPresets, knobValues, setStatusMsg, t]);

  const handleDeleteVirtualPreset = useCallback((id: string) => {
    const vp = virtualPresets.find(p => p.id === id);
    if (!vp) return;
    const msg = t('virtual.confirmDelete', { name: vp.name });
    if (!confirm(msg)) return;
    const filtered = virtualPresets.filter(p => p.id !== id);
    setVirtualPresets(filtered);
    if (selectedVirtualPresetId === id) {
      if (filtered.length > 0) {
        const first = filtered[0];
        setSelectedVirtualPresetId(first.id);
        setKnobValues(first.knobs);
        loadKnobsToPedal(first.knobs);
      } else {
        setSelectedVirtualPresetId(null);
        setKnobValues(EMPTY_KNOBS);
      }
    }
    setStatusMsg(t('virtual.deleted'), 'info');
  }, [virtualPresets, selectedVirtualPresetId, loadKnobsToPedal, setStatusMsg, t]);

  const handleRenameVirtualPreset = useCallback((id: string, name: string) => {
    setVirtualPresets(prev => prev.map(p =>
      p.id === id ? { ...p, name, updated: new Date().toISOString() } : p
    ));
    setStatusMsg(t('virtual.renamed'), 'success');
  }, [setStatusMsg, t]);

  const handleSave = useCallback(async () => {
    if (presetBank === 'virtual') {
      if (!selectedVirtualPresetId) return;
      setVirtualPresets(prev => prev.map(p =>
        p.id === selectedVirtualPresetId
          ? { ...p, knobs: knobValues, updated: new Date().toISOString() }
          : p
      ));
      setStatusMsg(t('virtual.saved'), 'success');
    }
    if (midiRef.current) {
      setSaving(true);
      try {
        const settings = knobValuesToSettings(knobValues);
        if (presetBank === 'hardware') {
          await midiRef.current.saveActivePresetToSlot(selectedPreset, settings);
          setAllKnobs(prev => ({ ...prev, [selectedPreset]: knobValues }));
          setStatusMsg(t('status.savedToPedal', { name: selectedPreset }), 'success');
        } else {
          await midiRef.current.applySettingsToDsp(settings);
          setStatusMsg(t('status.savedToPedal', { name: knobValues.type }), 'success');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusMsg(t('status.saveFailed', { message }), 'error');
      } finally {
        setSaving(false);
      }
    }
  }, [presetBank, selectedVirtualPresetId, knobValues, midiRef, selectedPreset, setStatusMsg, t]);

  const handleExportVirtualPresets = useCallback(() => {
    const file = {
      format: 'cubebabyvirtualbank',
      version: 1,
      presets: virtualPresets,
      created: new Date().toISOString(),
    };
    downloadJson(file, 'cube-baby-virtual-presets.json');
    setStatusMsg(t('status.exportedBank'), 'success');
  }, [virtualPresets, setStatusMsg, t]);

  const handleImportVirtualPresets = useCallback(async () => {
    try {
      const text = await loadFile();
      const data = JSON.parse(text);
      if (data.format === 'cubebabyvirtualbank' && Array.isArray(data.presets)) {
        const imported = data.presets as VirtualPreset[];
        if (imported.length + virtualPresets.length > 50) {
          setStatusMsg('Import would exceed 50 preset limit', 'error');
          return;
        }
        const merged = [...virtualPresets];
        for (const vp of imported) {
          const newId = genVirtualId();
          merged.push({ ...vp, id: newId });
        }
        setVirtualPresets(merged);
        setStatusMsg(`Imported ${imported.length} virtual presets`, 'success');
      } else {
        setStatusMsg(t('status.unknownFormat'), 'error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(t('status.importFailed', { message }), 'error');
    }
  }, [virtualPresets, setStatusMsg, t]);

  const handleExportPreset = useCallback(() => {
    if (presetBank === 'virtual') {
      handleExportVirtualPresets();
      return;
    }
    const file: PresetFile = {
      format: 'cubebabypreset',
      version: 1,
      preset: selectedPreset,
      knobs: knobValues,
      created: new Date().toISOString(),
    };
    downloadJson(file, `cube-baby-${selectedPreset}.cubebabypreset`);
    setStatusMsg(t('status.exportedPreset', { name: selectedPreset }), 'success');
  }, [presetBank, selectedPreset, knobValues, setStatusMsg, t, handleExportVirtualPresets]);

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
    if (presetBank === 'virtual') {
      await handleImportVirtualPresets();
      return;
    }
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
  }, [presetBank, setStatusMsg, t, handleImportVirtualPresets]);

  const pushUndo = useCallback((key: string) => {
    setUndoStack(prev => {
      const stack = prev[key] || [];
      return { ...prev, [key]: [...stack.slice(-(MAX_UNDO_DEPTH - 1)), knobValues] };
    });
    setRedoStack(prev => ({ ...prev, [key]: [] }));
  }, [knobValues]);

  const handleRevert = useCallback(() => {
    if (savedKnobs) {
      pushUndo(currentUndoKey);
      setKnobValues(savedKnobs);
      setStatusMsg(t('status.reverted', { name: selectedPreset }), 'info');
      if (midiRef.current) {
        const settings = knobValuesToSettings(savedKnobs);
        midiRef.current.applySettingsToDsp(settings).catch(() => {});
      }
    }
  }, [savedKnobs, pushUndo, currentUndoKey, setStatusMsg, t, selectedPreset]);

  const handleFactoryReset = useCallback(async () => {
    pushUndo(currentUndoKey);
    setKnobValues(FACTORY_DEFAULT_KNOBS);
    if (presetBank === 'virtual') {
      if (selectedVirtualPresetId) {
        setVirtualPresets(prev => prev.map(p =>
          p.id === selectedVirtualPresetId
            ? { ...p, knobs: FACTORY_DEFAULT_KNOBS, updated: new Date().toISOString() }
            : p
        ));
      }
      setStatusMsg(t('status.resetToDefaults', { name: 'virtual' }), 'success');
    } else {
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
    }
  }, [pushUndo, currentUndoKey, presetBank, selectedVirtualPresetId, selectedPreset, setStatusMsg, t]);

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
    try {
      log('--- Reading 8192 bytes from 0x00069000 ---');
      const big = await baby.readIRFromRom(0, 8192);
      for (let off = 0; off < 8192; off += 256) {
        const chunk = big.slice(off, off + 256);
        const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
        if (/[A-Za-z]{3,}/.test(ascii)) log(`  @${off}: "${ascii.trim()}"`);
      }
    } catch (e: any) { log(`8192 read error: ${e.message}`); }
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
    pushUndo(currentUndoKey);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!midiRef.current) return;
      try {
        await midiRef.current.writeSingleKnob(name, value);
      } catch {}
    }, 50);
  }, [currentUndoKey, pushUndo]);

  const handleUndo = useCallback(() => {
    const stack = undoStack[currentUndoKey] || [];
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setUndoStack(prevStack => {
      const s = prevStack[currentUndoKey] || [];
      return { ...prevStack, [currentUndoKey]: s.slice(0, -1) };
    });
    setRedoStack(prevStack => ({
      ...prevStack,
      [currentUndoKey]: [...(prevStack[currentUndoKey] || []), knobValues],
    }));
    setKnobValues(prev);
    if (midiRef.current) {
      const paramNames = Object.keys(prev).filter(k => k !== 'irSection' && k !== 'delaySection' && k !== 'toneSection');
      for (const param of paramNames) {
        const val = prev[param as keyof KnobValues] as number;
        midiRef.current.writeSingleKnob(param, val).catch(() => {});
      }
    }
  }, [currentUndoKey, undoStack, knobValues]);

  const handleRedo = useCallback(() => {
    const stack = redoStack[currentUndoKey] || [];
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack(prevStack => {
      const s = prevStack[currentUndoKey] || [];
      return { ...prevStack, [currentUndoKey]: s.slice(0, -1) };
    });
    setUndoStack(prevStack => ({
      ...prevStack,
      [currentUndoKey]: [...(prevStack[currentUndoKey] || []), knobValues],
    }));
    setKnobValues(next);
    if (midiRef.current) {
      const paramNames = Object.keys(next).filter(k => k !== 'irSection' && k !== 'delaySection' && k !== 'toneSection');
      for (const param of paramNames) {
        const val = next[param as keyof KnobValues] as number;
        midiRef.current.writeSingleKnob(param, val).catch(() => {});
      }
    }
  }, [currentUndoKey, redoStack, knobValues]);

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
    const romBytes = padIrToRomBytes(irPreprocessed);
    const totalChunks = Math.ceil(romBytes.length / 128);
    setIrProgress({ current: 0, total: 100 });

    try {
      saveIrData(slot, irPreprocessed);
      setIrStatus('erasing');
      setStatusMsg(`Erasing ROM slot ${slot}...`);
      await midiRef.current.eraseIRRomSector(slot);
      await new Promise(r => setTimeout(r, 500));
      log(`ROM slot ${slot} erased`);
      setIrProgress({ current: 10, total: 100 });

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
        if (presetBank === 'hardware') {
          if (e.key === '1') { handleSelectPreset('A'); return; }
          if (e.key === '2') { handleSelectPreset('B'); return; }
          if (e.key === '3') { handleSelectPreset('C'); return; }
        }
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
  }, [connected, connecting, presetBank, handleSelectPreset, handleSave, handleUndo, handleRedo, handleExportPreset, handleImport]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="app">
      <AppHeader connected={connected} connecting={connecting} mode={mode} presetBank={presetBank} onConnect={handleConnect} onDisconnect={handleDisconnect} onBankChange={handleBankChange} />

      {connected && connecting && <SkeletonLoader />}
      {connected && !connecting && (
        <>
          {presetBank === 'hardware' ? (
            <PresetBar selectedPreset={selectedPreset} mode={mode} loading={loading} onSelectPreset={handleSelectPreset} onModeChange={setMode} />
          ) : (
            <VirtualPresetBar
              virtualPresets={virtualPresets}
              selectedVirtualPresetId={selectedVirtualPresetId}
              mode={mode}
              onSelectPreset={handleSelectVirtualPreset}
              onAddPreset={handleAddVirtualPreset}
              onDeletePreset={handleDeleteVirtualPreset}
              onRenamePreset={handleRenameVirtualPreset}
              onModeChange={setMode}
            />
          )}

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
            undoCount={undoStack[currentUndoKey]?.length || 0}
            redoCount={redoStack[currentUndoKey]?.length || 0}
            presetBank={presetBank}
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