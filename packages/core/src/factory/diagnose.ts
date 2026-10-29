/**
 * Geführte Fehlersuche („Etwas stimmt nicht“) in einer Fabrik.
 *
 * Ausgangspunkt ist eine Frage des Nutzers: „Gegenstand X kommt nicht an“
 * oder „Maschine Y steht bzw. läuft nicht voll“. Die Diagnose liest das
 * Durchsatzmodell (eingezeichnete Leitungen mit Kapazität) und verfolgt den
 * Fluss über Splitter, Zusammenführungen, Lager und Rohrkreuzungen zurück zu
 * den Quellen bzw. vorwärts zu den Abnehmern. Ergebnis ist eine eingerückte
 * Liste von Aussagen mit den betroffenen Objekten.
 *
 * Die Ursache für eine Teilauslastung ergibt sich so:
 * - Quellen erzeugen zusammen zu wenig (oder laufen selbst nicht voll → rekursiv),
 * - eine Leitung auf dem Weg ist voll (Kapazität der Stufe),
 * - der Ausgang staut sich, weil Abnehmer weniger brauchen (Spielmechanik:
 *   Eine Maschine hält an, wenn ein Ausgang voll ist).
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { ObjectRef, Project } from '../model/schema.ts';
import { cachedFactoryFlow, flowRole, type FactoryFlow, type FlowRole } from './flow.ts';

export type DiagnosisLevel = 'error' | 'warning' | 'info' | 'ok';

export interface DiagnosisLine {
  depth: number;
  level: DiagnosisLevel;
  text: string;
  objects: ObjectRef[];
}

const EPS = 1e-6;
const MAX_DEPTH = 5;

interface Graph {
  flow: FactoryFlow;
  role: Map<string, FlowRole>;
  /** Eingehende/abgehende Verbindungen je Gebäude. */
  inLinks: Map<string, string[]>;
  outLinks: Map<string, string[]>;
}

function graphOf(p: Project, gd: GameDataIndex, factoryId: string): Graph {
  const flow = cachedFactoryFlow(p, gd, factoryId);
  const role = new Map<string, FlowRole>();
  const inLinks = new Map<string, string[]>();
  const outLinks = new Map<string, string[]>();
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId);
  for (const l of links) {
    inLinks.set(l.to.buildingId, [...(inLinks.get(l.to.buildingId) ?? []), l.id]);
    outLinks.set(l.from.buildingId, [...(outLinks.get(l.from.buildingId) ?? []), l.id]);
  }
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    role.set(b.id, flowRole(b, gd.building(b.type), gd, (outLinks.get(b.id) ?? []).length > 0));
  }
  return { flow, role, inLinks, outLinks };
}

const bRef = (id: string): ObjectRef => ({ table: 'buildings', id });
const lRef = (id: string): ObjectRef => ({ table: 'links', id });

function rateText(gd: GameDataIndex, itemId: string, v: number): string {
  return `${formatNumber(v, 2)} ${gd.item(itemId)?.form === 'solid' ? '/min' : 'm³/min'}`;
}

function label(p: Project, gd: GameDataIndex, id: string): string {
  const b = p.buildings[id];
  if (!b) return id;
  return b.label ? `${b.label} (${gd.name(b.type)})` : gd.name(b.type);
}

/** Quellen eines Gegenstands stromaufwärts eines Gebäudes (über Durchleitungen). */
function upstream(p: Project, g: Graph, buildingId: string, itemId: string) {
  const sources = new Set<string>();
  const full: string[] = [];
  const seen = new Set<string>();
  const visitLink = (linkId: string) => {
    if (seen.has(linkId)) return;
    seen.add(linkId);
    const l = p.links[linkId]!;
    const r = g.flow.links.get(linkId);
    if (r && r.capacity > 0 && r.total >= r.capacity - 1e-4 && r.required > r.capacity + 1e-4) full.push(linkId);
    const from = l.from.buildingId;
    const role = g.role.get(from);
    if (role === 'pass') for (const x of g.inLinks.get(from) ?? []) visitLink(x);
    else if (role === 'machine' || role === 'extractor' || role === 'platform-unload') {
      const m = g.flow.machines.get(from);
      const emits = m ? m.outputs.some((o) => o.itemId === itemId) : (g.flow.platforms.get(from)?.items.some((x) => x.itemId === itemId) ?? role === 'platform-unload');
      if (emits) sources.add(from);
    }
  };
  for (const x of g.inLinks.get(buildingId) ?? []) visitLink(x);
  return { sources: [...sources], full };
}

