/**
 * Operationen auf Schienennetzen: Netze, Knoten, Segmente, Signale, Bahnhöfe,
 * Züge und Fahrpläne.
 */
import { add, dirFromDeg, dist, dot, length, normalize, rotate, scale, sub, type Vec2 } from '../../geometry/index.ts';
import { tr } from '../../i18n/index.ts';
import { newId } from '../../model/ids.ts';
import type {
  NodeSide,
  Platform,
  Project,
  RailNode,
  RailSegment,
  SegmentEnd,
  SignalKind,
  Station,
  Timetable,
  TimetableStop,
  Train,
  Vec3,
  Vehicle,
} from '../../model/schema.ts';
import { arcEndDirection, otherSide, outward, segmentShape, splitBezier } from '../../rail/geometry.ts';
import { OpError } from '../errors.ts';

const NETWORK_COLORS = ['#e8a33d', '#4fc3ff', '#9be7a1', '#ff8a8a', '#c49bff', '#ffe08a'];
/** Länge eines Bahnsteigs bzw. des Bahnhofsgebäudes entlang des Gleises (Wiki: Wagenlänge 16 m). */
export const PLATFORM_LENGTH_M = 16;

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new OpError(tr('{what} nicht gefunden.', { what }));
  return v;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** Rundet auf 0,1 mm, damit Gleitkommarauschen (z. B. sin 180°) nicht in Koordinaten landet. */
const roundPos = (p: Vec3): Vec3 => ({ x: r4(p.x), y: r4(p.y), z: r4(p.z) });
const headingOf = (d: Vec2) => r4((Math.atan2(d.y, d.x) * 180) / Math.PI);

// ---------------------------------------------------------------------------
// Netze
// ---------------------------------------------------------------------------

export function addNetwork(p: Project, name: string): string {
  const id = newId('railNetwork');
  p.railNetworks[id] = { id, name, color: NETWORK_COLORS[Object.keys(p.railNetworks).length % NETWORK_COLORS.length]!, notes: '' };
  return id;
}

export function updateNetwork(p: Project, id: string, patch: { name?: string; color?: string; notes?: string }): void {
  Object.assign(must(p.railNetworks[id], tr('Schienennetz')), patch);
}

export function removeNetwork(p: Project, id: string): void {
  must(p.railNetworks[id], tr('Schienennetz'));
  const stations = new Set(Object.values(p.stations).filter((s) => s.networkId === id).map((s) => s.id));
  const trains = new Set(Object.values(p.trains).filter((t) => t.networkId === id).map((t) => t.id));
  for (const t of ['railNodes', 'railSegments', 'railSignals', 'stations', 'trains', 'timetables'] as const) {
    const table = p[t] as Record<string, { networkId: string }>;
    for (const [k, v] of Object.entries(table)) if (v.networkId === id) delete table[k];
  }
  for (const o of Object.values(p.transportOrders)) {
    if (o.fromStationId && stations.has(o.fromStationId)) o.fromStationId = null;
    if (o.toStationId && stations.has(o.toStationId)) o.toStationId = null;
    o.trainIds = o.trainIds.filter((t) => !trains.has(t));
  }
  delete p.railNetworks[id];
}

/** Führt Netz `sourceId` in `targetId` zusammen (alle Objekte wechseln das Netz). */
export function mergeNetworks(p: Project, targetId: string, sourceId: string): void {
  must(p.railNetworks[targetId], tr('Zielnetz'));
  must(p.railNetworks[sourceId], tr('Quellnetz'));
  if (targetId === sourceId) throw new OpError(tr('Ein Netz kann nicht mit sich selbst zusammengeführt werden.'));
  for (const t of ['railNodes', 'railSegments', 'railSignals', 'stations', 'trains', 'timetables'] as const) {
    for (const v of Object.values(p[t] as Record<string, { networkId: string }>)) if (v.networkId === sourceId) v.networkId = targetId;
  }
  delete p.railNetworks[sourceId];
}

