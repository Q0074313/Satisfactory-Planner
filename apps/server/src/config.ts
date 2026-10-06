/**
 * Konfiguration aus Umgebungsvariablen (alle optional, siehe .env.example).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Limits {
  /** Maximale Größe eines gespeicherten Projekts in Bytes. */
  maxProjectBytes: number;
  /** Maximale Anzahl Projekte insgesamt (Schutz vor vollgeschriebener Platte). */
  maxProjects: number;
  /** Neue Projekte je IP und Stunde. */
  createPerHour: number;
  /** Speichervorgänge je IP und Minute. */
  savePerMinute: number;
  /** Ladevorgänge je IP und Minute. */
  loadPerMinute: number;
}

export interface Config {
  port: number;
  host: string;
  staticDir: string;
  storageDir: string;
  /** Wert für Fastifys trustProxy (Adressen/Bereiche, denen X-Forwarded-For geglaubt wird). */
  trustProxy: string | false;
  limits: Limits;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
};

export const DEFAULT_LIMITS: Limits = {
  maxProjectBytes: 5 * 1024 * 1024,
  maxProjects: 5000,
  createPerHour: 10,
  savePerMinute: 120,
  loadPerMinute: 300,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    staticDir: env.STATIC_DIR || join(root, 'apps/web/dist'),
    storageDir: resolve(env.STORAGE_DIR || join(root, 'storage')),
    trustProxy: env.TRUST_PROXY || false,
    limits: {
      maxProjectBytes: num(env.MAX_PROJECT_BYTES, DEFAULT_LIMITS.maxProjectBytes),
      maxProjects: num(env.MAX_PROJECTS, DEFAULT_LIMITS.maxProjects),
      createPerHour: num(env.RATE_CREATE_PER_HOUR, DEFAULT_LIMITS.createPerHour),
      savePerMinute: num(env.RATE_SAVE_PER_MINUTE, DEFAULT_LIMITS.savePerMinute),
      loadPerMinute: num(env.RATE_LOAD_PER_MINUTE, DEFAULT_LIMITS.loadPerMinute),
    },
  };
}
