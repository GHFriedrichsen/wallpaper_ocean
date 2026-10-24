// Renders the wallpaper in headless Chromium with a mocked weather API and saves
// screenshots. Usage: node scripts/preview.mjs [outDir] [scenario...]
// Scenario format: name:query, e.g. "storm:weather=storm&time=night".
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Playwright is resolved via require() so a globally installed copy works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve('wallpaper');
const outDir = process.argv[2] || 'shots';
const scenarios = process.argv.slice(3).map((s) => s.split(':'));
if (!scenarios.length) scenarios.push(['live', '']);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const now = Math.floor(Date.now() / 1000);
const day = 86400;
const forecast = {
  current: {
    temperature_2m: 24.3, relative_humidity_2m: 71, is_day: 1, weather_code: 2, cloud_cover: 40,
    precipitation: 0, rain: 0, snowfall: 0, wind_speed_10m: 4.2, wind_direction_10m: 120, wind_gusts_10m: 7,
  },
  daily: {
    sunrise: [-1, 0, 1].map((d) => now - 4 * 3600 + d * day),
    sunset: [-1, 0, 1].map((d) => now + 8 * 3600 + d * day),
  },
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.route('**/geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'São Paulo', latitude: -23.55, longitude: -46.63 }] } }));
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ json: forecast }));

for (const [name, query] of scenarios) {
  await page.goto(`http://localhost:${port}/?${query || ''}`);
  await page.waitForTimeout(4000);
  await page.mouse.move(640, 330);
  await page.mouse.move(700, 360, { steps: 8 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${name}.jpg`), quality: 88 });
  console.log(`saved ${name}`);
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
server.close();