// ---------------------------------------------------------------------------
// Knoten und Segmente
// ---------------------------------------------------------------------------

export function addNode(p: Project, networkId: string, position: Vec3, headingDeg: number): string {
  must(p.railNetworks[networkId], tr('Schienennetz'));
  const id = newId('railNode');
  p.railNodes[id] = { id, networkId, position: roundPos(position), headingDeg: r4(headingDeg) };
  return id;
}

function segmentsAt(p: Project, nodeId: string): { seg: RailSegment; end: 'a' | 'b' }[] {
  const out: { seg: RailSegment; end: 'a' | 'b' }[] = [];
  for (const s of Object.values(p.railSegments)) {
    if (s.a.nodeId === nodeId) out.push({ seg: s, end: 'a' });
    if (s.b.nodeId === nodeId) out.push({ seg: s, end: 'b' });
  }
  return out;
}

export function addSegment(p: Project, networkId: string, a: SegmentEnd, b: SegmentEnd): string {
  const na = must(p.railNodes[a.nodeId], tr('Knoten'));
  const nb = must(p.railNodes[b.nodeId], tr('Knoten'));
  if (na.networkId !== networkId || nb.networkId !== networkId) throw new OpError(tr('Beide Knoten müssen im selben Schienennetz liegen.'));
  if (a.nodeId === b.nodeId) throw new OpError(tr('Ein Segment braucht zwei verschiedene Knoten.'));
  const dup = Object.values(p.railSegments).some(
    (s) =>
      (s.a.nodeId === a.nodeId && s.a.side === a.side && s.b.nodeId === b.nodeId && s.b.side === b.side) ||
      (s.a.nodeId === b.nodeId && s.a.side === b.side && s.b.nodeId === a.nodeId && s.b.side === a.side),
  );
  if (dup) throw new OpError(tr('Diese Gleisverbindung existiert bereits.'));
  const id = newId('railSegment');
  p.railSegments[id] = { id, networkId, a: { ...a }, b: { ...b }, handleA: null, handleB: null, stationId: null, intendedDirection: 'both' };
  return id;
}

export type TrackEndpoint = { kind: 'node'; nodeId: string; side?: NodeSide } | { kind: 'point'; position: Vec3 };

/** Seite eines Knotens, deren Austrittsrichtung am besten zum Zielpunkt zeigt. */
export function sideTowards(node: RailNode, target: Vec2): NodeSide {
  const d = sub(target, node.position);
  return dot(outward(node, 'B'), d) >= 0 ? 'B' : 'A';
}

/**
 * Zeichnet ein Gleissegment zwischen zwei Endpunkten. Neue Knoten erhalten
 * eine Achse, die einen tangentialen Kreisbogen ergibt; zwischen zwei neuen
 * Punkten entsteht eine Gerade.
 */
