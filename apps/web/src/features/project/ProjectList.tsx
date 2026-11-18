import { useEffect, useState } from 'react';
import { listProjects, loadProject, type ProjectSummary } from '../../persistence/db';
import { downloadProject } from '../../persistence/files';
import { dismissUpload, forgetRecent, recentProjects, uploadDismissed, uploadedProjects, type RecentProject } from '../../persistence/recent';
import { DATASETS } from '../../state/gamedata';
import { projectUrl, useServer } from '../../state/server';
import { copy } from '../link/ProjectLink';
import { createExample, createNew, importFromFile, openById, openRemote, removeProject, uploadLocal } from '../../state/session';
import { useUiStore } from '../../state/uiStore';
import { N_, t } from '../../i18n';
import type { ExampleKind } from '@satis/core';
import { usePrefs } from '../../state/prefsStore';
import { SaveImportDialog } from '../import/SaveImportDialog';
import { versionLabel } from '../../version';
import { UpdateBadge } from '../updates/UpdateNotice';
import { BugReportLink } from '../updates/BugReport';

export function ProjectList({ onClose }: { onClose?: () => void }) {
  const server = useServer((s) => s.available) === true;
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState(t('Mein Projekt'));
  const [saveImport, setSaveImport] = useState(false);
  const lang = usePrefs((s) => s.language);
  const refresh = () => listProjects().then(setProjects, (e: Error) => useUiStore.getState().toast(e.message, 'error'));
  useEffect(() => {
    void refresh();
  }, []);
  const done = (ok: boolean) => ok && onClose?.();
  const date = (iso: string) => new Date(iso).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US');

  return (
    <div className="project-list">
      <header>
        <h1>
          Satis Planner <span className="dim small-text app-version">{versionLabel()}</span> <UpdateBadge />
        </h1>
        <p className="dim">
          {server
            ? t('Produktionsberechnung, Fabrikgrundriss und Schienennetze für Satisfactory. Projekte werden auf dem Server gespeichert. Jedes Projekt hat einen eigenen geheimen Link – wer ihn kennt, kann das Projekt öffnen und bearbeiten. Eine Übersicht aller Projekte gibt es nicht.')
            : t('Produktionsberechnung, Fabrikgrundriss und Schienennetze für Satisfactory. Projekte werden lokal im Browser gespeichert (IndexedDB) und lassen sich als JSON exportieren.')}
        </p>
        <p className="dim small-text">
          {t('Spieldaten: {list} · aus den offiziellen Docs-Dateien des Spiels extrahiert · inoffizielles Fan-Werkzeug, nicht mit Coffee Stain Studios verbunden.', {
            list: DATASETS.map((d) => `Satisfactory ${d.gameVersion}`).join(', '),
          })}
        </p>
        <p>
          <button onClick={() => useUiStore.getState().setSettingsOpen(true)}>⚙ {t('Einstellungen (Sprache, Darstellung, Tasten)')}</button>{' '}
          <BugReportLink className="bug-report-link" />
        </p>
      </header>
      <div className="project-new">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Projektname')} />
        <button className="primary" onClick={async () => done(await createNew(name.trim() || t('Neues Projekt')))}>
          {t('Neues Projekt')}
        </button>
        <button onClick={async () => done(await importFromFile())}>{t('JSON importieren …')}</button>
        <button onClick={() => setSaveImport(true)} data-testid="open-save-import" title={t('Fabriken, Produktion und Schienennetz aus einem Satisfactory-Spielstand (.sav) übernehmen')}>
          {t('Spielstand importieren …')}
        </button>
        {onClose && <button onClick={onClose}>{t('Abbrechen')}</button>}
      </div>
      {saveImport && (
        <SaveImportDialog
          onClose={() => setSaveImport(false)}
          onOpened={() => {
            setSaveImport(false);
            onClose?.();
          }}
        />
      )}
      <ExamplePicker onOpened={() => onClose?.()} />
      {server ? (
        <>
          <RecentList date={date} onOpened={() => onClose?.()} />
          {projects && projects.length > 0 && <UploadOffer projects={projects} date={date} onOpened={() => onClose?.()} />}
        </>
      ) : (
        <LocalTable projects={projects} date={date} onOpened={() => onClose?.()} refresh={refresh} />
      )}
    </div>
  );
}

type ListProps = { date: (iso: string) => string; onOpened: () => void };

