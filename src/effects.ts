import { PALETTES, hexToOklab, type WaveConfig, type WaveFrame } from 'distortion-wave/src/core.js';
import type { ScopeBox } from './plan';

/**
 * The light of the wave, drawn on a transparent WebGL canvas over the scope: the coloured band riding
 * the front, the rim and hairline lighting the scope's edges, and the sparks. Ported from the
 * effects half of distortion-wave's shader (`renderer.js`, MIT © Lucas Bonomi); the page's pixels
 * themselves are bent by the SVG filter (waveFilter.ts).
 */

export const WAVE_LIGHT_TRANSITION_NAME = 'view-transition-wave-light';

const VERTEX_FULL = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// Colours are premultiplied: the canvas is transparent over the page.
const FRAGMENT_LIGHT = `#version 300 es
precision highp float; precision highp int;
uniform vec2 uSize, uRes;
uniform vec4 uShape, uRadii;   // radii: bottom-right, top-right, bottom-left, top-left
uniform bool uRing;
uniform vec2 uOrigin;
uniform float uTilt, uSpine, uRadius, uSquash, uTime, uSwell, uGlow, uRim, uClear, uHairClear, uHold, uK;
uniform float uLead, uTail, uBand, uRimW, uRimSoft, uUneven, uHairW;
uniform vec3 uPal[8]; uniform int uPalN;
out vec4 outColor;
const float TAU = 6.28318530718;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); return mix(h11(i), h11(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0; }
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw; r.x = (p.y > 0.0) ? r.x : r.y;
  vec2 q = abs(p) - b + r.x; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}
struct Front { float d; vec2 n; vec2 q; float g; };
Front front(vec2 p) {
  vec2 q = rot(-uTilt) * (p - uOrigin); float mx = q.x * uSquash;
  vec2 v = vec2(max(abs(mx) - uSpine, 0.0), q.y); float len = max(length(v), 1e-3);
  vec2 grad = vec2(v.x * sign(q.x) * uSquash, v.y) / len; float g = max(length(grad), 1e-3);
  float wob;
  if (uRing) { float a = atan(q.y, q.x); wob = 0.5 * sin(3.0 * a + uTime * 1.3) + 0.3 * sin(5.0 * a - uTime * 0.9 + 2.1) + 0.2 * sin(2.0 * a + uTime * 2.0); }
  else { float s = mx * 0.005 / uK; wob = 0.7 * vnoise(s + uTime * 0.8) + 0.3 * vnoise(s * 2.3 - uTime * 1.1 + 5.0); }
  Front f; f.d = (len - uRadius) / g + uSwell * wob; f.n = rot(uTilt) * (grad / g); f.q = q; f.g = g; return f;
}
vec3 paletteAt(float u) {
  float x = fract(u) * float(uPalN); int i = min(int(floor(x)), uPalN - 1); int j = (i + 1) % uPalN;
  return mix(uPal[i], uPal[j], smoothstep(0.0, 1.0, fract(x)));
}
vec3 oklabToSrgb(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = clamp(vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), 0.0, 1.0);
  return mix(12.92 * lin, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * (uSize.x / uRes.x);
  float dn = (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  vec2 c = p - (uShape.xy + uShape.zw * 0.5);
  float sd = sdRoundBox(c, uShape.zw * 0.5, uRadii);
  float mask = clamp(0.5 - sd * (uRes.x / uSize.x), 0.0, 1.0);
  Front f = front(p);
  float rl = max(length(p - uOrigin), 1.0);
  float held = uHold > 0.0 ? smoothstep(uHold * 0.9, uHold * 1.8, rl) : 1.0;
  float inset = max(-sd, 0.0);
  float along = f.q.x * 0.0065 / uK, ang = atan(f.q.y, f.q.x);
  float lobes = uRing ? 0.5 + 0.5 * sin(2.0 * ang + uTime * 1.4) * cos(ang - uTime * 0.6 + 0.8)
                      : 0.5 + 0.5 * sin(along * 1.4 + uTime * 1.3) * cos(along * 0.7 - uTime * 0.6 + 0.8);
  float bandA = 0.0;
  if (uGlow > 0.0 && f.d < uLead) {
    if (f.d >= 0.0) { float x = f.d / uLead; bandA = exp(-4.5 * x * x); }
    else { float x = clamp(-f.d / (uTail * mix(0.55, 1.35, lobes)), 0.0, 1.0); bandA = pow(1.0 - x, 2.4); }
    bandA *= uGlow * uBand * held;
  }
  float around = atan(c.y / uShape.w, c.x / uShape.z);
  float rimA = 0.0, hairA = 0.0, shimmer = 0.5;
  if (uRim > 0.0 && inset < uRimW * 4.5) {
    float lumps = 0.5 * sin(around * 3.0 + uTime * 0.7) + 0.3 * sin(around * 5.0 - uTime * 1.2 + 2.0) + 0.2 * sin(around * 9.0 + uTime * 2.3 + 4.0);
    float thick = max(1.0 + uUneven * 0.55 * lumps, 0.15);
    float hk = inset / (uRimW * thick);
    float reached = 1.0 - smoothstep(-uLead * 0.6, uLead * 0.4, f.d);
    float kept = smoothstep(-uRimSoft, uRimSoft, f.d + (uRadius - uClear) / f.g);
    shimmer = 0.5 + 0.5 * sin(uTime * 3.2 - around * 4.0);
    rimA = exp(-hk * hk) * reached * kept * uRim * (0.72 + 0.28 * shimmer);
    float line = 1.0 - smoothstep(uHairW * 0.5, uHairW * 0.5 + 0.8, inset);
    float hairKept = smoothstep(-uRimSoft, uRimSoft, f.d + (uRadius - uHairClear) / f.g);
    hairA = line * reached * hairKept * uRim * 0.85 * mix(0.55, 1.0, smoothstep(0.2, 1.4, thick));
  }
  float a = (1.0 - (1.0 - bandA) * (1.0 - rimA)) * mask;
  hairA *= mask;
  if (a + hairA < 0.0005) { outColor = vec4(0.0); return; }
  float flow = 0.6 + (uRing ? ang / TAU : along * 0.22) + uTime * 0.12 + f.d * 0.0016 / uK;
  vec3 lab = paletteAt(flow);
  lab.x += 0.10 * exp(-pow((f.d - 28.0 * uK) / (48.0 * uK), 2.0)) - 0.12 * exp(-pow((f.d + 90.0 * uK) / (70.0 * uK), 2.0));
  lab.yz *= 1.2;
  lab = mix(lab, vec3(0.985, 0.0, 0.0), 0.65 * exp(-pow((f.d + 6.0 * uK) / max(24.0 * uK, 3.0), 2.0)));
  vec3 rimLab = paletteAt(around / TAU + uTime * 0.25 + inset * 0.0012 / uK); rimLab.yz *= 1.1;
  lab = mix(lab, rimLab, rimA / (rimA + bandA + 1e-4));
  float ea = clamp(a, 0.0, 1.0);
  vec4 o = vec4(oklabToSrgb(lab) * ea, ea);
  float ha = clamp(hairA, 0.0, 1.0);
  o = vec4(mix(oklabToSrgb(rimLab), vec3(1.0), 0.6 + 0.35 * shimmer) * ha, ha) + o * (1.0 - ha);
  outColor = vec4(o.rgb + dn * 2.0 * o.a, o.a);
}`;

