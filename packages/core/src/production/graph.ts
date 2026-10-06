/**
 * Produktionsgraph aus einem Solver-Ergebnis: Knoten (Versorgung, Rezepte,
 * Ziele, Überschuss, Fehlmenge), Kanten mit Mengen je Gegenstand und ein
 * Schichtenlayout (Rohstoff links → Endprodukt rechts).
 *
 * Mengen eines Gegenstands werden proportional verteilt: Jeder Erzeuger
 * beliefert jeden Verbraucher im Verhältnis seines Anteils an der Erzeugung.
 * Das entspricht der Bilanz, nicht einer konkreten Bandführung.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { getLanguage, tr } from '../i18n/index.ts';
import type { SolveResult } from './solver.ts';

export type FlowNodeKind = 'supply' | 'recipe' | 'target' | 'surplus' | 'shortfall';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  sublabel: string;
  /** Rezept-ID bzw. Gegenstands-ID. */
  ref: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  itemId: string;
  perMin: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const EPS = 1e-6;

export function buildFlowGraph(gd: GameDataIndex, result: SolveResult): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const producers = new Map<string, { node: string; rate: number }[]>();
  const consumers = new Map<string, { node: string; rate: number }[]>();
  const push = (m: Map<string, { node: string; rate: number }[]>, item: string, node: string, rate: number) => {
    if (rate <= EPS) return;
    m.set(item, [...(m.get(item) ?? []), { node, rate }]);
  };
  const unit = (item: string) => (gd.item(item)?.form === 'solid' ? '/min' : 'm³/min');
  const n = (v: number) => (+v.toFixed(3)).toLocaleString(getLanguage() === 'de' ? 'de-DE' : 'en-US');

  result.recipes.forEach((r, i) => {
    const id = `r${i}`;
    nodes.push({
      id,
      kind: 'recipe',
      label: gd.name(r.recipeId),
      sublabel: `${r.machinesCeil} × ${gd.name(r.building)} @ ${n(r.clockEven * 100)} %`,
      ref: r.recipeId,
    });
    for (const o of r.outputs) push(producers, o.item, id, o.perMin);
    for (const x of r.inputs) push(consumers, x.item, id, x.perMin);
  });
  for (const it of result.items) {
    if (it.supplied > EPS) {
      const id = `s:${it.itemId}`;
      nodes.push({ id, kind: 'supply', label: gd.name(it.itemId), sublabel: `${n(it.supplied)} ${unit(it.itemId)}`, ref: it.itemId });
      push(producers, it.itemId, id, it.supplied);
    }
    if (it.shortfall > EPS) {
      const id = `u:${it.itemId}`;
      nodes.push({ id, kind: 'shortfall', label: gd.name(it.itemId), sublabel: tr('fehlt {n}', { n: `${n(it.shortfall)} ${unit(it.itemId)}` }), ref: it.itemId });
      push(producers, it.itemId, id, it.shortfall);
    }
    if (it.target > EPS) {
      const id = `t:${it.itemId}`;
      nodes.push({ id, kind: 'target', label: gd.name(it.itemId), sublabel: `${n(it.target)} ${unit(it.itemId)}`, ref: it.itemId });
      push(consumers, it.itemId, id, it.target);
    }
    if (it.surplus > EPS) {
      const id = `x:${it.itemId}`;
      nodes.push({ id, kind: 'surplus', label: gd.name(it.itemId), sublabel: tr('Überschuss {n}', { n: `${n(it.surplus)} ${unit(it.itemId)}` }), ref: it.itemId });
      push(consumers, it.itemId, id, it.surplus);
    }
  }
  for (const [item, prods] of producers) {
    const cons = consumers.get(item) ?? [];
    const total = prods.reduce((s, x) => s + x.rate, 0);
    if (total <= EPS) continue;
    for (const pr of prods) for (const c of cons) {
      const v = (pr.rate * c.rate) / total;
      if (v > EPS && pr.node !== c.node) edges.push({ from: pr.node, to: c.node, itemId: item, perMin: v });
    }
  }
  return { nodes, edges };
}

export interface LayoutNode extends FlowNode {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge extends FlowEdge {
  /** Rückwärtskante (Kreislauf). */
  back: boolean;
}

export interface FlowLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  layers: number;
}

/**
 * Schichtenlayout (Sugiyama, vereinfacht): Kreisläufe werden über eine
 * Tiefensuche aufgebrochen, Schichten nach längstem Weg vergeben, die
 * Reihenfolge innerhalb der Schichten per Schwerpunktverfahren verbessert.
 */
