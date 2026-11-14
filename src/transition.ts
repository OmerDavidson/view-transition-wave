import { makeParticles, particleAt, frameState } from 'distortion-wave/src/core.js';
import { createWaveEffects } from './effects';
import { mountWaveFilter } from './filter';
import { waveMaps } from './maps';
import { INITIAL_MASKS, planWave, revealMasks } from './plan';
import {
  FRAME_GAP,
  FRAME_SPARE,
  FRAME_WINDOW,
  FULL,
  HALF_LIGHT,
  LOWEST,
  SPARE_WAVES,
  WARM_UP_FRAMES,
  WINDOW_TIME,
  levelsToShed,
} from './quality';
import { PLAYING_CLASS, WAVE_TRANSITION_NAME, ensureStyles } from './styles';
import type { WaveTransition, WaveTransitionOptions } from './types';

/** How long the browser gets to take its snapshots before the wave is skipped. */
const SNAPSHOT_TIMEOUT = 3000;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // Like a ViewTransition's, these may reject without anyone listening; that's not an error.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
};

export type UpdateCallback = () => void | Promise<void>;

let active: WaveTransition | null = null;
/** The quality level (see quality.ts) the next `'auto'` wave starts at: where the last one ended. */
let startLevel = FULL;
/** `'auto'` waves in a row that played at `startLevel` with frames to spare. */
let spareWaves = 0;

/** True when the browser can play the wave (it needs view transitions; without WebGL2 it plays without light). */
export const isWaveTransitionSupported = (): boolean =>
  typeof document !== 'undefined' && typeof document.startViewTransition === 'function';

const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const startViewTransition = (update: UpdateCallback, types: readonly string[] | undefined): ViewTransition => {
  if (types?.length) {
    return document.startViewTransition({ update, types: [...types] });
  }
  return document.startViewTransition(update);
};

/**
 * Sets styles on one of the transition's pseudo-elements, frame after frame, through an animation that
 * holds them for as long as the wave covers the page. Only that pseudo-element is restyled: a custom
 * property on `<html>` would be inherited by, and restyle, the whole document every frame.
 */
const pseudoStyle = (pseudoElement: string) => {
  let effect: KeyframeEffect | null = null;
  let animation: Animation | undefined;
  let last = '';
  return {
    /** Starts holding `keyframe`, until `duration` ms from now (when the transition may end). */
    hold: (keyframe: Keyframe, duration: number) => {
      last = JSON.stringify(keyframe);
      animation = document.documentElement.animate([keyframe, keyframe], { pseudoElement, duration, fill: 'forwards' });
      const held = animation?.effect as KeyframeEffect | null | undefined;
      effect = typeof held?.setKeyframes === 'function' ? held : null;
    },
    set: (keyframe: Keyframe) => {
      const key = JSON.stringify(keyframe);
      if (effect && key !== last) {
        last = key;
        effect.setKeyframes([keyframe, keyframe]);
      }
    },
    remove: () => animation?.cancel(),
  };
};

/**
 * Takes elements with their own `view-transition-name` out of the transition while the wave plays, so
 * they are part of the scope's snapshot and bend with it instead of being drawn above it untouched.
 * Returns the function that gives them their names back.
 */
const flattenNamedElements = (scope: Element, root: boolean): (() => void) => {
  const renamed: { element: HTMLElement; inlineName: string }[] = [];
  const container = root ? document.body : scope;
  container.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const name = getComputedStyle(element).viewTransitionName;
    if (name && name !== 'none') {
      renamed.push({ element, inlineName: element.style.viewTransitionName });
      element.style.viewTransitionName = 'none';
    }
  });
  return () =>
    renamed.forEach(({ element, inlineName }) => {
      element.style.viewTransitionName = inlineName;
    });
};

/**
 * Runs `update` inside a view transition and plays a distortion wave from the old page to the new
 * one: the page is drawn in toward the origin, then the new page bursts out behind a glowing,
 * colour-fringed front that bends both. The live page is back (`interactive`) as soon as the wave has
 * passed; the last of the light fades over it.
 *
 * `update` always runs, whatever the browser supports. Like `document.startViewTransition`, the DOM
 * must be updated when it returns (in React, wrap state changes in `flushSync`).
 */
