import { useState, useCallback, useMemo, useEffect } from 'react';
import type { KnobValues } from '../../protocol';
import type { VirtualPreset } from '../types';
import { downloadJson, loadFile } from '../helpers';
import { EMPTY_KNOBS } from '../constants';

let nextVirtualId = 1;

function getDefaults(): VirtualPreset[] {
  const now = new Date().toISOString();
  return [
    { id: 'vp_1', name: 'Clean', knobs: { type: 0, gain: 2, tone: 8, mod: 0, time: 8, fb: 0, mix: 40, reverb: 8, ir_cab: 0, volume: 100, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
    { id: 'vp_2', name: 'Crunch', knobs: { type: 3, gain: 5, tone: 10, mod: 0, time: 8, fb: 0, mix: 40, reverb: 6, ir_cab: 0, volume: 100, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
    { id: 'vp_3', name: 'Lead', knobs: { type: 5, gain: 7, tone: 12, mod: 4, time: 20, fb: 35, mix: 50, reverb: 10, ir_cab: 0, volume: 110, irSection: true, delaySection: true, toneSection: true }, created: now, updated: now },
  ];
}

function loadPresets(): VirtualPreset[] {
  try {
    const saved = localStorage.getItem('virtualPresets');
    if (saved) {
      const parsed = JSON.parse(saved) as VirtualPreset[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach(p => {
          const num = parseInt(p.id.replace('vp_', ''));
          if (num >= nextVirtualId) nextVirtualId = num + 1;
        });
        return parsed;
      }
    }
  } catch {}
  nextVirtualId = 4;
  return getDefaults();
}

function loadSelectedId(presets: VirtualPreset[]): string | null {
  try {
    const saved = localStorage.getItem('selectedVirtualPresetId');
    if (saved && presets.some(p => p.id === saved)) return saved;
  } catch {}
  return presets.length > 0 ? presets[0].id : null;
}

export interface VirtualPresetActions {
  presets: VirtualPreset[];
  selectedId: string | null;
  current: VirtualPreset | undefined;
  count: number;
  select: (id: string) => void;
  add: (knobs: KnobValues) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  updateKnobs: (id: string, knobs: KnobValues) => void;
  exportAll: () => void;
  importAll: () => Promise<void>;
}

export function useVirtualPresets(currentKnobs: KnobValues): VirtualPresetActions {
  const [initialPresets] = useState(loadPresets);
  const [presets, setPresets] = useState<VirtualPreset[]>(initialPresets);
  const [selectedId, setSelectedId] = useState<string | null>(() => loadSelectedId(initialPresets));

  useEffect(() => { localStorage.setItem('virtualPresets', JSON.stringify(presets)); }, [presets]);
  useEffect(() => { if (selectedId) localStorage.setItem('selectedVirtualPresetId', selectedId); }, [selectedId]);

  // Sync selectedId with presets array (handles deletion edge cases)
  useEffect(() => {
    if (presets.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !presets.some(p => p.id === selectedId)) {
      setSelectedId(presets[0].id);
    }
  }, [presets, selectedId]);

  const current = useMemo(() => presets.find(p => p.id === selectedId), [presets, selectedId]);

  const select = useCallback((id: string) => { setSelectedId(id); }, []);

  const add = useCallback((knobs: KnobValues) => {
    const now = new Date().toISOString();
    const id = `vp_${nextVirtualId++}`;
    setPresets(prev => {
      if (prev.length >= 50) return prev;
      return [...prev, {
        id, name: `Preset ${prev.length + 1}`, knobs: { ...knobs },
        created: now, updated: now,
      }];
    });
    setSelectedId(id);
  }, []);

  const remove = useCallback((id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, name, updated: new Date().toISOString() } : p
    ));
  }, []);

  const updateKnobs = useCallback((id: string, knobs: KnobValues) => {
    setPresets(prev => prev.map(p =>
      p.id === id ? { ...p, knobs, updated: new Date().toISOString() } : p
    ));
  }, []);

  const exportAll = useCallback(() => {
    const file = {
      format: 'cubebabyvirtualbank',
      version: 1,
      presets,
      created: new Date().toISOString(),
    };
    downloadJson(file, 'cube-baby-virtual-presets.json');
  }, [presets]);

  const importAll = useCallback(async () => {
    try {
      const text = await loadFile();
      const data = JSON.parse(text);
      if (data.format !== 'cubebabyvirtualbank' || !Array.isArray(data.presets)) throw new Error('Invalid format');
      const imported = data.presets as VirtualPreset[];
      setPresets(prev => {
        if (imported.length + prev.length > 50) return prev;
        const merged = [...prev];
        for (const vp of imported) {
          merged.push({ ...vp, id: `vp_${nextVirtualId++}` });
        }
        return merged;
      });
    } catch {}
  }, []);

  return {
    presets, selectedId, current, count: presets.length,
    select, add, remove, rename, updateKnobs,
    exportAll, importAll,
  };
}
