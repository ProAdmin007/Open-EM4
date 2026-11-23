// Night + rain look: node tools/screens3d-night.mjs (needs npm run build && npm run preview). Saves docs/incidents/night-*.png
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 200)); });
for (let i = 0; i < 8; i++) {
  await page.addInitScript(() => localStorage.setItem('openrescue.shadows', '0'));
  await page.goto('http://localhost:4173/?e2e&fx');
  await page.waitForFunction(() => !!window.__openrescue?.scene, undefined, { timeout: 15000 }).catch(() => {});
  const a = await page.evaluate(() => window.__openrescue?.game?.loop?.frame ?? -1);
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => window.__openrescue?.game?.loop?.frame ?? -1);
  if (a >= 0 && b > a + 3) break;
}
await page.getByRole('button', { name: /Freeplay/ }).click();
await page.getByRole('button', { name: /Start Freeplay/ }).click();
await page.waitForFunction(() => window.__openrescue?.scene?.state === 'playing');
await page.evaluate(() => window.__openrescue.scene.setViewMode('3d'));
await page.waitForFunction(() => !!window.__openrescue.scene.renderer3d);
await page.addStyleTag({ content: '#bottom,#topbar,#incidents-panel,.toast,#toasts{display:none !important}' });
await page.evaluate(() => {
  const w = window.__openrescue.world, r = window.__openrescue.scene.renderer3d;
  r.env.enabled = true; w.time = 936; // night
  r.distance = 20;
  const c = [...w.civilians.values()][0];
  window.__openrescue.scene.centerOn(c.x, c.y);
  for (const v of w.vehicles.values()) { v.lights = true; }
});
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => { const r = window.__openrescue.scene.renderer3d; let n=0,v=0; r.scene.traverse(o=>{ if(o.name==='nightfx'){n++; if(o.visible)v++;} }); return {n,v,night:r.env.night}; }));
await page.screenshot({ path: 'docs/incidents/night-cars.png' });
await browser.close();
