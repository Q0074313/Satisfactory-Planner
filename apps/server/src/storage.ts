/**
 * Projektablage als JSON-Dateien: eine Datei pro Projekt unter
 * `<STORAGE_DIR>/projects/<id>.json`.
 *
 * - Die ID ist zugleich der Zugangsschlüssel (Link /f/<id>): 16 Zufallsbytes
 *   (128 Bit) als base64url. Dateipfade entstehen nur aus geprüften IDs.
 * - Geschrieben wird atomar: temporäre Datei im selben Ordner, fsync, rename.
 *   Ein Leser sieht immer entweder den alten oder den neuen vollständigen Stand.
 * - Schreibvorgänge auf dieselbe ID laufen nacheinander (Sperre im Prozess),
 *   damit die Revisionsprüfung und das Schreiben nicht verzahnt werden.
 * - Die Revision ist ein Hash des Dateiinhalts (optimistische Sperre).
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_ID = /^[A-Za-z0-9_-]{22}$/;

export const isProjectId = (id: unknown): id is string => typeof id === 'string' && PROJECT_ID.test(id);

export function newProjectId(): string {
  return randomBytes(16).toString('base64url');
}

export function revisionOf(content: string): string {
  return createHash('sha256').update(content).digest('base64url').slice(0, 16);
}

export interface StoredProject {
  /** Rohdaten wie gespeichert (ggf. älteres Format, Migration beim Laden). */
  data: unknown;
  revision: string;
}

export class ConflictError extends Error {
  constructor(readonly revision: string) {
    super('conflict');
  }
}

export class ProjectStore {
  readonly dir: string;
  private readonly locks = new Map<string, Promise<unknown>>();
  private count = 0;

  constructor(storageDir: string) {
    this.dir = join(storageDir, 'projects');
  }

  /** Legt den Ordner an, räumt verwaiste temporäre Dateien weg und zählt die Projekte. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const names = await readdir(this.dir);
    for (const n of names.filter((n) => n.endsWith('.tmp'))) await unlink(join(this.dir, n)).catch(() => undefined);
    this.count = names.filter((n) => n.endsWith('.json')).length;
  }

  get size(): number {
    return this.count;
  }

  async writable(): Promise<boolean> {
    try {
      await access(this.dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private file(id: string): string {
    if (!isProjectId(id)) throw new Error('Ungültige Projekt-ID.');
    return join(this.dir, `${id}.json`);
  }

  async read(id: string): Promise<StoredProject | null> {
    let text: string;
    try {
      text = await readFile(this.file(id), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    return { data: JSON.parse(text), revision: revisionOf(text) };
  }

  /** Legt ein neues Projekt mit frischer ID an. */
  async create(data: unknown): Promise<{ id: string; revision: string }> {
    const content = JSON.stringify(data);
    for (;;) {
      const id = newProjectId();
      const created = await this.withLock(id, async () => {
        if (await this.exists(id)) return false;
        await this.writeAtomic(id, content);
        return true;
      });
      if (created) {
        this.count++;
        return { id, revision: revisionOf(content) };
      }
    }
  }

  /**
   * Überschreibt ein bestehendes Projekt. Mit `baseRevision` wird geprüft, ob
   * die Datei seit dem Laden unverändert ist (sonst ConflictError).
   * Liefert null, wenn das Projekt nicht existiert.
   */
  async update(id: string, data: unknown, baseRevision: string | null): Promise<{ revision: string } | null> {
    const content = JSON.stringify(data);
    return this.withLock(id, async () => {
      const current = await this.read(id);
      if (!current) return null;
      if (baseRevision !== null && baseRevision !== current.revision) throw new ConflictError(current.revision);
      await this.writeAtomic(id, content);
      return { revision: revisionOf(content) };
    });
  }

  private async exists(id: string): Promise<boolean> {
    try {
      await access(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  private async writeAtomic(id: string, content: string): Promise<void> {
    const target = this.file(id);
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    const fh = await open(tmp, 'wx', 0o640);
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
    // Umbenennung dauerhaft machen (Verzeichniseintrag)
    const dh = await open(this.dir, 'r');
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }
}
