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
 * Annahmen (werden angezeigt): Splitter verteilen gleichmäßig, soweit Maschinen
 * dadurch nicht weniger bekommen, Filter und Überlauf wie im Spiel (seit 0.10.3),
 * Lager ohne Abgang gelten als voll,
 * Rohre fließen in Zeichenrichtung, Förderhöhe und Pumpen nicht berücksichtigt,
 * Kraftwerke mit Brennstoffwahl verbrauchen wie Maschinen; ohne Wahl nehmen sie
 * Brennstoff ohne modellierten Verbrauch ab.
 */
import { solve, type Coefficients, type Constraint } from 'yalps';
import type { GameDataIndex, GdBuilding } from '../gamedata/index.ts';
import { getLanguage, tr } from '../i18n/index.ts';
import type { Building, LogisticsLink, Project } from '../model/schema.ts';
import { machineRates } from '../production/machine.ts';
import { transferCargo, transferInterface } from './geometry.ts';
import { placedPortDefs, portDefs, type PortDef } from './ports.ts';

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
  /** Fluss direkter Leitungen zu/von anderen Fabriken je Transportauftrag (mit Kapazitätsgrenze). */
  direct: Map<string, { dir: 'in' | 'out'; perMin: number; required: number }>;
  /** Fluss in AWESOME-Schredder je Gebäude: gilt als Überschuss, nicht als Verbrauch. */
  sinks: Map<string, ItemRate[]>;
  assumptions: string[];
}

const EPS = 1e-6;
/** Nutzen der Gewinnung bzw. Ausfuhr je Gegenstand pro Minute (deutlich unter dem einer Maschine, über der Flussstrafe). */
const EXTRACT_GAIN = 1e-3;
/** Nutzen des kleinsten Anteils (0 … 1) der Quellen eines Netzes. */
const SPREAD_GAIN = 1e-3;
/** Abzug je Gegenstand pro Minute über einen Überlauf-Ausgang (unter dem Nutzen der Gewinnung). */
const OVERFLOW_PENALTY = 1e-4;
/** Abzug je Gegenstand pro Minute in ein Lager ohne Abgang (über dem Überlauf, unter dem Nutzen der Gewinnung). */
const STORAGE_END_PENALTY = 2e-4;
/** Nutzen je Gegenstand pro Minute des kleinsten Ausgangsflusses eines Splitters (weit unter dem einer Maschine). */
const FAIR_GAIN = 5e-5;
/** Sonderregeln der Splitterfilter (siehe `Building.sortRules`). */
const SORT_SPECIAL = new Set(['any', 'none', 'overflow', 'any-undefined']);

