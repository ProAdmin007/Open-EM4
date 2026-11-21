import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
