/**
 * Einstellungen: Sprache, Farbschema, Darstellung, Tastenbelegung und
 * Spieldatensatz des Projekts.
 */
import { useEffect, useMemo, useState } from 'react';
import { LANGUAGES, applyGameDataMigration, planGameDataMigration, type GameDataMigrationReport, type Lang } from '@satis/core';
import { N_, t } from '../../i18n';
import { comboOf, conflicts, formatCombo, KEY_ACTIONS, SCOPE_LABEL, type KeyScope } from '../../state/keymap';
import { DATASETS, loadGameData } from '../../state/gamedata';
import { CUSTOM_COLOR_KEYS, effectiveTheme, usePrefs, type CustomColorKey, type ThemePref } from '../../state/prefsStore';
import { defaultCanvasColor } from '../../canvas/draw';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, Dialog, Row, Section, Segmented } from '../../ui/fields';
import { APP_BUILT, APP_COMMIT, APP_VERSION } from '../../version';
import { UpdateStatus } from '../updates/UpdateNotice';
import { ProgressSection } from '../project/ProgressSection';

type Tab = 'general' | 'display' | 'keys' | 'data';

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
            { value: 'display', label: t('Darstellung') },
            { value: 'keys', label: t('Tastenkürzel') },
            { value: 'data', label: t('Spieldaten') },
          ]}
        />
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'display' && <DisplayTab />}
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
        <input type="checkbox" data-testid="detailed-tours" checked={prefs.detailedTours} onChange={(e) => prefs.setDetailedTours(e.target.checked)} />
        {t('Tutorial: ausführliche Erklärungen für Einsteiger')}
      </label>
      <label className="check-row" title={t('Für Streams und Bildschirmfreigaben: Der Projekt-Link wird verdeckt angezeigt. Kopieren funktioniert weiterhin.')}>
        <input type="checkbox" data-testid="streamer-mode" checked={prefs.streamerMode} onChange={(e) => prefs.setStreamerMode(e.target.checked)} />
        {t('Streamer-Modus: Projekt-Link verdecken')}
      </label>
      <p className="dim small-text">{t('Diese Einstellungen gelten für diesen Browser und werden nicht im Projekt gespeichert. Dokumentation und Spielregel-Quellen sind auf Deutsch.')}</p>
      <Row label={t('Softwareversion')}>
        <span data-testid="app-version">
          {APP_VERSION}
          {APP_COMMIT && <span className="dim"> · Commit {APP_COMMIT}</span>}
          {APP_BUILT && <span className="dim"> · {t('erstellt am {date}', { date: APP_BUILT })}</span>}
        </span>
      </Row>
      <Row label={t('Updates')} hint={t('Beim Start wird auf GitHub nachgesehen, ob es eine neuere Version gibt.')}>
        <UpdateStatus />
      </Row>
      <AboutNote />
    </Section>
  );
}

/** Bezeichnungen der anpassbaren Farben (deutsch, Anzeige über t()). */
const COLOR_LABELS: Record<CustomColorKey, string> = {
  belt0: N_('Förderband Mk.1'),
  belt1: N_('Förderband Mk.2'),
  belt2: N_('Förderband Mk.3'),
  belt3: N_('Förderband Mk.4'),
  belt4: N_('Förderband Mk.5'),
  belt5: N_('Förderband Mk.6'),
  pipe0: N_('Rohr Mk.1'),
  pipe1: N_('Rohr Mk.2'),
  portIn: N_('Eingang (Anschluss)'),
  portOut: N_('Ausgang (Anschluss)'),
  fuelPort: N_('Treibstoffanschluss'),
  production: N_('Produktionsgebäude'),
  extraction: N_('Gewinnungsgebäude'),
  power: N_('Kraftwerke'),
  logistics: N_('Logistik (Splitter, Pumpen …)'),
  storage: N_('Lager'),
  selection: N_('Auswahl'),
  overload: N_('Überlastung'),
};

const COLOR_GROUPS: { title: string; keys: CustomColorKey[] }[] = [
  { title: N_('Förderbänder'), keys: ['belt0', 'belt1', 'belt2', 'belt3', 'belt4', 'belt5'] },
  { title: N_('Rohre'), keys: ['pipe0', 'pipe1'] },
  { title: N_('Anschlüsse'), keys: ['portIn', 'portOut', 'fuelPort'] },
  { title: N_('Gebäude'), keys: ['production', 'extraction', 'power', 'logistics', 'storage'] },
  { title: N_('Sonstiges'), keys: ['selection', 'overload'] },
];

