import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frontRadii, planWave, revealMasks } from '../src/plan';
import { PLAYING_CLASS, WAVE_TRANSITION_NAME } from '../src/styles';
import { NO_BEND, levelsToShed } from '../src/quality';
import { isWaveTransitionSupported, waveTransition } from '../src/transition';

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

const button = (width: number, height: number): HTMLButtonElement => {
  const element = document.createElement('button');
  element.getBoundingClientRect = () => rect(100, 100, width, height);
  document.body.appendChild(element);
  return element;
};

/** A fake `document.startViewTransition` that runs the update and hands back controllable promises. */
const stubViewTransitions = () => {
  const transitions: { finish: () => void; skipTransition: ReturnType<typeof vi.fn> }[] = [];
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (argument: (() => Promise<void>) | { update: () => Promise<void> }) => {
      const update = typeof argument === 'function' ? argument : argument.update;
      let finish: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const updateCallbackDone = Promise.resolve().then(update);
      const skipTransition = vi.fn(() => finish());
      transitions.push({ finish, skipTransition });
      return { updateCallbackDone, ready: updateCallbackDone, finished, skipTransition };
    },
  });
  document.documentElement.animate = vi.fn() as unknown as typeof document.documentElement.animate;
  return transitions;
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  document.body.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('planWave', () => {
  it('sends a band from a wide origin and a ring from a square one', () => {
    expect(planWave({ origin: button(120, 32) }).config.type).toBe('vertical');
    expect(planWave({ origin: button(32, 120) }).sideways).toBe(true);
    expect(planWave({ origin: button(40, 40) }).config.type).toBe('center');
    expect(planWave({ origin: button(120, 32), shape: 'ring' }).config.type).toBe('center');
  });

  it('starts from a pointer position, and from the control for a keyboard click', () => {
    const control = button(40, 40);
    const pointer = new MouseEvent('click', { clientX: 300, clientY: 200, detail: 1 });
    const fromPointer = planWave({ origin: pointer }).geometry.src;
    expect(fromPointer.x + fromPointer.w / 2).toBe(300);
    expect(fromPointer.y + fromPointer.h / 2).toBe(200);

    const keyboard = new MouseEvent('click', { detail: 0 });
    Object.defineProperty(keyboard, 'target', { value: control });
    expect(planWave({ origin: keyboard }).geometry.src).toEqual({ x: 100, y: 100, w: 40, h: 40 });
  });

  it('settles before the light is gone', () => {
    const plan = planWave({ origin: button(120, 32) });
    expect(plan.settledAt).toBeGreaterThan(plan.config.anticipation);
    expect(plan.settledAt).toBeLessThan(plan.total);
  });

  it('honours duration and intensity', () => {
    const plan = planWave({ origin: button(120, 32), duration: 1000, intensity: 0 });
    expect(plan.total).toBeCloseTo(1, 5);
    expect(plan.config.amplitude).toBe(0);
  });
});

describe('revealMasks', () => {
  it('hides the new page until the wave launches, then shows it inside the front', () => {
    const { config } = planWave({ origin: button(120, 32) });
    const frame = { launched: false, radius: 0, squash: 1, ox: 0, oy: 0 } as Parameters<typeof revealMasks>[0];
    expect(revealMasks(frame, config, false).revealed).toContain('transparent, transparent');
    expect(revealMasks(frame, config, false).remaining).toContain('#000, #000');
    const launched = { ...frame, launched: true, radius: 200, squash: 1.4, ox: 50, oy: 60 };
    const masks = revealMasks(launched, config, false);
    expect(masks.revealed).toContain(`${200 / 1.4}px 200px at 114px 124px, #000`);
    expect(masks.remaining).toContain(`${200 / 1.4}px 200px at 114px 124px, transparent`);
    expect(frontRadii(launched, true)).toEqual([200, 200 / 1.4]);
  });
});

describe('levelsToShed', () => {
  it('keeps everything at 25 fps or more, and ignores a single hitch', () => {
    expect(levelsToShed([16.7, 16.7, 16.7, 16.7])).toBe(0);
    expect(levelsToShed([33.3, 33.3, 40, 33.3])).toBe(0);
    expect(levelsToShed([180, 16.7, 16.7, 16.7])).toBe(0);
  });

  it('sheds more levels the slower the frames come', () => {
    expect(levelsToShed([50, 50, 50, 50])).toBe(1);
    expect(levelsToShed([90, 90, 90])).toBe(2);
    expect(levelsToShed([400, 400, 400])).toBe(NO_BEND);
  });
});

describe('waveTransition', () => {
  it('runs the update and resolves without view transition support', async () => {
    const update = vi.fn();
    expect(isWaveTransitionSupported()).toBe(false);
    const transition = waveTransition(update);
    await transition.finished;
    await expect(transition.ready).rejects.toThrow();
    await expect(transition.interactive).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();
  });

  it('plays the wave as a view transition and cleans up after it', async () => {
    const transitions = stubViewTransitions();
    const update = vi.fn();
    const transition = waveTransition(update, { origin: button(120, 32) });
    const html = document.documentElement;
    expect(html.classList.contains(PLAYING_CLASS)).toBe(true);
    expect(html.style.viewTransitionName).toBe(WAVE_TRANSITION_NAME);

    await transition.ready;
    expect(update).toHaveBeenCalledOnce();
    expect(html.animate).toHaveBeenCalledWith(
      { opacity: [1, 1] },
      expect.objectContaining({ pseudoElement: `::view-transition-new(${WAVE_TRANSITION_NAME})` }),
    );

    transitions[0].finish();
    await transition.interactive;
    expect(html.classList.contains(PLAYING_CLASS)).toBe(false);
    expect(html.style.viewTransitionName).toBe('');
    expect(document.getElementById('view-transition-wave-filter')).toBeNull();
  });

  it('names only the scope when one is given, and flattens the names inside it', async () => {
    stubViewTransitions();
    const scope = document.createElement('section');
    scope.getBoundingClientRect = () => rect(0, 0, 400, 300);
    const inner = document.createElement('div');
    inner.style.viewTransitionName = 'inner';
    scope.appendChild(inner);
    document.body.appendChild(scope);

    const transition = waveTransition(() => undefined, { scope });
    expect(scope.style.viewTransitionName).toBe(WAVE_TRANSITION_NAME);
    expect(inner.style.viewTransitionName).toBe('none');
    expect(document.documentElement.style.viewTransitionName).toBe('');
    transition.skipTransition();
    await transition.interactive;
    expect(scope.style.viewTransitionName).toBe('');
    expect(inner.style.viewTransitionName).toBe('inner');
  });

  it('plays the plain cross-fade under reduced motion', async () => {
    const transitions = stubViewTransitions();
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    const transition = waveTransition(() => undefined, { origin: button(120, 32) });
    expect(document.documentElement.classList.contains(PLAYING_CLASS)).toBe(false);
    transitions[0].finish();
    await transition.finished;
  });

  it('skips the previous wave when a new one starts, and on abort', async () => {
    const transitions = stubViewTransitions();
    window.matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList);
    const first = waveTransition(() => undefined);
    const controller = new AbortController();
    const second = waveTransition(() => undefined, { signal: controller.signal });
    expect(transitions[0].skipTransition).toHaveBeenCalled();
    await first.finished;
    controller.abort();
    expect(transitions[1].skipTransition).toHaveBeenCalled();
    await second.finished;
  });
});
