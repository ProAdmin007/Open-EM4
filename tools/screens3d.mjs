// Takes the 3D README screenshots. Usage: npm run build && npm run preview, then node tools/screens3d.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
for (let i = 0; i < 8; i++) { // the first software-GL context after a browser start is sometimes lost
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
await page.evaluate(() => { window.__openrescue.scene.renderer3d.distance = 130; window.__openrescue.scene.centerOn(55, 40); });
await page.waitForTimeout(5000);
await page.screenshot({ path: 'docs/screenshot-3d-city.png' });
await page.evaluate(() => {
  const or = window.__openrescue; const w = or.world;
  const inc = w.spawnIncident('house_fire', { severity: 2 });
  const b = w.buildings.get(inc.buildingId);
  const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine');
  or.scene.select([v.id]); window.__eng = v.id;
  w.contextOrder([v.id], b.x + b.w / 2, b.y + b.h / 2); window.__fireDoor = b.door;
  or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2 + 2);
  or.scene.renderer3d.distance = 52; or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2 + 1);
});
await page.locator('[data-act="speed4"]').click().catch(() => {});
await page.waitForFunction(() => { const w = window.__openrescue.world, v = w.vehicles.get(window.__eng); return v && !v.path.length && Math.hypot(v.x - window.__fireDoor.x, v.y - window.__fireDoor.y) < 6; }, undefined, { timeout: 120000, polling: 100 });
await page.keyboard.press('b');
await page.waitForFunction(() => [...window.__openrescue.world.responders.values()].some(r => r.task?.type === 'extinguish' && r.task.deploy >= 2.5), undefined, { timeout: 90000 });
await page.locator('[data-act="speed1"]').click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshot-3d-fire.png' });
await page.evaluate(() => { window.__openrescue.world.time = 770; });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshot-3d-night.png' });
await browser.close();
