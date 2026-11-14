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

/** Writes the red, green, blue and alpha of the pixel `offsetX, offsetY` px from the map's centre at `at`. */
type Paint = (offsetX: number, offsetY: number, out: Uint8ClampedArray, at: number) => void;

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
    const offsetY = (row + 0.5) * texel - half;
    for (let column = 0; column < MAP_SIZE; column += 1) {
      paint((column + 0.5) * texel - half, offsetY, pixels.data, (row * MAP_SIZE + column) * 4);
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
};

/** Writes a direction (red, green; 128 = none) scaled by `strength`, then `blue` and an opaque alpha. */
const writeDirection = (
  offsetX: number,
  offsetY: number,
  strength: number,
  blue: number,
  out: Uint8ClampedArray,
  at: number,
) => {
  const length = Math.sqrt(offsetX * offsetX + offsetY * offsetY) || 1;
  out[at] = 128 + (127 * strength * offsetX) / length;
  out[at + 1] = 128 + (127 * strength * offsetY) / length;
  out[at + 2] = blue;
  out[at + 3] = 255;
};

/** The bulge around a front of `radius`: `exp(-k²)`, narrower ahead of the front than behind it. */
const lensMap = (radius: number, config: WaveConfig): LensMap => {
  const half = radius + 3 * Math.max(config.lensWidth * 0.8, config.blurAhead);
  const ahead = config.lensWidth * 0.8;
  const behind = config.lensWidth * 1.6;
  const url = paintMap(half, (offsetX, offsetY, out, at) => {
    const past = Math.sqrt(offsetX * offsetX + offsetY * offsetY) - radius;
    const lens = past / (past > 0 ? ahead : behind);
    const blur = past / (past > 0 ? config.blurAhead : config.blurBehind);
    writeDirection(offsetX, offsetY, Math.exp(-lens * lens), 255 * Math.exp(-blur * blur), out, at);
  });
  return { radius, half, url };
};

/** The inhale: everything slides toward the source, hardest a little way out from it. */
const pullMap = (config: WaveConfig) => {
  const half = 700 * config.k * 4;
  const url = paintMap(half, (offsetX, offsetY, out, at) => {
    const distance = Math.max(Math.sqrt(offsetX * offsetX + offsetY * offsetY), 1);
    const strength = (distance / (distance + 60 * config.k)) * Math.exp(-distance / (700 * config.k));
    writeDirection(offsetX, offsetY, strength, 0, out, at);
  });
  return { half, url };
};

/** Configs whose maps are kept: one per scope size and shape in use. */
const CACHED_CONFIGS = 6;
const cache = new Map<string, WaveMaps>();
/** Each map's decode, by URL. */
const decoded = new Map<string, Promise<void>>();

/**
 * Every map the wave needs, up to a front of `reach` px. The maps depend on the config (the scope's size
 * and the shape), not on where the wave starts, so they're drawn once per config and kept: the ladder of
 * lens maps only grows when a front reaches farther than before.
 */
export const waveMaps = (config: WaveConfig, reach: number): WaveMaps => {
  const key = `${config.k}:${config.lensWidth}:${config.blurAhead}:${config.blurBehind}`;
  let maps = cache.get(key);
  if (maps) {
    // Most recently used last, so the oldest is the one dropped.
    cache.delete(key);
  } else {
    maps = { lenses: [], pull: pullMap(config) };
    if (cache.size >= CACHED_CONFIGS) {
      const oldest = cache.keys().next().value as string;
      const dropped = cache.get(oldest);
      dropped && [dropped.pull.url, ...dropped.lenses.map(lens => lens.url)].forEach(url => decoded.delete(url));
      cache.delete(oldest);
    }
  }
  cache.set(key, maps);
  const { lenses } = maps;
  let radius = lenses.length ? lenses[lenses.length - 1].radius * BUCKET_RATIO : SMALLEST_RADIUS;
  for (; radius < reach * BUCKET_RATIO; radius *= BUCKET_RATIO) {
    lenses.push(lensMap(radius, config));
  }
  const count = lenses.findIndex(lens => lens.radius >= reach * BUCKET_RATIO);
  return { lenses: count < 0 ? lenses : lenses.slice(0, count), pull: maps.pull };
};

/**
 * Resolves once every map is decoded. The filter's `feImage`s load their maps asynchronously: drawn
 * before that, a map is missing and the filter's result is empty for a frame, which shows as black.
 */
export const decodeMaps = (maps: WaveMaps): Promise<void> =>
  Promise.all(
    [maps.pull.url, ...maps.lenses.map(lens => lens.url)].map(url => {
      let done = decoded.get(url);
      if (!done) {
        const image = new Image();
        image.src = url;
        done = (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).catch(() => undefined);
        decoded.set(url, done);
      }
      return done;
    }),
  ).then(() => undefined);

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
