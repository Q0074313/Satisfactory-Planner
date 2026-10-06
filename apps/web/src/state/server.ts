/**
 * Zugriff auf den optionalen Server (Konten, Projekte im Konto, Freigaben).
 * Ohne Server (statische Auslieferung) bleibt der Planer voll nutzbar; die
 * Kontofunktionen sind dann ausgeblendet.
 */
import { create } from 'zustand';
import type { Project } from '@satis/core';
import { N_, t } from '../i18n';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fehlercodes der API → verständlicher, übersetzter Text. */
const ERROR_TEXT: Record<string, string> = {
  'invalid-email': N_('Ungültige E-Mail-Adresse.'),
  'weak-password': N_('Das Passwort muss mindestens 10 Zeichen lang sein.'),
  'email-taken': N_('Diese E-Mail-Adresse ist bereits registriert.'),
  'invalid-credentials': N_('E-Mail oder Passwort ist falsch.'),
  'rate-limited': N_('Zu viele Anmeldeversuche. Bitte später erneut versuchen.'),
  unauthenticated: N_('Nicht angemeldet.'),
  forbidden: N_('Dieses Projekt gehört einem anderen Konto.'),
  conflict: N_('Das Projekt wurde zwischenzeitlich anderweitig gespeichert.'),
  'not-found': N_('Nicht gefunden.'),
  'invalid-project': N_('Das Projekt entspricht nicht dem erwarteten Format.'),
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
    throw new ApiError(res.status, code, ERROR_TEXT[code] ? t(ERROR_TEXT[code]!) : (data.error?.message ?? `HTTP ${res.status}`));
  }
  return data;
}

export const serverApi = {
  health: () => api<{ ok: boolean }>('GET', '/api/health'),
  me: () => api<{ user: User }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => api<{ user: User }>('POST', '/api/auth/login', { email, password }),
  register: (email: string, password: string, displayName: string) => api<{ user: User }>('POST', '/api/auth/register', { email, password, displayName }),
  logout: () => api<void>('POST', '/api/auth/logout'),
  listProjects: () => api<{ projects: { id: string; name: string; updatedAt: string; datasetId: string; revision: number }[] }>('GET', '/api/projects'),
  loadProject: (id: string) => api<{ project: unknown; revision: number }>('GET', `/api/projects/${encodeURIComponent(id)}`),
  saveProject: (p: Project, baseRevision: number | null) => api<{ revision: number }>('PUT', `/api/projects/${encodeURIComponent(p.id)}`, { project: p, baseRevision }),
  deleteProject: (id: string) => api<void>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
  createShare: (id: string) => api<{ token: string; url: string }>('POST', `/api/projects/${encodeURIComponent(id)}/shares`),
  listShares: (id: string) => api<{ shares: { token: string; url: string; createdAt: string }[] }>('GET', `/api/projects/${encodeURIComponent(id)}/shares`),
  revokeShare: (token: string) => api<void>('DELETE', `/api/shares/${encodeURIComponent(token)}`),
  loadShare: (token: string) => api<{ project: unknown; readOnly: true }>('GET', `/api/share/${encodeURIComponent(token)}`),
};

interface AccountState {
  /** null = noch nicht geprüft, false = kein Server erreichbar. */
  available: boolean | null;
  user: User | null;
  check(): Promise<void>;
  setUser(u: User | null): void;
}

export const useAccount = create<AccountState>((set) => ({
  available: null,
  user: null,
  async check() {
    try {
      await serverApi.health();
    } catch {
      set({ available: false, user: null });
      return;
    }
    try {
      const { user } = await serverApi.me();
      set({ available: true, user });
    } catch {
      set({ available: true, user: null });
    }
  },
  setUser: (user) => set({ user }),
}));
