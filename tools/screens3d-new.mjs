// 3D screenshots: selected units with label, traffic with brake lights/cyclists, assisting firefighter. Usage: npm run build && npm run preview, then node tools/screens3d-new.mjs
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
// 1) traffic at a junction + a selected engine crew
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  const eng = [...w.vehicles.values()].find(v => v.defId === 'fire_engine');
  const ids = w.orderDismount([eng.id]);
  or.scene.select([ids[1], ids[2]]);
  or.scene.renderer3d.distance = 20; or.scene.renderer3d.yaw = 5.2; or.scene.centerOn(eng.x, eng.y);
});
await page.waitForTimeout(3500);
await page.screenshot({ path: 'docs/screenshot-3d-selected.png' });
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  const c = w.civilians.find(c => c.type === 'bike') ?? w.civilians[0];
  or.scene.select([]);
  or.scene.renderer3d.distance = 24; or.scene.centerOn(c.x, c.y);
});
await page.waitForTimeout(3000);
await page.screenshot({ path: 'docs/screenshot-3d-traffic.png' });
await browser.close();
