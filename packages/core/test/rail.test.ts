import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import * as rail from '../src/project/ops/rail.ts';
import { checkCrossNetwork, checkNetwork, wagonPlatformIssues } from '../src/rail/checks.ts';
import { segmentLength, segmentMinRadius, segmentShape, pointOnSegment } from '../src/rail/geometry.ts';
import { analyzeBlocks, buildGraph, findRoute, nextStates, passable } from '../src/rail/topology.ts';
import { createValidator } from '../src/validation/engine.ts';
import type { Project } from '../src/model/schema.ts';
import { gameData, newProject } from './helpers.ts';

const gd = gameData();
const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const pt = (x: number, y: number, z = 0) => ({ kind: 'point' as const, position: { x, y, z } });
const node = (nodeId: string) => ({ kind: 'node' as const, nodeId });

/**
 * Rundkurs im Uhrzeigersinn (y nach unten):
 *   S1 (0,0)→(32,0) Richtung Ost → Bogen nach X (60,28) → Bogen nach Y (32,56)
 *   → S2 von Y nach Westen (32,56)→(0,56) → Bogen nach W (−28,28) → Bogen zurück zu S1.
 * Mit `s2Reversed` zeigt S2 nach Osten (Züge im Uhrzeigersinn kommen von der falschen Seite).
 */
function loop(opts: { s2Reversed?: boolean } = {}) {
  const p = newProject();
  const net = rail.addNetwork(p, 'Netz');
  const s1 = rail.addStation(p, { networkId: net, name: 'S1', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: [{ type: 'freight', mode: 'load', flipped: false }] });
  const S1 = p.stations[s1]!;
  const x = rail.addTrack(p, net, node(S1.frontNodeId), pt(60, 28)).toNodeId;
  let s2: string;
  let w: string;
  if (!opts.s2Reversed) {
    const y = rail.addTrack(p, net, node(x), pt(32, 56)).toNodeId;
    s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: y, platforms: [{ type: 'freight', mode: 'unload', flipped: false }] });
    w = rail.addTrack(p, net, node(p.stations[s2]!.frontNodeId), pt(-28, 28)).toNodeId;
  } else {
    s2 = rail.addStation(p, { networkId: net, name: 'S2', position: { x: 0, y: 56, z: 0 }, headingDeg: 0, platforms: [{ type: 'freight', mode: 'unload', flipped: false }] });
    rail.addTrack(p, net, node(x), node(p.stations[s2]!.frontNodeId));
    w = rail.addTrack(p, net, node(p.stations[s2]!.backNodeId), pt(-28, 28)).toNodeId;
  }
  rail.addTrack(p, net, node(w), node(S1.backNodeId));
  return { p, net, s1, s2, x, w };
}

function withTrain(p: Project, net: string, stations: string[], bidirectional = false, wagons = 1) {
  const tt = rail.addTimetable(p, net, 'Fahrplan', stations);
  const consist = [
    { kind: 'locomotive' as const, reversed: false },
    ...Array.from({ length: wagons }, () => ({ kind: 'wagon' as const, cargo: 'solid' as const })),
    ...(bidirectional ? [{ kind: 'locomotive' as const, reversed: true }] : []),
  ];
  const t = rail.addTrain(p, net, 'Zug 1', consist);
  rail.updateTrain(p, t, { timetableId: tt });
  return t;
}

