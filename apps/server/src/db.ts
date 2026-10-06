/**
 * Datenbankverbindung. `DATABASE_URL`:
 * - `postgres://…` bzw. `postgresql://…`: PostgreSQL über node-postgres (Produktion)
 * - `pglite:memory` oder `pglite:<Verzeichnis>`: eingebettetes PostgreSQL
 *   (PGlite) für Tests und lokale Entwicklung ohne Datenbankinstallation
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema.ts';

export type Db = PgliteDatabase<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

export interface Database {
  db: Db;
  close(): Promise<void>;
}

/** Öffnet die Datenbank und wendet alle ausstehenden Migrationen an. */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const target = url.slice('pglite:'.length);
    const client = target === 'memory' ? new PGlite() : new PGlite(target);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return { db, close: () => client.close() };
  }
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  throw new Error('DATABASE_URL muss mit postgres://, postgresql:// oder pglite: beginnen.');
}
