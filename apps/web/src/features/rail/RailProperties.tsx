import { useMemo, useState } from 'react';
import {
  analyzeNetwork,
  buildGraph,
  estimateTrainCycle,
  findRoute,
  geo,
  getLanguage,
  isBidirectional,
  localName,
  railOps as ops,
  segmentLength,
  segmentMinRadius,
  segmentShape,
  trainLengthM,
  trainTraction,
  wagonPlatformIssues,
  type Platform,
  type TimetableStop,
  type Vehicle,
} from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useSimStore } from '../../state/simStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section, TextField } from '../../ui/fields';
import { ItemPicker } from '../../ui/ItemPicker';

export function RailProperties() {
  const selection = useUiStore((s) => s.selection);
  const networkId = useUiStore((s) => s.networkId);
  const sel = selection[0];
  let body = null;
  if (!sel) body = networkId ? <NetworkProps id={networkId} /> : null;
  else if (selection.length > 1) body = <MultiProps />;
  else if (sel.table === 'railSegments') body = <SegmentProps id={sel.id} />;
  else if (sel.table === 'railNodes') body = <NodeProps id={sel.id} />;
  else if (sel.table === 'railSignals') body = <SignalProps id={sel.id} />;
  else if (sel.table === 'stations') body = <StationProps id={sel.id} />;
  else if (sel.table === 'trains') body = <TrainProps id={sel.id} />;
  else if (sel.table === 'timetables') body = <TimetableProps id={sel.id} />;
  else if (sel.table === 'measurements') body = <MeasureProps id={sel.id} />;
  return (
    <aside className="panel panel-right" data-tour="properties">
      {body}
    </aside>
  );
}

const clearSel = () => useUiStore.getState().select([]);

function NetworkProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const n = project.railNetworks[id];
  const stats = useMemo(() => {
    const a = analyzeNetwork(project, id);
    let len = 0;
    for (const l of a.graph.lengths.values()) len += l;
    return { segments: a.graph.segments.size, len, blocks: a.blocks.blocks.size, signals: [...a.graph.signals.values()].flat().length, stations: a.graph.stations.length, trains: a.graph.trains.length };
  }, [project, id]);
  const [mergeWith, setMergeWith] = useState('');
  if (!n) return null;
  const others = Object.values(project.railNetworks).filter((x) => x.id !== id);
  return (
    <Section title={t('Schienennetz')}>
      <Row label={t('Name')}>
        <TextField value={n.name} onCommit={(name) => apply(t('Netz umbenennen'), (d) => ops.updateNetwork(d, id, { name }))} />
      </Row>
      <Row label={t('Farbe')}>
        <input type="color" value={n.color} onChange={(e) => apply(t('Netzfarbe'), (d) => ops.updateNetwork(d, id, { color: e.target.value }))} />
      </Row>
      <Row label={t('Notizen')}>
        <TextField value={n.notes} onCommit={(notes) => apply(t('Notizen'), (d) => ops.updateNetwork(d, id, { notes }))} />
      </Row>
      <Row label={t('Gleise')}>{t('{n} Segmente · {km} km', { n: stats.segments, km: fmtNum(stats.len / 1000, 2) })}</Row>
      <Row label={t('Blöcke')}>{stats.blocks}</Row>
      <Row label={t('Signale')}>{stats.signals}</Row>
      <Row label={t('Bahnhöfe / Züge')}>
        {stats.stations} / {stats.trains}
      </Row>
      {others.length > 0 && (
        <Row label={t('Zusammenführen')} hint={t('Alle Objekte des gewählten Netzes werden in dieses Netz übernommen.')}>
          <span className="inline">
            <select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)}>
              <option value="">{t('– Netz wählen –')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button disabled={!mergeWith} onClick={() => apply(t('Netze zusammenführen'), (d) => ops.mergeNetworks(d, id, mergeWith))}>
              OK
            </button>
          </span>
        </Row>
      )}
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(t('Netz „{name}“ mit allen Gleisen, Bahnhöfen und Zügen löschen? (Rückgängig möglich)', { name: n.name }))) {
              apply(t('Netz löschen'), (d) => ops.removeNetwork(d, id));
              useUiStore.getState().setNetwork(Object.keys(useProjectStore.getState().project!.railNetworks)[0] ?? null);
            }
          }}
        >
          {t('Netz löschen')}
        </button>
      </div>
      <p className="dim small-text">{t('Gleis anklicken, um Eigenschaften zu bearbeiten. Farben der Gleise = Blöcke (Darstellung links umschaltbar).')}</p>
    </Section>
  );
}

