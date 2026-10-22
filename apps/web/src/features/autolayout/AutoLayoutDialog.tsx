/**
 * „Layout automatisch erzeugen“: Vorgaben (Fläche, Etagen, Stufen, Bauweise,
 * Verteilung, Takt) → Varianten mit Vorschau, Kennzahlen und Prüfung durch
 * das Durchsatzmodell → Übernahme in die Fabrik (ein Undo-Schritt).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyLayout,
  buildingOutline,
  checkLayout,
  createProject,
  factoryOps as ops,
  freeLayoutOrigin,
  generateLayouts,
  geo,
  LAYOUT_DEFAULTS,
  solveProduction,
  type AutoLayoutOptions,
  type LayoutCheck,
  type LayoutDraft,
  type LayoutVariant,
  type Project,
} from '@satis/core';
import { useCanvas } from '../../canvas/useCanvas';
import { COLORS } from '../../canvas/draw';
import { N_, t } from '../../i18n';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, Dialog, fmtNum, NumberField, Row, Section, Segmented } from '../../ui/fields';
import { renderFactory } from '../factory/render';
import { buildScene } from '../factory/scene';

const VARIANT_LABEL: Record<LayoutVariant, { name: string; text: string }> = {
  rows: { name: N_('A · Reihen'), text: N_('Linien auf einer Seite des Hauptbusses, Fluss von oben nach unten.') },
  compact: { name: N_('B · Kompakt'), text: N_('Linien auf beiden Seiten des Hauptbusses, eher quadratisch.') },
  floors: { name: N_('C · Etagen'), text: N_('Linien beidseitig auf mehrere Etagen verteilt; Lifte im Bus verbinden die Etagen.') },
};

/**
 * Eingebaute Bauarten (orientiert an üblichen Bauweisen: Manifold als
 * Standard, Load Balancer bei Bedarf, Fundamentraster, Laufwege, Etagen).
 * Fläche, Plan und Bandstufen bleiben unberührt, außer die Bauart nennt sie.
 */
export const BUILTIN_PRESETS: { id: string; name: string; text: string; options: Partial<AutoLayoutOptions>; variant: LayoutVariant }[] = [
  {
    id: 'bus',
    name: N_('Hauptbus mit Manifolds (Standard)'),
    text: N_('Linien auf einer Seite eines geraden Busses, Splitter direkt vor jeder Maschine. Einfach zu bauen und zu erweitern; die Maschinen füllen sich nacheinander.'),
    options: { spacing: 'compact', distribution: 'manifold', crossings: 'avoid', clocks: 'even', maxFloors: 1 },
    variant: 'rows',
  },
  {
    id: 'block',
    name: N_('Kompakter Block'),
    text: N_('Linien auf beiden Seiten des Busses: kürzere Wege, eher quadratische Grundfläche.'),
    options: { spacing: 'compact', distribution: 'manifold', crossings: 'avoid', maxFloors: 1 },
    variant: 'compact',
  },
  {
    id: 'walkways',
    name: N_('Mit Laufwegen'),
    text: N_('Maschinen auf ganzen Fundamenten mit Abstand und einer freien Fundamentreihe zwischen den Linien – Platz zum Laufen und für spätere Erweiterungen.'),
    options: { spacing: 'wide', distribution: 'manifold', crossings: 'avoid' },
    variant: 'compact',
  },
  {
    id: 'balancer',
    name: N_('Load Balancer'),
    text: N_('Splitterbäume verteilen von Anfang an gleichmäßig auf alle Maschinen. Braucht mehr Platz und Splitter als ein Manifold.'),
    options: { spacing: 'compact', distribution: 'balanced', crossings: 'avoid' },
    variant: 'rows',
  },
  {
    id: 'tower',
    name: N_('Hochbau (Etagen)'),
    text: N_('Vorprodukte unten, Endprodukte oben; Lifte im Bus verbinden die Etagen. Kleine Grundfläche.'),
    options: { spacing: 'compact', distribution: 'manifold', crossings: 'avoid', maxFloors: 3 },
    variant: 'floors',
  },
  {
    id: 'early',
    name: N_('Früh im Spiel (flach)'),
    text: N_('Alles auf einer Höhe ohne Lifte, Förderband Mk.2 und volle Maschinen plus eine Restmaschine. Kreuzungen löst du beim Bauen von Hand.'),
    options: { spacing: 'compact', distribution: 'manifold', crossings: 'allow', clocks: 'full', beltTier: 'Build_ConveyorBeltMk2_C', pipeTier: 'Build_Pipeline_C', maxFloors: 1 },
    variant: 'rows',
  },
];

