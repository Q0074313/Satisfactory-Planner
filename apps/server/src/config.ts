/**
 * Konfiguration ausschließlich aus Umgebungsvariablen. Zugangsdaten stehen
 * nie im Quelltext; `.env`-Dateien sind über .gitignore ausgeschlossen.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  databaseUrl: string;
  sessionSecret: string;
  publicBaseUrl: string;
  port: number;
  host: string;
  staticDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['DATABASE_URL', 'SESSION_SECRET', 'PUBLIC_BASE_URL'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')} (siehe docs/BETRIEB.md)`);
  return {
    databaseUrl: env.DATABASE_URL!,
    sessionSecret: env.SESSION_SECRET!,
    publicBaseUrl: env.PUBLIC_BASE_URL!,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    staticDir: env.STATIC_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
  };
}
