/**
 * Bilanz der angelegten Maschinen einer Fabrik: geplant (alle Maschinen),
 * davon im Grundriss platziert und laut Durchsatzmodell tatsächlich erreicht.
 * Ein- und Ausfuhren über Transportaufträge stehen daneben (lokal vs. extern).
 */
import { useMemo, useState } from 'react';
import { cachedFactoryFlow, factoryTrade, floorAreaStats, machineRates, sortItems, type ItemSort } from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { fmtNum } from '../../ui/fields';

export function BalancePanel() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const factoryId = useUiStore((s) => s.factoryId);
  const [sort, setSort] = useState<ItemSort>('alpha');

  const data = useMemo(() => {
    const rows = new Map<string, { itemId: string; planned: number; placed: number; achieved: number; prod: number; cons: number; imports: number; exports: number; throughput: number }>();
    const power = { planned: 0, placed: 0 };
    const machines = { planned: 0, placed: 0 };
    if (!factoryId) return { rows: [], power, machines };
    const flow = cachedFactoryFlow(project, gd, factoryId);
    const row = (item: string) => {
      let r = rows.get(item);
      if (!r) {
        r = { itemId: item, planned: 0, placed: 0, achieved: 0, prod: 0, cons: 0, imports: 0, exports: 0, throughput: 0 };
        rows.set(item, r);
      }
      return r;
    };
    for (const b of Object.values(project.buildings)) {
      if (b.factoryId !== factoryId) continue;
      const r = machineRates(gd, b);
      const placed = b.placement !== null;
      const util = flow.machines.get(b.id)?.utilization ?? 0;
      machines.planned++;
      if (placed) machines.placed++;
      power.planned += r.powerMW;
      if (placed) power.placed += r.powerMW;
      const add = (item: string, v: number) => {
        const x = row(item);
        x.planned += v;
        if (placed) x.placed += v;
        x.achieved += v * util;
        if (v > 0) x.prod += v;
        else x.cons -= v;
        x.throughput += Math.abs(v);
      };
      for (const o of r.outputs) add(o.item, o.perMin);
      for (const i of r.inputs) add(i.item, -i.perMin);
    }
    for (const tr of factoryTrade(project, gd, factoryId)) {
      if (tr.imports || tr.exports) {
        const x = row(tr.itemId);
        x.imports = tr.imports;
        x.exports = tr.exports;
      }
    }
    return { rows: [...rows.values()], power, machines };
  }, [project, gd, factoryId]);
  const sorted = useMemo(() => {
    const stages = new Map<string, number>();
    // Stufe grob: Rohstoffe 0, sonst nach Verbrauch/Erzeugung (Endprodukte = Überschuss ohne Verbrauch)
    for (const r of data.rows) stages.set(r.itemId, gd.item(r.itemId)?.isResource ? 0 : r.cons > 1e-9 ? 1 : 2);
    return sortItems(gd, data.rows, sort, stages);
  }, [data.rows, gd, sort]);

  if (!factoryId) return null;
  const cls = (v: number) => `num ${v < -1e-6 ? 'neg' : v > 1e-6 ? 'pos' : ''}`;
  return (
    <div className="balance">
      <div className="pad small-text inline">
        <span className="dim">
          {t('Maschinen: {a} geplant, davon {b} platziert · Leistung: {p} MW geplant, {q} MW platziert.', {
            a: data.machines.planned,
            b: data.machines.placed,
            p: fmtNum(data.power.planned),
            q: fmtNum(data.power.placed),
          })}
        </span>
        <span className="spacer" />
        <SortSelect value={sort} onChange={setSort} />
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t('Gegenstand')}</th>
            <th className="num">{t('Erzeugung')}</th>
            <th className="num">{t('Verbrauch')}</th>
            <th className="num">{t('Saldo geplant')}</th>
            <th className="num">{t('Saldo platziert')}</th>
            <th className="num" title={t('Saldo der tatsächlich laufenden Maschinen laut Durchsatzmodell der eingezeichneten Verbindungen')}>
              {t('Saldo Durchsatz')}
            </th>
            <th className="num" title={t('Transportaufträge an diese Fabrik')}>
              {t('Einfuhr')}
            </th>
            <th className="num" title={t('Transportaufträge aus dieser Fabrik')}>
              {t('Ausfuhr')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.itemId}>
              <td>
                {gd.name(r.itemId)}
                {gd.item(r.itemId)?.form !== 'solid' && <span className="dim"> (m³)</span>}
              </td>
              <td className="num">{fmtNum(r.prod, 3)}</td>
              <td className="num">{fmtNum(r.cons, 3)}</td>
              <td className={cls(r.planned)}>{fmtNum(r.planned, 3)}</td>
              <td className={cls(r.placed)}>{fmtNum(r.placed, 3)}</td>
              <td className={cls(r.achieved)}>{fmtNum(r.achieved, 3)}</td>
              <td className="num">{r.imports ? fmtNum(r.imports, 3) : ''}</td>
              <td className="num">{r.exports ? fmtNum(r.exports, 3) : ''}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={8} className="dim">
                {t('Noch keine Maschinen mit Rezept.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="dim small-text pad">{t('Positive Werte = Überschuss, negative = Bedarf. Den Abgleich mit dem Soll eines Produktionsplans zeigt die Ansicht „Produktion“.')}</p>
    </div>
  );
}