describe('Gleisgeometrie', () => {
  it('Bogen vom Knoten zum Punkt ist tangential und hat den erwarteten Radius', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const b = rail.addTrack(p, net, node(a.toNodeId), pt(57, 17));
    expect(p.railNodes[b.toNodeId]!.headingDeg).toBeCloseTo(90);
    const shape = segmentShape(p, p.railSegments[b.segmentId]!)!;
    // Kubische Bezierkurve nähert den Kreisbogen an (Krümmungsabweichung < 1 %)
    expect(segmentMinRadius(shape)).toBeGreaterThan(16.8);
    expect(segmentMinRadius(shape)).toBeLessThan(17.2);
    expect(ids(checkNetwork(p, gd, net))).not.toContain('RAIL-012');
    expect(segmentLength(shape)).toBeCloseTo((Math.PI / 2) * 17, 0);
  });

  it('Teilen eines Segments erhält die Kurvenform', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const b = rail.addTrack(p, net, node(a.toNodeId), pt(80, 40, 4));
    const before = segmentShape(p, p.railSegments[b.segmentId]!)!;
    const mid = pointOnSegment(before, 0.4);
    const len = segmentLength(before);
    const n = rail.splitSegment(p, b.segmentId, 0.4);
    expect(p.railNodes[n]!.position.x).toBeCloseTo(mid.x);
    expect(p.railNodes[n]!.position.y).toBeCloseTo(mid.y);
    expect(p.railNodes[n]!.position.z).toBeCloseTo(1.6);
    const parts = Object.values(p.railSegments).filter((s) => s.a.nodeId === n || s.b.nodeId === n);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((s, x) => s + segmentLength(segmentShape(p, x)!), 0);
    expect(total).toBeCloseTo(len, 1);
  });

  it('Bahnhofslänge folgt der Bahnsteigzahl (16 m je Einheit)', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const s = rail.addStation(p, { networkId: net, name: 'A', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: [{ type: 'freight', mode: 'load', flipped: false }, { type: 'freight', mode: 'load', flipped: false }] });
    const len = () => segmentLength(segmentShape(p, p.railSegments[p.stations[s]!.segmentId]!)!);
    expect(len()).toBeCloseTo(48);
    rail.setPlatforms(p, s, [...p.stations[s]!.platforms, { type: 'fluid', mode: 'unload', flipped: false }]);
    expect(len()).toBeCloseTo(64);
  });
});

describe('Topologie', () => {
  it('Weiche: von der Stammseite in beide Äste, nicht von Ast zu Ast', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const stem = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const n = stem.toNodeId;
    const straight = rail.addTrack(p, net, node(n), pt(80, 0));
    const branch = rail.addTrack(p, net, node(n), pt(70, 30));
    const g = buildGraph(p, net);
    const fromStem = nextStates(g, { segId: stem.segmentId, dir: 'ab' }).map((s) => s.segId).sort();
    expect(fromStem).toEqual([straight.segmentId, branch.segmentId].sort());
    const fromBranch = nextStates(g, { segId: branch.segmentId, dir: 'ba' }).map((s) => s.segId);
    expect(fromBranch).toEqual([stem.segmentId]);
  });

  it('Signalrückseite sperrt die Gegenrichtung, Signalpaar erlaubt beide', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    rail.addTrack(p, net, node(a.toNodeId), pt(80, 0));
    const m = a.toNodeId;
    rail.addSignal(p, m, 'block', 'forward');
    let g = buildGraph(p, net);
    expect(passable(g, m, 'A')).toBe(true);
    expect(passable(g, m, 'B')).toBe(false);
    rail.addSignal(p, m, 'block', 'backward');
    g = buildGraph(p, net);
    expect(passable(g, m, 'B')).toBe(true);
    expect(() => rail.addSignal(p, m, 'path', 'forward')).toThrow(/bereits ein Signal/);
  });

  it('Blockbildung: Signale teilen, Weichenäste bleiben zusammen', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const stem = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const s1 = rail.addTrack(p, net, node(stem.toNodeId), pt(80, 0));
    const s2 = rail.addTrack(p, net, node(stem.toNodeId), pt(70, 30));
    let b = analyzeBlocks(p, buildGraph(p, net));
    expect(b.blocks.size).toBe(1);
    rail.addSignal(p, stem.toNodeId, 'path', 'forward');
    b = analyzeBlocks(p, buildGraph(p, net));
    expect(b.blocks.size).toBe(2);
    expect(b.blockOf.get(s1.segmentId)).toBe(b.blockOf.get(s2.segmentId));
    expect(b.blockOf.get(stem.segmentId)).not.toBe(b.blockOf.get(s1.segmentId));
  });

  it('Kreuzung auf gleicher Höhe verbindet Blöcke, höhenversetzt nicht', () => {
    for (const [z, expectShared] of [[0, true], [6, false]] as const) {
      const p = newProject();
      const net = rail.addNetwork(p, 'N');
      const h = rail.addTrack(p, net, pt(-40, 0), pt(40, 0));
      const v = rail.addTrack(p, net, pt(0, -40, z), pt(0, 40, z));
      const b = analyzeBlocks(p, buildGraph(p, net));
      expect(b.crossings).toHaveLength(1);
      expect(b.blockOf.get(h.segmentId) === b.blockOf.get(v.segmentId)).toBe(expectShared);
      expect(ids(checkNetwork(p, gd, net)).includes('RAIL-009')).toBe(expectShared);
    }
  });
});

