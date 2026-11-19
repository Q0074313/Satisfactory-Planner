/**
 * Spielstand importieren: .sav im Browser lesen (Web Worker), Vorschlag der
 * Fabriken auf der Karte zeigen, Gruppen umbenennen, zusammenlegen oder
 * weglassen, dann ein neues Projekt anlegen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { groupSave, maxTierForPhase, projectFromSave, SAVE_GROUP_DEFAULTS, type GameDataIndex, type SaveExtract, type SaveGroup, type SaveImportReport } from '@satis/core';
import { useCanvas } from '../../canvas/useCanvas';
import { COLORS, drawLabel } from '../../canvas/draw';
import { drawMapTiles, onTileLoad, TILE_ATTRIBUTION } from '../../canvas/mapTiles';
import { t } from '../../i18n';
import { DEFAULT_DATASET, loadGameData } from '../../state/gamedata';
import { storeNewProject } from '../../state/session';
import { usePrefs } from '../../state/prefsStore';
import { useUiStore } from '../../state/uiStore';
import { Dialog, fmtNum, Row, Section } from '../../ui/fields';
import { readSave } from './readSave';

/** Dateiauswahl mit gemerktem Ordner (File System Access API, Chrome/Edge; in Brave und Firefox nicht verfügbar). */
type OpenPicker = (o: { id?: string; startIn?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ getFile(): Promise<File> }[]>;
const canPickFile = () => typeof (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker === 'function';

async function pickWithDialog(): Promise<File | undefined> {
  try {
    const open = (window as unknown as { showOpenFilePicker: OpenPicker }).showOpenFilePicker;
    // Gleiche ID: der Browser öffnet wieder den Ordner der letzten Auswahl
    const [h] = await open({ id: 'satisfactory-save', startIn: 'documents', types: [{ description: t('Satisfactory-Spielstand'), accept: { 'application/octet-stream': ['.sav'] } }] });
    return h ? await h.getFile() : undefined;
  } catch {
    return undefined; // abgebrochen
  }
}

function CopyPath({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="small"
      onClick={() =>
        void navigator.clipboard?.writeText(path).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        )
      }
      title={t('Pfad kopieren')}
    >
      {done ? t('kopiert') : t('Pfad kopieren')}
    </button>
  );
}

interface EditGroup extends SaveGroup {
  include: boolean;
}

export function SaveImportDialog({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const [gd, setGd] = useState<GameDataIndex | null>(null);
  const [extract, setExtract] = useState<SaveExtract | null>(null);
  const [state, setState] = useState<'pick' | 'reading' | 'edit' | 'creating'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [gapM, setGapM] = useState(SAVE_GROUP_DEFAULTS.gapM);
  const [groups, setGroups] = useState<EditGroup[]>([]);
  const [rail, setRail] = useState(true);
  const [plans, setPlans] = useState(true);
  const [name, setName] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lang = usePrefs((s) => s.language);

  useEffect(() => {
    if (DEFAULT_DATASET) void loadGameData(DEFAULT_DATASET.datasetId).then(setGd);
  }, []);
  const grouping = useMemo(() => (extract && gd ? groupSave(extract, gd, { gapM }) : null), [extract, gd, gapM]);
  useEffect(() => {
    if (grouping) setGroups(grouping.groups.map((g) => ({ ...g, include: true })));
  }, [grouping]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setState('reading');
    try {
      const ex = await readSave(file);
      setExtract(ex);
      setName(ex.meta.sessionName || file.name.replace(/\.sav$/i, ''));
      setState('edit');
    } catch (e) {
      setError(t('Spielstand konnte nicht gelesen werden: {msg}', { msg: e instanceof Error ? e.message : String(e) }));
      setState('pick');
    }
  };

  const merge = (key: string, into: string) =>
    setGroups((gs) => {
      const a = gs.find((g) => g.key === key)!;
      return gs
        .filter((g) => g.key !== key)
        .map((g) =>
          g.key === into
            ? {
                ...g,
                buildingIds: [...g.buildingIds, ...a.buildingIds],
                shapes: [...g.shapes, ...a.shapes],
                rect: { minX: Math.min(g.rect.minX, a.rect.minX), minY: Math.min(g.rect.minY, a.rect.minY), maxX: Math.max(g.rect.maxX, a.rect.maxX), maxY: Math.max(g.rect.maxY, a.rect.maxY) },
                counts: {
                  buildings: g.counts.buildings + a.counts.buildings,
                  machines: g.counts.machines + a.counts.machines,
                  extractors: g.counts.extractors + a.counts.extractors,
                  generators: g.counts.generators + a.counts.generators,
                  storage: g.counts.storage + a.counts.storage,
                },
              }
            : g,
        );
    });

  /** Teilungsvorschlag annehmen: die Fabrik wird durch ihre Teile ersetzt. */
  const split = (key: string) => setGroups((gs) => gs.flatMap((g) => (g.key === key && g.split ? g.split.map((p) => ({ ...p, include: g.include })) : [g])));
  const splittable = groups.filter((g) => g.split);

  const create = async () => {
    if (!extract || !gd || !DEFAULT_DATASET) return;
    setState('creating');
    // Rechnen erst nach dem Neuzeichnen (Hinweis „Lege an …“ sichtbar)
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { project, report } = projectFromSave(extract, gd, {
        name: name.trim() || t('Spielstand'),
        datasetId: DEFAULT_DATASET.datasetId,
        gameVersion: DEFAULT_DATASET.gameVersion,
        groups: groups.filter((g) => g.include).map((g) => ({ name: g.name.trim() || t('Fabrik'), buildingIds: g.buildingIds })),
        rail,
        plans,
      });
      const ok = await storeNewProject(project);
      if (!ok) {
        setState('edit');
        return;
      }
      toastReport(report);
      onOpened();
    } catch (e) {
      // Fehler zeigen statt im Zustand „Lege an …“ hängen zu bleiben
      useUiStore.getState().toast(t('Projekt konnte nicht angelegt werden: {msg}', { msg: e instanceof Error ? e.message : String(e) }), 'error');
      setState('edit');
    }
  };

  const tier = extract && gd ? Math.max(0, ...extract.schematics.map((id) => gd.data.schematics?.[id]).filter((s) => s?.kind === 'milestone').map((s) => s!.tier)) : 0;
  const included = groups.filter((g) => g.include);

  return (
    <Dialog title={t('Spielstand importieren')} onClose={onClose} xwide>
      <div className="pad save-import" data-testid="save-import">
        {state === 'pick' || state === 'reading' ? (
          <>
            <p>
              {t(
                'Einen Spielstand (.sav) wählen. Er wird nur in diesem Browser gelesen und nicht hochgeladen; übernommen werden Fabriken (Gebäude, Rezepte, Takt, Bänder und Rohre), Produktionspläne, das Schienennetz mit Zügen und der Spielfortschritt.',
              )}
            </p>
            <ul className="dim small-text save-paths">
              <li>
                {t('Windows: %LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\<ID>\\')} <CopyPath path={'%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\'} />
              </li>
              <li>
                {t('Linux (Steam/Proton): ~/.steam/steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames/<ID>/')}{' '}
                <CopyPath path="~/.steam/steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames/" />
              </li>
              <li>{t('Mac (CrossOver, Whisky o. Ä.): im Windows-Laufwerk der Flasche unter …/drive_c/users/<Name>/AppData/Local/FactoryGame/Saved/SaveGames/<ID>/')}</li>
            </ul>
            <p className="dim small-text">
              {t('Tipp: Pfad kopieren und im Dateidialog einfügen (Linux: Strg+L, Windows: in die Adressleiste). Chrome und Edge öffnen beim nächsten Mal wieder den zuletzt gewählten Ordner.')}
            </p>
            {canPickFile() && (
              <button className="primary" disabled={state === 'reading' || !gd} onClick={() => void pickWithDialog().then(pick)} data-testid="save-pick">
                {t('Spielstand wählen …')}
              </button>
            )}{' '}
            <input ref={fileRef} type="file" accept=".sav" disabled={state === 'reading' || !gd} onChange={(e) => void pick(e.target.files?.[0])} data-testid="save-file" />
            {state === 'reading' && <p data-testid="save-reading">{t('Lese Spielstand …')}</p>}
            {error && <p className="warn-text">{error}</p>}
          </>
        ) : (
          extract &&
          gd &&
          grouping && (
            <>
              <p data-testid="save-summary">
                <b>{extract.meta.sessionName}</b> · {extract.meta.saveName} · {t('{h} h gespielt', { h: fmtNum(extract.meta.playSeconds / 3600, 0) })}
                {extract.meta.savedAt && <> · {new Date(extract.meta.savedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')}</>} · {t('Tier {n}', { n: tier })}
                {extract.phase !== null && <> · {t('Phase {n} geliefert', { n: Math.min(extract.phase, 5) })}</>} ·{' '}
                {t('Gebäude: {b} · Band- und Rohrabschnitte: {c} · Bahnhöfe: {s} · Züge: {z}', { b: extract.buildings.length, c: extract.conveyors.length, s: extract.stations.length, z: extract.trains.length })}
              </p>
              {extract.meta.modded && <p className="warn-text small-text">{t('Spielstand mit Mods: Gebäude aus Mods werden ausgelassen.')}</p>}
              {tier > maxTierForPhase(gd, extract.phase ?? 4) && <p className="dim small-text">{t('Hinweis: Tier und Phase passen nicht zusammen (z. B. Kreativmodus).')}</p>}
              <div className="save-import-body">
                <GroupMap gd={gd} groups={groups} active={active} onPick={setActive} />
                <div className="save-import-side">
                  <Section title={t('Optionen')}>
                    <Row label={t('Projektname')}>
                      <input value={name} onChange={(e) => setName(e.target.value)} />
                    </Row>
                    <Row
                      label={t('Abstand')}
                      hint={t('Maschinen mit höchstens diesem Abstand bilden eine Fabrik (nicht über getrennte Fundamentflächen hinweg), über Bänder bzw. Rohre verbundene bei bis zu 150 m Weg. Lager, Bahnhöfe und Lkw-Stationen verbinden keine Fabriken; sie gehören zur nächsten.')}
                    >
                      <input type="range" min={4} max={80} step={4} value={gapM} onChange={(e) => setGapM(Number(e.target.value))} data-testid="save-gap" /> {gapM} m
                    </Row>
                    <label className="check-row">
                      <input type="checkbox" checked={rail} onChange={(e) => setRail(e.target.checked)} />
                      {t('Schienennetz, Bahnhöfe und Züge übernehmen')}
                    </label>
                    <label className="check-row">
                      <input type="checkbox" checked={plans} onChange={(e) => setPlans(e.target.checked)} />
                      {t('Je Fabrik einen Produktionsplan aus den Maschinen anlegen')}
                    </label>
                  </Section>
                  <Section title={t('Fabriken ({n} von {m})', { n: included.length, m: groups.length })}>
                    <div className="inline small-text">
                      <button className="small" onClick={() => setGroups((gs) => gs.map((g) => ({ ...g, include: true })))}>
                        {t('alle')}
                      </button>
                      <button className="small" onClick={() => setGroups((gs) => gs.map((g) => ({ ...g, include: g.counts.machines + g.counts.generators > 0 })))}>
                        {t('nur mit Maschinen')}
                      </button>
                      {splittable.length > 0 && (
                        <button className="small" onClick={() => splittable.forEach((g) => split(g.key))} data-testid="save-split-all" title={t('Große Fabriken nach Produktionsketten teilen (Vorschlag)')}>
                          {t('alle Vorschläge teilen ({n})', { n: splittable.length })}
                        </button>
                      )}
                    </div>
                    <ul className="save-groups" data-testid="save-groups">
                      {groups.map((g) => (
                        <li key={g.key} className={`${g.key === active ? 'active' : ''} ${g.include ? '' : 'dim'}`} onClick={() => setActive(g.key)}>
                          <input type="checkbox" checked={g.include} onChange={(e) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, include: e.target.checked } : x)))} />
                          <input className="save-group-name" value={g.name} onChange={(e) => setGroups((gs) => gs.map((x) => (x.key === g.key ? { ...x, name: e.target.value } : x)))} />
                          <span className="dim small-text">
                            {t('{b} Gebäude, {m} Maschinen', { b: g.counts.buildings, m: g.counts.machines + g.counts.generators })}
                            {g.products.length > 0 && <> · {g.products.map((id) => gd.name(id)).join(', ')}</>}
                          </span>
                          {g.split && (
                            <button
                              className="small"
                              onClick={() => split(g.key)}
                              title={t('Nach Produktionsketten teilen: {parts}', { parts: g.split.map((p) => p.name).join(', ') })}
                              data-testid="save-split"
                            >
                              {t('teilen ({n})', { n: g.split.length })}
                            </button>
                          )}
                          <select
                            className="small"
                            value=""
                            title={t('Mit einer anderen Fabrik zusammenlegen')}
                            onChange={(e) => e.target.value && merge(g.key, e.target.value)}
                          >
                            <option value="">{t('zusammenlegen …')}</option>
                            {groups
                              .filter((x) => x.key !== g.key)
                              .map((x) => (
                                <option key={x.key} value={x.key}>
                                  {x.name}
                                </option>
                              ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                    {(grouping.ungrouped > 0 || grouping.longLinks > 0) && (
                      <p className="dim small-text">
                        {t('{u} einzelne Gebäude ohne Maschine ausgelassen; {l} Band- bzw. Rohrverbindungen zwischen Fabriken werden zu Transportaufträgen.', { u: grouping.ungrouped, l: grouping.longLinks })}
                      </p>
                    )}
                  </Section>
                </div>
              </div>
              <div className="button-row">
                <button onClick={onClose}>{t('Abbrechen')}</button>
                <button className="primary" disabled={state === 'creating' || included.length === 0} onClick={() => void create()} data-testid="save-create">
                  {state === 'creating' ? t('Lege an …') : t('Projekt anlegen')}
                </button>
              </div>
            </>
          )
        )}
      </div>
    </Dialog>
  );
}

function toastReport(r: SaveImportReport) {
  const ui = useUiStore.getState();
  ui.toast(
    t('Spielstand übernommen – Fabriken: {f}, Gebäude: {b}, Leitungen: {l}, Bahnhöfe: {s}, Züge: {z}, Pläne: {p}.', { f: r.factories, b: r.buildings, l: r.links, s: r.stations, z: r.trains, p: r.plans }),
  );
  for (const n of r.notes.slice(0, 4)) ui.toast(n);
}

/** Karte mit den vorgeschlagenen Fabriken (Rechtecke); Klick wählt eine Gruppe. */
function GroupMap({ gd, groups, active, onPick }: { gd: GameDataIndex; groups: EditGroup[]; active: string | null; onPick: (key: string) => void }) {
  const fitted = useRef(false);
  const { canvasRef, requestDraw } = useCanvas({
    draw(ctx, vp) {
      if (!fitted.current && vp.width > 10 && groups.length) {
        const r = groups.reduce((a, g) => ({ minX: Math.min(a.minX, g.rect.minX), minY: Math.min(a.minY, g.rect.minY), maxX: Math.max(a.maxX, g.rect.maxX), maxY: Math.max(a.maxY, g.rect.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        vp.fit(r, 40);
        fitted.current = true;
      }
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, vp.width, vp.height);
      if (gd.map) drawMapTiles(ctx, vp, gd.map, 'game', 0.8);
      for (const g of groups) {
        const a = vp.toScreen({ x: g.rect.minX, y: g.rect.minY });
        const b = vp.toScreen({ x: g.rect.maxX, y: g.rect.maxY });
        const w = Math.max(4, b.x - a.x);
        // Umrisse der Gebäude statt eines Rechtecks (Fabriken sind selten rechteckig)
        ctx.fillStyle = g.include ? 'rgba(240,160,40,0.45)' : 'rgba(128,128,128,0.3)';
        for (const r of g.shapes) {
          const p = vp.toScreen({ x: r.minX, y: r.minY });
          const q = vp.toScreen({ x: r.maxX, y: r.maxY });
          ctx.fillRect(p.x, p.y, Math.max(2, q.x - p.x), Math.max(2, q.y - p.y));
        }
        if (g.key === active) {
          ctx.strokeStyle = COLORS.selection;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(a.x - 3, a.y - 3, w + 6, Math.max(4, b.y - a.y) + 6);
          ctx.setLineDash([]);
        }
        // Beschriftung nur, wo Platz ist (oder bei der gewählten Gruppe)
        if (g.key === active || (g.include && (w > 28 || g.counts.machines + g.counts.generators > 0))) drawLabel(ctx, g.name, a.x + w / 2, a.y - 4, { align: 'center', size: 11, bg: COLORS.labelBg });
      }
      drawLabel(ctx, `© ${TILE_ATTRIBUTION}`, vp.width - 6, vp.height - 6, { align: 'right', size: 10, bg: COLORS.labelBg });
    },
    onPointerDown(e) {
      const hit = groups.find((g) => e.world.x >= g.rect.minX - 8 && e.world.x <= g.rect.maxX + 8 && e.world.y >= g.rect.minY - 8 && e.world.y <= g.rect.maxY + 8);
      if (hit) onPick(hit.key);
    },
  });
  useEffect(() => requestDraw(), [groups, active, requestDraw]);
  useEffect(() => onTileLoad(requestDraw), [requestDraw]);
  return <canvas ref={canvasRef} className="save-import-map" data-testid="save-map" />;
}
