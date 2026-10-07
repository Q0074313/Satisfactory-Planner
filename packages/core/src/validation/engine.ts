/**
 * Prüfmotor: sammelt die Befunde aller Bereiche und berechnet nur die
 * Bereiche neu, deren Objekte sich geändert haben.
 *
 * Das Projekt wird unveränderlich (Immer) fortgeschrieben. Unveränderte
 * Objekte behalten ihre Identität. Je Fabrik bzw. Schienennetz wird die Liste
 * der beteiligten Objekte verglichen; sind alle identisch, wird das
 * zwischengespeicherte Ergebnis verwendet.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { getLanguage, type Lang } from '../i18n/index.ts';
import { checkFactory } from '../factory/checks.ts';
import { cachedFactoryFlow } from '../factory/flow.ts';
import { checkCrossNetwork, checkNetwork } from '../rail/checks.ts';
import { checkPlan } from '../production/checks.ts';
import { checkTransport } from '../transport/checks.ts';
import type { Project } from '../model/schema.ts';
import type { Finding } from './types.ts';

type Checker = (p: Project, gd: GameDataIndex, scopeId: string) => Finding[];

export interface ScopeDef {
  /** Bereichsname, z. B. 'factory'. */
  name: string;
  /** IDs aller Bereiche im Projekt (z. B. alle Fabriken). */
  scopes(p: Project): string[];
  /** Objekte, von denen das Ergebnis eines Bereichs abhängt. */
  dependencies(p: Project, scopeId: string): unknown[];
  check: Checker;
}

export const factoryScope: ScopeDef = {
  name: 'factory',
  scopes: (p) => Object.keys(p.factories),
  dependencies: (p, id) => [
    p.factories[id],
    ...Object.values(p.floors).filter((x) => x.factoryId === id),
    ...Object.values(p.areas).filter((x) => x.factoryId === id),
    ...Object.values(p.buildings).filter((x) => x.factoryId === id),
    ...Object.values(p.links).filter((x) => x.factoryId === id),
    ...Object.values(p.transportOrders).filter((o) => o.toFactoryId === id || o.fromFactoryId === id),
  ],
  check: (p, gd, id) => checkFactory(p, gd, id, { flow: cachedFactoryFlow(p, gd, id) }),
};

const byNetwork = <T extends { networkId: string }>(table: Record<string, T>, id: string) =>
  Object.values(table).filter((x) => x.networkId === id);

export const railScope: ScopeDef = {
  name: 'rail',
  scopes: (p) => Object.keys(p.railNetworks),
  dependencies: (p, id) => [
    p.railNetworks[id],
    ...byNetwork(p.railNodes, id),
    ...byNetwork(p.railSegments, id),
    ...byNetwork(p.railSignals, id),
    ...byNetwork(p.stations, id),
    ...byNetwork(p.trains, id),
    ...byNetwork(p.timetables, id),
  ],
  check: checkNetwork,
};

export const railCrossScope: ScopeDef = {
  name: 'rail-cross',
  scopes: (p) => (Object.keys(p.railNetworks).length > 1 ? ['all'] : []),
  dependencies: (p) => [p.railNetworks, p.railNodes, p.railSegments],
  check: (p) => checkCrossNetwork(p),
};

export const productionScope: ScopeDef = {
  name: 'plan',
  scopes: (p) => Object.keys(p.productionPlans),
  dependencies: (p, id) => {
    const plan = p.productionPlans[id];
    if (!plan) return [];
    return [
      plan,
      ...Object.values(p.buildings).filter((b) => b.factoryId === plan.factoryId),
      ...Object.values(p.links).filter((l) => l.factoryId === plan.factoryId),
      ...Object.values(p.transportOrders).filter((o) => o.toFactoryId === plan.factoryId),
    ];
  },
  check: (p, gd, id) => checkPlan(p, gd, id, { useCache: true }),
};

export const transportScope: ScopeDef = {
  name: 'transport',
  scopes: (p) =>
    Object.keys(p.transportOrders).length > 0 || Object.values(p.productionPlans).some((pl) => pl.supplies.some((s) => s.origin === 'import')) ? ['all'] : [],
  dependencies: (p) => [
    p.transportOrders,
    p.trains,
    p.timetables,
    p.stations,
    p.productionPlans,
    p.buildings,
    p.factories,
    p.railSegments,
    p.railNodes,
    p.railSignals,
    p.settings,
  ],
  check: (p, gd) => checkTransport(p, gd),
};

const sameList = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export interface ValidationResult {
  findings: Finding[];
  /** Neu berechnete Bereiche (für Tests und Diagnose). */
  recomputed: string[];
}

export function createValidator(scopes: ScopeDef[] = [factoryScope, railScope, railCrossScope, productionScope, transportScope]) {
  const cache = new Map<string, { deps: unknown[]; findings: Finding[]; gd: GameDataIndex; lang: Lang }>();
  return function validate(p: Project, gd: GameDataIndex): ValidationResult {
    const findings: Finding[] = [];
    const recomputed: string[] = [];
    const alive = new Set<string>();
    const lang = getLanguage();
    for (const scope of scopes) {
      for (const id of scope.scopes(p)) {
        const key = `${scope.name}:${id}`;
        alive.add(key);
        const deps = scope.dependencies(p, id);
        const hit = cache.get(key);
        if (hit && hit.gd === gd && hit.lang === lang && sameList(hit.deps, deps)) {
          findings.push(...hit.findings);
          continue;
        }
        const result = scope.check(p, gd, id);
        cache.set(key, { deps, findings: result, gd, lang });
        recomputed.push(key);
        findings.push(...result);
      }
    }
    for (const key of cache.keys()) if (!alive.has(key)) cache.delete(key);
    const order = { error: 0, warning: 1, info: 2 } as const;
    findings.sort((a, b) => order[a.severity] - order[b.severity] || a.ruleId.localeCompare(b.ruleId));
    return { findings, recomputed };
  };
}