describe('Erreichbarkeit (RAIL-007)', () => {
  it('Rundkurs: beide Bahnhöfe in Fahrtrichtung erreichbar', () => {
    const { p, net, s1, s2 } = loop();
    withTrain(p, net, [s1, s2]);
    const g = buildGraph(p, net);
    expect(findRoute(p, g, { fromStationId: s1, toStationId: s2, bidirectional: false })).not.toBeNull();
    expect(findRoute(p, g, { fromStationId: s2, toStationId: s1, bidirectional: false })).not.toBeNull();
    expect(ids(checkNetwork(p, gd, net))).not.toContain('RAIL-007');
  });

  it('Bahnhof in Gegenrichtung: Einrichtungszug scheitert mit Ursache, Zweirichtungszug nicht', () => {
    const { p, net, s1, s2 } = loop({ s2Reversed: true });
    const t = withTrain(p, net, [s1, s2]);
    const f = checkNetwork(p, gd, net).find((x) => x.ruleId === 'RAIL-007');
    expect(f).toBeDefined();
    expect(f!.explanation).toMatch(/falschen Richtung/);
    expect(f!.severity).toBe('error');
    rail.updateTrain(p, t, { consist: [...p.trains[t]!.consist, { kind: 'locomotive', reversed: true }] });
    expect(ids(checkNetwork(p, gd, net))).not.toContain('RAIL-007');
  });

  it('Einzelnes Signal entgegen der Fahrtrichtung macht das Ziel unerreichbar', () => {
    const { p, net, s1, s2, x } = loop();
    withTrain(p, net, [s1, s2]);
    rail.addSignal(p, x, 'block', 'backward');
    const f = checkNetwork(p, gd, net).find((r) => r.ruleId === 'RAIL-007');
    expect(f?.explanation).toMatch(/Rückseite eines Signals/);
  });
});

