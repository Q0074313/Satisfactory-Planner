import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  // Ein Worker: parallele Läufe überlasten den Vite-Dev-Server (Zeitüberschreitungen), seriell ist es schneller
  workers: 1,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1500, height: 900 },
    acceptDownloads: true,
  },
  webServer: [
    {
      // Server mit Projektablage in einem temporären Ordner (nur für Tests)
      command: 'node --import tsx apps/server/src/main.ts',
      url: 'http://localhost:8099/api/health',
      env: { STORAGE_DIR: join(tmpdir(), `satis-e2e-${process.pid}`), PORT: '8099', RATE_CREATE_PER_HOUR: '10000' },
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
