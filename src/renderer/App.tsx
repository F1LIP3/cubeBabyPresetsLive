import { useState, useCallback, useRef, useEffect } from 'react';
import { CubeBabyMidi } from '../midi/cubeBabyMidi';
import type { PresetName } from '../protocol/types';
import { PRESETS, IR_SLOT_COUNT } from '../protocol/types';
import { Pedal } from './components/Pedal';
import { settingsToKnobValues, knobValuesToSettings, KnobValues } from '../protocol';
import { processWavFile, irToBytes, padIrToRomBytes, irSummary, float32ToWav } from './irProcessor';
import { IR_ROM_SLOT_SIZE } from '../protocol/types';

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

  const setStatusMsg = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(msg);
    setStatusType(type);
  }, []);

  const log = useCallback((msg: string) => {
    setDebugLog(prev => [...prev, msg]);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setStatusMsg('Connecting...');
    try {
      const baby = new CubeBabyMidi();
      baby.onUnsolicited = (msg) => {
        log(`Unsolicited: ${JSON.stringify(msg)}`);
      };
      await baby.connect();
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
      setStatusMsg(`Connected! ${loadedCount}/3 presets loaded`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(`Connection failed: ${message}`, 'error');
    } finally {
      setConnecting(false);
    }
  }, [log, setStatusMsg]);

  const handleDisconnect = useCallback(() => {
    if (midiRef.current) {
      midiRef.current.disconnect();
      midiRef.current = null;
    }
    setConnected(false);
    setKnobValues(EMPTY_KNOBS);
    setAllKnobs({ A: EMPTY_KNOBS, B: EMPTY_KNOBS, C: EMPTY_KNOBS });
    setStatusMsg('Disconnected');
  }, [setStatusMsg]);

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
    setStatusMsg(`Switched to preset ${preset}`, 'info');
  }, [allKnobs, setStatusMsg, log]);

  const handleSave = useCallback(async () => {
    if (!midiRef.current) return;
    setSaving(true);
    setStatusMsg(`Saving preset ${selectedPreset}...`);
    try {
      const settings = knobValuesToSettings(knobValues);
      await midiRef.current.saveActivePresetToSlot(selectedPreset, settings);
      setAllKnobs(prev => ({ ...prev, [selectedPreset]: knobValues }));
      setStatusMsg(`Preset ${selectedPreset} saved to pedal!`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(`Save failed: ${message}`, 'error');
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
    setStatusMsg(`Exported preset ${selectedPreset}`, 'success');
  }, [selectedPreset, knobValues, setStatusMsg]);

  const handleExportBank = useCallback(() => {
    const file: BankFile = {
      format: 'cubebabybank',
      version: 1,
      presets: { ...allKnobs, [selectedPreset]: knobValues },
      created: new Date().toISOString(),
    };
    downloadJson(file, 'cube-baby-bank.cubebabybank');
    setStatusMsg('Exported all presets as bank', 'success');
  }, [allKnobs, selectedPreset, knobValues, setStatusMsg]);

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
        setStatusMsg(`Imported ${target} and sent to pedal!`, 'success');
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
        setStatusMsg('Imported bank! All presets sent to pedal', 'success');
      } else {
        setStatusMsg('Unknown file format', 'error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(`Import failed: ${message}`, 'error');
    } finally {
      setImporting(false);
    }
  }, [setStatusMsg]);

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
      setStatusMsg('All presets refreshed from pedal', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMsg(`Refresh failed: ${message}`, 'error');
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!midiRef.current) return;
      try {
        await midiRef.current.writeSingleKnob(name, value);
      } catch {
        // Write may fail if pedal isn't in the right mode
      }
    }, 200);
  }, []);

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
            <h1>Cube Baby</h1>
            <span className={`app-badge ${mode}`}>{mode.toUpperCase()}</span>
          </div>
          <div className="app-header-sub">Preset Editor</div>
        </div>
        <div className="app-header-right">
          <div className="status-indicator-mini">
            <span className={`status-dot-mini ${connected ? 'on' : 'off'}`} />
            <span className="status-text-mini">{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          </div>
          {!connected ? (
            <button className="btn-connect" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button className="btn-disconnect" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      {connected && (
        <>
          <div className="preset-bar">
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
                PRESET
              </button>
              <button
                className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
                onClick={() => setMode('live')}
              >
                LIVE
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
            <button className="btn btn-primary btn-xs" onClick={handleSave} disabled={saving || loading} title="Save current settings to pedal slot">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleExportPreset} title="Export current preset as file">
              Export
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleExportBank} title="Export all 3 presets as bank file">
              Bank
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleImport} disabled={importing} title="Import preset or bank from file">
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleRefreshAll} title="Re-read all presets from pedal">
              Refresh
            </button>
          </div>

          <details className="ir-lab" open>
            <summary className="ir-lab-summary">
              <span className="ir-lab-toggle">▼</span>
              Custom IR Upload
            </summary>
            <div className="ir-lab-content">
              <div className="ir-upload-section">
                <div className="ir-upload-row">
                  <button className="btn btn-xs btn-primary" onClick={handleIRSelectFile} disabled={irStatus === 'processing'}>
                    {irFile ? 'Change File' : 'Select .wav File'}
                  </button>
                  <span className="ir-file-name">{irFile ? irFile.name : 'No file selected'}</span>
                </div>
                {irPreprocessed && (
                  <div className="ir-upload-preview">
                    <span className="ir-preview-text">Processed: 512 samples, peak {Math.max(...Array.from(irPreprocessed).map(Math.abs)).toFixed(3)}</span>
                  </div>
                )}
                <div className="ir-upload-row">
                  <label className="ir-label">Slot:</label>
                  <select className="ir-select" value={irSlot} onChange={e => setIrSlot(Number(e.target.value))} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'}>
                    {Array.from({ length: IR_SLOT_COUNT }, (_, i) => (
                      <option key={i} value={i}>Slot {i + 1}{irNames[i] ? ` — ${irNames[i]}` : ''}</option>
                    ))}
                  </select>
                  <button className="btn btn-xs" onClick={handleIRDownloadBackup} disabled={!midiRef.current || irStatus === 'processing' || irStatus === 'writing'} title="Download current slot data as backup">
                    Backup
                  </button>
                </div>
                <div className="ir-upload-row">
                  <label className="ir-label">Dist:</label>
                  <input className="ir-range" type="range" min="0" max="1" step="0.01" value={irDistance} onChange={e => setIrDistance(parseFloat(e.target.value))} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'} />
                  <span className="ir-range-value">{irDistance.toFixed(2)}</span>
                </div>
                <div className="ir-upload-row">
                  <label className="ir-label">Name:</label>
                  <input className="ir-input" type="text" value={irName} onChange={e => setIrName(e.target.value)} placeholder={`Custom IR ${irSlot + 1}`} maxLength={32} disabled={irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'} />
                </div>
                <div className="ir-upload-row">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleIRUpload}
                    disabled={!irPreprocessed || !midiRef.current || irStatus === 'processing' || irStatus === 'writing' || irStatus === 'erasing'}
                  >
                    {irStatus === 'erasing' ? 'Erasing...' :
                     irStatus === 'writing' ? `${Math.round(irProgress.current / irProgress.total * 100)}%` :
                     irStatus === 'verifying' ? 'Verifying...' :
                     irStatus === 'done' ? 'Uploaded!' :
                     'Upload to Pedal'}
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
                    <div key={i} className="ir-name-entry" onClick={() => handleIRLoadSlot(i)} title="Click to load to RAM">
                      <span className="ir-name-slot">Slot {i + 1}</span>
                      <span className="ir-name-label">{irNames[i]}</span>
                      <button className="btn btn-xs btn-danger" onClick={e => { e.stopPropagation(); const u = { ...irNames }; delete u[i]; saveIrNames(u); }} title="Remove name">✕</button>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>
          </details>

          <div className="status-msg">
            <span className={`status-msg-dot ${statusType}`} />
            <span>{status || 'Ready'}</span>
          </div>

          <button className="btn btn-xs" onClick={() => setShowHelp(true)} title="Help & About">?</button>
          {showHelp && (
            <div className="help-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
              <div className="help-modal">
                <button className="btn btn-xs btn-danger" onClick={() => setShowHelp(false)} title="Close">?</button>
                <h2>Cube Baby Presets Live</h2>
                <p className="help-desc">Cross-platform editor for the SINCO / Cuvave Cube Baby multi-FX guitar pedal.</p>
                
                <h3>Features</h3>
                <ul className="help-features">
                  <li>Edit all 10 preset parameters (Type, Gain, Tone, Reverb, Feedback, Volume, Time, Mix, Modulation, Cabinet)</li>
                  <li>Read/write presets A/B/C with live sync</li>
                  <li>Toggle IR, Delay, and Tone sections independently</li>
                  <li>Upload custom impulse responses (IR) to RAM or ROM</li>
                  <li>Export/import presets as JSON files</li>
                  <li>Backup/restore factory cabinet IRs</li>
                </ul>
                
                <h3>IR Upload</h3>
                <p>Upload custom WAV files as impulse responses:</p>
                <ul className="help-features">
                  <li>Auto-resampled to 48kHz</li>
                  <li>Normalized to peak 1.0</li>
                  <li>Up to 512 samples (RAM) or 1024 samples (ROM)</li>
                  <li>9 persistent IR slots with header flags</li>
                </ul>
                
                <h3>Protocol</h3>
                <p>Uses the reverse-engineered SysEx protocol from <a href="https://github.com/pferreir/cuvave-midi" target="_blank" rel="noopener noreferrer">pferreir/cuvave-midi</a>.</p>
                <p>See <code>knowledge_base.md</code> for detailed protocol documentation.</p>
                
                <h3>Hardware</h3>
                <p>Requires a USB MIDI interface connected to the Cube Baby pedal. On Android, you'll need a USB OTG cable and USB-MIDI adapter.</p>
                
                <h3>Version</h3>
                <p>v0.1.0 ? MIT License</p>
              </div>
            </div>
          )}
                    <details className="debug-section">
            <summary className="debug-summary" onClick={(e) => { e.preventDefault(); setShowDebug(!showDebug); }}>
              <span className="debug-toggle">{showDebug ? '▼' : '▶'}</span>
              Debug Log {debugLog.length > 0 && `(${debugLog.length})`}
            </summary>
            <div className="debug-content">
              <div className="debug-actions">
                <button className="btn btn-xs btn-danger" onClick={() => setDebugLog([])}>Clear</button>
                <button className="btn btn-xs btn-secondary" onClick={handleIRScan} disabled={!connected}>Scan IR</button>
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
          <h2>Cube Baby Presets</h2>
          <p>Connect your Cuvave/Cube Baby pedal via USB MIDI to edit, save, and share presets.</p>
          <ul className="welcome-features">
            <li>Edit all 10 parameters in real-time</li>
            <li>Save presets to pedal slots A/B/C</li>
            <li>Export/import presets as shareable files</li>
            <li>Toggle IR, Delay, and Tone sections on/off</li>
          </ul>
          <button className="btn-connect btn-connect-large" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Connecting...' : 'Connect'}
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
