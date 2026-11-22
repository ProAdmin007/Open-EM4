// Arrest sequence: flee, pistol, hands up, cuffed escort. Usage: npm run build && npm run preview, then node tools/screens3d-arrest.mjs
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
  const inc = w.spawnIncident('armed_robbery', { severity: 1 });
  const s = w.suspects.get(inc.suspects[0]); s.runner = true; s.obey = true; s.arrestTime = 3; window.__s = s.id;
  for (const id of inc.suspects.slice(1)) w.suspects.delete(id);
  const car = [...w.vehicles.values()].find(v => v.defId === 'patrol_car');
  let best = null, bd = 99;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = Math.floor(s.x) + dx, y = Math.floor(s.y) + dy; if (w.isRoad(x, y) && !w.isIntersection(x, y) && Math.hypot(dx, dy) < bd && Math.hypot(dx, dy) > 3) { bd = Math.hypot(dx, dy); best = { x, y }; } }
  car.path = []; car.dest = null; car.x = car.px = best.x + 0.5; car.y = car.py = best.y + 0.5; car.angle = w.laneAngle(best.x, best.y);
  const out = w.orderDismount([car.id]);
  const cop = w.responders.get(out[0]); cop.x = cop.px = s.x - 4.5; cop.y = cop.py = s.y; cop.path = [];
  w.orderAbility([cop.id], 'arrest', { kind: 'suspect', id: s.id });
  window.__cop = cop.id; window.__car = car.id;
  window.__openrescue.scene.renderer3d.distance = 20;
  window.__openrescue.scene.centerOn(s.x - 2, s.y);
});
for (const [name, cond] of [['fleeing', 'fleeing'], ['surrender', 'surrender'], ['escorted', 'escorted']]) {
  await page.waitForFunction(c => { const w = window.__openrescue.world, s = w.suspects.get(window.__s); if (!s) return true; const st = s.arrested ? (s.mode === 'escorted' ? 'escorted' : 'arrested') : s.mode === 'flee' ? 'fleeing' : s.mode; return st === c; }, cond, { timeout: 120000, polling: 100 }).catch(() => {});
  await page.evaluate(() => { const w = window.__openrescue.world, s = w.suspects.get(window.__s); if (s) window.__openrescue.scene.centerOn(s.x, s.y); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/screenshot-3d-arrest-${name}.png` });
  console.log(name, await page.evaluate(() => { const s = window.__openrescue.world.suspects.get(window.__s); return s ? s.mode + ' ' + s.arrested : 'gone'; }));
}
await browser.close();
