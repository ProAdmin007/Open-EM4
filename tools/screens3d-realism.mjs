// 3D screenshots of burning buildings and medical / accident scenes. Usage: npm run build && npm run preview, then node tools/screens3d-realism.mjs
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

// 1) a big house fire at dusk
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  w.time = 560; // late afternoon, light fading
  const inc = w.spawnIncident('house_fire', { severity: 3 });
  const b = w.buildings.get(inc.buildingId);
  b.fire = 70; b.resistance = 40; // keep it burning
  or.scene.renderer3d.distance = 55; or.scene.centerOn(b.x + b.w / 2, b.y + b.h / 2 + 3);
});
await speed(1);
await page.waitForTimeout(5000);
await page.screenshot({ path: 'docs/screenshot-3d-fire-big.png' });
await page.evaluate(() => { const w = window.__openrescue.world; w.time = 700; });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshot-3d-fire-night.png' });
await page.evaluate(() => { const w = window.__openrescue.world; w.time = 60; for (const b of w.buildings.values()) { b.fire = 0; } });

// 2) road accident: wrecks, tyre marks, glass, steam; the ambulance crew treats a casualty, rear doors open
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  const inc = w.spawnIncident('car_accident', { severity: 2 });
  const amb = [...w.vehicles.values()].find(v => v.defId === 'ambulance');
  w.orderMove([amb.id], inc.x, inc.y + 1);
  window.__m = { inc, ambId: amb.id };
  or.scene.renderer3d.distance = 30; or.scene.renderer3d.yaw = 3.6; or.scene.centerOn(inc.x + 1, inc.y);
});
await page.waitForTimeout(3000);
await page.screenshot({ path: 'docs/screenshot-3d-accident.png' });
await speed(4);
await page.waitForFunction(() => !window.__openrescue.world.vehicles.get(window.__m.ambId).path.length, undefined, { timeout: 120000 });
await page.evaluate(() => {
  const w = window.__openrescue.world, m = window.__m;
  const ids = w.orderDismount([m.ambId]);
  const v = [...w.victims.values()].find(x => x.incidentId === m.inc.id);
  m.victimId = v.id;
  w.orderAbility(ids, 'treat', { kind: 'victim', id: v.id });
});
await speed(1);
await page.waitForFunction(() => { const w = window.__openrescue.world, v = w.victims.get(window.__m.victimId); return v && [...w.responders.values()].some(r => r.task?.type === 'treat' && Math.hypot(r.x - v.x, r.y - v.y) < 1.5); }, undefined, { timeout: 90000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/screenshot-3d-medical.png' });
await browser.close();
