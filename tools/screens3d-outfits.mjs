// Lines up one responder of every role for a look at the outfits. Usage: npm run build && npm run preview, then node tools/screens3d-outfits.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
for (let i = 0; i < 8; i++) {
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
await page.evaluate(() => {
  const w = window.__openrescue.world;
  w.orderDismount([...w.vehicles.keys()]);
  const seen = new Set(); const pick = [];
  for (const r of w.responders.values()) if (!seen.has(r.role)) { seen.add(r.role); pick.push(r); }
  // find a free row of grass
  let spot = null;
  for (let y = 4; y < w.h - 4 && !spot; y++) for (let x = 4; x < w.w - 20 && !spot; x++) { let ok = true; for (let i = 0; i < 16 && ok; i++) if (!w.isWalkable(x + i, y) || w.isRoad(x + i, y) || w.isParking(x + i, y)) ok = false; if (ok) spot = { x, y }; }
  window.__roles = pick.map(r => r.role);
  pick.forEach((r, i) => { r.x = r.px = spot.x + 1 + i * 1.1; r.y = r.py = spot.y + 0.5; r.path = []; r.task = null; });
  w.paused = true;
  window.__openrescue.scene.renderer3d.distance = 26;
  window.__openrescue.scene.centerOn(spot.x + 1 + pick.length * 0.55, spot.y + 1.2);
});
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => JSON.stringify([...window.__openrescue.world.responders.values()].filter(r => !r.inVehicle).slice(0, 6).map(r => [r.role, +r.x.toFixed(1), +r.y.toFixed(1), r.task?.type]))));
await page.screenshot({ path: 'docs/screenshot-3d-outfits.png' });
console.log(await page.evaluate(() => window.__roles.join(', ')));
await browser.close();
