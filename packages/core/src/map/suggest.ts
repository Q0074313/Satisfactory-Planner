/**
 * Standortvorschlag: Wo liegen die Vorkommen, die den Rohstoffbedarf eines
 * Produktionsplans decken, möglichst nah beieinander?
 *
 * Verfahren (Heuristik, kein Optimum):
 * 1. Kandidaten sind die Lagen aller freien Vorkommen der benötigten Rohstoffe.
 * 2. Je Kandidat und Rohstoff werden die nächstgelegenen freien Vorkommen
 *    genommen, bis der Bedarf gedeckt ist (höchstens bis zum Suchradius).
 *    Förderrate je Vorkommen: gewählte Minerstufe bzw. Ölpumpe bzw.
 *    Quellenextraktor mit gewähltem Takt × Reinheit, höchstens so viel, wie
 *    das schnellste Band bzw. Rohr abführt. Übertaktete Vorkommen bekommen
 *    nur den nötigen Takt; daraus folgen die Energiesplitter.
 * 3. Bewertung: mittlere Entfernung der genutzten Vorkommen zum Standort,
 *    gewichtet mit der genutzten Menge. Danach wird der Standort einmal auf
 *    den gewichteten Schwerpunkt verschoben, wenn das besser ist.
 * 4. Rangfolge: Deckung (absteigend), dann mittlere Entfernung. Vorschläge
 *    näher als der Mindestabstand an einem besseren werden verworfen.
 *
 * Wasser wird nicht gesucht (Wasserextraktoren stehen an beliebigem Wasser).
 * Gelände, Höhen und Wege werden nicht berücksichtigt.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { dist, rectContains, type Rect, type Vec2 } from '../geometry/index.ts';
import type { Project } from '../model/schema.ts';
import { machineRates, shardsForClock } from '../production/machine.ts';
import { solveProduction } from '../production/solver.ts';
import { canUseNode, nodeRate, nodeUsage } from './index.ts';
import type { MapNode } from './types.ts';
import { lockedRecipesOf } from '../progress/index.ts';

export interface SiteDemand {
  itemId: string;
  perMin: number;
}

export interface SiteOptions {
  /** Minerstufe für feste Rohstoffe (Gebäudetyp). */
  minerType: string;
  /** Takt aller Gewinnungsgebäude (1 = 100 %). */
  clock: number;
  /** Suchradius um den Standort (m). */
  maxRadiusM?: number;
  /** Mindestabstand zwischen zwei Vorschlägen (m). */
  minSeparationM?: number;
  limit?: number;
  /** Vorkommen, die als belegt gelten. */
  used?: Set<string>;
  /** Nur in diesem Weltbereich suchen (Standorte und Vorkommen), z. B. aktueller Kartenausschnitt. */
  bounds?: Rect | null;
}

export interface SitePick {
  nodeId: string;
  itemId: string;
  /** Förderrate des Vorkommens mit den gewählten Gebäuden. */
  capacity: number;
  /** Davon genutzt. */
  used: number;
  distM: number;
  /** Nötiger Takt für die genutzte Menge (höchstens der gewählte). */
  clock: number;
  /** Energiesplitter für diesen Takt. */
  shards: number;
  /** Förderrate durch das schnellste Band bzw. Rohr begrenzt. */
  capped: boolean;
}

export interface SiteItem {
  itemId: string;
  demand: number;
  covered: number;
}

export interface SiteSuggestion {
  center: Vec2;
  /** Anteil des gedeckten Bedarfs (0 … 1). */
  coverage: number;
  /** Mittlere Entfernung der genutzten Vorkommen (m, mengengewichtet). */
  meanDistM: number;
  maxDistM: number;
  picks: SitePick[];
  items: SiteItem[];
  /** Energiesplitter aller genutzten Vorkommen. */
  shards: number;
}

