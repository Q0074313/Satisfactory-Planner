import { useEffect, useState } from 'react';
import { factoryOps as ops } from '@satis/core';
import { applyCanvasTheme } from '../canvas/draw';
import { N_, t } from '../i18n';
import { downloadProject } from '../persistence/files';
import { findingInView, useActiveFindings, useFindingCounts } from '../state/derived';
import { loadGameData } from '../state/gamedata';
import { matchAction } from '../state/keymap';
import { effectiveTheme, usePrefs } from '../state/prefsStore';
import { setNotifier, useProjectStore } from '../state/projectStore';
import { boot, importFromFile, openRemote, useAutosave, type SaveStatus } from '../state/session';
import { idFromLocation } from '../state/server';
import { LAYER_LABELS, useUiStore, type LayerKey, type Mode } from '../state/uiStore';
import { FactoryEditor } from '../features/factory/FactoryEditor';
import { LeftPanel } from '../features/factory/LeftPanel';
import { PropertiesPanel } from '../features/factory/PropertiesPanel';
import { AreaStatsPanel, BalancePanel } from '../features/factory/BalancePanel';
import { FindingsPanel } from '../features/findings/FindingsPanel';
import { ProjectList } from '../features/project/ProjectList';
import { RailEditor } from '../features/rail/RailEditor';
import { ProductionView } from '../features/production/ProductionView';
import { RailLeftPanel } from '../features/rail/RailLeftPanel';
import { RailProperties } from '../features/rail/RailProperties';
import { TransportView } from '../features/transport/TransportView';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { HelpMenu, TourOverlay, WelcomeCard } from '../features/tutorial/Tour';
import { ProjectLinkBar, ProjectLinkButton, useLinkBar } from '../features/link/ProjectLink';
import { TextField } from '../ui/fields';

setNotifier((m, k) => useUiStore.getState().toast(m, k));

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'factory', label: N_('Fabrikgrundriss') },
  { mode: 'production', label: N_('Produktion') },
  { mode: 'rail', label: N_('Schienennetz') },
  { mode: 'transport', label: N_('Transport') },
];

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: N_('Gespeichert'),
  pending: N_('Ungespeicherte Änderungen'),
  saving: N_('Speichert …'),
  error: N_('Speichern fehlgeschlagen'),
};

/** Farbschema auf Dokument und Zeichenflächen anwenden (auch bei Systemwechsel). */
function useTheme() {
  const pref = usePrefs((s) => s.theme);
  const [, force] = useState(0);
  useEffect(() => {
    const applyIt = () => {
      const eff = effectiveTheme(pref);
      document.documentElement.dataset.theme = eff;
      applyCanvasTheme(eff);
      force((x) => x + 1);
    };
    applyIt();
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener?.('change', applyIt);
    return () => mq?.removeEventListener?.('change', applyIt);
  }, [pref]);
}

