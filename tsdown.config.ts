import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // The timeline comes from distortion-wave itself, so both libraries always play the same wave.
  deps: { neverBundle: [/^distortion-wave/] },
});
