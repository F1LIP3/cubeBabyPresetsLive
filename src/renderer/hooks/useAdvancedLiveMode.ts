import { useState, useCallback, useMemo } from 'react';
import type { KnobValues } from '../../protocol';
import type { PedalId, PedalParameters, AdvancedLiveState } from '../types';

export function computeKnobValues(
  pedalStates: Record<PedalId, boolean>,
  pedalParams: PedalParameters
): KnobValues {
  let mod = 7;
  if (pedalStates.chorus) mod = 6 - Math.max(0, Math.min(6, pedalParams.chorus.level));
  else if (pedalStates.phaser) mod = 9 + Math.max(0, Math.min(6, pedalParams.phaser.level));
  return {
    type: pedalStates.amp ? pedalParams.amp.type : 0,
    gain: pedalStates.amp ? pedalParams.amp.gain : 0,
    tone: pedalStates.amp ? pedalParams.amp.tone : 0,
    mod,
    time: pedalParams.delay.time,
    fb: pedalParams.delay.fb,
    mix: pedalStates.delay ? pedalParams.delay.mix : 0,
    reverb: pedalStates.reverb ? pedalParams.reverb.reverb : 0,
    ir_cab: pedalStates.ircab ? pedalParams.ircab.slot : 0,
    volume: pedalParams.volume.level,
    irSection: pedalStates.reverb || pedalStates.ircab,
    delaySection: pedalStates.chorus || pedalStates.phaser,
    toneSection: pedalStates.amp,
  };
}

function extractParams(knobs: KnobValues): PedalParameters {
  const chorusOn = knobs.mod >= 0 && knobs.mod <= 6;
  const phaserOn = knobs.mod >= 9;
  return {
    amp: { type: knobs.type, gain: knobs.gain, tone: knobs.tone },
    chorus: { level: chorusOn ? 6 - knobs.mod : 0 },
    phaser: { level: phaserOn ? knobs.mod - 9 : 0 },
    delay: { time: knobs.time, fb: knobs.fb, mix: knobs.mix },
    reverb: { reverb: knobs.reverb },
    ircab: { slot: knobs.ir_cab },
    volume: { level: knobs.volume },
  };
}

const STOMPABLE: Record<PedalId, boolean> = {
  amp: true,
  chorus: true,
  phaser: true,
  delay: true,
  reverb: true,
  ircab: true,
  volume: false,
};

function defaultPedalStates(): Record<PedalId, boolean> {
  return {
    amp: true, chorus: true, phaser: false, delay: true, reverb: true,
    ircab: true, volume: true,
  };
}

function pedalStatesFromKnobs(knobs: KnobValues): Record<PedalId, boolean> {
  const mod = knobs.mod;
  return {
    amp: knobs.toneSection || knobs.type > 0 || knobs.gain > 0 || knobs.tone > 0,
    chorus: mod >= 0 && mod <= 6,
    phaser: mod >= 9,
    delay: knobs.mix > 0,
    reverb: knobs.reverb > 0,
    ircab: knobs.ir_cab > 0,
    volume: true,
  };
}

export function useAdvancedLiveMode(initialKnobValues: KnobValues) {
  const [state, setState] = useState<AdvancedLiveState>(() => ({
    pedalStates: pedalStatesFromKnobs(initialKnobValues),
    pedalParams: extractParams(initialKnobValues),
  }));

  const effectiveKnobValues = useMemo((): KnobValues => {
    return computeKnobValues(state.pedalStates, state.pedalParams);
  }, [state]);

  const togglePedal = useCallback((id: PedalId) => {
    if (!STOMPABLE[id]) return;
    setState((prev: AdvancedLiveState) => {
      const newStates = { ...prev.pedalStates, [id]: !prev.pedalStates[id] };
      if (id === 'chorus' && newStates.chorus) newStates.phaser = false;
      if (id === 'phaser' && newStates.phaser) newStates.chorus = false;
      return { ...prev, pedalStates: newStates };
    });
  }, []);

  const setPedalParam = useCallback(<K extends keyof PedalParameters>(
    pedal: K,
    param: keyof PedalParameters[K],
    value: number
  ) => {
    setState((prev: AdvancedLiveState) => ({
      ...prev,
      pedalParams: {
        ...prev.pedalParams,
        [pedal]: { ...prev.pedalParams[pedal], [param]: value as any },
      },
    }));
  }, []);

  const resetFromKnobs = useCallback((knobs: KnobValues) => {
    setState({
      pedalStates: pedalStatesFromKnobs(knobs),
      pedalParams: extractParams(knobs),
    } satisfies AdvancedLiveState);
  }, []);

  return {
    state,
    pedalStates: state.pedalStates,
    pedalParams: state.pedalParams,
    effectiveKnobValues,
    togglePedal,
    setPedalParam,
    resetFromKnobs,
  };
}
