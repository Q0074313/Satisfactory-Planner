/**
 * Transportplanung zwischen Fabriken: Aufträge, Zugzuordnung, geschätzter
 * Durchsatz mit offengelegten Annahmen, Ein-/Ausfuhrbilanz je Fabrik.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  cachedFactoryFlow,
  cargoKind,
  estimateOrder,
  factoryInputs,
  factoryTrade,
  getLanguage,
  localName,
  orderMapDistance,
  placedPortDefs,
  transferCargo,
  transferInterface,
  transportAssumptions,
  transportOps as ops,
  type FactoryInput,
  type GameDataIndex,
  type OrderEstimate,
  type PortRef,
  type Project,
  type TransportMode,
  type TransportOrder,
} from '@satis/core';
import { N_, t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useSimStore } from '../../state/simStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section, TextField } from '../../ui/fields';

const unitOf = (kind: 'solid' | 'liquid') => (kind === 'solid' ? '/min' : 'm³/min');

const MODE_LABELS: Record<TransportMode, string> = { train: N_('Zug'), vehicle: N_('Fahrzeug'), drone: N_('Drohne'), belt: N_('Förderband'), pipe: N_('Rohr') };
const MODES: TransportMode[] = ['train', 'vehicle', 'drone', 'belt', 'pipe'];

/** Kurzbeschreibung des Transportmittels eines Auftrags (Tabelle). */
function meansLabel(p: Project, gd: GameDataIndex, o: TransportOrder): string {
  if (o.mode === 'vehicle') return o.vehicle ? `${o.vehicle.count} × ${gd.name(o.vehicle.type)}` : t(MODE_LABELS.vehicle);
  if (o.mode === 'drone') return o.drone ? `${o.drone.count} × ${t('Drohne')}` : t(MODE_LABELS.drone);
  if (o.mode === 'belt' || o.mode === 'pipe') return o.direct ? `${o.direct.lines} × ${gd.name(o.direct.tier)}` : t(MODE_LABELS[o.mode]);
  return o.trainIds.map((id) => p.trains[id]?.name).join(', ');
}

/** Status-Badge eines Auftrags je Transportmittel. */
function StatusBadge({ o, est }: { o: TransportOrder; est: OrderEstimate }) {
  if (o.mode === 'train') {
    if (o.trainIds.length === 0) return <Badge kind="warn">{t('kein Zug')}</Badge>;
    return est.ok ? <Badge kind="ok">{t('reicht (geschätzt)')}</Badge> : <Badge kind="err">{t('zu wenig (geschätzt)')}</Badge>;
  }
  if (o.mode === 'vehicle') {
    if (est.vehicle && !est.vehicle.kindOk) return <Badge kind="err">{t('falsches Fahrzeug')}</Badge>;
    if (!est.vehicle?.count) return <Badge kind="warn">{t('kein Fahrzeug')}</Badge>;
    return est.ok ? <Badge kind="ok">{t('reicht (geschätzt)')}</Badge> : <Badge kind="err">{t('zu wenig (geschätzt)')}</Badge>;
  }
  if (o.mode === 'drone') {
    if (est.drone && !est.drone.kindOk) return <Badge kind="err">{t('kein Feststoff')}</Badge>;
    if (!est.drone?.count) return <Badge kind="warn">{t('keine Drohne')}</Badge>;
    return est.ok ? <Badge kind="ok">{t('reicht (geschätzt)')}</Badge> : <Badge kind="err">{t('zu wenig (geschätzt)')}</Badge>;
  }
  if (est.direct && !est.direct.kindOk) return <Badge kind="err">{o.mode === 'belt' ? t('kein Feststoff') : t('keine Flüssigkeit')}</Badge>;
  return est.ok ? <Badge kind="ok">{t('reicht')}</Badge> : <Badge kind="err">{t('zu klein')}</Badge>;
}

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
            <InputsSection />
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
    <Section title={t('Aufträge und Durchsatz')}>
      {rows.length === 0 ? (
        <p className="dim">{t('Keine Transportaufträge.')}</p>
      ) : (
        <table className="table" data-testid="orders-table">
          <thead>
            <tr>
              <th>{t('Auftrag')}</th>
              <th>{t('Von → Nach')}</th>
              <th className="num">{t('Menge')}</th>
              <th>{t('Transportmittel')}</th>
              <th className="num" title={t('Zug und Fahrzeug: Kapazität je Umlauf / Umlaufzeit (Schätzung); Band und Rohr: Kapazität der Leitungen')}>
                {t('Durchsatz')}
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
                  <td>
                    <span className="dim">{t(MODE_LABELS[o.mode])}:</span> {meansLabel(project, gd, o) || <span className="dim">–</span>}
                  </td>
                  <td className="num">
                    {est.trains.length || o.mode !== 'train' ? `${fmtNum(est.perMin, 1)} ${u}` : '–'}
                    {est.trains.some((x) => x.cycleSource === 'measured') && (
                      <Badge kind="info" title={t('Umlaufzeit aus der Simulation')}>
                        {t('gemessen')}
                      </Badge>
                    )}
                    {est.trains.some((x) => x.cycleSource === 'manual') && <Badge kind="muted">{t('manuell')}</Badge>}
                  </td>
                  <td>
                    <StatusBadge o={o} est={est} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="dim small-text">{t('Durchsatz von Zügen und Fahrzeugen ist eine Schätzung. Mit der Simulation im Schienennetz gemessene Umlaufzeiten ersetzen die Schätzung, sobald ein Zug mindestens zwei Umläufe gefahren ist. Bänder und Rohre: Kapazität der gewählten Stufe mal Anzahl Leitungen.')}</p>
    </Section>
  );
}

