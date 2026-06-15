import type { PresetName } from '../protocol/types';
import type { KnobValues } from '../protocol';

export interface ToolbarHandlers {
  onSave: () => void;
  onRevert: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportPreset: () => void;
  onExportBank: () => void;
  onImport: () => void;
  onRefreshAll: () => void;
  onFactoryReset: () => void;
}

export interface IRSectionHandlers {
  onSelectFile: () => void;
  onUpload: () => void;
  onDownloadBackup: () => void;
  onLoadSlot: (slot: number) => void;
  onDeleteName: (slot: number) => void;
}

export interface AppHandlers {
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectPreset: (preset: PresetName) => void;
  onModeChange: (mode: 'live' | 'preset') => void;
  onIRFileSelected: (file: File) => void;
}

export interface VirtualPreset {
  id: string;
  name: string;
  knobs: KnobValues;
  created: string;
  updated: string;
}

export type PresetBank = 'hardware' | 'virtual';

export interface VirtualPresetHandlers {
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExportAll: () => void;
  onImport: () => void;
}