/** Beispielprojekte zum Ausprobieren (Name, Beschreibung, Logistikebene wo möglich). */
const EXAMPLES: { kind: ExampleKind; name: string; text: string; logistics: boolean }[] = [
  { kind: 'simple', name: N_('Eisenwerk (klein)'), text: N_('Eine Fabrik: ein Miner, zwei Schmelzöfen und drei Konstruktoren für Eisenplatten und -stangen, alles genau ausgelastet. Gut für den Einstieg in Grundriss, Bänder und Produktionsplan.'), logistics: false },
  { kind: 'complex', name: N_('Montage mit Transport'), text: N_('Zwei Fabriken: Das Eisenwerk liefert Platten per Lkw und Stangen über ein direktes Band an eine Montage für verstärkte Eisenplatten. Zeigt Transportaufträge und Importe.'), logistics: false },
  { kind: 'medium', name: N_('Computerfabrik (mittel, Auto-Layout)'), text: N_('Mit dem automatischen Layout erzeugt: 5 Computer pro Minute, 28 Maschinen mit Raffinerien, Rohren und Hauptbus.'), logistics: true },
  { kind: 'large', name: N_('Schwere modulare Rahmen (groß, Auto-Layout)'), text: N_('Mit dem automatischen Layout erzeugt: 5 schwere modulare Rahmen pro Minute, rund 150 Maschinen auf drei Etagen.'), logistics: true },
];

function ExamplePicker({ onOpened }: { onOpened: () => void }) {
  const [kind, setKind] = useState<ExampleKind>('simple');
  const [logistics, setLogistics] = useState(false);
  const [busy, setBusy] = useState(false);
  const ex = EXAMPLES.find((e) => e.kind === kind)!;
  return (
    <section className="example-picker" data-testid="example-picker">
      <h2>{t('Zum Ausprobieren')}</h2>
      <div className="example-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as ExampleKind)} data-testid="list-example-select">
          {EXAMPLES.map((e) => (
            <option key={e.kind} value={e.kind}>
              {t(e.name)}
            </option>
          ))}
        </select>
        <label className={`check-row ${ex.logistics ? '' : 'dim'}`} title={ex.logistics ? t('Bus, Zuführungen und Sammelleitungen auf einer Logistikebene unter jeder Produktionsebene') : t('Nur bei den Auto-Layout-Beispielen')}>
          <input type="checkbox" checked={ex.logistics && logistics} disabled={!ex.logistics} onChange={(e) => setLogistics(e.target.checked)} data-testid="list-example-logistics" />
          {t('mit Logistikebene')}
        </label>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await createExample(kind, { logistics: ex.logistics && logistics });
            setBusy(false);
            if (ok) onOpened();
          }}
          data-testid="list-example-open"
        >
          {busy ? t('Wird erstellt …') : t('Beispiel öffnen')}
        </button>
      </div>
      <p className="dim small-text">{t(ex.text)}</p>
    </section>
  );
}

/** Planer-Version, mit der ein Projekt zuletzt gespeichert wurde. */
function VersionCell({ version }: { version?: string }) {
  return version ? <td>{version}</td> : <td className="dim" title={t('Mit einer Planer-Version vor 0.8.3 gespeichert; die Version wird beim nächsten Speichern eingetragen.')}>{t('älter')}</td>;
}

