/**
 * Durchsatzmodell einer Fabrik: Welche Mengen fließen über die eingezeichneten
 * Förderbänder und Rohre, und wie weit können die Maschinen dadurch laufen?
 *
 * Lineares Programm je Fabrik (alle Variablen ≥ 0):
 *   f[l,i]  Fluss des Gegenstands i über Verbindung l (/min bzw. m³/min)
 *   u[m]    Auslastung der Maschine m (0 … 1, bezogen auf ihren Takt)
 *
 * Bedingungen:
 * - Maschineneingang:  Σ f[l,i] (alle Zuleitungen) = Bedarf_i · u[m]
 * - Maschinenausgang:  Σ f[l,i] (Ableitung am Anschluss) = Erzeugung_i · u[m]
 *   (Spielmechanik: Eine Maschine hält an, wenn ein Ausgang voll ist.)
 * - Splitter, Zusammenführungen, Rohrkreuzungen, Pumpen, Ventile und Lager mit
 *   Abgang: Zufluss = Abfluss je Gegenstand
 * - Kapazität: Σ_i f[l,i] ≤ Bandstufe bzw. Rohrstufe (nur im Lauf „eingezeichnet“)
 * Ziel: Summe der Auslastungen maximieren (kleine Strafe auf Fluss gegen Kreisverkehr).
 *
 * Es werden zwei Läufe gerechnet:
 * - „theoretisch“ ohne Kapazitätsgrenzen: zeigt, was die Leitungen tragen
 *   müssten, und Lücken in der Verschaltung;
 * - „eingezeichnet“ mit den Kapazitäten der gezeichneten Stufen.
 *
 * Annahmen (werden angezeigt): beste Verteilung an Splittern (im Spiel
 * gleichmäßig mit Überlauf), Filter intelligenter Splitter nicht modelliert,
 * Rohre fließen in Zeichenrichtung, Förderhöhe und Pumpen nicht berücksichtigt,
 * Kraftwerke nehmen Brennstoff ohne modellierten Verbrauch ab.
 */
import { solve, type Coefficients, type Constraint } from 'yalps';
import type { GameDataIndex, GdBuilding } from '../gamedata/index.ts';
import { getLanguage, tr } from '../i18n/index.ts';
import type { Building, LogisticsLink, Project } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { portDefs, type PortDef } from './ports.ts';

export type FlowRole =
  | 'machine'
  | 'extractor'
  | 'pass'
  | 'sink'
  | 'consumer-unmodeled'
  | 'storage-end'
  | 'platform-load'
  | 'platform-unload'
  | 'none';

export interface ItemRate {
  itemId: string;
  perMin: number;
}

export interface FlowLinkResult {
  linkId: string;
  kind: 'belt' | 'pipe';
  capacity: number;
  /** Fluss mit den eingezeichneten Kapazitäten. */
  items: ItemRate[];
  total: number;
  /** Fluss ohne Kapazitätsgrenzen (was die Leitung tragen müsste). */
  requiredItems: ItemRate[];
  required: number;
  /** Gegenstände, die hier ankommen könnten, am Ziel aber nicht verarbeitet werden. */
  rejectedItems: string[];
}

export type FlowIssue =
  | { kind: 'input-missing'; itemId: string }
  | { kind: 'input-short'; itemId: string; need: number; got: number }
  | { kind: 'output-blocked'; itemId: string; portId: string | null }
  | { kind: 'belt-limit' };

export interface FlowMachineResult {
  buildingId: string;
  role: FlowRole;
  /** Auslastung mit eingezeichneten Kapazitäten (0 … 1). */
  utilization: number;
  /** Auslastung ohne Kapazitätsgrenzen. */
  utilizationUncapped: number;
  inputs: { itemId: string; nominal: number; received: number }[];
  outputs: { itemId: string; nominal: number; removed: number; portId: string | null }[];
  issues: FlowIssue[];
}

export interface FactoryFlow {
  status: 'ok' | 'error';
  message: string;
  links: Map<string, FlowLinkResult>;
  machines: Map<string, FlowMachineResult>;
  /** Fluss in Frachtplattformen (Ausfuhr) bzw. aus ihnen (Einfuhr) je Gebäude. */
  platforms: Map<string, { mode: 'load' | 'unload'; items: ItemRate[] }>;
  assumptions: string[];
}

