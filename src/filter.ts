import type { WaveConfig, WaveFrame } from 'distortion-wave/src/core.js';
import { nearestLens, type WaveMaps } from './maps';
import { OVERFLOW_MARGIN as FILTER_MARGIN, frontRadii } from './plan';
import { NO_BEND, NO_BLUR, NO_SPLIT } from './quality';

/**
 * The SVG filter the two snapshots are drawn through, together (see styles.ts): what
 * distortion-wave's shader does to the page's pixels, rebuilt from filter primitives. In order:
 * the inhale's pull toward the source, the lens bulging out along the front with red and blue
 * bent by different amounts, and a blur that follows the front.
 */

export const WAVE_FILTER_ID = 'view-transition-wave-filter';
/** Below this many px of movement, a stage of the filter is skipped. */
const MIN_SHIFT = 0.25;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface WaveFilter {
  /** Draws `frame`, leaving out what `level` (see quality.ts) sheds. */
  update: (frame: WaveFrame, level: number) => void;
  remove: () => void;
}

const svgElement = <Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  attributes: Record<string, string | number>,
  children: SVGElement[] = [],
): SVGElementTagNameMap[Tag] => {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  children.forEach(child => element.appendChild(child));
  return element;
};

/**
 * One colour channel of a bent copy, at a third of its alpha, premultiplied: arithmetic compositing works
 * on premultiplied pixels, so multiplying by a flood keeps the channel without unpremultiplying. The three
 * thirds add up to a whole pixel, with the average of the three copies' alphas.
 */
const channelThird = (input: string, channel: number, result: string) => {
  const flood = ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(0,0,255)'][channel];
  return [
    svgElement('feFlood', { 'flood-color': flood, 'flood-opacity': 1 / 3, result: `${result}-flood` }),
    svgElement('feComposite', { in: input, in2: `${result}-flood`, operator: 'arithmetic', k1: 1, result }),
  ];
};

/** Places a map centred on a point in the scope's px. */
const place = (image: SVGFEImageElement, centerX: number, centerY: number, halfWidth: number, halfHeight: number) => {
  image.setAttribute('x', String(centerX - halfWidth));
  image.setAttribute('y', String(centerY - halfHeight));
  image.setAttribute('width', String(halfWidth * 2));
  image.setAttribute('height', String(halfHeight * 2));
};

export interface FilterArea {
  width: number;
  height: number;
  /** The front is squashed along y (a band crossing sideways) instead of x. */
  sideways: boolean;
}

/**
 * The filter, on the transition's group: it runs once over the two snapshots already split by the
 * masks, rather than once per snapshot over the whole box. `userSpaceOnUse` there is the scope's box;
 * the snapshots inside reach FILTER_MARGIN px past it on every side (see styles.ts), and so does the
 * filter's region.
 */
