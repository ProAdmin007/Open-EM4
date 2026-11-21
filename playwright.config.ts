import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    // Uses the locally installed Chrome; run `npx playwright install chromium` and remove `channel` if unavailable.
    channel: process.env.PW_CHANNEL ?? 'chrome',
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
    viewport: { width: 1366, height: 768 },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
