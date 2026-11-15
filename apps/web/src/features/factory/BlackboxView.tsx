/**
 * Fabrik als Blackbox: nur Ein- und Ausgänge, Maschinen und Strom laut den
 * Produktionsplänen, ohne Grundriss. Von hier aus geht es zum automatischen
 * Layout oder zurück zur Grundrissplanung.
 */
import { useMemo, type ReactNode } from 'react';
import { BLACKBOX_AREA_FACTOR, blackboxSideM, factoryOps as ops, factoryTrade, getLanguage, lockedRecipesOf, solveProduction } from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, Section } from '../../ui/fields';

interface Flow {
  itemId: string;
  perMin: number;
  /** Eingang: Zulieferung (Import) statt eigener Gewinnung. */
  imported?: boolean;
  /** Über Transportaufträge gedeckt bzw. abgeholt. */
  transport: number;
}

export function BlackboxView({ factoryId, bottom }: { factoryId: string; bottom?: ReactNode }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const f = project.factories[factoryId]!;
  const plans = useMemo(() => Object.values(project.productionPlans).filter((p) => p.factoryId === factoryId), [project.productionPlans, factoryId]);

  const summary = useMemo(() => {
    const inputs = new Map<string, { perMin: number; imported: boolean }>();
    const outputs = new Map<string, number>();
    const machines = new Map<string, number>();
    let power = 0;
    let generated = 0;
    let unsolved = 0;
    for (const plan of plans) {
      const res = solveProduction(gd, plan, { locked: lockedRecipesOf(project, gd) });
      if (res.status !== 'optimal') {
        unsolved++;
        continue;
      }
      const imported = new Set(plan.supplies.filter((s) => s.origin === 'import').map((s) => s.itemId));
      for (const it of res.items) {
        if (it.supplied > 1e-6) {
          const e = inputs.get(it.itemId) ?? { perMin: 0, imported: false };
          e.perMin += it.supplied;
          e.imported ||= imported.has(it.itemId);
          inputs.set(it.itemId, e);
        }
        const out = it.target + it.surplus;
        if (out > 1e-6) outputs.set(it.itemId, (outputs.get(it.itemId) ?? 0) + out);
      }
      for (const r of res.recipes) machines.set(r.building, (machines.get(r.building) ?? 0) + r.machinesCeil);
      power += res.powerMW;
      generated += res.generatedMW;
    }
    const trade = new Map(factoryTrade(project, gd, factoryId).map((r) => [r.itemId, r]));
    const byName = (a: { itemId: string }, b: { itemId: string }) => gd.name(a.itemId).localeCompare(gd.name(b.itemId), getLanguage());
    const ins: Flow[] = [...inputs].map(([itemId, v]) => ({ itemId, perMin: v.perMin, imported: v.imported, transport: trade.get(itemId)?.imports ?? 0 })).sort(byName);
    const outs: Flow[] = [...outputs].map(([itemId, perMin]) => ({ itemId, perMin, transport: trade.get(itemId)?.exports ?? 0 })).sort(byName);
    return { ins, outs, machines: [...machines].sort((a, b) => b[1] - a[1]), power, generated, unsolved };
  }, [plans, gd, project, factoryId]);

  const side = useMemo(() => blackboxSideM(project, gd, factoryId), [project, gd, factoryId]);
  const placed = Object.values(project.buildings).filter((b) => b.factoryId === factoryId && b.placement).length;
  const unit = (id: string) => (gd.item(id)?.form === 'solid' ? '/min' : 'm³/min');
  const flowList = (list: Flow[], dir: 'in' | 'out') =>
    list.length === 0 ? (
      <p className="dim small-text">{dir === 'in' ? t('Keine Eingänge.') : t('Keine Ausgänge.')}</p>
    ) : (
      <ul className="bb-flows">
        {list.map((x) => (
          <li key={x.itemId}>
            <strong>{gd.name(x.itemId)}</strong>
            <span>
              {fmtNum(x.perMin, 2)} {unit(x.itemId)}
            </span>
            {dir === 'in' && <Badge kind="muted">{x.imported ? t('Zulieferung') : t('eigene Gewinnung')}</Badge>}
            {x.transport > 1e-6 && (
              <Badge kind={x.transport + 1e-6 >= x.perMin ? 'ok' : 'warn'} title={dir === 'in' ? t('Über Transportaufträge angeliefert') : t('Über Transportaufträge abgeholt')}>
                {t('Transport {n}', { n: fmtNum(x.transport, 1) })}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <aside className="panel panel-left">
        <Section title={t('Blackbox')}>
          <p className="small-text">
            {t('„{name}“ wird nur über ihre Produktionspläne geplant: Ein- und Ausgänge, Maschinen und Strom. Grundriss, Leitungen und Übergaben werden nicht geprüft.', { name: f.name })}
          </p>
          <div className="stack">
            <button className="primary" data-testid="blackbox-autolayout" disabled={plans.length === 0} onClick={() => useUiStore.getState().openAutoLayout(factoryId, plans[0]?.id ?? null)}>
              {t('Layout automatisch erzeugen …')}
            </button>
            <button data-testid="blackbox-off" onClick={() => apply(t('Blackbox aus'), (d) => ops.updateFactory(d, factoryId, { blackbox: false }))}>
              {t('Grundriss selbst planen')}
            </button>
          </div>
          {placed > 0 && <p className="hint small-text">{t('{n} Gebäude im Grundriss bleiben erhalten, zählen in der Blackbox aber nicht.', { n: placed })}</p>}
        </Section>
        <Section title={t('Fläche')}>
          {side > 0 ? (
            <p className="small-text">
              {t('ca. {a} × {a} m (geschätzt aus den Maschinen, Faktor {f} für Leitungen und Wege)', { a: side, f: BLACKBOX_AREA_FACTOR })}
            </p>
          ) : (
            <p className="dim small-text">{t('Ohne Produktionsplan keine Schätzung.')}</p>
          )}
        </Section>
      </aside>
      <div className="center">
        <div className="scroll">
          {plans.length === 0 ? (
            <div className="empty pad">{t('Für eine Blackbox zuerst im Reiter „Produktion“ einen Produktionsplan anlegen.')}</div>
          ) : (
            <div className="blackbox" data-testid="blackbox-view">
              <div className="bb-col">
                <h3>{t('Eingänge')}</h3>
                {flowList(summary.ins, 'in')}
              </div>
              <div className="bb-box" style={{ borderColor: f.color }}>
                <h2>{f.name}</h2>
                <p className="dim small-text">{t('{n} Produktionsplan/-pläne', { n: plans.length })}</p>
                <ul className="bb-machines">
                  {summary.machines.map(([type, n]) => (
                    <li key={type}>
                      {n} × {gd.name(type)}
                    </li>
                  ))}
                </ul>
                <p>
                  {t('Strom: {mw} MW', { mw: fmtNum(summary.power, 1) })}
                  {summary.generated > 0 && <> · {t('erzeugt {n} MW', { n: fmtNum(summary.generated, 1) })}</>}
                </p>
                {summary.unsolved > 0 && <Badge kind="err">{t('{n} Plan/Pläne nicht lösbar', { n: summary.unsolved })}</Badge>}
              </div>
              <div className="bb-col">
                <h3>{t('Ausgänge')}</h3>
                {flowList(summary.outs, 'out')}
              </div>
            </div>
          )}
        </div>
        {bottom}
      </div>
    </>
  );
}
