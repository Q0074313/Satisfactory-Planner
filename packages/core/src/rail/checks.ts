/**
 * Prüfregeln für Schienennetze. Siehe docs/SPIELREGELN.md, Abschnitt 4.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { ObjectRef, Project, Station, Train } from '../model/schema.ts';
import { makeFinding } from '../validation/registry.ts';
import type { Finding, FindingLocation } from '../validation/types.ts';
import { CROSSING_HEIGHT_TOLERANCE_M, findCrossings, otherSide, segmentMinRadius, segmentShape } from './geometry.ts';
import {
  RAIL_BIDIRECTIONAL_LOOP,
  RAIL_BLOCK_MERGE,
  RAIL_CROSSING_BLOCK,
  RAIL_DEADLOCK_UNCHECKED,
  RAIL_MIXED_ENTRY,
  RAIL_NO_EXIT,
  RAIL_NO_SIGNALS,
  RAIL_PATH_CHAIN,
  RAIL_PATH_NOT_LEVEL,
  RAIL_RADIUS,
  RAIL_SEGMENT_LENGTH,
  RAIL_SHORT_EXIT_BLOCK,
  RAIL_SIGNAL_COUNT,
  RAIL_SIGNAL_DANGLING,
  RAIL_SIGNAL_SELF_LOOP,
  RAIL_STATION_DEAD_END,
  RAIL_STATION_IN_PATH,
  RAIL_TRACTION,
  RAIL_TRAIN_LONGER_THAN_STATION,
  RAIL_UNREACHABLE,
  RAIL_WAGON_PLATFORM,
  PATH_CHAIN_LIMIT,
} from './rules.ts';
import {
  analyzeBlocks,
  buildGraph,
  canReverseDirection,
  findRoute,
  isBidirectional,
  shortestRoute,
  trainLengthM,
  type BlockAnalysis,
  type RailGraph,
} from './topology.ts';
import { trainTraction } from './traction.ts';

export interface NetworkAnalysis {
  graph: RailGraph;
  blocks: BlockAnalysis;
}

export function analyzeNetwork(p: Project, networkId: string): NetworkAnalysis {
  const graph = buildGraph(p, networkId);
  return { graph, blocks: analyzeBlocks(p, graph) };
}

const nodeLoc = (p: Project, nodeId: string, networkId: string): FindingLocation | undefined => {
  const n = p.railNodes[nodeId];
  return n ? { x: n.position.x, y: n.position.y, z: n.position.z, networkId } : undefined;
};

function segLoc(p: Project, segId: string, networkId: string): FindingLocation | undefined {
  const s = p.railSegments[segId];
  if (!s) return undefined;
  const a = p.railNodes[s.a.nodeId];
  const b = p.railNodes[s.b.nodeId];
  if (!a || !b) return undefined;
  return { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, networkId };
}

const stationLabel = (s: Station | undefined) => (s ? `„${s.name}“` : tr('(unbekannt)'));

export function checkNetwork(p: Project, gd: GameDataIndex, networkId: string): Finding[] {
  const out: Finding[] = [];
  const net = p.railNetworks[networkId];
  if (!net) return out;
  const { graph: g, blocks } = analyzeNetwork(p, networkId);
  const vehicleLen = gd.fact('rail.freightCar.lengthM') ?? 16;
  const minR = gd.fact('rail.track.minTurnRadiusM') ?? 17;
  const minLen = gd.fact('rail.track.minSegmentLengthM') ?? 12;
  const maxLen = gd.fact('rail.track.maxSegmentLengthM') ?? 100;
  const sigRef = (id: string): ObjectRef => ({ table: 'railSignals', id });
  const segRef = (id: string): ObjectRef => ({ table: 'railSegments', id });
  const kindName = (k: string) => (k === 'path' ? tr('Pfadsignal') : tr('Blocksignal'));

  // --- Signale an Knoten ---
  for (const [nodeId, sigs] of g.signals) {
    const sides = g.sides.get(nodeId);
    if (sigs.length > 2 || (sigs.length === 2 && sigs[0]!.facing === sigs[1]!.facing)) {
      out.push(
        makeFinding(RAIL_SIGNAL_COUNT, sigs.map((s) => sigRef(s.id)), {
          message: sigs.length === 2 ? tr('{n} Signale an einer Gleisverbindung in gleicher Richtung', { n: sigs.length }) : tr('{n} Signale an einer Gleisverbindung', { n: sigs.length }),
          explanation: tr('An einer Gleisverbindung sind höchstens zwei Signale möglich, und zwar in entgegengesetzte Richtungen.'),
          suggestion: tr('Überzählige Signale entfernen oder ein Signal umdrehen.'),
        }, { location: nodeLoc(p, nodeId, networkId) }),
      );
    }
    for (const sig of sigs) {
      const info = blocks.signalInfo.get(sig.id)!;
      const into = sig.facing === 'forward' ? 'B' : 'A';
      if (!sides || sides.A.length === 0 || sides.B.length === 0) {
        out.push(
          makeFinding(RAIL_SIGNAL_DANGLING, [sigRef(sig.id)], {
            message: tr('{kind} am Gleisende', { kind: kindName(sig.kind) }),
            explanation:
              sides && sides[into].length === 0
                ? tr('Auf der Einfahrseite des Signals liegt kein Gleis. Das Spiel meldet „Signal has missing connections“.')
                : tr('Auf der Rückseite des Signals liegt kein Gleis. Das Spiel meldet „Signal has missing connections“.'),
            suggestion: tr('Signal an eine Verbindung zwischen zwei Gleisen setzen oder das Gleis fortführen.'),
          }, { location: nodeLoc(p, nodeId, networkId) }),
        );
        continue;
      }
      if (info.entryBlock && info.entryBlock === info.exitBlock) {
        out.push(
          makeFinding(RAIL_SIGNAL_SELF_LOOP, [sigRef(sig.id)], {
            message: tr('{kind} teilt den Block nicht', { kind: kindName(sig.kind) }),
            explanation: tr(
              'Vor und hinter dem Signal liegt derselbe Block. Er ist über einen anderen Weg ohne Signal verbunden, z. B. über eine Schleife oder eine Kreuzung auf gleicher Höhe.',
            ),
            suggestion: tr('Auf dem anderen Weg (Schleife, Abzweig oder Kreuzung) ebenfalls ein Signal setzen oder die Kreuzung höhenversetzt planen.'),
          }, { location: nodeLoc(p, nodeId, networkId) }),
        );
      }
    }
  }

  // --- Blöcke ---
  let maxTrain = 0;
  for (const t of g.trains) maxTrain = Math.max(maxTrain, trainLengthM(t, vehicleLen));
  for (const b of blocks.blocks.values()) {
    const loc = segLoc(p, b.segments[0]!, networkId);
    const refs = b.segments.slice(0, 20).map(segRef);
    if (b.entrySignals.length > 0 && b.exitSignals.length === 0) {
      out.push(
        makeFinding(RAIL_NO_EXIT, [...b.entrySignals.map((s) => sigRef(s.id)), ...refs], {
          message: tr('Block ohne Ausfahrsignal'),
          explanation: tr('In diesen Block führt mindestens ein Signal hinein, aber keines heraus. Das Spiel meldet „Block has no exit signal“ und zeigt die Einfahrsignale als Fehler.'),
          suggestion: tr('An jedem Ausgang des Blocks ein Signal in Fahrtrichtung setzen. Bei einem Kopfbahnhof für Zweirichtungsbetrieb ein Gegensignal an der Blockgrenze setzen.'),
        }, { location: loc, keyExtra: b.entrySignals.map((s) => s.id).sort().join(',') }),
      );
    }
    const kinds = new Set(b.entrySignals.map((s) => s.kind));
    if (kinds.size > 1) {
      out.push(
        makeFinding(RAIL_MIXED_ENTRY, b.entrySignals.map((s) => sigRef(s.id)), {
          message: tr('Block- und Pfadsignale als Einfahrt in denselben Block'),
          explanation: tr('Alle Einfahrsignale eines Blocks müssen denselben Typ haben. Das Spiel meldet sonst „Block has conflicting entry signal types“.'),
          suggestion: tr('Alle Einfahrsignale dieses Blocks auf Pfadsignal (Kreuzungen, Zusammenführungen) oder auf Blocksignal (Strecke, Bahnhof) stellen.'),
        }, { location: loc }),
      );
    }
    if (b.isPath && b.stations.length > 0) {
      out.push(
        makeFinding(RAIL_STATION_IN_PATH, [...b.stations.map((id) => ({ table: 'stations', id }) as ObjectRef), ...b.entrySignals.map((s) => sigRef(s.id))], {
          message: tr('Bahnhof {stations} liegt in einem Pfadblock', { stations: b.stations.map((id) => stationLabel(p.stations[id])).join(', ') }),
          explanation: tr('Ein Pfadblock darf keinen Bahnhof enthalten (Spielmeldung „Path block cannot contain stations“).'),
          suggestion: tr('Vor dem Bahnhof Blocksignale als Einfahrt verwenden oder den Bahnhof durch zusätzliche Signale vom Pfadblock trennen.'),
        }, { location: loc }),
      );
    }
    const blockEntries = b.entrySignals.filter((s) => s.kind === 'block');
    if (blockEntries.length >= 2 && kinds.size === 1) {
      out.push(
        makeFinding(RAIL_BLOCK_MERGE, blockEntries.map((s) => sigRef(s.id)), {
          message: tr('{n} Blocksignale führen in denselben Block', { n: blockEntries.length }),
          explanation: tr(RAIL_BLOCK_MERGE.description),
          suggestion: tr('Die Einfahrsignale dieses Blocks durch Pfadsignale ersetzen.'),
        }, { location: loc }),
      );
    }
    if (b.isPath && b.maxZ - b.minZ > 0.5) {
      out.push(
        makeFinding(RAIL_PATH_NOT_LEVEL, b.entrySignals.map((s) => sigRef(s.id)), {
          message: tr('Pfadblock mit {h} m Höhenunterschied', { h: formatNumber(b.maxZ - b.minZ, 1) }),
          explanation: tr(RAIL_PATH_NOT_LEVEL.description),
          suggestion: tr('Kreuzungsbereich eben planen und Steigungen außerhalb des Pfadblocks anordnen.'),
        }, { location: loc }),
      );
    }
    // Block hinter Pfadblock kürzer als der längste Zug
    if (b.isPath && maxTrain > 0) {
      for (const exit of b.exitSignals) {
        const next = blocks.signalInfo.get(exit.id)?.entryBlock;
        const nb = next ? blocks.blocks.get(next) : undefined;
        if (!nb || nb.isPath) continue;
        if (nb.lengthM + 1e-6 < maxTrain) {
          out.push(
            makeFinding(RAIL_SHORT_EXIT_BLOCK, [sigRef(exit.id), ...nb.segments.slice(0, 10).map(segRef)], {
              message: tr('Block hinter dem Pfadblock ist {len} m lang, längster Zug {train} m', { len: formatNumber(nb.lengthM, 0), train: maxTrain }),
              explanation: tr(RAIL_SHORT_EXIT_BLOCK.description),
              suggestion: tr('Das nächste Signal hinter der Ausfahrt so setzen, dass der Block mindestens {train} m lang ist.', { train: maxTrain }),
            }, { location: nodeLoc(p, exit.nodeId, networkId) }),
          );
        }
      }
    }
  }

  // --- Kreuzungen ---
  for (const c of blocks.crossings) {
    const dz = Math.abs(c.zA - c.zB);
    if (dz >= CROSSING_HEIGHT_TOLERANCE_M) continue;
    out.push(
      makeFinding(RAIL_CROSSING_BLOCK, [segRef(c.segA), segRef(c.segB)], {
        message: tr('Kreuzung ohne Gleisverbindung auf gleicher Höhe'),
        explanation: tr(
          'Die beiden Gleise sind nicht verbunden, kreuzen sich aber auf gleicher Höhe (Unterschied unter 1 m). Im Spiel gehören sie deshalb zum selben Block. Höhenversetzt (Brücke) würden sie sich nicht beeinflussen.',
        ),
        suggestion: tr('Kreuzung mit Pfadsignalen an allen Zufahrten absichern oder ein Gleis höher bzw. tiefer legen.'),
      }, { location: { x: c.point.x, y: c.point.y, networkId } }),
    );
  }

  // --- Geometrie ---
  for (const s of g.segments.values()) {
    const shape = segmentShape(p, s);
    if (!shape) continue;
    const len = g.lengths.get(s.id) ?? 0;
    if (!s.stationId && (len < minLen - 0.01 || len > maxLen + 0.01)) {
      out.push(
        makeFinding(RAIL_SEGMENT_LENGTH, [segRef(s.id)], {
          message: tr('Gleissegment {len} m lang', { len: formatNumber(len, 1) }),
          explanation: tr('Ein einzelnes Gleissegment ist im Spiel {min} bis {max} m lang.', { min: minLen, max: maxLen }),
          suggestion: len < minLen ? tr('Knoten weiter auseinander legen oder Segmente zusammenfassen.') : tr('Zwischenknoten einfügen (Segment teilen).'),
        }, { location: segLoc(p, s.id, networkId) }),
      );
    }
    const r = segmentMinRadius(shape);
    // 2 % Toleranz: Bezierkurven nähern Kreisbögen nur an (Krümmung schwankt um ca. ±1 %).
    if (r < minR * 0.98) {
      out.push(
        makeFinding(RAIL_RADIUS, [segRef(s.id)], {
          message: tr('Kurvenradius {r} m (Minimum {min} m)', { r: formatNumber(r, 1), min: minR }),
          explanation: tr(RAIL_RADIUS.description),
          suggestion: tr('Kurve weiter ziehen (Knoten verschieben) oder in zwei flachere Bögen aufteilen.'),
        }, { location: segLoc(p, s.id, networkId) }),
      );
    }
  }

  // --- Bahnhöfe ---
  for (const st of g.stations) {
    const front = g.sides.get(st.frontNodeId);
    const seg = g.segments.get(st.segmentId);
    if (!seg || !front) continue;
    const exitSide = otherSide(seg.b.side);
    const servingTrains = g.trains.filter((t) => t.timetableId && p.timetables[t.timetableId]?.stops.some((s) => s.stationId === st.id));
    if (front[exitSide].length === 0 && !servingTrains.some(isBidirectional)) {
      out.push(
        makeFinding(RAIL_STATION_DEAD_END, [{ table: 'stations', id: st.id }], {
          message: tr('Bahnhof {station} endet ohne Weiterfahrt', { station: stationLabel(st) }),
          explanation: tr(RAIL_STATION_DEAD_END.description),
          suggestion: tr('Hinter dem Bahnhof eine Wendeschleife anschließen oder Zweirichtungszüge (Lok am Zugende rückwärts) einsetzen.'),
        }, { location: nodeLoc(p, st.frontNodeId, networkId) }),
      );
    }
  }

  // --- Züge und Fahrpläne ---
  const anySignals = g.signals.size > 0;
  if (g.trains.length >= 2 && !anySignals) {
    out.push(
      makeFinding(RAIL_NO_SIGNALS, [{ table: 'railNetworks', id: networkId }, ...g.trains.map((t) => ({ table: 'trains', id: t.id }) as ObjectRef)], {
        message: tr('{n} Züge im Netz „{net}“, aber keine Signale', { n: g.trains.length, net: net.name }),
        explanation: tr(RAIL_NO_SIGNALS.description),
        suggestion: tr('Strecke mit Block- und Pfadsignalen in Blöcke aufteilen.'),
      }),
    );
  }
  out.push(...pathChainFindings(p, g, blocks, networkId));
  let reversible: boolean | undefined;
  for (const t of g.trains) {
    const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
    const bidi = isBidirectional(t);
    const tLen = trainLengthM(t, vehicleLen);
    if (tt && tt.stops.length >= 2) {
      for (let i = 0; i < tt.stops.length; i++) {
        const a = tt.stops[i]!;
        const b = tt.stops[(i + 1) % tt.stops.length]!;
        if (a.stationId === b.stationId) continue;
        const sa = p.stations[a.stationId];
        const sb = p.stations[b.stationId];
        if (!sa || !sb) continue;
        const ok = sa.networkId === networkId && sb.networkId === networkId && findRoute(p, g, { fromStationId: a.stationId, toStationId: b.stationId, bidirectional: bidi });
        if (ok) continue;
        let cause: string;
        if (sa.networkId !== networkId || sb.networkId !== networkId) cause = tr('Mindestens ein Bahnhof liegt in einem anderen Schienennetz als der Zug.');
        else if (findRoute(p, g, { fromStationId: a.stationId, toStationId: b.stationId, bidirectional: bidi, ignoreSignals: true }))
          cause = tr('Ohne Signale gäbe es einen Weg. Der Zug müsste aber an der Rückseite eines Signals vorbeifahren (Einrichtungssignal ohne Gegensignal).');
        else if (findRoute(p, g, { fromStationId: a.stationId, toStationId: b.stationId, bidirectional: bidi, ignoreSignals: true, anyArrivalDirection: true }))
          cause = tr('Der Zug erreicht {station} nur aus der falschen Richtung. Bahnhöfe nehmen Züge nur in ihrer Fahrtrichtung auf.', { station: stationLabel(sb) });
        else if (!bidi && findRoute(p, g, { fromStationId: a.stationId, toStationId: b.stationId, bidirectional: true, ignoreSignals: true }))
          cause = tr('Der Weg erfordert ein Wenden. Der Zug hat aber keine rückwärts gerichtete Lok.');
        else cause = tr('Es gibt keine durchgehende Gleisverbindung in Fahrtrichtung. Prüfe Weichen (Knotenseiten) und Lücken.');
        out.push(
          makeFinding(RAIL_UNREACHABLE, [{ table: 'trains', id: t.id }, { table: 'stations', id: b.stationId }, { table: 'timetables', id: tt.id }], {
            message: tr('{train}: {to} von {from} aus nicht erreichbar', { train: t.name, to: stationLabel(sb), from: stationLabel(sa) }),
            explanation: cause,
            suggestion: tr('Signalrichtungen, Bahnhofsrichtung und Weichenanschlüsse auf dem gewünschten Weg prüfen. Für Kopfbahnhöfe eine Wendeschleife oder eine rückwärts gerichtete Lok vorsehen.'),
          }, { location: nodeLoc(p, sb.backNodeId, networkId), keyExtra: `${i}` }),
        );
      }
      for (const stop of tt.stops) {
        const st = p.stations[stop.stationId];
        if (!st) continue;
        const stationLen = vehicleLen * (1 + st.platforms.length);
        if (tLen > stationLen) {
          out.push(
            makeFinding(RAIL_TRAIN_LONGER_THAN_STATION, [{ table: 'trains', id: t.id }, { table: 'stations', id: st.id }], {
              message: tr('{train} ({len} m) ist länger als {station} ({slen} m)', { train: t.name, len: tLen, station: stationLabel(st), slen: stationLen }),
              explanation: tr(RAIL_TRAIN_LONGER_THAN_STATION.description),
              suggestion: tr('Mindestens {n} Bahnsteige vorsehen (ggf. leere Bahnsteige als Platzhalter).', { n: Math.ceil(tLen / vehicleLen) - 1 }),
            }, { location: nodeLoc(p, st.frontNodeId, networkId) }),
          );
        }
        if (stop.transfer !== 'none') {
          const issues = wagonPlatformIssues(t, st);
          if (issues.length) {
            out.push(
              makeFinding(RAIL_WAGON_PLATFORM, [{ table: 'trains', id: t.id }, { table: 'stations', id: st.id }], {
                message: tr('{train} an {station}: {n} Wagen ohne passenden Bahnsteig', { train: t.name, station: stationLabel(st), n: issues.length }),
                explanation: `${issues.join(' ')} ${tr(RAIL_WAGON_PLATFORM.description)}`,
                suggestion: tr('Bahnsteige an die Zugzusammenstellung anpassen oder die Wagenreihenfolge ändern.'),
              }, { location: nodeLoc(p, st.frontNodeId, networkId) }),
            );
          }
        }
      }
    }
    const trac = trainTraction(p, gd, t.id, g);
    if (trac && !trac.ok) {
      out.push(
        makeFinding(RAIL_TRACTION, [{ table: 'trains', id: t.id }], {
          message: tr('{train}: {locos} Lok(s) für {wagons} Wagen bei {grade} % Steigung zu schwach', {
            train: t.name,
            locos: trac.locomotives,
            wagons: trac.wagons,
            grade: formatNumber(trac.maxGrade * 100, 1),
          }),
          explanation: `${tr('Voll beladen wiegt der Zug {mass} t. Je Lok sind bei dieser Steigung höchstens {max} t möglich, also etwa {per} volle Wagen je Lok.', {
            mass: formatNumber(trac.massFullT, 0),
            max: formatNumber(trac.maxMassPerLocoT ?? 0, 0),
            per: trac.wagonsPerLoco ?? 0,
          })} ${tr(RAIL_TRACTION.description)}`,
          suggestion: tr('Mindestens {n} Loks einsetzen, Wagen verringern oder die Steigung abflachen.', { n: trac.locosNeeded ?? 1 }),
        }),
      );
    }
    if (bidi) {
      reversible ??= canReverseDirection(g);
      if (reversible) {
        out.push(
          makeFinding(RAIL_BIDIRECTIONAL_LOOP, [{ table: 'trains', id: t.id }], {
            message: tr('{train}: Zweirichtungszug in einem Netz mit Wendemöglichkeit', { train: t.name }),
            explanation: tr(RAIL_BIDIRECTIONAL_LOOP.description),
            suggestion: tr('Für Zweirichtungszüge Netze ohne Wendeschleifen planen oder Einrichtungszüge mit Schleifen verwenden.'),
          }),
        );
      }
    }
  }
  if (g.trains.length >= 2 && anySignals) {
    out.push(
      makeFinding(RAIL_DEADLOCK_UNCHECKED, [{ table: 'railNetworks', id: networkId }], {
        message: tr('Netz „{net}“: Deadlocks sind statisch nicht ausgeschlossen', { net: net.name }),
        explanation: tr(RAIL_DEADLOCK_UNCHECKED.description),
        suggestion: tr('Kritische Abschnitte (eingleisige Strecken, Kreuzungen mit kurzen Folgeblöcken) in der Simulation prüfen (Schienennetz → Simulation).'),
      }),
    );
  }
  return out;
}

/** Positionen 0 = Bahnhofsgebäude, 1..n = Bahnsteige; Fahrzeug i steht an Position i. */
/** Kette aufeinanderfolgender Pfadblöcke auf einem Fahrweg. */
export interface PathChain {
  /** Pfadblöcke in Fahrtrichtung. */
  blockIds: string[];
  /** Erstes Segment je Pfadblock auf dem Weg. */
  firstSegments: string[];
  /** Länge des reservierten Wegs durch die Kette (m). */
  lengthM: number;
}

