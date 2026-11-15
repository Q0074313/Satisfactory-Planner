/**
 * Automatisch verbinden: Bänder, Rohre, Splitter, Zusammenführungen und
 * Rohrkreuzungen zwischen den aufgestellten Gebäuden einer Fabrik anlegen.
 * Die Vorschau rechnet auf einer Kopie des Projekts.
 */
import { useMemo, useState } from 'react';
import { autoConnect, localName, type AutoConnectOptions, type Project } from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useUnlocks } from '../../state/unlocks';
import { Dialog, Row, Section } from '../../ui/fields';

export function AutoConnectDialog() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const factoryId = useUiStore((s) => s.autoConnect!.factoryId);
  const close = useUiStore((s) => s.closeAutoConnect);
  const unlocks = useUnlocks();
  const highest = (list: typeof gd.beltTiers) => (list.filter((b) => !unlocks.buildingLocked(b.id)).at(-1) ?? list[0]!).id;
  const [opts, setOpts] = useState<AutoConnectOptions>(() => ({ beltTier: highest(gd.beltTiers), pipeTier: highest(gd.pipeTiers), terminals: true }));
  const factory = project.factories[factoryId];
  const preview = useMemo(() => {
    const copy = JSON.parse(JSON.stringify(project)) as Project;
    return autoConnect(copy, gd, factoryId, opts);
  }, [project, gd, factoryId, opts]);
  const c = preview.counts;
  const run = () => {
    const res = apply(t('Automatisch verbinden'), (d, g) => autoConnect(d, g, factoryId, opts));
    if (res) {
      useUiStore.getState().toast(t('{n} Leitungen angelegt.', { n: res.counts.links }));
      close();
    }
  };
  return (
    <Dialog title={t('Automatisch verbinden: {name}', { name: factory?.name ?? '' })} onClose={close} wide>
      <div className="pad">
        <p className="dim small-text">
          {t(
            'Verbindet die aufgestellten Gebäude laut Bedarf ihrer Rezepte: je Gegenstand eine Kette mit Zusammenführungen vor den Ausgängen und Splittern vor den Eingängen (Rohre: Rohrkreuzungen). Wege laufen um Gebäude herum; wo sich Leitungen kreuzen, geht eine per Lift 4 m höher. Bestehende Leitungen bleiben.',
          )}
        </p>
        <Section title={t('Optionen')}>
          <Row label={t('Bänder bis')}>
            <select value={opts.beltTier} onChange={(e) => setOpts({ ...opts, beltTier: e.target.value })} data-testid="ac-belt">
              {gd.beltTiers.map((b) => (
                <option key={b.id} value={b.id} className={unlocks.buildingLocked(b.id) ? 'locked' : undefined}>
                  {localName(b.name)} ({b.conveyor!.itemsPerMin}/min)
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('Rohre bis')}>
            <select value={opts.pipeTier} onChange={(e) => setOpts({ ...opts, pipeTier: e.target.value })} data-testid="ac-pipe">
              {gd.pipeTiers.map((b) => (
                <option key={b.id} value={b.id} className={unlocks.buildingLocked(b.id) ? 'locked' : undefined}>
                  {localName(b.name)} ({b.pipe!.m3PerMin} m³/min)
                </option>
              ))}
            </select>
          </Row>
          <label className="check-row" title={t('Für Mengen, die in der Fabrik fehlen bzw. übrig bleiben, Lager bzw. Flüssigkeitspuffer am Rand anlegen')}>
            <input type="checkbox" checked={opts.terminals} onChange={(e) => setOpts({ ...opts, terminals: e.target.checked })} />
            {t('Ein- und Ausgänge anlegen')}
          </label>
        </Section>
        <Section title={t('Vorschau')}>
          <p data-testid="ac-summary">
            {t('{l} Leitungen für {i} Gegenstände', { l: c.links, i: c.items })} · {t('{s} Splitter, {g} Zusammenführungen, {j} Rohrkreuzungen', { s: c.splitters, g: c.mergers, j: c.junctions })} ·{' '}
            {t('{t} Ein-/Ausgänge, {f} Lifte', { t: c.terminals, f: c.lifts })}
          </p>
          {c.links === 0 && <p className="dim small-text">{t('Nichts zu verbinden: Maschinen mit Rezept aufstellen (z. B. aus einem Produktionsplan über „Maschinen anlegen“) – bereits verbundene Anschlüsse werden nicht verändert.')}</p>}
          {preview.notes.length > 0 && (
            <ul className="small-text">
              {preview.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Section>
        <div className="button-row">
          <button onClick={close}>{t('Abbrechen')}</button>
          <button className="primary" disabled={c.links === 0} onClick={run} data-testid="ac-run">
            {t('Verbinden')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