/** Abnehmer eines Ausgangs stromabwärts (über Durchleitungen). */
function downstream(p: Project, g: Graph, buildingId: string, portId: string | null, itemId: string) {
  const consumers = new Set<string>();
  const open = { unlimited: false };
  const full: string[] = [];
  const seen = new Set<string>();
  const visitLink = (linkId: string) => {
    if (seen.has(linkId)) return;
    seen.add(linkId);
    const l = p.links[linkId]!;
    const r = g.flow.links.get(linkId);
    if (r && r.capacity > 0 && r.total >= r.capacity - 1e-4 && r.required > r.capacity + 1e-4) full.push(linkId);
    const to = l.to.buildingId;
    const role = g.role.get(to);
    if (role === 'pass') for (const x of g.outLinks.get(to) ?? []) visitLink(x);
    else if (role === 'machine') {
      if (g.flow.machines.get(to)?.inputs.some((i) => i.itemId === itemId)) consumers.add(to);
    } else if (role === 'sink' || role === 'storage-end' || role === 'platform-load' || role === 'consumer-unmodeled') open.unlimited = true;
  };
  for (const x of g.outLinks.get(buildingId) ?? []) if (portId === null || p.links[x]?.from.portId === portId) visitLink(x);
  return { consumers: [...consumers], unlimited: open.unlimited, full };
}

