/**
 * Versionsprüfung: Beim Start fragt die App die neueste Version auf GitHub ab
 * (Releases des Repositorys) und weist auf eine neuere hin. Ohne Internet, im
 * Entwicklungsmodus oder ohne Repository passiert nichts. Das Ergebnis wird
 * einige Stunden im Browser gemerkt (GitHub begrenzt Anfragen ohne Anmeldung).
 */
import { create } from 'zustand';
import { APP_REPO, APP_VERSION } from '../version';

export interface LatestRelease {
  version: string;
  url: string;
  checkedAt: number;
}

const CACHE_KEY = 'satis-planner:latest-release';
const MAX_AGE = 6 * 3600_000;

/** „v1.2.3“ bzw. „1.2.3“ → [1, 2, 3], sonst null. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Ist candidate neuer als current? Unlesbare Versionen gelten nie als neuer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

function readCache(): LatestRelease | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as LatestRelease | null;
    return v && typeof v.version === 'string' && typeof v.url === 'string' && typeof v.checkedAt === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(v: LatestRelease) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(v));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Prüfung möglich? (Repository bekannt, kein Entwicklungsstand) */
export const updateCheckEnabled = () => APP_REPO !== '' && !import.meta.env.DEV && parseVersion(APP_VERSION) !== null;

interface UpdateState {
  latest: LatestRelease | null;
  status: 'idle' | 'checking' | 'done' | 'failed';
  /** Neuere Version als die laufende? */
  available: boolean;
  check(opts?: { force?: boolean }): Promise<void>;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  latest: null,
  status: 'idle',
  available: false,
  async check({ force = false } = {}) {
    if (!updateCheckEnabled() || get().status === 'checking') return;
    const cached = readCache();
    const apply = (latest: LatestRelease) => set({ latest, status: 'done', available: isNewer(latest.version, APP_VERSION) });
    if (cached && !force && Date.now() - cached.checkedAt < MAX_AGE) return apply(cached);
    set({ status: 'checking' });
    try {
      const res = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json' },
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
      if (typeof data.tag_name !== 'string' || !parseVersion(data.tag_name)) throw new Error('tag');
      const latest: LatestRelease = {
        version: data.tag_name.replace(/^v/, ''),
        url: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${APP_REPO}/releases`,
        checkedAt: Date.now(),
      };
      writeCache(latest);
      apply(latest);
    } catch {
      // Offline, gesperrt oder noch kein Release: zuletzt bekannten Stand behalten
      if (cached) apply(cached);
      else set({ status: 'failed' });
    }
  },
}));
