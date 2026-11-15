// distortion-wave's DOM-free core (config, timeline, particles), which ships untyped.
// Only what this package uses is declared.
declare module 'distortion-wave/src/core.js' {
  export interface WaveConfig {
    type: 'vertical' | 'horizontal' | 'center';
    k: number;
    anticipation: number;
    travel: number;
    amplitude: number;
    lensWidth: number;
    /** How far the front wobbles, in px. */
    swell: number;
    /** How far past the farthest corner the front travels, in px. */
    margin: number;
    aberration: number;
    blur: number;
    blurAhead: number;
    blurBehind: number;
    lead: number;
    tail: number;
    band: number;
    rimWidth: number;
    rimSoftness: number;
    uneven: number;
    hairWidth: number;
    seam: number;
    particles: number;
    palette: string | string[];
  }

  export interface WaveGeometry {
    w: number;
    h: number;
    src: { x: number; y: number; w: number; h: number };
    touch: { x: number; y: number } | null;
    hold: boolean;
  }

  export interface WaveFrame {
    time: number;
    fly: number;
    prog: number;
    ring: boolean;
    r0: number;
    ox: number;
    oy: number;
    tilt: number;
    squash: number;
    spine: number;
    radius: number;
    swell: number;
    energy: number;
    pull: number;
    glow: number;
    clear: number;
    hairClear: number;
    rim: number;
    hold: number;
    launched: boolean;
    covered: boolean;
    settled: boolean;
  }

  export interface WaveParticle {
    size: number;
  }

  export const BASE: Record<string, unknown>;
  export const PRESETS: Record<'vertical' | 'horizontal' | 'center', Record<string, unknown>>;
  export const PALETTES: Record<'aurora' | 'ocean' | 'mint' | 'ember', string[]>;
  export function resolveConfig(
    preset: Record<string, unknown>,
    options: Record<string, unknown>,
    width: number,
    height: number,
  ): WaveConfig;
  export function scaleConfig(config: Record<string, unknown>, width: number, height: number): Record<string, unknown>;
  export function frameState(time: number, config: WaveConfig, geometry: WaveGeometry): WaveFrame;
  export function totalDuration(config: WaveConfig): number;
  export function makeParticles(count: number, config: WaveConfig): WaveParticle[];
  export function particleAt(
    particle: WaveParticle,
    frame: WaveFrame,
    config: WaveConfig,
  ): { x: number; y: number; a: number } | null;
  export function hexToOklab(hex: string): [number, number, number];
}
