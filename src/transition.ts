import { makeParticles, particleAt, frameState } from 'distortion-wave/src/core.js';
import { createWaveEffects } from './effects';
import { mountWaveFilter } from './filter';
import { waveMaps } from './maps';
import { INITIAL_MASKS, planWave, revealMasks, type RevealMasks } from './plan';
import { PLAYING_CLASS, REMAIN_PROPERTY, REVEAL_PROPERTY, WAVE_TRANSITION_NAME, ensureStyles } from './styles';
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
  const filter = mountWaveFilter(config, waveMaps(config, plan.reach), { width: box.width, height: box.height, sideways });
  const effects = createWaveEffects(config, box);
  const particles = makeParticles(config.particles, config);
  const dots = new Float32Array(Math.max(particles.length, 1) * 4);
  const inlineName = named.style.viewTransitionName;
  const restoreNames = flattenNamedElements(scope, root);
  named.style.viewTransitionName = WAVE_TRANSITION_NAME;
  const setMasks = (masks: RevealMasks) => {
    html.style.setProperty(REVEAL_PROPERTY, masks.revealed);
    html.style.setProperty(REMAIN_PROPERTY, masks.remaining);
  };
  setMasks(INITIAL_MASKS);
  html.classList.add(PLAYING_CLASS);

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
    html.style.removeProperty(REVEAL_PROPERTY);
    html.style.removeProperty(REMAIN_PROPERTY);
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
    effects?.remove();
    done();
  };

  const tick = (now: number) => {
    const time = Math.min((now - start) / 1000, total);
    const state = frameState(time, config, geometry);
    if (!pageBack) {
      filter.update(state);
      setMasks(revealMasks(state, config, sideways));
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
          dots.set([dot.x, dot.y, particle.size, Math.min(dot.a, 1)], count * 4);
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
