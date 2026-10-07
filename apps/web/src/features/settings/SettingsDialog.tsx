/**
 * Einstellungen: Sprache, Farbschema, Darstellung, Tastenbelegung und
 * Spieldatensatz des Projekts.
 */
import { useEffect, useMemo, useState } from 'react';
import { LANGUAGES, applyGameDataMigration, planGameDataMigration, type GameDataMigrationReport, type Lang } from '@satis/core';
import { t } from '../../i18n';
import { comboOf, conflicts, formatCombo, KEY_ACTIONS, SCOPE_LABEL, type KeyScope } from '../../state/keymap';
import { DATASETS, loadGameData } from '../../state/gamedata';
import { usePrefs, type ThemePref } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, Dialog, Row, Section, Segmented } from '../../ui/fields';
import { APP_BUILT, APP_COMMIT, APP_VERSION } from '../../version';

type Tab = 'general' | 'keys' | 'data';

export function SettingsDialog() {
  const close = () => useUiStore.getState().setSettingsOpen(false);
  const [tab, setTab] = useState<Tab>('general');
  return (
    <Dialog title={t('Einstellungen')} onClose={close} wide>
      <div className="dialog-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: t('Allgemein') },
            { value: 'keys', label: t('Tastenkürzel') },
            { value: 'data', label: t('Spieldaten') },
          ]}
        />
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'data' && <DataTab />}
    </Dialog>
  );
}

function GeneralTab() {
  const prefs = usePrefs();
  return (
    <Section title={t('Allgemein')}>
      <Row label={t('Sprache')} hint={t('Sprache der Oberfläche, der Prüfmeldungen und der Spieldatennamen')}>
        <select data-testid="language-select" value={prefs.language} onChange={(e) => prefs.setLanguage(e.target.value as Lang)}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Farbschema')} plain>
        <Segmented<ThemePref>
          value={prefs.theme}
          onChange={prefs.setTheme}
          options={[
            { value: 'system', label: t('System') },
            { value: 'dark', label: t('Dunkel') },
            { value: 'light', label: t('Hell') },
          ]}
        />
      </Row>
      <label className="check-row">
        <input type="checkbox" checked={prefs.animateFlow} onChange={(e) => prefs.setAnimateFlow(e.target.checked)} />
        {t('Materialfluss auf Förderbändern animieren')}
      </label>
      <label className="check-row">
        <input type="checkbox" data-testid="detailed-tours" checked={prefs.detailedTours} onChange={(e) => prefs.setDetailedTours(e.target.checked)} />
        {t('Tutorial: ausführliche Erklärungen für Einsteiger')}
      </label>
      <p className="dim small-text">{t('Diese Einstellungen gelten für diesen Browser und werden nicht im Projekt gespeichert. Dokumentation und Spielregel-Quellen sind auf Deutsch.')}</p>
      <Row label={t('Softwareversion')}>
        <span data-testid="app-version">
          {APP_VERSION}
          {APP_COMMIT && <span className="dim"> · Commit {APP_COMMIT}</span>}
          {APP_BUILT && <span className="dim"> · {t('erstellt am {date}', { date: APP_BUILT })}</span>}
        </span>
      </Row>
    </Section>
  );
}