/** Gebäudetyp, mit dem das Vorkommen im Vorschlag genutzt wird. */
function extractorFor(gd: GameDataIndex, node: MapNode, minerType: string): string | null {
  if (canUseNode(gd, minerType, node)) return minerType;
  for (const b of Object.values(gd.data.buildings)) {
    if (b.nativeClass === 'FGBuildableResourceExtractor' && b.extractor?.allowedForms.includes('solid')) continue;
    if (canUseNode(gd, b.id, node)) return b.id;
  }
  return null;
}

/**
 * Rohstoffbedarf eines Produktionsplans aus der lokalen Gewinnung: alle
 * Rohstoffe außer Wasser, die der Plan bezieht und nicht als Import
 * gekennzeichnet hat.
 */
export function siteDemandFromPlan(p: Project, gd: GameDataIndex, planId: string): SiteDemand[] {
  const plan = p.productionPlans[planId];
  if (!plan) return [];
  const imports = new Set(plan.supplies.filter((s) => s.origin === 'import').map((s) => s.itemId));
  const res = solveProduction(gd, plan, { locked: lockedRecipesOf(p, gd) });
  return res.items
    .filter((i) => i.supplied > 1e-6 && gd.item(i.itemId)?.isResource && i.itemId !== 'Desc_Water_C' && !imports.has(i.itemId))
    .map((i) => ({ itemId: i.itemId, perMin: i.supplied }))
    .sort((a, b) => b.perMin - a.perMin);
}

