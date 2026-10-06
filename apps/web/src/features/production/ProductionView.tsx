/**
 * Produktionsplanung: Ziele, Versorgung, Rezeptauswahl, Ergebnis des
 * LP-Solvers (Tabelle oder Diagramm) und Abgleich mit den Maschinen der Fabrik.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  allowedRecipes,
  cachedFactoryFlow,
  compareBalance,
  getLanguage,
  itemStages,
  localName,
  productionOps as ops,
  resourceWeight,
  solveProduction,
  sortItems,
  transportNeed,
  type GameDataIndex,
  type ItemSort,
  type ProductionPlan,
  type SolveResult,
} from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section, Segmented, TextField } from '../../ui/fields';
import { SortSelect } from '../factory/BalancePanel';
import { FlowDiagram } from './FlowDiagram';

function ItemPicker({ onPick, placeholder, filter }: { onPick: (id: string) => void; placeholder: string; filter?: (id: string) => boolean }) {
  const gd = useProjectStore((s) => s.gd)!;
  const listId = useId();
  const [text, setText] = useState('');
  const items = useMemo(
    () => Object.values(gd.data.items).filter((i) => !filter || filter(i.id)).sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage())),
    [gd, filter],
  );
  const commit = (v: string, loose = false) => {
    const q = v.trim().toLowerCase();
    if (!q) return;
    let it = items.find((i) => i.name.de.toLowerCase() === q || i.name.en.toLowerCase() === q);
    if (!it && loose) {
      const hits = items.filter((i) => i.name.de.toLowerCase().includes(q) || i.name.en.toLowerCase().includes(q));
      if (hits.length === 1) it = hits[0];
    }
    if (it) {
      onPick(it.id);
      setText('');
    }
  };
  return (
    <>
      <input
        list={listId}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && commit(text, true)}
      />
      <datalist id={listId}>
        {items.map((i) => (
          <option key={i.id} value={localName(i.name)} />
        ))}
      </datalist>
    </>
  );
}

const unit = (gd: GameDataIndex, id: string) => (gd.item(id)?.form === 'solid' ? '/min' : 'm³/min');

export function ProductionView({ bottom }: { bottom?: ReactNode }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const factoryId = useUiStore((s) => s.factoryId);
  const setFactory = useUiStore((s) => s.setFactory);
  const [planId, setPlanId] = useState<string | null>(null);
  const plans = Object.values(project.productionPlans).filter((p) => p.factoryId === factoryId);
  const plan = (planId && project.productionPlans[planId]?.factoryId === factoryId ? project.productionPlans[planId] : plans[0]) ?? null;

  return (
    <>
      <aside className="panel panel-left" data-tour="production-left">
        <Section title={t('Fabrik')}>
          <select value={factoryId ?? ''} onChange={(e) => setFactory(e.target.value, project.factories[e.target.value]?.floorIds[0] ?? null)}>
            {Object.values(project.factories).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Section>
        <Section
          title={t('Produktionspläne')}
          actions={
            factoryId && (
              <button
                className="small"
                data-tour="add-plan"
                onClick={() => {
                  const id = apply(t('Plan anlegen'), (d) => ops.addPlan(d, factoryId, t('Plan {n}', { n: plans.length + 1 })));
                  if (id) setPlanId(id);
                }}
              >
                +
              </button>
            )
          }
        >
          <ul className="item-list">
            {plans.map((p) => (
              <li key={p.id} className={p.id === plan?.id ? 'active' : ''} onClick={() => setPlanId(p.id)}>
                <span>{p.name}</span>
                <span className="dim">{p.targets.map((x) => gd.name(x.itemId)).join(', ') || t('ohne Ziel')}</span>
              </li>
            ))}
          </ul>
          {plans.length === 0 && <p className="dim small-text">{t('Noch kein Plan – mit + anlegen.')}</p>}
        </Section>
        {plan && <PlanSettings plan={plan} />}
      </aside>
      <div className="center">
        <div className="scroll">{plan ? <PlanBody plan={plan} /> : <div className="empty pad">{t('Produktionsplan anlegen, um Ziele zu berechnen.')}</div>}</div>
        {bottom}
      </div>
    </>
  );
}

function PlanSettings({ plan }: { plan: ProductionPlan }) {
  const apply = useProjectStore((s) => s.apply);
  const upd = (label: string, patch: ops.PlanPatch) => apply(label, (d, g) => ops.updatePlan(d, g, plan.id, patch));
  return (
    <Section
      title={t('Einstellungen')}
      actions={
        <button className="small danger" onClick={() => apply(t('Plan löschen'), (d) => ops.removePlan(d, plan.id))}>
          {t('Löschen')}
        </button>
      }
    >
      <Row label={t('Name')}>
        <TextField value={plan.name} onCommit={(name) => upd(t('Plan umbenennen'), { name })} />
      </Row>
      <Row label={t('Modus')} hint={t('Zielmengen: Bedarf berechnen. Maximieren: aus begrenzten Rohstoffen/Maschinen so viel wie möglich im angegebenen Verhältnis.')}>
        <select value={plan.mode} onChange={(e) => upd(t('Modus'), { mode: e.target.value as ProductionPlan['mode'] })}>
          <option value="target">{t('Zielmengen vorgeben')}</option>
          <option value="maximize">{t('Maximieren (begrenzte Mittel)')}</option>
        </select>
      </Row>
      <Row label={t('Optimieren auf')}>
        <select value={plan.optimize} onChange={(e) => upd(t('Optimierung'), { optimize: e.target.value as ProductionPlan['optimize'] })}>
          <option value="resources">{t('Rohstoffe')}</option>
          <option value="power">{t('Strom')}</option>
          <option value="machines">{t('Maschinenzahl')}</option>
        </select>
      </Row>
      <label className="check-row" title={t('Nur die in der Fabrik angelegten Maschinen (mit Takt und Somersloops) verwenden')}>
        <input type="checkbox" checked={plan.limitToExistingMachines} onChange={(e) => upd(t('Maschinengrenze'), { limitToExistingMachines: e.target.checked })} />
        {t('Nur vorhandene Maschinen der Fabrik')}
      </label>
    </Section>
  );
}

function PlanBody({ plan }: { plan: ProductionPlan }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const buildings = useMemo(() => Object.values(project.buildings).filter((b) => b.factoryId === plan.factoryId), [project.buildings, plan.factoryId]);
  const result = useMemo(() => solveProduction(gd, plan, { existingMachines: buildings }), [gd, plan, buildings]);
  const upd = (label: string, patch: ops.PlanPatch) => apply(label, (d, g) => ops.updatePlan(d, g, plan.id, patch));
  const targetLabel = plan.mode === 'maximize' ? t('Verhältnis ändern') : t('Menge ändern');

  return (
    <div className="production">
      <div className="production-grid">
        <Section title={plan.mode === 'maximize' ? t('Zielprodukte (Verhältnis)') : t('Zielprodukte')}>
          {plan.targets.map((x, i) => (
            <Row key={x.itemId} label={gd.name(x.itemId)}>
              <span className="inline">
                <NumberField
                  value={x.ratePerMin}
                  min={0}
                  suffix={plan.mode === 'maximize' ? '×' : unit(gd, x.itemId)}
                  onCommit={(v) => upd(targetLabel, { targets: plan.targets.map((y, k) => (k === i ? { ...y, ratePerMin: v } : y)) })}
                />
                <button className="small" onClick={() => upd(t('Ziel entfernen'), { targets: plan.targets.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </span>
            </Row>
          ))}
          <ItemPicker
            placeholder={t('Zielprodukt hinzufügen …')}
            onPick={(id) => !plan.targets.some((x) => x.itemId === id) && upd(t('Ziel hinzufügen'), { targets: [...plan.targets, { itemId: id, ratePerMin: plan.mode === 'maximize' ? 1 : 10 }] })}
          />
        </Section>
        <Section title={t('Versorgung (Rohstoffe, Zulieferungen)')}>
          <p className="dim small-text">
            {plan.mode === 'maximize'
              ? t('Im Modus „Maximieren“ stehen nur hier eingetragene Mengen zur Verfügung (Wasser unbegrenzt).')
              : t('Rohstoffe sind ohne Eintrag unbegrenzt. Einträge begrenzen Rohstoffe oder erlauben Zulieferungen von Zwischenprodukten.')}
          </p>
          {plan.supplies.map((s, i) => (
            <Row key={s.itemId} label={gd.name(s.itemId)}>
              <span className="inline">
                <NumberField value={s.maxPerMin ?? NaN} min={0} suffix={unit(gd, s.itemId)} onCommit={(v) => upd(t('Versorgung ändern'), { supplies: plan.supplies.map((x, k) => (k === i ? { ...x, maxPerMin: v } : x)) })} />
                <select
                  value={s.origin}
                  title={t('Lokal gewonnen oder per Transport geliefert')}
                  onChange={(e) => upd(t('Herkunft'), { supplies: plan.supplies.map((x, k) => (k === i ? { ...x, origin: e.target.value as 'local' | 'import' } : x)) })}
                >
                  <option value="local">{t('lokal')}</option>
                  <option value="import">{t('Import')}</option>
                </select>
                <button className="small" onClick={() => upd(t('Versorgung entfernen'), { supplies: plan.supplies.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </span>
            </Row>
          ))}
          <ItemPicker
            placeholder={t('Versorgung hinzufügen …')}
            onPick={(id) =>
              !plan.supplies.some((s) => s.itemId === id) &&
              upd(t('Versorgung hinzufügen'), { supplies: [...plan.supplies, { itemId: id, maxPerMin: 60, origin: gd.item(id)?.isResource ? 'local' : 'import' }] })
            }
          />
        </Section>
      </div>
      <RecipeSelection plan={plan} result={result} />
      <ResultView plan={plan} result={result} />
      <BalanceView plan={plan} result={result} />
    </div>
  );
}

function RecipeSelection({ plan, result }: { plan: ProductionPlan; result: SolveResult }) {
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const used = new Set(result.recipes.map((r) => r.recipeId));
  const relevant = useMemo(() => {
    const all = Object.values(gd.data.recipes);
    const query = q.trim().toLowerCase();
    return all
      .filter((r) => !query || r.name.de.toLowerCase().includes(query) || r.name.en.toLowerCase().includes(query) || r.outputs.some((o) => gd.name(o.item).toLowerCase().includes(query)))
      .sort((a, b) => Number(b.alternate) - Number(a.alternate) || localName(a.name).localeCompare(localName(b.name), getLanguage()));
  }, [gd, q]);
  const enabled = new Set(plan.enabledAlternates);
  const disabled = new Set(plan.disabledRecipes);
  const allowedCount = allowedRecipes(gd, plan).length;
  const toggle = (id: string, alternate: boolean, on: boolean) => {
    if (alternate) {
      const next = on ? [...plan.enabledAlternates, id] : plan.enabledAlternates.filter((x) => x !== id);
      apply(t('Rezeptauswahl'), (d, g) => ops.updatePlan(d, g, plan.id, { enabledAlternates: next }));
    } else {
      const next = on ? plan.disabledRecipes.filter((x) => x !== id) : [...plan.disabledRecipes, id];
      apply(t('Rezeptauswahl'), (d, g) => ops.updatePlan(d, g, plan.id, { disabledRecipes: next }));
    }
  };
  const allAlternates = Object.values(gd.data.recipes).filter((r) => r.alternate).map((r) => r.id);
  return (
    <Section
      title={t('Rezeptauswahl ({a} zugelassen, {b} Alternativen)', { a: allowedCount, b: plan.enabledAlternates.length })}
      actions={
        <button className="small" onClick={() => setOpen(!open)}>
          {open ? t('zuklappen') : t('bearbeiten')}
        </button>
      }
    >
      {open && (
        <>
          <div className="inline">
            <input type="search" placeholder={t('Rezept oder Produkt suchen …')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="small" onClick={() => apply(t('Alle Alternativen'), (d, g) => ops.updatePlan(d, g, plan.id, { enabledAlternates: allAlternates }))}>
              {t('alle Alternativen')}
            </button>
            <button className="small" onClick={() => apply(t('Keine Alternativen'), (d, g) => ops.updatePlan(d, g, plan.id, { enabledAlternates: [] }))}>
              {t('keine')}
            </button>
          </div>
          <div className="recipe-grid">
            {relevant.map((r) => {
              const on = r.alternate ? enabled.has(r.id) : !disabled.has(r.id);
              return (
                <label
                  key={r.id}
                  className={`recipe-opt ${used.has(r.id) ? 'used' : ''}`}
                  title={`${r.inputs.map((a) => `${a.amount} ${gd.name(a.item)}`).join(' + ')} → ${r.outputs.map((a) => `${a.amount} ${gd.name(a.item)}`).join(' + ')} (${r.durationS} s, ${gd.name(r.producedIn[0]!)})`}
                >
                  <input type="checkbox" checked={on} onChange={(e) => toggle(r.id, r.alternate, e.target.checked)} />
                  <span>{localName(r.name)}</span>
                  {r.alternate && <Badge kind="info">{t('Alt')}</Badge>}
                  {used.has(r.id) && <Badge kind="ok">{t('genutzt')}</Badge>}
                </label>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}

function ResultView({ plan, result }: { plan: ProductionPlan; result: SolveResult }) {
  const gd = useProjectStore((s) => s.gd)!;
  const [view, setView] = useState<'table' | 'diagram'>('table');
  const [sort, setSort] = useState<ItemSort>('raw-first');
  const ok = result.status === 'optimal' && !result.items.some((i) => i.shortfall > 1e-6);
  const stages = useMemo(() => itemStages(gd, result), [gd, result]);
  const items = useMemo(() => sortItems(gd, result.items, sort, stages), [gd, result, sort, stages]);
  const recipes = useMemo(() => {
    if (sort === 'alpha') return [...result.recipes].sort((a, b) => gd.name(a.recipeId).localeCompare(gd.name(b.recipeId), getLanguage()));
    if (sort === 'throughput') return result.recipes;
    const st = (r: (typeof result.recipes)[number]) => Math.max(0, ...r.outputs.map((o) => stages.get(o.item) ?? 0));
    return [...result.recipes].sort((a, b) => (sort === 'raw-first' ? st(a) - st(b) : st(b) - st(a)) || gd.name(a.recipeId).localeCompare(gd.name(b.recipeId), getLanguage()));
  }, [result, sort, stages, gd]);
  return (
    <Section
      title={t('Ergebnis')}
      actions={
        <span className="inline">
          {view === 'table' && <SortSelect value={sort} onChange={setSort} />}
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: t('Tabelle') },
              { value: 'diagram', label: t('Diagramm') },
            ]}
          />
        </span>
      }
    >
      <div className={`result-banner ${ok ? 'ok' : 'bad'}`} data-testid="result-banner">
        <strong>{result.message}</strong>
        {result.status === 'optimal' && (
          <span>
            {' '}
            · {t('{n} Maschinen', { n: result.machineCount })} · {fmtNum(result.powerMW, 1)} MW ({t('bei gleichmäßigem Takt')})
          </span>
        )}
      </div>
      {result.bottlenecks.length > 0 && (
        <ul className="bottlenecks">
          {result.bottlenecks.map((b) => (
            <li key={`${b.kind}${b.id}`}>
              <Badge kind={b.kind === 'no-source' ? 'err' : 'warn'}>{b.kind === 'no-source' ? t('fehlende Quelle') : t('Engpass')}</Badge> {b.message}
            </li>
          ))}
        </ul>
      )}
      {view === 'diagram' ? (
        <FlowDiagram result={result} />
      ) : (
        <>
          {recipes.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Rezept')}</th>
                  <th>{t('Gebäude')}</th>
                  <th className="num">{t('Maschinen (exakt)')}</th>
                  <th className="num">{t('Aufstellung')}</th>
                  <th className="num">{t('Leistung')}</th>
                  <th>{t('Eingang /min')}</th>
                  <th>{t('Ausgang /min')}</th>
                </tr>
              </thead>
              <tbody>
                {recipes.map((r) => (
                  <tr key={`${r.recipeId}${r.boost}`}>
                    <td>
                      {gd.name(r.recipeId)} {gd.recipe(r.recipeId)?.alternate && <Badge kind="info">{t('Alt')}</Badge>}{' '}
                      {r.boost > 0 && <Badge kind="info">{t('Somersloop +{n} %', { n: r.boost * 100 })}</Badge>}
                    </td>
                    <td>{gd.name(r.building)}</td>
                    <td className="num">{fmtNum(r.machines, 4)}</td>
                    <td className="num">
                      {r.machinesCeil} × {fmtNum(r.clockEven * 100, 4)} %
                    </td>
                    <td className="num">{fmtNum(r.powerMW, 1)} MW</td>
                    <td className="small-text">{r.inputs.map((x) => `${fmtNum(x.perMin, 3)} ${gd.name(x.item)}`).join(', ')}</td>
                    <td className="small-text">{r.outputs.map((x) => `${fmtNum(x.perMin, 3)} ${gd.name(x.item)}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length > 0 && (
            <>
              <h4 className="sub">{t('Mengenbilanz und Transportbedarf')}</h4>
              <table className="table" data-testid="item-table">
                <thead>
                  <tr>
                    <th>{t('Gegenstand')}</th>
                    <th className="num">{t('Versorgung')}</th>
                    <th className="num">{t('Erzeugung')}</th>
                    <th className="num">{t('Verbrauch')}</th>
                    <th className="num">{t('Ziel')}</th>
                    <th className="num">{t('Überschuss')}</th>
                    <th className="num">{t('Fehlmenge')}</th>
                    <th title={t('Kleinste Band-/Rohrstufe für den Gesamtdurchsatz bzw. Anzahl paralleler Leitungen der höchsten Stufe')}>{t('Transport')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const tn = transportNeed(gd, i.itemId, i.throughput);
                    const res = gd.item(i.itemId)?.isResource;
                    return (
                      <tr key={i.itemId}>
                        <td>
                          {gd.name(i.itemId)}{' '}
                          {res && (
                            <Badge kind="muted" title={t('Gewicht im Solver: {w}', { w: fmtNum(resourceWeight(gd, i.itemId), 4) })}>
                              {t('Rohstoff')}
                            </Badge>
                          )}
                          {i.supplied > 0 && plan.supplies.find((s) => s.itemId === i.itemId)?.origin === 'import' && <Badge kind="info">{t('Import')}</Badge>}
                        </td>
                        <td className="num">{i.supplied ? fmtNum(i.supplied, 3) : ''}</td>
                        <td className="num">{i.produced ? fmtNum(i.produced, 3) : ''}</td>
                        <td className="num">{i.consumed ? fmtNum(i.consumed, 3) : ''}</td>
                        <td className="num">{i.target ? fmtNum(i.target, 3) : ''}</td>
                        <td className="num">{i.surplus > 1e-6 ? <span className="pos">{fmtNum(i.surplus, 3)}</span> : ''}</td>
                        <td className="num">{i.shortfall > 1e-6 ? <span className="neg">{fmtNum(i.shortfall, 3)}</span> : ''}</td>
                        <td className="small-text">
                          {fmtNum(i.throughput, 1)} {unit(gd, i.itemId)} → {tn.tier ? gd.name(tn.tier) : `${tn.parallelAtTop} × ${gd.name(tn.topTier ?? '')}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      <details className="assumptions">
        <summary>{t('Annahmen der Berechnung')}</summary>
        <ul>
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

function BalanceView({ plan, result }: { plan: ProductionPlan; result: SolveResult }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const [adjust, setAdjust] = useState(true);
  const cmp = useMemo(() => compareBalance(project, gd, plan.factoryId, result, { flow: cachedFactoryFlow(project, gd, plan.factoryId) }), [project, gd, plan.factoryId, result]);
  const cell = (v: number, soll: number) => <td className={`num ${soll > 0 && v + 1e-6 < soll ? 'neg' : ''}`}>{v ? fmtNum(v, 3) : '–'}</td>;
  return (
    <Section
      title={t('Abgleich mit der Fabrik: Soll → Geplant → Platziert → Angeschlossen → Durchsatz')}
      actions={
        <span className="inline">
          <label className="check-row small-text" title={t('Takte aller Maschinen eines Rezepts gleichmäßig auf das Soll setzen')}>
            <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} /> {t('Takt anpassen')}
          </label>
          <button
            className="primary"
            disabled={result.recipes.length === 0 || plan.limitToExistingMachines}
            onClick={() => {
              const r = apply(t('Maschinen anlegen'), (d, g) => ops.materializePlan(d, g, plan.factoryId, result.recipes.map((x) => ({ recipeId: x.recipeId, machines: x.machines })), { adjustClocks: adjust }));
              if (r) useUiStore.getState().toast(t('{n} Maschine(n) angelegt, {m} Takt(e) angepasst. Im Grundriss unter „Nicht platziert“.', { n: r.created.length, m: r.adjusted }));
            }}
          >
            {t('Maschinen in Fabrik anlegen')}
          </button>
        </span>
      }
    >
      <p className="dim small-text">
        {t(
          'Werte in Maschinenäquivalenten (Summe der Takte). Geplant = alle Maschinen der Fabrik mit dem Rezept, Platziert = davon im Grundriss, Angeschlossen = davon mit verbundenen Ein- und Ausgängen, Durchsatz = was mit den eingezeichneten Bändern und Rohren tatsächlich läuft (Durchsatzmodell).',
        )}
      </p>
      <table className="table" data-testid="balance-table">
        <thead>
          <tr>
            <th>{t('Rezept')}</th>
            <th className="num">{t('Soll')}</th>
            <th className="num">{t('Geplant')}</th>
            <th className="num">{t('Platziert')}</th>
            <th className="num">{t('Angeschlossen')}</th>
            <th className="num">{t('Durchsatz')}</th>
          </tr>
        </thead>
        <tbody>
          {cmp.recipes.map((r) => (
            <tr key={r.recipeId}>
              <td>
                {gd.name(r.recipeId)} <span className="dim small-text">({t('{n} Gebäude', { n: r.machinesGeplant })})</span>
              </td>
              <td className="num">{r.soll ? fmtNum(r.soll, 3) : '–'}</td>
              {cell(r.geplant, r.soll)}
              {cell(r.platziert, r.soll)}
              {cell(r.angeschlossen, r.soll)}
              {cell(r.durchsatz, r.soll)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim small-text">
        {t('Rot = unter Soll.')} {t('Fabrik')}: {project.factories[plan.factoryId]?.name}
      </p>
    </Section>
  );
}