describe('Signalregeln', () => {
  it('RAIL-001: Signal am Gleisende', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    rail.addSignal(p, a.toNodeId, 'block', 'forward');
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-001');
  });

  it('RAIL-002: Block ohne Ausfahrsignal; Rundkurs mit zwei Signalen ist fehlerfrei', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    rail.addTrack(p, net, node(a.toNodeId), pt(80, 0));
    rail.addSignal(p, a.toNodeId, 'block', 'forward');
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-002');

    const l = loop();
    rail.addSignal(l.p, l.x, 'block', 'forward');
    rail.addSignal(l.p, l.w, 'block', 'forward');
    const errors = checkNetwork(l.p, gd, l.net).filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('RAIL-005: einzelnes Signal im Rundkurs teilt den Block nicht', () => {
    const { p, net, x } = loop();
    rail.addSignal(p, x, 'block', 'forward');
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-005');
  });

  it('RAIL-003 und RAIL-010: Einfahrtypen an einer Zusammenführung', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    // zwei Zuläufe (a, b) münden in Knoten m, dahinter Strecke mit Ausfahrsignal
    const out = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const m = out.fromNodeId;
    const end = rail.addTrack(p, net, node(out.toNodeId), pt(80, 0));
    rail.addTrack(p, net, node(end.toNodeId), pt(120, 0));
    const inA = rail.addTrack(p, net, pt(-40, 0), node(m));
    const inB = rail.addTrack(p, net, pt(-35, 25), node(m));
    // Signale an den Zulaufenden (vor der Zusammenführung): neue Knoten mit Vorlauf
    const preA = rail.addTrack(p, net, pt(-80, 0), node(inA.fromNodeId));
    const preB = rail.addTrack(p, net, pt(-70, 50), node(inB.fromNodeId));
    void preA;
    void preB;
    rail.addSignal(p, inA.fromNodeId, 'block', p.railSegments[inA.segmentId]!.a.side === 'B' ? 'forward' : 'backward');
    const sigB = rail.addSignal(p, inB.fromNodeId, 'path', p.railSegments[inB.segmentId]!.a.side === 'B' ? 'forward' : 'backward');
    rail.addSignal(p, end.toNodeId, 'block', 'forward');
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-003');
    rail.updateSignal(p, sigB, { kind: 'block' });
    const f = ids(checkNetwork(p, gd, net));
    expect(f).not.toContain('RAIL-003');
    expect(f).toContain('RAIL-010');
  });

  it('RAIL-004: Bahnhof im Pfadblock', () => {
    const { p, net, x, w } = loop();
    rail.addSignal(p, x, 'path', 'forward');
    rail.addSignal(p, w, 'path', 'forward');
    expect(checkNetwork(p, gd, net).filter((f) => f.ruleId === 'RAIL-004')).toHaveLength(2);
  });

  it('RAIL-011: Pfadblock mit Höhenunterschied', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const b = rail.addTrack(p, net, node(a.toNodeId), pt(80, 0, 4));
    rail.addTrack(p, net, node(b.toNodeId), pt(120, 0, 4));
    rail.addSignal(p, a.toNodeId, 'path', 'forward');
    rail.addSignal(p, b.toNodeId, 'block', 'forward');
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-011');
  });

  it('RAIL-012/013: zu enge Kurve und zu kurzes Segment', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    rail.addTrack(p, net, node(a.toNodeId), pt(48, 8));
    rail.addTrack(p, net, pt(0, 50), pt(5, 50));
    const f = ids(checkNetwork(p, gd, net));
    expect(f).toContain('RAIL-012');
    expect(f).toContain('RAIL-013');
  });

  it('RAIL-014 bzw. RAIL-024: mehrere Züge mit/ohne Signale', () => {
    const { p, net, s1, s2, x, w } = loop();
    withTrain(p, net, [s1, s2]);
    withTrain(p, net, [s2, s1]);
    expect(ids(checkNetwork(p, gd, net))).toContain('RAIL-014');
    rail.addSignal(p, x, 'block', 'forward');
    rail.addSignal(p, w, 'block', 'forward');
    const f = checkNetwork(p, gd, net);
    expect(ids(f)).not.toContain('RAIL-014');
    const dl = f.find((x) => x.ruleId === 'RAIL-024')!;
    expect(dl.certainty).toBe('dynamic');
    expect(dl.kind).toBe('unchecked');
  });
});

