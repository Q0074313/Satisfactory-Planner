/** Rechte Leiste der Karte: Vorkommen bzw. Fabrikstandort. */
import { useMemo, useState } from 'react';
import {
  factoryFootprint,
  factoryNodeDemand,
  factoryWorldCenter,
  formatNumber,
  geo,
  mapOps,
  nodeExtractorTypes,
  nodeRate,
  nodesNear,
  nodeTitle,
  nodeUsage,
  mapOps as mops,
  purityLabel,
  type MapNode,
} from '@satis/core';
import { N_, t } from '../../i18n';
import { useMapStore } from '../../state/mapStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section } from '../../ui/fields';

const KIND_LABEL = { node: N_('Node'), well: N_('Satellit einer Quelle'), 'well-core': N_('Mitte einer Quelle'), geyser: N_('Geysir') } as const;

export function MapProperties() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const sel = useMapStore((s) => s.selection);
  const placed = Object.values(project.factories).filter((f) => f.map).length;
  return (
    <aside className="panel panel-right" data-tour="map-properties">
      {sel?.kind === 'node' && gd.mapNode(sel.id) ? (
        <NodeDetails node={gd.mapNode(sel.id)!} />
      ) : sel?.kind === 'factory' && project.factories[sel.id] ? (
        <FactoryDetails factoryId={sel.id} />
      ) : (
        <Section title={t('Karte')}>
          <p className="small-text">{t('{n} von {m} Fabriken auf der Karte.', { n: placed, m: Object.keys(project.factories).length })}</p>
          <p className="dim small-text">
            {t('Fabriken links mit „Platzieren“ auf die Karte setzen. Mit Standort zeigt der Fabrikgrundriss die Vorkommen darunter, Miner übernehmen Rohstoff und Reinheit, und Transportaufträge kennen die Entfernung.')}
          </p>
          <p className="dim small-text">{t('Schienennetze liegen direkt in Weltkoordinaten und erscheinen hier und im Schieneneditor über der Karte.')}</p>
        </Section>
      )}
    </aside>
  );
}

/** Vorkommen von der Karte aus belegen: Fabrik und Gebäude wählen. */
function OccupyForm({ node, types }: { node: MapNode; types: string[] }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const gd = useProjectStore((s) => s.gd)!;
  const active = useUiStore((s) => s.factoryId);
  const factories = Object.values(project.factories);
  // Vorschlag: nächstgelegene Fabrik auf der Karte, sonst die aktive
  const nearest = factories
    .filter((f) => f.map)
    .map((f) => ({ f, d: geo.dist(factoryWorldCenter(project, gd, f.id)!, node) }))
    .sort((a, b) => a.d - b.d)[0]?.f.id;
  const [factoryId, setFactoryId] = useState(nearest ?? active ?? factories[0]?.id ?? '');
  const [type, setType] = useState(types.at(-1)!);
  const fid = project.factories[factoryId] ? factoryId : (factories[0]?.id ?? '');
  const placed = !!project.factories[fid]?.map;
  return (
    <div className="site-detail" data-testid="node-occupy">
      <Row label={t('Fabrik')}>
        <select value={fid} onChange={(e) => setFactoryId(e.target.value)} data-testid="occupy-factory">
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Gebäude')}>
        <select value={type} onChange={(e) => setType(e.target.value)} data-testid="occupy-type">
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {gd.name(ty)}
            </option>
          ))}
        </select>
      </Row>
      <button data-testid="occupy-node" disabled={!fid} onClick={() => apply(t('Vorkommen belegen'), (d, g) => mops.occupyNode(d, g, node.id, fid, type))}>
        {t('Vorkommen belegen')}
      </button>
      <p className="dim small-text">
        {placed
          ? t('Liegt das Vorkommen höchstens 150 m außerhalb des Grundrisses, wird das Gebäude dort über dem Vorkommen aufgestellt, sonst nur geplant.')
          : t('Die Fabrik steht nicht auf der Karte: Das Gebäude wird nur geplant (nicht platziert).')}
      </p>
    </div>
  );
}

