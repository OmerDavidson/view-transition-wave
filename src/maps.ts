import type { WaveConfig } from 'distortion-wave/src/core.js';

/**
 * Displacement maps for the SVG filter, drawn once as images (`feImage` can't point at an in-page SVG
 * element under a view transition). The profiles are distortion-wave's own (`renderer.js`, MIT © Lucas
 * Bonomi): its lens and blur depend on the distance to the front in px, not on the front's radius, so the
 * lens is drawn for a ladder of radii and the filter stretches the nearest one.
 *
 * Channels: red and green hold a direction (128 = none), scaled by the profile; blue holds where the
 * page is blurred (0 = sharp).
 */

/** Side, in px, of one map. The profiles are broad, so it stays smooth stretched over a window. */
const MAP_SIZE = 160;
/** Each lens map's radius is this much bigger than the last: the stretch between two is at most ±10%. */
const BUCKET_RATIO = 1.2;
const SMALLEST_RADIUS = 6;

export interface LensMap {
  /** The front's radius the map was drawn for, in px. */
  radius: number;
  /** The map's half-width, in px, at that radius. */
  half: number;
  url: string;
}

export interface WaveMaps {
  lenses: LensMap[];
  /** The inhale's pull toward the source, independent of the front. */
  pull: { half: number; url: string };
}

type Paint = (offsetX: number, offsetY: number) => [number, number, number, number];

const paintMap = (half: number, paint: Paint): string => {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }
  const pixels = context.createImageData(MAP_SIZE, MAP_SIZE);
  const texel = (2 * half) / MAP_SIZE;
  for (let row = 0; row < MAP_SIZE; row += 1) {
    for (let column = 0; column < MAP_SIZE; column += 1) {
      pixels.data.set(paint((column + 0.5) * texel - half, (row + 0.5) * texel - half), (row * MAP_SIZE + column) * 4);
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
};

const direction = (offsetX: number, offsetY: number, strength: number): [number, number] => {
  const length = Math.hypot(offsetX, offsetY) || 1;
  return [128 + 127 * strength * (offsetX / length), 128 + 127 * strength * (offsetY / length)];
};

/** The bulge around a front of `radius`: `exp(-k²)`, narrower ahead of the front than behind it. */
const lensMap = (radius: number, config: WaveConfig): LensMap => {
  const half = radius + 3 * Math.max(config.lensWidth * 0.8, config.blurAhead);
  const url = paintMap(half, (offsetX, offsetY) => {
    const past = Math.hypot(offsetX, offsetY) - radius;
    const lens = past / (config.lensWidth * (past > 0 ? 0.8 : 1.6));
    const blur = past / (past > 0 ? config.blurAhead : config.blurBehind);
    const [red, green] = direction(offsetX, offsetY, Math.exp(-lens * lens));
    return [red, green, 255 * Math.exp(-blur * blur), 255];
  });
  return { radius, half, url };
};

/** The inhale: everything slides toward the source, hardest a little way out from it. */
const pullMap = (config: WaveConfig) => {
  const half = 700 * config.k * 4;
  const url = paintMap(half, (offsetX, offsetY) => {
    const distance = Math.max(Math.hypot(offsetX, offsetY), 1);
    const strength = (distance / (distance + 60 * config.k)) * Math.exp(-distance / (700 * config.k));
    const [red, green] = direction(offsetX, offsetY, strength);
    return [red, green, 0, 255];
  });
  return { half, url };
};

let cached: { key: string; maps: WaveMaps } | undefined;

/** Draws (once per scope size and config) every map the wave needs, up to a front of `reach` px. */
export const waveMaps = (config: WaveConfig, reach: number): WaveMaps => {
  const key = `${config.k}:${config.lensWidth}:${config.blurAhead}:${config.blurBehind}:${Math.ceil(reach)}`;
  if (cached?.key === key) {
    return cached.maps;
  }
  const lenses: LensMap[] = [];
  for (let radius = SMALLEST_RADIUS; radius < reach * BUCKET_RATIO; radius *= BUCKET_RATIO) {
    lenses.push(lensMap(radius, config));
  }
  const maps = { lenses, pull: pullMap(config) };
  cached = { key, maps };
  return maps;
};

/** The lens map drawn for the radius nearest `radius` (on a log scale). */
export const nearestLens = (lenses: LensMap[], radius: number): number => {
  let best = 0;
  lenses.forEach((lens, index) => {
    if (Math.abs(Math.log(lens.radius / radius)) < Math.abs(Math.log(lenses[best].radius / radius))) {
      best = index;
    }
  });
  return best;
};
