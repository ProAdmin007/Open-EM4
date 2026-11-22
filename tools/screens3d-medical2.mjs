// 3D screenshots of a medical call (relative waiting, casualty carried on the trolley) and a house fire with soot. Usage: npm run build && npm run preview, then node tools/screens3d-medical2.mjs
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
const speed = n => page.locator(`[data-act="speed${n}"]`).click().catch(() => {});
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  w.time = 120;
  const inc = w.spawnIncident('cardiac_arrest', { severity: 3 }) ?? w.spawnIncident('fall_injury', { severity: 2 });
  window.__m = { incId: inc.id };
  const v = [...w.victims.values()].find(x => x.incidentId === inc.id);
  v.transport = 'scene'; v.x = v.px = (inc.x); v.y = v.py = inc.y + 2;
  const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance');
  window.__m.vid = v.id; window.__m.amb = amb.id;
  or.scene.renderer3d.distance = 14; or.scene.renderer3d.yaw = 5.3; or.scene.centerOn(v.x, v.y);
});
await page.waitForTimeout(3500);
await page.screenshot({ path: 'docs/screenshot-3d-medical-home.png' });
// carried casualty: pause the game and put a paramedic next to the (treated) casualty carrying it
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world, m = window.__m;
  const v = w.victims.get(m.vid);
  const ids = w.orderDismount([m.amb]);
  const r = w.responders.get(ids[0]);
  r.x = r.px = v.x - 1.2; r.y = r.py = v.y; r.angle = 0.4; r.path = []; r.task = null;
  v.treated = true; v.transport = 'carried'; v.carriedBy = r.id; r.carrying = v.id; v.x = v.px = r.x; v.y = v.py = r.y;
  or.scene.setSpeed(0);
  or.scene.renderer3d.distance = 12; or.scene.renderer3d.yaw = 5.0; or.scene.centerOn(r.x + 0.6, r.y);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshot-3d-medical-carry.png' });
await browser.close();
