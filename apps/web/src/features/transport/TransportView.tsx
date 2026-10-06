/**
 * Transportplanung zwischen Fabriken: Aufträge, Zugzuordnung, geschätzter
 * Durchsatz mit offengelegten Annahmen, Ein-/Ausfuhrbilanz je Fabrik.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  cargoKind,
  estimateOrder,
  factoryTrade,
  getLanguage,
  localName,
  transportAssumptions,
  transportOps as ops,
  type TransportOrder,
} from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useSimStore } from '../../state/simStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section, TextField } from '../../ui/fields';

const unitOf = (kind: 'solid' | 'liquid') => (kind === 'solid' ? '/min' : 'm³/min');

/** Gemessene Umlaufzeiten aus einer laufenden bzw. ausgewerteten Simulation. */
function useMeasured(): Map<string, number> {
  useSimStore((s) => s.tick);
  const sim = useSimStore.getState().sim;
  return useMemo(() => new Map((sim?.summary() ?? []).filter((s) => s.cycleS).map((s) => [s.trainId, s.cycleS!])), [sim, sim?.time]);
}

export function TransportView({ bottom }: { bottom?: ReactNode }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const orders = Object.values(project.transportOrders);
  const selectedId = selection.find((s) => s.table === 'transportOrders')?.id ?? null;
  const factories = Object.values(project.factories);
  const measured = useMeasured();

  const addOrder = () => {
    if (factories.length < 2) {
      useUiStore.getState().toast(t('Für einen Transportauftrag werden mindestens zwei Fabriken benötigt.'), 'error');
      return;
    }
    const id = apply(t('Transportauftrag anlegen'), (d, g) =>
      ops.addOrder(d, g, {
        name: '',
        itemId: 'Desc_OreIron_C',
        ratePerMin: 60,
        fromFactoryId: factories[0]!.id,
        toFactoryId: factories[1]!.id,
        fromStationId: null,
        toStationId: null,
        trainIds: [],
        roundTripEstimateS: null,
      }),
    );
    if (id) select([{ table: 'transportOrders', id }]);
  };

  return (
    <>
      <aside className="panel panel-left" data-tour="transport-left">
        <Section
          title={t('Transportaufträge')}
          actions={
            <button className="small" onClick={addOrder} data-tour="add-order">
              +
            </button>
          }
        >
          <ul className="item-list">
            {orders.map((o) => (
              <li key={o.id} className={o.id === selectedId ? 'active' : ''} onClick={() => select([{ table: 'transportOrders', id: o.id }])}>
                <span>{o.name || gd.name(o.itemId)}</span>
                <span className="dim">
                  {project.factories[o.fromFactoryId]?.name} → {project.factories[o.toFactoryId]?.name}
                </span>
              </li>
            ))}
          </ul>
          {orders.length === 0 && <p className="dim small-text">{t('Noch kein Auftrag – mit + anlegen. Aufträge beschreiben, welche Fabrik wie viel an welche andere liefert.')}</p>}
        </Section>
        <AssumptionsSection />
      </aside>
      <div className="center">
        <div className="scroll">
          <div className="production">
            <OrdersTable measured={measured} />
            <TradeSection />
          </div>
        </div>
        {bottom}
      </div>
      <aside className="panel panel-right" data-tour="properties">
        {selectedId && project.transportOrders[selectedId] ? (
          <OrderProps order={project.transportOrders[selectedId]!} measured={measured} />
        ) : (
          <p className="dim pad">{t('Auftrag links auswählen oder anlegen.')}</p>
        )}
      </aside>
    </>
  );
}

