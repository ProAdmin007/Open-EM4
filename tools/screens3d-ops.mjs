// 3D screenshots of the operations: aerial ladder at a tall fire and the bomb robot. Usage: npm run build && npm run preview, then node tools/screens3d-ops.mjs
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
await page.locator('[data-act="speed4"]').click().catch(() => {});

// 1) bomb robot at a suspicious package
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  w.time = 120;
  const inc = w.spawnIncident('suspicious_package', { severity: 2 });
  const b = w.buildings.get(inc.buildingId);
  const squad = [...w.vehicles.values()].find(v => v.defId === 'bomb_squad');
  w.orderMove([squad.id], b.door.x + 0.5, b.door.y + 1.5);
  window.__shot = { inc, squadId: squad.id, bx: b.x + b.w / 2, by: b.y + b.h / 2 + b.h / 2 + 1 };
  or.scene.select([squad.id]);
  or.scene.renderer3d.distance = 40; or.scene.centerOn(window.__shot.bx, window.__shot.by);
});
await page.waitForFunction(() => !window.__openrescue.world.vehicles.get(window.__shot.squadId).path.length, undefined, { timeout: 120000 });
await page.evaluate(() => {
  const w = window.__openrescue.world, s = window.__shot;
  const ids = w.orderDismount([s.squadId]);
  w.orderAbility(ids, 'secure', { kind: 'incident', id: s.inc.id });
});
await page.waitForFunction(() => window.__shot.inc.secured, undefined, { timeout: 90000 });
await page.evaluate(() => {
  const w = window.__openrescue.world, s = window.__shot;
  const v = w.vehicles.get(s.squadId);
  w.orderAbility(v.crew, 'defuse', { kind: 'incident', id: s.inc.id });
});
await page.locator('[data-act="speed1"]').click().catch(() => {});
await page.waitForFunction(() => [...window.__openrescue.world.responders.values()].some(r => r.task?.type === 'defuse'), undefined, { timeout: 60000 });
await page.evaluate(() => { const s = window.__shot, or = window.__openrescue; or.scene.renderer3d.distance = 24; or.scene.centerOn(s.inc.x, s.by - 0.2); });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshot-3d-bomb.png' });

// 2) aerial ladder at a high-rise fire
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  const b = [...w.buildings.values()].find(x => x.type === 'apartment' && (x.floors ?? 1) >= 6);
  const inc = w.spawnIncident('apartment_fire', { buildingId: b.id, severity: 2 });
  const v = [...w.vehicles.values()].find(x => x.defId === 'aerial_ladder');
  or.scene.select([v.id]);
  w.orderMove([v.id], b.door.x + 0.5, b.door.y + 1.5);
  window.__shot2 = { vid: v.id, bid: b.id, bx: b.x + b.w / 2, by: b.y + b.h / 2 + 2 };
  or.scene.renderer3d.distance = 70; or.scene.centerOn(window.__shot2.bx, window.__shot2.by);
});
await page.locator('[data-act="speed4"]').click().catch(() => {});
await page.waitForFunction(() => !window.__openrescue.world.vehicles.get(window.__shot2.vid).path.length, undefined, { timeout: 120000 });
await page.evaluate(() => {
  const w = window.__openrescue.world, s = window.__shot2;
  const ids = w.orderDismount([s.vid]);
  w.orderAbility(ids, 'extinguish', { kind: 'building', id: s.bid });
});
await page.waitForFunction(() => window.__openrescue.world.aerialActive(window.__shot2.bid), undefined, { timeout: 60000 });
await page.locator('[data-act="speed1"]').click().catch(() => {});
await page.evaluate(() => { const w = window.__openrescue.world, v = w.vehicles.get(window.__shot2.vid), or = window.__openrescue; or.scene.renderer3d.distance = 44; or.scene.centerOn(v.x, v.y - 3); });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'docs/screenshot-3d-aerial.png' });
await browser.close();
