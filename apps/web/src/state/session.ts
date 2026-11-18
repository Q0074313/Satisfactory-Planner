/**
 * Projekt öffnen, anlegen, importieren und automatisch speichern.
 *
 * Zwei Betriebsarten, beim Start erkannt:
 * - mit Server: Projekte liegen auf dem Server unter geheimen Links /f/<id>
 * - ohne Server (z. B. nur `npm run dev`): Projekte liegen lokal in IndexedDB
 */
import { useEffect, useRef, useState } from 'react';
import { buildExampleProject, createProject, ImportError, importProject, type ExampleKind, type Project } from '@satis/core';
import { t } from '../i18n';
import { ApiError, idFromLocation, serverApi, useServer } from './server';
import { deleteProject, lastProjectId, loadProject, rememberLastProject, saveProject } from '../persistence/db';
import { pickFile } from '../persistence/files';
import { markUploaded, recentProjects, rememberRecent } from '../persistence/recent';
import { APP_BASE, withAppVersion } from '../version';
import { DEFAULT_DATASET, loadGameData } from './gamedata';
import { useProjectStore, type RemoteRef } from './projectStore';
import { useUiStore } from './uiStore';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Zuletzt bekannte Revision je Server-Projekt (optimistische Sperre beim Speichern). */
const revisions = new Map<string, string>();

async function activate(project: Project, opts: { remote?: RemoteRef | null } = {}): Promise<void> {
  const gd = await loadGameData(project.gameData.datasetId);
  useProjectStore.getState().open(project, gd, opts);
  const factory = Object.values(project.factories)[0];
  useUiStore.getState().setFactory(factory?.id ?? null, factory?.floorIds[0] ?? null);
  if (!opts.remote) rememberLastProject(project.id);
}

/**
 * Merkt sich das geöffnete Projekt im Verlauf, ohne die ID in der Adresszeile
 * zu zeigen (z. B. Streams): Die Adresse bleibt „/“, die ID steht im
 * Verlaufseintrag und – für Neuladen in diesem Tab – im sessionStorage.
 * Ein eingegebener Link /f/<id> wird nach dem Öffnen ebenfalls auf „/“ gekürzt.
 */
const TAB_KEY = 'satis-planner:tab-project';

export function tabProjectId(): string | null {
  try {
    return sessionStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function rememberTabProject(id: string | null) {
  try {
    if (id) sessionStorage.setItem(TAB_KEY, id);
    else sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** ID aus dem aktuellen Verlaufseintrag (gesetzt von showInAddressBar). */
export function idFromHistory(): string | null {
  const st = history.state as { projectId?: unknown } | null;
  return typeof st?.projectId === 'string' ? st.projectId : null;
}

function showInAddressBar(id: string, replace = false) {
  rememberTabProject(id);
  if (idFromHistory() === id && location.pathname === APP_BASE) return;
  // Ein frisch geöffneter Link ersetzt seinen eigenen Eintrag statt einen neuen anzulegen
  if (replace || idFromLocation() !== null) history.replaceState({ projectId: id }, '', APP_BASE);
  else history.pushState({ projectId: id }, '', APP_BASE);
}

/** Startseite ohne Projekt im Verlauf (Adresse „/“). */
export function leaveProjectInHistory() {
  rememberTabProject(null);
  history.pushState(null, '', APP_BASE);
}

/** Öffnet ein Projekt vom Server. */
export async function openRemote(id: string, opts: { replace?: boolean; push?: boolean } = {}): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const r = await serverApi.loadProject(id);
    const { project } = importProject(r.project);
    revisions.set(id, r.revision);
    await activate(project, { remote: { id } });
    if (opts.push !== false) showInAddressBar(id, opts.replace);
    else rememberTabProject(id);
    rememberRecent(id, project.name, project.appVersion);
    for (const m of r.migrations) ui.toast(t('Migriert: {m}', { m }));
    return true;
  } catch (e) {
    ui.toast(errorText(e), 'error');
    return false;
  }
}

/** Legt ein Projekt auf dem Server an und öffnet es unter seinem neuen Link. */
async function createRemote(project: Project): Promise<string> {
  const r = await serverApi.createProject(project);
  revisions.set(r.id, r.revision);
  await activate(project, { remote: { id: r.id } });
  showInAddressBar(r.id);
  rememberRecent(r.id, project.name, withAppVersion(project).appVersion);
  useUiStore.getState().toast(t('Projekt auf dem Server angelegt. Speichere den Link als Lesezeichen!'));
  return r.id;
}

/** Lädt ein lokal (IndexedDB) gespeichertes Projekt als neues Server-Projekt hoch. */
export async function uploadLocal(localId: string): Promise<boolean> {
  const ui = useUiStore.getState();
  try {
    const result = await loadProject(localId);
    if (!result) throw new Error(t('Projekt nicht gefunden.'));
    const remoteId = await createRemote(result.project);
    markUploaded(localId, remoteId);
    return true;
  } catch (e) {
    ui.toast(t('Hochladen fehlgeschlagen: {msg}', { msg: errorText(e) }), 'error');
    return false;
  }
}

export async function createNew(name: string): Promise<boolean> {
  const ds = DEFAULT_DATASET;
  if (!ds) throw new Error(t('Kein Spieldatensatz verfügbar.'));
  return store(createProject({ name, datasetId: ds.datasetId, gameVersion: ds.gameVersion }));
}

/** Legt ein Beispielprojekt (Tutorial) als neues Projekt an und öffnet es. */
export async function createExample(kind: ExampleKind, opts: { logistics?: boolean } = {}): Promise<boolean> {
  const ds = DEFAULT_DATASET;
  if (!ds) throw new Error(t('Kein Spieldatensatz verfügbar.'));
  const gd = await loadGameData(ds.datasetId);
  return store(buildExampleProject(gd, kind, { datasetId: ds.datasetId, gameVersion: ds.gameVersion }, opts));
}

/** Neues Projekt speichern (Server bzw. Browser) und öffnen, z. B. nach dem Spielstand-Import. */
export async function storeNewProject(p: Project): Promise<boolean> {
  return store(p);
}

/** Neues Projekt speichern (Server bzw. Browser) und öffnen. */
async function store(p: Project): Promise<boolean> {
  if (useServer.getState().available) {
    try {
      await createRemote(p);
      return true;
    } catch (e) {
      useUiStore.getState().toast(errorText(e), 'error');
      return false;
    }
  }
  await saveProject(p);
  await activate(p);
  return true;
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
    ui.toast(errorText(e), 'error');
    return false;
  }
}

/**
 * Start: Projekt-Link in der Adresse (/f/<id>), sonst das zuletzt geöffnete
 * Projekt (Server bzw. lokal). Liefert true, wenn ein Projekt geöffnet wurde.
 */
let booting: Promise<boolean> | null = null;
export function boot(): Promise<boolean> {
  // Nur einmal ausführen (React StrictMode ruft Effekte im Entwicklungsmodus doppelt auf)
  booting ??= bootOnce();
  return booting;
}

async function bootOnce(): Promise<boolean> {
  const server = await useServer.getState().check();
  const fromUrl = idFromLocation();
  if (fromUrl !== null) {
    const ui = useUiStore.getState();
    if (!server) ui.toast(t('Kein Server erreichbar – Projekt-Links funktionieren nur mit Server.'), 'error');
    else if (fromUrl === '') ui.toast(t('Ungültiger Projekt-Link.'), 'error');
    else if (await openRemote(fromUrl)) return true;
    history.replaceState(null, '', APP_BASE);
    return false;
  }
  if (server) {
    // Neuladen: zuerst das Projekt dieses Tabs, sonst das zuletzt geöffnete
    const id = idFromHistory() ?? tabProjectId() ?? recentProjects()[0]?.id;
    if (!id) return false;
    if (await openRemote(id, { replace: true })) return true;
    rememberTabProject(null);
    history.replaceState(null, '', APP_BASE);
    return false;
  }
  const id = lastProjectId();
  return id ? openById(id) : false;
}

export async function importFromFile(): Promise<boolean> {
  const ui = useUiStore.getState();
  const text = await pickFile();
  if (text === null) return false;
  try {
    const result = importProject(text);
    if (useServer.getState().available) await createRemote(result.project);
    else {
      await saveProject(result.project);
      await activate(result.project);
    }
    ui.toast(t('Projekt „{name}“ importiert.', { name: result.project.name }));
    for (const m of result.migrations) ui.toast(t('Migriert: {m}', { m }));
    for (const r of result.repairs) ui.toast(r);
    return true;
  } catch (e) {
    if (e instanceof ImportError) ui.toast(`${e.message}${e.details.length ? ` – ${e.details.slice(0, 3).join('; ')}` : ''}`, 'error');
    else ui.toast(errorText(e), 'error');
    return false;
  }
}

export async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  const st = useProjectStore.getState();
  if (!st.remote && st.project?.id === id) {
    st.close();
    rememberLastProject(null);
  }
}