const EPS = 1e-6;

export function flowRole(b: Building, def: GdBuilding | undefined, gd: GameDataIndex, hasOutLinks: boolean): FlowRole {
  if (!def) return 'none';
  if (def.extractor) return b.extraction ? 'extractor' : 'none';
  if (b.recipeId && gd.recipe(b.recipeId)) return 'machine';
  if (def.freightPlatform) return b.transfer?.mode === 'load' ? 'platform-load' : 'platform-unload';
  if (def.nativeClass === 'FGBuildableResourceSink') return 'sink';
  if (def.category === 'power') return 'consumer-unmodeled';
  if (def.category === 'storage') return hasOutLinks ? 'pass' : 'storage-end';
  if (def.category === 'logistics' && def.ports) return 'pass';
  return 'none';
}

/** Ordnet die Produkte eines Rezepts den Ausgängen zu (Feststoffe → Bandausgänge, Fluide → Rohrausgänge, je in Reihenfolge). */
export function outputPortAssignment(gd: GameDataIndex, def: GdBuilding, outputs: ItemRate[]): Map<string, ItemRate> {
  const ports = portDefs(def);
  const belt = ports.filter((p) => p.kind === 'belt' && p.direction === 'out');
  const pipe = ports.filter((p) => p.kind === 'pipe' && (p.direction === 'out' || p.direction === 'any'));
  const map = new Map<string, ItemRate>();
  let bi = 0;
  let pi = 0;
  for (const o of outputs) {
    const solid = gd.item(o.itemId)?.form === 'solid';
    const port = solid ? belt[bi++] : pipe[pi++];
    if (port) map.set(port.id, o);
  }
  return map;
}

export interface FlowContext {
  /** Einfuhr je Frachtplattform (Gebäude-ID → Gegenstände mit Rate). Standard: aus den Transportaufträgen. */
  imports?: Map<string, ItemRate[]>;
}

/**
 * Einfuhr je entladender Frachtplattform aus den Transportaufträgen an die
 * Fabrik. Ein Auftrag mit Zielbahnhof verteilt sich gleichmäßig auf die
 * Plattformen dieses Bahnhofs, sonst auf alle entladenden Plattformen.
 */
export function platformImports(p: Project, factoryId: string): Map<string, ItemRate[]> {
  const platforms = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === 'unload');
  const acc = new Map<string, Map<string, number>>();
  for (const o of Object.values(p.transportOrders)) {
    if (o.toFactoryId !== factoryId || o.ratePerMin <= 0 || platforms.length === 0) continue;
    let targets = o.toStationId ? platforms.filter((b) => b.transfer?.stationId === o.toStationId) : [];
    if (targets.length === 0) targets = platforms.filter((b) => !b.transfer?.stationId);
    if (targets.length === 0) targets = platforms;
    for (const b of targets) {
      const m = acc.get(b.id) ?? new Map<string, number>();
      m.set(o.itemId, (m.get(o.itemId) ?? 0) + o.ratePerMin / targets.length);
      acc.set(b.id, m);
    }
  }
  return new Map([...acc].map(([id, m]) => [id, [...m].map(([itemId, perMin]) => ({ itemId, perMin }))]));
}

interface Node {
  b: Building;
  def: GdBuilding | undefined;
  role: FlowRole;
  ports: PortDef[];
  inLinks: LogisticsLink[];
  outLinks: LogisticsLink[];
  rates: { inputs: ItemRate[]; outputs: ItemRate[] };
  outPorts: Map<string, ItemRate>;
}

