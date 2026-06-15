import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CubeBabyMidi } from '../midi/cubeBabyMidi';
import type { PresetName } from '../protocol/types';
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
import { useVirtualPresets } from './hooks/useVirtualPresets';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useIR } from './hooks/useIR';
import { settingsToKnobValues, knobValuesToSettings } from '../protocol';
import type { KnobValues } from '../protocol';
import { getDirection } from '../i18n/i18n';
import { listMidiDevices } from '../midi/midiService';
import type { MidiDeviceInfo } from '../midi/midiService';
import { cubeBabyModel, EMPTY_KNOBS, FACTORY_DEFAULT_KNOBS } from './constants';
import type { PresetBank } from './types';
import type { PresetFile, BankFile } from './helpers';
import { downloadJson, loadFile } from './helpers';

export default function App() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dir = getDirection(i18n.language);
  }, [i18n.language]);

  // Core state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetName>('A');
  const [mode, setMode] = useState<'live' | 'preset'>('preset');
  const [presetBank, setPresetBank] = useState<PresetBank>(() => {
    return (localStorage.getItem('presetBank') as PresetBank) || 'hardware';
  });
  const [knobValues, setKnobValues] = useState<KnobValues>(EMPTY_KNOBS);
  const [allKnobs, setAllKnobs] = useState<Record<PresetName, KnobValues>>(() => {
    try {
      const saved = localStorage.getItem('allKnobs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.A && parsed.B && parsed.C) return parsed;
      }
    } catch {}
    return { A: EMPTY_KNOBS, B: EMPTY_KNOBS, C: EMPTY_KNOBS };
  });

  useEffect(() => { localStorage.setItem('allKnobs', JSON.stringify(allKnobs)); }, [allKnobs]);
  useEffect(() => { localStorage.setItem('presetBank', presetBank); }, [presetBank]);

  // Virtual presets (SOLID: extracted to hook)
  const virt = useVirtualPresets(knobValues);

  const savedKnobs = useMemo(() => {
    if (presetBank === 'virtual') return virt.current ? virt.current.knobs : EMPTY_KNOBS;
    return allKnobs[selectedPreset] || EMPTY_KNOBS;
  }, [presetBank, virt.current, allKnobs, selectedPreset]);

  const isDirty = useMemo(() => {
    return JSON.stringify(knobValues) !== JSON.stringify(savedKnobs);
  }, [knobValues, savedKnobs]);

  // UI state
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
  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedMidiDeviceId, setSelectedMidiDeviceId] = useState<string>('');

  // MIDI device scan
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

  // IR (SOLID: extracted to hook)
  const ir = useIR(midiRef, setStatusMsg, log, setKnobValues);

  // Undo/redo (SOLID: extracted to hook)
  const currentUndoKey: string = presetBank === 'virtual' ? (virt.selectedId || '__none') : selectedPreset;
  const undoRedo = useUndoRedo(knobValues, currentUndoKey, midiRef, setKnobValues);

  const loadKnobsToPedal = useCallback(async (knobs: KnobValues) => {
    if (!midiRef.current) return;
    try {
      const settings = knobValuesToSettings(knobs);
      await midiRef.current.applySettingsToDsp(settings);
    } catch {}
  }, [midiRef]);

  // ── Handlers ──

  const handleBankChange = useCallback((bank: PresetBank) => {
    setPresetBank(bank);
    if (bank === 'virtual') {
      const current = virt.presets.find(p => p.id === virt.selectedId);
      if (current) {
        setKnobValues(current.knobs);
        loadKnobsToPedal(current.knobs);
      }
    }
  }, [virt.presets, virt.selectedId, loadKnobsToPedal]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setStatusMsg(t('app.connecting'));
    try {
      const baby = new CubeBabyMidi();
      baby.onUnsolicited = (msg) => log(`Unsolicited: ${JSON.stringify(msg)}`);
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
          log(`Failed to read preset ${preset}: ${err instanceof Error ? err.message : String(err)}`);
          presets[preset] = { ...EMPTY_KNOBS };
        }
      }
      setAllKnobs({ A: presets.A, B: presets.B, C: presets.C });
      setKnobValues(presets.A);
      setStatusMsg(t('status.connected', { loaded: loadedCount, total: 3 }), 'success');
    } catch (err: unknown) {
      setStatusMsg(t('status.connectionFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
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

  const handleSelectPreset = useCallback(async (preset: PresetName) => {
    setSelectedPreset(preset);
    const cached = allKnobs[preset];
    setKnobValues(cached);
    if (midiRef.current) {
      try {
        await midiRef.current.switchPreset(preset, knobValuesToSettings(cached));
      } catch (err: unknown) {
        log(`Switch preset ${preset} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setStatusMsg(t('status.switched', { name: preset }), 'info');
  }, [allKnobs, setStatusMsg, log, t]);

  const handleSelectVirtualPreset = useCallback(async (id: string) => {
    virt.select(id);
    const vp = virt.presets.find(p => p.id === id);
    if (vp) {
      setKnobValues(vp.knobs);
      await loadKnobsToPedal(vp.knobs);
      setStatusMsg(t('status.switched', { name: vp.name }), 'info');
    }
  }, [virt.select, virt.presets, loadKnobsToPedal, setStatusMsg, t]);

  const handleSave = useCallback(async () => {
    if (presetBank === 'virtual' && virt.selectedId) {
      virt.updateKnobs(virt.selectedId, knobValues);
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
          setStatusMsg(t('status.savedToPedal', { name: selectedPreset }), 'success');
        }
      } catch (err: unknown) {
        setStatusMsg(t('status.saveFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
      } finally {
        setSaving(false);
      }
    }
  }, [presetBank, virt.selectedId, virt.updateKnobs, knobValues, midiRef, selectedPreset, setStatusMsg, t]);

  const handleRevert = useCallback(() => {
    if (savedKnobs) {
      undoRedo.pushUndo(currentUndoKey);
      setKnobValues(savedKnobs);
      setStatusMsg(t('status.reverted', { name: selectedPreset }), 'info');
      if (midiRef.current) {
        midiRef.current.applySettingsToDsp(knobValuesToSettings(savedKnobs)).catch(() => {});
      }
    }
  }, [savedKnobs, undoRedo.pushUndo, currentUndoKey, setStatusMsg, t, selectedPreset]);

  const handleFactoryReset = useCallback(async () => {
    undoRedo.pushUndo(currentUndoKey);
    setKnobValues(FACTORY_DEFAULT_KNOBS);
    if (presetBank === 'virtual') {
      if (virt.selectedId) virt.updateKnobs(virt.selectedId, FACTORY_DEFAULT_KNOBS);
      setStatusMsg(t('status.resetToDefaults', { name: 'virtual' }), 'success');
    } else {
      setAllKnobs(prev => ({ ...prev, [selectedPreset]: FACTORY_DEFAULT_KNOBS }));
      if (midiRef.current) {
        try {
          await midiRef.current.saveActivePresetToSlot(selectedPreset, knobValuesToSettings(FACTORY_DEFAULT_KNOBS));
          setStatusMsg(t('status.resetToDefaults', { name: selectedPreset }), 'success');
        } catch {
          setStatusMsg(t('status.saveFailed', { message: 'MIDI write failed' }), 'error');
        }
      }
    }
  }, [undoRedo.pushUndo, currentUndoKey, presetBank, virt.selectedId, virt.updateKnobs, selectedPreset, setStatusMsg, t]);

  const handleRefreshAll = useCallback(async () => {
    if (!midiRef.current) return;
    setLoading(true);
    try {
      const all = await midiRef.current.readAllPresets();
      setAllKnobs({ A: settingsToKnobValues(all.A), B: settingsToKnobValues(all.B), C: settingsToKnobValues(all.C) });
      setStatusMsg(t('status.presetsRefreshed'), 'success');
    } catch (err: unknown) {
      setStatusMsg(t('status.refreshFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setLoading(false);
    }
  }, [setStatusMsg, t]);

  const handleExportPreset = useCallback(() => {
    if (presetBank === 'virtual') { virt.exportAll(); return; }
    downloadJson({
      format: 'cubebabypreset', version: 1,
      preset: selectedPreset, knobs: knobValues,
      created: new Date().toISOString(),
    } as PresetFile, `cube-baby-${selectedPreset}.cubebabypreset`);
    setStatusMsg(t('status.exportedPreset', { name: selectedPreset }), 'success');
  }, [presetBank, selectedPreset, knobValues, setStatusMsg, t, virt.exportAll]);

  const handleExportBank = useCallback(() => {
    downloadJson({
      format: 'cubebabybank', version: 1,
      presets: { ...allKnobs, [selectedPreset]: knobValues },
      created: new Date().toISOString(),
    } as BankFile, 'cube-baby-bank.cubebabybank');
    setStatusMsg(t('status.exportedBank'), 'success');
  }, [allKnobs, selectedPreset, knobValues, setStatusMsg, t]);

  const handleImport = useCallback(async () => {
    if (presetBank === 'virtual') { await virt.importAll(); return; }
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
      setStatusMsg(t('status.importFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setImporting(false);
    }
  }, [presetBank, setStatusMsg, t, virt.importAll]);

  const handleKnobChange = useCallback((_name: string, _value: number) => {
    setKnobValues(prev => ({ ...prev, [_name]: _value }));
  }, []);

  const handleKnobChangeEnd = useCallback((name: string, value: number) => {
    if (!midiRef.current) return;
    undoRedo.pushUndo(currentUndoKey);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!midiRef.current) return;
      try { await midiRef.current.writeSingleKnob(name, value); } catch {}
    }, 50);
  }, [currentUndoKey, undoRedo.pushUndo]);

  // Undo/redo: handled by useUndoRedo hook (undo/redo)

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
      log(`Footswitch ${section} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [mode, knobValues, handleSelectPreset, log]);

  // IR handlers: handled by useIR hook

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) { setShowHelp(prev => !prev); return; }
      if (e.key === 'Escape') { setShowHelp(false); return; }
      if (connected && !connecting) {
        if (presetBank === 'hardware') {
          if (e.key === '1') { handleSelectPreset('A'); return; }
          if (e.key === '2') { handleSelectPreset('B'); return; }
          if (e.key === '3') { handleSelectPreset('C'); return; }
        }
        if (ctrlOrCmd && e.key === 's') { e.preventDefault(); handleSave(); return; }
        if (ctrlOrCmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo.undo(); return; }
        if (ctrlOrCmd && e.key === 'z' && e.shiftKey) { e.preventDefault(); undoRedo.redo(); return; }
        if (ctrlOrCmd && e.key === 'Z') { e.preventDefault(); undoRedo.redo(); return; }
        if (ctrlOrCmd && e.key === 'e') { e.preventDefault(); handleExportPreset(); return; }
        if (ctrlOrCmd && e.key === 'i') { e.preventDefault(); handleImport(); return; }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [connected, connecting, presetBank, handleSelectPreset, handleSave, undoRedo.undo, undoRedo.redo, handleExportPreset, handleImport]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
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
              virtualPresets={virt.presets}
              selectedVirtualPresetId={virt.selectedId}
              mode={mode}
              onSelectPreset={handleSelectVirtualPreset}
              onAddPreset={() => virt.add(knobValues)}
              onDeletePreset={virt.remove}
              onRenamePreset={virt.rename}
              onModeChange={setMode}
            />
          )}

          <div className="pedal-container">
            <Pedal
              model={cubeBabyModel}
              knobValues={{
                type: knobValues.type, gain: knobValues.gain, tone: knobValues.tone,
                mod: knobValues.mod, time: knobValues.time, fb: knobValues.fb,
                mix: knobValues.mix, reverb: knobValues.reverb, ir_cab: knobValues.ir_cab,
                volume: knobValues.volume,
              }}
              sections={{ A: knobValues.irSection, B: knobValues.delaySection, C: knobValues.toneSection }}
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
            saving={saving} loading={loading} importing={importing}
            undoCount={undoRedo.undoCount}
            redoCount={undoRedo.redoCount}
            presetBank={presetBank}
            handlers={{
              onSave: handleSave, onRevert: handleRevert,
              onUndo: undoRedo.undo, onRedo: undoRedo.redo,
              onExportPreset: handleExportPreset, onExportBank: handleExportBank,
              onImport: handleImport, onRefreshAll: handleRefreshAll,
              onFactoryReset: handleFactoryReset,
            }}
          />

          <IRSection
            irSlot={ir.irSlot} irName={ir.irName} irStatus={ir.irStatus} irProgress={ir.irProgress}
            irDistance={ir.irDistance} irFile={ir.irFile} irPreprocessed={ir.irPreprocessed}
            irNames={ir.irNames} connected={connected} open={ir.irLabOpen}
            onToggle={ir.setIrLabOpen}
            onSlotChange={ir.setIrSlot} onNameChange={ir.setIrName} onDistanceChange={ir.setIrDistance}
            handlers={{
              onSelectFile: ir.handleIRSelectFile, onUpload: ir.handleIRUpload,
              onDownloadBackup: ir.handleIRDownloadBackup,
              onLoadSlot: ir.handleIRLoadSlot,
              onDeleteName: ir.handleIRDeleteName,
            }}
          />

          <StatusBar status={status} statusType={statusType} />
          <button className="btn btn-xs" onClick={() => setShowHelp(true)} title={t('help.title')}>?</button>
          <HelpModal show={showHelp} onClose={() => setShowHelp(false)} />
          <DebugPanel showDebug={showDebug} debugLog={debugLog} connected={connected} onToggle={() => setShowDebug(v => !v)} onClear={() => setDebugLog([])} onScanIR={ir.handleIRScan} />
        </>
      )}

      {!connected && (
        <WelcomeScreen
          connecting={connecting} status={status} statusType={statusType}
          midiDevices={midiDevices} selectedMidiDeviceId={selectedMidiDeviceId}
          onConnect={handleConnect} onDeviceChange={setSelectedMidiDeviceId}
        />
      )}
    </div>
  );
}
