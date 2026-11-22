// 3D screenshots: the stretcher slides into the ambulance, the tow truck lifts a wreck, the hearse collects. Usage: npm run build && npm run preview, then node tools/screens3d-ops2.mjs
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
// loading: put the ambulance at a casualty and pause in the middle of the slide-in
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  w.time = 100;
  const inc = w.spawnIncident('car_accident', { severity: 1 });
  const v = [...w.victims.values()].find(x => x.incidentId === inc.id);
  v.treated = true;
  const amb = [...w.vehicles.values()].find(x => x.defId === 'ambulance');
  const ids = w.orderDismount([amb.id]);
  const m = w.responders.get(ids[0]);
  amb.x = amb.px = inc.x - 1.5; amb.y = amb.py = inc.y + 1.5; amb.angle = 0;
  m.x = m.px = inc.x + 0.5; m.y = m.py = inc.y + 1.2; m.inVehicle = false; m.path = [];
  v.x = v.px = inc.x; v.y = v.py = inc.y + 1.0;
  w.orderAbility([ids[0]], 'carry', { kind: 'victim', id: v.id });
  window.__s = { vid: v.id, ambId: amb.id };
  or.scene.renderer3d.distance = 14; or.scene.renderer3d.yaw = 5.2; or.scene.centerOn(amb.x, amb.y);
});
await page.waitForFunction(() => { const v = window.__openrescue.world.victims.get(window.__s.vid); return v && v.loadT > 0.55; }, undefined, { timeout: 60000, polling: 40 });
await page.evaluate(() => window.__openrescue.scene.setSpeed(0));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshot-3d-loading.png' });
await browser.close();
