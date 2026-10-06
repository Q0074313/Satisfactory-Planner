/**
 * Befunde zu Produktionsplänen.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { Project } from '../model/schema.ts';
import { defineRule, makeFinding } from '../validation/registry.ts';
import type { Finding } from '../validation/types.ts';
import { cachedFactoryFlow } from '../factory/flow.ts';
import { compareBalance } from './balance.ts';
import { solveProduction } from './solver.ts';

const SRC = { label: 'Rezepte aus den Satisfactory-Docs (Spieldaten)' };

export const PROD_UNREACHABLE = defineRule({
  id: 'PROD-001',
  title: 'Produktionsziel nicht erreichbar',
  domain: 'production',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Mit den zugelassenen Rezepten, Rohstoffen und Maschinengrenzen lässt sich die Zielmenge nicht herstellen.',
  sources: [SRC],
});

export const PROD_BOTTLENECK = defineRule({
  id: 'PROD-002',
  title: 'Engpass: Versorgung oder Maschinen ausgeschöpft',
  domain: 'production',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Eine Rohstoff- oder Maschinengrenze begrenzt das Ergebnis.',
  sources: [SRC],
});

export const PROD_MISSING_MACHINES = defineRule({
  id: 'PROD-003',
  title: 'Fabrik hat weniger Maschinen als der Plan',
  domain: 'production',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description: 'Für ein Rezept sind in der Fabrik weniger Maschinenäquivalente (Summe der Takte) angelegt, als der Produktionsplan benötigt.',
  sources: [{ label: 'Abgleich Produktionsplan ↔ Fabrik' }],
});

export const PROD_SOLVER = defineRule({
  id: 'PROD-004',
  title: 'Produktionsplan nicht lösbar',
  domain: 'production',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Die Vorgaben des Plans widersprechen sich oder sind unvollständig (z. B. unbeschränkte Maximierung).',
  sources: [SRC],
});

/**
 * `useCache`: Durchsatzmodell aus dem Zwischenspeicher verwenden. Nur sicher,
 * wenn das Projekt unveränderlich fortgeschrieben wird (Immer), wie im Prüfmotor.
 */
export function checkPlan(p: Project, gd: GameDataIndex, planId: string, opts: { useCache?: boolean } = {}): Finding[] {
  const plan = p.productionPlans[planId];
  if (!plan) return [];
  const out: Finding[] = [];
  const ref = { table: 'productionPlans' as const, id: planId };
  const existing = Object.values(p.buildings).filter((b) => b.factoryId === plan.factoryId);
  const res = solveProduction(gd, plan, { existingMachines: existing });
  if (res.status !== 'optimal') {
    out.push(
      makeFinding(PROD_SOLVER, [ref], {
        message: tr('Plan „{plan}“: {msg}', { plan: plan.name, msg: res.message }),
        explanation: tr(PROD_SOLVER.description),
        suggestion: tr('Ziele, Versorgung und Grenzen des Plans prüfen.'),
      }),
    );
    return out;
  }
  for (const it of res.items) {
    if (it.shortfall <= 1e-6) continue;
    const reasons = res.bottlenecks.map((b) => b.message).join(' ');
    out.push(
      makeFinding(PROD_UNREACHABLE, [ref], {
        message: tr('Plan „{plan}“: {item} – es fehlen {n}/min', { plan: plan.name, item: gd.name(it.itemId), n: formatNumber(it.shortfall, 3) }),
        explanation: `${tr(PROD_UNREACHABLE.description)} ${reasons}`.trim(),
        suggestion: tr('Alternativrezepte freischalten, Rohstoffgrenzen erhöhen, Zulieferung (Import) ergänzen oder Ziel verringern.'),
      }, { keyExtra: it.itemId }),
    );
  }
  for (const b of res.bottlenecks) {
    if (b.kind === 'no-source') continue;
    out.push(
      makeFinding(
        PROD_BOTTLENECK,
        [ref],
        { message: tr('Plan „{plan}“: {msg}', { plan: plan.name, msg: b.message }), explanation: tr(PROD_BOTTLENECK.description), suggestion: tr('Grenze anheben oder alternative Rezepte zulassen.') },
        { keyExtra: b.id },
      ),
    );
  }
  if (!plan.limitToExistingMachines) {
    const cmp = compareBalance(p, gd, plan.factoryId, res, opts.useCache ? { flow: cachedFactoryFlow(p, gd, plan.factoryId) } : {});
    const missing = cmp.recipes.filter((r) => r.soll - r.geplant > 1e-4);
    if (missing.length) {
      out.push(
        makeFinding(PROD_MISSING_MACHINES, [ref], {
          message: tr('Plan „{plan}“: {n} Rezept(e) mit zu wenigen Maschinen in der Fabrik', { plan: plan.name, n: missing.length }),
          explanation: missing
            .map((r) => tr('{recipe}: Soll {soll}, angelegt {ist}', { recipe: gd.name(r.recipeId), soll: formatNumber(r.soll, 3), ist: formatNumber(r.geplant, 3) }))
            .join('; '),
          suggestion: tr('In der Produktionsansicht „Maschinen anlegen“ verwenden und sie anschließend im Grundriss platzieren.'),
        }),
      );
    }
  }
  return out;
}