export function App() {
  const project = useProjectStore((s) => s.project);
  const lang = usePrefs((s) => s.language);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const [booting, setBooting] = useState(true);
  const [showList, setShowList] = useState(false);
  useTheme();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    void boot().finally(() => setBooting(false));
    // Zurück/Vor im Browser zwischen Projekt-Links
    const onPop = () => {
      const id = idFromLocation();
      if (!id) return setShowList(true);
      if (useProjectStore.getState().remote?.id !== id) void openRemote(id, { push: false }).then((ok) => ok && setShowList(false));
      else setShowList(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (booting) return <div className="boot">{t('Lade …')}</div>;
  // Sprachwechsel: Oberfläche neu aufbauen, damit alle Texte und Berechnungen neu übersetzt werden
  return (
    <div key={lang} className="app-root">
      {!project || showList ? <ProjectList onClose={project ? () => setShowList(false) : undefined} /> : <Workspace onOpenList={() => setShowList(true)} />}
      <Toasts />
      {settingsOpen && <SettingsDialog />}
      <TourOverlay />
    </div>
  );
}

function Workspace({ onOpenList }: { onOpenList: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const remote = useProjectStore((s) => s.remote);
  const linkBar = useLinkBar();
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const factoryId = useUiStore((s) => s.factoryId);
  const networkId = useUiStore((s) => s.networkId);
  const setFactory = useUiStore((s) => s.setFactory);
  const counts = useFindingCounts();
  const { status, saveNow } = useAutosave();

  // Aktive Fabrik/Stockwerk gültig halten (z. B. nach Undo)
  useEffect(() => {
    const ui = useUiStore.getState();
    const f = ui.factoryId ? project.factories[ui.factoryId] : undefined;
    if (!f) {
      const first = Object.values(project.factories)[0];
      ui.setFactory(first?.id ?? null, first?.floorIds[0] ?? null);
    } else if (!ui.floorId || !f.floorIds.includes(ui.floorId)) {
      ui.setFloor(f.floorIds[0]!);
    }
    if (!ui.networkId || !project.railNetworks[ui.networkId]) {
      const first = Object.keys(project.railNetworks)[0] ?? null;
      if (first !== ui.networkId) ui.setNetwork(first);
    }
    const sel = ui.selection.filter((s) => (project[s.table] as Record<string, unknown>)[s.id]);
    if (sel.length !== ui.selection.length) ui.select(sel);
  }, [project]);

  // Spieldatensatz folgt dem Projekt (z. B. Rückgängig nach einem Wechsel)
  useEffect(() => {
    if (project.gameData.datasetId === gd.data.meta.datasetId) return;
    void loadGameData(project.gameData.datasetId).then((next) => useProjectStore.setState({ gd: next }));
  }, [project.gameData.datasetId, gd]);

  // Globale Tastenkürzel (eigene Belegung)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUiStore.getState().settingsOpen) return;
      const el = document.activeElement;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      const action = matchAction(e, 'global', usePrefs.getState().bindings);
      if (!action) return;
      const ui = useUiStore.getState();
      switch (action) {
        case 'global.undo':
          if (typing) return;
          e.preventDefault();
          undo();
          break;
        case 'global.redo':
          if (typing) return;
          e.preventDefault();
          redo();
          break;
        case 'global.save':
          e.preventDefault();
          void saveNow();
          break;
        case 'global.export':
          e.preventDefault();
          downloadProject(useProjectStore.getState().project!);
          break;
        case 'global.search':
          e.preventDefault();
          document.getElementById('catalog-search')?.focus();
          break;
        case 'global.help':
          e.preventDefault();
          ui.startTour('intro');
          break;
        case 'global.settings':
          e.preventDefault();
          ui.setSettingsOpen(true);
          break;
        case 'global.mode.factory':
        case 'global.mode.production':
        case 'global.mode.rail':
        case 'global.mode.transport':
          if (typing) return;
          e.preventDefault();
          ui.setMode(action.slice('global.mode.'.length) as Mode);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveNow]);

  const factories = Object.values(project.factories);

  return (
    <div className="workspace">
      <header className="topbar">
        <button className="brand" onClick={onOpenList} title={t('Projektliste')}>
          Satis Planner
        </button>
        <span className="project-name">
          <TextField value={project.name} onCommit={(name) => apply(t('Projekt umbenennen'), (d) => void (d.name = name))} />
        </span>
        <span className="dim small-text" title={t('Spieldatenversion des Projekts')}>
          Satisfactory {project.gameData.gameVersion}
        </span>
        <nav className="modes" data-tour="modes">
          {MODES.map((m) => {
            const c = counts[m.mode];
            return (
              <button key={m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)} data-mode={m.mode}>
                {t(m.label)}
                {c.error > 0 && <span className="badge badge-err mode-count">{c.error}</span>}
                {c.warning > 0 && <span className="badge badge-warn mode-count">{c.warning}</span>}
              </button>
            );
          })}
        </nav>
        <div className="spacer" />
        <div className="topbar-actions" data-tour="topbar-actions">
          <button onClick={undo} disabled={!canUndo} title={t('Rückgängig (Strg+Z)')}>
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title={t('Wiederholen (Strg+Y / Strg+Umschalt+Z)')}>
            ↷
          </button>
          <span
            className={`save-status save-${status}`}
            title={remote ? t('Autosave auf den Server (Strg+S speichert sofort)') : t('Autosave in den Browser-Speicher (Strg+S speichert sofort)')}
          >
            {t(SAVE_LABEL[status])}
          </span>
          <button onClick={() => downloadProject(project)} title={t('Als JSON exportieren (Strg+E)')}>
            {t('Export')}
          </button>
          <button onClick={() => void importFromFile()}>{t('Import')}</button>
          {mode === 'factory' && <LayerMenu />}
          <ProjectLinkButton onShow={linkBar.show} />
          <HelpMenu />
          <button onClick={() => useUiStore.getState().setSettingsOpen(true)} title={t('Einstellungen (Strg+,)')} data-testid="settings-button">
            ⚙
          </button>
        </div>
      </header>
      {!linkBar.hidden && <ProjectLinkBar onHide={linkBar.hide} />}

      {mode === 'factory' && (
        <div className="factory-tabs">
          {factories.map((f) => (
            <button key={f.id} className={f.id === factoryId ? 'active' : ''} style={{ borderBottomColor: f.color }} onClick={() => setFactory(f.id, f.floorIds[0] ?? null)}>
              {f.name}
            </button>
          ))}
          <button
            className="small"
            onClick={() => {
              const id = apply(t('Fabrik hinzufügen'), (d) => ops.addFactory(d, t('Fabrik {n}', { n: factories.length + 1 })));
              if (id) {
                const f = useProjectStore.getState().project!.factories[id]!;
                setFactory(id, f.floorIds[0]!);
              }
            }}
          >
            {t('+ Fabrik')}
          </button>
          {factoryId && factories.length > 0 && (
            <button
              className="small danger"
              onClick={() => {
                const f = project.factories[factoryId];
                if (f && window.confirm(t('Fabrik „{name}“ mit allen Gebäuden löschen? (Rückgängig möglich)', { name: f.name }))) apply(t('Fabrik löschen'), (d) => ops.removeFactory(d, factoryId));
              }}
            >
              {t('Fabrik löschen')}
            </button>
          )}
        </div>
      )}

      <main className="main">
        {mode === 'production' ? (
          <ProductionView bottom={<BottomPanel />} />
        ) : mode === 'transport' ? (
          <TransportView bottom={<BottomPanel />} />
        ) : mode === 'rail' ? (
          <>
            <RailLeftPanel />
            <div className="center">
              {networkId && project.railNetworks[networkId] ? <RailEditor key={networkId} /> : <div className="empty pad">{t('Noch kein Schienennetz. Links mit „+“ ein Netz anlegen.')}</div>}
              <BottomPanel />
            </div>
            <RailProperties />
          </>
        ) : mode === 'factory' && factoryId ? (
          <>
            <LeftPanel />
            <div className="center">
              <FactoryEditor key={factoryId} />
              <BottomPanel />
            </div>
            <PropertiesPanel />
          </>
        ) : (
          <div className="empty pad">{t('Keine Fabrik vorhanden. Bitte oben eine Fabrik anlegen.')}</div>
        )}
      </main>
      <WelcomeCard />
    </div>
  );
}

function BottomPanel() {
  const project = useProjectStore((s) => s.project)!;
  const tab = useUiStore((s) => s.bottomTab);
  const open = useUiStore((s) => s.bottomOpen);
  const mode = useUiStore((s) => s.mode);
  const factoryId = useUiStore((s) => s.factoryId);
  const networkId = useUiStore((s) => s.networkId);
  const scope = useUiStore((s) => s.findingsScope);
  const setTab = useUiStore((s) => s.setBottomTab);
  const toggle = useUiStore((s) => s.toggleBottom);
  const { active } = useActiveFindings();
  const shown = scope === 'all' ? active : active.filter((f) => findingInView(f, project, mode, factoryId, networkId));
  const errors = shown.filter((f) => f.severity === 'error').length;
  const warnings = shown.filter((f) => f.severity === 'warning').length;
  const factoryTabs = mode === 'factory';
  const current = factoryTabs ? tab : 'findings';
  return (
    <section className={`bottom ${open ? 'open' : ''}`} data-tour="bottom">
      <div className="bottom-tabs">
        <button className={current === 'findings' ? 'active' : ''} onClick={() => setTab('findings')}>
          {t('Befunde')} {errors > 0 && <span className="badge badge-err">{errors}</span>} {warnings > 0 && <span className="badge badge-warn">{warnings}</span>}
        </button>
        {factoryTabs && (
          <>
            <button className={tab === 'balance' ? 'active' : ''} onClick={() => setTab('balance')}>
              {t('Bilanz')}
            </button>
            <button className={tab === 'areas' ? 'active' : ''} onClick={() => setTab('areas')}>
              {t('Flächen')}
            </button>
          </>
        )}
        <div className="spacer" />
        <button className="small" onClick={toggle} aria-label={open ? t('Einklappen') : t('Ausklappen')}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="bottom-body">
          {current === 'findings' && <FindingsPanel />}
          {current === 'balance' && <BalancePanel />}
          {current === 'areas' && <AreaStatsPanel />}
        </div>
      )}
    </section>
  );
}

function LayerMenu() {
  const layers = useUiStore((s) => s.layers);
  const toggle = useUiStore((s) => s.toggleLayer);
  const animate = usePrefs((s) => s.animateFlow);
  const [open, setOpen] = useState(false);
  return (
    <div className="menu">
      <button onClick={() => setOpen(!open)}>{t('Ebenen ▾')}</button>
      {open && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <p className="dim small-text">{t('Darstellungsebenen (nur Anzeige)')}</p>
          {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {t(LAYER_LABELS[k])}
            </label>
          ))}
          <label>
            <input type="checkbox" checked={animate} onChange={(e) => usePrefs.getState().setAnimateFlow(e.target.checked)} /> {t('Fluss animieren')}
          </label>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}`} onClick={() => dismiss(x.id)}>
          {x.message}
        </div>
      ))}
    </div>
  );
}