function diagnoseBuilding(p: Project, gd: GameDataIndex, g: Graph, id: string, depth: number, seen: Set<string>, out: DiagnosisLine[]): void {
  const b = p.buildings[id];
  if (!b) return;
  const name = label(p, gd, id);
  const push = (level: DiagnosisLevel, text: string, objects: ObjectRef[] = [bRef(id)], d = depth) => out.push({ depth: d, level, text, objects });
  if (seen.has(id)) {
    push('info', tr('{name}: siehe oben.', { name }));
    return;
  }
  seen.add(id);
  const def = gd.building(b.type);
  if (!b.placement) {
    push('error', tr('{name} ist nicht im Grundriss aufgestellt. Das Durchsatzmodell rechnet nur mit platzierten Gebäuden.', { name }));
    return;
  }
  if (def?.extractor && !b.extraction) {
    push('error', tr('{name}: kein Rohstoff bzw. keine Reinheit festgelegt.', { name }));
    return;
  }
  if ((def?.category === 'production' || (def?.category === 'power' && def.powerProductionMW)) && !b.recipeId) {
    push('error', def.category === 'power' ? tr('{name}: kein Brennstoff gewählt.', { name }) : tr('{name}: kein Rezept gewählt.', { name }));
    return;
  }
  const m = g.flow.machines.get(id);
  if (!m) {
    push('info', tr('{name} wird im Durchsatzmodell nicht als Maschine gerechnet.', { name }));
    return;
  }
  if (m.utilization >= 1 - 1e-4) {
    push('ok', tr('{name} läuft laut Planer mit 100 %.', { name }));
    return;
  }
  push(m.utilization <= EPS ? 'error' : 'warning', tr('{name} läuft nur mit {n} %.', { name, n: formatNumber(m.utilization * 100, 1) }));
  if (depth >= MAX_DEPTH) {
    push('info', tr('Weitere Rückverfolgung abgebrochen (zu tief verschachtelt).'), [], depth + 1);
    return;
  }
  const d = depth + 1;
  let explained = false;

  // Ausgänge: ohne Abnahme bzw. Stau durch Abnehmer
  for (const o of m.outputs) {
    const issue = m.issues.find((x) => x.kind === 'output-blocked' && x.itemId === o.itemId);
    if (issue) {
      explained = true;
      const connected = (g.outLinks.get(id) ?? []).some((l) => o.portId !== null && p.links[l]?.from.portId === o.portId);
      push(
        'error',
        connected
          ? tr('Ausgang {item}: Die Leitung führt zu nichts, das {item} annimmt. Die Maschine staut sich und hält an.', { item: gd.name(o.itemId) })
          : tr('Ausgang {item} ist nicht angeschlossen. Die Maschine hält an, sobald der Ausgang voll ist.', { item: gd.name(o.itemId) }),
        [bRef(id)],
        d,
      );
      continue;
    }
    if (o.removed < o.nominal - 1e-4) {
      const ds = downstream(p, g, id, o.portId, o.itemId);
      if (ds.full.length) {
        explained = true;
        for (const l of ds.full) push('warning', fullText(p, gd, g, l), [lRef(l)], d);
      } else if (!ds.unlimited) {
        const need = ds.consumers.reduce((s, c) => s + (g.flow.machines.get(c)?.inputs.find((i) => i.itemId === o.itemId)?.nominal ?? 0), 0);
        const fullyFed = ds.consumers.every((c) => (g.flow.machines.get(c)?.utilization ?? 0) >= 1 - 1e-4);
        if (fullyFed || need < o.nominal - 1e-4) {
          explained = true;
          push(
            'warning',
            ds.consumers.length === 0
              ? tr('Ausgang {item}: kein Abnehmer. Der Ausgang staut sich, die Maschine hält an.', { item: gd.name(o.itemId) })
              : tr('Ausgang {item}: Die Abnehmer brauchen zusammen nur {need}, erzeugt würden {have}. Der Ausgang staut sich (im Spiel normal, wenn bewusst überdimensioniert).', {
                  item: gd.name(o.itemId),
                  need: rateText(gd, o.itemId, need),
                  have: rateText(gd, o.itemId, o.nominal),
                }),
            [bRef(id), ...ds.consumers.map(bRef)],
            d,
          );
        }
      }
    }
  }

  // Eingänge: fehlend, zu wenig, Leitung voll, Quelle läuft nicht voll
  for (const inp of m.inputs) {
    if (inp.received >= inp.nominal - 1e-4 && !m.issues.some((x) => x.kind === 'input-missing' && x.itemId === inp.itemId)) continue;
    if (m.issues.some((x) => x.kind === 'input-missing' && x.itemId === inp.itemId)) {
      explained = true;
      push('error', tr('Eingang {item}: Keine Leitung bringt {item} hierher.', { item: gd.name(inp.itemId) }), [bRef(id)], d);
      itemSources(p, gd, g, b.factoryId, inp.itemId, d + 1, out);
      continue;
    }
    const us = upstream(p, g, id, inp.itemId);
    const lines = out.length;
    for (const l of us.full) push('warning', fullText(p, gd, g, l), [lRef(l)], d);
    const supply = us.sources.reduce((s, src) => {
      const sm = g.flow.machines.get(src);
      if (sm) return s + (sm.outputs.find((o) => o.itemId === inp.itemId)?.nominal ?? 0);
      return s + (g.flow.platforms.get(src)?.items.find((x) => x.itemId === inp.itemId)?.perMin ?? 0);
    }, 0);
    // Gesamtbedarf aller Abnehmer, die sich diese Quellen teilen
    const sharers = new Set<string>();
    for (const src of us.sources) {
      const port = g.flow.machines.get(src)?.outputs.find((o) => o.itemId === inp.itemId)?.portId ?? null;
      for (const c of downstream(p, g, src, port, inp.itemId).consumers) sharers.add(c);
    }
    const demand = [...sharers].reduce((s, c) => s + (g.flow.machines.get(c)?.inputs.find((i) => i.itemId === inp.itemId)?.nominal ?? 0), 0);
    if (us.sources.length === 0) {
      push('error', tr('Eingang {item}: Die Leitungen haben keine Quelle für {item}.', { item: gd.name(inp.itemId) }), [bRef(id)], d);
    } else if (supply >= inp.nominal - 1e-4 && supply < demand - 1e-4) {
      push(
        'warning',
        tr('Eingang {item}: Die Quellen erzeugen {have}, ihre {n} Abnehmer brauchen zusammen {need}. Es reicht nicht für alle.', {
          item: gd.name(inp.itemId),
          have: rateText(gd, inp.itemId, supply),
          n: sharers.size,
          need: rateText(gd, inp.itemId, demand),
        }),
        [...us.sources, ...sharers].map(bRef),
        d,
      );
    } else if (supply < inp.nominal - 1e-4) {
      push(
        'warning',
        tr('Eingang {item}: Alle Quellen zusammen erzeugen höchstens {have}, diese Maschine braucht {need}.', {
          item: gd.name(inp.itemId),
          have: rateText(gd, inp.itemId, supply),
          need: rateText(gd, inp.itemId, inp.nominal),
        }),
        [bRef(id), ...us.sources.map(bRef)],
        d,
      );
    } else {
      push(
        'info',
        tr('Eingang {item}: erhält {got} von {need}. Die Quellen teilen ihre Menge mit anderen Abnehmern oder laufen selbst nicht voll.', {
          item: gd.name(inp.itemId),
          got: rateText(gd, inp.itemId, inp.received),
          need: rateText(gd, inp.itemId, inp.nominal),
        }),
        [bRef(id)],
        d,
      );
    }
    for (const src of us.sources) {
      const sm = g.flow.machines.get(src);
      if (sm && sm.utilization < 1 - 1e-4) diagnoseBuilding(p, gd, g, src, d + 1, seen, out);
    }
    if (out.length > lines) explained = true;
  }
  if (!explained && m.issues.some((x) => x.kind === 'belt-limit')) {
    push('warning', tr('Eine Leitung im Umfeld ist zu klein (Kapazität der Stufe). Ohne Kapazitätsgrenzen liefe die Maschine mit {n} %.', { n: formatNumber(m.utilizationUncapped * 100, 1) }), [bRef(id)], d);
    explained = true;
  }
  if (!explained) push('info', tr('Keine eindeutige Ursache gefunden. Vermutlich teilt sich die Maschine Zufluss oder Abnahme mit anderen Maschinen.'), [bRef(id)], d);
}