function DisplayTab() {
  const prefs = usePrefs();
  const theme = effectiveTheme(prefs.theme);
  return (
    <div className="display-settings">
      <Section title={t('Materialfluss')}>
        <label className="check-row">
          <input type="checkbox" data-testid="animate-flow" checked={prefs.animateFlow} onChange={(e) => prefs.setAnimateFlow(e.target.checked)} />
          {t('Materialfluss auf Förderbändern und Rohren animieren (Grundriss, Seitenansicht und 3D-Ansicht)')}
        </label>
      </Section>
      <Section title={t('Stockwerke')}>
        <Row label={t('Andere Stockwerke')} hint={t('Deckkraft von Leitungen und Gebäudeumrissen auf den nicht gewählten Stockwerken (Grundriss und Seitenansicht)')}>
          <span className="inline">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(prefs.otherFloorOpacity * 100)}
              onChange={(e) => prefs.setOtherFloorOpacity(+e.target.value / 100)}
              data-testid="other-floor-opacity"
            />
            <span className="dim">{Math.round(prefs.otherFloorOpacity * 100)} %</span>
          </span>
        </Row>
      </Section>
      <Section title={t('Farben')}>
        <p className="dim small-text">{t('Eigene Farben gelten im hellen und im dunklen Farbschema. Nicht angepasste Farben folgen dem Farbschema.')}</p>
        {COLOR_GROUPS.map((g) => (
          <div key={g.title} className="color-group">
            <div className="color-group-title">{t(g.title)}</div>
            {g.keys.filter((k) => CUSTOM_COLOR_KEYS.includes(k)).map((k) => {
              const custom = prefs.colors[k];
              return (
                <Row key={k} label={t(COLOR_LABELS[k])} plain>
                  <span className="inline">
                    <input type="color" value={custom ?? toHex(defaultCanvasColor(theme, k))} onChange={(e) => prefs.setColor(k, e.target.value)} data-testid={`color-${k}`} />
                    {custom && (
                      <button className="small" onClick={() => prefs.setColor(k, null)} title={t('Standardfarbe des Farbschemas verwenden')}>
                        {t('Standard')}
                      </button>
                    )}
                  </span>
                </Row>
              );
            })}
          </div>
        ))}
        <div className="button-row">
          <button onClick={prefs.resetColors} disabled={!Object.keys(prefs.colors).length} data-testid="colors-reset">
            {t('Alle Farben zurücksetzen')}
          </button>
        </div>
      </Section>
    </div>
  );
}

/** Farbwähler brauchen #rrggbb; rgba-Werte des Farbschemas werden ohne Deckkraft übernommen. */
function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? `#${[m[1], m[2], m[3]].map((x) => (+x!).toString(16).padStart(2, '0')).join('')}` : '#888888';
}

/** Hinweis zur Entstehung und zu möglichen Fehlern (auch im Hilfemenü). */
export function AboutNote() {
  return (
    <div className="about-note small-text" data-testid="about-note">
      <p>{t('Satis Planner ist ein privates Fanprojekt und steht in keiner Verbindung zu Coffee Stain Studios.')}</p>
      <p>{t('Der Planer wurde zusammen mit Claude (KI von Anthropic) entwickelt. Berechnungen, Prüfregeln und Spieldaten können Fehler enthalten – wichtige Werte bitte im Spiel nachprüfen.')}</p>
      <p>
        {t('Spielinhalte (Namen, Werte, Kartenbild) stammen aus Satisfactory; alle Rechte und Marken liegen bei Coffee Stain Studios. Lage der Rohstoffvorkommen und Kartenkacheln: satisfactory-calculator.com, die Kacheln lädt der Browser direkt von dort.')}
      </p>
    </div>
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

  const scopes: KeyScope[] = ['global', 'factory', 'rail', 'map'];
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
    <>
    <ProgressSection />
    <Section title={t('Durchsatzmodell')}>
      <label className="check-row" title={t('Entladende Bahnsteige und Lkw-Stationen ohne Transportauftrag liefern im Durchsatzmodell, was die Maschinen dahinter brauchen (Annahme). Standard bei aus Spielständen importierten Projekten.')}>
        <input
          type="checkbox"
          checked={project.settings.stationsOnDemand}
          onChange={(e) => useProjectStore.getState().apply(t('Stationen nach Bedarf'), (d) => void (d.settings.stationsOnDemand = e.target.checked))}
          data-testid="stations-on-demand"
        />
        {t('Stationen ohne Transportauftrag liefern nach Bedarf')}
      </label>
    </Section>
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
    </>
  );
}