export function layoutFlowGraph(g: FlowGraph, opts: { nodeW?: number; nodeH?: number; gapX?: number; gapY?: number } = {}): FlowLayout {
  const nodeW = opts.nodeW ?? 190;
  const nodeH = opts.nodeH ?? 46;
  const gapX = opts.gapX ?? 110;
  const gapY = opts.gapY ?? 22;
  const out = new Map<string, string[]>();
  for (const n of g.nodes) out.set(n.id, []);
  for (const e of g.edges) out.get(e.from)?.push(e.to);

  // Rückwärtskanten per Tiefensuche (Start bei Versorgungsknoten)
  const back = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const order = [...g.nodes].sort((a, b) => Number(b.kind === 'supply') - Number(a.kind === 'supply'));
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id) ?? []) {
      const st = state.get(t) ?? 0;
      if (st === 1) back.add(`${id}>${t}`);
      else if (st === 0) dfs(t);
    }
    state.set(id, 2);
  };
  for (const n of order) if (!state.get(n.id)) dfs(n.id);

  // Längster Weg im azyklischen Restgraphen
  const layer = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
  const fwdEdges = g.edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  for (let k = 0; k < g.nodes.length; k++) {
    let changed = false;
    for (const e of fwdEdges) {
      const l = layer.get(e.from)! + 1;
      if (l > layer.get(e.to)!) {
        layer.set(e.to, l);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Ziele, Überschüsse ganz rechts; Versorgung ganz links
  const maxLayer = Math.max(0, ...layer.values());
  for (const n of g.nodes) {
    if (n.kind === 'target' || n.kind === 'surplus') layer.set(n.id, maxLayer);
  }
  const layers: string[][] = [];
  for (const n of g.nodes) (layers[layer.get(n.id)!] ??= []).push(n.id);
  for (let i = 0; i < layers.length; i++) layers[i] ??= [];

  // Reihenfolge: Schwerpunkt der Vorgänger bzw. Nachfolger
  const pos = new Map<string, number>();
  layers.forEach((ids) => ids.forEach((id, i) => pos.set(id, i)));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of fwdEdges) {
    preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
    succs.set(e.from, [...(succs.get(e.from) ?? []), e.to]);
  }
  const bary = (id: string, nb: Map<string, string[]>) => {
    const list = nb.get(id) ?? [];
    return list.length ? list.reduce((s, x) => s + pos.get(x)!, 0) / list.length : pos.get(id)!;
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const range = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const li of range) {
      const nb = down ? preds : succs;
      layers[li]!.sort((a, b) => bary(a, nb) - bary(b, nb));
      layers[li]!.forEach((id, i) => pos.set(id, i));
    }
  }

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const maxRows = Math.max(1, ...layers.map((l) => l.length));
  const height = maxRows * (nodeH + gapY) + gapY;
  const nodes: LayoutNode[] = [];
  layers.forEach((ids, li) => {
    const colH = ids.length * (nodeH + gapY) - gapY;
    const top = (height - colH) / 2;
    ids.forEach((id, i) => {
      nodes.push({ ...byId.get(id)!, layer: li, x: gapX / 2 + li * (nodeW + gapX), y: top + i * (nodeH + gapY), w: nodeW, h: nodeH });
    });
  });
  return {
    nodes,
    edges: g.edges.map((e) => ({ ...e, back: back.has(`${e.from}>${e.to}`) })),
    width: layers.length * (nodeW + gapX),
    height,
    layers: layers.length,
  };
}

/**
 * Stufe eines Gegenstands in der Produktionskette (0 = Rohstoff/Versorgung).
 * Grundlage ist dasselbe Schichtenlayout wie im Diagramm; Kreisläufe werden
 * dabei aufgebrochen.
 */
export function itemStages(gd: GameDataIndex, result: SolveResult): Map<string, number> {
  const g = buildFlowGraph(gd, result);
  const lay = layoutFlowGraph(g);
  const layerOf = new Map(lay.nodes.map((n) => [n.id, n.layer]));
  const stage = new Map<string, number>();
  for (const e of g.edges) {
    const l = layerOf.get(e.from) ?? 0;
    const from = g.nodes.find((n) => n.id === e.from);
    const s = from?.kind === 'supply' ? 0 : l;
    stage.set(e.itemId, Math.max(stage.get(e.itemId) ?? 0, s));
  }
  for (const it of result.items) if (!stage.has(it.itemId)) stage.set(it.itemId, 0);
  return stage;
}

export type ItemSort = 'alpha' | 'raw-first' | 'final-first' | 'throughput';

/** Sortiert Gegenstandszeilen nach Name, Kettenstufe oder Durchsatz. */
export function sortItems<T extends { itemId: string; throughput?: number }>(
  gd: GameDataIndex,
  rows: T[],
  sort: ItemSort,
  stages?: Map<string, number>,
): T[] {
  const lang = getLanguage();
  const byName = (a: T, b: T) => gd.name(a.itemId).localeCompare(gd.name(b.itemId), lang);
  const st = (r: T) => stages?.get(r.itemId) ?? 0;
  const list = [...rows];
  switch (sort) {
    case 'alpha':
      return list.sort(byName);
    case 'raw-first':
      return list.sort((a, b) => st(a) - st(b) || byName(a, b));
    case 'final-first':
      return list.sort((a, b) => st(b) - st(a) || byName(a, b));
    case 'throughput':
      return list.sort((a, b) => (b.throughput ?? 0) - (a.throughput ?? 0) || byName(a, b));
  }
}
