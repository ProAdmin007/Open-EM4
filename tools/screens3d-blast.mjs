// 3D screenshots of the explosion and of a traffic cordon. Usage: npm run build && npm run preview, then node tools/screens3d-blast.mjs
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

// cordon: a secured crash scene closes the street; the barriers stand at the edge
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  w.time = 100;
  const inc = w.spawnIncident('car_accident', { severity: 2 });
  inc.secured = true; w.rebuildCordon();
  or.scene.renderer3d.distance = 44; or.scene.renderer3d.yaw = 3.6; or.scene.centerOn(inc.x, inc.y);
});
await page.waitForTimeout(4000);
await page.screenshot({ path: 'docs/screenshot-3d-cordon.png' });

// explosion: the package goes off
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  const inc = w.spawnIncident('suspicious_package', { severity: 2 });
  const b = w.buildings.get(inc.buildingId);
  inc.elapsed = 1e6; // fails on the next tick -> explosion
  or.scene.renderer3d.distance = 46; or.scene.renderer3d.yaw = 3.6; or.scene.centerOn(inc.x, inc.y + 1);
});
await page.waitForTimeout(450);
await page.screenshot({ path: 'docs/screenshot-3d-explosion.png' });
await browser.close();
