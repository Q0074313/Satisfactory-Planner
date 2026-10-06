import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1500, height: 900 },
    acceptDownloads: true,
  },
  webServer: [
    {
      // Server mit eingebetteter Datenbank (nur für Tests; Schlüssel ist ein Testwert)
      command: 'node --import tsx apps/server/src/main.ts',
      url: 'http://localhost:8099/api/health',
      env: { DATABASE_URL: 'pglite:memory', SESSION_SECRET: 'e2e-test-secret-e2e-test-secret-0123456789', PUBLIC_BASE_URL: 'http://localhost:5199', PORT: '8099' },
      reuseExistingServer: true,
    },
    {
      command: 'npx vite --port 5199 --strictPort',
      cwd: 'apps/web',
      url: 'http://localhost:5199',
      env: { SATIS_API: 'http://localhost:8099' },
      reuseExistingServer: true,
    },
  ],
});
