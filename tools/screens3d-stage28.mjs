// Screenshots of crash details, demonstration, rain, drivers and hi-vis. Usage: npm run build && npm run preview, then node tools/screens3d-stage28.mjs
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
  let n = 0, inc;
  while (n++ < 12) { inc = w.spawnIncident('car_accident', { severity: 2 }); if (inc && inc.id % 5 === 0) break; }
  window.__acc = inc;
  window.__openrescue.scene.renderer3d.distance = 22;
  window.__openrescue.scene.centerOn(inc.x + 0.7, inc.y + 0.3);
});
await page.waitForTimeout(3500);
await page.screenshot({ path: 'docs/screenshot-3d-crash.png' });
await page.evaluate(() => {
  const w = window.__openrescue.world;
  const inc = w.spawnIncident('demonstration', { severity: 1 });
  Object.defineProperty(w, 'raining', { get: () => true, configurable: true });
  window.__openrescue.scene.renderer3d.distance = 26;
  const b = w.buildings.get(inc.buildingId); window.__openrescue.scene.centerOn(inc.x, b.y + b.h + 1.2);
});
await page.waitForTimeout(9000);
await page.screenshot({ path: 'docs/screenshot-3d-demo-rain.png' });
await page.evaluate(() => {
  const w = window.__openrescue.world;
  Object.defineProperty(w, 'raining', { get: () => false, configurable: true });
  const pc = [...w.vehicles.values()].find(x => x.defId === 'patrol_car');
  const fe = [...w.vehicles.values()].find(x => x.defId === 'fire_engine');
  w.orderDismount([pc.id, fe.id, [...w.vehicles.values()].find(x => x.defId === 'ambulance').id]);
  window.__openrescue.scene.renderer3d.distance = 14;
  window.__openrescue.scene.centerOn(pc.x, pc.y);
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'docs/screenshot-3d-vehicles.png' });
await browser.close();
