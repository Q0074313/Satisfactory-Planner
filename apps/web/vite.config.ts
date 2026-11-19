import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Softwareversion aus dem Wurzel-package.json, Commit aus GIT_COMMIT (Docker) oder git
const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
  repository?: { url?: string };
};
function gitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** GitHub-Repository „besitzer/name“ aus package.json → Versionsprüfung gegen dessen Releases. */
const githubRepo = /github\.com[/:]([^/]+\/[^/.]+)/.exec(rootPkg.repository?.url ?? '')?.[1] ?? '';

/**
 * Eigenständige Ausgabe ohne Server (GitHub Pages, installierbar):
 * SATIS_STANDALONE=1, Unterpfad über SATIS_BASE (z. B. /Satisfactory-Planner/).
 */
const standalone = process.env.SATIS_STANDALONE === '1';
const base = process.env.SATIS_BASE ?? '/';

const ICONS = ['icon.svg', 'icon-192.png', 'icon-512.png'];

/** Manifest und Service Worker (Offline-Cache aller Build-Dateien) für die installierbare Web-App. */
function installableApp(): Plugin {
  return {
    name: 'satis-installable-app',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icon-192.png` }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#16181c' }, injectTo: 'head' },
    ],
    generateBundle(_opts, bundle) {
      for (const name of ICONS) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(new URL(`./pwa/${name}`, import.meta.url)) });
      const manifest = {
        name: 'Satisfactory Planner',
        short_name: 'Satisfactory Planner',
        description: 'Planungswerkzeug für Satisfactory: Produktion, Fabrikgrundriss, Schienennetz',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#16181c',
        theme_color: '#16181c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      };
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });
      const files = [...new Set([...Object.keys(bundle), 'index.html', 'manifest.webmanifest', ...ICONS])].filter((f) => !f.endsWith('.map') && f !== 'sw.js').sort();
      const cache = `satis-planner-${rootPkg.version}-${gitCommit() || Date.now()}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(cache, files) });
    },
  };
}

/**
 * Service Worker: speichert beim Installieren alle Dateien dieses Builds.
 * Seitenaufrufe gehen zuerst ans Netz (immer die neueste Version), offline an
 * den Cache; Skripte, Bilder und Spieldaten kommen aus dem Cache. Ein neuer
 * Build übernimmt erst, wenn alle Fenster der alten Version geschlossen sind –
 * so lädt eine laufende Sitzung keine Dateien einer anderen Version nach.
 */
function serviceWorker(cache: string, files: string[]): string {
  return `// Erzeugt beim Build (apps/web/vite.config.ts)
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(files)};
const INDEX = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new URL(f, self.registration.scope).href))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('satis-planner-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match(INDEX))));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit ?? fetch(req)));
});
`;
}

export default defineConfig({
  base,
  plugins: [react(), ...(standalone ? [installableApp()] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_REPO__: JSON.stringify(githubRepo),
    __APP_STANDALONE__: JSON.stringify(standalone),
  },
  server: {
    port: 5173,
    // Spieldaten liegen außerhalb des App-Ordners (data/gamedata).
    fs: { allow: ['../..'] },
    // Optionaler Server (npm run dev:server) für Konten und Freigaben
    proxy: { '/api': { target: process.env.SATIS_API ?? 'http://localhost:8080', changeOrigin: false } },
  },
  // Spielstand-Parser wird erst im Web Worker geladen: vorab optimieren, sonst lädt der Dev-Server beim ersten Import neu
  optimizeDeps: { include: ['@etothepii/satisfactory-file-parser'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: !standalone,
  },
});
