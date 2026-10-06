import { useMemo } from 'react';
import {
  buildingHeight,
  cachedFactoryFlow,
  factoryOps as ops,
  geo,
  getLanguage,
  linkPath,
  localName,
  machineRates,
  pathLength,
  portDefs,
  type Building,
  type FloorKind,
  type GameDataIndex,
  type LinkRouting,
  type Purity,
} from '@satis/core';
import { N_, t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, ConfidenceBadge, fmtNum, fmtRate, NumberField, Row, Section, Segmented, TextField } from '../../ui/fields';
import { ROUTING_LABELS, ROUTING_ORDER } from './EditorToolbar';

const PURITY_LABEL: Record<Purity, string> = { impure: N_('unrein'), normal: N_('normal'), pure: N_('rein') };

export function PropertiesPanel() {
  const project = useProjectStore((s) => s.project)!;
  const selection = useUiStore((s) => s.selection);
  const factoryId = useUiStore((s) => s.factoryId);

  const buildings = selection.filter((s) => s.table === 'buildings').map((s) => project.buildings[s.id]).filter((b): b is Building => !!b);
  let body;
  if (selection.length === 0) body = factoryId ? <FactoryProps factoryId={factoryId} /> : null;
  else if (buildings.length === 1 && selection.length === 1) body = <BuildingProps building={buildings[0]!} />;
  else if (buildings.length > 1) body = <MultiBuildingProps buildings={buildings} />;
  else if (selection.length === 1 && selection[0]!.table === 'links') body = <LinkProps id={selection[0]!.id} />;
  else if (selection.length === 1 && selection[0]!.table === 'areas') body = <AreaProps id={selection[0]!.id} />;
  else if (selection.length === 1 && selection[0]!.table === 'measurements') body = <MeasurementProps id={selection[0]!.id} />;
  else body = <p className="dim pad">{t('{n} Objekte ausgewählt.', { n: selection.length })}</p>;
  return (
    <aside className="panel panel-right" data-tour="properties">
      {body}
    </aside>
  );
}

