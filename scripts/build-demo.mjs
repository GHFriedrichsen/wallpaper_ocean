// Builds a single self-contained HTML page (web demo for phones/browsers) by
// inlining wallpaper/app.js into web/demo.template.html.
// Usage: node scripts/build-demo.mjs [outFile]   (run `npm run build` first)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const out = process.argv[2] || 'web/dist/ocean-cube.html';
const [template, app] = await Promise.all([
  readFile('web/demo.template.html', 'utf8'),
  readFile('wallpaper/app.js', 'utf8'),
]);
if (/<\/script/i.test(app)) throw new Error('app.js contains a closing script tag; cannot inline it');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, template.replace('<!-- APP_JS -->', () => `<script>\n${app}\n</script>`));
console.log(`wrote ${out}`);