function fullText(p: Project, gd: GameDataIndex, g: Graph, linkId: string): string {
  const r = g.flow.links.get(linkId)!;
  const l = p.links[linkId]!;
  return tr('Leitung {tier} ist voll: {cap} Kapazität, gebraucht würden {need}.', {
    tier: gd.name(l.tier),
    cap: formatNumber(r.capacity, 1),
    need: formatNumber(r.required, 1),
  });
}

/** Wer in der Fabrik erzeugt bzw. liefert einen Gegenstand? */
function itemSources(p: Project, gd: GameDataIndex, g: Graph, factoryId: string, itemId: string, depth: number, out: DiagnosisLine[]): void {
  const producers = [...g.flow.machines.values()].filter((m) => m.outputs.some((o) => o.itemId === itemId));
  const imports = [...g.flow.platforms].filter(([, x]) => x.mode === 'unload' && x.items.some((i) => i.itemId === itemId));
  const unplaced = Object.values(p.buildings).filter((b) => b.factoryId === factoryId && !b.placement && b.recipeId && gd.recipe(b.recipeId)?.outputs.some((o) => o.item === itemId));
  const orders = Object.values(p.transportOrders).filter((o) => o.toFactoryId === factoryId && o.itemId === itemId);
  if (producers.length === 0 && imports.length === 0) {
    out.push({
      depth,
      level: 'error',
      text:
        unplaced.length > 0
          ? tr('{item} wird nur von nicht aufgestellten Maschinen erzeugt ({n}).', { item: gd.name(itemId), n: unplaced.length })
          : orders.length > 0
            ? tr('Ein Transportauftrag liefert {item}, aber in der Fabrik gibt es keine passende entladende Übergabe (Frachtplattform, Lkw-Station, Drohnenhafen).', { item: gd.name(itemId) })
            : tr('Keine Maschine in der Fabrik erzeugt {item}, und kein Transportauftrag liefert es.', { item: gd.name(itemId) }),
      objects: unplaced.map((b) => bRef(b.id)),
    });
    return;
  }
  const list = [...producers.map((m) => m.buildingId), ...imports.map(([id]) => id)];
  out.push({
    depth,
    level: 'info',
    text: tr('Quellen für {item} in der Fabrik: {list}. Sie sind nicht mit dieser Maschine verbunden.', { item: gd.name(itemId), list: list.map((id) => label(p, gd, id)).join(', ') }),
    objects: list.map(bRef),
  });
}

