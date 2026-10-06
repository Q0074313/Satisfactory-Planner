import { useEffect, useState } from 'react';
import { listProjects, loadProject, type ProjectSummary } from '../../persistence/db';
import { downloadProject } from '../../persistence/files';
import { DATASETS } from '../../state/gamedata';
import { createNew, importFromFile, openById, removeProject } from '../../state/session';
import { useUiStore } from '../../state/uiStore';
import { t } from '../../i18n';
import { usePrefs } from '../../state/prefsStore';

export function ProjectList({ onClose }: { onClose?: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState(t('Mein Projekt'));
  const lang = usePrefs((s) => s.language);
  const refresh = () => listProjects().then(setProjects, (e: Error) => useUiStore.getState().toast(e.message, 'error'));
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="project-list">
      <header>
        <h1>Satis Planner</h1>
        <p className="dim">
          {t('Produktionsberechnung, Fabrikgrundriss und Schienennetze für Satisfactory. Projekte werden lokal im Browser gespeichert (IndexedDB) und lassen sich als JSON exportieren.')}
        </p>
        <p className="dim small-text">
          {t('Spieldaten: {list} · aus den offiziellen Docs-Dateien des Spiels extrahiert · inoffizielles Fan-Werkzeug, nicht mit Coffee Stain Studios verbunden.', {
            list: DATASETS.map((d) => `Satisfactory ${d.gameVersion}`).join(', '),
          })}
        </p>
        <p>
          <button onClick={() => useUiStore.getState().setSettingsOpen(true)}>⚙ {t('Einstellungen (Sprache, Darstellung, Tasten)')}</button>
        </p>
      </header>
      <div className="project-new">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Projektname')} />
        <button
          className="primary"
          onClick={async () => {
            await createNew(name.trim() || t('Neues Projekt'));
            onClose?.();
          }}
        >
          {t('Neues Projekt')}
        </button>
        <button
          onClick={async () => {
            await importFromFile();
            onClose?.();
          }}
        >
          {t('JSON importieren …')}
        </button>
        {onClose && <button onClick={onClose}>{t('Abbrechen')}</button>}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t('Projekt')}</th>
            <th>{t('Zuletzt geändert')}</th>
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
                    if (await openById(p.id)) onClose?.();
                  }}
                >
                  {p.name}
                </a>
              </td>
              <td>{new Date(p.updatedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}</td>
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
              <td colSpan={7} className="dim">
                {t('Noch keine Projekte gespeichert.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
