import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the tests don't start the Cloudflare and PWA plugins.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
