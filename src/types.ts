export type PaletteName = 'aurora' | 'ocean' | 'mint' | 'ember';

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the wave starts.
 * - An element: the wave grows out of its box (a wide box sends a band, a square one a ring).
 * - A pointer or mouse event: from where it happened. Keyboard clicks (no pointer position) fall back
 *   to the event's target element.
 * - A point in viewport px.
 */
export type WaveOrigin = Element | MouseEvent | Point;

/**
 * - `'ring'`: a circle growing from the origin.
 * - `'band'`: a front that leaves the origin's long side, across the scope.
 * - `'auto'`: a band from a box at least 1.4× longer than it is tall (or tall than wide), else a ring.
 */
export type WaveShape = 'auto' | 'ring' | 'band';

/** Low-level knobs, at a 360×740 px reference scale (lengths in px, times in s); scaled to the scope. */
export interface WaveTuning {
  /** The inhale before the wave leaves the origin. */
  anticipation: number;
  /** Time for the front to cross the scope. */
  travel: number;
  /** Displacement under the front. */
  amplitude: number;
  /** Width of the lens band. */
  lensWidth: number;
  /** Chromatic split. */
  aberration: number;
  /** Max blur, and how far it reaches ahead of and behind the front. */
  blur: number;
  blurAhead: number;
  blurBehind: number;
  /** The colour band: length ahead, length behind, strength. */
  lead: number;
  tail: number;
  band: number;
  /** The glow left on the scope's edges. */
  rimWidth: number;
  rimStrength: number;
  /** How hard the page is pulled toward the origin during the inhale. */
  pull: number;
  inhale: number;
  /** Softness of the seam between the old and new page. */
  seam: number;
}

export interface WaveTransitionOptions {
  /** Where the wave starts. Default: the scope's center. */
  origin?: WaveOrigin;
  /** The element that transitions. Default: the whole document. */
  scope?: Element;
  /** Default `'auto'`. */
  shape?: WaveShape;
  /** A named palette or up to 8 CSS hex colours, blended in OKLab. Default `'aurora'`. */
  palette?: PaletteName | readonly string[];
  /** Total length in ms, light included. Default: from the scope's size (about 2 s for a button, 4 s for a page). */
  duration?: number;
  /** How the front travels: a CSS keyword, `'cubic-bezier(…)'`, `[x1, y1, x2, y2]` or a function. */
  easing?: string | readonly [number, number, number, number] | ((progress: number) => number);
  /** Strength of the bending (displacement, pull, chromatic split). `0` keeps only the light. Default `1`. */
  intensity?: number;
  /** Sparks: `false` for none, or a count at reference scale. Default `true`. */
  particles?: boolean | number;
  /**
   * `'respect'` (default): with `prefers-reduced-motion`, the browser's plain cross-fade plays instead.
   * `'ignore'`: always the wave.
   */
  reducedMotion?: 'respect' | 'ignore';
  /** View transition types (`:active-view-transition-type()`), passed to the browser. */
  types?: readonly string[];
  /** Aborting skips the transition, like `skipTransition()`. The update still runs. */
  signal?: AbortSignal;
  tuning?: Partial<WaveTuning>;
}

/** What `waveTransition` returns: a `ViewTransition`'s promises, plus when the page is usable again. */
export interface WaveTransition {
  /** Resolves when your update has run. Rejects if it threw. */
  readonly updateCallbackDone: Promise<void>;
  /** Resolves when the snapshots are taken and the wave started. Rejects if it couldn't play. */
  readonly ready: Promise<void>;
  /** Resolves when the wave has passed and the live, interactive page is shown again (the light may still be fading). */
  readonly interactive: Promise<void>;
  /** Resolves when the last light has faded and everything is cleaned up. Never rejects. */
  readonly finished: Promise<void>;
  /** Jump to the end. The update still runs. */
  skipTransition(): void;
}