function AssumptionsSection() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const s = project.settings.simulation;
  return (
    <Section title={t('Annahmen (Schätzung)')}>
      <Row label={t('Ø Geschwindigkeit')} hint={t('Durchschnitt inklusive Anfahren und Bremsen; die Lok fährt laut Wiki höchstens 120 km/h.')}>
        <NumberField value={s.trainAverageSpeedKmh} min={1} max={200} suffix="km/h" onCommit={(v) => apply(t('Annahme Geschwindigkeit'), (d) => void (d.settings.simulation.trainAverageSpeedKmh = v))} />
      </Row>
      <Row label={t('Umschlag je Halt')} hint={t('Wiki „Freight Platform“: 27,08 s')}>
        <NumberField value={s.dockingS} min={0} suffix="s" onCommit={(v) => apply(t('Annahme Umschlag'), (d) => void (d.settings.simulation.dockingS = v))} />
      </Row>
      <details className="assumptions" open>
        <summary>{t('Grundlagen der Schätzung')}</summary>
        <ul>
          {transportAssumptions(project, gd).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

function OrdersTable({ measured }: { measured: Map<string, number> }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const select = useUiStore((s) => s.select);
  const orders = Object.values(project.transportOrders);
  const rows = useMemo(() => orders.map((o) => ({ o, est: estimateOrder(project, gd, o, { measuredCycleS: measured }) })), [orders, project, gd, measured]);
  return (
    <Section title={t('Aufträge und Zugdurchsatz')}>
      {rows.length === 0 ? (
        <p className="dim">{t('Keine Transportaufträge.')}</p>
      ) : (
        <table className="table" data-testid="orders-table">
          <thead>
            <tr>
              <th>{t('Auftrag')}</th>
              <th>{t('Von → Nach')}</th>
              <th className="num">{t('Menge')}</th>
              <th>{t('Züge')}</th>
              <th className="num" title={t('Kapazität je Umlauf × Anteil / Umlaufzeit')}>
                {t('Durchsatz (Schätzung)')}
              </th>
              <th>{t('Status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, est }) => {
              const u = unitOf(cargoKind(gd, o.itemId));
              return (
                <tr key={o.id} onClick={() => select([{ table: 'transportOrders', id: o.id }])} className="clickable">
                  <td>{o.name || gd.name(o.itemId)}</td>
                  <td>
                    {project.factories[o.fromFactoryId]?.name} → {project.factories[o.toFactoryId]?.name}
                  </td>
                  <td className="num">
                    {fmtNum(o.ratePerMin, 1)} {u}
                  </td>
                  <td>{o.trainIds.map((id) => project.trains[id]?.name).join(', ') || <span className="dim">–</span>}</td>
                  <td className="num">
                    {est.trains.length ? `${fmtNum(est.perMin, 1)} ${u}` : '–'}
                    {est.trains.some((x) => x.cycleSource === 'measured') && (
                      <Badge kind="info" title={t('Umlaufzeit aus der Simulation')}>
                        {t('gemessen')}
                      </Badge>
                    )}
                    {est.trains.some((x) => x.cycleSource === 'manual') && <Badge kind="muted">{t('manuell')}</Badge>}
                  </td>
                  <td>
                    {o.trainIds.length === 0 ? (
                      <Badge kind="warn">{t('kein Zug')}</Badge>
                    ) : est.ok ? (
                      <Badge kind="ok">{t('reicht (geschätzt)')}</Badge>
                    ) : (
                      <Badge kind="err">{t('zu wenig (geschätzt)')}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="dim small-text">{t('Alle Durchsatzwerte sind Schätzungen. Mit der Simulation im Schienennetz gemessene Umlaufzeiten ersetzen die Schätzung, sobald ein Zug mindestens zwei Umläufe gefahren ist.')}</p>
    </Section>
  );
}

function TradeSection() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const factories = Object.values(project.factories);
  const [fid, setFid] = useState<string>(factories[0]?.id ?? '');
  const rows = useMemo(() => (fid ? factoryTrade(project, gd, fid).sort((a, b) => gd.name(a.itemId).localeCompare(gd.name(b.itemId), getLanguage())) : []), [project, gd, fid]);
  return (
    <Section
      title={t('Bilanz je Fabrik: lokal und extern')}
      actions={
        <select value={fid} onChange={(e) => setFid(e.target.value)}>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      }
    >
      <table className="table" data-testid="trade-table">
        <thead>
          <tr>
            <th>{t('Gegenstand')}</th>
            <th className="num">{t('Erzeugung')}</th>
            <th className="num">{t('Verbrauch')}</th>
            <th className="num">{t('Netto lokal')}</th>
            <th className="num">{t('Einfuhr')}</th>
            <th className="num">{t('Ausfuhr')}</th>
            <th className="num" title={t('Importbedarf laut Produktionsplänen der Fabrik')}>
              {t('Importbedarf (Plan)')}
            </th>
            <th>{t('Lücke')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              <td>{gd.name(r.itemId)}</td>
              <td className="num">{r.produced ? fmtNum(r.produced, 2) : ''}</td>
              <td className="num">{r.consumed ? fmtNum(r.consumed, 2) : ''}</td>
              <td className={`num ${r.net < -1e-6 ? 'neg' : r.net > 1e-6 ? 'pos' : ''}`}>{fmtNum(r.net, 2)}</td>
              <td className="num">{r.imports ? fmtNum(r.imports, 2) : ''}</td>
              <td className="num">{r.exports ? fmtNum(r.exports, 2) : ''}</td>
              <td className="num">{r.planImports ? fmtNum(r.planImports, 2) : ''}</td>
              <td>
                {r.importGap > 1e-6 && <Badge kind="warn">{t('Import fehlt {n}', { n: fmtNum(r.importGap, 2) })}</Badge>}{' '}
                {r.exportGap > 1e-6 && <Badge kind="warn">{t('Ausfuhr ohne Deckung {n}', { n: fmtNum(r.exportGap, 2) })}</Badge>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="dim">
                {t('Keine Maschinen oder Aufträge in dieser Fabrik.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="dim small-text">{t('Erzeugung und Verbrauch der angelegten Maschinen (mit Takt). Importbedarf: Mengen, die Produktionspläne dieser Fabrik als Import beziehen.')}</p>
    </Section>
  );
}

function OrderProps({ order: o, measured }: { order: TransportOrder; measured: Map<string, number> }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const listId = useId();
  const upd = (label: string, patch: ops.OrderPatch) => apply(label, (d, g) => ops.updateOrder(d, g, o.id, patch));
  const est = estimateOrder(project, gd, o, { measuredCycleS: measured });
  const factories = Object.values(project.factories);
  const stations = Object.values(project.stations);
  const trains = Object.values(project.trains);
  const items = useMemo(() => Object.values(gd.data.items).sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage())), [gd]);
  const u = unitOf(cargoKind(gd, o.itemId));
  const stationOptions = (factoryId: string) => [...stations].sort((a, b) => Number(b.factoryId === factoryId) - Number(a.factoryId === factoryId));
  return (
    <>
      <Section title={t('Transportauftrag')}>
        <Row label={t('Name')}>
          <TextField value={o.name} placeholder={gd.name(o.itemId)} onCommit={(name) => upd(t('Auftrag umbenennen'), { name })} />
        </Row>
        <Row label={t('Gegenstand')}>
          <input
            list={listId}
            defaultValue={gd.name(o.itemId)}
            key={o.itemId}
            onChange={(e) => {
              const it = items.find((i) => localName(i.name).toLowerCase() === e.target.value.trim().toLowerCase());
              if (it && it.id !== o.itemId) upd(t('Gegenstand'), { itemId: it.id });
            }}
          />
          <datalist id={listId}>
            {items.map((i) => (
              <option key={i.id} value={localName(i.name)} />
            ))}
          </datalist>
        </Row>
        <Row label={t('Menge')}>
          <NumberField value={o.ratePerMin} min={0} suffix={u} onCommit={(v) => upd(t('Menge'), { ratePerMin: v })} />
        </Row>
        <Row label={t('Von Fabrik')}>
          <select value={o.fromFactoryId} onChange={(e) => upd(t('Absender'), { fromFactoryId: e.target.value })}>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('Ladebahnhof')}>
          <select value={o.fromStationId ?? ''} onChange={(e) => upd(t('Ladebahnhof'), { fromStationId: e.target.value || null })}>
            <option value="">{t('– beliebig –')}</option>
            {stationOptions(o.fromFactoryId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.factoryId ? ` (${project.factories[s.factoryId]?.name})` : ''}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('Nach Fabrik')}>
          <select value={o.toFactoryId} onChange={(e) => upd(t('Empfänger'), { toFactoryId: e.target.value })}>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('Entladebahnhof')}>
          <select value={o.toStationId ?? ''} onChange={(e) => upd(t('Entladebahnhof'), { toStationId: e.target.value || null })}>
            <option value="">{t('– beliebig –')}</option>
            {stationOptions(o.toFactoryId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.factoryId ? ` (${project.factories[s.factoryId]?.name})` : ''}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('Umlaufzeit manuell')} hint={t('Leer = aus Strecke und Annahmen schätzen bzw. aus der Simulation messen')}>
          <NumberField value={o.roundTripEstimateS ?? NaN} min={1} suffix="s" onCommit={(v) => upd(t('Umlaufzeit'), { roundTripEstimateS: v })} />
        </Row>
        {o.roundTripEstimateS !== null && (
          <div className="button-row">
            <button className="small" onClick={() => upd(t('Umlaufzeit'), { roundTripEstimateS: null })}>
              {t('Schätzung verwenden')}
            </button>
          </div>
        )}
      </Section>
      <Section title={t('Züge')}>
        {trains.length === 0 && <p className="dim small-text">{t('Noch keine Züge – im Schienennetz anlegen.')}</p>}
        {trains.map((tr) => (
          <label key={tr.id} className="check-row">
            <input
              type="checkbox"
              checked={o.trainIds.includes(tr.id)}
              onChange={(e) => upd(t('Züge zuordnen'), { trainIds: e.target.checked ? [...o.trainIds, tr.id] : o.trainIds.filter((x) => x !== tr.id) })}
            />
            <span className="swatch" style={{ background: tr.color }} /> {tr.name} <span className="dim small-text">({project.railNetworks[tr.networkId]?.name})</span>
          </label>
        ))}
        {est.trains.length > 0 && (
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('Zug')}</th>
                <th className="num">{t('je Umlauf')}</th>
                <th className="num">{t('Umlauf')}</th>
                <th className="num">{t('Durchsatz')}</th>
              </tr>
            </thead>
            <tbody>
              {est.trains.map((x) => (
                <tr key={x.trainId}>
                  <td>
                    {project.trains[x.trainId]?.name}
                    {(!x.servesFrom || !x.servesTo) && <Badge kind="err">{t('hält nicht')}</Badge>}
                  </td>
                  <td className="num">
                    {fmtNum(x.capacityPerCycle * x.share, 0)}
                    {x.share < 0.999 && <span className="dim"> ({fmtNum(x.share * 100, 0)} %)</span>}
                  </td>
                  <td className="num">
                    {x.cycleS ? `${fmtNum(x.cycleS, 0)} s` : '–'} <span className="dim small-text">{x.cycleSource === 'measured' ? t('gemessen') : x.cycleSource === 'manual' ? t('manuell') : t('geschätzt')}</span>
                  </td>
                  <td className="num">
                    {fmtNum(x.perMin, 1)} {u}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Row label={t('Summe (Schätzung)')}>
          <span className={est.ok ? 'pos' : 'neg'}>
            {fmtNum(est.perMin, 1)} / {fmtNum(o.ratePerMin, 1)} {u}
          </span>
        </Row>
      </Section>
      <div className="button-row pad">
        <button
          className="danger"
          onClick={() => {
            apply(t('Auftrag löschen'), (d) => ops.removeOrders(d, [o.id]));
            useUiStore.getState().select([]);
          }}
        >
          {t('Auftrag löschen')}
        </button>
      </div>
    </>
  );
}
