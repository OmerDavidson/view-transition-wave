# view-transition-wave

A shockwave transition built on native [View Transitions](https://developer.mozilla.org/docs/Web/API/View_Transition_API). First the page is drawn in toward the click. Then the new state bursts out behind a front that bends the page like a lens, splits it into red, green and blue fringes, blurs it and lights it with colour. The glow lingers on the edges.

The browser takes the snapshots itself, so fonts, images, iframes, scroll positions and canvases look exactly as they are. Nothing is cloned or rasterised. The live page is back as soon as the wave has passed.

The look and timing come from [distortion-wave](https://github.com/LukyVj/distortion-wave) by Lucas Bonomi, whose timeline this package uses directly. distortion-wave redraws the element itself on a canvas. This package plays the same wave over the browser's own view-transition snapshots instead.

## Install

```sh
npm i view-transition-wave
```

## Usage

```js
import { waveTransition } from 'view-transition-wave';

themeSwitch.addEventListener('click', (event) => {
  waveTransition(() => document.body.classList.toggle('dark'), { origin: event });
});
```

The call looks like `document.startViewTransition(update)`: you give it a function that changes the DOM, and it returns the transition's promises.

```js
const transition = waveTransition(update, options);
await transition.updateCallbackDone; // your update ran
await transition.ready;              // the wave is playing
await transition.interactive;        // the live page is back (the glow may still be fading)
await transition.finished;           // everything is cleaned up
transition.skipTransition();         // jump to the end
```

### One element

```js
waveTransition(() => card.classList.add('paid'), { scope: card, origin: event });
```

Only `card` waves. Its rounded corners and shadow are kept, and the edge glow follows its shape. The scope element must still be in the DOM after the update.

### React

As with view transitions, the DOM must be updated by the time your callback returns, so wrap state changes in `flushSync`:

```jsx
import { flushSync } from 'react-dom';

<button onClick={(event) => waveTransition(() => flushSync(() => setDark(!dark)), { origin: event })} />
```

### Warm up

The first wave draws its displacement maps and compiles its shaders, which takes a few tens of ms. To do that ahead of time:

```js
requestIdleCallback(() => prepareWaveTransition({ origin: themeSwitch }));
```

## Options

| Option | Default | |
|---|---|---|
| `origin` | the scope's center | Where the wave starts. An element (it grows out of its box), a pointer or mouse event (from where it happened; a keyboard click uses the activated control) or a `{ x, y }` point in viewport px. |
| `scope` | the document | The element that transitions. |
| `shape` | `'auto'` | `'ring'` grows a circle. `'band'` sends a front off the origin's long side. `'auto'` sends a band from a box at least 1.4× longer than it is tall (or the reverse), and a ring otherwise. |
| `palette` | `'aurora'` | `'aurora'`, `'ocean'`, `'mint'`, `'ember'`, or up to 8 hex colours, blended in OKLab. |
| `duration` | from the size | Total length in ms, light included. About 2 s for a button, 4 s for a page. |
| `easing` | distortion-wave's launch | How the front travels: a CSS keyword, `'cubic-bezier(…)'`, `[x1, y1, x2, y2]` or a function. |
| `intensity` | `1` | Strength of the bending. `0` keeps only the light. |
| `particles` | `true` | `false`, or a count. |
| `quality` | `'auto'` | `'auto'` aims for 25 fps or more: when frames come slower, it drops its costliest parts while it plays (the colour split, then the blur, then the bending, then the glow's resolution). `'full'` always plays everything. |
| `reducedMotion` | `'respect'` | With `prefers-reduced-motion`, `'respect'` plays the browser's plain cross-fade instead. `'ignore'` always plays the wave. |
| `types` | | View transition types, for `:active-view-transition-type()`. |
| `signal` | | An `AbortSignal`. Aborting skips the transition, and the update still runs. |
| `tuning` | | Low-level knobs (`amplitude`, `lensWidth`, `aberration`, `blur`, `band`, `rimStrength`, `pull`…). See `WaveTuning` in the types. |

Other exports are `prepareWaveTransition(options)`, `isWaveTransitionSupported()` and `PALETTES`.

## Behaviour

- **Your update always runs.** Without view transitions, it runs with no animation, and `ready` rejects (as it does when a view transition is skipped). Without WebGL2, the page still bends but has no light.
- **It aims for 25 fps.** With `quality: 'auto'`, the wave times its own frames. If they come slower than 25 fps, it sheds the costliest part still playing, several at once when frames are far over budget. The next wave starts at the level this one ended at, and tries one level higher after three waves in a row with frames to spare.
- **One at a time.** A new wave skips the one still playing, as a new view transition does.
- **Named elements are flattened.** While a wave plays, elements inside the scope that have their own `view-transition-name` are un-named. Otherwise the browser would draw them above the bent snapshot, untouched. Their names come back afterwards.
- **Other view transitions are left alone.** The wave's styles only apply while it plays.
- **The page can't be used while the wave covers it.** As with any view transition, it takes input again at `interactive`, about halfway through. The glow then fades over the live page.

## How it works

1. `document.startViewTransition` snapshots the scope before and after your update. While the wave plays, the scope carries the `view-transition-name` `view-transition-wave`.
2. A mask redrawn every frame shows the new snapshot inside the front and the old one outside it, through a soft seam.
3. The transition's group, holding both masked snapshots, is drawn through one SVG filter. It applies the inhale's pull toward the origin, a lens bulge along the front with red and blue bent by different amounts, and a blur that follows the front. The filter's displacement maps are drawn once on a canvas, for a range of front sizes, and stretched per frame. Each frame runs only the stages that move a pixel by a visible amount, and no filter at all when nothing bends.
4. A transparent WebGL2 canvas, which is a layer of the transition itself, draws the coloured band, the edge glow and the sparks. It uses distortion-wave's light shader.
5. Every frame comes from distortion-wave's pure `frameState(t)`, so the two libraries play the same wave. The per-frame masks and filter are set on the transition's pseudo-elements through held Web Animations, so only those pseudo-elements are restyled, never the page.

## Browser support

This needs same-document view transitions (Chrome and Edge 111+, Safari 18+). It is tested in Chromium only. Other browsers fall back to a plain update if they lack view transitions, but their SVG filters on view-transition pseudo-elements are untested.

Limits: the front can't lean toward the touch point the way distortion-wave's does, because a snapshot's lens can only stretch along the window's axes. The blur is a single Gaussian rather than a pyramid.

## Development

```sh
npm install
npm test           # unit tests (vitest, jsdom)
npm run typecheck
npm run build      # tsdown → dist/
npm run demo       # builds, then serves the repo; open http://localhost:4321/demo/
```

## License

MIT. The light shader and the lens profiles are ported from distortion-wave (MIT © Lucas Bonomi); see `LICENSE`.