export function flowRole(b: Building, def: GdBuilding | undefined, gd: GameDataIndex, hasOutLinks: boolean): FlowRole {
  if (!def) return 'none';
  if (def.extractor) return b.extraction ? 'extractor' : 'none';
  if (b.recipeId && gd.recipe(b.recipeId)) return 'machine';
  if (def.freightPlatform) return b.transfer?.mode === 'load' ? 'platform-load' : 'platform-unload';
  if (transferInterface(def) && b.transfer) return b.transfer.mode === 'load' ? 'platform-load' : 'platform-unload';
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

/** Direkte Leitung eines Transportauftrags an einem Anschluss dieser Fabrik. */
interface DirectFlow {
  orderId: string;
  buildingId: string;
  portId: string;
  itemId: string;
  /** Höchstmenge: Auftragsmenge bzw. zusätzlich Leitungskapazität. */
  max: number;
  maxCapped: number;
  dir: 'in' | 'out';
}

/** Direkte Bänder/Rohre zwischen Fabriken, die an dieser Fabrik ankommen bzw. abgehen. */
function directFlows(p: Project, gd: GameDataIndex, factoryId: string): DirectFlow[] {
  const out: DirectFlow[] = [];
  for (const o of Object.values(p.transportOrders)) {
    if ((o.mode !== 'belt' && o.mode !== 'pipe') || !o.direct || o.ratePerMin <= 0) continue;
    const tier = gd.building(o.direct.tier);
    const cap = (o.mode === 'belt' ? (tier?.conveyor?.itemsPerMin ?? 0) : (tier?.pipe?.m3PerMin ?? 0)) * o.direct.lines;
    const base = { orderId: o.id, itemId: o.itemId, max: o.ratePerMin, maxCapped: Math.min(o.ratePerMin, cap) };
    if (o.toFactoryId === factoryId && o.direct.to) out.push({ ...base, ...o.direct.to, dir: 'in' });
    if (o.fromFactoryId === factoryId && o.direct.from) out.push({ ...base, ...o.direct.from, dir: 'out' });
  }
  return out;
}

export interface FlowContext {
  /** Einfuhr je Frachtplattform (Gebäude-ID → Gegenstände mit Rate). Standard: aus den Transportaufträgen. */
  imports?: Map<string, ItemRate[]>;
}

/**
 * Einfuhr je entladender Übergabe aus den Transportaufträgen an die Fabrik:
 * Zugaufträge an Frachtplattformen (mit Zielbahnhof: an dessen Plattformen,
 * sonst an alle), Fahrzeugaufträge an LKW- bzw. Tanklaster-Stationen des
 * passenden Ladeguts. Die Menge verteilt sich gleichmäßig.
 */
export function platformImports(p: Project, factoryId: string, gd?: GameDataIndex): Map<string, ItemRate[]> {
  return platformTransfers(p, factoryId, gd, 'unload');
}

/**
 * Ein- bzw. Ausfuhr je Übergabe (Frachtplattform, Lkw-Station) aus den Transportaufträgen der Fabrik:
 * `unload` = Aufträge an die Fabrik, `load` = Aufträge von ihr (beim Beladen: Obergrenze der Abnahme, Hotfix 0.10.3).
 */
function platformTransfers(p: Project, factoryId: string, gd: GameDataIndex | undefined, mode: 'load' | 'unload'): Map<string, ItemRate[]> {
  const unloading = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === mode);
  const iface = (b: Building) => (gd ? transferInterface(gd.building(b.type)) : 'train');
  const acc = new Map<string, Map<string, number>>();
  for (const o of Object.values(p.transportOrders)) {
    if ((mode === 'unload' ? o.toFactoryId : o.fromFactoryId) !== factoryId || o.ratePerMin <= 0) continue;
    if (o.mode === 'belt' || o.mode === 'pipe') continue;
    let platforms = unloading.filter((b) => iface(b) === o.mode);
    if (o.mode === 'vehicle' && gd) {
      const solid = gd.item(o.itemId)?.form === 'solid';
      platforms = platforms.filter((b) => (transferCargo(gd.building(b.type)!) === 'solid') === solid);
    }
    if (platforms.length === 0) continue;
    const stationId = mode === 'unload' ? o.toStationId : o.fromStationId;
    let targets = o.mode === 'train' && stationId ? platforms.filter((b) => b.transfer?.stationId === stationId) : [];
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
    tr('Splitter verteilen gleichmäßig auf ihre Ausgänge, soweit Maschinen dadurch nicht weniger bekommen; Überlauf-Ausgänge nur, wenn die übrigen nichts mehr abnehmen.'),
    tr('Filter intelligenter und programmierbarer Splitter wie im Spiel (aus dem Spielstand bzw. eingestellt). Lager ohne Abgang gelten als voll; beladende Stationen ohne Transportauftrag nehmen alles ab.'),
    tr('Rohre fließen in Zeichenrichtung; Förderhöhe, Pumpen und Druck werden nicht berechnet.'),
    tr('Kraftwerke mit gewähltem Brennstoff verbrauchen wie Maschinen; ohne Brennstoffwahl nehmen sie Brennstoff ohne modellierten Verbrauch ab.'),
    tr('Produkte werden den Ausgängen in Rezeptreihenfolge zugeordnet.'),
  ];
  const nodes = new Map<string, Node>();
  const imports = ctx.imports ?? platformImports(p, factoryId, gd);
  const exportsOf = platformTransfers(p, factoryId, gd, 'load');
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId);
  const direct = directFlows(p, gd, factoryId);
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
      ports: def ? placedPortDefs(def, b.placement) : [],
      inLinks,
      outLinks,
      rates,
      outPorts: def && (role === 'machine' || role === 'extractor') ? outputPortAssignment(gd, def, rates.outputs) : new Map(),
    });
  }
  // Stationen nach Bedarf: entladende Übergaben ohne Transportauftrag liefern den Bedarf der Maschinen dahinter
  if (p.settings.stationsOnDemand && !ctx.imports) {
    let onDemand = 0;
    for (const n of nodes.values()) {
      if (n.role !== 'platform-unload' || n.rates.outputs.length) continue;
      const need = new Map<string, number>();
      const seen = new Set<string>([n.b.id]);
      const queue = n.outLinks.map((l) => ({ id: l.to.buildingId, kind: l.kind }));
      // Direkte Bänder bzw. Rohre zu anderen Fabriken, die hier bzw. hinter Splittern abgehen (Hotfix 0.10.3)
      const orders = new Set<string>();
      const directNeed = (id: string, kind: 'belt' | 'pipe') => {
        for (const d of direct)
          if (d.dir === 'out' && d.buildingId === id && !orders.has(d.orderId) && ((gd.item(d.itemId)?.form ?? 'solid') === 'solid') === (kind === 'belt')) {
            orders.add(d.orderId);
            need.set(d.itemId, (need.get(d.itemId) ?? 0) + d.max);
          }
      };
      directNeed(n.b.id, 'belt');
      directNeed(n.b.id, 'pipe');
      while (queue.length) {
        const { id, kind } = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const m = nodes.get(id);
        if (!m) continue;
        if (m.role === 'machine')
          for (const x of m.rates.inputs) {
            if (((gd.item(x.itemId)?.form ?? 'solid') === 'solid') === (kind === 'belt')) need.set(x.itemId, (need.get(x.itemId) ?? 0) + x.perMin);
          }
        else if (m.role === 'pass') {
          directNeed(id, kind);
          for (const l of m.outLinks) queue.push({ id: l.to.buildingId, kind: l.kind });
        }
      }
      if (!need.size) continue;
      n.rates.outputs = [...need].map(([itemId, perMin]) => ({ itemId, perMin }));
      onDemand++;
    }
    if (onDemand) assumptions.push(tr('{n} entladende Stationen ohne Transportauftrag liefern nach Bedarf der Maschinen dahinter (Annahme, Projekteinstellung).', { n: onDemand }));
  }
  const live = links.filter((l) => nodes.has(l.from.buildingId) && nodes.has(l.to.buildingId));
  // Rohre zwischen richtungsfreien Anschlüssen (Rohrkreuzungen, Flüssigkeitspuffer) fließen wie im Spiel in
  // beide Richtungen: zusätzliche Gegenrichtung (`<id>~r`), gemeinsame Kapazität
  const twinOf = new Map<string, string>();
  const anyPort = (n: Node, portId: string) => n.ports.find((x) => x.id === portId)?.direction === 'any';
  for (const l of [...live]) {
    if (l.kind !== 'pipe') continue;
    const a = nodes.get(l.from.buildingId)!;
    const b = nodes.get(l.to.buildingId)!;
    if (a.role !== 'pass' || b.role !== 'pass' || !anyPort(a, l.from.portId) || !anyPort(b, l.to.portId)) continue;
    const r: LogisticsLink = { ...l, id: `${l.id}~r`, from: l.to, to: l.from };
    twinOf.set(r.id, l.id);
    live.push(r);
    b.outLinks.push(r);
    a.inLinks.push(r);
  }
  if (twinOf.size) assumptions.push(tr('Rohre zwischen Rohrkreuzungen bzw. Flüssigkeitspuffern fließen in beide Richtungen.'));
  const capKey = (l: LogisticsLink) => twinOf.get(l.id) ?? l.id;
  const dIn = direct.filter((d) => d.dir === 'in' && nodes.has(d.buildingId));
  const dOut = direct.filter((d) => d.dir === 'out' && nodes.has(d.buildingId));

  // --- Splitter (ein Bandeingang, mehrere Bandausgänge), Hotfix 0.10.3: Filter der Smart- und programmierbaren
  //     Splitter wie im Spiel, Überlauf erst, wenn die übrigen Ausgänge voll sind ---
  const isSplitter = (n: Node) => n.role === 'pass' && !!n.def?.ports && n.def.ports.beltIn === 1 && n.def.ports.beltOut >= 2;
  const named = new Map<string, Set<string>>();
  const namedItems = (n: Node) => {
    let s = named.get(n.b.id);
    if (!s) {
      s = new Set(Object.values(n.b.sortRules ?? {}).flat().filter((x) => !SORT_SPECIAL.has(x)));
      named.set(n.b.id, s);
    }
    return s;
  };
  const ruleOf = (n: Node, portId: string) => n.b.sortRules?.[portId] ?? ['none'];
  /** Darf `item` über den Ausgang: `yes` (Filter passt), `overflow` (nur als Überlauf), `no`. */
  const match = (n: Node, portId: string, item: string): 'yes' | 'overflow' | 'no' => {
    if (!n.b.sortRules || !isSplitter(n)) return 'yes';
    const r = ruleOf(n, portId);
    if (r.includes('any') || r.includes(item) || (r.includes('any-undefined') && !namedItems(n).has(item))) return 'yes';
    return r.includes('overflow') ? 'overflow' : 'no';
  };
  const acceptsAll = (n: Node, portId: string) => !n.b.sortRules || !isSplitter(n) || ruleOf(n, portId).some((x) => x === 'any' || x === 'overflow' || x === 'any-undefined');

  // --- Mögliche Gegenstände je Verbindung: vorwärts (Quelle) ∩ rückwärts (Abnahme) ---
  const fwd = new Map<string, Set<string>>(live.map((l) => [l.id, new Set<string>()]));
  const emit = (n: Node, l: LogisticsLink): string[] => {
    if (n.role === 'machine' || n.role === 'extractor') {
      const it = n.outPorts.get(l.from.portId);
      return it ? [it.itemId] : [];
    }
    // Stationen haben ein Inventar (Hotfix 0.10.3): Zulauf kann wie bei einem Lager wieder hinaus
    if (n.role === 'platform-unload') return [...n.rates.outputs.map((x) => x.itemId), ...n.inLinks.flatMap((x) => [...(fwd.get(x.id) ?? [])]), ...dIn.filter((d) => d.buildingId === n.b.id).map((d) => d.itemId)];
    if (n.role === 'platform-load') return n.inLinks.flatMap((x) => [...(fwd.get(x.id) ?? [])]);
    if (n.role === 'pass')
      return [...n.inLinks.flatMap((x) => [...(fwd.get(x.id) ?? [])]), ...dIn.filter((d) => d.buildingId === n.b.id).map((d) => d.itemId)].filter((it) => match(n, l.from.portId, it) !== 'no');
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
    if (n.role === 'pass' || n.role === 'platform-unload') {
      const s = new Set<string>(dOut.filter((d) => d.buildingId === n.b.id).map((d) => d.itemId));
      for (const o of n.outLinks) {
        const a = bwd.get(o.id);
        if (a === 'all') {
          if (acceptsAll(n, o.from.portId)) return 'all';
          for (const x of ruleOf(n, o.from.portId)) if (!SORT_SPECIAL.has(x)) s.add(x);
        } else for (const x of a ?? []) if (match(n, o.from.portId, x) !== 'no') s.add(x);
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

  // Gewinnung je zusammenhängendem Leitungsnetz und Gegenstand
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const q = parent.get(x) ?? x;
    if (q === x) return x;
    const r = find(q);
    parent.set(x, r);
    return r;
  };
  for (const l of live) {
    const a = find(l.from.buildingId);
    const b = find(l.to.buildingId);
    if (a !== b) parent.set(a, b);
  }
  // Quellen je Netz und Gegenstand: Gewinnung (Auslastung) und entladende Stationen (Anteil der Einfuhr)
  const sourceGroups = new Map<string, { v: string; scale: number }[]>();
  const addSource = (n: Node, item: string, v: string, scale: number) => {
    const key = `${find(n.b.id)}:${item}`;
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), { v, scale }]);
  };
  for (const n of nodes.values()) {
    if (!n.outLinks.length) continue;
    if (n.role === 'extractor' && n.rates.outputs[0]) addSource(n, n.rates.outputs[0].itemId, `u:${n.b.id}`, 1);
    if (n.role === 'platform-unload') for (const x of n.rates.outputs) if (x.perMin > EPS) addSource(n, x.itemId, `imp:${n.b.id}:${x.itemId}`, 1 / x.perMin);
  }

  // Gleichmäßig verteilende Splitter: nicht in einem Kreislauf (sonst lohnte kreisender Fluss), mindestens zwei Ausgänge mit Abnahme
  const reaches = (from: string, target: string) => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const l of nodes.get(id)?.outLinks ?? []) stack.push(l.to.buildingId);
    }
    return false;
  };
  const fair = [...nodes.values()].flatMap((n) => {
    if (!isSplitter(n) || n.outLinks.some((l) => reaches(l.to.buildingId, n.b.id))) return [];
    const outs = n.outLinks
      .map((l) => ({ l, items: (candidates.get(l.id) ?? []).filter((i) => match(n, l.from.portId, i) === 'yes') }))
      .filter((x) => x.items.length);
    return outs.length >= 2 ? [{ id: n.b.id, outs }] : [];
  });

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
      if (capped) constraints.set(`cap:${capKey(l)}`, { max: capacityOf(l) });
      const from = nodes.get(l.from.buildingId)!;
      // Lager ohne Abgang sind im Dauerbetrieb voll: sie nehmen nur auf, was sonst nirgends hin kann (z. B. vor der Senke)
      const intoFull = nodes.get(l.to.buildingId)!.role === 'storage-end' ? STORAGE_END_PENALTY : 0;
      for (const i of items) {
        const v = `f:${l.id}:${i}`;
        // Überlauf nur, wenn die übrigen Ausgänge nichts mehr abnehmen
        addCoef(v, 'obj', -1e-6 - intoFull - (match(from, l.from.portId, i) === 'overflow' ? OVERFLOW_PENALTY : 0));
        if (capped) addCoef(v, `cap:${capKey(l)}`, 1);
      }
    }
    // Direkte Leitungen zu anderen Fabriken: Zu- bzw. Abfluss am Anschluss, höchstens Auftragsmenge (bzw. Kapazität)
    for (const d of [...dIn, ...dOut]) {
      const v = `d:${d.dir}:${d.orderId}`;
      constraints.set(`dmax:${d.dir}:${d.orderId}`, { max: capped ? d.maxCapped : d.max });
      addCoef(v, `dmax:${d.dir}:${d.orderId}`, 1);
      // Ausfuhr hat einen kleinen Nutzen (Hotfix 0.10.3): sonst fließt z. B. Ware aus Stationen nie zur Abnehmerfabrik
      addCoef(v, 'obj', d.dir === 'out' ? EXTRACT_GAIN : -1e-6);
    }
    const dVar = (d: DirectFlow) => `d:${d.dir}:${d.orderId}`;
    for (const n of nodes.values()) {
      const id = n.b.id;
      if (n.role === 'machine' || n.role === 'extractor') {
        const u = `u:${id}`;
        // Gewinnung zählt nach Menge (Hotfix 0.10.3): bei Überschuss ist die Verteilung gleichwertig, siehe unten
        addCoef(u, 'obj', n.role === 'extractor' ? EXTRACT_GAIN * n.rates.outputs.reduce((s, x) => s + x.perMin, 0) : 1);
        constraints.set(`umax:${id}`, { max: 1 });
        addCoef(u, `umax:${id}`, 1);
        for (const inp of n.rates.inputs) {
          const c = `in:${id}:${inp.itemId}`;
          constraints.set(c, { equal: 0 });
          addCoef(u, c, -inp.perMin);
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(inp.itemId)) addCoef(`f:${l.id}:${inp.itemId}`, c, 1);
          for (const d of dIn) if (d.buildingId === id && d.itemId === inp.itemId) addCoef(dVar(d), c, 1);
        }
        for (const [portId, out] of n.outPorts) {
          const c = `out:${id}:${portId}`;
          constraints.set(c, { equal: 0 });
          addCoef(u, c, -out.perMin);
          for (const l of n.outLinks) if (l.from.portId === portId && candidates.get(l.id)?.includes(out.itemId)) addCoef(`f:${l.id}:${out.itemId}`, c, 1);
          for (const d of dOut) if (d.buildingId === id && d.portId === portId && d.itemId === out.itemId) addCoef(dVar(d), c, 1);
        }
      } else if (n.role === 'pass') {
        const items = new Set<string>();
        for (const l of [...n.inLinks, ...n.outLinks]) for (const i of candidates.get(l.id) ?? []) items.add(i);
        for (const d of [...dIn, ...dOut]) if (d.buildingId === id) items.add(d.itemId);
        for (const i of items) {
          const c = `bal:${id}:${i}`;
          constraints.set(c, { equal: 0 });
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, 1);
          for (const l of n.outLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, -1);
          for (const d of dIn) if (d.buildingId === id && d.itemId === i) addCoef(dVar(d), c, 1);
          for (const d of dOut) if (d.buildingId === id && d.itemId === i) addCoef(dVar(d), c, -1);
        }
      } else if (n.role === 'platform-unload') {
        // Abfluss = Zulauf + Einfuhr (höchstens die Auftrags- bzw. Bedarfsmenge); Einfuhr soll abfließen, wo sie gebraucht wird
        const items = new Set<string>(n.rates.outputs.map((x) => x.itemId));
        for (const l of [...n.inLinks, ...n.outLinks]) for (const i of candidates.get(l.id) ?? []) items.add(i);
        for (const d of [...dIn, ...dOut]) if (d.buildingId === id) items.add(d.itemId);
        for (const i of items) {
          const c = `bal:${id}:${i}`;
          constraints.set(c, { equal: 0 });
          const rate = n.rates.outputs.find((x) => x.itemId === i)?.perMin ?? 0;
          if (rate > 0) {
            const v = `imp:${id}:${i}`;
            constraints.set(`impmax:${id}:${i}`, { max: rate });
            addCoef(v, `impmax:${id}:${i}`, 1);
            addCoef(v, c, 1);
          }
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, 1);
          for (const l of n.outLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, -1);
          for (const d of dIn) if (d.buildingId === id && d.itemId === i) addCoef(dVar(d), c, 1);
          for (const d of dOut) if (d.buildingId === id && d.itemId === i) addCoef(dVar(d), c, -1);
        }
      } else if (n.role === 'platform-load' && exportsOf.has(id)) {
        // Mit Transportaufträgen: nimmt höchstens deren Menge ab, der Rest staut sich (bzw. geht über den Überlauf)
        const c = `exp:${id}`;
        constraints.set(c, { max: exportsOf.get(id)!.reduce((sum, x) => sum + x.perMin, 0) });
        for (const l of n.inLinks) for (const i of candidates.get(l.id) ?? []) addCoef(`f:${l.id}:${i}`, c, 1);
        for (const l of n.outLinks) for (const i of candidates.get(l.id) ?? []) addCoef(`f:${l.id}:${i}`, c, -1);
      }
      if (n.role === 'platform-load' && n.outLinks.length) {
        // Beladen mit Ausgangsbändern: hinaus geht höchstens, was hereinkommt; der Rest geht in die Fracht
        const items = new Set<string>();
        for (const l of n.outLinks) for (const i of candidates.get(l.id) ?? []) items.add(i);
        for (const i of items) {
          const c = `ld:${id}:${i}`;
          constraints.set(c, { max: 0 });
          for (const l of n.inLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, -1);
          for (const l of n.outLinks) if (candidates.get(l.id)?.includes(i)) addCoef(`f:${l.id}:${i}`, c, 1);
        }
      }
    }
    // Überschuss gleichmäßig auf die Quellen eines Netzes verteilen (wie im Spiel: alle laufen gedrosselt), statt einzelne
    // Extraktoren, Miner bzw. entladende Stationen ganz stehen zu lassen: kleinsten Anteil je Netz und Gegenstand anheben
    for (const [key, list] of sourceGroups) {
      if (list.length < 2) continue;
      const z = `z:${key}`;
      addCoef(z, 'obj', SPREAD_GAIN);
      for (const src of list) {
        const c = `spread:${key}:${src.v}`;
        constraints.set(c, { max: 0 });
        addCoef(z, c, 1);
        addCoef(src.v, c, -src.scale);
      }
    }
    // Splitter verteilen gleichmäßig auf ihre Ausgänge (wie im Spiel), statt den kürzesten Weg zu nehmen:
    // kleinster Ausgangsfluss je Splitter wird angehoben (Maschinen haben Vorrang)
    for (const s of fair) {
      const t = `t:${s.id}`;
      addCoef(t, 'obj', FAIR_GAIN);
      for (const o of s.outs) {
        const c = `fair:${s.id}:${o.l.id}`;
        constraints.set(c, { max: 0 });
        addCoef(t, c, 1);
        for (const i of o.items) addCoef(`f:${o.l.id}:${i}`, c, -1);
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
      direct: new Map(),
      sinks: new Map(),
      assumptions,
    };
  }
  const get = (m: Map<string, number>, k: string) => m.get(k) ?? 0;

  const linkResults = new Map<string, FlowLinkResult>();
  for (const l of live) {
    if (twinOf.has(l.id)) continue;
    // Beide Richtungen eines richtungsfreien Rohrs zusammen
    const twin = `${l.id}~r`;
    const items = [...new Set([...candidates.get(l.id)!, ...(candidates.get(twin) ?? [])])];
    const both = (val: Map<string, number>, i: string) => get(val, `f:${l.id}:${i}`) + get(val, `f:${twin}:${i}`);
    const cap = items.map((i) => ({ itemId: i, perMin: both(capped.val, i) })).filter((x) => x.perMin > EPS);
    const req = items.map((i) => ({ itemId: i, perMin: both(uncapped.val, i) })).filter((x) => x.perMin > EPS);
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
  const sinks = new Map<string, ItemRate[]>();
  for (const n of nodes.values()) {
    if (n.role === 'sink') {
      const sum = new Map<string, number>();
      for (const l of n.inLinks) for (const x of linkResults.get(l.id)?.items ?? []) sum.set(x.itemId, (sum.get(x.itemId) ?? 0) + x.perMin);
      const items = [...sum].filter(([, v]) => v > EPS).map(([itemId, perMin]) => ({ itemId, perMin }));
      if (items.length) sinks.set(n.b.id, items);
    }
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
      const viaDirect = dIn.filter((d) => d.buildingId === n.b.id && d.itemId === inp.itemId);
      const received =
        n.inLinks.reduce((s, l) => s + get(capped.val, `f:${l.id}:${inp.itemId}`), 0) + viaDirect.reduce((s, d) => s + get(capped.val, `d:in:${d.orderId}`), 0);
      const reachable = viaDirect.length > 0 || n.inLinks.some((l) => candidates.get(l.id)?.includes(inp.itemId));
      if (!reachable) issues.push({ kind: 'input-missing', itemId: inp.itemId });
      else if (uu < 1 - 1e-4) issues.push({ kind: 'input-short', itemId: inp.itemId, need: inp.perMin, got: inp.perMin * uu });
      return { itemId: inp.itemId, nominal: inp.perMin, received };
    });
    const assigned = new Set([...n.outPorts.values()].map((x) => x.itemId));
    const outputs = n.rates.outputs.map((out) => {
      const portId = [...n.outPorts].find(([, v]) => v.itemId === out.itemId)?.[0] ?? null;
      const viaDirect = dOut.filter((d) => d.buildingId === n.b.id && d.portId === portId && d.itemId === out.itemId);
      const removed =
        n.outLinks.filter((l) => l.from.portId === portId).reduce((s, l) => s + get(capped.val, `f:${l.id}:${out.itemId}`), 0) +
        viaDirect.reduce((s, d) => s + get(capped.val, `d:out:${d.orderId}`), 0);
      const carried = portId !== null && (viaDirect.length > 0 || n.outLinks.some((l) => l.from.portId === portId && candidates.get(l.id)?.includes(out.itemId)));
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
  const directResult = new Map<string, { dir: 'in' | 'out'; perMin: number; required: number }>();
  for (const d of [...dIn, ...dOut]) directResult.set(d.orderId, { dir: d.dir, perMin: get(capped.val, `d:${d.dir}:${d.orderId}`), required: get(uncapped.val, `d:${d.dir}:${d.orderId}`) });
  return { status: 'ok', message: '', links: linkResults, machines, platforms, direct: directResult, sinks, assumptions };
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
    ...Object.values(p.transportOrders).filter((o) => o.toFactoryId === factoryId || o.fromFactoryId === factoryId),
    p.settings.stationsOnDemand,
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

/** Summe aller Flüsse in AWESOME-Schredder der Fabrik je Gegenstand. */
export function sunkItems(flow: FactoryFlow): Map<string, number> {
  const out = new Map<string, number>();
  for (const items of flow.sinks.values()) for (const x of items) out.set(x.itemId, (out.get(x.itemId) ?? 0) + x.perMin);
  return out;
}