/** Ketten von Pfadblöcken auf einem Fahrweg (Folge von Gleiszuständen). */
export function pathChains(g: RailGraph, blocks: BlockAnalysis, states: { segId: string }[]): PathChain[] {
  const out: PathChain[] = [];
  let cur: PathChain | null = null;
  let lastBlock: string | null = null;
  for (const st of states) {
    const bid = blocks.blockOf.get(st.segId);
    if (!bid) continue;
    const block = blocks.blocks.get(bid)!;
    if (!block.isPath) {
      if (cur) out.push(cur);
      cur = null;
      lastBlock = bid;
      continue;
    }
    cur ??= { blockIds: [], firstSegments: [], lengthM: 0 };
    if (bid !== lastBlock) {
      cur.blockIds.push(bid);
      cur.firstSegments.push(st.segId);
    }
    cur.lengthM += g.lengths.get(st.segId) ?? 0;
    lastBlock = bid;
  }
  if (cur) out.push(cur);
  return out;
}

/** RAIL-026: Fahrwege der Züge über viele Pfadsignale hintereinander. */
function pathChainFindings(p: Project, g: RailGraph, blocks: BlockAnalysis, networkId: string): Finding[] {
  const found = new Map<string, { chain: PathChain; trains: Set<string> }>();
  for (const t of g.trains) {
    const tt = t.timetableId ? p.timetables[t.timetableId] : undefined;
    if (!tt || tt.stops.length < 2) continue;
    for (let i = 0; i < tt.stops.length; i++) {
      const a = tt.stops[i]!;
      const b = tt.stops[(i + 1) % tt.stops.length]!;
      if (a.stationId === b.stationId) continue;
      const route = shortestRoute(p, g, { fromStationId: a.stationId, toStationId: b.stationId, bidirectional: isBidirectional(t) });
      if (!route) continue;
      for (const chain of pathChains(g, blocks, route.states)) {
        if (chain.blockIds.length < PATH_CHAIN_LIMIT) continue;
        const key = chain.blockIds.join('>');
        const hit = found.get(key) ?? { chain, trains: new Set<string>() };
        hit.trains.add(t.id);
        found.set(key, hit);
      }
    }
  }
  return [...found.values()].map(({ chain, trains }) => {
    const names = [...trains].map((id) => p.trains[id]?.name ?? '?').join(', ');
    return makeFinding(
      RAIL_PATH_CHAIN,
      [...chain.firstSegments.map((id) => ({ table: 'railSegments', id }) as ObjectRef), ...[...trains].map((id) => ({ table: 'trains', id }) as ObjectRef)],
      {
        message: tr('{n} Pfadsignale hintereinander ({len} m reserviert) – {trains}', { n: chain.blockIds.length, len: formatNumber(chain.lengthM, 0), trains: names }),
        explanation: tr(RAIL_PATH_CHAIN.description),
        suggestion: tr('Zwischen den Weichen bzw. Kreuzungen Blocksignale statt Pfadsignalen setzen, damit ein Zug zwischendurch halten kann und die Reservierung kürzer wird.'),
      },
      { location: segLoc(p, chain.firstSegments[0]!, networkId) },
    );
  });
}

