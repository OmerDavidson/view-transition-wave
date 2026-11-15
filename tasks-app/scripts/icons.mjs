// Renders the PNG app icons from public/icon.svg: node scripts/icons.mjs
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Playwright isn't a dependency; run with NODE_PATH pointing at a global install.
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const inner = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(file, size, maskable) {
  // Maskable icons need their content inside the central 80% safe zone, on a full-bleed background.
  const body = maskable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" fill="#5b5bd6"/><g transform="translate(6.4 6.4) scale(0.8)">${inner.replace(/<rect width="64" height="64" rx="16" fill="#5b5bd6"\/>/, '')}</g></svg>`
    : svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${body}`);
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: !maskable });
}

await render('icon-192.png', 192, false);
await render('icon-512.png', 512, false);
await render('icon-maskable-512.png', 512, true);
await render('apple-touch-icon.png', 180, true);
await browser.close();