/** Zuletzt gewählte Vorgaben (für die Sitzung). */
let lastOptions: AutoLayoutOptions = { ...LAYOUT_DEFAULTS };
let lastPreset = 'bus';

export function AutoLayoutDialog() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const req = useUiStore((s) => s.autoLayout)!;
  const close = () => useUiStore.getState().closeAutoLayout();
  const [factoryId, setFactoryId] = useState(req.factoryId);
  const plans = Object.values(project.productionPlans).filter((p) => p.factoryId === factoryId);
  const [planId, setPlanId] = useState(req.planId ?? plans[0]?.id ?? '');
  const plan = project.productionPlans[planId]?.factoryId === factoryId ? project.productionPlans[planId] : plans[0];
  const [opts, setOptsState] = useState<AutoLayoutOptions>(lastOptions);
  const setOpts = (patch: Partial<AutoLayoutOptions>) =>
    setOptsState((o) => {
      lastOptions = { ...o, ...patch };
      return lastOptions;
    });
  const factory = project.factories[factoryId];
  // Ort: frei neben dem Bestand oder eine vorhandene Bau- bzw. Fundamentfläche des untersten Stockwerks
  const areas = Object.values(project.areas).filter((a) => a.factoryId === factoryId && a.kind !== 'clearance' && a.floorId === factory?.floorIds[0]);
  const [place, setPlace] = useState<string>('free');
  const area = place !== 'free' ? project.areas[place] : undefined;
  const region = area ? geo.rectOf(area.polygon) : null;
  const effective: AutoLayoutOptions = region ? { ...opts, maxWidthM: region.maxX - region.minX, maxDepthM: region.maxY - region.minY } : opts;
  const origin = useMemo(() => (region ? { x: region.minX, y: region.minY } : freeLayoutOrigin(project, gd, factoryId)), [region?.minX, region?.minY, project, gd, factoryId]);

  // Wie in der Produktionsansicht: „nur vorhandene Maschinen“ rechnet mit den Maschinen der Fabrik
  const existing = useMemo(() => Object.values(project.buildings).filter((b) => b.factoryId === factoryId), [project.buildings, factoryId]);
  const result = useMemo(() => (plan ? solveProduction(gd, plan, { existingMachines: existing }) : null), [gd, plan, existing]);
  const effKey = JSON.stringify(effective);
  const drafts = useMemo(() => (result ? generateLayouts(gd, result, effective) : []), [gd, result, effKey]);
  const [selected, setSelected] = useState<LayoutVariant>(BUILTIN_PRESETS.find((x) => x.id === lastPreset)?.variant ?? 'rows');
  const userPresets = usePrefs((s) => s.layoutPresets);
  const [preset, setPresetState] = useState(lastPreset);
  const choosePreset = (id: string) => {
    lastPreset = id;
    setPresetState(id);
    const b = BUILTIN_PRESETS.find((x) => x.id === id);
    const u = id.startsWith('user:') ? userPresets.find((x) => `user:${x.name}` === id) : undefined;
    const chosen = b ?? u;
    if (!chosen) return;
    setOpts(chosen.options);
    setSelected(chosen.variant);
  };
  const presetText = BUILTIN_PRESETS.find((x) => x.id === preset)?.text;
  const current = drafts.find((d) => d.variant === selected) ?? drafts[0];

  // Prüfung nacheinander im Hintergrund (das Durchsatzmodell großer Layouts dauert etwas)
  const [checks, setChecks] = useState<Map<LayoutDraft, LayoutCheck>>(new Map());
  useEffect(() => {
    setChecks(new Map());
    let cancelled = false;
    let i = 0;
    const next = () => {
      if (cancelled || i >= drafts.length) return;
      const d = drafts[i++]!;
      const c = checkLayout(project, gd, factoryId, d, origin);
      if (cancelled) return;
      setChecks((m) => new Map(m).set(d, c));
      setTimeout(next, 0);
    };
    const h = setTimeout(next, 30);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [drafts, project, gd, factoryId, origin]);

  const take = (d: LayoutDraft) => {
    const r = apply(t('Auto-Layout'), (p, g) => {
      const res = applyLayout(p, g, factoryId, d, origin, { foundations: opts.foundations });
      p.factories[factoryId]!.blackbox = false;
      return res;
    });
    if (!r) return;
    const f = useProjectStore.getState().project!.factories[factoryId]!;
    const ui = useUiStore.getState();
    ui.setMode('factory');
    ui.setFactory(factoryId, f.floorIds[0] ?? null);
    ui.focusOn(origin.x + d.width / 2, origin.y + d.depth / 2);
    ui.toast(
      t('Layout übernommen: {n} Gebäude, {m} Verbindungen. Die Eingänge (Lager bzw. Flüssigkeitspuffer) brauchen noch Zulauf, z. B. über einen Transportauftrag oder Gewinnungsgebäude.', {
        n: r.buildingIds.length,
        m: r.linkIds.length,
      }),
    );
    close();
  };

  const beltTiers = gd.beltTiers;
  const pipeTiers = gd.pipeTiers;
  return (
    <Dialog title={t('Layout automatisch erzeugen')} onClose={close} xwide>
      <div className="al-grid">
        <div className="al-options">
          <Section title={t('Plan')}>
            <Row label={t('Fabrik')}>
              <select
                value={factoryId}
                onChange={(e) => {
                  setFactoryId(e.target.value);
                  setPlanId('');
                  setPlace('free');
                }}
              >
                {Object.values(project.factories).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Produktionsplan')}>
              <select data-testid="al-plan" value={plan?.id ?? ''} onChange={(e) => setPlanId(e.target.value)}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Row>
            {result && result.status === 'optimal' && (
              <p className="dim small-text">{t('{n} Maschinen, {r} Rezepte', { n: result.machineCount, r: result.recipes.length })}</p>
            )}
            {!plan && <p className="hint small-text">{t('Diese Fabrik hat noch keinen Produktionsplan.')}</p>}
          </Section>
          <Section title={t('Bauart')}>
            <select data-testid="al-preset" value={preset} onChange={(e) => choosePreset(e.target.value)}>
              {BUILTIN_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.name)}
                </option>
              ))}
              {userPresets.length > 0 && (
                <optgroup label={t('Eigene Bauarten')}>
                  {userPresets.map((p) => (
                    <option key={p.name} value={`user:${p.name}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {presetText && <p className="dim small-text">{t(presetText)}</p>}
            <div className="inline">
              <button
                className="small"
                data-testid="al-save-preset"
                onClick={() => {
                  const name = window.prompt(t('Name der Bauart:'), '')?.trim();
                  if (!name) return;
                  const { maxWidthM: _w, maxDepthM: _d, ...rest } = opts;
                  usePrefs.getState().saveLayoutPreset({ name, options: rest, variant: current?.variant ?? selected });
                  lastPreset = `user:${name}`;
                  setPresetState(lastPreset);
                }}
              >
                {t('Als Bauart speichern …')}
              </button>
              {preset.startsWith('user:') && (
                <button className="small danger" onClick={() => {
                  usePrefs.getState().removeLayoutPreset(preset.slice(5));
                  choosePreset('bus');
                }}>
                  {t('Bauart löschen')}
                </button>
              )}
            </div>
          </Section>
          <Section title={t('Fläche und Etagen')}>
            <Row label={t('Ort')}>
              <select data-testid="al-place" value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="free">{t('freie Fläche neben dem Bestand')}</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Breite höchstens')} hint={region ? t('Durch die gewählte Fläche festgelegt.') : t('Leer = unbegrenzt')}>
              <NumberField
                value={effective.maxWidthM ?? NaN}
                allowEmpty
                min={16}
                step={8}
                suffix="m"
                disabled={!!region}
                placeholder={t('unbegrenzt')}
                onCommit={(v) => setOpts({ maxWidthM: Number.isFinite(v) ? v : null })}
              />
            </Row>
            <Row label={t('Tiefe höchstens')}>
              <NumberField
                value={effective.maxDepthM ?? NaN}
                allowEmpty
                min={16}
                step={8}
                suffix="m"
                disabled={!!region}
                placeholder={t('unbegrenzt')}
                onCommit={(v) => setOpts({ maxDepthM: Number.isFinite(v) ? v : null })}
              />
            </Row>
            <Row label={t('Etagen höchstens')}>
              <NumberField value={opts.maxFloors} min={1} max={8} step={1} digits={0} onCommit={(v) => setOpts({ maxFloors: Math.max(1, Math.min(8, Math.round(v))) })} />
            </Row>
          </Section>
          <Section title={t('Bauweise')}>
            <Row label={t('Bänder bis')}>
              <select data-testid="al-belt" value={opts.beltTier} onChange={(e) => setOpts({ beltTier: e.target.value })}>
                {beltTiers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {gd.name(b.id)} ({b.conveyor!.itemsPerMin}/min)
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Rohre bis')}>
              <select value={opts.pipeTier} onChange={(e) => setOpts({ pipeTier: e.target.value })}>
                {pipeTiers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {gd.name(b.id)} ({b.pipe!.m3PerMin} m³/min)
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('Abstände')}>
              <Segmented
                value={opts.spacing}
                onChange={(spacing) => setOpts({ spacing })}
                options={[
                  { value: 'compact', label: t('kompakt'), title: t('Maschinen eng nebeneinander') },
                  { value: 'wide', label: t('breit'), title: t('Mit Laufwegen zwischen Maschinen und Linien') },
                ]}
              />
            </Row>
            <Row label={t('Verteilung')} hint={t('Gilt für Bänder; Rohre werden immer als Sammelleitung verlegt.')}>
              <Segmented
                value={opts.distribution}
                onChange={(distribution) => setOpts({ distribution })}
                options={[
                  { value: 'manifold', label: t('Manifold'), title: t('Sammelleitung mit einem Splitter je Maschine') },
                  { value: 'balanced', label: t('Balanced'), title: t('Splitterbaum: gleichmäßige Verteilung von Anfang an') },
                ]}
              />
            </Row>
            <Row label={t('Kreuzungen')} hint={t('Vermeiden: Bus eine Stufe höher, Abzweige darunter, äußere Zuführungen höher – keine Leitungen kreuzen sich auf gleicher Höhe. Erlauben: alles flach, Kreuzungen löst du im Spiel.')}>
              <Segmented
                value={opts.crossings}
                onChange={(crossings) => setOpts({ crossings })}
                options={[
                  { value: 'avoid', label: t('vermeiden'), title: t('Über Höhen und Lifte lösen') },
                  { value: 'allow', label: t('erlauben'), title: t('Alles auf einer Höhe') },
                ]}
              />
            </Row>
            <Row label={t('Takt')}>
              <Segmented
                value={opts.clocks}
                onChange={(clocks) => setOpts({ clocks })}
                options={[
                  { value: 'even', label: t('gleichmäßig'), title: t('Alle Maschinen eines Rezepts mit demselben Takt') },
                  { value: 'full', label: t('volle + Rest'), title: t('Volle Maschinen mit 100 % und eine Maschine mit dem Rest') },
                ]}
              />
            </Row>
            <label className="check-row">
              <input type="checkbox" checked={opts.foundations} onChange={(e) => setOpts({ foundations: e.target.checked })} />
              {t('Fundamentfläche anlegen')}
            </label>
          </Section>
        </div>

        <div className="al-variants">
          {drafts.length === 0 ? (
            <div className="empty pad">{plan ? (result?.status === 'optimal' ? t('Der Plan enthält keine Maschinen.') : t('Der Plan ist nicht lösbar.')) : t('Produktionsplan wählen.')}</div>
          ) : (
            <>
              <div className="al-tabs" role="tablist">
                {drafts.map((d) => {
                  const c = checks.get(d);
                  return (
                    <button key={d.variant} role="tab" data-testid={`al-variant-${d.variant}`} className={d === current ? 'active' : ''} onClick={() => setSelected(d.variant)}>
                      <strong>{t(VARIANT_LABEL[d.variant].name)}</strong>
                      <span className="dim small-text">
                        {fmtNum(d.width, 0)} × {fmtNum(d.depth, 0)} m{d.floorHeights.length > 1 ? ` · ${t('{n} Etagen', { n: d.floorHeights.length })}` : ''}
                      </span>
                      <span>
                        {!d.fits && <Badge kind="err">{t('passt nicht')}</Badge>}
                        {c ? (
                          <Badge kind={c.minUtilization > 0.999 && c.hardOverlaps === 0 ? 'ok' : 'warn'}>{t('{p} %', { p: fmtNum(c.minUtilization * 100, 0) })}</Badge>
                        ) : (
                          <Badge kind="muted">{t('prüfe …')}</Badge>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {current && <VariantDetails key={`${current.variant}-${effKey}`} draft={current} check={checks.get(current)} onTake={() => take(current)} project={project} foundations={opts.foundations} />}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function VariantDetails({
  draft,
  check,
  onTake,
  project,
  foundations,
}: {
  draft: LayoutDraft;
  check: LayoutCheck | undefined;
  onTake: () => void;
  project: Project;
  foundations: boolean;
}) {
  const c = draft.counts;
  return (
    <div className="al-details" data-testid="al-details">
      <p className="small-text">{t(VARIANT_LABEL[draft.variant].text)}</p>
      <LayoutPreview draft={draft} datasetId={project.gameData.datasetId} gameVersion={project.gameData.gameVersion} foundations={foundations} />
      <table className="table al-stats">
        <tbody>
          <tr>
            <th>{t('Maße')}</th>
            <td>
              {fmtNum(draft.width, 0)} × {fmtNum(draft.depth, 0)} m · {t('{n} Etage(n)', { n: draft.floorHeights.length })}
            </td>
          </tr>
          <tr>
            <th>{t('Gebäude')}</th>
            <td>
              {t('{m} Maschinen in {l} Linien, {b} Busspuren', { m: c.machines, l: c.lines, b: c.lanes })} · {t('{s} Splitter, {g} Zusammenführungen, {j} Rohrkreuzungen', { s: c.splitters, g: c.mergers, j: c.junctions })}
            </td>
          </tr>
          <tr>
            <th>{t('Übergaben')}</th>
            <td>{t('{e} Eingänge, {x} Ausgänge (Lager bzw. Flüssigkeitspuffer)', { e: c.entries, x: c.exits })}</td>
          </tr>
          <tr>
            <th>{t('Leitungen')}</th>
            <td>
              {check
                ? t('{b} m Band, {p} m Rohr, {l} mit Lift', { b: fmtNum(check.beltLengthM, 0), p: fmtNum(check.pipeLengthM, 0), l: check.liftCount })
                : t('{n} Verbindungen', { n: draft.links.length })}
            </td>
          </tr>
          <tr>
            <th>{t('Prüfung')}</th>
            <td data-testid="al-check">
              {check ? (
                <>
                  <Badge kind={check.minUtilization > 0.999 ? 'ok' : 'warn'}>
                    {t('Auslastung min. {a} %, Mittel {b} %', { a: fmtNum(check.minUtilization * 100, 1), b: fmtNum(check.avgUtilization * 100, 1) })}
                  </Badge>{' '}
                  <Badge kind={check.hardOverlaps === 0 ? 'ok' : 'err'}>{t('{n} Überschneidungen', { n: check.hardOverlaps + check.softOverlaps })}</Badge>{' '}
                  <Badge kind={check.crossings === 0 ? 'ok' : 'warn'} title={t('Leitungspaare, die sich auf gleicher Höhe kreuzen oder überdecken')}>
                    {t('{n} Kreuzungen auf gleicher Höhe', { n: check.crossings })}
                  </Badge>
                </>
              ) : (
                <span className="dim">{t('Durchsatzmodell wird gerechnet …')}</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="dim small-text">
        {t('Eingänge werden in der Prüfung als voll versorgt angenommen. Anschlusslagen sind schematisch. Im Grundriss liegen Leitungen übereinander, wenn sie auf verschiedenen Höhen verlaufen.')}
      </p>
      {draft.notes.length > 0 && (
        <ul className="small-text al-notes">
          {draft.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="al-actions">
        {!draft.fits && <Badge kind="err">{t('Passt nicht in die Vorgaben')}</Badge>}
        <button className="primary" data-testid="al-take" onClick={onTake}>
          {t('Layout übernehmen')}
        </button>
        <span className="dim small-text">{t('Rückgängig mit Strg+Z')}</span>
      </div>
    </div>
  );
}

/** Vorschau eines Entwurfs in einem eigenen kleinen Projekt (Zoomen mit dem Mausrad). */
function LayoutPreview({ draft, datasetId, gameVersion, foundations }: { draft: LayoutDraft; datasetId: string; gameVersion: string; foundations: boolean }) {
  const gd = useProjectStore((s) => s.gd)!;
  const layers = useUiStore((s) => s.layers);
  const [floor, setFloor] = useState(0);
  const scratch = useMemo(() => {
    const p = createProject({ name: 'preview', datasetId, gameVersion, empty: true });
    const fid = ops.addFactory(p, 'preview');
    applyLayout(p, gd, fid, draft, { x: 0, y: 0 }, { foundations });
    return { p, fid };
  }, [draft, gd, datasetId, gameVersion, foundations]);
  const floorId = scratch.p.factories[scratch.fid]!.floorIds[floor] ?? scratch.p.factories[scratch.fid]!.floorIds[0]!;
  const scene = useMemo(() => buildScene(scratch.p, gd, scratch.fid, floorId), [scratch, gd, floorId]);
  const fitted = useRef(false);
  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw(ctx, vp) {
      if (!fitted.current && vp.width > 10) {
        vp.fit({ minX: 0, minY: 0, maxX: draft.width, maxY: draft.depth }, 12);
        fitted.current = true;
      }
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, vp.width, vp.height);
      renderFactory(ctx, vp, {
        project: scratch.p,
        gd,
        scene,
        floorId,
        layers: { ...layers, map: false, nodes: false, rail: false, flow: false },
        selection: [],
        marks: new Map(),
      });
      // Ein- und Ausgänge hervorheben
      for (const sb of scene.buildings) {
        if (!sb.building.label || !sb.onActiveFloor) continue;
        const def = gd.building(sb.building.type);
        if (!def || !sb.building.placement) continue;
        const o = buildingOutline(def, sb.building.placement).map((q) => vp.toScreen(q));
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        o.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.stroke();
      }
    },
  });
  useEffect(() => {
    fitted.current = false;
    requestDraw();
  }, [scene, requestDraw]);
  void viewport;
  return (
    <div className="al-preview">
      {draft.floorHeights.length > 1 && (
        <Segmented
          value={String(floor)}
          onChange={(v) => setFloor(Number(v))}
          options={draft.floorHeights.map((_, i) => ({ value: String(i), label: t('Etage {n}', { n: i + 1 }) }))}
        />
      )}
      <canvas ref={canvasRef} className="al-canvas" data-testid="al-preview" />
    </div>
  );
}