function FactoryProps({ factoryId }: { factoryId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const floorId = useUiStore((s) => s.floorId);
  const f = project.factories[factoryId];
  if (!f) return null;
  const fl = floorId ? project.floors[floorId] : undefined;
  const s = project.settings;
  return (
    <>
      <Section title={t('Fabrik')}>
        <Row label={t('Name')}>
          <TextField value={f.name} onCommit={(name) => apply(t('Fabrik umbenennen'), (d) => ops.updateFactory(d, factoryId, { name }))} />
        </Row>
        <Row label={t('Farbe')}>
          <input type="color" value={f.color} onChange={(e) => apply(t('Fabrikfarbe'), (d) => ops.updateFactory(d, factoryId, { color: e.target.value }))} />
        </Row>
        <Row label={t('Notizen')}>
          <TextField value={f.notes} onCommit={(notes) => apply(t('Notizen'), (d) => ops.updateFactory(d, factoryId, { notes }))} />
        </Row>
      </Section>
      {fl && (
        <Section
          title={t('Aktives Stockwerk')}
          actions={
            <button
              className="small danger"
              disabled={f.floorIds.length <= 1}
              onClick={() => apply(t('Stockwerk entfernen'), (d) => ops.removeFloor(d, fl.id))}
              title={t('Gebäude darauf bleiben als nicht platzierte Maschinen erhalten')}
            >
              {t('Entfernen')}
            </button>
          }
        >
          <Row label={t('Name')}>
            <TextField value={fl.name} onCommit={(name) => apply(t('Stockwerk umbenennen'), (d) => ops.updateFloor(d, fl.id, { name }))} />
          </Row>
          <Row label={t('Art')} hint={t('Physisches Stockwerk; Logistikebenen liegen z. B. unter einer Produktionsebene.')}>
            <select value={fl.kind} onChange={(e) => apply(t('Stockwerksart'), (d) => ops.updateFloor(d, fl.id, { kind: e.target.value as FloorKind }))}>
              <option value="production">{t('Produktion')}</option>
              <option value="logistics">{t('Logistik')}</option>
              <option value="other">{t('Sonstiges')}</option>
            </select>
          </Row>
          <Row label={t('Höhe (Boden)')}>
            <NumberField value={fl.elevationM} suffix="m" onCommit={(v) => apply(t('Stockwerkshöhe'), (d) => ops.updateFloor(d, fl.id, { elevationM: v }))} />
          </Row>
          <Row label={t('Lichte Höhe')}>
            <NumberField value={fl.heightM} min={0.5} suffix="m" onCommit={(v) => apply(t('Lichte Höhe'), (d) => ops.updateFloor(d, fl.id, { heightM: v }))} />
          </Row>
        </Section>
      )}
      <Section title={t('Raster und Fangen')}>
        <Row label={t('Raster')} hint={t('Hauptraster, Fundament = 8 m')}>
          <NumberField value={s.gridM} min={0.5} suffix="m" onCommit={(v) => apply(t('Raster'), (d) => void (d.settings.gridM = v))} />
        </Row>
        <Row label={t('Fangweite')} hint={t('0 = Fangen aus. Alt beim Ziehen fängt ebenfalls nicht.')}>
          <NumberField value={s.snapM} min={0} suffix="m" onCommit={(v) => apply(t('Fangweite'), (d) => void (d.settings.snapM = v))} />
        </Row>
        <Row label={t('Drehwinkel')}>
          <NumberField value={s.snapAngleDeg} min={1} max={180} suffix="°" onCommit={(v) => apply(t('Drehwinkel'), (d) => void (d.settings.snapAngleDeg = v))} />
        </Row>
        <p className="dim small-text">{t('Auf Fundamentflächen richtet sich das Raster nach der Ecke des Fundaments, damit Gebäude auf den Fundamentkacheln stehen.')}</p>
      </Section>
      <FlowSummary factoryId={factoryId} />
      <p className="dim pad small-text">{t('Objekt im Grundriss anklicken, um seine Eigenschaften zu bearbeiten.')}</p>
    </>
  );
}

function FlowSummary({ factoryId }: { factoryId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const flow = useMemo(() => cachedFactoryFlow(project, gd, factoryId), [project, gd, factoryId]);
  const machines = [...flow.machines.values()];
  if (!machines.length) return null;
  const full = machines.filter((m) => m.utilization > 0.999).length;
  const over = [...flow.links.values()].filter((l) => l.required > l.capacity + 1e-6).length;
  return (
    <Section title={t('Durchsatz (eingezeichnet)')}>
      <Row label={t('Voll ausgelastet')}>
        {full} / {machines.length}
      </Row>
      <Row label={t('Überlastete Leitungen')}>{over ? <Badge kind="warn">{over}</Badge> : '0'}</Row>
      <details className="assumptions">
        <summary>{t('Annahmen des Durchsatzmodells')}</summary>
        <ul>
          {flow.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

function recipeOptions(gd: GameDataIndex, type: string) {
  return Object.values(gd.data.recipes)
    .filter((r) => r.producedIn.includes(type))
    .sort((a, b) => Number(a.alternate) - Number(b.alternate) || localName(a.name).localeCompare(localName(b.name), getLanguage()));
}

function BuildingProps({ building: b }: { building: Building }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const def = gd.building(b.type);
  const recipes = useMemo(() => recipeOptions(gd, b.type), [gd, b.type]);
  const resources = useMemo(() => ops.extractableResources(gd, b.type), [gd, b.type]);
  const rates = machineRates(gd, b);
  const factory = project.factories[b.factoryId]!;
  const flow = useMemo(() => cachedFactoryFlow(project, gd, b.factoryId), [project, gd, b.factoryId]);
  const fm = flow.machines.get(b.id);
  const upd = (label: string, patch: ops.BuildingPatch) => apply(label, (d, g) => ops.updateBuildings(d, g, [b.id], patch));
  if (!def) return <Section title={t('Unbekanntes Gebäude')}>{b.type}</Section>;
  const bb = def.bounds;
  const links = Object.values(project.links).filter((l) => l.from.buildingId === b.id || l.to.buildingId === b.id);
  const maxClock = (gd.fact('production.clock.maxWithShards') ?? 2.5) * 100;
  const stations = Object.values(project.stations);

  return (
    <>
      <Section title={localName(def.name)}>
        <Row label={t('Bezeichnung')}>
          <TextField value={b.label} placeholder={localName(def.name)} onCommit={(label) => upd(t('Bezeichnung'), { label })} />
        </Row>
        {bb && (
          <Row label={t('Maße (B × T × H)')}>
            {fmtNum(bb.maxX - bb.minX)} × {fmtNum(bb.maxY - bb.minY)} × {fmtNum(buildingHeight(def))} m{' '}
            {def.boundsSource && <ConfidenceBadge confidence={def.boundsSource.confidence} detail={def.boundsSource.detail} />}
          </Row>
        )}
        {recipes.length > 0 && (
          <Row label={t('Rezept')}>
            <select value={b.recipeId ?? ''} onChange={(e) => upd(t('Rezept'), { recipeId: e.target.value || null })}>
              <option value="">{t('– kein Rezept –')}</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {localName(r.name)}
                </option>
              ))}
            </select>
          </Row>
        )}
        {def.extractor && (
          <>
            <Row label={t('Rohstoff')}>
              <select
                data-testid="extraction-item"
                value={b.extraction?.itemId ?? ''}
                onChange={(e) => upd(t('Rohstoff'), { extraction: e.target.value ? { itemId: e.target.value, purity: b.extraction?.purity ?? 'normal' } : null })}
              >
                <option value="">{t('– nicht festgelegt –')}</option>
                {resources.map((id) => (
                  <option key={id} value={id}>
                    {gd.name(id)}
                  </option>
                ))}
              </select>
            </Row>
            {def.nativeClass !== 'FGBuildableWaterPump' && (
              <Row label={t('Reinheit')} hint={t('unrein ×0,5 · normal ×1 · rein ×2 (Wiki „Resource node“)')}>
                <select
                  value={b.extraction?.purity ?? 'normal'}
                  disabled={!b.extraction}
                  onChange={(e) => b.extraction && upd(t('Reinheit'), { extraction: { ...b.extraction, purity: e.target.value as Purity } })}
                >
                  {(Object.keys(PURITY_LABEL) as Purity[]).map((p) => (
                    <option key={p} value={p}>
                      {t(PURITY_LABEL[p])}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </>
        )}
        {def.freightPlatform && (
          <>
            <Row label={t('Umschlag')}>
              <select value={b.transfer?.mode ?? 'unload'} onChange={(e) => upd(t('Umschlag'), { transfer: { mode: e.target.value as 'load' | 'unload', stationId: b.transfer?.stationId ?? null } })}>
                <option value="unload">{t('Entladen (Einfuhr in die Fabrik)')}</option>
                <option value="load">{t('Beladen (Ausfuhr aus der Fabrik)')}</option>
              </select>
            </Row>
            <Row label={t('Bahnhof')} hint={t('Zuordnung zu einem Bahnhof im Schienennetz; Einfuhren eines Transportauftrags verteilen sich auf die Plattformen dieses Bahnhofs.')}>
              <select value={b.transfer?.stationId ?? ''} onChange={(e) => upd(t('Bahnhof'), { transfer: { mode: b.transfer?.mode ?? 'unload', stationId: e.target.value || null } })}>
                <option value="">{t('– beliebig –')}</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}
        {def.clock && (
          <Row label={t('Takt')} hint={t('1 % bis 250 % (über 100 % benötigt Energiesplitter)')}>
            <NumberField value={b.clock * 100} min={def.clock.min * 100} max={maxClock} step={5} suffix="%" digits={4} onCommit={(v) => upd(t('Takt'), { clock: v / 100 })} />
          </Row>
        )}
        {(def.somersloopSlots ?? 0) > 0 && (
          <Row label={t('Somersloops')}>
            <NumberField value={b.somersloops} min={0} max={def.somersloopSlots} step={1} digits={0} suffix={`/ ${def.somersloopSlots}`} onCommit={(v) => upd(t('Somersloops'), { somersloops: Math.round(v) })} />
          </Row>
        )}
        <Row label={t('Notizen')}>
          <TextField value={b.notes} onCommit={(notes) => upd(t('Notizen'), { notes })} />
        </Row>
      </Section>

      {(rates.inputs.length > 0 || rates.outputs.length > 0 || rates.powerMW > 0) && (
        <Section title={t('Durchsatz (rechnerisch)')}>
          {rates.inputs.map((r) => {
            const got = fm?.inputs.find((x) => x.itemId === r.item);
            return (
              <Row key={`i${r.item}`} label={`← ${gd.name(r.item)}`}>
                {fmtRate(r.perMin)}
                {got && got.received + 1e-6 < r.perMin && (
                  <span className="neg">
                    {' '}
                    ({t('erhält {n}', { n: fmtNum(got.received, 2) })})
                  </span>
                )}
              </Row>
            );
          })}
          {rates.outputs.map((r) => (
            <Row key={`o${r.item}`} label={`→ ${gd.name(r.item)}`}>
              {fmtRate(r.perMin)}
            </Row>
          ))}
          <Row label={t('Leistung')}>
            {fmtNum(rates.powerMW)} MW
            {rates.powerRangeMW && (
              <span className="dim">
                {' '}
                ({fmtNum(rates.powerRangeMW[0])}–{fmtNum(rates.powerRangeMW[1])} MW, {t('Mittelwert angenommen')})
              </span>
            )}
          </Row>
          {fm && (
            <Row label={t('Auslastung')} hint={t('Laut Durchsatzmodell der eingezeichneten Verbindungen')}>
              <span className={fm.utilization < 0.999 ? 'neg' : 'pos'}>{fmtNum(fm.utilization * 100, 1)} %</span>
              {fm.utilizationUncapped > fm.utilization + 1e-4 && <span className="dim"> ({t('ohne Kapazitätsgrenzen {n} %', { n: fmtNum(fm.utilizationUncapped * 100, 1) })})</span>}
            </Row>
          )}
        </Section>
      )}

      <Section title={t('Aufstellung')}>
        {b.placement ? (
          <>
            <Row label={t('Stockwerk')}>
              <select value={b.placement.floorId} onChange={(e) => apply(t('Stockwerk wechseln'), (d) => ops.placeBuilding(d, b.id, { ...b.placement!, floorId: e.target.value }))}>
                {factory.floorIds.map((id) => (
                  <option key={id} value={id}>
                    {project.floors[id]!.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="X">
              <NumberField value={b.placement.x} suffix="m" onCommit={(v) => apply(t('Position'), (d) => ops.moveBuildings(d, [b.id], v - b.placement!.x, 0))} />
            </Row>
            <Row label="Y">
              <NumberField value={b.placement.y} suffix="m" onCommit={(v) => apply(t('Position'), (d) => ops.moveBuildings(d, [b.id], 0, v - b.placement!.y))} />
            </Row>
            <Row label={t('Höhe über Boden')}>
              <NumberField value={b.placement.zOffsetM} suffix="m" onCommit={(v) => apply(t('Höhe'), (d) => ops.moveBuildings(d, [b.id], 0, 0, v - b.placement!.zOffsetM))} />
            </Row>
            <Row label={t('Drehung')}>
              <NumberField value={b.placement.rotationDeg} suffix="°" step={90} onCommit={(v) => apply(t('Drehen'), (d) => ops.rotateBuildings(d, [b.id], geo.normalizeDeg(v) - b.placement!.rotationDeg))} />
            </Row>
            <div className="button-row">
              <button onClick={() => apply(t('Aufstellung aufheben'), (d) => ops.unplaceBuildings(d, [b.id]))}>{t('Aufstellung aufheben')}</button>
            </div>
          </>
        ) : (
          <>
            <p className="dim">{t('Geplant, aber noch nicht im Grundriss aufgestellt.')}</p>
            <div className="button-row">
              <button onClick={() => useUiStore.getState().setTool({ kind: 'place', type: b.type, buildingId: b.id, recipeId: b.recipeId, rotationDeg: 0 })}>{t('Im Grundriss absetzen')}</button>
            </div>
          </>
        )}
      </Section>

      {b.groupInstance && <GroupInstanceSection building={b} />}
      <PortsSection building={b} />

      <div className="button-row pad">
        <button
          className="danger"
          onClick={() => {
            apply(t('Löschen'), (d) => ops.removeBuildings(d, [b.id]));
            useUiStore.getState().select([]);
          }}
        >
          {t('Gebäude löschen')}
          {links.length ? ` (+${links.length} ${t('Verbindungen')})` : ''}
        </button>
      </div>
    </>
  );
}

/** Bearbeiten einer Gruppeninstanz: Vorlage übernehmen, andere Instanzen angleichen, lösen. */
function GroupInstanceSection({ building: b }: { building: Building }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const gi = b.groupInstance!;
  const g = project.groups[gi.groupId];
  if (!g) return null;
  const members = Object.values(project.buildings).filter((x) => x.groupInstance?.instanceId === gi.instanceId);
  const others = new Set(Object.values(project.buildings).filter((x) => x.groupInstance?.groupId === g.id && x.groupInstance.instanceId !== gi.instanceId).map((x) => x.groupInstance!.instanceId)).size;
  return (
    <Section title={t('Gebäudegruppe')}>
      <Row label={t('Vorlage')}>
        <TextField value={g.name} onCommit={(name) => apply(t('Gruppe umbenennen'), (d) => ops.renameGroup(d, g.id, name))} />
      </Row>
      <Row label={t('Instanz')}>{t('{n} Gebäude · {m} weitere Instanzen', { n: members.length, m: others })}</Row>
      <div className="button-row">
        <button onClick={() => useUiStore.getState().select(members.map((m) => ({ table: 'buildings', id: m.id })))}>{t('Instanz auswählen')}</button>
        <button
          title={t('Aktuellen Stand dieser Instanz (Lage, Rezepte, Takte, Verbindungen) als Vorlage speichern')}
          onClick={() => apply(t('Vorlage aktualisieren'), (d) => ops.updateGroupFromInstance(d, g.id, gi.instanceId))}
        >
          {t('Als Vorlage übernehmen')}
        </button>
        <button
          disabled={others === 0}
          title={t('Alle anderen Instanzen nach der Vorlage neu aufbauen (gleiche Lage und Drehung)')}
          onClick={() => {
            const r = useProjectStore.getState().apply(t('Instanzen angleichen'), (d, gdx) => ops.syncGroupInstances(d, gdx, g.id, gi.instanceId));
            if (r) useUiStore.getState().toast(t('{n} Instanz(en) angeglichen; {m} Verbindung(en) nach außen entfernt.', { n: r.instances, m: r.lostLinks }));
          }}
        >
          {t('Andere Instanzen angleichen')}
        </button>
        <button onClick={() => apply(t('Instanz lösen'), (d) => ops.detachInstance(d, gi.instanceId))}>{t('Von Vorlage lösen')}</button>
      </div>
    </Section>
  );
}

function PortsSection({ building: b }: { building: Building }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const def = gd.building(b.type);
  if (!def?.ports) return null;
  const ports = portDefs(def);
  if (ports.length === 0) return null;
  const label = (id: string) => {
    const [kind, dir, idx] = id.split('-');
    const k = kind === 'belt' ? t('Band') : t('Rohr');
    const d = dir === 'in' ? t('Eingang') : dir === 'out' ? t('Ausgang') : t('Anschluss');
    return `${k} ${d} ${Number(idx) + 1}`;
  };
  return (
    <Section title={t('Anschlüsse')}>
      <p className="small-text">
        {t('Anzahl')}: {def.portsSource && <ConfidenceBadge confidence={def.portsSource.confidence} detail={def.portsSource.detail} />} · {t('Lage')}:{' '}
        <Badge kind="warn" title={t('Die Docs enthalten keine Anschlusspositionen. Eingänge sind schematisch hinten, Ausgänge vorn dargestellt.')}>
          {t('schematisch')}
        </Badge>
      </p>
      {ports.map((p) => {
        const link = Object.values(project.links).find((l) => (l.from.buildingId === b.id && l.from.portId === p.id) || (l.to.buildingId === b.id && l.to.portId === p.id));
        const other = link && project.buildings[link.from.buildingId === b.id ? link.to.buildingId : link.from.buildingId];
        return (
          <Row key={p.id} label={label(p.id)}>
            {link ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  useUiStore.getState().select([{ table: 'links', id: link.id }]);
                }}
              >
                {gd.name(link.tier)} → {other ? other.label || gd.name(other.type) : '?'}
              </a>
            ) : (
              <span className="dim">{t('frei')}</span>
            )}
          </Row>
        );
      })}
    </Section>
  );
}

function MultiBuildingProps({ buildings }: { buildings: Building[] }) {
  const apply = useProjectStore((s) => s.apply);
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const ids = buildings.map((b) => b.id);
  const types = new Set(buildings.map((b) => b.type));
  const sameType = types.size === 1;
  const recipes = sameType ? recipeOptions(gd, buildings[0]!.type) : [];
  const first = buildings[0]!;
  const sameRecipe = buildings.every((b) => b.recipeId === first.recipeId);
  const sameClock = buildings.every((b) => b.clock === first.clock);
  const totals = new Map<string, number>();
  let power = 0;
  for (const b of buildings) {
    const r = machineRates(gd, b);
    power += r.powerMW;
    for (const x of r.outputs) totals.set(x.item, (totals.get(x.item) ?? 0) + x.perMin);
    for (const x of r.inputs) totals.set(x.item, (totals.get(x.item) ?? 0) - x.perMin);
  }
  // Eine gemeinsame Instanz, zu der nicht alle gehören → Aufnahme anbieten
  const instance = buildings.find((b) => b.groupInstance)?.groupInstance ?? null;
  const notInInstance = instance ? buildings.filter((b) => b.groupInstance?.instanceId !== instance.instanceId) : [];
  return (
    <Section title={t('{n} Gebäude ausgewählt', { n: buildings.length })}>
      {sameType && recipes.length > 0 && (
        <Row label={t('Rezept (alle)')}>
          <select value={sameRecipe ? (first.recipeId ?? '') : '__mixed'} onChange={(e) => apply(t('Rezept'), (d, g) => ops.updateBuildings(d, g, ids, { recipeId: e.target.value || null }))}>
            {!sameRecipe && <option value="__mixed">{t('– gemischt –')}</option>}
            <option value="">{t('– kein Rezept –')}</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {localName(r.name)}
              </option>
            ))}
          </select>
        </Row>
      )}
      {buildings.every((b) => gd.building(b.type)?.clock) && (
        <Row label={t('Takt (alle)')}>
          <NumberField value={sameClock ? first.clock * 100 : NaN} min={1} max={250} suffix="%" onCommit={(v) => apply(t('Takt'), (d, g) => ops.updateBuildings(d, g, ids, { clock: v / 100 }))} />
        </Row>
      )}
      <Row label={t('Leistung gesamt')}>{fmtNum(power)} MW</Row>
      {[...totals.entries()].map(([item, v]) => (
        <Row key={item} label={gd.name(item)}>
          <span className={v < 0 ? 'neg' : 'pos'}>
            {v > 0 ? '+' : ''}
            {fmtRate(v)}
          </span>
        </Row>
      ))}
      <div className="button-row">
        <button onClick={() => apply(t('Drehen'), (d) => ops.rotateBuildings(d, ids, 90))}>{t('Drehen 90°')}</button>
        <button
          onClick={() => {
            const name = window.prompt(t('Name der Gebäudegruppe'), t('Neue Gruppe'));
            if (name) apply(t('Gruppe erstellen'), (d) => ops.createGroupFromBuildings(d, ids, name));
          }}
        >
          {t('Als Gruppe speichern')}
        </button>
        {instance && notInInstance.length > 0 && (
          <button
            title={t('Danach „Als Vorlage übernehmen“ an einem Gebäude der Instanz wählen')}
            onClick={() => apply(t('In Instanz aufnehmen'), (d) => ops.addToInstance(d, notInInstance.map((b) => b.id), instance.groupId, instance.instanceId))}
          >
            {t('In Gruppe „{name}“ aufnehmen', { name: project.groups[instance.groupId]?.name ?? '?' })}
          </button>
        )}
        <button onClick={() => apply(t('Aufstellung aufheben'), (d) => ops.unplaceBuildings(d, ids))}>{t('Aufstellung aufheben')}</button>
        <button
          className="danger"
          onClick={() => {
            apply(t('Löschen'), (d) => ops.removeBuildings(d, ids));
            useUiStore.getState().select([]);
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}

function LinkProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const l = project.links[id];
  const flow = useMemo(() => (l ? cachedFactoryFlow(project, gd, l.factoryId) : null), [project, gd, l]);
  if (!l) return null;
  const tiers = l.kind === 'belt' ? gd.beltTiers : gd.pipeTiers;
  const tier = gd.building(l.tier);
  const unit = l.kind === 'belt' ? '/min' : 'm³/min';
  const cap = tier?.conveyor ? `${fmtNum(tier.conveyor.itemsPerMin)} ${unit}` : tier?.pipe ? `${fmtNum(tier.pipe.m3PerMin)} ${unit}` : '?';
  const a = project.buildings[l.from.buildingId];
  const b = project.buildings[l.to.buildingId];
  const path = linkPath(project, gd, l);
  const len = path ? pathLength(path) : null;
  const fr = flow?.links.get(id);
  const anyPorts = l.from.portId.includes('-any-') && l.to.portId.includes('-any-');
  return (
    <Section title={l.kind === 'belt' ? t('Förderband') : t('Rohrleitung')}>
      <Row label={t('Stufe')}>
        <select value={l.tier} onChange={(e) => apply(t('Stufe ändern'), (d, g) => ops.updateLink(d, g, id, { tier: e.target.value }))}>
          {tiers.map((x) => (
            <option key={x.id} value={x.id}>
              {localName(x.name)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Verlegemodus')} plain>
        <Segmented<LinkRouting> value={l.routing} onChange={(routing) => apply(t('Verlegemodus'), (d, g) => ops.updateLink(d, g, id, { routing }))} options={ROUTING_ORDER.map((r) => ({ value: r, label: t(ROUTING_LABELS[r]) }))} />
      </Row>
      <Row label={t('Kapazität')}>
        {cap} <ConfidenceBadge confidence="derived" detail={l.kind === 'belt' ? 'Docs mSpeed / 2' : 'Docs mFlowLimit × 60'} />
      </Row>
      {fr && (
        <>
          <Row label={t('Durchsatz eingezeichnet')} hint={t('Fluss mit den gezeichneten Stufen laut Durchsatzmodell')}>
            {fmtNum(fr.total, 2)} {unit}
            {fr.items.length > 0 && <span className="dim small-text"> ({fr.items.map((x) => `${gd.name(x.itemId)} ${fmtNum(x.perMin, 2)}`).join(', ')})</span>}
          </Row>
          <Row label={t('Theoretisch benötigt')} hint={t('Fluss ohne Kapazitätsgrenzen: so viel müsste die Leitung tragen')}>
            <span className={fr.required > fr.capacity + 1e-6 ? 'neg' : ''}>
              {fmtNum(fr.required, 2)} {unit}
            </span>
          </Row>
          {fr.rejectedItems.length > 0 && (
            <Row label={t('Nicht angenommen')}>
              <span className="neg">{fr.rejectedItems.map((x) => gd.name(x)).join(', ')}</span>
            </Row>
          )}
        </>
      )}
      <Row label={t('Von')}>{a ? a.label || gd.name(a.type) : '?'}</Row>
      <Row label={t('Nach')}>{b ? b.label || gd.name(b.type) : '?'}</Row>
      {len && (
        <Row label={t('Länge')}>
          {fmtNum(len.total, 1)} m{len.vertical ? `, ${t('davon senkrecht {n} m', { n: fmtNum(len.vertical, 1) })}` : ''}
        </Row>
      )}
      <Row label={t('Zwischenpunkte')}>{l.waypoints.length}</Row>
      <p className="small-text">
        <Badge kind="warn">{t('nicht geprüft')}</Badge> {t('Kurvenradien, Mindestlängen, Kollisionen und Förderhöhe werden nicht geprüft.')}
      </p>
      <div className="button-row">
        {l.waypoints.length > 0 && <button onClick={() => apply(t('Zwischenpunkte entfernen'), (d, g) => ops.updateLink(d, g, id, { waypoints: [] }))}>{t('Zwischenpunkte entfernen')}</button>}
        {anyPorts && <button onClick={() => apply(t('Richtung umkehren'), (d, g) => ops.reverseLink(d, g, id))}>{t('Richtung umkehren')}</button>}
        <button
          className="danger"
          onClick={() => {
            apply(t('Verbindung löschen'), (d) => ops.removeLinks(d, [id]));
            useUiStore.getState().select([]);
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}

const FOUNDATIONS = ['Build_Foundation_8x1_01_C', 'Build_Foundation_8x2_01_C', 'Build_Foundation_8x4_01_C'];

function AreaProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const a = project.areas[id];
  if (!a) return null;
  const area = geo.polygonArea(a.polygon);
  const r = geo.rectOf(a.polygon);
  const fnd = a.foundationType ? gd.building(a.foundationType)?.foundation : undefined;
  return (
    <Section title={t('Fläche')}>
      <Row label={t('Name')}>
        <TextField value={a.name} onCommit={(name) => apply(t('Fläche umbenennen'), (d) => ops.updateArea(d, id, { name }))} />
      </Row>
      <Row label={t('Art')}>
        <select value={a.kind} onChange={(e) => apply(t('Flächenart'), (d) => ops.updateArea(d, id, { kind: e.target.value as typeof a.kind }))}>
          <option value="build-area">{t('Baufläche')}</option>
          <option value="foundation">{t('Fundament')}</option>
          <option value="clearance">{t('Planungsabstand (Lauf-/Wartungsweg)')}</option>
        </select>
      </Row>
      {a.kind === 'foundation' && (
        <Row label={t('Fundamenttyp')}>
          <select value={a.foundationType ?? ''} onChange={(e) => apply(t('Fundamenttyp'), (d) => ops.updateArea(d, id, { foundationType: e.target.value }))}>
            {FOUNDATIONS.filter((f) => gd.building(f)).map((f) => (
              <option key={f} value={f}>
                {gd.name(f)}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label={t('Fläche')}>{fmtNum(area, 1)} m²</Row>
      <Row label={t('Ausdehnung')}>
        {fmtNum(r.maxX - r.minX, 1)} × {fmtNum(r.maxY - r.minY, 1)} m
      </Row>
      {a.kind === 'foundation' && fnd && (
        <Row label={t('Fundamente (ca.)')} hint={t('Fläche geteilt durch Kachelgröße – bei schrägen Kanten nur Näherung')}>
          {fmtNum(Math.ceil(area / (fnd.widthM * fnd.depthM)), 0)} × {fnd.widthM} × {fnd.depthM} m
        </Row>
      )}
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            apply(t('Fläche löschen'), (d) => ops.removeArea(d, id));
            useUiStore.getState().select([]);
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}

function MeasurementProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const m = project.measurements[id];
  if (!m) return null;
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  return (
    <Section title={t('Maß')}>
      <Row label={t('Länge')}>{fmtNum(Math.hypot(dx, dy), 2)} m</Row>
      <Row label="Δx / Δy">
        {fmtNum(Math.abs(dx), 2)} / {fmtNum(Math.abs(dy), 2)} m
      </Row>
      <Row label={t('Beschriftung')}>
        <TextField value={m.label} onCommit={(label) => apply(t('Maß beschriften'), (d) => void (d.measurements[id]!.label = label))} />
      </Row>
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            apply(t('Maß löschen'), (d) => ops.removeMeasurements(d, [id]));
            useUiStore.getState().select([]);
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}
