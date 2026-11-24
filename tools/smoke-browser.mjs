// Browser smoke test: plays freeplay in 2D and 3D at high speed with random dispatches, reports console errors and page errors.
// Usage: npm run build && npx vite preview --port 4173, then node tools/smoke-browser.mjs [seconds=60]
import { chromium } from '@playwright/test';
const secs = Number(process.argv[2] ?? 60);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = []; let curMode = 'start';
page.on('pageerror', e => errors.push(`pageerror[${curMode}]: ` + (e.stack || e.message).slice(0, 900)));
page.on('console', m => { if (m.type() === 'error' && !/GL Driver|WebGL|AudioContext|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
page.on('crash', () => errors.push('PAGE CRASH'));
await page.goto('http://localhost:4173/?e2e&fx');
await page.waitForFunction(() => !!window.__openrescue?.scene, undefined, { timeout: 30000 });
await page.getByRole('button', { name: /Freeplay/ }).click();
await page.getByRole('button', { name: /Start Freeplay/ }).click();
await page.waitForFunction(() => window.__openrescue?.scene?.state === 'playing');
for (const mode of (process.env.MODES ?? '2d,3d,2d,3d').split(',')) {
  curMode = mode;
  await page.evaluate(m => window.__openrescue.scene.setViewMode(m), mode);
  await page.evaluate(() => window.__openrescue.scene.setSpeed(4)).catch(() => {});
  const end = Date.now() + secs * 1000 / 4;
  while (Date.now() < end) {
    await page.evaluate(() => {
      const w = window.__openrescue.world, s = window.__openrescue.scene;
      let incs = [...w.incidents.values()]; if (incs.length < 2) { const ids = Object.keys(w.content.incidents); w.spawnIncident(ids[Math.floor(Math.random() * ids.length)]); incs = [...w.incidents.values()]; }
      if (incs.length) { const i = incs[Math.floor(Math.random() * incs.length)]; w.questionCaller(i.id); w.dispatchRecommended(i.id); s.centerOn(i.x, i.y); }
      for (const v of w.vehicles.values()) if (!v.path.length && v.crew.some(id => w.responders.get(id)?.inVehicle) && Math.random() < 0.3 && !w.isParking(Math.floor(v.x), Math.floor(v.y))) w.orderDismount([v.id]);
    }).catch(e => errors.push('eval: ' + e.message.slice(0, 200)));
    await page.waitForTimeout(2500);
  }
  const state = await page.evaluate(() => { const w = window.__openrescue.world; return { t: Math.round(w.time), vehicles: w.vehicles.size, incidents: w.incidents.size, solved: w.solved, failed: w.failed }; }).catch(() => null);
  console.log(mode, JSON.stringify(state));
}
await browser.close();
console.log(errors.length ? `${errors.length} ERROR(S):\n` + [...new Set(errors)].slice(0, 20).join('\n') : 'no console or page errors');
process.exit(errors.length ? 1 : 0);