/**
 * Speichert einen Projektstand – lokal oder auf dem Server. Hat ein anderes
 * Gerät inzwischen gespeichert, wird gefragt, welcher Stand gelten soll.
 */
async function persist(p: Project, remoteId: string | null): Promise<void> {
  if (!remoteId) return saveProject(p);
  try {
    const r = await serverApi.saveProject(remoteId, p, revisions.get(remoteId) ?? null);
    revisions.set(remoteId, r.revision);
    rememberRecent(remoteId, p.name, withAppVersion(p).appVersion);
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'conflict')) throw e;
    const overwrite = window.confirm(
      t('Dieses Projekt wurde inzwischen auf einem anderen Gerät gespeichert. OK: den Stand dieses Geräts speichern und den anderen überschreiben. Abbrechen: den Stand vom Server laden; Änderungen dieses Geräts seit dem letzten Speichern gehen verloren.'),
    );
    if (overwrite) {
      const r = await serverApi.saveProject(remoteId, p, null);
      revisions.set(remoteId, r.revision);
    } else if (useProjectStore.getState().remote?.id === remoteId) {
      await openRemote(remoteId, { push: false });
    }
  }
}

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Speichert das Projekt 800 ms nach der letzten Änderung (IndexedDB bzw. Server). */
export function useAutosave(): { status: SaveStatus; saveNow: () => Promise<void> } {
  const project = useProjectStore((s) => s.project);
  const remote = useProjectStore((s) => s.remote);
  const revision = useProjectStore((s) => s.revision);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ project, remoteId: remote?.id ?? null });
  latest.current = { project, remoteId: remote?.id ?? null };
  // Speichervorgänge laufen nacheinander, damit jeder die Revision des vorherigen kennt
  const queue = useRef<Promise<void>>(Promise.resolve());

  const saveOnce = async () => {
    const { project: p, remoteId } = latest.current;
    if (!p) return;
    setStatus('saving');
    try {
      await persist(p, remoteId);
      setStatus(latest.current.project === p ? 'saved' : 'pending');
    } catch (e) {
      setStatus('error');
      useUiStore.getState().toast(t('Speichern fehlgeschlagen: {msg}', { msg: errorText(e) }), 'error');
    }
  };

  const saveNow = () => {
    window.clearTimeout(timer.current);
    const run = queue.current.then(saveOnce);
    queue.current = run.catch(() => undefined);
    return run;
  };

  useEffect(() => {
    if (!project || revision === 0) return;
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