/** Eingänge (Übergabelager) aller Fabriken mit Bedarf und Zulieferung über direkte Leitungen. */
function InputsSection() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const select = useUiStore((s) => s.select);
  const rows = useMemo(
    () =>
      Object.values(project.factories)
        .filter((f) => !f.blackbox)
        .flatMap((f) => factoryInputs(project, gd, f.id).map((x) => ({ f, x }))),
    [project, gd],
  );
  if (rows.length === 0) return null;
  return (
    <Section title={t('Eingänge der Fabriken')}>
      <table className="table" data-testid="inputs-table">
        <thead>
          <tr>
            <th>{t('Fabrik')}</th>
            <th>{t('Eingang')}</th>
            <th>{t('Gegenstand')}</th>
            <th className="num" title={t('So viel nehmen die Maschinen hinter dem Eingang bei voller Versorgung ab (Durchsatzmodell).')}>
              {t('Bedarf')}
            </th>
            <th>{t('Direkte Leitungen')}</th>
            <th>{t('Status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ f, x }) => {
            const b = project.buildings[x.buildingId]!;
            const u = x.kind === 'belt' ? '/min' : 'm³/min';
            // Bestellte Menge gegen Bedarf (der tatsächliche Fluss sinkt auch, wenn ein anderer Eingang fehlt)
            const ordered = x.directOrderIds.reduce((s, id) => s + (project.transportOrders[id]?.ratePerMin ?? 0), 0);
            const gap = x.requiredPerMin - ordered;
            const single = x.directOrderIds.length === 1 ? project.transportOrders[x.directOrderIds[0]!] : undefined;
            return (
              <tr key={x.buildingId}>
                <td>{f.name}</td>
                <td>{b.label || gd.name(b.type)}</td>
                <td>{x.itemId ? gd.name(x.itemId) : '?'}</td>
                <td className="num">
                  {fmtNum(x.requiredPerMin, 1)} {u}
                </td>
                <td>
                  {x.directOrderIds.length === 0 && <span className="dim">–</span>}
                  {x.directOrderIds.map((id) => {
                    const o = project.transportOrders[id]!;
                    return (
                      <button key={id} className="link-button" onClick={() => select([{ table: 'transportOrders', id }])}>
                        {o.name || gd.name(o.itemId)} ({fmtNum(o.ratePerMin, 1)} {u})
                      </button>
                    );
                  })}
                </td>
                <td>
                  {x.requiredPerMin <= 1e-6 ? (
                    <span className="dim">{t('kein Bedarf')}</span>
                  ) : gap <= 1e-3 * Math.max(1, x.requiredPerMin) ? (
                    <Badge kind="ok">{t('gedeckt')}</Badge>
                  ) : x.directOrderIds.length === 0 ? (
                    <Badge kind="muted" title={t('Keine direkte Leitung an diesem Eingang. Züge, Fahrzeuge und Drohnen liefern an die Fabrik, nicht an einen bestimmten Eingang.')}>
                      {t('ohne direkte Leitung')}
                    </Badge>
                  ) : (
                    <Badge kind="warn">{t('fehlt {n}', { n: `${fmtNum(gap, 1)} ${u}` })}</Badge>
                  )}
                  {single && Math.abs(ordered - x.requiredPerMin) > 1e-3 * Math.max(1, x.requiredPerMin) && x.requiredPerMin > 1e-6 && (
                    <button
                      className="small"
                      title={t('Menge des Auftrags auf den Bedarf dieses Eingangs setzen')}
                      onClick={() => apply(t('Menge'), (d, g) => ops.updateOrder(d, g, single.id, { ratePerMin: Math.round(x.requiredPerMin * 1000) / 1000 }))}
                    >
                      {t('Menge übernehmen')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dim small-text">
        {t('Eingänge sind Lager bzw. Flüssigkeitspuffer, die nur abgeben (z. B. die Ein-/Ausgänge des Auto-Layouts). Teilen sich mehrere Eingänge dieselben Maschinen, ist die Aufteilung des Bedarfs eine von mehreren möglichen.')}
      </p>
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
              <td className="num">
                {r.exports ? fmtNum(r.exports, 2) : ''}
                {r.transportFuel > 0 && <span className="dim small-text" title={t('Brennstoff der Drohnen mit Heimathafen in dieser Fabrik')}> {t('+{n} Drohnen', { n: fmtNum(r.transportFuel, 2) })}</span>}
              </td>
              <td className="num">{r.planImports ? fmtNum(r.planImports, 2) : ''}</td>
              <td>
                {r.importGap > 1e-6 && <Badge kind="warn">{t('Import fehlt {n}', { n: fmtNum(r.importGap, 2) })}</Badge>}{' '}
                {r.exportGap > 1e-6 && <Badge kind="warn">{t('Ausfuhr ohne Deckung {n}', { n: fmtNum(r.exportGap, 2) })}</Badge>}{' '}
                {r.fuelGap > 1e-6 && <Badge kind="warn">{t('Drohnenbrennstoff fehlt {n}', { n: fmtNum(r.fuelGap, 2) })}</Badge>}
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
        <Row label={t('Von Fabrik')} plain>
          <span className="inline">
            <select value={o.fromFactoryId} onChange={(e) => upd(t('Absender'), { fromFactoryId: e.target.value })} data-testid="order-from">
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              className="small"
              title={t('Absender und Empfänger tauschen (samt Bahnhöfen)')}
              onClick={() => apply(t('Richtung tauschen'), (d, g) => ops.swapOrderEnds(d, g, o.id))}
              data-testid="order-swap"
            >
              ⇄
            </button>
          </span>
        </Row>
        <Row label={t('Transportmittel')}>
          <select
            value={o.mode}
            data-testid="transport-mode"
            onChange={(e) => {
              const mode = e.target.value as TransportMode;
              if (mode === o.mode) return;
              // Vorhandene Angaben bleiben erhalten; fehlende bzw. unpassende werden vorbelegt
              const onMap = orderMapDistance(project, gd, { ...o, mode });
              const def = ops.defaultsFor(gd, mode, o.itemId, onMap ? Math.round(onMap.distM) : undefined);
              const patch: ops.OrderPatch = { mode };
              if (mode === 'vehicle' && !o.vehicle) patch.vehicle = def.vehicle;
              if (mode === 'drone' && !o.drone) patch.drone = def.drone;
              if ((mode === 'belt' || mode === 'pipe') && !(o.direct && (mode === 'belt' ? gd.building(o.direct.tier)?.conveyor : gd.building(o.direct.tier)?.pipe)))
                patch.direct = def.direct;
              upd(t('Transportmittel'), patch);
            }}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(MODE_LABELS[m])}
              </option>
            ))}
          </select>
        </Row>
        {o.mode === 'train' && (
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
        )}
        <Row label={t('Nach Fabrik')}>
          <select value={o.toFactoryId} onChange={(e) => upd(t('Empfänger'), { toFactoryId: e.target.value })} data-testid="order-to">
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Row>
        {o.mode === 'train' && (
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
        )}
        {(o.mode === 'train' || o.mode === 'vehicle' || o.mode === 'drone') && (
        <Row label={t('Umlaufzeit manuell')} hint={t('Leer = aus Strecke und Annahmen schätzen bzw. aus der Simulation messen')}>
          <NumberField value={o.roundTripEstimateS ?? NaN} min={1} suffix="s" onCommit={(v) => upd(t('Umlaufzeit'), { roundTripEstimateS: v })} />
        </Row>
        )}
        {o.roundTripEstimateS !== null && o.mode !== 'belt' && o.mode !== 'pipe' && (
          <div className="button-row">
            <button className="small" onClick={() => upd(t('Umlaufzeit'), { roundTripEstimateS: null })}>
              {t('Schätzung verwenden')}
            </button>
          </div>
        )}
      </Section>
      {o.mode === 'vehicle' && <VehicleSection order={o} est={est} />}
      {o.mode === 'drone' && <DroneSection order={o} est={est} />}
      {(o.mode === 'belt' || o.mode === 'pipe') && <DirectSection order={o} est={est} />}
      {o.mode === 'train' && (
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
      )}
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

/** Übergaben (LKW- bzw. Tanklaster-Stationen) einer Fabrik im passenden Modus. */
function vehicleStations(p: Project, gd: GameDataIndex, factoryId: string, mode: 'load' | 'unload', solid: boolean) {
  return Object.values(p.buildings).filter((b) => {
    const def = gd.building(b.type);
    return b.factoryId === factoryId && b.placement && b.transfer?.mode === mode && transferInterface(def) === 'vehicle' && (transferCargo(def!) === 'solid') === solid;
  });
}

function VehicleSection({ order: o, est }: { order: TransportOrder; est: OrderEstimate }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const v = o.vehicle!;
  const ve = est.vehicle;
  const def = gd.vehicle(v.type);
  const kind = cargoKind(gd, o.itemId);
  const u = unitOf(kind);
  const solid = kind === 'solid';
  const updV = (label: string, patch: Partial<typeof v>) => apply(label, (d, g) => ops.updateOrder(d, g, o.id, { vehicle: { ...v, ...patch } }));
  const needed = ve && ve.capacityPerTrip > 0 && ve.cycleS ? Math.ceil((o.ratePerMin * ve.cycleS) / (60 * ve.capacityPerTrip) - 1e-9) : null;
  const iface = (factoryId: string, mode: 'load' | 'unload') => vehicleStations(project, gd, factoryId, mode, solid).length;
  const stationName = gd.name(solid ? 'Build_TruckStation_C' : 'Build_FluidTruckStation_C');
  return (
    <Section title={t('Fahrzeuge')}>
      <Row label={t('Fahrzeug')} hint={t('Laderaum aus den Docs, Höchstgeschwindigkeit und Tankinhalt laut Wiki')}>
        <select value={v.type} onChange={(e) => updV(t('Fahrzeug'), { type: e.target.value })} data-testid="vehicle-type">
          {gd.vehicles.map((x) => (
            <option key={x.id} value={x.id}>
              {localName(x.name)} ({x.cargo.kind === 'solid' ? t('{n} Stapel', { n: x.cargo.slots }) : `${fmtNum(x.cargo.m3, 0)} m³`}, {x.maxSpeedKmh} km/h)
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Anzahl')}>
        <NumberField value={v.count} min={0} step={1} digits={0} onCommit={(n) => updV(t('Anzahl Fahrzeuge'), { count: Math.max(0, Math.round(n)) })} />
      </Row>
      <Row label={t('Strecke (einfach)')} hint={t('Länge der Fahrstrecke von der Lade- zur Entladestation')}>
        <NumberField value={v.distanceM} min={0} suffix="m" onCommit={(n) => updV(t('Strecke'), { distanceM: n })} />
      </Row>
      <MapDistanceHint order={o} current={v.distanceM} road onTake={(n) => updV(t('Strecke von der Karte'), { distanceM: n })} />
      <Row label={t('Ø Geschwindigkeit')} hint={t('Leer = Höchstgeschwindigkeit laut Wiki. Kurven, Steigungen und Anfahren machen das Fahrzeug langsamer.')}>
        <NumberField value={v.speedKmh ?? NaN} min={1} max={200} suffix="km/h" allowEmpty placeholder={def ? String(def.maxSpeedKmh) : ''} onCommit={(n) => updV(t('Geschwindigkeit'), { speedKmh: Number.isFinite(n) ? n : null })} />
      </Row>
      {ve && (
        <>
          <Row label={t('Laderaum je Fahrt')}>
            {ve.kindOk ? (
              `${fmtNum(ve.capacityPerTrip, 0)} ${solid ? t('Stück') : 'm³'}`
            ) : (
              <Badge kind="err">{solid ? t('Fahrzeug für Flüssigkeiten') : t('Fahrzeug für Feststoffe')}</Badge>
            )}
          </Row>
          <Row label={t('Umlauf')} hint={t('2 × Strecke / Geschwindigkeit + 2 × {s} s Andocken (Wiki „Truck Station“)', { s: ve.dockingS })}>
            {ve.cycleS ? `${fmtNum(ve.cycleS, 0)} s` : '–'} <span className="dim small-text">{ve.cycleSource === 'manual' ? t('manuell') : t('geschätzt')}</span>
          </Row>
          <Row label={t('Summe (Schätzung)')}>
            <span className={est.ok ? 'pos' : 'neg'} data-testid="vehicle-sum">
              {fmtNum(est.perMin, 1)} / {fmtNum(o.ratePerMin, 1)} {u}
            </span>
            {needed !== null && needed > v.count && <span className="dim small-text"> · {t('nötig: {n} Fahrzeuge', { n: needed })}</span>}
          </Row>
        </>
      )}
      <Row label={t('Übergabe')} hint={t('{station} im Grundriss mit „Beladen“ beim Absender und „Entladen“ beim Empfänger', { station: stationName })}>
        {iface(o.fromFactoryId, 'load') > 0 ? <Badge kind="ok">{t('Beladen ✓')}</Badge> : <Badge kind="warn">{t('Beladen fehlt')}</Badge>}{' '}
        {iface(o.toFactoryId, 'unload') > 0 ? <Badge kind="ok">{t('Entladen ✓')}</Badge> : <Badge kind="warn">{t('Entladen fehlt')}</Badge>}
      </Row>
    </Section>
  );
}

/** Luftlinie laut Karte unter einer Streckenangabe, mit Übernahme. */
function MapDistanceHint({ order: o, current, road, onTake }: { order: TransportOrder; current: number; road?: boolean; onTake: (m: number) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const m = orderMapDistance(project, gd, o);
  if (!m) {
    return <p className="dim small-text">{t('Sind beide Fabriken auf der Karte platziert, steht hier die Luftlinie.')}</p>;
  }
  const value = Math.round(m.distM);
  return (
    <p className="small-text" data-testid="map-distance">
      {t('Karte: {d} m Luftlinie', { d: fmtNum(value, 0) })} <span className="dim">({m.basis === 'ports' ? t('zwischen den Übergabegebäuden') : t('zwischen den Fabrikmitten')})</span>{' '}
      {Math.abs(value - current) > 0.5 && (
        <button className="small" onClick={() => onTake(value)} data-testid="map-distance-take">
          {t('Von Karte übernehmen')}
        </button>
      )}
      {road && <span className="dim"> · {t('Wege sind meist länger als die Luftlinie.')}</span>}
    </p>
  );
}

function DroneSection({ order: o, est }: { order: TransportOrder; est: OrderEstimate }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const d = o.drone!;
  const de = est.drone;
  const updD = (label: string, patch: Partial<typeof d>) => apply(label, (dr, g) => ops.updateOrder(dr, g, o.id, { drone: { ...d, ...patch } }));
  const needed = de && de.capacityPerTrip > 0 && de.cycleS ? Math.ceil((o.ratePerMin * de.cycleS) / (60 * de.capacityPerTrip) - 1e-9) : null;
  const ports = (factoryId: string, mode: 'load' | 'unload') =>
    Object.values(project.buildings).filter((b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === mode && transferInterface(gd.building(b.type)) === 'drone').length;
  return (
    <Section title={t('Drohnen')}>
      <Row label={t('Anzahl')} hint={t('Jede Drohne braucht einen eigenen Heimathafen beim Absender; Zielhäfen können sich mehrere Drohnen teilen.')}>
        <NumberField value={d.count} min={0} step={1} digits={0} onCommit={(n) => updD(t('Anzahl Drohnen'), { count: Math.max(0, Math.round(n)) })} />
      </Row>
      <Row label={t('Entfernung')} hint={t('Luftlinie zwischen den Drohnenhäfen')}>
        <NumberField value={d.distanceM} min={0} suffix="m" onCommit={(n) => updD(t('Entfernung'), { distanceM: n })} />
      </Row>
      <MapDistanceHint order={o} current={d.distanceM} onTake={(n) => updD(t('Entfernung von der Karte'), { distanceM: n })} />
      <Row label={t('Brennstoff')} hint={t('Bestimmt Geschwindigkeit (Wiki) und Verbrauch (Energiewert aus den Docs)')}>
        <select value={d.fuelId} data-testid="drone-fuel" onChange={(e) => updD(t('Brennstoff'), { fuelId: e.target.value })}>
          {ops.droneFuels(gd).map((id) => (
            <option key={id} value={id}>
              {gd.name(id)} ({fmtNum(gd.fact(`drone.speedMps.${id}`) ?? 0, 0)} m/s)
            </option>
          ))}
        </select>
      </Row>
      {de && (
        <>
          <Row label={t('Laderaum je Flug')}>{de.kindOk ? `${fmtNum(de.capacityPerTrip, 0)} ${t('Stück')}` : <Badge kind="err">{t('nur Feststoffe')}</Badge>}</Row>
          <Row label={t('Umlauf')} hint={t('2 × (Entfernung / Geschwindigkeit + 2 × {s} s Start bzw. Landung)', { s: gd.fact('drone.takeoffLandingS') ?? 51 })}>
            {de.cycleS ? `${fmtNum(de.cycleS, 0)} s` : '–'} <span className="dim small-text">{de.cycleSource === 'manual' ? t('manuell') : t('geschätzt')}</span>
          </Row>
          <Row label={t('Brennstoff')}>
            {t('{n} je Umlauf', { n: fmtNum(de.fuelPerTrip, 2) })} · <span data-testid="drone-fuel-rate">{t('{n}/min', { n: fmtNum(de.fuelPerMin, 2) })}</span> {gd.name(de.fuelId)}
          </Row>
          <Row label={t('Summe (Schätzung)')}>
            <span className={est.ok ? 'pos' : 'neg'} data-testid="drone-sum">
              {fmtNum(est.perMin, 1)} / {fmtNum(o.ratePerMin, 1)} /min
            </span>
            {needed !== null && needed > d.count && <span className="dim small-text"> · {t('nötig: {n} Drohnen', { n: needed })}</span>}
          </Row>
        </>
      )}
      <Row label={t('Übergabe')} hint={t('Drohnenhafen im Grundriss mit „Beladen“ beim Absender und „Entladen“ beim Empfänger')}>
        {ports(o.fromFactoryId, 'load') > 0 ? <Badge kind="ok">{t('Beladen ✓')}</Badge> : <Badge kind="warn">{t('Beladen fehlt')}</Badge>}{' '}
        {ports(o.toFactoryId, 'unload') > 0 ? <Badge kind="ok">{t('Entladen ✓')}</Badge> : <Badge kind="warn">{t('Entladen fehlt')}</Badge>}
      </Row>
    </Section>
  );
}

/** Wählbare Übergabeanschlüsse einer Fabrik (Band- bzw. Rohranschlüsse, frei oder bereits für diesen Auftrag gewählt). */
function endpointOptions(p: Project, gd: GameDataIndex, factoryId: string, kind: 'belt' | 'pipe', role: 'from' | 'to', current: PortRef | null, inputs: FactoryInput[] = []) {
  const used = new Set<string>();
  for (const l of Object.values(p.links)) {
    used.add(`${l.from.buildingId}/${l.from.portId}`);
    used.add(`${l.to.buildingId}/${l.to.portId}`);
  }
  for (const o of Object.values(p.transportOrders)) {
    for (const e of [o.direct?.from, o.direct?.to]) if (e && (o.mode === 'belt' || o.mode === 'pipe')) used.add(`${e.buildingId}/${e.portId}`);
  }
  const out: { value: string; label: string }[] = [];
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const def = gd.building(b.type);
    if (!def) continue;
    for (const port of placedPortDefs(def, b.placement)) {
      if (port.kind !== kind) continue;
      if (role === 'from' ? port.direction === 'in' : port.direction === 'out') continue;
      const key = `${b.id}/${port.id}`;
      const isCurrent = current && current.buildingId === b.id && current.portId === port.id;
      if (used.has(key) && !isCurrent) continue;
      const [, dir, idx] = port.id.split('-');
      const portName = `${dir === 'in' ? t('Eingang') : dir === 'out' ? t('Ausgang') : t('Anschluss')} ${Number(idx) + 1}`;
      const floor = p.floors[b.placement.floorId]?.name ?? '';
      const need = role === 'to' ? inputs.find((x) => x.buildingId === b.id) : undefined;
      const demand = need && need.requiredPerMin > 1e-6 ? ` · ${t('Bedarf {n}', { n: `${fmtNum(need.requiredPerMin, 1)} ${kind === 'belt' ? '/min' : 'm³/min'}` })}` : '';
      out.push({ value: key, label: `${b.label || gd.name(b.type)} · ${portName} (${floor})${demand}` });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, getLanguage()));
}

function DirectSection({ order: o, est }: { order: TransportOrder; est: OrderEstimate }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const d = o.direct!;
  const kind = o.mode === 'belt' ? 'belt' : 'pipe';
  const u = unitOf(cargoKind(gd, o.itemId));
  const tiers = kind === 'belt' ? gd.beltTiers : gd.pipeTiers;
  const updD = (label: string, patch: Partial<typeof d>) => apply(label, (dr, g) => ops.updateOrder(dr, g, o.id, { direct: { ...d, ...patch } }));
  const flowIn = useMemo(() => cachedFactoryFlow(project, gd, o.toFactoryId).direct.get(o.id), [project, gd, o.toFactoryId, o.id]);
  const flowOut = useMemo(() => cachedFactoryFlow(project, gd, o.fromFactoryId).direct.get(o.id), [project, gd, o.fromFactoryId, o.id]);
  const inputs = useMemo(() => factoryInputs(project, gd, o.toFactoryId), [project, gd, o.toFactoryId]);
  const target = d.to ? inputs.find((x) => x.buildingId === d.to!.buildingId) : undefined;
  const per = tiers.find((x) => x.id === d.tier);
  const perCap = per?.conveyor?.itemsPerMin ?? per?.pipe?.m3PerMin ?? 0;
  const endpoint = (role: 'from' | 'to') => {
    const factoryId = role === 'from' ? o.fromFactoryId : o.toFactoryId;
    const cur = role === 'from' ? d.from : d.to;
    const opts = endpointOptions(project, gd, factoryId, kind, role, cur, role === 'to' ? inputs : []);
    return (
      <select
        data-testid={`direct-${role}`}
        value={cur ? `${cur.buildingId}/${cur.portId}` : ''}
        onChange={(e) => {
          const [buildingId, portId] = e.target.value ? e.target.value.split('/') : [];
          updD(t('Übergabe'), { [role]: buildingId ? { buildingId, portId: portId! } : null });
        }}
      >
        <option value="">{t('– nicht gewählt –')}</option>
        {opts.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
    );
  };
  return (
    <Section title={kind === 'belt' ? t('Förderbänder zwischen den Fabriken') : t('Rohre zwischen den Fabriken')}>
      <Row label={t('Stufe')}>
        <select value={d.tier} onChange={(e) => updD(t('Stufe ändern'), { tier: e.target.value })}>
          {tiers.map((x) => (
            <option key={x.id} value={x.id}>
              {localName(x.name)} ({x.conveyor ? `${x.conveyor.itemsPerMin}/min` : `${x.pipe!.m3PerMin} m³/min`})
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('Parallele Leitungen')}>
        <NumberField value={d.lines} min={1} step={1} digits={0} onCommit={(n) => updD(t('Leitungen'), { lines: Math.max(1, Math.round(n)) })} />
      </Row>
      <Row label={t('Länge')} hint={t('Planungsangabe, z. B. für den Materialbedarf')}>
        <NumberField value={d.lengthM} min={0} suffix="m" onCommit={(n) => updD(t('Länge'), { lengthM: n })} />
      </Row>
      <MapDistanceHint order={o} current={d.lengthM} road onTake={(n) => updD(t('Länge von der Karte'), { lengthM: n })} />
      <Row label={t('Kapazität')}>
        {est.direct?.kindOk === false ? (
          <Badge kind="err">{kind === 'belt' ? t('Förderbänder tragen nur Feststoffe') : t('Rohre tragen nur Flüssigkeiten und Gase')}</Badge>
        ) : (
          <span className={est.ok ? 'pos' : 'neg'} data-testid="direct-capacity">
            {fmtNum(est.direct?.capacity ?? 0, 0)} / {fmtNum(o.ratePerMin, 1)} {u}
          </span>
        )}
        {!est.ok && perCap > 0 && <span className="dim small-text"> · {t('nötig: {n} Leitungen', { n: Math.ceil(o.ratePerMin / perCap - 1e-9) })}</span>}
      </Row>
      <Row label={t('Ausgang bei {factory}', { factory: project.factories[o.fromFactoryId]?.name ?? '?' })} plain hint={t('Anschluss in der liefernden Fabrik, an dem die Leitung beginnt')}>
        {endpoint('from')}
      </Row>
      <Row label={t('Eingang bei {factory}', { factory: project.factories[o.toFactoryId]?.name ?? '?' })} plain hint={t('Anschluss in der empfangenden Fabrik, an dem die Leitung ankommt')}>
        {endpoint('to')}
      </Row>
      {target && target.requiredPerMin > 1e-6 && (
        <Row label={t('Bedarf an diesem Eingang')} plain hint={t('So viel nehmen die Maschinen hinter diesem Eingang bei voller Versorgung ab (Durchsatzmodell).')}>
          <span data-testid="direct-input-demand">
            {fmtNum(target.requiredPerMin, 1)} {u}
            {Math.abs(target.requiredPerMin - o.ratePerMin) > 1e-3 * Math.max(1, target.requiredPerMin) && (
              <>
                {' '}
                <Badge kind="warn">{t('Auftrag: {n}', { n: `${fmtNum(o.ratePerMin, 1)} ${u}` })}</Badge>{' '}
                <button className="small" onClick={() => apply(t('Menge'), (dr, g) => ops.updateOrder(dr, g, o.id, { ratePerMin: Math.round(target.requiredPerMin * 1000) / 1000 }))}>
                  {t('Menge übernehmen')}
                </button>
              </>
            )}
          </span>
        </Row>
      )}
      {(flowOut || flowIn) && (
        <Row label={t('Durchsatzmodell')} hint={t('Fluss über die Leitung laut Durchsatzmodell der beiden Fabriken (mit Kapazitätsgrenze)')}>
          {flowOut && t('ab {factory}: {n}', { factory: project.factories[o.fromFactoryId]?.name ?? '?', n: `${fmtNum(flowOut.perMin, 1)} ${u}` })}
          {flowOut && flowIn && ' · '}
          {flowIn && t('an {factory}: {n}', { factory: project.factories[o.toFactoryId]?.name ?? '?', n: `${fmtNum(flowIn.perMin, 1)} ${u}` })}
        </Row>
      )}
      <p className="dim small-text">{t('Die Leitung erscheint im Grundriss beider Fabriken als Stummel mit Pfeil am gewählten Anschluss. Das Durchsatzmodell rechnet mit ihr wie mit einer gezeichneten Verbindung.')}</p>
    </Section>
  );
}