export function wagonPlatformIssues(t: Train, st: Station): string[] {
  const issues: string[] = [];
  t.consist.forEach((v, i) => {
    if (v.kind !== 'wagon') return;
    const pf = i === 0 ? undefined : st.platforms[i - 1];
    const nr = i + 1;
    if (i === 0) issues.push(tr('Fahrzeug {n} (Wagen) steht am Bahnhofsgebäude.', { n: nr }));
    else if (!pf) issues.push(tr('Wagen an Position {n} steht hinter dem letzten Bahnsteig.', { n: nr }));
    else if (pf.type === 'empty') issues.push(tr('Wagen an Position {n} steht an einem leeren Bahnsteig.', { n: nr }));
    else if (pf.type === 'fluid' && v.cargo !== 'liquid') issues.push(tr('Wagen an Position {n} (Feststoff) steht an einem Flüssigkeitsbahnsteig.', { n: nr }));
    else if (pf.type !== 'fluid' && v.cargo === 'liquid') issues.push(tr('Wagen an Position {n} (Flüssigkeit) steht an einem Güterbahnsteig.', { n: nr }));
  });
  return issues;
}

/**
 * Kreuzungen zwischen verschiedenen Schienennetzen auf gleicher Höhe. Im Spiel
 * gibt es keine getrennten Netze: Solche Gleise bilden einen gemeinsamen Block.
 */
