/**
 * What a wave sheds, in this order, when its frames come too slowly: each level drops one more of the
 * costliest parts. The colour split and the blur are passes of the SVG filter over the whole scope,
 * the bending is the filter itself, and the light is drawn at half resolution last.
 */
export const FULL = 0;
export const NO_SPLIT = 1;
export const NO_BLUR = 2;
export const NO_BEND = 3;
export const HALF_LIGHT = 4;
export const LOWEST = HALF_LIGHT;

/** Slower than this, in ms per frame (25 fps), the wave sheds a level. */
export const FRAME_BUDGET = 1000 / 25;
/** Faster than this while the page is covered (45 fps), a wave had frames to spare. */
export const FRAME_SPARE = 1000 / 45;
/** After this many waves in a row with frames to spare, the next one tries a level higher. */
export const SPARE_WAVES = 3;
/** Frames averaged before deciding to shed, and before deciding again... */
export const FRAME_WINDOW = 4;
/** ...or fewer (at least three), once they have taken this long in ms: slow frames are decided on sooner. */
export const WINDOW_TIME = 150;
/** Frames ignored after the wave starts: the first one also decodes maps and compiles shaders. */
export const WARM_UP_FRAMES = 1;

/**
 * How many levels to shed at once, for a window of frame times in ms. Their median, so that one hitch
 * (a garbage collection) among fast frames sheds nothing.
 */
export const levelsToShed = (frameTimes: readonly number[]): number => {
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= FRAME_BUDGET) {
    return 0;
  }
  // Far over budget, the filter is the cost: going one level at a time would take most of the wave.
  return median > 3 * FRAME_BUDGET ? NO_BEND : median > 1.75 * FRAME_BUDGET ? 2 : 1;
};
/** A gap longer than this is a hidden tab or a breakpoint, not a slow frame. */
export const FRAME_GAP = 500;
