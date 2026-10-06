import { railOps as ops, simAssumptions, simSettingsFrom } from '@satis/core';
import { N_, t } from '../../i18n';
import { keyLabel } from '../../state/keymap';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useSimStore } from '../../state/simStore';
import { RAIL_LAYER_LABELS, useUiStore, type RailLayerKey, type RailTool } from '../../state/uiStore';
import { Badge, fmtNum, NumberField, Row, Section } from '../../ui/fields';
import { formatTime } from './RailEditor';

const TOOLS: { tool: RailTool; label: string; action: string }[] = [
  { tool: { kind: 'select' }, label: N_('Auswahl'), action: 'rail.select' },
  { tool: { kind: 'track', z: 0 }, label: N_('Gleis'), action: 'rail.track' },
  { tool: { kind: 'signal', signalKind: 'block' }, label: N_('Blocksignal'), action: 'rail.block' },
  { tool: { kind: 'signal', signalKind: 'path' }, label: N_('Pfadsignal'), action: 'rail.path' },
  { tool: { kind: 'station', platforms: 2, platformType: 'freight', rotationDeg: 0 }, label: N_('Bahnhof'), action: 'rail.station' },
  { tool: { kind: 'measure' }, label: N_('Messen'), action: 'rail.measure' },
];

export function RailLeftPanel() {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const networkId = useUiStore((s) => s.networkId);
  const setNetwork = useUiStore((s) => s.setNetwork);
  const tool = useUiStore((s) => s.railTool);
  const setTool = useUiStore((s) => s.setRailTool);
  const layers = useUiStore((s) => s.railLayers);
  const toggle = useUiStore((s) => s.toggleRailLayer);
  const select = useUiStore((s) => s.select);
  const selection = useUiStore((s) => s.selection);
  const bindings = usePrefs((s) => s.bindings);
  const lang = usePrefs((s) => s.language);
  const networks = Object.values(project.railNetworks);
  const trains = Object.values(project.trains).filter((x) => x.networkId === networkId);
  const timetables = Object.values(project.timetables).filter((x) => x.networkId === networkId);
  const stations = Object.values(project.stations).filter((s) => s.networkId === networkId);
  const isActive = (tl: RailTool) => tl.kind === tool.kind && (tl.kind !== 'signal' || (tool.kind === 'signal' && tool.signalKind === tl.signalKind));
  const selected = (id: string) => selection.some((s) => s.id === id);

  return (
    <aside className="panel panel-left" data-tour="rail-left">
      <Section
        title={t('Schienennetze')}
        actions={
          <button
            className="small"
            data-tour="add-network"
            onClick={() => {
              const id = apply(t('Netz anlegen'), (d) => ops.addNetwork(d, t('Netz {n}', { n: networks.length + 1 })));
              if (id) setNetwork(id);
            }}
          >
            +
          </button>
        }
      >
        <ul className="floor-list">
          {networks.map((n) => (
            <li key={n.id} className={n.id === networkId ? 'active' : ''} onClick={() => setNetwork(n.id)}>
              <span>
                <span className="swatch" style={{ background: n.color }} /> {n.name}
              </span>
              <span className="dim">{t('{n} Segm.', { n: Object.values(project.railSegments).filter((s) => s.networkId === n.id).length })}</span>
            </li>
          ))}
        </ul>
        {networks.length === 0 && <p className="dim small-text">{t('Noch kein Netz – mit + anlegen.')}</p>}
      </Section>

      {networkId && (
        <>
          <Section title={t('Werkzeuge')}>
            <div className="tool-grid" data-tour="rail-tools">
              {TOOLS.map((tl) => (
                <button key={tl.label} className={isActive(tl.tool) ? 'active' : ''} onClick={() => setTool(tl.tool)}>
                  {t(tl.label)}
                  <kbd>{keyLabel(bindings, tl.action, lang)}</kbd>
                </button>
              ))}
            </div>
            {tool.kind === 'track' && (
              <Row label={t('Höhe neuer Punkte')} hint={t('Höhe (z) für neu gesetzte Gleisknoten; vorhandene Knoten behalten ihre Höhe')}>
                <NumberField value={tool.z} suffix="m" onCommit={(z) => setTool({ ...tool, z })} />
              </Row>
            )}
            {tool.kind === 'station' && (
              <>
                <Row label={t('Bahnsteige')}>
                  <NumberField value={tool.platforms} min={0} max={30} step={1} digits={0} onCommit={(v) => setTool({ ...tool, platforms: Math.round(v) })} />
                </Row>
                <Row label={t('Art')}>
                  <select value={tool.platformType} onChange={(e) => setTool({ ...tool, platformType: e.target.value as typeof tool.platformType })}>
                    <option value="freight">{t('Güterbahnsteig')}</option>
                    <option value="fluid">{t('Flüssigkeitsbahnsteig')}</option>
                    <option value="empty">{t('Leerer Bahnsteig')}</option>
                  </select>
                </Row>
                <Row label={t('Richtung')}>
                  <NumberField value={tool.rotationDeg} suffix="°" step={90} onCommit={(v) => setTool({ ...tool, rotationDeg: v })} />
                </Row>
              </>
            )}
            {tool.kind === 'signal' && <SignalLegend />}
          </Section>

          <SimulationSection networkId={networkId} />

          <Section
            title={t('Züge')}
            actions={
              <button
                className="small"
                data-tour="add-train"
                onClick={() => {
                  const id = apply(t('Zug anlegen'), (d) => ops.addTrain(d, networkId, t('Zug {n}', { n: trains.length + 1 })));
                  if (id) select([{ table: 'trains', id }]);
                }}
              >
                +
              </button>
            }
          >
            <ul className="item-list">
              {trains.map((x) => (
                <li key={x.id} className={selected(x.id) ? 'active' : ''} onClick={() => select([{ table: 'trains', id: x.id }])}>
                  <span>
                    <span className="swatch" style={{ background: x.color }} /> {x.name}
                  </span>
                  <span className="dim">
                    {t('{a} Lok · {b} Wagen', { a: x.consist.filter((v) => v.kind === 'locomotive').length, b: x.consist.filter((v) => v.kind === 'wagon').length })}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t('Fahrpläne')}
            actions={
              <button
                className="small"
                data-tour="add-timetable"
                onClick={() => {
                  const id = apply(t('Fahrplan anlegen'), (d) => ops.addTimetable(d, networkId, t('Fahrplan {n}', { n: timetables.length + 1 })));
                  if (id) select([{ table: 'timetables', id }]);
                }}
              >
                +
              </button>
            }
          >
            <ul className="item-list">
              {timetables.map((x) => (
                <li key={x.id} className={selected(x.id) ? 'active' : ''} onClick={() => select([{ table: 'timetables', id: x.id }])}>
                  <span>{x.name}</span>
                  <span className="dim">{t('{n} Halte', { n: x.stops.length })}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('Bahnhöfe')}>
            <ul className="item-list">
              {stations.map((s) => (
                <li
                  key={s.id}
                  className={selected(s.id) ? 'active' : ''}
                  onClick={() => {
                    select([{ table: 'stations', id: s.id }]);
                    const n = project.railNodes[s.frontNodeId];
                    if (n) useUiStore.getState().focusOn(n.position.x, n.position.y);
                  }}
                >
                  <span>{s.name}</span>
                  <span className="dim">{s.factoryId ? project.factories[s.factoryId]?.name : '–'}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('Darstellung')}>
            {(Object.keys(RAIL_LAYER_LABELS) as RailLayerKey[]).map((k) => (
              <label key={k} className="check-row">
                <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {t(RAIL_LAYER_LABELS[k])}
              </label>
            ))}
          </Section>
        </>
      )}
    </aside>
  );
}

function SignalLegend() {
  return (
    <div className="signal-legend small-text">
      <p>
        <span className="sig-sample sig-block">B ▶</span> {t('Blocksignal')} · <span className="sig-sample sig-path">P ▶</span> {t('Pfadsignal')}
      </p>
      <p className="dim">
        {t('Der Pfeil zeigt die Fahrtrichtung, für die das Signal gilt. Es steht rechts neben dem Gleis; die Querlinie markiert die Haltestelle. Ohne Gegensignal ist die Gegenrichtung gesperrt.')}
      </p>
      <p className="dim">{t('Auf freiem Gleis wird das Segment geteilt (mindestens 12 m Abstand zum Segmentende, sonst am Knoten).')}</p>
    </div>
  );
}

function SimulationSection({ networkId }: { networkId: string }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const sim = useSimStore((s) => (s.networkId === networkId ? s.sim : null));
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  useSimStore((s) => s.tick);
  const store = useSimStore.getState();
  const hasTrains = Object.values(project.trains).some((x) => x.networkId === networkId && x.timetableId);
  const settings = simSettingsFrom(project, gd);
  const summary = sim?.summary() ?? [];
  const events = sim ? sim.events.filter((e) => e.kind !== 'depart' && e.kind !== 'arrive').slice(-6).reverse() : [];
  return (
    <Section title={t('Simulation')}>
      <div className="button-row" data-tour="sim-controls">
        <button
          className={playing ? 'active' : 'primary'}
          disabled={!hasTrains}
          title={hasTrains ? t('Züge animiert fahren lassen (Taste T)') : t('Zuerst einen Zug mit Fahrplan anlegen')}
          onClick={() => {
            if (!playing) store.ensure(project, gd, networkId);
            store.setPlaying(!playing);
          }}
        >
          {playing ? t('⏸ Anhalten') : t('▶ Züge fahren lassen')}
        </button>
        <button disabled={!sim} onClick={() => store.reset()}>
          {t('Zurücksetzen')}
        </button>
        <button disabled={!hasTrains} onClick={() => store.runFor(3600, project, gd, networkId)} title={t('Eine Stunde ohne Animation durchrechnen und auswerten')}>
          {t('+1 h auswerten')}
        </button>
      </div>
      <Row label={t('Tempo')}>
        <select value={speed} onChange={(e) => store.setSpeed(Number(e.target.value))}>
          {[1, 5, 10, 30, 60].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </Row>
      {sim && (
        <>
          <Row label={t('Simulierte Zeit')}>
            {formatTime(sim.time)} {sim.deadlock && <Badge kind="err">{t('Deadlock')}</Badge>}
          </Row>
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('Zug')}</th>
                <th className="num">{t('Halte')}</th>
                <th className="num" title={t('Mittlere Zeit zwischen zwei Ankünften am ersten Halt')}>
                  {t('Umlauf')}
                </th>
                <th className="num">{t('Warten')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.trainId}>
                  <td>{s.name}</td>
                  <td className="num">{s.arrivals}</td>
                  <td className="num">{s.cycleS ? `${fmtNum(s.cycleS, 0)} s` : '–'}</td>
                  <td className="num">{fmtNum(s.waitShare * 100, 0)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length > 0 && (
            <ul className="sim-events small-text">
              {events.map((e, i) => (
                <li key={i} className={e.kind === 'deadlock' || e.kind === 'collision' || e.kind === 'no-route' ? 'neg' : ''}>
                  {formatTime(e.t)} · {e.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <details className="assumptions">
        <summary>{t('Annahmen der Simulation')}</summary>
        <ul>
          {simAssumptions(settings).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}
