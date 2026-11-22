// Takes the 2D hero screenshots (city overview and a close-up). Usage: npm run build && npm run preview, then node tools/screens2d-city.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
for (let i = 0; i < 8; i++) {
  await page.goto('http://localhost:4173/?e2e');
  await page.waitForFunction(() => !!window.__openrescue?.scene, undefined, { timeout: 15000 }).catch(() => {});
  const a = await page.evaluate(() => window.__openrescue?.game?.loop?.frame ?? -1);
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => window.__openrescue?.game?.loop?.frame ?? -1);
  if (a >= 0 && b > a + 3) break;
}
await page.getByRole('button', { name: /Freeplay/ }).click();
await page.getByRole('button', { name: /Start Freeplay/ }).click();
await page.waitForFunction(() => window.__openrescue?.scene?.state === 'playing');
await page.locator('[data-act="speed4"]').click().catch(() => {});
await page.evaluate(() => {
  const or = window.__openrescue, w = or.world;
  for (const t of ['house_fire', 'car_accident', 'burglary']) w.spawnIncident(t, { severity: 2 });
  const inc = [...w.incidents.values()][0];
  or.scene.cameras.main.setZoom(0.5);
  or.scene.centerOn(inc.x, inc.y);
});
await page.waitForTimeout(9000);
await page.screenshot({ path: 'docs/screenshot-city.png' });
await page.evaluate(() => { const or = window.__openrescue, inc = [...or.world.incidents.values()][0]; or.scene.cameras.main.setZoom(1); or.scene.centerOn(inc.x, inc.y); });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshot-close.png' });
await browser.close();
