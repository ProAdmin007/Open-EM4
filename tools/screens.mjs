// Takes README screenshots with the locally installed Chrome. Usage: npm run build && npm run preview, then node tools/screens.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto('http://localhost:4173/');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'docs/screenshot-menu.png' });
await page.getByRole('button', { name: /Nieuw spel/ }).click();
await page.locator('[data-act="speed4"]').click();
await page.waitForTimeout(9000);
await page.evaluate(() => {
  const or = window.__openrescue; const w = or.world;
  const inc = [...w.incidents.values()][0];
  const v = [...w.vehicles.values()].find(x => x.defId === 'fire_engine');
  or.scene.select([v.id]);
  w.contextOrder([v.id], inc.x, inc.y);
  or.scene.centerOn(inc.x, inc.y + 3);
});
await page.waitForTimeout(6000);
await page.screenshot({ path: 'docs/screenshot-game.png' });
await browser.close();