export function addTrack(
  p: Project,
  networkId: string,
  from: TrackEndpoint,
  to: TrackEndpoint,
): { segmentId: string; fromNodeId: string; toNodeId: string } {
  must(p.railNetworks[networkId], tr('Schienennetz'));
  const posOf = (e: TrackEndpoint): Vec3 => (e.kind === 'node' ? must(p.railNodes[e.nodeId], tr('Knoten')).position : e.position);
  const P0 = posOf(from);
  const P3 = posOf(to);
  if (dist(P0, P3) < 0.5) throw new OpError(tr('Start- und Endpunkt liegen zu nah beieinander.'));
  let fromNodeId: string;
  let fromSide: NodeSide;
  let toNodeId: string;
  let toSide: NodeSide;

  if (from.kind === 'node') {
    const n = p.railNodes[from.nodeId]!;
    if (n.networkId !== networkId) throw new OpError(tr('Der Startknoten gehört zu einem anderen Schienennetz.'));
    fromNodeId = n.id;
    fromSide = from.side ?? sideTowards(n, P3);
  } else {
    fromNodeId = '';
    fromSide = 'B';
  }
  if (to.kind === 'node') {
    const n = p.railNodes[to.nodeId]!;
    if (n.networkId !== networkId) throw new OpError(tr('Der Endknoten gehört zu einem anderen Schienennetz.'));
    toNodeId = n.id;
    toSide = to.side ?? sideTowards(n, P0);
  } else {
    toNodeId = '';
    toSide = 'A';
  }

  if (from.kind === 'point' && to.kind === 'point') {
    const h = headingOf(sub(P3, P0));
    fromNodeId = addNode(p, networkId, P0, h);
    toNodeId = addNode(p, networkId, P3, h);
  } else if (from.kind === 'node' && to.kind === 'point') {
    const t0 = outward(p.railNodes[fromNodeId]!, fromSide);
    const t3 = arcEndDirection(P0, t0, P3);
    toNodeId = addNode(p, networkId, P3, headingOf(t3));
    toSide = 'A';
  } else if (from.kind === 'point' && to.kind === 'node') {
    // Rückwärts betrachtet: Bogen vom Zielknoten zum Startpunkt
    const t3 = outward(p.railNodes[toNodeId]!, toSide);
    const back = arcEndDirection(P3, t3, P0);
    fromNodeId = addNode(p, networkId, P0, headingOf(scale(back, -1)));
    fromSide = 'B';
  }
  const segmentId = addSegment(p, networkId, { nodeId: fromNodeId, side: fromSide }, { nodeId: toNodeId, side: toSide });
  return { segmentId, fromNodeId, toNodeId };
}

/** Teilt ein Segment bei Parameter t und liefert den neuen Knoten. */
export function splitSegment(p: Project, segmentId: string, t: number): string {
  const seg = must(p.railSegments[segmentId], tr('Gleissegment'));
  if (seg.stationId) throw new OpError(tr('Bahnhofsgleise können nicht geteilt werden.'));
  if (t <= 0.02 || t >= 0.98) throw new OpError(tr('Zu nah am Segmentende – stattdessen den Knoten verwenden.'));
  const shape = must(segmentShape(p, seg) ?? undefined, tr('Segmentgeometrie'));
  const [left, right] = splitBezier(shape.curve, t);
  const m = left.p3;
  let tangent = normalize(sub(right.p1, m));
  if (length(tangent) === 0) tangent = normalize(sub(m, left.p2));
  const z = shape.z0 + (shape.z1 - shape.z0) * t;
  const nodeId = addNode(p, seg.networkId, { x: m.x, y: m.y, z }, headingOf(tangent));
  const leftId = newId('railSegment');
  const rightId = newId('railSegment');
  p.railSegments[leftId] = {
    ...seg,
    id: leftId,
    b: { nodeId, side: 'A' },
    handleA: dist(left.p0, left.p1),
    handleB: dist(left.p3, left.p2),
  };
  p.railSegments[rightId] = {
    ...seg,
    id: rightId,
    a: { nodeId, side: 'B' },
    handleA: dist(right.p0, right.p1),
    handleB: dist(right.p3, right.p2),
  };
  delete p.railSegments[segmentId];
  return nodeId;
}

export function updateSegment(p: Project, id: string, patch: Partial<Pick<RailSegment, 'handleA' | 'handleB' | 'intendedDirection'>>): void {
  Object.assign(must(p.railSegments[id], tr('Gleissegment')), patch);
}

export function moveNodes(p: Project, ids: string[], delta: Vec3): void {
  for (const id of ids) {
    const n = must(p.railNodes[id], tr('Knoten'));
    n.position = roundPos({ x: n.position.x + delta.x, y: n.position.y + delta.y, z: n.position.z + delta.z });
  }
}

