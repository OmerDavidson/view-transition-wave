import { PALETTES as CORE_PALETTES } from 'distortion-wave/src/core.js';
import type { PaletteName } from './types';

export { waveTransition, prepareWaveTransition, isWaveTransitionSupported } from './transition';
export type { UpdateCallback } from './transition';
export type {
  PaletteName,
  Point,
  WaveOrigin,
  WaveShape,
  WaveTransition,
  WaveTransitionOptions,
  WaveTuning,
} from './types';

/** The named palettes, as hex colours. */
export const PALETTES: Readonly<Record<PaletteName, readonly string[]>> = CORE_PALETTES;