export const waveTransition = (update: UpdateCallback = () => undefined, options: WaveTransitionOptions = {}): WaveTransition => {
  active?.skipTransition();

  const updateDone = deferred();
  const ready = deferred();
  const interactive = deferred();
  const finished = deferred();

  let updateRun: Promise<void> | null = null;
  const runUpdate = (): Promise<void> => {
    if (!updateRun) {
      updateRun = (async () => {
        await update();
      })();
      updateRun.then(updateDone.resolve, updateDone.reject);
    }
    return updateRun;
  };

  let skip: () => void = () => undefined;
  const transition: WaveTransition = {
    updateCallbackDone: updateDone.promise,
    ready: ready.promise,
    interactive: interactive.promise,
    finished: finished.promise,
    skipTransition: () => skip(),
  };
  active = transition;
  const done = () => {
    if (active === transition) {
      active = null;
    }
    finished.resolve();
  };

  const scopeGone = options.scope !== undefined && !options.scope.isConnected;
  if (!isWaveTransitionSupported() || scopeGone || options.signal?.aborted) {
    void runUpdate()
      .catch(() => undefined)
      .finally(() => {
        ready.reject(new DOMException('The wave could not play.', 'InvalidStateError'));
        interactive.resolve();
        done();
      });
    return transition;
  }

  if ((options.reducedMotion ?? 'respect') === 'respect' && prefersReducedMotion()) {
    const plain = startViewTransition(runUpdate, options.types);
    skip = () => plain.skipTransition();
    options.signal?.addEventListener('abort', skip, { once: true });
    plain.ready.then(ready.resolve, ready.reject);
    void plain.finished.finally(() => {
      interactive.resolve();
      done();
    });
    return transition;
  }

  const plan = planWave(options);
  const { config, geometry, box, root, scope, sideways, settledAt, total } = plan;
  if (box.width < 1 || box.height < 1) {
    void runUpdate()
      .catch(() => undefined)
      .finally(() => {
        ready.reject(new DOMException('The scope has no size.', 'InvalidStateError'));
        interactive.resolve();
        done();
      });
    return transition;
  }

  const html = document.documentElement;
  const named = scope as HTMLElement;
  ensureStyles();
  const groupStyle = pseudoStyle(`::view-transition-group(${WAVE_TRANSITION_NAME})`);
  const newStyle = pseudoStyle(`::view-transition-new(${WAVE_TRANSITION_NAME})`);
  const oldStyle = pseudoStyle(`::view-transition-old(${WAVE_TRANSITION_NAME})`);
  const filter = mountWaveFilter(
    config,
    waveMaps(config, plan.reach),
    { width: box.width, height: box.height, sideways },
    value => groupStyle.set({ filter: value }),
  );
  const effects = createWaveEffects(config, box);
  const particles = makeParticles(config.particles, config);
  const dots = new Float32Array(Math.max(particles.length, 1) * 4);
  const inlineName = named.style.viewTransitionName;
  const restoreNames = flattenNamedElements(scope, root);
  named.style.viewTransitionName = WAVE_TRANSITION_NAME;
  html.classList.add(PLAYING_CLASS);

  const adaptive = (options.quality ?? 'auto') === 'auto';
  const firstLevel = adaptive ? startLevel : FULL;
  let level = firstLevel;
  const setLevel = (next: number) => {
    level = next;
    effects?.setResolution(level >= HALF_LIGHT ? 0.5 : 1);
  };
  setLevel(level);
  // Frame times: of the current window (to shed a level), and of the wave while it covers the page (to
  // try a higher level later; the light alone, after, is cheap).
  let previous = 0;
  let seen = 0;
  const windowTimes: number[] = [];
  let waveTime = 0;
  let waveFrames = 0;
  const measure = (now: number) => {
    const gap = now - previous;
    previous = now;
    seen += 1;
    if (seen <= WARM_UP_FRAMES + 1 || gap > FRAME_GAP) {
      return;
    }
    if (!pageBack) {
      waveTime += gap;
      waveFrames += 1;
    }
    windowTimes.push(gap);
    const windowTime = windowTimes.reduce((sum, time) => sum + time, 0);
    if (windowTimes.length >= FRAME_WINDOW || (windowTimes.length >= 3 && windowTime >= WINDOW_TIME)) {
      const shed = adaptive ? levelsToShed(windowTimes) : 0;
      if (shed > 0 && level < LOWEST) {
        setLevel(Math.min(LOWEST, level + shed));
      }
      windowTimes.length = 0;
    }
  };

  let start = 0;
  let frame = 0;
  let pageBack = false;
  let lightGone = false;

  const endPage = () => {
    if (pageBack) {
      return;
    }
    pageBack = true;
    html.classList.remove(PLAYING_CLASS);
    [groupStyle, newStyle, oldStyle].forEach(style => style.remove());
    named.style.viewTransitionName = inlineName;
    restoreNames();
    filter.remove();
    // The light keeps fading over the live page.
    if (effects) {
      effects.canvas.style.viewTransitionName = '';
    }
    interactive.resolve();
  };
  const endLight = () => {
    if (lightGone) {
      return;
    }
    lightGone = true;
    cancelAnimationFrame(frame);
    if (adaptive && waveFrames >= 2 * FRAME_WINDOW) {
      const spare = level === firstLevel && waveTime / waveFrames < FRAME_SPARE;
      spareWaves = spare ? spareWaves + 1 : 0;
      startLevel = level;
      if (spareWaves >= SPARE_WAVES) {
        startLevel = Math.max(FULL, level - 1);
        spareWaves = 0;
      }
    }
    effects?.remove();
    done();
  };

  const tick = (now: number) => {
    measure(now);
    const time = Math.min((now - start) / 1000, total);
    const state = frameState(time, config, geometry);
    if (!pageBack) {
      filter.update(state, level);
      const masks = revealMasks(state, config, sideways);
      newStyle.set({ maskImage: masks.revealed });
      oldStyle.set({ maskImage: masks.remaining });
    } else if (effects && !root) {
      // The page can scroll again: keep the light on the scope.
      const rect = scope.getBoundingClientRect();
      effects.place(rect.left, rect.top);
    }
    if (effects) {
      let count = 0;
      particles.forEach((particle) => {
        const dot = particleAt(particle, state, config);
        if (dot && dot.a > 0.002) {
          const at = count * 4;
          dots[at] = dot.x;
          dots[at + 1] = dot.y;
          dots[at + 2] = particle.size;
          dots[at + 3] = Math.min(dot.a, 1);
          count += 1;
        }
      });
      effects.render(state, dots, count);
    }
    if (time >= total) {
      endLight();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const viewTransition = startViewTransition(async () => {
    await runUpdate();
    // Only in the new state, so the light is a layer of its own above both snapshots.
    if (effects) {
      document.body.appendChild(effects.canvas);
    }
  }, options.types);

  skip = () => {
    viewTransition.skipTransition();
    endLight();
  };
  options.signal?.addEventListener('abort', skip, { once: true });
  const timeout = window.setTimeout(() => viewTransition.skipTransition(), SNAPSHOT_TIMEOUT);

  viewTransition.ready
    .then(() => {
      window.clearTimeout(timeout);
      if (lightGone) {
        return;
      }
      // Holds the transition open until the live page can take over; every frame is drawn by `tick`.
      html.animate(
        { opacity: [1, 1] },
        { duration: settledAt * 1000, pseudoElement: `::view-transition-new(${WAVE_TRANSITION_NAME})` },
      );
      groupStyle.hold({ filter: 'none' }, settledAt * 1000);
      newStyle.hold({ maskImage: INITIAL_MASKS.revealed }, settledAt * 1000);
      oldStyle.hold({ maskImage: INITIAL_MASKS.remaining }, settledAt * 1000);
      start = performance.now();
      ready.resolve();
      frame = requestAnimationFrame(tick);
    })
    .catch((reason: unknown) => {
      window.clearTimeout(timeout);
      ready.reject(reason);
      endPage();
      endLight();
    });
  void viewTransition.finished.finally(endPage);

  return transition;
};

/**
 * Does the slow part of a wave ahead of time (drawing the filter's maps, compiling the shaders), for a
 * first wave without a hitch. Call it once the page is idle, with the options you'll play with.
 */
export const prepareWaveTransition = (options: WaveTransitionOptions = {}): void => {
  if (!isWaveTransitionSupported()) {
    return;
  }
  const plan = planWave(options);
  waveMaps(plan.config, plan.reach);
  createWaveEffects(plan.config, plan.box)?.remove();
};
