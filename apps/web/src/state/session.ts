/**
 * Projekt öffnen, anlegen, importieren und automatisch speichern.
 */
import { useEffect, useRef, useState } from 'react';
import { createProject, ImportError, importProject, newId, type Project } from '@satis/core';
import { t } from '../i18n';
import { serverApi } from './server';
import { deleteProject, lastProjectId, loadProject, rememberLastProject, saveProject } from '../persistence/db';
import { pickFile } from '../persistence/files';
import { DEFAULT_DATASET, loadGameData } from './gamedata';
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

async function activate(project: Project, opts: { readOnly?: boolean; remote?: { revision: number } | null } = {}): Promise<void> {
  const gd = await loadGameData(project.gameData.datasetId);
  useProjectStore.getState().open(project, gd, opts);
  const factory = Object.values(project.factories)[0];
  useUiStore.getState().setFactory(factory?.id ?? null, factory?.floorIds[0] ?? null);
  if (!opts.readOnly) rememberLastProject(project.id);
}

/** Öffnet ein über einen Freigabelink geteiltes Projekt schreibgeschützt. */
export async function openShared(token: string): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const r = await serverApi.loadShare(token);
    const { project } = importProject(r.project);
    await activate(project, { readOnly: true });
    return true;
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

/** Übernimmt das geöffnete (z. B. geteilte) Projekt als lokale Kopie mit neuer ID. */
export async function copyAsLocal(): Promise<void> {
  const cur = useProjectStore.getState().project;
  if (!cur) return;
  const copy: Project = { ...cur, id: newId('project'), name: t('{name} (Kopie)', { name: cur.name }), updatedAt: new Date().toISOString() };
  await saveProject(copy);
  history.replaceState(null, '', location.pathname);
  await activate(copy);
  useUiStore.getState().toast(t('Lokale Kopie angelegt.'));
}

/** Speichert das aktuelle Projekt im Serverkonto (optimistische Sperre über die Revision). */
export async function saveToAccount(force = false): Promise<void> {
  const st = useProjectStore.getState();
  if (!st.project) return;
  const r = await serverApi.saveProject(st.project, force ? null : (st.remote?.revision ?? null));
  useProjectStore.setState({ remote: { revision: r.revision } });
}

export async function openFromAccount(id: string): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const r = await serverApi.loadProject(id);
    const { project, migrations } = importProject(r.project);
    await saveProject(project);
    await activate(project, { remote: { revision: r.revision } });
    for (const m of migrations) ui.toast(t('Migriert: {m}', { m }));
    return true;
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

export async function createNew(name: string): Promise<void> {
  const ds = DEFAULT_DATASET;
  if (!ds) throw new Error(t('Kein Spieldatensatz verfügbar.'));
  const p = createProject({ name, datasetId: ds.datasetId, gameVersion: ds.gameVersion });
  await saveProject(p);
  await activate(p);
}

export async function openById(id: string): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const result = await loadProject(id);
    if (!result) return false;
    await activate(result.project);
    for (const m of result.migrations) ui.toast(t('Migriert: {m}', { m }));
    if (result.repairs.length) ui.toast(t('{n} ungültige Verweise bereinigt.', { n: result.repairs.length }));
    return true;
  } catch (e) {
    ui.toast(e instanceof Error ? e.message : String(e), 'error');
    return false;
  }
}

/** Start: Freigabelink in der Adresse (#/share/<token>) oder zuletzt geöffnetes Projekt. */
export async function reopenLast(): Promise<boolean> {
  const share = /^#\/share\/([\w-]+)$/.exec(location.hash);
  if (share) return openShared(share[1]!);
  const id = lastProjectId();
  return id ? openById(id) : false;
}

export async function importFromFile(): Promise<void> {
  const ui = useUiStore.getState();
  const text = await pickFile();
  if (text === null) return;
  try {
    const result = importProject(text);
    await saveProject(result.project);
    await activate(result.project);
    ui.toast(t('Projekt „{name}“ importiert.', { name: result.project.name }));
    for (const m of result.migrations) ui.toast(t('Migriert: {m}', { m }));
    for (const r of result.repairs) ui.toast(r);
  } catch (e) {
    if (e instanceof ImportError) ui.toast(`${e.message}${e.details.length ? ` – ${e.details.slice(0, 3).join('; ')}` : ''}`, 'error');
    else ui.toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

export async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  if (useProjectStore.getState().project?.id === id) {
    useProjectStore.getState().close();
    rememberLastProject(null);
  }
}

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Speichert das Projekt 800 ms nach der letzten Änderung in IndexedDB. */
export function useAutosave(): { status: SaveStatus; saveNow: () => Promise<void> } {
  const project = useProjectStore((s) => s.project);
  const revision = useProjectStore((s) => s.revision);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(project);
  latest.current = project;

  const saveNow = async () => {
    const p = latest.current;
    if (!p) return;
    window.clearTimeout(timer.current);
    setStatus('saving');
    try {
      await saveProject(p);
      setStatus(latest.current === p ? 'saved' : 'pending');
    } catch (e) {
      setStatus('error');
      useUiStore.getState().toast(t('Speichern fehlgeschlagen: {msg}', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
  };

  const readOnly = useProjectStore((s) => s.readOnly);
  useEffect(() => {
    if (!project || revision === 0 || readOnly) return;
    setStatus('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNow(), 800);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, revision]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (status === 'pending' || status === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [status]);

  return { status, saveNow };
}