function KeysTab() {
  const bindings = usePrefs((s) => s.bindings);
  const keymap = usePrefs((s) => s.keymap);
  const lang = usePrefs((s) => s.language);
  const setBinding = usePrefs((s) => s.setBinding);
  const reset = usePrefs((s) => s.resetKeymap);
  const [capture, setCapture] = useState<{ id: string; add: boolean } | null>(null);
  const clash = useMemo(() => conflicts(bindings), [bindings]);

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      const action = KEY_ACTIONS.find((a) => a.id === capture.id)!;
      const combo = comboOf(e, action.ignoreShift);
      if (!combo) return;
      const current = bindings[capture.id] ?? [];
      setBinding(capture.id, capture.add ? [...new Set([...current, combo])] : [combo]);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capture, bindings, setBinding]);

  const scopes: KeyScope[] = ['global', 'factory', 'rail'];
  return (
    <div className="keymap" data-testid="keymap">
      <div className="inline pad">
        <span className="dim small-text">{t('„Ändern“ anklicken und die neue Taste drücken (Esc bricht ab). Umschalt bei Pfeiltasten verschiebt um das Hauptraster.')}</span>
        <span className="spacer" />
        <button onClick={reset}>{t('Alle zurücksetzen')}</button>
      </div>
      {scopes.map((sc) => (
        <Section key={sc} title={t(SCOPE_LABEL[sc])}>
          <table className="table compact">
            <tbody>
              {KEY_ACTIONS.filter((a) => a.scope === sc).map((a) => {
                const c = clash.get(a.id);
                return (
                  <tr key={a.id} data-action={a.id}>
                    <td>{t(a.label)}</td>
                    <td>
                      {(bindings[a.id] ?? []).map((k) => (
                        <kbd key={k} className="key-chip">
                          {formatCombo(k, lang)}
                          <button className="link-button" title={t('Belegung entfernen')} onClick={() => setBinding(a.id, (bindings[a.id] ?? []).filter((x) => x !== k))}>
                            ✕
                          </button>
                        </kbd>
                      ))}
                      {capture?.id === a.id && <Badge kind="info">{t('Taste drücken …')}</Badge>}
                      {c && (
                        <Badge kind="warn" title={c.map((id) => t(KEY_ACTIONS.find((x) => x.id === id)!.label)).join(', ')}>
                          {t('Konflikt')}
                        </Badge>
                      )}
                    </td>
                    <td className="actions">
                      <button className="small" onClick={() => setCapture({ id: a.id, add: false })}>
                        {t('Ändern')}
                      </button>
                      <button className="small" onClick={() => setCapture({ id: a.id, add: true })} title={t('Weitere Taste hinzufügen')}>
                        +
                      </button>
                      {keymap[a.id] && (
                        <button className="small" onClick={() => setBinding(a.id, null)} title={t('Standard wiederherstellen')}>
                          ↺
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ))}
    </div>
  );
}

function DataTab() {
  const project = useProjectStore((s) => s.project);
  const [target, setTarget] = useState(DATASETS[0]?.datasetId ?? '');
  const [report, setReport] = useState<GameDataMigrationReport | null>(null);
  if (!project) return <p className="dim pad">{t('Kein Projekt geöffnet.')}</p>;
  const current = project.gameData.datasetId;
  const check = async () => {
    const gd = await loadGameData(target);
    setReport(planGameDataMigration(project, gd));
  };
  const applyIt = async () => {
    const gd = await loadGameData(target);
    const changes = useProjectStore.getState().apply(t('Spieldatensatz wechseln'), (d) => applyGameDataMigration(d, gd));
    if (changes) {
      useProjectStore.setState({ gd });
      useUiStore.getState().toast(changes.at(-1) ?? '');
      setReport(null);
    }
  };
  return (
    <Section title={t('Spieldatensatz des Projekts')}>
      <Row label={t('Aktuell')}>
        {current} <Badge kind="ok">{project.gameData.gameVersion}</Badge>
      </Row>
      <Row label={t('Wechseln auf')}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {DATASETS.map((d) => (
            <option key={d.datasetId} value={d.datasetId}>
              {d.datasetId}
            </option>
          ))}
        </select>
      </Row>
      <div className="button-row">
        <button onClick={() => void check()}>{t('Prüfen (Trockenlauf)')}</button>
        <button disabled={!report || target === current} onClick={() => void applyIt()}>
          {t('Wechsel anwenden')}
        </button>
      </div>
      {report && (
        <div className="small-text pad">
          <ul>
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {[...report.missingBuildings, ...report.missingRecipes, ...report.missingItems].slice(0, 30).map((m) => (
            <div key={m.id} className="dim">
              {m.id} · {t('{n}× verwendet', { n: m.count })}
            </div>
          ))}
        </div>
      )}
      <p className="dim small-text">
        {target === current && DATASETS.length === 1
          ? t('In dieser Version ist nur ein Spieldatensatz enthalten. Nach einem Spielupdate wird ein neuer Datensatz extrahiert; der Wechsel prüft dann fehlende Gebäude, Rezepte und Gegenstände.')
          : t('Der Wechsel lässt sich rückgängig machen. Gebäude mit unbekanntem Typ bleiben erhalten und werden als Befund gemeldet.')}
      </p>
    </Section>
  );
}
