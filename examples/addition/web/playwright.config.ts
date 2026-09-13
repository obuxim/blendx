/**
 * The browser tests: the addition API on in-memory PGlite (e2e/api.ts, port 3100) and the page
 * through Vite (port 5180), whose /api proxy points at it. Each run starts from an empty table.
 */
import { defineConfig, devices } from '@playwright/test';

const api = 'http://localhost:3100';
const web = 'http://localhost:5180';

export default defineConfig({
  testDir: 'e2e',
  // Not *.spec.ts or *.test.ts, which bun test would pick up.
  testMatch: '*.e2e.ts',
  workers: 1,
  forbidOnly: true,
  use: { baseURL: web, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'bun e2e/api.ts', url: `${api}/addition_results`, env: { PORT: '3100' } },
    { command: 'bunx vite --port 5180 --strictPort', url: web, env: { BLENDX_API: api } },
  ],
});
