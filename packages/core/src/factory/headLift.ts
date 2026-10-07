/**
 * Förderhöhe von Rohrleitungen.
 *
 * Quellen: Wiki „Head lift“ und „Pipeline Pump“. Extraktoren, Raffinerie,
 * Umfüllanlage, Mixer und Flüssigkeits-Frachtplattform heben Flüssigkeiten
 * 10 m, Speicher 8 bzw. 12 m, Pumpen 20 m (Mk.1) bzw. 50 m (Mk.2) über ihren
 * Anschluss (empfohlene Werte; tatsächlich etwas mehr). Rohrkreuzungen und
 * Ventile geben die höchste ankommende Förderhöhe weiter. Gase brauchen
 * keine Förderhöhe.
 *
 * Modell: Jede Leitung hat eine absolute „erreichbare Höhe“ (Anschlusshöhe
 * der Quelle + Förderhöhe). Steigt der Rohrverlauf darüber, kommt die
 * Flüssigkeit nicht an.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import type { GdBuilding } from '../gamedata/types.ts';
import type { LogisticsLink, Project } from '../model/schema.ts';
import type { FactoryFlow } from './flow.ts';
import { linkEnds, linkPath } from './linkPath.ts';
import { worldPorts } from './ports.ts';

export interface PipeHead {
  linkId: string;
  /** Höchster Punkt des Rohrverlaufs (absolute Höhe). */
  maxZ: number;
  /** Höhe am Anfang der Leitung. */
  startZ: number;
  /** Erreichbare Höhe (absolute Höhe) oder null, wenn die Quelle keine bekannte Förderhöhe hat. */
  reachZ: number | null;
  /** Gebäude, dessen Förderhöhe gilt (Quelle oder Pumpe). */
  sourceId: string | null;
  /** Förderhöhe der Quelle in Metern. */
  liftM: number | null;
  /** Leitung führt nur Gase (keine Förderhöhe nötig). */
  gas: boolean;
}

/** Förderhöhe eines Gebäudes: Zahl, „weiterreichen“ oder unbekannt. */
export function headLiftOf(gd: GameDataIndex, def: GdBuilding | undefined): number | 'pass' | null {
  if (!def) return null;
  if (def.pump) return def.pump.designHeadM;
  const fact = gd.fact(`fluid.headLiftM.${def.id}`);
  if (fact !== undefined) return fact;
  const pr = def.ports;
  if (pr && pr.pipeAny > 0) return 'pass';
  if (def.id === 'Build_Valve_C') return 'pass';
  return null;
}

export function pipeHeads(p: Project, gd: GameDataIndex, factoryId: string, flow?: FactoryFlow): Map<string, PipeHead> {
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId && l.kind === 'pipe');
  const incoming = new Map<string, LogisticsLink[]>();
  for (const l of links) incoming.set(l.to.buildingId, [...(incoming.get(l.to.buildingId) ?? []), l]);
  const out = new Map<string, PipeHead>();
  const reach = new Map<string, { z: number | null; sourceId: string | null; liftM: number | null }>();
  const visiting = new Set<string>();

  const reachOf = (l: LogisticsLink): { z: number | null; sourceId: string | null; liftM: number | null } => {
    const cached = reach.get(l.id);
    if (cached) return cached;
    if (visiting.has(l.id)) return { z: null, sourceId: null, liftM: null };
    visiting.add(l.id);
    let r: { z: number | null; sourceId: string | null; liftM: number | null } = { z: null, sourceId: null, liftM: null };
    const b = p.buildings[l.from.buildingId];
    const def = b ? gd.building(b.type) : undefined;
    const lift = headLiftOf(gd, def);
    const ends = linkEnds(p, gd, l);
    if (typeof lift === 'number' && ends && b?.placement && def) {
      // Pumpen messen ab dem Eingang, andere Gebäude ab ihrem Ausgang
      let baseZ = ends.from.world.z;
      if (def.pump) {
        const inlet = worldPorts(b, def, p.floors[b.placement.floorId]).find((x) => x.direction === 'in');
        if (inlet) baseZ = Math.min(baseZ, inlet.world.z);
      }
      r = { z: baseZ + lift, sourceId: b.id, liftM: lift };
    } else if (lift === 'pass' && b) {
      for (const inc of incoming.get(b.id) ?? []) {
        const x = reachOf(inc);
        if (x.z !== null && (r.z === null || x.z > r.z)) r = x;
      }
    }
    visiting.delete(l.id);
    reach.set(l.id, r);
    return r;
  };

  for (const l of links) {
    const path = linkPath(p, gd, l);
    if (!path || path.length < 2) continue;
    const fr = flow?.links.get(l.id);
    const items = fr ? [...fr.items, ...fr.requiredItems].filter((x) => x.perMin > 1e-6).map((x) => x.itemId) : [];
    const gas = items.length > 0 && items.every((id) => gd.item(id)?.form === 'gas');
    const r = reachOf(l);
    out.set(l.id, {
      linkId: l.id,
      maxZ: Math.max(...path.map((q) => q.z)),
      startZ: path[0]!.z,
      reachZ: r.z,
      sourceId: r.sourceId,
      liftM: r.liftM,
      gas,
    });
  }
  return out;
}
