// One-off perf measurement comparing the 2D and 3D renderers, run against the preview server (same browser/flags as the
// e2e tests). Usage: npm run build; npm run preview & ; node tools/bench3d.mjs
import { chromium } from '@playwright/test';

async function measure(mode) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('http://localhost:4173/?e2e');
  await page.waitForFunction(() => !!window.__openrescue?.scene, undefined, { timeout: 15_000 });
  await page.getByRole('button', { name: /Freeplay/ }).click();
  await page.locator('#f-diff').selectOption('hard');
  await page.getByRole('button', { name: /Start Freeplay/ }).click();
  await page.waitForFunction(() => window.__openrescue.scene.state === 'playing');
  await page.locator('[data-act="speed4"]').click();
  await page.waitForTimeout(3000);
  if (mode === '3d') {
    await page.evaluate(() => window.__openrescue.scene.setViewMode('3d'));
    await page.waitForFunction(() => !!window.__openrescue.scene.renderer3d);
  }
  await page.evaluate(() => window.__openrescue.scene.centerOn(50, 36));
  await page.waitForTimeout(3000);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const a = await page.evaluate(() => ({ f: window.__openrescue.game.loop.frame, t: performance.now() })).catch(() => null);
    await page.waitForTimeout(1000);
    const b = await page.evaluate(() => ({ f: window.__openrescue.game.loop.frame, t: performance.now() })).catch(() => null);
    if (a && b && b.f >= a.f) samples.push(((b.f - a.f) * 1000) / (b.t - a.t));
  }
  await browser.close();
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  console.log(`${mode}: avg fps=${avg.toFixed(1)} min=${Math.min(...samples).toFixed(1)} (n=${samples.length})`);
}

await measure('2d');
await measure('3d');
