/**
 * Zugriff auf den optionalen Server (Projekte unter geheimen Links /f/<id>).
 * Ohne Server (z. B. nur `npm run dev`) bleibt der Planer voll nutzbar und
 * speichert lokal im Browser (IndexedDB).
 */
import { create } from 'zustand';
import type { Project } from '@satis/core';
import { N_, t } from '../i18n';
import { withAppVersion } from '../version';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Fehlercodes der API → verständlicher, übersetzter Text. */
const ERROR_TEXT: Record<string, string> = {
  'rate-limited': N_('Zu viele Anfragen. Bitte später erneut versuchen.'),
  conflict: N_('Das Projekt wurde zwischenzeitlich anderweitig gespeichert.'),
  'not-found': N_('Projekt nicht gefunden. Ist der Link vollständig?'),
  'invalid-project': N_('Das Projekt entspricht nicht dem erwarteten Format.'),
  'invalid-json': N_('Ungültiges JSON.'),
  'too-large': N_('Das Projekt ist zu groß für den Server.'),
  'storage-full': N_('Die maximale Anzahl an Projekten auf dem Server ist erreicht.'),
};

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'satis-planner', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } } & T;
  if (!res.ok) {
    const code = data.error?.code ?? 'error';
    throw new ApiError(res.status, code, ERROR_TEXT[code] ? t(ERROR_TEXT[code]!) : (data.error?.message ?? `HTTP ${res.status}`), data as Record<string, unknown>);
  }
  return data;
}

const path = (id: string) => `/api/factory/${encodeURIComponent(id)}`;

export const serverApi = {
  health: () => api<{ ok: boolean }>('GET', '/api/health'),
  createProject: (project: Project) => api<{ id: string; revision: string }>('POST', '/api/factory', { project: withAppVersion(project) }),
  loadProject: (id: string) => api<{ project: unknown; revision: string; migrations: string[] }>('GET', path(id)),
  saveProject: (id: string, project: Project, baseRevision: string | null) =>
    api<{ revision: string }>('PUT', path(id), { project: withAppVersion(project), baseRevision }),
};

/** Format der Projekt-IDs auf dem Server (128 Bit, base64url). */
export const REMOTE_ID = /^[A-Za-z0-9_-]{22}$/;

export const projectUrl = (id: string) => `${location.origin}/f/${id}`;

/** ID aus der aktuellen Adresse (/f/<id>), sonst null. Ungültige IDs liefern ''. */
export function idFromLocation(): string | null {
  const m = /^\/f\/([^/]*)\/?$/.exec(location.pathname);
  if (!m) return null;
  return REMOTE_ID.test(m[1]!) ? m[1]! : '';
}

interface ServerState {
  /** null = noch nicht geprüft, false = kein Server erreichbar. */
  available: boolean | null;
  check(): Promise<boolean>;
}

export const useServer = create<ServerState>((set) => ({
  available: null,
  async check() {
    try {
      await serverApi.health();
      set({ available: true });
      return true;
    } catch {
      set({ available: false });
      return false;
    }
  },
}));
