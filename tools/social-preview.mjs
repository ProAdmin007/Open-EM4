// Generates docs/social-preview.png (1280x640, the size GitHub and social networks expect) from docs/screenshot-3d-city.png.
// Usage: node tools/social-preview.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const shot = readFileSync(new URL('../docs/screenshot-3d-city.png', import.meta.url)).toString('base64');
const html = `<!doctype html><html><body style="margin:0;width:1280px;height:640px;position:relative;overflow:hidden;font-family:system-ui,'Segoe UI',sans-serif;background:#11141a">
<img src="data:image/png;base64,${shot}" style="position:absolute;inset:0;width:1280px;height:720px;object-fit:cover;filter:brightness(.55) saturate(1.1)">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,14,22,.92) 0%,rgba(10,14,22,.55) 55%,rgba(10,14,22,0) 100%)"></div>
<div style="position:absolute;left:70px;top:105px;color:#fff;max-width:900px">
  <div style="font-size:24px;letter-spacing:5px;color:#ffb300;font-weight:700">FREE · OPEN SOURCE · IN YOUR BROWSER</div>
  <div style="font-size:78px;font-weight:800;line-height:1.05;margin-top:16px;white-space:nowrap">🚒 OpenRescue RTS</div>
  <div style="font-size:31px;line-height:1.3;margin-top:24px;max-width:760px;color:#e8edf7">Command fire, ambulance, police and tow trucks in a living city. An Emergency 4 inspired game.</div>
  <div style="margin-top:28px;font-size:25px;color:#9fb0cc">26 incident types · 13 vehicles · missions &amp; freeplay · moddable</div>
</div>
</body></html>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: new URL('../docs/social-preview.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
await browser.close();
console.log('docs/social-preview.png written');
