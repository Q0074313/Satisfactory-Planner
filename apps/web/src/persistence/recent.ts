/**
 * Merkzettel im localStorage dieses Geräts (nur mit Server):
 * - zuletzt geöffnete Server-Projekte (es gibt bewusst keine Liste aller Projekte auf dem Server)
 * - welche lokalen IndexedDB-Projekte bereits hochgeladen wurden
 * - ob das Angebot zum Hochladen ausgeblendet wurde
 */
export interface RecentProject {
  id: string;
  name: string;
  openedAt: string;
  /** Planer-Version beim letzten Speichern (soweit bekannt). */
  appVersion?: string;
}

const RECENT_KEY = 'satis-planner:recent';
const UPLOADED_KEY = 'satis-planner:uploaded';
const DISMISS_KEY = 'satis-planner:upload-dismissed';
const MAX_RECENT = 30;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

export const recentProjects = (): RecentProject[] => read<RecentProject[]>(RECENT_KEY, []);

export function rememberRecent(id: string, name: string, appVersion?: string) {
  const old = recentProjects();
  const list = old.filter((r) => r.id !== id);
  const version = appVersion ?? old.find((r) => r.id === id)?.appVersion;
  write(RECENT_KEY, [{ id, name, openedAt: new Date().toISOString(), ...(version ? { appVersion: version } : {}) }, ...list].slice(0, MAX_RECENT));
}

export function forgetRecent(id: string) {
  write(
    RECENT_KEY,
    recentProjects().filter((r) => r.id !== id),
  );
}

/** Lokale Projekt-ID → Server-ID. */
export const uploadedProjects = (): Record<string, string> => read<Record<string, string>>(UPLOADED_KEY, {});

export function markUploaded(localId: string, remoteId: string) {
  write(UPLOADED_KEY, { ...uploadedProjects(), [localId]: remoteId });
}

export const uploadDismissed = () => read<boolean>(DISMISS_KEY, false);
export const dismissUpload = () => write(DISMISS_KEY, true);
