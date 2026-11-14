import type { WaveConfig, WaveFrame } from 'distortion-wave/src/core.js';
import { nearestLens, type WaveMaps } from './maps';
import { OVERFLOW_MARGIN as FILTER_MARGIN, frontRadii } from './plan';

/**
 * The SVG filter both snapshots are drawn through (see styles.ts): what
 * distortion-wave's shader does to the page's pixels, rebuilt from filter primitives. In order:
 * the inhale's pull toward the source, the lens bulging out along the front with red and blue
 * bent by different amounts, and a blur that follows the front.
 */

export const WAVE_FILTER_ID = 'view-transition-wave-filter';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface WaveFilter {
  update: (frame: WaveFrame) => void;
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

/** Keeps one colour channel (and alpha), so the three bent copies can be added back together. */
const channelOnly = (input: string, channel: number, result: string) => {
  const rows = [0, 1, 2].map(row => [0, 1, 2, 3, 4].map(column => (row === channel && column === row ? 1 : 0)));
  const values = [...rows, [0, 0, 0, 1, 0]].map(row => row.join(' ')).join(' ');
  return svgElement('feColorMatrix', { in: input, type: 'matrix', values, result });
};

/** Places a map centred on a point in the scope's px. */
const place = (image: SVGFEImageElement, centerX: number, centerY: number, halfWidth: number, halfHeight: number) => {
  image.setAttribute('x', String(centerX + FILTER_MARGIN - halfWidth));
  image.setAttribute('y', String(centerY + FILTER_MARGIN - halfHeight));
  image.setAttribute('width', String(halfWidth * 2));
  image.setAttribute('height', String(halfHeight * 2));
};

export interface FilterArea {
  width: number;
  height: number;
  /** The front is squashed along y (a band crossing sideways) instead of x. */
  sideways: boolean;
}

/** The filter. `userSpaceOnUse` on a snapshot is its box, which starts FILTER_MARGIN px before the scope's. */
export const mountWaveFilter = (config: WaveConfig, maps: WaveMaps, area: FilterArea): WaveFilter => {
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
  const filter = svgElement(
    'filter',
    {
      id: WAVE_FILTER_ID,
      // The snapshots' boxes are FILTER_MARGIN px wider on every side than the scope (see styles.ts).
      x: 0,
      y: 0,
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
      ...bends.map((_, channel) => channelOnly(`bent-${channel}`, channel, `only-${channel}`)),
      svgElement('feComposite', { in: 'only-0', in2: 'only-1', operator: 'arithmetic', k2: 1, k3: 1, result: 'rg' }),
      svgElement('feComposite', { in: 'rg', in2: 'only-2', operator: 'arithmetic', k2: 1, k3: 1, result: 'split-sum' }),
      // Adding the three copies adds their alpha too, which is only right where the snapshot is opaque:
      // translucent pixels (a shadow, soft edges) would come out up to 3× darker. They keep one copy.
      svgElement('feComponentTransfer', { in: 'bent-1', result: 'opaque' }, [
        svgElement('feFuncA', { type: 'linear', slope: 50, intercept: -49 }),
      ]),
      svgElement('feComposite', { in: 'split-sum', in2: 'opaque', operator: 'in', result: 'split-solid' }),
      svgElement('feComposite', { in: 'bent-1', in2: 'opaque', operator: 'out', result: 'split-soft' }),
      svgElement('feComposite', {
        in: 'split-solid',
        in2: 'split-soft',
        operator: 'arithmetic',
        k2: 1,
        k3: 1,
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
      svgElement('feComposite', { in: 'blur-band', in2: 'split', operator: 'over' }),
    ],
  );
  const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' }, [
    svgElement('defs', {}, [filter]),
  ]);
  svg.style.position = 'fixed';
  document.body.appendChild(svg);

  // Red is bent less and blue more than green: the shader's `sl` split, along the bulge.
  const split = 0.5 * config.aberration;
  return {
    update: frame => {
      place(pullImage, frame.ox, frame.oy, maps.pull.half, maps.pull.half);
      // The shader samples `p + suck`; feDisplacementMap moves by scale × (channel − ½).
      pull.setAttribute('scale', String(2 * frame.pull));

      const index = nearestLens(maps.lenses, Math.max(frame.radius, 1));
      const lens = maps.lenses[index];
      const stretch = Math.max(frame.radius, 1) / lens.radius;
      // The front is an ellipse, squashed along the band.
      const [halfWidth, halfHeight] = frontRadii(frame, area.sideways, lens.half * stretch);
      place(lensImages[index], frame.ox, frame.oy, halfWidth, halfHeight);
      lensField.setAttribute('in', `lens-${index}`);
      // The shader samples `p - bulge`, the bulge being `energy × amplitude` at the front.
      const bulge = -2 * frame.energy * config.amplitude;
      [1 - split, 1, 1 + split].forEach((amount, channel) =>
        bends[channel].setAttribute('scale', String(bulge * amount)),
      );
      blur.setAttribute('stdDeviation', String(frame.energy * config.blur * 0.6));
    },
    remove: () => svg.remove(),
  };
};