export const mountWaveFilter = (
  config: WaveConfig,
  maps: WaveMaps,
  area: FilterArea,
  /** Applies the filter to the group (`url(#…)`), or takes it off (`none`). */
  apply: (filter: string) => void,
): WaveFilter => {
  const size = { width: area.width, height: area.height };
  const image = (href: string, result: string) =>
    svgElement('feImage', { href, x: 0, y: 0, width: 0, height: 0, preserveAspectRatio: 'none', result });
  const pullImage = image(maps.pull.url, 'pull-raw');
  // Every lens map is loaded up front and the filter just switches which one it reads: swapping one
  // image's href would reload it, and the frame it takes to load would flash an unbent page.
  const lensImages = maps.lenses.map((lens, index) => image(lens.url, `lens-${index}`));
  const lensField = svgElement('feComposite', { in: 'lens-0', in2: 'neutral', operator: 'over', result: 'lens' });
  const pull = svgElement('feDisplacementMap', {
    in: 'SourceGraphic',
    in2: 'pull',
    scale: 0,
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    result: 'pulled',
  });
  const bends = [0, 1, 2].map(channel =>
    svgElement('feDisplacementMap', {
      in: 'pulled',
      in2: 'lens',
      scale: 0,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: `bent-${channel}`,
    }),
  );
  const blur = svgElement('feGaussianBlur', { in: 'split', stdDeviation: 0, edgeMode: 'duplicate', result: 'blurred' });
  // The last primitive is the filter's result; `update` rewires it past the stages a frame doesn't need.
  const output = svgElement('feComposite', { in: 'blur-band', in2: 'split', operator: 'over' });
  const filter = svgElement(
    'filter',
    {
      id: WAVE_FILTER_ID,
      x: -FILTER_MARGIN,
      y: -FILTER_MARGIN,
      width: size.width + 2 * FILTER_MARGIN,
      height: size.height + 2 * FILTER_MARGIN,
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    },
    [
      // No direction and no blur wherever a map doesn't reach.
      svgElement('feFlood', { 'flood-color': 'rgb(128,128,0)', result: 'neutral' }),
      pullImage,
      svgElement('feComposite', { in: 'pull-raw', in2: 'neutral', operator: 'over', result: 'pull' }),
      pull,
      ...lensImages,
      lensField,
      ...bends,
      ...bends.flatMap((_, channel) => channelThird(`bent-${channel}`, channel, `third-${channel}`)),
      svgElement('feComposite', { in: 'third-0', in2: 'third-1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg' }),
      svgElement('feComposite', { in: 'rg', in2: 'third-2', operator: 'arithmetic', k2: 1, k3: 1, result: 'thirds' }),
      // Each channel holds a third of its value: scale the colour back up (on unpremultiplied values).
      svgElement('feColorMatrix', {
        in: 'thirds',
        type: 'matrix',
        values: '3 0 0 0 0 0 3 0 0 0 0 0 3 0 0 0 0 0 1 0',
        result: 'split',
      }),
      blur,
      // The lens map's blue channel says where the blur shows.
      svgElement('feColorMatrix', {
        in: 'lens',
        type: 'matrix',
        values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0',
        result: 'blur-mask',
      }),
      svgElement('feComposite', { in: 'blurred', in2: 'blur-mask', operator: 'in', result: 'blur-band' }),
      output,
    ],
  );
  const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' }, [
    svgElement('defs', {}, [filter]),
  ]);
  svg.style.position = 'fixed';
  document.body.appendChild(svg);

  // Red is bent less and blue more than green: the shader's `sl` split, along the bulge.
  const split = 0.5 * config.aberration;
  let wiring = '';
  /** Points `element`'s inputs at other results, touching the DOM only when they change. */
  const wire = (element: SVGElement, inputs: Record<string, string>) =>
    Object.entries(inputs).forEach(([name, value]) => {
      if (element.getAttribute(name) !== value) {
        element.setAttribute(name, value);
      }
    });
  return {
    update: (frame, level) => {
      // The shader samples `p + suck`; feDisplacementMap moves by scale × (channel − ½).
      const pullScale = 2 * frame.pull;
      // The shader samples `p - bulge`, the bulge being `energy × amplitude` at the front.
      const bulge = -2 * frame.energy * config.amplitude;
      const deviation = frame.energy * config.blur * 0.6;
      // Every stage is a pass over the whole scope: only the ones that move a pixel by a visible amount,
      // and that the quality level keeps, run. With none, the snapshots aren't filtered at all.
      const pulling = level < NO_BEND && Math.abs(pullScale) * 0.5 >= MIN_SHIFT;
      const bending = level < NO_BEND && Math.abs(bulge) * 0.5 >= MIN_SHIFT;
      const splitting = level < NO_SPLIT && bending && Math.abs(bulge) * split * 0.5 >= MIN_SHIFT;
      const blurring = level < NO_BLUR && bending && deviation >= MIN_SHIFT;
      const next = `${pulling}${bending}${splitting}${blurring}`;
      if (next !== wiring) {
        wiring = next;
        const pulled = pulling ? 'pulled' : 'SourceGraphic';
        bends.forEach(bend => wire(bend, { in: pulled }));
        const sharp = splitting ? 'split' : bending ? 'bent-1' : pulled;
        wire(blur, { in: sharp });
        wire(output, blurring ? { in: 'blur-band', in2: sharp } : { in: sharp, in2: sharp });
        apply(pulling || bending ? `url(#${WAVE_FILTER_ID})` : 'none');
      }

      if (pulling) {
        place(pullImage, frame.ox, frame.oy, maps.pull.half, maps.pull.half);
        pull.setAttribute('scale', String(pullScale));
      }
      if (bending) {
        const index = nearestLens(maps.lenses, Math.max(frame.radius, 1));
        const lens = maps.lenses[index];
        const stretch = Math.max(frame.radius, 1) / lens.radius;
        // The front is an ellipse, squashed along the band.
        const [halfWidth, halfHeight] = frontRadii(frame, area.sideways, lens.half * stretch);
        place(lensImages[index], frame.ox, frame.oy, halfWidth, halfHeight);
        lensField.setAttribute('in', `lens-${index}`);
        [1 - split, 1, 1 + split].forEach((amount, channel) =>
          bends[channel].setAttribute('scale', String(bulge * amount)),
        );
      }
      if (blurring) {
        blur.setAttribute('stdDeviation', String(deviation));
      }
    },
    remove: () => svg.remove(),
  };
};
