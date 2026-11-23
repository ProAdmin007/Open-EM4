// Close-up of every incident type in 3D (UI hidden), saved to docs/incidents/<id>.png. Usage: npm run build && npm run preview, then node tools/screens3d-incidents.mjs [id...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('docs/incidents', { recursive: true });
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
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
await page.addStyleTag({ content: '#bottom,#topbar,#incidents-panel,.toast,#toasts,#pause-badge,#paused{display:none !important}' });
await page.evaluate(v => { window.__want5 = v; }, !!process.env.WANT5);
const ids = await page.evaluate(() => Object.keys(window.__openrescue.world.content.incidents));
for (const id of ids) {
  if (only.length && !only.includes(id)) continue;
  const res = await page.evaluate(defId => {
    const w = window.__openrescue.world;
    for (const inc of [...w.incidents.values()]) w.incidents.delete(inc.id);
    for (const b of w.buildings.values()) { b.fire = 0; b.damage = 0; b.destroyed = false; }
    const def = w.content.incidents[defId];
    let inc = w.spawnIncident(defId, { severity: def.severity.max });
    for (let k = 0; k < 12 && inc && window.__want5 && inc.id % 5 !== 0; k++) { w.incidents.delete(inc.id); inc = w.spawnIncident(defId, { severity: def.severity.max }); }
    if (!inc) return null;
    window.__openrescue.scene.setSpeed(0);
    const b = inc.buildingId ? w.buildings.get(inc.buildingId) : null;
    const door = b ? b.door : null; const cx = door ? door.x + 0.5 : inc.x, cy = door ? door.y + 0.5 : inc.y;
    window.__openrescue.scene.renderer3d.distance = b ? Math.max(26, (b.w + b.h) * 3) : 14;
    window.__openrescue.scene.centerOn(cx, cy + 0.5);
    return { desc: inc.description, pager: inc.pager };
  }, id);
  if (!res) { console.log('spawn failed', id); continue; }
  await page.evaluate(() => window.__openrescue.scene.setSpeed(1));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__openrescue.scene.setSpeed(0));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/incidents/${id}.png` });
  console.log('ok', id);
}
await browser.close();