function NodeDetails({ node }: { node: MapNode }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const users = (nodeUsage(project).get(node.id) ?? []).map((id) => project.buildings[id]!).filter(Boolean);
  const types = nodeExtractorTypes(gd, node);
  const unit = node.itemId && gd.item(node.itemId)?.form === 'solid' ? '/min' : ' m³/min';
  const core = node.coreId ? gd.mapNode(node.coreId) : undefined;
  const satellites = node.kind === 'well-core' ? gd.map!.nodes.filter((n) => n.coreId === node.id) : [];
  const open = (factoryId: string, buildingId: string) => {
    const ui = useUiStore.getState();
    const b = project.buildings[buildingId];
    ui.setMode('factory');
    ui.setFactory(factoryId, b?.placement?.floorId ?? project.factories[factoryId]?.floorIds[0] ?? null);
    ui.select([{ table: 'buildings', id: buildingId }]);
    if (b?.placement) ui.focusOn(b.placement.x, b.placement.y);
  };
  return (
    <Section title={nodeTitle(gd, node.id)}>
      <Row label={t('Art')}>{t(KIND_LABEL[node.kind])}</Row>
      {node.purity && <Row label={t('Reinheit')}>{purityLabel(node.purity)}</Row>}
      <Row label={t('Lage')} hint={t('Weltkoordinaten in Metern (x Osten, y Süden, z Höhe)')}>
        <span data-testid="node-coords">
          {formatNumber(node.x, 0)} / {formatNumber(node.y, 0)} / {formatNumber(node.z, 0)} m
        </span>
      </Row>
      {node.obstructed && (
        <p className="dim small-text">
          <Badge kind="warn">{t('verdeckt')}</Badge> {t('Laut Quelle durch Gelände oder Objekte verdeckt.')}
        </p>
      )}
      <Row label={t('Belegt')} plain>
        {users.length === 0 ? (
          <Badge kind="ok">{t('frei')}</Badge>
        ) : (
          <span>
            {users.map((b) => (
              <span key={b.id}>
                <button className="link-button" onClick={() => open(b.factoryId, b.id)}>
                  {b.label || gd.name(b.type)} ({project.factories[b.factoryId]?.name})
                </button>
                <button className="small" data-testid="node-release" onClick={() => apply(t('Vorkommen freigeben'), (d, g) => mops.assignNode(d, g, b.id, null))} title={t('Verknüpfung lösen; das Gebäude bleibt in der Fabrik')}>
                  {t('Freigeben')}
                </button>
              </span>
            ))}
          </span>
        )}
      </Row>
      {users.length === 0 && types.length > 0 && <OccupyForm key={node.id} node={node} types={types} />}
      {types.length > 0 && (
        <table className="table compact" data-testid="node-rates">
          <thead>
            <tr>
              <th>{t('Gebäude')}</th>
              <th className="num">100 %</th>
              <th className="num">250 %</th>
            </tr>
          </thead>
          <tbody>
            {types.map((ty) => (
              <tr key={ty}>
                <td>{gd.name(ty)}</td>
                <td className="num">
                  {fmtNum(nodeRate(gd, node, ty, 1), 1)}
                  {unit}
                </td>
                <td className="num">
                  {fmtNum(nodeRate(gd, node, ty, 2.5), 1)}
                  {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {node.kind === 'well-core' && (
        <p className="dim small-text">
          {t('Hier steht der Quellenkompressor; die Lage ist aus {n} Satelliten gemittelt. Gefördert wird an den Satelliten.', { n: satellites.length })}
        </p>
      )}
      {node.kind === 'geyser' && <p className="dim small-text">{t('Geysire versorgen Geothermie-Generatoren; die Leistung wird im Planer nicht berechnet.')}</p>}
      {core && <p className="dim small-text">{t('Gehört zur Quelle mit {n} Satelliten.', { n: gd.map!.nodes.filter((n) => n.coreId === core.id).length })}</p>}
      <p className="dim small-text">{t('Zum Verknüpfen: im Fabrikgrundriss einen Miner auf das Vorkommen setzen oder in den Eigenschaften des Gebäudes das Vorkommen wählen.')}</p>
    </Section>
  );
}

function FactoryDetails({ factoryId }: { factoryId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const st = useMapStore();
  const f = project.factories[factoryId]!;
  const fp = factoryFootprint(project, gd, factoryId);
  const center = factoryWorldCenter(project, gd, factoryId);
  const others = useMemo(
    () =>
      Object.values(project.factories)
        .filter((o) => o.id !== factoryId && o.map)
        .map((o) => ({ f: o, d: center ? geo.dist(center, factoryWorldCenter(project, gd, o.id)!) : NaN }))
        .sort((a, b) => a.d - b.d),
    [project, gd, factoryId, center],
  );
  const near = useMemo(() => (center ? nodesNear(gd, center, { maxDistM: Math.max(300, geo.dist({ x: fp.rect.minX, y: fp.rect.minY }, { x: fp.rect.maxX, y: fp.rect.maxY })) }) : []), [gd, center, fp]);
  const usage = nodeUsage(project);
  const m = f.map;
  const set = (patch: Partial<NonNullable<typeof m>>) => m && apply(t('Fabrikstandort ändern'), (d) => mapOps.setFactoryMap(d, factoryId, { ...m, ...patch }));
  const open = () => {
    const ui = useUiStore.getState();
    ui.setMode('factory');
    ui.setFactory(factoryId, f.floorIds[0] ?? null);
  };
  return (
    <>
      <Section title={f.name}>
        {!m ? (
          <>
            <p className="small-text">{t('Die Fabrik ist noch nicht auf der Karte platziert.')}</p>
            <button onClick={() => st.setTool({ kind: 'place-factory', factoryId, rotationDeg: 0 })}>{t('Platzieren')}</button>
          </>
        ) : (
          <>
            <Row label={t('Ursprung x')} hint={t('Weltpunkt des Grundriss-Ursprungs (0/0 im Fabrikgrundriss)')}>
              <NumberField value={m.x} suffix="m" step={project.settings.gridM} onCommit={(x) => set({ x })} />
            </Row>
            <Row label={t('Ursprung y')}>
              <NumberField value={m.y} suffix="m" step={project.settings.gridM} onCommit={(y) => set({ y })} />
            </Row>
            <Row label={t('Drehung')} hint={t('Im Uhrzeigersinn; 0° = Norden des Grundrisses zeigt nach Norden')}>
              <NumberField value={m.rotationDeg} suffix="°" step={15} onCommit={(rotationDeg) => set({ rotationDeg })} />
            </Row>
            <Row label={t('Grundriss')}>
              {fmtNum(fp.rect.maxX - fp.rect.minX, 0)} × {fmtNum(fp.rect.maxY - fp.rect.minY, 0)} m{' '}
              {fp.source !== 'areas' && <Badge kind="warn">{fp.source === 'buildings' || fp.source === 'estimate' ? t('geschätzt') : t('Platzhalter')}</Badge>}
            </Row>
            <div className="button-row">
              <button onClick={open}>{t('Grundriss öffnen')}</button>
              <button className="danger" onClick={() => apply(t('Fabrik von der Karte nehmen'), (d) => mapOps.setFactoryMap(d, factoryId, null))}>
                {t('Von der Karte nehmen')}
              </button>
            </div>
          </>
        )}
      </Section>
      <DemandSection factoryId={factoryId} />
      {m && others.length > 0 && (
        <Section title={t('Entfernungen (Luftlinie)')}>
          <ul className="item-list">
            {others.map(({ f: o, d }) => (
              <li key={o.id}>
                <span>
                  <span className="swatch" style={{ background: o.color }} /> {o.name}
                </span>
                <span className="dim">{fmtNum(d, 0)} m</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {m && (
        <Section title={t('Vorkommen in der Nähe')}>
          <ul className="item-list">
            {near.slice(0, 12).map(({ node, distM }) => (
              <li
                key={node.id}
                onClick={() => st.select({ kind: 'node', id: node.id })}
                onMouseEnter={() => st.setHoverNode(node.id)}
                onMouseLeave={() => st.setHoverNode(null)}
              >
                <span>
                  {nodeTitle(gd, node.id)} {usage.has(node.id) && <Badge kind="muted">{t('belegt')}</Badge>}
                </span>
                <span className="dim">{fmtNum(distM, 0)} m</span>
              </li>
            ))}
            {near.length === 0 && <li className="dim">{t('Keine Vorkommen in der Nähe.')}</li>}
          </ul>
        </Section>
      )}
    </>
  );
}

/** Rohstoffbedarf der Fabrik gegen die belegten Vorkommen. */
function DemandSection({ factoryId }: { factoryId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const rows = useMemo(() => factoryNodeDemand(project, gd, factoryId), [project, gd, factoryId]);
  if (rows.length === 0) return null;
  const unit = (id: string) => (gd.item(id)?.form === 'solid' ? '/min' : ' m³/min');
  return (
    <Section title={t('Rohstoffbedarf und Vorkommen')}>
      <table className="table compact" data-testid="node-demand">
        <thead>
          <tr>
            <th>{t('Rohstoff')}</th>
            <th className="num" title={t('Bedarf laut Produktionsplänen der Fabrik (eigene Gewinnung, ohne Wasser und Importe)')}>
              {t('Bedarf')}
            </th>
            <th className="num" title={t('Förderung der Gewinnungsgebäude, die mit einem Vorkommen verknüpft sind')}>
              {t('Vorkommen')}
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ok = r.demand <= 1e-6 || r.linked + 1e-6 >= r.demand;
            return (
              <tr key={r.itemId}>
                <td>{gd.name(r.itemId)}</td>
                <td className="num">
                  {fmtNum(r.demand, 1)}
                  {unit(r.itemId)}
                </td>
                <td className="num" title={r.unlinked > 0 ? t('Dazu {n} aus Gebäuden ohne Vorkommen', { n: fmtNum(r.unlinked, 1) }) : undefined}>
                  {fmtNum(r.linked, 1)} ({r.nodes})
                </td>
                <td>{ok ? <Badge kind="ok">{t('gedeckt')}</Badge> : <Badge kind="warn">{t('fehlt {n}', { n: fmtNum(r.demand - r.linked, 1) })}</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dim small-text">{t('In Klammern: belegte Vorkommen. Vorkommen auf der Karte anklicken und „Vorkommen belegen“ wählen.')}</p>
    </Section>
  );
}