export function SortSelect({ value, onChange }: { value: ItemSort; onChange: (v: ItemSort) => void }) {
  return (
    <label className="inline small-text" data-testid="item-sort">
      <span className="dim">{t('Sortierung')}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as ItemSort)}>
        <option value="alpha">{t('alphabetisch')}</option>
        <option value="raw-first">{t('Rohstoff → Endprodukt')}</option>
        <option value="final-first">{t('Endprodukt → Rohstoff')}</option>
        <option value="throughput">{t('nach Durchsatz')}</option>
      </select>
    </label>
  );
}

export function AreaStatsPanel() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const factoryId = useUiStore((s) => s.factoryId);
  const stats = useMemo(() => (factoryId ? floorAreaStats(project, gd, factoryId) : []), [project, gd, factoryId]);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('Stockwerk')}</th>
          <th className="num">{t('Gebäude')}</th>
          <th className="num" title={t('Vereinigte Grundfläche der festen Kollisionsboxen')}>
            {t('Belegte Grundfläche')}
          </th>
          <th className="num">{t('Ausdehnung')}</th>
          <th className="num">{t('Baufläche')}</th>
          <th className="num">{t('Fundamente')}</th>
          <th className="num">{t('Planungsabstände')}</th>
          <th className="num" title={t('Belegte Grundfläche / Baufläche')}>
            {t('Auslastung')}
          </th>
        </tr>
      </thead>
      <tbody>
        {[...stats].reverse().map((s) => (
          <tr key={s.floorId}>
            <td>{project.floors[s.floorId]?.name}</td>
            <td className="num">{s.buildingCount}</td>
            <td className="num">{fmtNum(s.occupiedM2, 1)} m²</td>
            <td className="num">{s.extent ? `${fmtNum(s.extent.widthM, 1)} × ${fmtNum(s.extent.depthM, 1)} m` : '–'}</td>
            <td className="num">{s.buildAreaM2 ? `${fmtNum(s.buildAreaM2, 1)} m²` : '–'}</td>
            <td className="num">{s.foundationM2 ? `${fmtNum(s.foundationM2, 1)} m²` : '–'}</td>
            <td className="num">{s.clearanceM2 ? `${fmtNum(s.clearanceM2, 1)} m²` : '–'}</td>
            <td className="num">{s.buildAreaM2 ? `${fmtNum((s.occupiedM2 / s.buildAreaM2) * 100, 1)} %` : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