export function suggestSites(gd: GameDataIndex, demand: SiteDemand[], opts: SiteOptions): SiteSuggestion[] {
  const radius = opts.maxRadiusM ?? 1500;
  const sep = opts.minSeparationM ?? 400;
  const limit = opts.limit ?? 5;
  const used = opts.used ?? new Set<string>();
  const wanted = demand.filter((d) => d.perMin > 1e-9);
  if (!gd.map || wanted.length === 0) return [];

  // Freie Vorkommen je Rohstoff mit Förderrate
  // Abtransport: schnellstes Band bzw. Rohr
  const beltMax = gd.beltTiers.at(-1)?.conveyor?.itemsPerMin ?? Infinity;
  const pipeMax = gd.pipeTiers.at(-1)?.pipe?.m3PerMin ?? Infinity;
  const pool = new Map<string, { node: MapNode; capacity: number; perClock: number; capped: boolean }[]>();
  for (const d of wanted) {
    const list: { node: MapNode; capacity: number; perClock: number; capped: boolean }[] = [];
    const max = gd.item(d.itemId)?.form === 'solid' ? beltMax : pipeMax;
    for (const n of gd.map.nodes) {
      if (n.itemId !== d.itemId || used.has(n.id)) continue;
      if (opts.bounds && !rectContains(opts.bounds, n)) continue;
      const type = extractorFor(gd, n, opts.minerType);
      const raw = type ? nodeRate(gd, n, type, opts.clock) : 0;
      if (raw > 0) list.push({ node: n, capacity: Math.min(raw, max), perClock: raw / opts.clock, capped: raw > max + 1e-9 });
    }
    pool.set(d.itemId, list);
  }

  const evaluate = (center: Vec2): SiteSuggestion => {
    const picks: SitePick[] = [];
    const items: SiteItem[] = [];
    for (const d of wanted) {
      const near = pool
        .get(d.itemId)!
        .map((x) => ({ ...x, distM: dist(center, x.node) }))
        .filter((x) => x.distM <= radius)
        .sort((a, b) => a.distM - b.distM);
      let rest = d.perMin;
      for (const x of near) {
        if (rest <= 1e-9) break;
        const take = Math.min(rest, x.capacity);
        // Takt nur so hoch wie nötig (Rate wächst linear mit dem Takt), auf 1 % aufgerundet
        const clock = Math.min(opts.clock, Math.ceil((take / x.perClock) * 100 - 1e-6) / 100);
        picks.push({ nodeId: x.node.id, itemId: d.itemId, capacity: x.capacity, used: take, distM: x.distM, clock, shards: shardsForClock(clock), capped: x.capped });
        rest -= take;
      }
      items.push({ itemId: d.itemId, demand: d.perMin, covered: d.perMin - Math.max(0, rest) });
    }
    const total = wanted.reduce((s, d) => s + d.perMin, 0);
    const covered = items.reduce((s, i) => s + i.covered, 0);
    const usedSum = picks.reduce((s, x) => s + x.used, 0);
    const meanDistM = usedSum > 0 ? picks.reduce((s, x) => s + x.distM * x.used, 0) / usedSum : Infinity;
    const shards = picks.reduce((s, x) => s + x.shards, 0);
    return { center, coverage: total > 0 ? covered / total : 0, meanDistM, maxDistM: Math.max(0, ...picks.map((x) => x.distM)), picks, items, shards };
  };

  const better = (a: SiteSuggestion, b: SiteSuggestion) => (Math.abs(a.coverage - b.coverage) > 1e-9 ? a.coverage > b.coverage : a.meanDistM < b.meanDistM);

  const candidates: SiteSuggestion[] = [];
  for (const list of pool.values()) {
    for (const { node } of list) {
      let s = evaluate({ x: node.x, y: node.y });
      // Einmal zum gewichteten Schwerpunkt der genutzten Vorkommen verschieben
      const w = s.picks.reduce((a, x) => a + x.used, 0);
      if (w > 0) {
        const c = s.picks.reduce((a, x) => {
          const n = gd.mapNode(x.nodeId)!;
          return { x: a.x + (n.x * x.used) / w, y: a.y + (n.y * x.used) / w };
        }, { x: 0, y: 0 });
        const moved = evaluate(c);
        if (better(moved, s)) s = moved;
      }
      candidates.push(s);
    }
  }
  candidates.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const out: SiteSuggestion[] = [];
  for (const c of candidates) {
    if (out.some((o) => dist(o.center, c.center) < sep)) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** Vorkommen, die im Projekt belegt sind (optional ohne die einer Fabrik). */
export function usedNodes(p: Project, exceptFactoryId?: string): Set<string> {
  const s = new Set<string>();
  for (const [nodeId, ids] of nodeUsage(p)) if (ids.some((id) => p.buildings[id]?.factoryId !== exceptFactoryId)) s.add(nodeId);
  return s;
}

export interface NodeDemandRow {
  itemId: string;
  /** Bedarf laut Produktionsplänen der Fabrik (eigene Gewinnung). */
  demand: number;
  /** Förderung der Gewinnungsgebäude, die mit einem Vorkommen verknüpft sind. */
  linked: number;
  /** Förderung der Gewinnungsgebäude ohne Verknüpfung. */
  unlinked: number;
  /** Anzahl belegter Vorkommen. */
  nodes: number;
}

/**
 * Rohstoffbedarf einer Fabrik gegen die belegten Vorkommen: Bedarf aus allen
 * Produktionsplänen der Fabrik (wie beim Standortvorschlag) und Förderung
 * ihrer Gewinnungsgebäude, getrennt nach verknüpft und nicht verknüpft.
 */
export function factoryNodeDemand(p: Project, gd: GameDataIndex, factoryId: string): NodeDemandRow[] {
  const rows = new Map<string, NodeDemandRow>();
  const row = (itemId: string) => {
    let r = rows.get(itemId);
    if (!r) rows.set(itemId, (r = { itemId, demand: 0, linked: 0, unlinked: 0, nodes: 0 }));
    return r;
  };
  for (const plan of Object.values(p.productionPlans)) {
    if (plan.factoryId !== factoryId) continue;
    for (const d of siteDemandFromPlan(p, gd, plan.id)) row(d.itemId).demand += d.perMin;
  }
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.extraction || !gd.building(b.type)?.extractor || b.extraction.itemId === 'Desc_Water_C') continue;
    const rate = machineRates(gd, b).outputs.reduce((s, o) => s + o.perMin, 0);
    const r = row(b.extraction.itemId);
    if (b.extraction.nodeId) {
      r.linked += rate;
      r.nodes++;
    } else r.unlinked += rate;
  }
  return [...rows.values()].sort((a, b) => b.demand - a.demand || a.itemId.localeCompare(b.itemId));
}