export function checkCrossNetwork(p: Project): Finding[] {
  const out: Finding[] = [];
  const segs = Object.values(p.railSegments);
  if (Object.keys(p.railNetworks).length < 2) return out;
  for (const c of findCrossings(p, segs)) {
    const a = p.railSegments[c.segA]!;
    const b = p.railSegments[c.segB]!;
    if (a.networkId === b.networkId || Math.abs(c.zA - c.zB) >= CROSSING_HEIGHT_TOLERANCE_M) continue;
    const na = p.railNetworks[a.networkId]?.name ?? '?';
    const nb = p.railNetworks[b.networkId]?.name ?? '?';
    out.push(
      makeFinding(RAIL_CROSSING_BLOCK, [{ table: 'railSegments', id: a.id }, { table: 'railSegments', id: b.id }], {
        message: tr('Netze „{a}“ und „{b}“ kreuzen sich auf gleicher Höhe', { a: na, b: nb }),
        explanation: tr(
          'Im Planer sind es getrennte Netze. Im Spiel bilden kreuzende Gleise auf gleicher Höhe aber einen gemeinsamen Block, und die Netze beeinflussen sich gegenseitig.',
        ),
        suggestion: tr('Ein Netz höhenversetzt führen oder beide Netze zusammenführen und die Kreuzung mit Signalen absichern.'),
      }, { severity: 'warning', location: { x: c.point.x, y: c.point.y, networkId: a.networkId } }),
    );
  }
  return out;
}
