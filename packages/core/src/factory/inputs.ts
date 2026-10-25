/**
 * Eingänge einer Fabrik: Lager bzw. Flüssigkeitspuffer, die nur abgeben und
 * von keiner Leitung der Fabrik beliefert werden (z. B. die Übergabelager des
 * Auto-Layouts). Je Eingang der Bedarf, den die Maschinen dahinter abnehmen
 * würden, und die Zulieferung über direkte Leitungen.
 *
 * Der Bedarf entsteht im Durchsatzmodell mit unbegrenzt versorgten Eingängen
 * (gedachte direkte Leitung je Eingang). Teilen sich mehrere Eingänge
 * dieselben Abnehmer, ist die Aufteilung zwischen ihnen nicht eindeutig.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import type { Project, TransportOrder } from '../model/schema.ts';
import { cachedFactoryFlow, computeFactoryFlow, factoryFlowDeps } from './flow.ts';
import { placedPortDefs } from './ports.ts';

export interface FactoryInput {
  buildingId: string;
  /** Gegenstand, den die Maschinen hinter dem Eingang verbrauchen (null: unklar). */
  itemId: string | null;
  kind: 'belt' | 'pipe';
  /** Bedarf der Abnehmer bei voller Versorgung (/min bzw. m³/min). */
  requiredPerMin: number;
  /** Direkte Leitungen (Transportaufträge), die an diesem Eingang ankommen. */
  directOrderIds: string[];
  /** Tatsächlich über diese direkten Leitungen geliefert (Durchsatzmodell). */
  directPerMin: number;
}

const cache = new Map<string, { deps: unknown[]; gd: GameDataIndex; result: FactoryInput[] }>();

export function factoryInputs(p: Project, gd: GameDataIndex, factoryId: string): FactoryInput[] {
  const deps = factoryFlowDeps(p, factoryId);
  const hit = cache.get(factoryId);
  if (hit && hit.gd === gd && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.result;
  const result = computeInputs(p, gd, factoryId);
  cache.set(factoryId, { deps, gd, result });
  return result;
}

function computeInputs(p: Project, gd: GameDataIndex, factoryId: string): FactoryInput[] {
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId);
  const fed = new Set(links.map((l) => l.to.buildingId));
  const outs = new Map<string, typeof links>();
  for (const l of links) outs.set(l.from.buildingId, [...(outs.get(l.from.buildingId) ?? []), l]);
  const candidates = Object.values(p.buildings).filter((b) => {
    if (b.factoryId !== factoryId || !b.placement || fed.has(b.id) || !outs.has(b.id)) return false;
    return gd.building(b.type)?.category === 'storage';
  });
  if (!candidates.length) return [];

  // Mögliche Gegenstände je Eingang: Eingänge der Maschinen dahinter (über Splitter, Zusammenführungen, Lager)
  const consumed = (startId: string, kind: 'belt' | 'pipe'): Map<string, number> => {
    const counts = new Map<string, number>();
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const l of outs.get(id) ?? []) {
        const b = p.buildings[l.to.buildingId];
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        const recipe = b.recipeId ? gd.recipe(b.recipeId) : undefined;
        if (recipe) {
          for (const x of recipe.inputs) {
            const fluid = (gd.item(x.item)?.form ?? 'solid') !== 'solid';
            if (fluid === (kind === 'pipe')) counts.set(x.item, (counts.get(x.item) ?? 0) + 1);
          }
        } else queue.push(b.id);
      }
    }
    return counts;
  };
  const directTo = (id: string) => Object.values(p.transportOrders).filter((o) => o.toFactoryId === factoryId && o.direct?.to?.buildingId === id);
  // Gegenstand: angeschlossene direkte Leitung, sonst Name im Etikett (Auto-Layout: „Eingang: Kohle“),
  // sonst der häufigste Verbrauch dahinter (bei Gleichstand der, den die wenigsten anderen Eingänge tragen)
  const options = candidates.map((b) => consumed(b.id, outs.get(b.id)![0]!.kind));
  const decided = candidates.map((b, i) => {
    const direct = directTo(b.id)[0]?.itemId;
    if (direct) return direct;
    const label = b.label.toLowerCase();
    const named = [...options[i]!.keys()].filter((it) => label.includes(gd.name(it).toLowerCase()));
    return named.length === 1 ? named[0]! : null;
  });
  const claims = (item: string) => decided.filter((x) => x === item).length;
  const itemOfIndex = (i: number): string | null =>
    decided[i] ??
    [...options[i]!.entries()].sort((a, b) => b[1] - a[1] || claims(a[0]) - claims(b[0]))[0]?.[0] ??
    null;

  const virtual: Record<string, TransportOrder> = {};
  const info = candidates.map((b, i) => {
    const kind = outs.get(b.id)![0]!.kind;
    const def = gd.building(b.type)!;
    const inPort = placedPortDefs(def, b.placement).find((x) => x.kind === kind && x.direction !== 'out');
    const itemId = itemOfIndex(i);
    const vid = `__input_demand__${b.id}`;
    if (itemId && inPort) {
      virtual[vid] = {
        id: vid,
        name: '',
        itemId,
        ratePerMin: 1e9,
        fromFactoryId: '__input_demand__',
        toFactoryId: factoryId,
        mode: kind,
        fromStationId: null,
        toStationId: null,
        trainIds: [],
        roundTripEstimateS: null,
        vehicle: null,
        drone: null,
        direct: { tier: kind === 'belt' ? gd.beltTiers.at(-1)!.id : gd.pipeTiers.at(-1)!.id, lines: 100, lengthM: 0, from: null, to: { buildingId: b.id, portId: inPort.id } },
      };
    }
    const directOrderIds = directTo(b.id).map((o) => o.id);
    return { b, kind, itemId, directOrderIds };
  });
  const supplied = computeFactoryFlow({ ...p, transportOrders: { ...p.transportOrders, ...virtual } }, gd, factoryId);
  const real = cachedFactoryFlow(p, gd, factoryId);
  return info.map(({ b, kind, itemId, directOrderIds }) => ({
    buildingId: b.id,
    itemId,
    kind,
    requiredPerMin: outs.get(b.id)!.reduce((s, l) => s + (supplied.links.get(l.id)?.total ?? 0), 0),
    directOrderIds,
    directPerMin: directOrderIds.reduce((s, id) => s + (real.direct.get(id)?.perMin ?? 0), 0),
  }));
}
