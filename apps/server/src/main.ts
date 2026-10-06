/** Startet den Server: Konfiguration lesen, Speicherordner vorbereiten, lauschen. */
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { ProjectStore } from './storage.ts';

const cfg = loadConfig();
const store = new ProjectStore(cfg.storageDir);
await store.init();
const app = await buildServer({ store, limits: cfg.limits, staticDir: cfg.staticDir, trustProxy: cfg.trustProxy, logger: true });
app.log.info(`Projektablage: ${store.dir} (${store.size} Projekte)`);
const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
await app.listen({ port: cfg.port, host: cfg.host });
