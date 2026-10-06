/** Startet den Server: Konfiguration lesen, Datenbank migrieren, lauschen. */
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';

const cfg = loadConfig();
const database = await openDatabase(cfg.databaseUrl);
const app = await buildServer({ db: database.db, sessionSecret: cfg.sessionSecret, publicBaseUrl: cfg.publicBaseUrl, staticDir: cfg.staticDir, logger: true });
const stop = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
await app.listen({ port: cfg.port, host: cfg.host });