/** „Maschine steht bzw. läuft nicht voll“. */
export function diagnoseMachine(p: Project, gd: GameDataIndex, buildingId: string): DiagnosisLine[] {
  const b = p.buildings[buildingId];
  if (!b) return [];
  const out: DiagnosisLine[] = [];
  diagnoseBuilding(p, gd, graphOf(p, gd, b.factoryId), buildingId, 0, new Set(), out);
  return out;
}

/** „Gegenstand kommt nicht (genug) an“: alle Abnehmer in der Fabrik, die zu wenig erhalten. */
export function diagnoseItem(p: Project, gd: GameDataIndex, factoryId: string, itemId: string): DiagnosisLine[] {
  const g = graphOf(p, gd, factoryId);
  const out: DiagnosisLine[] = [];
  const consumers = [...g.flow.machines.values()].filter((m) => m.inputs.some((i) => i.itemId === itemId));
  const name = gd.name(itemId);
  if (consumers.length === 0) {
    // Kein Verbraucher: Wohin soll der Gegenstand? Erzeugung und Abgabe zeigen
    const producers = [...g.flow.machines.values()].filter((m) => m.outputs.some((o) => o.itemId === itemId));
    if (producers.length === 0) {
      itemSources(p, gd, g, factoryId, itemId, 0, out);
      return out;
    }
    out.push({ depth: 0, level: 'info', text: tr('Keine aufgestellte Maschine verbraucht {item}. Erzeuger:', { item: name }), objects: [] });
    const seen = new Set<string>();
    for (const m of producers) diagnoseBuilding(p, gd, g, m.buildingId, 1, seen, out);
    return out;
  }
  const short = consumers.filter((m) => {
    const i = m.inputs.find((x) => x.itemId === itemId)!;
    return i.received < i.nominal - 1e-4 || m.issues.some((x) => x.kind === 'input-missing' && x.itemId === itemId);
  });
  if (short.length === 0) {
    out.push({
      depth: 0,
      level: 'ok',
      text: tr('Alle {n} Abnehmer von {item} erhalten laut Planer ihre volle Menge.', { n: consumers.length, item: name }),
      objects: consumers.map((m) => bRef(m.buildingId)),
    });
    return out;
  }
  const seen = new Set<string>();
  for (const m of short) {
    const i = m.inputs.find((x) => x.itemId === itemId)!;
    out.push({
      depth: 0,
      level: i.received <= EPS ? 'error' : 'warning',
      text: tr('{name} erhält {got} von {need} {item}.', { name: label(p, gd, m.buildingId), got: formatNumber(i.received, 2), need: rateText(gd, itemId, i.nominal), item: name }),
      objects: [bRef(m.buildingId)],
    });
    diagnoseBuilding(p, gd, g, m.buildingId, 1, seen, out);
  }
  return out;
}

/** Häufige Ursachen, die der Planer nicht prüfen kann. */
export function uncheckedCauses(): string[] {
  return [
    tr('Im Spiel kann ein Band am falschen Anschluss oder falsch herum angeschlossen sein.'),
    tr('Splitter verteilen im Spiel gleichmäßig (mit Überlauf), der Planer rechnet mit der bestmöglichen Verteilung.'),
    tr('Filter intelligenter und programmierbarer Splitter werden nicht berücksichtigt.'),
    tr('Strom: Sicherung im Stromnetz ausgelöst, Netz überlastet oder Gebäude ohne Stromanschluss.'),
    tr('Rohre: Förderhöhe, fehlende Pumpe, Rückfluss oder Luft im Rohr nach Umbauten (im Spiel ggf. Leitung leeren).'),
    tr('Maschinen sind im Spiel ggf. pausiert, haben einen anderen Takt oder ein volles Ausgangslager.'),
  ];
}