const VERTEX_DOTS = `#version 300 es
layout(location = 0) in vec4 aDot; uniform vec2 uSize; uniform float uDpr; out float vA; out float vR; out float vPt;
void main() { gl_Position = vec4(aDot.x / uSize.x * 2.0 - 1.0, 1.0 - aDot.y / uSize.y * 2.0, 0.0, 1.0);
  vPt = ceil((aDot.z + 1.0) * uDpr) + 2.0; gl_PointSize = vPt; vR = aDot.z * 0.5 * uDpr; vA = aDot.w; }`;
const FRAGMENT_DOTS = `#version 300 es
precision highp float; in float vA; in float vR; in float vPt; out vec4 o;
void main() { float r = length(gl_PointCoord - 0.5) * vPt; float cov = clamp(vR - r + 0.5, 0.0, 1.0); o = vec4(vec3(cov * vA), cov * vA); }`;

export interface WaveEffects {
  /** Puts the canvas in the document, over the scope, as a layer of the transition. */
  attach: () => void;
  /** Takes the canvas out of the transition, so it stays over the live page while the light fades. */
  leaveTransition: () => void;
  /** Draws one frame; `dots` holds x, y, size, alpha per spark. */
  render: (frame: WaveFrame, dots: Float32Array, dotCount: number) => void;
  /** Draws at this fraction of the full resolution from the next frame (the light is soft). */
  setResolution: (fraction: number) => void;
  /** Moves the canvas over the scope again (after a scroll). */
  place: (left: number, top: number) => void;
  remove: () => void;
}

const compile = (gl: WebGL2RenderingContext, vertex: string, fragment: string) => {
  const program = gl.createProgram();
  [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ].forEach(([type, source]) => {
    const shader = gl.createShader(type as number);
    if (!shader) {
      throw new Error('dev mode wave: no shader');
    }
    gl.shaderSource(shader, source as string);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'dev mode wave: shader compile');
    }
    gl.attachShader(program, shader);
  });
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'dev mode wave: shader link');
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!locations.has(name)) {
      locations.set(name, gl.getUniformLocation(program, name));
    }
    return locations.get(name) ?? null;
  };
  return { program, uniform };
};

const paletteOf = (config: WaveConfig): string[] => {
  const { palette } = config;
  if (Array.isArray(palette) && palette.length > 0) {
    return palette;
  }
  return PALETTES[palette as keyof typeof PALETTES] ?? PALETTES.aurora;
};

interface Renderer {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  light: ReturnType<typeof compile>;
  dots: ReturnType<typeof compile>;
  fullScreen: WebGLVertexArrayObject | null;
  dotArray: WebGLVertexArrayObject | null;
  dotBuffer: WebGLBuffer | null;
  /** The wave drawing with it now. */
  owner: object | null;
}

