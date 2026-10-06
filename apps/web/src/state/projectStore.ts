/**
 * Projekt-Store: hält das unveränderliche Projektdokument, den Spieldatensatz
 * und den Undo/Redo-Verlauf (Immer-Patches).
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import { OpError, tr, type GameDataIndex, type Project } from '@satis/core';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

const MAX_HISTORY = 300;

interface ProjectState {
  project: Project | null;
  gd: GameDataIndex | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Zähler, der bei jeder Änderung steigt (Autosave). */
  revision: number;
  /** Schreibgeschützte Ansicht (z. B. über einen Freigabelink geöffnet). */
  readOnly: boolean;
  /** Verknüpfung mit dem Serverkonto (Revision für optimistische Sperre). */
  remote: { revision: number } | null;
  open(project: Project, gd: GameDataIndex, opts?: { readOnly?: boolean; remote?: { revision: number } | null }): void;
  close(): void;
  /**
   * Führt eine Operation aus. Fehler (OpError) werden als Meldung angezeigt
   * und lassen das Projekt unverändert. Liefert das Ergebnis der Operation.
   */
  apply<T>(label: string, fn: (draft: Project, gd: GameDataIndex) => T): T | undefined;
  undo(): void;
  redo(): void;
}

type Notify = (message: string, kind?: 'error' | 'info') => void;
let notify: Notify = () => {};
export function setNotifier(fn: Notify) {
  notify = fn;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  gd: null,
  past: [],
  future: [],
  revision: 0,
  readOnly: false,
  remote: null,
  open(project, gd, opts = {}) {
    set({ project, gd, past: [], future: [], revision: 0, readOnly: !!opts.readOnly, remote: opts.remote ?? null });
  },
  close() {
    set({ project: null, gd: null, past: [], future: [], revision: 0, readOnly: false, remote: null });
  },
  apply(label, fn) {
    const { project, gd, readOnly } = get();
    if (!project || !gd) return undefined;
    if (readOnly) {
      notify(tr('Schreibgeschützte Ansicht – zum Bearbeiten „Als Kopie übernehmen“ wählen.'), 'error');
      return undefined;
    }
    let result: ReturnType<typeof fn> | undefined;
    try {
      const [next, patches, inverse] = produceWithPatches(project, (draft) => {
        result = fn(draft as Project, gd);
        draft.updatedAt = new Date().toISOString();
      });
      if (patches.length <= 1) return result; // nur updatedAt geändert
      set((s) => ({
        project: next,
        past: [...s.past, { label, patches, inverse }].slice(-MAX_HISTORY),
        future: [],
        revision: s.revision + 1,
      }));
      return result;
    } catch (e) {
      if (e instanceof OpError) {
        notify(e.message, 'error');
        return undefined;
      }
      throw e;
    }
  },
  undo() {
    const { project, past } = get();
    const entry = past.at(-1);
    if (!project || !entry) return;
    set((s) => ({
      project: applyPatches(project, entry.inverse),
      past: s.past.slice(0, -1),
      future: [...s.future, entry],
      revision: s.revision + 1,
    }));
    notify(tr('Rückgängig: {label}', { label: entry.label }), 'info');
  },
  redo() {
    const { project, future } = get();
    const entry = future.at(-1);
    if (!project || !entry) return;
    set((s) => ({
      project: applyPatches(project, entry.patches),
      past: [...s.past, entry],
      future: s.future.slice(0, -1),
      revision: s.revision + 1,
    }));
    notify(tr('Wiederholt: {label}', { label: entry.label }), 'info');
  },
}));