export function updateNode(p: Project, id: string, patch: { position?: Vec3; headingDeg?: number }): void {
  const n = must(p.railNodes[id], tr('Knoten'));
  if (patch.headingDeg !== undefined && Object.values(p.stations).some((s) => s.backNodeId === id || s.frontNodeId === id))
    throw new OpError(tr('Die Achse von Bahnhofsknoten folgt dem Bahnhof. Bitte den Bahnhof drehen.'));
  if (patch.position) n.position = roundPos(patch.position);
  if (patch.headingDeg !== undefined) n.headingDeg = patch.headingDeg;
}

/** Kehrt die Knotenachse um (Seiten A/B tauschen, Signale behalten ihre Wirkung). */
export function flipNode(p: Project, id: string): void {
  const n = must(p.railNodes[id], tr('Knoten'));
  n.headingDeg = ((n.headingDeg + 180) % 360 + 360) % 360;
  for (const s of Object.values(p.railSegments)) {
    if (s.a.nodeId === id) s.a.side = otherSide(s.a.side);
    if (s.b.nodeId === id) s.b.side = otherSide(s.b.side);
  }
  for (const sig of Object.values(p.railSignals)) if (sig.nodeId === id) sig.facing = sig.facing === 'forward' ? 'backward' : 'forward';
}

function stationUsing(p: Project, segId: string): Station | undefined {
  return Object.values(p.stations).find((s) => s.segmentId === segId);
}

/** Entfernt Segmente; verwaiste Knoten (ohne Segment und ohne Bahnhof) und deren Signale ebenfalls. */
export function removeSegments(p: Project, ids: string[]): void {
  const touched = new Set<string>();
  for (const id of ids) {
    const s = must(p.railSegments[id], tr('Gleissegment'));
    if (stationUsing(p, id)) throw new OpError(tr('Bahnhofsgleise werden mit dem Bahnhof gelöscht.'));
    touched.add(s.a.nodeId);
    touched.add(s.b.nodeId);
    delete p.railSegments[id];
  }
  cleanupNodes(p, touched);
}

function cleanupNodes(p: Project, nodeIds: Iterable<string>): void {
  for (const nid of nodeIds) {
    if (!p.railNodes[nid]) continue;
    if (segmentsAt(p, nid).length > 0) continue;
    if (Object.values(p.stations).some((s) => s.backNodeId === nid || s.frontNodeId === nid)) continue;
    delete p.railNodes[nid];
    for (const sig of Object.values(p.railSignals)) if (sig.nodeId === nid) delete p.railSignals[sig.id];
  }
}

/** Entfernt Knoten samt angeschlossenen Segmenten (nicht für Bahnhofsknoten). */
export function removeNodes(p: Project, ids: string[]): void {
  for (const id of ids) {
    must(p.railNodes[id], tr('Knoten'));
    if (Object.values(p.stations).some((s) => s.backNodeId === id || s.frontNodeId === id))
      throw new OpError(tr('Bahnhofsknoten werden mit dem Bahnhof gelöscht.'));
  }
  const segs = new Set<string>();
  for (const id of ids) for (const { seg } of segmentsAt(p, id)) segs.add(seg.id);
  if (segs.size) removeSegments(p, [...segs]);
  for (const id of ids) {
    if (!p.railNodes[id]) continue;
    delete p.railNodes[id];
    for (const sig of Object.values(p.railSignals)) if (sig.nodeId === id) delete p.railSignals[sig.id];
  }
}

/**
 * Erzeugt ein Parallelgleis zu den gewählten Segmenten im Abstand `offsetM`
 * (positiv = rechts in Knotenachsrichtung).
 */