/** Zuletzt auf diesem Gerät geöffnete Server-Projekte (Merkzettel im Browser). */
function RecentList({ date, onOpened }: ListProps) {
  const [recent, setRecent] = useState<RecentProject[]>(recentProjects);
  return (
    <section>
      <h2>{t('Zuletzt auf diesem Gerät geöffnet')}</h2>
      <table className="table" data-testid="recent-list">
        <thead>
          <tr>
            <th>{t('Projekt')}</th>
            <th>{t('Zuletzt geöffnet')}</th>
            <th title={t('Planer-Version beim letzten Speichern')}>{t('Version')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.id}>
              <td>
                <a
                  href={`/f/${r.id}`}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (await openRemote(r.id)) onOpened();
                  }}
                >
                  {r.name}
                </a>
              </td>
              <td>{date(r.openedAt)}</td>
              <VersionCell version={r.appVersion} />
              <td className="actions">
                <button className="small" onClick={() => void copy(projectUrl(r.id))} title={t('Projekt-Link in die Zwischenablage kopieren')}>
                  {t('Link kopieren')}
                </button>
                <button
                  className="small"
                  title={t('Entfernt nur den Eintrag auf diesem Gerät, nicht das Projekt auf dem Server.')}
                  onClick={() => {
                    forgetRecent(r.id);
                    setRecent(recentProjects());
                  }}
                >
                  {t('Aus Liste entfernen')}
                </button>
              </td>
            </tr>
          ))}
          {recent.length === 0 && (
            <tr>
              <td colSpan={4} className="dim">
                {t('Noch keine Projekte auf diesem Gerät geöffnet. Hast du einen Projekt-Link, öffne ihn einfach im Browser.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** Angebot, Projekte aus dem lokalen Browser-Speicher auf den Server zu übernehmen. */
function UploadOffer({ projects, date, onOpened }: ListProps & { projects: ProjectSummary[] }) {
  const [hidden, setHidden] = useState(uploadDismissed);
  const [uploaded, setUploaded] = useState(uploadedProjects);
  const [busy, setBusy] = useState<string | null>(null);
  if (hidden) return null;
  return (
    <section className="upload-offer" data-testid="upload-offer">
      <h2>{t('Lokale Projekte auf diesem Gerät')}</h2>
      <p className="small-text">
        {t('{n} Projekte liegen nur im Speicher dieses Browsers. Lade sie hoch, um sie per Link auch auf anderen Geräten zu öffnen. Die lokale Kopie bleibt erhalten.', { n: projects.length })}
      </p>
      <table className="table">
        <tbody>
          {projects.map((p) => {
            const remoteId = uploaded[p.id];
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{date(p.updatedAt)}</td>
                <VersionCell version={p.appVersion} />
                <td className="num">{t('{n} Fabriken', { n: p.factories })}</td>
                <td className="actions">
                  {remoteId ? (
                    <button className="small" onClick={async () => (await openRemote(remoteId)) && onOpened()}>
                      {t('Hochgeladen – öffnen')}
                    </button>
                  ) : (
                    <button
                      className="small primary"
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(p.id);
                        const ok = await uploadLocal(p.id);
                        setBusy(null);
                        setUploaded(uploadedProjects());
                        if (ok) onOpened();
                      }}
                    >
                      {busy === p.id ? t('Lädt hoch …') : t('Hochladen')}
                    </button>
                  )}
                  <button
                    className="small"
                    onClick={async () => {
                      const r = await loadProject(p.id);
                      if (r) downloadProject(r.project);
                    }}
                  >
                    {t('Export')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        <button
          className="small"
          onClick={() => {
            dismissUpload();
            setHidden(true);
          }}
        >
          {t('Nicht mehr anzeigen')}
        </button>
      </p>
    </section>
  );
}

/** Ohne Server: Projekte im Browser-Speicher (IndexedDB). */
function LocalTable({ projects, date, onOpened, refresh }: ListProps & { projects: ProjectSummary[] | null; refresh: () => void }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('Projekt')}</th>
          <th>{t('Zuletzt geändert')}</th>
          <th title={t('Planer-Version beim letzten Speichern')}>{t('Version')}</th>
          <th>{t('Spieldaten')}</th>
          <th className="num">{t('Fabriken')}</th>
          <th className="num">{t('Gebäude')}</th>
          <th className="num">{t('Gleise')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {projects?.map((p) => (
          <tr key={p.id}>
            <td>
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  if (await openById(p.id)) onOpened();
                }}
              >
                {p.name}
              </a>
            </td>
            <td>{date(p.updatedAt)}</td>
            <VersionCell version={p.appVersion} />
            <td>{p.datasetId}</td>
            <td className="num">{p.factories}</td>
            <td className="num">{p.buildings}</td>
            <td className="num">{p.railSegments}</td>
            <td className="actions">
              <button
                className="small"
                onClick={async () => {
                  const r = await loadProject(p.id);
                  if (r) downloadProject(r.project);
                }}
              >
                {t('Export')}
              </button>
              <button
                className="small danger"
                onClick={async () => {
                  if (!window.confirm(t('Projekt „{name}“ endgültig löschen?', { name: p.name }))) return;
                  await removeProject(p.id);
                  void refresh();
                }}
              >
                {t('Löschen')}
              </button>
            </td>
          </tr>
        ))}
        {projects?.length === 0 && (
          <tr>
            <td colSpan={8} className="dim">
              {t('Noch keine Projekte gespeichert.')}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