describe('Längenabhängige Hinweise (möglich, nicht nachgewiesen)', () => {
  it('RAIL-020: Block hinter Pfadausfahrt kürzer als der Zug', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const a = rail.addTrack(p, net, pt(0, 0), pt(40, 0));
    const b = rail.addTrack(p, net, node(a.toNodeId), pt(70, 0));
    const c = rail.addTrack(p, net, node(b.toNodeId), pt(100, 0));
    rail.addTrack(p, net, node(c.toNodeId), pt(200, 0));
    rail.addSignal(p, a.toNodeId, 'path', 'forward');
    rail.addSignal(p, b.toNodeId, 'block', 'forward');
    rail.addSignal(p, c.toNodeId, 'block', 'forward');
    rail.addTrain(p, net, 'Lang', [{ kind: 'locomotive', reversed: false }, { kind: 'wagon', cargo: 'solid' }, { kind: 'wagon', cargo: 'solid' }]);
    const f = checkNetwork(p, gd, net).find((x) => x.ruleId === 'RAIL-020')!;
    expect(f).toBeDefined();
    expect(f.certainty).toBe('dynamic');
  });

  it('RAIL-021/022: Zuglänge und Wagen-Bahnsteig-Zuordnung', () => {
    const { p, net, s1, s2 } = loop();
    withTrain(p, net, [s1, s2], false, 3);
    const f = ids(checkNetwork(p, gd, net));
    expect(f).toContain('RAIL-021');
    expect(f).toContain('RAIL-022');
    const st = p.stations[s1]!;
    const issues = wagonPlatformIssues(
      { ...Object.values(p.trains)[0]!, consist: [{ kind: 'locomotive', reversed: false }, { kind: 'wagon', cargo: 'liquid' }] },
      st,
    );
    expect(issues[0]).toMatch(/Flüssigkeit/);
  });

  it('RAIL-023: Zweirichtungszug im Netz mit Wendeschleife', () => {
    // Rundkurs ohne Wendemöglichkeit: kein Befund
    const l = loop();
    withTrain(l.p, l.net, [l.s1, l.s2], true);
    expect(ids(checkNetwork(l.p, gd, l.net))).not.toContain('RAIL-023');
    // Strecke mit Wendeschleife (Ballonschleife) am Ende
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const line = rail.addTrack(p, net, pt(0, 0), pt(60, 0));
    const b = line.toNodeId;
    const p1 = rail.addTrack(p, net, node(b), pt(110, 40)).toNodeId;
    const p2 = rail.addTrack(p, net, node(p1), pt(60, 90)).toNodeId;
    rail.addTrack(p, net, node(p2), node(b));
    rail.addTrain(p, net, 'Pendel', [{ kind: 'locomotive', reversed: false }, { kind: 'locomotive', reversed: true }]);
    const f = checkNetwork(p, gd, net).find((x) => x.ruleId === 'RAIL-023');
    expect(f?.certainty).toBe('dynamic');
  });
});

describe('Netze und inkrementelle Prüfung', () => {
  it('Netze zusammenführen; Kreuzung zwischen Netzen wird gemeldet', () => {
    const p = newProject();
    const a = rail.addNetwork(p, 'A');
    const b = rail.addNetwork(p, 'B');
    rail.addTrack(p, a, pt(-40, 0), pt(40, 0));
    rail.addTrack(p, b, pt(0, -40), pt(0, 40));
    expect(checkCrossNetwork(p)).toHaveLength(1);
    rail.mergeNetworks(p, a, b);
    expect(p.railNetworks[b]).toBeUndefined();
    expect(Object.values(p.railSegments).every((s) => s.networkId === a)).toBe(true);
    expect(ids(checkNetwork(p, gd, a))).toContain('RAIL-009');
  });

  it('nur das geänderte Netz wird neu geprüft', () => {
    let p = newProject();
    let a = '';
    let b = '';
    p = produce(p, (d) => {
      a = rail.addNetwork(d, 'A');
      b = rail.addNetwork(d, 'B');
      rail.addTrack(d, a, pt(0, 0), pt(40, 0));
      rail.addTrack(d, b, pt(0, 100), pt(40, 100));
    });
    const validate = createValidator();
    validate(p, gd);
    p = produce(p, (d) => {
      rail.addTrack(d, a, pt(0, 20), pt(40, 20));
    });
    const r = validate(p, gd);
    expect(r.recomputed).toContain(`rail:${a}`);
    expect(r.recomputed).not.toContain(`rail:${b}`);
  });

  it('Netz löschen entfernt Objekte und Verweise', () => {
    const { p, net, s1, s2 } = loop();
    withTrain(p, net, [s1, s2]);
    rail.removeNetwork(p, net);
    for (const t of ['railNodes', 'railSegments', 'stations', 'trains', 'timetables'] as const) expect(Object.keys(p[t])).toHaveLength(0);
  });

  it('Bahnhof löschen entfernt Halte und verwaiste Knoten', () => {
    const p = newProject();
    const net = rail.addNetwork(p, 'N');
    const s = rail.addStation(p, { networkId: net, name: 'A', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: [] });
    const tt = rail.addTimetable(p, net, 'T', [s]);
    rail.removeStation(p, s);
    expect(p.timetables[tt]!.stops).toHaveLength(0);
    expect(Object.keys(p.railNodes)).toHaveLength(0);
  });
});