export function parallelTrack(p: Project, segmentIds: string[], offsetM: number): string[] {
  if (segmentIds.length === 0) return [];
  const first = must(p.railSegments[segmentIds[0]!], tr('Gleissegment'));
  const nodeMap = new Map<string, string>();
  const copyNode = (nid: string) => {
    let id = nodeMap.get(nid);
    if (id) return id;
    const n = p.railNodes[nid]!;
    const normal = rotate(dirFromDeg(n.headingDeg), 90);
    const pos = add(n.position, scale(normal, offsetM));
    id = addNode(p, n.networkId, { x: pos.x, y: pos.y, z: n.position.z }, n.headingDeg);
    nodeMap.set(nid, id);
    return id;
  };
  const created: string[] = [];
  for (const sid of segmentIds) {
    const s = must(p.railSegments[sid], tr('Gleissegment'));
    if (s.networkId !== first.networkId) throw new OpError(tr('Alle Segmente müssen im selben Netz liegen.'));
    const a = copyNode(s.a.nodeId);
    const b = copyNode(s.b.nodeId);
    const id = newId('railSegment');
    p.railSegments[id] = { ...s, id, a: { nodeId: a, side: s.a.side }, b: { nodeId: b, side: s.b.side }, handleA: null, handleB: null, stationId: null };
    created.push(id);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Signale
// ---------------------------------------------------------------------------

export function addSignal(p: Project, nodeId: string, kind: SignalKind, facing: 'forward' | 'backward'): string {
  const n = must(p.railNodes[nodeId], tr('Knoten'));
  const existing = Object.values(p.railSignals).filter((s) => s.nodeId === nodeId);
  if (existing.some((s) => s.facing === facing)) throw new OpError(tr('In dieser Richtung steht bereits ein Signal.'));
  if (existing.length >= 2) throw new OpError(tr('Höchstens zwei Signale je Gleisverbindung.'));
  const id = newId('railSignal');
  p.railSignals[id] = { id, networkId: n.networkId, nodeId, kind, facing };
  return id;
}

/**
 * Setzt ein Signal auf ein Gleissegment: Das Segment wird an der Stelle
 * geteilt (wie im Spiel, wo ein Signal das Gleis in zwei Segmente teilt).
 * `forward` gilt für Fahrt von Ende a nach Ende b des Segments.
 */
export function addSignalOnSegment(p: Project, segmentId: string, t: number, kind: SignalKind, facing: 'forward' | 'backward'): { signalId: string; nodeId: string } {
  const nodeId = splitSegment(p, segmentId, t);
  return { signalId: addSignal(p, nodeId, kind, facing), nodeId };
}

export function updateSignal(p: Project, id: string, patch: { kind?: SignalKind; facing?: 'forward' | 'backward' }): void {
  const s = must(p.railSignals[id], tr('Signal'));
  if (patch.facing && patch.facing !== s.facing && Object.values(p.railSignals).some((o) => o.id !== id && o.nodeId === s.nodeId && o.facing === patch.facing))
    throw new OpError(tr('In dieser Richtung steht bereits ein Signal.'));
  Object.assign(s, patch);
}

export function removeSignals(p: Project, ids: string[]): void {
  for (const id of ids) {
    must(p.railSignals[id], tr('Signal'));
    delete p.railSignals[id];
  }
}

// ---------------------------------------------------------------------------
// Bahnhöfe
// ---------------------------------------------------------------------------

export interface NewStation {
  networkId: string;
  name: string;
  /** Lage des Bahnhofsknotens hinten (Einfahrt). */
  position: Vec3;
  /** Fahrtrichtung beim Halten (hinten → vorn). */
  headingDeg: number;
  platforms: Omit<Platform, 'id'>[];
  /** Vorhandenen Knoten als Einfahrt verwenden (Achse wird übernommen). */
  backNodeId?: string;
  factoryId?: string | null;
}

export function addStation(p: Project, init: NewStation): string {
  must(p.railNetworks[init.networkId], tr('Schienennetz'));
  let backNodeId: string;
  let heading = init.headingDeg;
  let pos = init.position;
  let backSide: NodeSide = 'B';
  if (init.backNodeId) {
    const n = must(p.railNodes[init.backNodeId], tr('Knoten'));
    if (n.networkId !== init.networkId) throw new OpError(tr('Der Knoten gehört zu einem anderen Netz.'));
    const used = segmentsAt(p, n.id);
    const usedSides = new Set(used.map((u) => (u.end === 'a' ? u.seg.a.side : u.seg.b.side)));
    // Bahnhof an der freien Seite anschließen; Fahrtrichtung zeigt vom Knoten weg.
    backSide = usedSides.has('B') && !usedSides.has('A') ? 'A' : 'B';
    if (usedSides.has('A') && usedSides.has('B')) throw new OpError(tr('An diesem Knoten sind bereits beide Seiten belegt.'));
    const d = outward(n, backSide);
    heading = headingOf(d);
    pos = n.position;
    backNodeId = n.id;
  } else {
    backNodeId = addNode(p, init.networkId, pos, heading);
  }
  const len = PLATFORM_LENGTH_M * (1 + init.platforms.length);
  const front = add(pos, scale(dirFromDeg(heading), len));
  const back = p.railNodes[backNodeId]!;
  const frontNodeId = addNode(p, init.networkId, { x: front.x, y: front.y, z: pos.z }, back.headingDeg);
  const frontSide: NodeSide = backSide === 'B' ? 'A' : 'B';
  const stationId = newId('station');
  const segmentId = addSegment(p, init.networkId, { nodeId: backNodeId, side: backSide }, { nodeId: frontNodeId, side: frontSide });
  p.railSegments[segmentId]!.stationId = stationId;
  p.stations[stationId] = {
    id: stationId,
    networkId: init.networkId,
    name: init.name,
    factoryId: init.factoryId ?? null,
    platforms: init.platforms.map((pl) => ({ ...pl, id: newId('platform') })),
    backNodeId,
    frontNodeId,
    segmentId,
  };
  return stationId;
}

export function updateStation(p: Project, id: string, patch: { name?: string; factoryId?: string | null }): void {
  const st = must(p.stations[id], tr('Bahnhof'));
  if (patch.factoryId && !p.factories[patch.factoryId]) throw new OpError(tr('Fabrik nicht gefunden.'));
  Object.assign(st, patch);
}

/** Setzt die Bahnsteige neu; der vordere Bahnhofsknoten wandert mit. */
export function setPlatforms(p: Project, id: string, platforms: (Omit<Platform, 'id'> & { id?: string })[]): void {
  const st = must(p.stations[id], tr('Bahnhof'));
  const back = p.railNodes[st.backNodeId]!;
  const front = p.railNodes[st.frontNodeId]!;
  const dir = normalize(sub(front.position, back.position));
  const len = PLATFORM_LENGTH_M * (1 + platforms.length);
  const pos = add(back.position, scale(dir, len));
  front.position = roundPos({ x: pos.x, y: pos.y, z: front.position.z });
  st.platforms = platforms.map((pl) => ({ type: pl.type, mode: pl.mode, flipped: pl.flipped ?? false, id: pl.id ?? newId('platform') }));
}

/** Verschiebt bzw. dreht einen Bahnhof (um seinen hinteren Knoten). */
export function moveStation(p: Project, id: string, delta: Vec3, rotateDeg = 0): void {
  const st = must(p.stations[id], tr('Bahnhof'));
  const back = p.railNodes[st.backNodeId]!;
  const front = p.railNodes[st.frontNodeId]!;
  const oldBack = back.position;
  back.position = roundPos({ x: oldBack.x + delta.x, y: oldBack.y + delta.y, z: oldBack.z + delta.z });
  const rel = rotate(sub(front.position, oldBack), rotateDeg);
  const f = add(back.position, rel);
  front.position = roundPos({ x: f.x, y: f.y, z: front.position.z + delta.z });
  if (rotateDeg) {
    back.headingDeg = (((back.headingDeg + rotateDeg) % 360) + 360) % 360;
    front.headingDeg = (((front.headingDeg + rotateDeg) % 360) + 360) % 360;
  }
}

export function removeStation(p: Project, id: string): void {
  const st = must(p.stations[id], tr('Bahnhof'));
  delete p.railSegments[st.segmentId];
  delete p.stations[id];
  for (const tt of Object.values(p.timetables)) tt.stops = tt.stops.filter((s) => s.stationId !== id);
  for (const o of Object.values(p.transportOrders)) {
    if (o.fromStationId === id) o.fromStationId = null;
    if (o.toStationId === id) o.toStationId = null;
  }
  cleanupNodes(p, [st.backNodeId, st.frontNodeId]);
}

// ---------------------------------------------------------------------------
// Züge und Fahrpläne
// ---------------------------------------------------------------------------

export function addTrain(p: Project, networkId: string, name: string, consist?: Vehicle[]): string {
  must(p.railNetworks[networkId], tr('Schienennetz'));
  const id = newId('train');
  p.trains[id] = {
    id,
    networkId,
    name,
    color: '#e8a33d',
    consist: consist ?? [{ kind: 'locomotive', reversed: false }, { kind: 'wagon', cargo: 'solid' }],
    timetableId: null,
    startSegmentId: null,
  };
  return id;
}

export function updateTrain(p: Project, id: string, patch: Partial<Pick<Train, 'name' | 'color' | 'consist' | 'timetableId' | 'startSegmentId'>>): void {
  const t = must(p.trains[id], tr('Zug'));
  if (patch.consist && patch.consist.length === 0) throw new OpError(tr('Ein Zug braucht mindestens ein Fahrzeug.'));
  if (patch.consist && !patch.consist.some((v) => v.kind === 'locomotive')) throw new OpError(tr('Ein Zug braucht mindestens eine Lokomotive.'));
  if (patch.timetableId) {
    const tt = must(p.timetables[patch.timetableId], tr('Fahrplan'));
    if (tt.networkId !== t.networkId) throw new OpError(tr('Der Fahrplan gehört zu einem anderen Netz.'));
  }
  Object.assign(t, patch);
}

export function removeTrains(p: Project, ids: string[]): void {
  for (const id of ids) {
    must(p.trains[id], tr('Zug'));
    delete p.trains[id];
  }
  for (const o of Object.values(p.transportOrders)) o.trainIds = o.trainIds.filter((t) => !ids.includes(t));
}

export function addTimetable(p: Project, networkId: string, name: string, stationIds: string[] = []): string {
  must(p.railNetworks[networkId], tr('Schienennetz'));
  const id = newId('timetable');
  p.timetables[id] = {
    id,
    networkId,
    name,
    stops: stationIds.map((stationId) => ({ id: newId('stop'), stationId, waitS: 0, condition: 'none', transfer: 'all', itemIds: [] })),
  };
  return id;
}

export function updateTimetable(p: Project, id: string, patch: { name?: string; stops?: (Omit<TimetableStop, 'id'> & { id?: string })[] }): void {
  const tt: Timetable = must(p.timetables[id], tr('Fahrplan'));
  if (patch.name !== undefined) tt.name = patch.name;
  if (patch.stops) {
    for (const s of patch.stops) {
      const st = must(p.stations[s.stationId], tr('Bahnhof'));
      if (st.networkId !== tt.networkId) throw new OpError(tr('Bahnhof „{name}“ liegt in einem anderen Netz.', { name: st.name }));
    }
    tt.stops = patch.stops.map((s) => ({ ...s, id: s.id ?? newId('stop') }));
  }
}

export function removeTimetable(p: Project, id: string): void {
  must(p.timetables[id], tr('Fahrplan'));
  delete p.timetables[id];
  for (const t of Object.values(p.trains)) if (t.timetableId === id) t.timetableId = null;
}
