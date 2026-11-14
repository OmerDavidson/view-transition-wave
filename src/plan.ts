import {
  PRESETS,
  frameState,
  resolveConfig,
  totalDuration,
  type WaveConfig,
  type WaveFrame,
  type WaveGeometry,
} from 'distortion-wave/src/core.js';
import type { WaveOrigin, WaveTransitionOptions } from './types';

/**
 * Everything decided before the wave starts: the scope's box, where the wave leaves from and the
 * resolved config. Coordinates are in px from the scope's top-left corner, which is also the space the
 * view transition's snapshots, the SVG filter and the light all draw in.
 */

/**
 * How far, in px, the snapshots' boxes reach past the scope's while the wave plays: a snapshot includes
 * what overflows the scope (a shadow), which the masks would otherwise cut off.
 */
export const OVERFLOW_MARGIN = 64;
/** Step, in seconds, for finding when the wave has passed. */
const SETTLE_STEP = 0.01;
/** A box this much longer than it is tall (or the reverse) sends a band, else a ring. */
const BAND_RATIO = 1.4;

export interface Radii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ScopeBox {
  /** The scope's border box, in viewport px. */
  left: number;
  top: number;
  width: number;
  height: number;
  radii: Radii;
}

export interface WavePlan {
  /** True when the whole document transitions. */
  root: boolean;
  scope: Element;
  box: ScopeBox;
  config: WaveConfig;
  geometry: WaveGeometry;
  /** True for a band crossing sideways: the front is squashed along y instead of x. */
  sideways: boolean;
  /** The front's largest radius, in px. */
  reach: number;
  /** When, in seconds, the lens and blur are gone and the live page can take over. */
  settledAt: number;
  /** When, in seconds, the last light is gone. */
  total: number;
}

const NO_RADII: Radii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };

export const isRootScope = (scope: Element | undefined): boolean =>
  !scope || scope === document.documentElement || scope === document.body;

const cornerRadius = (value: string, side: number): number => {
  const first = value.trim().split(/\s+/)[0] ?? '0';
  const amount = parseFloat(first) || 0;
  return first.endsWith('%') ? (amount / 100) * side : amount;
};

const radiiOf = (element: Element, width: number, height: number): Radii => {
  const style = getComputedStyle(element);
  const side = Math.min(width, height);
  const radii = {
    topLeft: cornerRadius(style.borderTopLeftRadius, side),
    topRight: cornerRadius(style.borderTopRightRadius, side),
    bottomRight: cornerRadius(style.borderBottomRightRadius, side),
    bottomLeft: cornerRadius(style.borderBottomLeftRadius, side),
  };
  // CSS shrinks radii that would overlap; capping each at half the short side is close enough for a glow.
  const cap = side / 2;
  return {
    topLeft: Math.min(radii.topLeft, cap),
    topRight: Math.min(radii.topRight, cap),
    bottomRight: Math.min(radii.bottomRight, cap),
    bottomLeft: Math.min(radii.bottomLeft, cap),
  };
};

export const measureScope = (scope: Element | undefined): ScopeBox => {
  if (isRootScope(scope)) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, radii: NO_RADII };
  }
  const rect = (scope as Element).getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    radii: radiiOf(scope as Element, rect.width, rect.height),
  };
};

type BoxRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const pointRect = (x: number, y: number): BoxRect => ({ left: x, top: y, width: 0, height: 0 });

/** The origin as a box in viewport px, or null for "the scope's center". */
const originRect = (origin: WaveOrigin | undefined): { rect: BoxRect | null; element: Element | null } => {
  if (!origin) {
    return { rect: null, element: null };
  }
  if (origin instanceof Element) {
    return { rect: origin.getBoundingClientRect(), element: origin };
  }
  if (!(origin instanceof MouseEvent)) {
    return { rect: pointRect(origin.x, origin.y), element: null };
  }
  // A keyboard click has no pointer position: start from the control that was activated.
  const keyboard = origin.detail === 0 && origin.type === 'click';
  const target = origin.currentTarget instanceof Element ? origin.currentTarget : origin.target;
  if (keyboard && target instanceof Element) {
    return { rect: target.getBoundingClientRect(), element: target };
  }
  return { rect: pointRect(origin.clientX, origin.clientY), element: null };
};

