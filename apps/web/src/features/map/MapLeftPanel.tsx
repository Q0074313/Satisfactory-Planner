/** Linke Leiste der Karte: Kartenbild, Ebenen, Vorkommen, Fabriken, Standortvorschlag. */
import { useMemo } from 'react';
import { BLACKBOX_AREA_FACTOR, factoryFootprint, factoryWorldCenter, mapOps, nodeUsage, siteDemandFromPlan, suggestSites, usedNodes, type Purity } from '@satis/core';
import { RESOURCE_COLORS, PURITY_COLORS } from '../../canvas/mapDraw';
import { N_, t } from '../../i18n';
import { MAP_LAYER_LABELS, mapView, useMapStore, type MapLayerKey } from '../../state/mapStore';
import { usePrefs, type MapTiles } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { Badge, fmtNum, NumberField, Row, Section, Segmented } from '../../ui/fields';
import { resourceKey } from './filter';
import { placementAt } from './MapView';

const PURITY_LABEL: Record<Purity, string> = { impure: N_('unrein'), normal: N_('normal'), pure: N_('rein') };
const KIND_LABEL = { node: N_('Nodes'), well: N_('Quellen (Satelliten)'), 'well-core': N_('Quellenmitten') } as const;
const MINERS = ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C'];

export function MapLeftPanel() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const tiles = usePrefs((s) => s.mapTiles);
  const opacity = usePrefs((s) => s.mapOpacity);
  const st = useMapStore();
  const usage = useMemo(() => nodeUsage(project), [project]);
  const map = gd.map;

  // Rohstoffe mit Anzahl (frei / gesamt)
  const resources = useMemo(() => {
    const m = new Map<string, { total: number; free: number }>();
    for (const n of map?.nodes ?? []) {
      if (n.kind === 'well-core') continue;
      const k = resourceKey(n);
      const e = m.get(k) ?? { total: 0, free: 0 };
      e.total++;
      if (!usage.has(n.id)) e.free++;
      m.set(k, e);
    }
    return [...m.entries()].sort(([a], [b]) => resName(a).localeCompare(resName(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, usage]);
  function resName(k: string) {
    return k === 'geyser' ? t('Geysir') : gd.name(k);
  }

  const factories = Object.values(project.factories);
  const plans = Object.values(project.productionPlans);

  return (
    <aside className="panel panel-left" data-tour="map-left">
      <Section title={t('Kartenbild')}>
        <Segmented<MapTiles>
          value={tiles}
          onChange={(v) => usePrefs.getState().setMapTiles(v)}
          options={[
            { value: 'game', label: t('Spielkarte') },
            { value: 'realistic', label: t('Realistisch') },
            { value: 'off', label: t('Aus') },
          ]}
        />
        {tiles !== 'off' && (
          <Row label={t('Deckkraft')}>
            <input type="range" min={10} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => usePrefs.getState().setMapOpacity(Number(e.target.value) / 100)} />
          </Row>
        )}
        <p className="dim small-text">
          {t('Kartenbild und Lage der Vorkommen: satisfactory-calculator.com. Die Kacheln lädt dein Browser direkt von dort; ohne Internet bleibt nur das Raster.')}
        </p>
      </Section>

      <Section title={t('Ebenen')}>
        {(Object.keys(MAP_LAYER_LABELS) as MapLayerKey[]).map((k) => (
          <label key={k} className="check-row">
            <input type="checkbox" checked={st.layers[k]} onChange={() => st.toggleLayer(k)} /> {t(MAP_LAYER_LABELS[k])}
          </label>
        ))}
      </Section>

      <Section
        title={t('Vorkommen')}
        actions={
          <span>
            <button className="small" onClick={() => st.setHiddenResources([])} title={t('Alle Rohstoffe zeigen')}>
              {t('alle')}
            </button>{' '}
            <button className="small" onClick={() => st.setHiddenResources(resources.map(([k]) => k))} title={t('Alle Rohstoffe ausblenden')}>
              {t('keine')}
            </button>
          </span>
        }
      >
        <div className="map-filter">
          {(Object.keys(PURITY_LABEL) as Purity[]).map((p) => (
            <label key={p} className="check-row">
              <input type="checkbox" checked={st.purities[p]} onChange={() => st.togglePurity(p)} /> <span className="swatch" style={{ background: PURITY_COLORS[p] }} /> {t(PURITY_LABEL[p])}
            </label>
          ))}
        </div>
        <div className="map-filter">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={st.kinds[k]} onChange={() => st.toggleKind(k)} /> {t(KIND_LABEL[k])}
            </label>
          ))}
          <label className="check-row">
            <input type="checkbox" checked={st.onlyFree} onChange={(e) => st.setOnlyFree(e.target.checked)} /> {t('nur freie')}
          </label>
        </div>
        <ul className="item-list" data-testid="map-resources">
          {resources.map(([k, c]) => (
            <li key={k} className={st.hiddenResources.includes(k) ? 'dim' : ''} onClick={() => st.toggleResource(k)}>
              <span>
                <input type="checkbox" readOnly checked={!st.hiddenResources.includes(k)} /> <span className="swatch" style={{ background: RESOURCE_COLORS[k] ?? '#ccc' }} /> {resName(k)}
              </span>
              <span className="dim" title={t('frei / gesamt')}>
                {c.free}/{c.total}
              </span>
            </li>
          ))}
        </ul>
        {!map && <p className="dim small-text">{t('Der Spieldatensatz enthält keine Kartendaten.')}</p>}
      </Section>

      <Section title={t('Fabriken')}>
        <ul className="item-list" data-testid="map-factories">
          {factories.map((f) => {
            const placing = st.tool.kind === 'place-factory' && st.tool.factoryId === f.id;
            const sel = st.selection?.kind === 'factory' && st.selection.id === f.id;
            return (
              <li key={f.id} className={sel ? 'active' : ''}>
                <span
                  onClick={() => {
                    st.select({ kind: 'factory', id: f.id });
                    const c = factoryWorldCenter(project, gd, f.id);
                    if (c) st.focusOn(c.x, c.y);
                  }}
                >
                  <span className="swatch" style={{ background: f.color }} /> {f.name}
                </span>
                {f.map ? (
                  <Badge kind="ok">{t('auf der Karte')}</Badge>
                ) : (
                  <button className={`small ${placing ? 'active' : ''}`} onClick={() => st.setTool(placing ? { kind: 'select' } : { kind: 'place-factory', factoryId: f.id, rotationDeg: 0 })} data-testid={`place-factory-${f.id}`}>
                    {t('Platzieren')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {st.tool.kind === 'place-factory' && <p className="hint small-text">{t('Auf die Karte klicken, um die Fabrik zu setzen (R: drehen, Esc: abbrechen).')}</p>}
        {factories.some((f) => !f.map) && st.tool.kind !== 'place-factory' && (
          <p className="dim small-text">{t('Grundriss auf der Karte: Bau- und Fundamentflächen der Fabrik, sonst die Hülle der Gebäude.')}</p>
        )}
      </Section>

      <SiteSection
        plans={plans.map((pl) => ({ id: pl.id, label: `${pl.name} (${project.factories[pl.factoryId]?.name ?? '?'})` }))}
        onPlace={(planId, center) => {
          const plan = project.productionPlans[planId];
          if (!plan) return;
          const f = project.factories[plan.factoryId];
          if (!f) return;
          if (f.map && !window.confirm(t('Fabrik „{name}“ ist bereits platziert. An den vorgeschlagenen Standort verschieben?', { name: f.name }))) return;
          const m = placementAt(project, gd, f.id, center, f.map?.rotationDeg ?? 0, false);
          apply(t('Fabrik am vorgeschlagenen Standort platzieren'), (d) => mapOps.setFactoryMap(d, f.id, m));
          st.select({ kind: 'factory', id: f.id });
        }}
      />
      {factories.length > 0 && <FootprintHint />}
    </aside>
  );
}

function FootprintHint() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const sel = useMapStore((s) => s.selection);
  if (sel?.kind !== 'factory') return null;
  const fp = factoryFootprint(project, gd, sel.id);
  if (fp.source === 'areas') return null;
  return (
    <p className="hint small-text pad-x">
      {fp.source === 'buildings'
        ? t('Die Fabrik hat noch keine Baufläche; der Grundriss auf der Karte ist aus den Gebäuden geschätzt (gestrichelt).')
        : fp.source === 'estimate'
          ? t('Blackbox: Die Fläche auf der Karte ist aus den Maschinen der Produktionspläne geschätzt (gestrichelt, Faktor {f} für Leitungen und Wege).', { f: BLACKBOX_AREA_FACTOR })
          : t('Die Fabrik hat weder Fläche noch Gebäude; auf der Karte steht ein Platzhalter von 32 × 32 m.')}
    </p>
  );
}

function SiteSection({ plans, onPlace }: { plans: { id: string; label: string }[]; onPlace: (planId: string, center: { x: number; y: number }) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const sites = useMapStore((s) => s.sites);
  const setSites = useMapStore((s) => s.setSites);
  const focusOn = useMapStore((s) => s.focusOn);
  const cur = sites ?? { planId: plans[0]?.id ?? '', scope: 'all' as const, minerType: 'Build_MinerMk2_C', clock: 1, radiusM: 1500, results: [], active: null };
  const planId = plans.some((p) => p.id === cur.planId) ? cur.planId : (plans[0]?.id ?? '');
  const demand = useMemo(() => (planId ? siteDemandFromPlan(project, gd, planId) : []), [project, gd, planId]);
  const unit = (id: string) => (gd.item(id)?.form === 'solid' ? '/min' : ' m³/min');

  const run = () => {
    const factoryId = project.productionPlans[planId]?.factoryId;
    const bounds = cur.scope === 'view' ? mapView.rect : null;
    const results = suggestSites(gd, demand, { minerType: cur.minerType, clock: cur.clock, maxRadiusM: cur.radiusM, used: usedNodes(project, factoryId), bounds });
    setSites({ ...cur, planId, results, active: results.length ? 0 : null });
    const first = results[0];
    if (first) focusOn(first.center.x, first.center.y, 0.5);
  };

  return (
    <Section title={t('Standortvorschlag')}>
      {plans.length === 0 ? (
        <p className="dim small-text">{t('Zuerst unter „Produktion“ einen Produktionsplan anlegen.')}</p>
      ) : (
        <>
          <Row label={t('Plan')}>
            <select value={planId} onChange={(e) => setSites({ ...cur, planId: e.target.value, results: [], active: null })} data-testid="site-plan">
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('Miner')}>
            <select value={cur.minerType} onChange={(e) => setSites({ ...cur, planId, minerType: e.target.value })}>
              {MINERS.filter((m) => gd.building(m)).map((m) => (
                <option key={m} value={m}>
                  {gd.name(m)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('Takt')} hint={t('Takt aller Gewinnungsgebäude im Vorschlag')}>
            <NumberField value={cur.clock * 100} min={1} max={250} suffix="%" onCommit={(v) => setSites({ ...cur, planId, clock: v / 100 })} />
          </Row>
          <Row label={t('Suchen in')} plain>
            <Segmented<'all' | 'view'>
              value={cur.scope}
              onChange={(scope) => setSites({ ...cur, planId, scope, results: [], active: null })}
              options={[
                { value: 'all', label: t('ganzer Karte') },
                { value: 'view', label: t('diesem Ausschnitt'), title: t('Nur Standorte und Vorkommen im aktuell sichtbaren Kartenausschnitt') },
              ]}
            />
          </Row>
          <Row label={t('Suchradius')}>
            <NumberField value={cur.radiusM} min={100} max={8000} step={100} digits={0} suffix="m" onCommit={(v) => setSites({ ...cur, planId, radiusM: v })} />
          </Row>
          <p className="dim small-text">
            {demand.length
              ? t('Bedarf: {list}', { list: demand.map((d) => `${gd.name(d.itemId)} ${fmtNum(d.perMin, 1)}${unit(d.itemId)}`).join(', ') })
              : t('Der Plan braucht keine Rohstoffe aus eigener Gewinnung (Wasser und Importe zählen nicht).')}
          </p>
          <div className="row-actions">
            <button onClick={run} disabled={!demand.length} data-testid="site-run">
              {t('Standorte suchen')}
            </button>
            {sites && sites.results.length > 0 && (
              <button onClick={() => setSites({ ...sites, results: [], active: null })} title={t('Vorschläge und ihre Markierungen auf der Karte ausblenden (Esc)')} data-testid="site-clear">
                {t('Vorschläge ausblenden')}
              </button>
            )}
          </div>
          {sites && sites.planId === planId && (
            <ol className="item-list site-list" data-testid="site-results">
              {sites.results.length === 0 && <li className="dim">{t('Keine passenden Vorkommen gefunden.')}</li>}
              {sites.results.map((r, i) => (
                <li
                  key={i}
                  className={sites.active === i ? 'active' : ''}
                  onClick={() => {
                    setSites({ ...sites, active: i });
                    focusOn(r.center.x, r.center.y);
                  }}
                >
                  <span title={t('Deckung des Bedarfs · mittlere Entfernung der Vorkommen')}>
                    <b>{i + 1}.</b> {fmtNum(r.coverage * 100, 0)} % · Ø {fmtNum(r.meanDistM, 0)} m
                  </span>
                  <span className="dim">{t('{n} Vorkommen', { n: r.picks.length })}</span>
                </li>
              ))}
            </ol>
          )}
          {sites && sites.planId === planId && sites.active !== null && sites.results[sites.active] && (
            <SiteDetail index={sites.active} onPlace={(c) => onPlace(planId, c)} />
          )}
          <p className="dim small-text">
            {t('Heuristik: nächstgelegene freie Vorkommen je Rohstoff, gewichtet mit der Menge. Gelände, Höhen und Wege bleiben unberücksichtigt.')}
          </p>
        </>
      )}
    </Section>
  );
}

function SiteDetail({ index, onPlace }: { index: number; onPlace: (c: { x: number; y: number }) => void }) {
  const gd = useProjectStore((s) => s.gd)!;
  const r = useMapStore((s) => s.sites!.results[index]!);
  const unit = (id: string) => (gd.item(id)?.form === 'solid' ? '/min' : ' m³/min');
  return (
    <div className="site-detail">
      <table className="table compact">
        <tbody>
          {r.items.map((i) => (
            <tr key={i.itemId}>
              <td>{gd.name(i.itemId)}</td>
              <td className="num">
                {fmtNum(i.covered, 1)} / {fmtNum(i.demand, 1)}
                {unit(i.itemId)}
              </td>
              <td>{i.covered + 1e-6 >= i.demand ? <Badge kind="ok">✓</Badge> : <Badge kind="warn">{t('fehlt')}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim small-text">{t('Weiteste Entfernung {d} m', { d: fmtNum(r.maxDistM, 0) })}</p>
      <button onClick={() => onPlace(r.center)} data-testid="site-place">
        {t('Fabrik hier platzieren')}
      </button>
    </div>
  );
}
