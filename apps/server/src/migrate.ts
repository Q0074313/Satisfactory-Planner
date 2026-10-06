/** Wendet ausstehende Datenbankmigrationen an (auch beim Start von main.ts). */
import { openDatabase } from './db.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt.');
const db = await openDatabase(url);
await db.close();
console.log('Migrationen angewendet.');