/**
 * One canvas and WebGL context for every wave: compiling the shaders takes tens of ms (more on some
 * GPUs), which would otherwise delay the start of each wave. `undefined` until first asked for, `null`
 * without WebGL2.
 */
let shared: Renderer | null | undefined;

const renderer = (): Renderer | null => {
  if (shared !== undefined) {
    return shared;
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) {
    shared = null;
    return shared;
  }
  let light: ReturnType<typeof compile>;
  let dots: ReturnType<typeof compile>;
  try {
    light = compile(gl, VERTEX_FULL, FRAGMENT_LIGHT);
    dots = compile(gl, VERTEX_DOTS, FRAGMENT_DOTS);
  } catch {
    shared = null;
    return shared;
  }
  const fullScreen = gl.createVertexArray();
  const dotArray = gl.createVertexArray();
  const dotBuffer = gl.createBuffer();
  gl.bindVertexArray(dotArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);
  canvas.setAttribute('aria-hidden', 'true');
  // A lost context (the GPU was reset) is built again for the next wave.
  canvas.addEventListener('webglcontextlost', () => {
    if (shared?.canvas === canvas) {
      shared = undefined;
    }
  });
  shared = { canvas, gl, light, dots, fullScreen, dotArray, dotBuffer, owner: null };
  return shared;
};

/** Compiles the shaders ahead of the first wave. */
export const prepareEffects = (): void => {
  renderer();
};

/** A canvas over the scope with the wave's light, or null without WebGL2 (the page still bends). */
export const createWaveEffects = (config: WaveConfig, box: ScopeBox): WaveEffects | null => {
  const found = renderer();
  if (!found) {
    return null;
  }
  const { canvas, gl, light, dots, fullScreen, dotArray, dotBuffer } = found;
  const lease = {};
  found.owner = lease;
  /** Whether this wave still has the canvas: a later wave may have taken it. */
  const owns = () => found.owner === lease && shared === found;

  const fullDpr = Math.min(window.devicePixelRatio || 1, 2);
  let dpr = fullDpr;
  const { width, height } = box;
  const resize = () => {
    // Setting the size also clears what the last wave drew.
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
  };
  resize();
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    margin: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    zIndex: '2147483000',
    viewTransitionName: WAVE_LIGHT_TRANSITION_NAME,
  });

  const colors = paletteOf(config);
  const palette = new Float32Array(24);
  colors.slice(0, 8).forEach((hex, index) => palette.set(hexToOklab(hex), index * 3));

  const render = (frame: WaveFrame, dotData: Float32Array, dotCount: number) => {
    if (!owns()) {
      return;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(light.program);
    const { uniform } = light;
    gl.uniform2f(uniform('uSize'), width, height);
    gl.uniform2f(uniform('uRes'), canvas.width, canvas.height);
    gl.uniform4f(uniform('uShape'), 0, 0, width, height);
    const { radii } = box;
    gl.uniform4f(uniform('uRadii'), radii.bottomRight, radii.topRight, radii.bottomLeft, radii.topLeft);
    gl.uniform1i(uniform('uRing'), frame.ring ? 1 : 0);
    gl.uniform2f(uniform('uOrigin'), frame.ox, frame.oy);
    const values: Record<string, number> = {
      uTilt: frame.tilt,
      uSpine: frame.spine,
      uRadius: frame.radius,
      uSquash: frame.squash,
      uTime: frame.time,
      uSwell: frame.swell,
      uGlow: frame.glow,
      uRim: frame.rim,
      uClear: frame.clear,
      uHairClear: frame.hairClear,
      uHold: frame.hold,
      uK: config.k,
      uLead: config.lead,
      uTail: config.tail,
      uBand: config.band,
      uRimW: config.rimWidth,
      uRimSoft: config.rimSoftness,
      uUneven: config.uneven,
      uHairW: config.hairWidth,
    };
    Object.entries(values).forEach(([name, value]) => gl.uniform1f(uniform(name), value));
    gl.uniform3fv(uniform('uPal[0]'), palette);
    gl.uniform1i(uniform('uPalN'), Math.min(colors.length, 8));
    gl.bindVertexArray(fullScreen);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (dotCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(dots.program);
      gl.uniform2f(dots.uniform('uSize'), width, height);
      gl.uniform1f(dots.uniform('uDpr'), dpr);
      gl.bindVertexArray(dotArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, dotData.subarray(0, dotCount * 4), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, dotCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  };

  return {
    attach: () => {
      if (owns()) {
        document.body.appendChild(canvas);
      }
    },
    leaveTransition: () => {
      if (owns()) {
        canvas.style.viewTransitionName = '';
      }
    },
    render,
    setResolution: (fraction) => {
      if (owns()) {
        dpr = fullDpr * fraction;
        resize();
      }
    },
    place: (left, top) => {
      if (owns()) {
        canvas.style.left = `${left}px`;
        canvas.style.top = `${top}px`;
      }
    },
    remove: () => {
      if (owns()) {
        found.owner = null;
        canvas.remove();
      }
    },
  };
};