export function computeFactoryFlow(p: Project, gd: GameDataIndex, factoryId: string, ctx: FlowContext = {}): FactoryFlow {
  const assumptions = [
    tr('Splitter und Zusammenführungen verteilen bestmöglich (im Spiel: gleichmäßig, Überlauf auf freie Ausgänge).'),
    tr('Filter intelligenter und programmierbarer Splitter werden nicht berücksichtigt.'),
    tr('Rohre fließen in Zeichenrichtung; Förderhöhe, Pumpen und Druck werden nicht berechnet.'),
    tr('Kraftwerke nehmen Brennstoff ab, ihr Verbrauch ist nicht modelliert.'),
    tr('Produkte werden den Ausgängen in Rezeptreihenfolge zugeordnet (Anschlusslage schematisch).'),
  ];
  const nodes = new Map<string, Node>();
  const imports = ctx.imports ?? platformImports(p, factoryId);
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId);
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const def = gd.building(b.type);
    const outLinks = links.filter((l) => l.from.buildingId === b.id);
    const inLinks = links.filter((l) => l.to.buildingId === b.id);
    const role = flowRole(b, def, gd, outLinks.length > 0);
    const r = machineRates(gd, b);
    const rates = {
      inputs: r.inputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
      outputs: r.outputs.map((x) => ({ itemId: x.item, perMin: x.perMin })),
    };
    if (role === 'platform-unload') rates.outputs = imports.get(b.id) ?? [];
    nodes.set(b.id, {
      b,
      def,
      role,
      ports: def ? portDefs(def) : [],
      inLinks,
      outLinks,
      rates,
      outPorts: def && (role === 'machine' || role === 'extractor') ? outputPortAssignment(gd, def, rates.outputs) : new Map(),
    });
  }
  const live = links.filter((l) => nodes.has(l.from.buildingId) && nodes.has(l.to.buildingId));

  // --- Mögliche Gegenstände je Verbindung: vorwärts (Quelle) ∩ rückwärts (Abnahme) ---
  const fwd = new Map<string, Set<string>>(live.map((l) => [l.id, new Set<string>()]));
  const emit = (n: Node, l: LogisticsLink): string[] => {
    if (n.role === 'machine' || n.role === 'extractor') {
      const it = n.outPorts.get(l.from.portId);
      return it ? [it.itemId] : [];
    }
    if (n.role === 'platform-unload') return n.rates.outputs.map((x) => x.itemId);
    if (n.role === 'pass') return n.inLinks.flatMap((x) => [...(fwd.get(x.id) ?? [])]);
    return [];
  };
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (const l of live) {
      const set = fwd.get(l.id)!;
      for (const it of emit(nodes.get(l.from.buildingId)!, l)) {
        if (!set.has(it)) {
          set.add(it);
          changed = true;
        }
      }
    }
  }
  const bwd = new Map<string, Set<string> | 'all'>();
  const accepts = (n: Node): Set<string> | 'all' => {
    if (n.role === 'machine') return new Set(n.rates.inputs.map((x) => x.itemId));
    if (n.role === 'sink') return new Set(Object.values(gd.data.items).filter((i) => i.form === 'solid').map((i) => i.id));
    if (n.role === 'storage-end' || n.role === 'platform-load' || n.role === 'consumer-unmodeled') return 'all';
    if (n.role === 'pass') {
      const s = new Set<string>();
      for (const o of n.outLinks) {
        const a = bwd.get(o.id);
        if (a === 'all') return 'all';
        for (const x of a ?? []) s.add(x);
      }
      return s;
    }
    return new Set();
  };
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (const l of live) {
      const next = accepts(nodes.get(l.to.buildingId)!);
      const prev = bwd.get(l.id);
      const size = (x: Set<string> | 'all' | undefined) => (x === 'all' ? Infinity : (x?.size ?? -1));
      if (size(next) !== size(prev)) {
        bwd.set(l.id, next);
        changed = true;
      }
    }
  }
  const candidates = new Map<string, string[]>();
  const rejected = new Map<string, string[]>();
  for (const l of live) {
    const a = bwd.get(l.id) ?? new Set<string>();
    const f = [...fwd.get(l.id)!];
    candidates.set(l.id, f.filter((i) => a === 'all' || a.has(i)));
    const target = nodes.get(l.to.buildingId)!;
    // Nur am Maschineneingang ist ein „falscher“ Gegenstand eindeutig (Lager/Splitter nehmen alles an).
    rejected.set(l.id, target.role === 'machine' || target.role === 'sink' ? f.filter((i) => a !== 'all' && !a.has(i)) : []);
  }

  const capacityOf = (l: LogisticsLink) => {
    const t = gd.building(l.tier);
    return l.kind === 'belt' ? (t?.conveyor?.itemsPerMin ?? 0) : (t?.pipe?.m3PerMin ?? 0);
  };

  const run = (capped: boolean) => {
    const constraints = new Map<string, Constraint>();
    const variables = new Map<string, Coefficients>();
    const addCoef = (v: string, c: string, x: number) => {
      let m = variables.get(v) as Map<string, number> | undefined;
      if (!m) {
        m = new Map([['obj', 0]]);
        variables.set(v, m);
      }
      m.set(c, (m.get(c) ?? 0) + x);
    };
    for (const l of live) {
      const items = candidates.get(l.id)!;
      if (capped) constraints.set(`cap:${l.id}`, { max: capacityOf(l) });
      for (const i of items) {
        const v = `f:${l.id}:${i}`;
        addCoef(v, 'obj', -1e-6);
        if (capped) addCoef(v, `cap:${l.id}`, 1);
      }
    }
    for (const n of nodes.values()) {
      const id = n.b.id;
      if (n.role === 'machine' || n.role === 'extractor') {
        const u = `u:${id}`;
        addCoef(u, 'obj', 1);
        constraints.set(`umax:${id}`, { max: 1 });
        addCoef(u, `umax:${id}`, 1);
        for (const inp of n.rates.inputs) {
          const c = `in:${id}:${inp.itemId}`;
          constraints.set(c, { equal: 0 });
          addCoef(u, c, -inp.perMin);
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(inp.itemId)) addCoef(`f:${l.id}:${inp.itemId}`, c, 1);
        }
        for (const [portId, out] of n.outPorts) {
          const c = `out:${id}:${portId}`;
          constraints.set(c, { equal: 0 });
          addCoef(u, c, -out.perMin);
          for (const l of n.outLinks) if (l.from.portId === portId && candidates.get(l.id)?.includes(out.itemId)) addCoef(`f:${l.id}:${out.itemId}`, c, 1);
        }
      } else if (n.role === 'pass') {
        const items = new Set<string>();
        for (const l of [...n.inLinks, ...n.outLinks]) for (const i of candidates.get(l.id) ?? []) items.add(i);
        for (const i of items) {
          const c = `bal:${id}:${i}`;
          constraints.set(c, { equal: 0 });
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, 1);
          for (const l of n.outLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, -1);
        }
      } else if (n.role === 'platform-unload') {
        for (const out of n.rates.outputs) {
          const c = `imp:${id}:${out.itemId}`;
          constraints.set(c, { max: out.perMin });
          for (const l of n.outLinks) if (candidates.get(l.id)?.includes(out.itemId)) {
            addCoef(`f:${l.id}:${out.itemId}`, c, 1);
            // Einfuhr soll abfließen, wo sie gebraucht wird – kein eigener Nutzen, nur ermöglicht.
          }
        }
      }
    }
    const sol = solve({ direction: 'maximize', objective: 'obj', constraints, variables }, { maxPivots: 50000 });
    const val = new Map(sol.variables.map(([k, v]) => [k, Math.abs(v) < 1e-9 ? 0 : v]));
    return { status: sol.status, val };
  };

  const uncapped = run(false);
  const capped = run(true);
  if (capped.status !== 'optimal' || uncapped.status !== 'optimal') {
    return {
      status: 'error',
      message: tr('Durchsatzmodell nicht lösbar ({status}).', { status: capped.status }),
      links: new Map(),
      machines: new Map(),
      platforms: new Map(),
      assumptions,
    };
  }
  const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;

  const linkResults = new Map<string, FlowLinkResult>();
  for (const l of live) {
    const items = candidates.get(l.id)!;
    const cap = items.map((i) => ({ itemId: i, perMin: get(capped.val, `f:${l.id}:${i}`) })).filter((x) => x.perMin > EPS);
    const req = items.map((i) => ({ itemId: i, perMin: get(uncapped.val, `f:${l.id}:${i}`) })).filter((x) => x.perMin > EPS);
    linkResults.set(l.id, {
      linkId: l.id,
      kind: l.kind,
      capacity: capacityOf(l),
      items: cap,
      total: cap.reduce((s, x) => s + x.perMin, 0),
      requiredItems: req,
      required: req.reduce((s, x) => s + x.perMin, 0),
      rejectedItems: rejected.get(l.id) ?? [],
    });
  }
  for (const l of links) {
    if (linkResults.has(l.id)) continue;
    linkResults.set(l.id, { linkId: l.id, kind: l.kind, capacity: capacityOf(l), items: [], total: 0, requiredItems: [], required: 0, rejectedItems: [] });
  }

  const machines = new Map<string, FlowMachineResult>();
  const platforms = new Map<string, { mode: 'load' | 'unload'; items: ItemRate[] }>();
  for (const n of nodes.values()) {
    if (n.role === 'platform-load' || n.role === 'platform-unload') {
      const sum = new Map<string, number>();
      for (const l of n.role === 'platform-load' ? n.inLinks : n.outLinks)
        for (const x of linkResults.get(l.id)?.items ?? []) sum.set(x.itemId, (sum.get(x.itemId) ?? 0) + x.perMin);
      platforms.set(n.b.id, { mode: n.role === 'platform-load' ? 'load' : 'unload', items: [...sum].map(([itemId, perMin]) => ({ itemId, perMin })) });
    }
    if (n.role !== 'machine' && n.role !== 'extractor') continue;
    const u = get(capped.val, `u:${n.b.id}`);
    const uu = get(uncapped.val, `u:${n.b.id}`);
    const issues: FlowIssue[] = [];
    const inputs = n.rates.inputs.map((inp) => {
      const received = n.inLinks.reduce((s, l) => s + get(capped.val, `f:${l.id}:${inp.itemId}`), 0);
      const reachable = n.inLinks.some((l) => candidates.get(l.id)?.includes(inp.itemId));
      if (!reachable) issues.push({ kind: 'input-missing', itemId: inp.itemId });
      else if (uu < 1 - 1e-4) issues.push({ kind: 'input-short', itemId: inp.itemId, need: inp.perMin, got: inp.perMin * uu });
      return { itemId: inp.itemId, nominal: inp.perMin, received };
    });
    const assigned = new Set([...n.outPorts.values()].map((x) => x.itemId));
    const outputs = n.rates.outputs.map((out) => {
      const portId = [...n.outPorts].find(([, v]) => v.itemId === out.itemId)?.[0] ?? null;
      const removed = n.outLinks.filter((l) => l.from.portId === portId).reduce((s, l) => s + get(capped.val, `f:${l.id}:${out.itemId}`), 0);
      const carried = portId !== null && n.outLinks.some((l) => l.from.portId === portId && candidates.get(l.id)?.includes(out.itemId));
      if (!assigned.has(out.itemId) || !carried) issues.push({ kind: 'output-blocked', itemId: out.itemId, portId });
      return { itemId: out.itemId, nominal: out.perMin, removed, portId };
    });
    // Ohne erreichbare Quelle bzw. Abnahme ist die Unterversorgung schon erklärt.
    if (issues.some((x) => x.kind === 'input-missing' || x.kind === 'output-blocked')) {
      for (let k = issues.length - 1; k >= 0; k--) if (issues[k]!.kind === 'input-short') issues.splice(k, 1);
    }
    if (u < uu - 1e-4) issues.push({ kind: 'belt-limit' });
    machines.set(n.b.id, { buildingId: n.b.id, role: n.role, utilization: u, utilizationUncapped: uu, inputs, outputs, issues });
  }
  return { status: 'ok', message: '', links: linkResults, machines, platforms, assumptions };
}

/**
 * Zwischenspeicher je Fabrik: Das Modell wird nur neu gerechnet, wenn sich
 * Gebäude, Verbindungen, Bahnhöfe oder Transportaufträge geändert haben
 * (Identität der Objekte, Immer).
 */
const cache = new Map<string, { deps: unknown[]; gd: GameDataIndex; result: FactoryFlow; lang: string }>();

export function factoryFlowDeps(p: Project, factoryId: string): unknown[] {
  return [
    ...Object.values(p.buildings).filter((b) => b.factoryId === factoryId),
    ...Object.values(p.links).filter((l) => l.factoryId === factoryId),
    ...Object.values(p.transportOrders).filter((o) => o.toFactoryId === factoryId),
  ];
}

export function cachedFactoryFlow(p: Project, gd: GameDataIndex, factoryId: string): FactoryFlow {
  const deps = factoryFlowDeps(p, factoryId);
  const lang = getLanguage();
  const hit = cache.get(factoryId);
  if (hit && hit.gd === gd && hit.lang === lang && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.result;
  const result = computeFactoryFlow(p, gd, factoryId);
  cache.set(factoryId, { deps, gd, result, lang });
  return result;
}
