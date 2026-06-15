import type { PresetName } from '../protocol/types';
import type { KnobValues } from '../protocol';

export interface PresetFile {
  format: 'cubebabypreset';
  version: 1;
  preset: PresetName;
  knobs: KnobValues;
  created: string;
}

export interface BankFile {
  format: 'cubebabybank';
  version: 1;
  presets: Record<PresetName, KnobValues>;
  created: string;
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadFile(): Promise<string> {
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