export const planWave = (options: WaveTransitionOptions): WavePlan => {
  const root = isRootScope(options.scope);
  const scope = root ? document.documentElement : (options.scope as Element);
  const box = measureScope(options.scope);
  const { rect, element } = originRect(options.origin);
  const fromScope = element !== null && element === scope;

  let source: { x: number; y: number; w: number; h: number };
  if (rect && !fromScope && (rect.width > 0 || rect.height > 0)) {
    source = { x: rect.left - box.left, y: rect.top - box.top, w: rect.width, h: rect.height };
  } else {
    const centerX = rect && !fromScope ? rect.left - box.left : box.width / 2;
    const centerY = rect && !fromScope ? rect.top - box.top : box.height / 2;
    const half = Math.max(8, Math.min(box.width, box.height) * 0.08);
    source = { x: centerX - half, y: centerY - half, w: 2 * half, h: 2 * half };
  }

  const wide = source.w >= source.h * BAND_RATIO;
  const tall = source.h >= source.w * BAND_RATIO;
  const shape = options.shape ?? 'auto';
  const ring = shape === 'ring' || (shape === 'auto' && !wide && !tall);
  const sideways = !ring && tall;
  const preset = ring ? PRESETS.center : sideways ? PRESETS.horizontal : PRESETS.vertical;

  const { tuning, palette, duration, easing, intensity, particles } = options;
  const config = resolveConfig(
    preset,
    // A snapshot's lens can only stretch along the window's axes, so the front never leans.
    { ...tuning, palette, duration, easing, intensity, particles, lean: 0 },
    box.width,
    box.height,
  );
  const geometry: WaveGeometry = {
    w: box.width,
    h: box.height,
    src: source,
    touch: null,
    // The origin element stays clear of the light, as long as it's part of what transitions.
    hold: element !== null && !fromScope && scope.contains(element),
  };

  const total = totalDuration(config);
  const reach = frameState(config.anticipation + config.travel, config, geometry).radius;
  let settledAt = config.anticipation;
  while (settledAt < total && !frameState(settledAt, config, geometry).settled) {
    settledAt += SETTLE_STEP;
  }
  return { root, scope, box, config, geometry, sideways, reach, settledAt, total };
};

/** The front's half-extents in px: an ellipse `squash` times narrower along the band than across it. */
export const frontRadii = (frame: WaveFrame, sideways: boolean, radius = frame.radius): [number, number] =>
  sideways ? [radius, radius / frame.squash] : [radius / frame.squash, radius];

const HIDDEN = 'linear-gradient(transparent, transparent)';
const SHOWN = 'linear-gradient(#000, #000)';

export interface RevealMasks {
  /** Shows the new page inside the front. */
  revealed: string;
  /** Shows the old page outside it, so translucent parts (a scope's shadow) aren't drawn twice. */
  remaining: string;
}

/** Splits the scope between the old and new page along the front, through a seam as soft as distortion-wave's. */
export const revealMasks = (frame: WaveFrame, config: WaveConfig, sideways: boolean): RevealMasks => {
  if (!frame.launched || frame.radius <= 0) {
    return INITIAL_MASKS;
  }
  const inner = Math.max(0, (1 - config.seam / frame.radius) * 100);
  const outer = (1 + config.seam / frame.radius) * 100;
  const [radiusX, radiusY] = frontRadii(frame, sideways);
  // The snapshots' boxes, which the masks fill, start OVERFLOW_MARGIN px before the scope's (see styles.ts).
  const ellipse = `${radiusX}px ${radiusY}px at ${frame.ox + OVERFLOW_MARGIN}px ${frame.oy + OVERFLOW_MARGIN}px`;
  return {
    revealed: `radial-gradient(${ellipse}, #000 ${inner}%, transparent ${outer}%)`,
    remaining: `radial-gradient(${ellipse}, transparent ${inner}%, #000 ${outer}%)`,
  };
};

export const INITIAL_MASKS: RevealMasks = { revealed: HIDDEN, remaining: SHOWN };
