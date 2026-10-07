import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Softwareversion aus dem Wurzel-package.json, Commit aus GIT_COMMIT (Docker) oder git
const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
function gitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    port: 5173,
    // Spieldaten liegen außerhalb des App-Ordners (data/gamedata).
    fs: { allow: ['../..'] },
    // Optionaler Server (npm run dev:server) für Konten und Freigaben
    proxy: { '/api': { target: process.env.SATIS_API ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