function MultiProps() {
  const selection = useUiStore((s) => s.selection);
  const apply = useProjectStore((s) => s.apply);
  const [offset, setOffset] = useState(12);
  const segs = selection.filter((s) => s.table === 'railSegments').map((s) => s.id);
  return (
    <Section title={t('{n} Objekte ausgewählt', { n: selection.length })}>
      {segs.length > 0 && (
        <>
          <Row label={t('Parallelabstand')} hint={t('Positiv = rechts der Knotenachse, negativ = links')}>
            <NumberField value={offset} suffix="m" onCommit={setOffset} />
          </Row>
          <div className="button-row">
            <button
              onClick={() => {
                const ids = apply(t('Parallelgleis erzeugen'), (d) => ops.parallelTrack(d, segs, offset));
                if (ids) useUiStore.getState().select(ids.map((id) => ({ table: 'railSegments', id })));
              }}
            >
              {t('Parallelgleis erzeugen')}
            </button>
          </div>
        </>
      )}
      <p className="dim small-text">{t('Entf löscht die Auswahl.')}</p>
    </Section>
  );
}

function SegmentProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const [offset, setOffset] = useState(12);
  const s = project.railSegments[id];
  const info = useMemo(() => {
    if (!s) return null;
    const shape = segmentShape(project, s);
    const a = analyzeNetwork(project, s.networkId);
    const block = a.blocks.blocks.get(a.blocks.blockOf.get(id)!);
    return shape ? { len: segmentLength(shape), r: segmentMinRadius(shape), z0: shape.z0, z1: shape.z1, block } : null;
  }, [project, s, id]);
  if (!s || !info) return null;
  const station = s.stationId ? project.stations[s.stationId] : undefined;
  return (
    <Section title={station ? t('Bahnhofsgleis „{name}“', { name: station.name }) : t('Gleissegment')}>
      <Row label={t('Länge')}>{fmtNum(info.len, 1)} m</Row>
      <Row label={t('Kleinster Radius')}>{Number.isFinite(info.r) ? `${fmtNum(info.r, 1)} m` : t('gerade')}</Row>
      <Row label={t('Höhe')}>
        {fmtNum(info.z0, 1)} → {fmtNum(info.z1, 1)} m
        {info.len > 0 && info.z0 !== info.z1 ? ` (${t('Steigung 1:{n}', { n: fmtNum(info.len / Math.abs(info.z1 - info.z0), 1) })})` : ''}
      </Row>
      {info.block && (
        <Row label={t('Block')}>
          {t('{len} m · {a} Ein-/{b} Ausfahrsignale', { len: fmtNum(info.block.lengthM, 0), a: info.block.entrySignals.length, b: info.block.exitSignals.length })}
          {info.block.isPath && <Badge kind="info">{t('Pfadblock')}</Badge>}
        </Row>
      )}
      {!station && (
        <>
          <Row label={t('Geplante Richtung')} hint={t('Planungsangabe; die Spielmechanik wird über Signale festgelegt')}>
            <select value={s.intendedDirection} onChange={(e) => apply(t('Richtung'), (d) => ops.updateSegment(d, id, { intendedDirection: e.target.value as typeof s.intendedDirection }))}>
              <option value="both">{t('beide')}</option>
              <option value="a-to-b">A → B</option>
              <option value="b-to-a">B → A</option>
            </select>
          </Row>
          <Row label={t('Bogenform')} hint={t('Länge der Kontrollarme; leer = automatisch (Kreisbogen)')}>
            <span className="inline">
              <NumberField value={s.handleA ?? NaN} suffix="m" onCommit={(v) => apply(t('Bogenform'), (d) => ops.updateSegment(d, id, { handleA: v }))} />
              <NumberField value={s.handleB ?? NaN} suffix="m" onCommit={(v) => apply(t('Bogenform'), (d) => ops.updateSegment(d, id, { handleB: v }))} />
            </span>
          </Row>
          <div className="button-row">
            {(s.handleA !== null || s.handleB !== null) && (
              <button onClick={() => apply(t('Bogenform zurücksetzen'), (d) => ops.updateSegment(d, id, { handleA: null, handleB: null }))}>{t('Bogen automatisch')}</button>
            )}
            <button
              onClick={() => {
                const n = apply(t('Gleis teilen'), (d) => ops.splitSegment(d, id, 0.5));
                if (n) useUiStore.getState().select([{ table: 'railNodes', id: n }]);
              }}
            >
              {t('In der Mitte teilen')}
            </button>
          </div>
          <Row label={t('Parallelabstand')}>
            <NumberField value={offset} suffix="m" onCommit={setOffset} />
          </Row>
          <div className="button-row">
            <button onClick={() => apply(t('Parallelgleis'), (d) => ops.parallelTrack(d, [id], offset))}>{t('Parallelgleis erzeugen')}</button>
            <button
              className="danger"
              onClick={() => {
                apply(t('Gleis löschen'), (d) => ops.removeSegments(d, [id]));
                clearSel();
              }}
            >
              {t('Löschen')}
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function NodeProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const n = project.railNodes[id];
  if (!n) return null;
  const segs = Object.values(project.railSegments);
  const a = segs.filter((s) => (s.a.nodeId === id && s.a.side === 'A') || (s.b.nodeId === id && s.b.side === 'A')).length;
  const b = segs.filter((s) => (s.a.nodeId === id && s.a.side === 'B') || (s.b.nodeId === id && s.b.side === 'B')).length;
  const sigs = Object.values(project.railSignals).filter((s) => s.nodeId === id);
  const isStation = Object.values(project.stations).some((s) => s.backNodeId === id || s.frontNodeId === id);
  const setPos = (patch: Partial<typeof n.position>) => apply(t('Knoten verschieben'), (d) => ops.updateNode(d, id, { position: { ...n.position, ...patch } }));
  return (
    <Section title={a > 1 || b > 1 ? t('Gleisknoten (Weiche)') : t('Gleisknoten')}>
      <Row label="X">
        <NumberField value={n.position.x} suffix="m" onCommit={(x) => setPos({ x })} />
      </Row>
      <Row label="Y">
        <NumberField value={n.position.y} suffix="m" onCommit={(y) => setPos({ y })} />
      </Row>
      <Row label={t('Höhe')}>
        <NumberField value={n.position.z} suffix="m" onCommit={(z) => setPos({ z })} />
      </Row>
      <Row label={t('Achse (B-Seite)')}>
        <NumberField value={n.headingDeg} suffix="°" step={15} disabled={isStation} onCommit={(v) => apply(t('Knotenachse'), (d) => ops.updateNode(d, id, { headingDeg: geo.normalizeDeg(v) }))} />
      </Row>
      <Row label={t('Anschlüsse')}>
        {t('Seite A: {a} · Seite B: {b}', { a, b })}
        {(a === 0 || b === 0) && <Badge kind="muted">{t('Gleisende')}</Badge>}
      </Row>
      <Row label={t('Signale')}>
        {sigs.length === 0
          ? t('keine')
          : sigs.map((s) => (
              <a
                key={s.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  useUiStore.getState().select([{ table: 'railSignals', id: s.id }]);
                }}
              >
                {s.kind === 'path' ? t('Pfad') : t('Block')} ({s.facing === 'forward' ? 'A→B' : 'B→A'}){' '}
              </a>
            ))}
      </Row>
      <div className="button-row">
        {!sigs.some((s) => s.facing === 'forward') && <button onClick={() => apply(t('Signal setzen'), (d) => ops.addSignal(d, id, 'block', 'forward'))}>{t('+ Signal A→B')}</button>}
        {!sigs.some((s) => s.facing === 'backward') && <button onClick={() => apply(t('Signal setzen'), (d) => ops.addSignal(d, id, 'block', 'backward'))}>{t('+ Signal B→A')}</button>}
        {!isStation && <button onClick={() => apply(t('Knotenachse umkehren'), (d) => ops.flipNode(d, id))}>{t('Achse umkehren (F)')}</button>}
        {!isStation && (
          <button
            className="danger"
            onClick={() => {
              apply(t('Knoten löschen'), (d) => ops.removeNodes(d, [id]));
              clearSel();
            }}
          >
            {t('Löschen')}
          </button>
        )}
      </div>
    </Section>
  );
}

function SignalProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const s = project.railSignals[id];
  const info = useMemo(() => {
    if (!s) return null;
    const a = analyzeNetwork(project, s.networkId);
    const si = a.blocks.signalInfo.get(id);
    return { entry: si?.entryBlock ? a.blocks.blocks.get(si.entryBlock) : undefined, exit: si?.exitBlock ? a.blocks.blocks.get(si.exitBlock) : undefined };
  }, [project, s, id]);
  if (!s || !info) return null;
  return (
    <Section title={s.kind === 'path' ? t('Pfadsignal') : t('Blocksignal')}>
      <Row label={t('Typ')}>
        <select value={s.kind} onChange={(e) => apply(t('Signaltyp'), (d) => ops.updateSignal(d, id, { kind: e.target.value as 'block' | 'path' }))}>
          <option value="block">{t('Blocksignal')}</option>
          <option value="path">{t('Pfadsignal')}</option>
        </select>
      </Row>
      <Row label={t('Gilt für Fahrt')} plain>
        {s.facing === 'forward' ? 'A → B' : 'B → A'}{' '}
        <button className="small" onClick={() => apply(t('Signal umdrehen'), (d) => ops.updateSignal(d, id, { facing: s.facing === 'forward' ? 'backward' : 'forward' }))}>
          {t('umdrehen')}
        </button>
      </Row>
      <Row label={t('Block dahinter')} hint={t('Im Editor hervorgehoben')}>
        {info.entry ? t('{len} m · {a} Einfahrten · {b} Ausfahrten', { len: fmtNum(info.entry.lengthM, 0), a: info.entry.entrySignals.length, b: info.entry.exitSignals.length }) : <Badge kind="err">{t('kein Gleis')}</Badge>}
      </Row>
      <Row label={t('Block davor')}>{info.exit ? `${fmtNum(info.exit.lengthM, 0)} m` : <Badge kind="err">{t('kein Gleis')}</Badge>}</Row>
      <p className="dim small-text">{t('Ohne Gegensignal sperrt dieses Signal die Gegenrichtung (Spielmechanik).')}</p>
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            apply(t('Signal löschen'), (d) => ops.removeSignals(d, [id]));
            clearSel();
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}

function StationProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const st = project.stations[id];
  if (!st) return null;
  type NewPlatform = Omit<Platform, 'id'> & { id?: string };
  const setPlatforms = (platforms: NewPlatform[]) => apply(t('Bahnsteige ändern'), (d) => ops.setPlatforms(d, id, platforms));
  const update = (i: number, patch: Partial<Platform>) => setPlatforms(st.platforms.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <Section title={t('Bahnhof')}>
      <Row label={t('Name')}>
        <TextField value={st.name} onCommit={(name) => apply(t('Bahnhof umbenennen'), (d) => ops.updateStation(d, id, { name }))} />
      </Row>
      <Row label={t('Fabrik')} hint={t('Zuordnung für Transportaufträge')}>
        <select value={st.factoryId ?? ''} onChange={(e) => apply(t('Fabrik zuordnen'), (d) => ops.updateStation(d, id, { factoryId: e.target.value || null }))}>
          <option value="">{t('– keine –')}</option>
          {Object.values(project.factories).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Länge')}>{t('{len} m (Gebäude + {n} Bahnsteige)', { len: 16 * (1 + st.platforms.length), n: st.platforms.length })}</Row>
      <div className="platforms">
        <div className="platform-row head">
          <span>{t('Pos.')}</span>
          <span>{t('Art')}</span>
          <span>{t('Modus')}</span>
          <span />
        </div>
        <div className="platform-row">
          <span>1</span>
          <span>{t('Bahnhofsgebäude (Lok)')}</span>
          <span />
          <span />
        </div>
        {st.platforms.map((p, i) => (
          <div className="platform-row" key={p.id}>
            <span>{i + 2}</span>
            <select value={p.type} onChange={(e) => update(i, { type: e.target.value as Platform['type'] })}>
              <option value="freight">{t('Güter')}</option>
              <option value="fluid">{t('Flüssigkeit')}</option>
              <option value="empty">{t('leer')}</option>
            </select>
            <select value={p.mode} disabled={p.type === 'empty'} onChange={(e) => update(i, { mode: e.target.value as Platform['mode'] })}>
              <option value="load">{t('Beladen')}</option>
              <option value="unload">{t('Entladen')}</option>
            </select>
            <button className="small" onClick={() => setPlatforms(st.platforms.filter((_, k) => k !== i))} title={t('Bahnsteig entfernen')}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button onClick={() => setPlatforms([...st.platforms, { type: 'freight', mode: 'load', flipped: false }])}>{t('+ Bahnsteig')}</button>
        <button onClick={() => apply(t('Bahnhof drehen'), (d) => ops.moveStation(d, id, { x: 0, y: 0, z: 0 }, 90))}>{t('Drehen 90°')}</button>
        <button
          className="danger"
          onClick={() => {
            apply(t('Bahnhof löschen'), (d) => ops.removeStation(d, id));
            clearSel();
          }}
        >
          {t('Löschen')}
        </button>
      </div>
      <p className="dim small-text">
        {t('Züge halten nur bei Einfahrt in Pfeilrichtung (Spielmechanik). Grundfläche 16 × 34 m je Einheit aus den Spieldaten; die Lage des Gleises innerhalb der Breite ist schematisch.')}
      </p>
    </Section>
  );
}

/** Zugkraft und Länge: Loks je Wagen bei der steilsten Steigung, Platz am kürzesten Bahnhof. */
function TractionInfo({ trac, stationName, vehicleLen }: { trac: NonNullable<ReturnType<typeof trainTraction>>; stationName: string | null; vehicleLen: number }) {
  const gradePct = fmtNum(trac.maxGrade * 100, 1);
  return (
    <>
      <Row label={t('Masse')} hint={t('Lok 300 t, Wagen leer 30 t, voll 100 t (Wiki „Freight Car“).')}>
        {t('{empty} t leer · {full} t voll', { empty: fmtNum(trac.massEmptyT, 0), full: fmtNum(trac.massFullT, 0) })}
      </Row>
      <Row
        label={t('Steigung')}
        hint={trac.gradeFrom === 'route' ? t('Steilster Anstieg auf den Fahrwegen des Fahrplans') : t('Steilster Anstieg im ganzen Netz (kein Fahrplan)')}
      >
        {trac.rampClass === null ? (
          <>
            {gradePct} % · {t('eben')}
          </>
        ) : (
          <>
            {gradePct} %{' '}
            {trac.ok ? <Badge kind="ok">{t('Loks reichen')}</Badge> : <Badge kind="warn">{t('zu wenige Loks')}</Badge>}
          </>
        )}
      </Row>
      {trac.rampClass !== null && (
        <Row label={t('Loks')} hint={t('Wiki-Tabelle: höchste Zugmasse je Lok bei 12,5 / 25 / 50 % Steigung = 1644 / 800 / 580 t. Annahme: mehrere Loks ziehen entsprechend mehr.')}>
          {t('{have} vorhanden, {need} nötig (je Lok ca. {per} volle Wagen)', { have: trac.locomotives, need: trac.locosNeeded ?? '–', per: trac.wagonsPerLoco ?? '–' })}
        </Row>
      )}
      {trac.rampClass === null && trac.wagons > 0 && (
        <p className="dim small-text">{t('Auf ebener Strecke zieht eine Lok laut Wiki etwa 100 leere Wagen. Für beladene Züge nennt das Wiki erst ab einer Steigung Grenzwerte.')}</p>
      )}
      {trac.maxVehicles !== null && (
        <Row label={t('Maximallänge')} hint={t('Kürzester Bahnhof des Fahrplans: Bahnhofsgebäude + Bahnsteige, je 16 m')}>
          {t('{n} Fahrzeuge ({m} m) an {station}', { n: trac.maxVehicles, m: trac.maxVehicles * vehicleLen, station: stationName ?? '?' })}{' '}
          {trac.lengthM > trac.maxVehicles * vehicleLen ? <Badge kind="warn">{t('Zug zu lang')}</Badge> : <Badge kind="ok">{t('passt')}</Badge>}
        </Row>
      )}
    </>
  );
}

const VEHICLE_LABEL = (v: Vehicle) =>
  v.kind === 'locomotive' ? (v.reversed ? t('Lok ⟵') : t('Lok ⟶')) : v.cargo === 'liquid' ? t('Wagen (flüssig)') : t('Wagen (fest)');

function TrainProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  useSimStore((s) => s.tick);
  const sim = useSimStore.getState().sim;
  const t0 = project.trains[id];
  const legs = useMemo(() => {
    if (!t0?.timetableId) return [];
    const tt = project.timetables[t0.timetableId];
    if (!tt || tt.stops.length < 2) return [];
    const g = buildGraph(project, t0.networkId);
    return tt.stops.map((s, i) => {
      const next = tt.stops[(i + 1) % tt.stops.length]!;
      const ok = s.stationId === next.stationId || !!findRoute(project, g, { fromStationId: s.stationId, toStationId: next.stationId, bidirectional: isBidirectional(t0) });
      return { from: project.stations[s.stationId]?.name ?? '?', to: project.stations[next.stationId]?.name ?? '?', ok, stationId: s.stationId };
    });
  }, [project, t0]);
  const cycle = useMemo(() => (t0 ? estimateTrainCycle(project, gd, id) : null), [project, gd, id, t0]);
  const trac = useMemo(() => (t0 ? trainTraction(project, gd, id) : null), [project, gd, id, t0]);
  if (!t0) return null;
  const tr = t0;
  const setConsist = (consist: Vehicle[]) => apply(t('Zug ändern'), (d) => ops.updateTrain(d, id, { consist }));
  const timetables = Object.values(project.timetables).filter((x) => x.networkId === tr.networkId);
  const vehicleLen = gd.fact('rail.freightCar.lengthM') ?? 16;
  const slots = gd.fact('rail.freightCar.slots') ?? 32;
  const fluid = gd.fact('rail.freightCar.fluidM3') ?? 2400;
  const wagons = tr.consist.filter((v) => v.kind === 'wagon');
  const measured = sim?.summary().find((s) => s.trainId === id);
  return (
    <Section title={t('Zug')}>
      <Row label={t('Name')}>
        <TextField value={tr.name} onCommit={(name) => apply(t('Zug umbenennen'), (d) => ops.updateTrain(d, id, { name }))} />
      </Row>
      <Row label={t('Farbe')}>
        <input type="color" value={tr.color} onChange={(e) => apply(t('Zugfarbe'), (d) => ops.updateTrain(d, id, { color: e.target.value }))} />
      </Row>
      <Row label={t('Fahrplan')}>
        <select value={tr.timetableId ?? ''} onChange={(e) => apply(t('Fahrplan zuordnen'), (d) => ops.updateTrain(d, id, { timetableId: e.target.value || null }))}>
          <option value="">{t('– keiner –')}</option>
          {timetables.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Länge')}>
        {trainLengthM(tr, vehicleLen)} m {isBidirectional(tr) && <Badge kind="info">{t('Zweirichtung')}</Badge>}
      </Row>
      <Row label={t('Kapazität')}>
        {t('{a} Stapel · {b} m³', { a: wagons.filter((w) => w.kind === 'wagon' && w.cargo === 'solid').length * slots, b: fmtNum(wagons.filter((w) => w.kind === 'wagon' && w.cargo === 'liquid').length * fluid, 0) })}
      </Row>
      {trac && <TractionInfo trac={trac} stationName={trac.shortestStationId ? (project.stations[trac.shortestStationId]?.name ?? '?') : null} vehicleLen={vehicleLen} />}
      {cycle?.cycleS && (
        <Row label={t('Umlauf (Schätzung)')} hint={t('Strecke / Durchschnittsgeschwindigkeit + Umschlag und Wartezeit je Halt')}>
          {fmtNum(cycle.cycleS, 0)} s ({fmtNum(cycle.lengthM / 1000, 2)} km)
        </Row>
      )}
      {measured?.cycleS && (
        <Row label={t('Umlauf (Simulation)')}>
          {fmtNum(measured.cycleS, 0)} s · {t('Wartezeit {n} %', { n: fmtNum(measured.waitShare * 100, 0) })}
        </Row>
      )}
      <div className="consist">
        {tr.consist.map((v, i) => (
          <span key={i} className={`vehicle vehicle-${v.kind}`}>
            <span>{VEHICLE_LABEL(v)}</span>
            {v.kind === 'locomotive' && (
              <button className="link-button" title={t('Richtung umkehren')} onClick={() => setConsist(tr.consist.map((x, k) => (k === i && x.kind === 'locomotive' ? { ...x, reversed: !x.reversed } : x)))}>
                ⇄
              </button>
            )}
            {v.kind === 'wagon' && (
              <button className="link-button" title={t('Fest/flüssig')} onClick={() => setConsist(tr.consist.map((x, k) => (k === i && x.kind === 'wagon' ? { ...x, cargo: x.cargo === 'solid' ? 'liquid' : 'solid' } : x)))}>
                ⇅
              </button>
            )}
            <button className="link-button" title={t('Entfernen')} onClick={() => setConsist(tr.consist.filter((_, k) => k !== i))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="button-row">
        <button onClick={() => setConsist([...tr.consist, { kind: 'wagon', cargo: 'solid' }])}>{t('+ Wagen')}</button>
        <button onClick={() => setConsist([...tr.consist, { kind: 'wagon', cargo: 'liquid' }])}>{t('+ Flüssigwagen')}</button>
        <button onClick={() => setConsist([...tr.consist, { kind: 'locomotive', reversed: false }])}>{t('+ Lok')}</button>
        <button onClick={() => setConsist([...tr.consist, { kind: 'locomotive', reversed: true }])}>{t('+ Lok rückwärts')}</button>
      </div>
      {legs.length > 0 && (
        <>
          <h4 className="sub">{t('Fahrwege (statische Prüfung)')}</h4>
          {legs.map((l, i) => {
            const st = project.stations[l.stationId];
            const issues = st ? wagonPlatformIssues(tr, st) : [];
            return (
              <div key={i} className="leg">
                {l.ok ? <Badge kind="ok">{t('erreichbar')}</Badge> : <Badge kind="err">{t('nicht erreichbar')}</Badge>} {l.from} → {l.to}
                {issues.length > 0 && (
                  <div className="dim small-text">
                    {t('An {station}:', { station: l.from })} {issues.join(' ')}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            apply(t('Zug löschen'), (d) => ops.removeTrains(d, [id]));
            clearSel();
          }}
        >
          {t('Zug löschen')}
        </button>
      </div>
    </Section>
  );
}

function TimetableProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const tt = project.timetables[id];
  if (!tt) return null;
  const stations = Object.values(project.stations).filter((s) => s.networkId === tt.networkId);
  type NewStop = Omit<TimetableStop, 'id'> & { id?: string };
  const setStops = (stops: NewStop[]) => apply(t('Fahrplan ändern'), (d) => ops.updateTimetable(d, id, { stops }));
  const upd = (i: number, patch: Partial<TimetableStop>) => setStops(tt.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) => {
    const stops = [...tt.stops];
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j]!, stops[i]!];
    setStops(stops);
  };
  const allItems = Object.values(gd.data.items).sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage()));
  /** Gegenstände, die die Bahnsteige des Bahnhofs umschlagen können. */
  const itemsFor = (stationId: string) => {
    const st = project.stations[stationId];
    const types = new Set(st?.platforms.map((pf) => pf.type) ?? []);
    if (!types.size || (types.has('freight') && types.has('fluid'))) return allItems;
    if (types.has('fluid')) return allItems.filter((i) => i.form !== 'solid');
    if (types.has('freight')) return allItems.filter((i) => i.form === 'solid');
    return allItems;
  };
  /** Vorschläge: Gegenstände der Transportaufträge, die an diesem Bahnhof laden oder entladen. */
  const suggestionsFor = (stationId: string) =>
    Object.values(project.transportOrders)
      .filter((o) => o.fromStationId === stationId || o.toStationId === stationId)
      .map((o) => ({ id: o.itemId, reason: o.fromStationId === stationId ? t('Auftrag „{name}“ lädt hier', { name: o.name }) : t('Auftrag „{name}“ entlädt hier', { name: o.name }) }));
  const users = Object.values(project.trains).filter((x) => x.timetableId === id);
  return (
    <Section title={t('Fahrplan')}>
      <Row label={t('Name')}>
        <TextField value={tt.name} onCommit={(name) => apply(t('Fahrplan umbenennen'), (d) => ops.updateTimetable(d, id, { name }))} />
      </Row>
      <Row label={t('Verwendet von')}>{users.length ? users.map((u) => u.name).join(', ') : t('keinem Zug')}</Row>
      {tt.stops.map((s, i) => (
        <div key={s.id} className="stop">
          <div className="stop-head">
            <strong>{i + 1}.</strong>
            <select value={s.stationId} onChange={(e) => upd(i, { stationId: e.target.value })}>
              {stations.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
            <button className="small" onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button className="small" onClick={() => move(i, 1)} disabled={i === tt.stops.length - 1}>
              ↓
            </button>
            <button className="small" onClick={() => setStops(tt.stops.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
          <Row label={t('Wartezeit')}>
            <NumberField value={s.waitS} min={0} suffix="s" onCommit={(waitS) => upd(i, { waitS })} />
          </Row>
          <Row label={t('Abfahrt erst wenn')}>
            <select value={s.condition} onChange={(e) => upd(i, { condition: e.target.value as TimetableStop['condition'] })}>
              <option value="none">{t('– keine Bedingung –')}</option>
              <option value="fully-loaded">{t('vollständig beladen')}</option>
              <option value="fully-unloaded">{t('vollständig entladen')}</option>
            </select>
          </Row>
          <Row label={t('Umschlag')}>
            <select value={s.transfer} onChange={(e) => upd(i, { transfer: e.target.value as TimetableStop['transfer'] })}>
              <option value="all">{t('alles')}</option>
              <option value="items">{t('nur bestimmte Gegenstände')}</option>
              <option value="none">{t('nichts')}</option>
            </select>
          </Row>
          {s.transfer === 'items' && (
            <Row label={t('Gegenstände')} plain hint={t('Nur diese Gegenstände werden an diesem Halt geladen bzw. entladen. Die Liste zeigt, was die Bahnsteige des Bahnhofs umschlagen können.')}>
              <ItemPicker items={itemsFor(s.stationId)} value={s.itemIds} onChange={(itemIds) => upd(i, { itemIds })} suggestions={suggestionsFor(s.stationId)} />
            </Row>
          )}
        </div>
      ))}
      <div className="button-row">
        <button disabled={stations.length === 0} onClick={() => setStops([...tt.stops, { stationId: stations[0]!.id, waitS: 0, condition: 'none', transfer: 'all', itemIds: [] }])}>
          {t('+ Halt')}
        </button>
        <button
          className="danger"
          onClick={() => {
            apply(t('Fahrplan löschen'), (d) => ops.removeTimetable(d, id));
            clearSel();
          }}
        >
          {t('Fahrplan löschen')}
        </button>
      </div>
      <p className="dim small-text">
        {t('Halteeinstellungen nach Wiki „Electric Locomotive – Stop settings“: Umschlag aller bzw. bestimmter Gegenstände, Wartezeit, Bedingung „vollständig be-/entladen“.')}
      </p>
    </Section>
  );
}

function MeasureProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const m = project.measurements[id];
  if (!m) return null;
  return (
    <Section title={t('Maß')}>
      <Row label={t('Länge')}>{fmtNum(geo.dist(m.from, m.to), 2)} m</Row>
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            apply(t('Maß löschen'), (d) => void delete d.measurements[id]);
            clearSel();
          }}
        >
          {t('Löschen')}
        </button>
      </div>
    </Section>
  );
}
