import { useState, useCallback, useEffect, useRef } from 'react';
import type { KnobValues } from '../../protocol';
import type { CubeBabyMidi } from '../../midi/cubeBabyMidi';

const MAX_UNDO_DEPTH = 30;

export interface UndoRedoActions {
  undoStack: Record<string, KnobValues[]>;
  redoStack: Record<string, KnobValues[]>;
  undoCount: number;
  redoCount: number;
  pushUndo: (key: string) => void;
  undo: () => void;
  redo: () => void;
}

function loadUndoStack(): Record<string, KnobValues[]> {
  const hw: Record<string, KnobValues[]> = { A: [], B: [], C: [] };
  const saved = localStorage.getItem('virtUndoStack');
  if (saved) try { return { ...hw, ...JSON.parse(saved) }; } catch {}
  return hw;
}

function loadRedoStack(): Record<string, KnobValues[]> {
  const hw: Record<string, KnobValues[]> = { A: [], B: [], C: [] };
  const saved = localStorage.getItem('virtRedoStack');
  if (saved) try { return { ...hw, ...JSON.parse(saved) }; } catch {}
  return hw;
}

function persistStacks(undoStack: Record<string, KnobValues[]>, redoStack: Record<string, KnobValues[]>) {
  const virtUndo: Record<string, KnobValues[]> = {};
  const virtRedo: Record<string, KnobValues[]> = {};
  for (const [k, v] of Object.entries(undoStack)) {
    if (k !== 'A' && k !== 'B' && k !== 'C') virtUndo[k] = v;
  }
  for (const [k, v] of Object.entries(redoStack)) {
    if (k !== 'A' && k !== 'B' && k !== 'C') virtRedo[k] = v;
  }
  if (Object.keys(virtUndo).length) localStorage.setItem('virtUndoStack', JSON.stringify(virtUndo));
  if (Object.keys(virtRedo).length) localStorage.setItem('virtRedoStack', JSON.stringify(virtRedo));
}

export function useUndoRedo(
  knobValues: KnobValues,
  currentUndoKey: string,
  midiRef: React.MutableRefObject<CubeBabyMidi | null>,
  setKnobValues: React.Dispatch<React.SetStateAction<KnobValues>>,
): UndoRedoActions {
  const [undoStack, setUndoStack] = useState<Record<string, KnobValues[]>>(loadUndoStack);
  const [redoStack, setRedoStack] = useState<Record<string, KnobValues[]>>(loadRedoStack);
  const knobRef = useRef(knobValues);
  knobRef.current = knobValues;

  useEffect(() => { persistStacks(undoStack, redoStack); }, [undoStack, redoStack]);

  const pushUndo = useCallback((key: string) => {
    setUndoStack(prev => {
      const stack = prev[key] || [];
      return { ...prev, [key]: [...stack.slice(-(MAX_UNDO_DEPTH - 1)), knobRef.current] };
    });
    setRedoStack(prev => ({ ...prev, [key]: [] }));
  }, []);

  const writeKnobs = useCallback((knobs: KnobValues) => {
    if (!midiRef.current) return;
    const paramNames = Object.keys(knobs).filter(
      k => k !== 'irSection' && k !== 'delaySection' && k !== 'toneSection'
    );
    for (const param of paramNames) {
      midiRef.current.writeSingleKnob(param, knobs[param as keyof KnobValues] as number).catch(() => {});
    }
  }, [midiRef]);

  const undo = useCallback(() => {
    const stack = undoStack[currentUndoKey] || [];
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setUndoStack(prevStack => {
      const s = prevStack[currentUndoKey] || [];
      return { ...prevStack, [currentUndoKey]: s.slice(0, -1) };
    });
    setRedoStack(prevStack => ({
      ...prevStack,
      [currentUndoKey]: [...(prevStack[currentUndoKey] || []), knobRef.current],
    }));
    setKnobValues(prev);
    writeKnobs(prev);
  }, [currentUndoKey, undoStack, setKnobValues, writeKnobs]);

  const redo = useCallback(() => {
    const stack = redoStack[currentUndoKey] || [];
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack(prevStack => {
      const s = prevStack[currentUndoKey] || [];
      return { ...prevStack, [currentUndoKey]: s.slice(0, -1) };
    });
    setUndoStack(prevStack => ({
      ...prevStack,
      [currentUndoKey]: [...(prevStack[currentUndoKey] || []), knobRef.current],
    }));
    setKnobValues(next);
    writeKnobs(next);
  }, [currentUndoKey, redoStack, setKnobValues, writeKnobs]);

  return {
    undoStack,
    redoStack,
    undoCount: undoStack[currentUndoKey]?.length || 0,
    redoCount: redoStack[currentUndoKey]?.length || 0,
    pushUndo,
    undo,
    redo,
  };
}
