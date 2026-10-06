/**
 * Lokale Projektspeicherung in IndexedDB.
 *
 * Datenbank `satis-planner`:
 * - `projects`: vollständige Projekte (Schlüssel: Projekt-ID)
 * - `index`: kleine Übersichtseinträge für die Projektliste
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { importProject, type Project } from '@satis/core';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  datasetId: string;
  factories: number;
  buildings: number;
  railSegments: number;
}

interface PlannerDB extends DBSchema {
  projects: { key: string; value: { id: string; data: unknown; savedAt: string } };
  index: { key: string; value: ProjectSummary };
}

let dbPromise: Promise<IDBPDatabase<PlannerDB>> | null = null;

function db() {
  dbPromise ??= openDB<PlannerDB>('satis-planner', 1, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' });
      database.createObjectStore('index', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export function summarize(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    datasetId: p.gameData.datasetId,
    factories: Object.keys(p.factories).length,
    buildings: Object.keys(p.buildings).length,
    railSegments: Object.keys(p.railSegments).length,
  };
}

export async function saveProject(p: Project): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'index'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').put({ id: p.id, data: p, savedAt: new Date().toISOString() }),
    tx.objectStore('index').put(summarize(p)),
    tx.done,
  ]);
}

/** Lädt ein Projekt und führt dabei Formatmigration und Schemaprüfung aus. */
export async function loadProject(id: string) {
  const d = await db();
  const rec = await d.get('projects', id);
  if (!rec) return null;
  return importProject(rec.data);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const d = await db();
  const all = await d.getAll('index');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'index'], 'readwrite');
  await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('index').delete(id), tx.done]);
}

const LAST_KEY = 'satis-planner:last-project';
export const rememberLastProject = (id: string | null) => {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
};
export const lastProjectId = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
