/**
 * Prüfungen der Transportplanung zwischen Fabriken.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { ObjectRef, Project } from '../model/schema.ts';
import { makeFinding } from '../validation/registry.ts';
import type { Finding } from '../validation/types.ts';
import { cargoKind, estimateOrder, factoryTrade } from './estimate.ts';
import {
  TRN_CAPACITY,
  TRN_ESTIMATE,
  TRN_IMPORT_GAP,
  TRN_NO_PLATFORM,
  TRN_NO_TRAIN,
  TRN_STATION_FACTORY,
  TRN_SUPPLIER_SHORT,
  TRN_TIMETABLE_MISSES_STATION,
  TRN_WRONG_WAGON,
} from './rules.ts';

const unit = (gd: GameDataIndex, itemId: string) => (cargoKind(gd, itemId) === 'solid' ? '/min' : 'm³/min');

export function checkTransport(p: Project, gd: GameDataIndex): Finding[] {
  const out: Finding[] = [];
  const orders = Object.values(p.transportOrders);
  for (const o of orders) {
    const ref: ObjectRef = { table: 'transportOrders', id: o.id };
    const fromF = p.factories[o.fromFactoryId]?.name ?? '?';
    const toF = p.factories[o.toFactoryId]?.name ?? '?';
    const label = `${o.name || gd.name(o.itemId)} (${fromF} → ${toF})`;
    if (o.trainIds.length === 0) {
      out.push(
        makeFinding(TRN_NO_TRAIN, [ref], {
          message: tr('{order}: kein Zug zugeordnet', { order: label }),
          explanation: tr(TRN_NO_TRAIN.description),
          suggestion: tr('Im Transportauftrag einen Zug auswählen, dessen Fahrplan Lade- und Entladebahnhof enthält.'),
        }),
      );
    }
    for (const [stationId, factoryId, role] of [
      [o.fromStationId, o.fromFactoryId, 'from'],
      [o.toStationId, o.toFactoryId, 'to'],
    ] as const) {
      const st = stationId ? p.stations[stationId] : undefined;
      if (st && st.factoryId && st.factoryId !== factoryId) {
        out.push(
          makeFinding(
            TRN_STATION_FACTORY,
            [ref, { table: 'stations', id: st.id }],
            {
              message:
                role === 'from'
                  ? tr('{order}: Ladebahnhof „{station}“ gehört zu einer anderen Fabrik', { order: label, station: st.name })
                  : tr('{order}: Entladebahnhof „{station}“ gehört zu einer anderen Fabrik', { order: label, station: st.name }),
              explanation: tr(TRN_STATION_FACTORY.description),
              suggestion: tr('Bahnhof der richtigen Fabrik zuordnen oder einen anderen Bahnhof wählen.'),
            },
            { keyExtra: role },
          ),
        );
      }
    }
    const kind = cargoKind(gd, o.itemId);
    const est = estimateOrder(p, gd, o);
    for (const te of est.trains) {
      const t = p.trains[te.trainId]!;
      const tref: ObjectRef = { table: 'trains', id: t.id };
      if (!t.consist.some((v) => v.kind === 'wagon' && v.cargo === kind)) {
        out.push(
          makeFinding(TRN_WRONG_WAGON, [ref, tref], {
            message: kind === 'liquid' ? tr('{train}: kein Flüssigkeitswagen für {item}', { train: t.name, item: gd.name(o.itemId) }) : tr('{train}: kein Güterwagen für {item}', { train: t.name, item: gd.name(o.itemId) }),
            explanation: tr(TRN_WRONG_WAGON.description),
            suggestion: tr('Passende Wagen an den Zug hängen oder einen anderen Zug zuordnen.'),
          }),
        );
      }
      if (!te.servesFrom || !te.servesTo) {
        out.push(
          makeFinding(TRN_TIMETABLE_MISSES_STATION, [ref, tref], {
            message:
              !te.servesFrom && !te.servesTo
                ? tr('{train} hält weder am Lade- noch am Entladebahnhof', { train: t.name })
                : !te.servesFrom
                  ? tr('{train} hält nicht am Ladebahnhof', { train: t.name })
                  : tr('{train} hält nicht am Entladebahnhof', { train: t.name }),
            explanation: tr(TRN_TIMETABLE_MISSES_STATION.description),
            suggestion: tr('Bahnhof in den Fahrplan des Zuges aufnehmen oder im Auftrag den richtigen Bahnhof wählen.'),
          }),
        );
      }
    }
    if (est.trains.length > 0 && !est.ok) {
      out.push(
        makeFinding(TRN_CAPACITY, [ref, ...est.trains.map((x) => ({ table: 'trains', id: x.trainId }) as ObjectRef)], {
          message: tr('{order}: geschätzt {have} statt {need}', {
            order: label,
            have: `${formatNumber(est.perMin, 1)} ${unit(gd, o.itemId)}`,
            need: `${formatNumber(o.ratePerMin, 1)} ${unit(gd, o.itemId)}`,
          }),
          explanation: `${tr(TRN_CAPACITY.description)} ${est.trains
            .map((x) =>
              tr('{train}: {cap} je Umlauf × Anteil {share} % / {cycle}', {
                train: p.trains[x.trainId]?.name ?? '?',
                cap: `${formatNumber(x.capacityPerCycle, 0)} ${cargoKind(gd, o.itemId) === 'solid' ? tr('Stück') : 'm³'}`,
                share: formatNumber(x.share * 100, 0),
                cycle: x.cycleS ? `${formatNumber(x.cycleS, 0)} s` : tr('Umlauf nicht befahrbar'),
              }),
            )
            .join('; ')}`,
          suggestion: tr('Weitere Wagen oder Züge einsetzen, Wartezeiten verkürzen oder die Strecke verkürzen.'),
        }),
      );
    }
    // Frachtplattform im passenden Modus
    for (const [factoryId, mode] of [
      [o.fromFactoryId, 'load'],
      [o.toFactoryId, 'unload'],
    ] as const) {
      const has = Object.values(p.buildings).some((b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === mode);
      if (!has) {
        out.push(
          makeFinding(
            TRN_NO_PLATFORM,
            [ref, { table: 'factories', id: factoryId }],
            {
              message:
                mode === 'load'
                  ? tr('{factory}: keine beladende Frachtplattform im Grundriss', { factory: p.factories[factoryId]?.name ?? '?' })
                  : tr('{factory}: keine entladende Frachtplattform im Grundriss', { factory: p.factories[factoryId]?.name ?? '?' }),
              explanation: tr(TRN_NO_PLATFORM.description),
              suggestion: tr('Frachtplattform im Grundriss platzieren und in den Eigenschaften Be- bzw. Entladen wählen.'),
            },
            { keyExtra: mode },
          ),
        );
      }
    }
  }

  // Lücken je Fabrik: Importbedarf und Lieferfähigkeit
  for (const f of Object.values(p.factories)) {
    for (const r of factoryTrade(p, gd, f.id)) {
      if (r.importGap > 1e-6) {
        out.push(
          makeFinding(
            TRN_IMPORT_GAP,
            [{ table: 'factories', id: f.id }],
            {
              message: tr('{factory}: Import {item} – Bedarf {need}, Aufträge {have}', {
                factory: f.name,
                item: gd.name(r.itemId),
                need: `${formatNumber(r.planImports, 2)} ${unit(gd, r.itemId)}`,
                have: `${formatNumber(r.imports, 2)} ${unit(gd, r.itemId)}`,
              }),
              explanation: tr(TRN_IMPORT_GAP.description),
              suggestion: tr('Transportauftrag aus einer liefernden Fabrik anlegen oder die Versorgung im Produktionsplan auf „lokal“ umstellen.'),
            },
            { keyExtra: r.itemId },
          ),
        );
      }
      if (r.exportGap > 1e-6) {
        out.push(
          makeFinding(
            TRN_SUPPLIER_SHORT,
            [{ table: 'factories', id: f.id }],
            {
              message: tr('{factory}: liefert {out} {item}, Überschuss nur {have}', {
                factory: f.name,
                out: `${formatNumber(r.exports, 2)} ${unit(gd, r.itemId)}`,
                item: gd.name(r.itemId),
                have: `${formatNumber(Math.max(0, r.net + r.imports), 2)} ${unit(gd, r.itemId)}`,
              }),
              explanation: tr(TRN_SUPPLIER_SHORT.description),
              suggestion: tr('Mehr Maschinen für diesen Gegenstand anlegen (Produktionsplan) oder die Auftragsmenge senken.'),
            },
            { keyExtra: r.itemId },
          ),
        );
      }
    }
  }
  if (orders.some((o) => o.trainIds.length > 0)) {
    out.push(
      makeFinding(TRN_ESTIMATE, orders.filter((o) => o.trainIds.length).map((o) => ({ table: 'transportOrders', id: o.id }) as ObjectRef), {
        message: tr('Zugdurchsatz beruht auf Schätzungen'),
        explanation: tr(TRN_ESTIMATE.description),
        suggestion: tr('Annahmen in der Ansicht „Transport“ anpassen oder Umlaufzeiten mit der Simulation messen.'),
      }),
    );
  }
  return out;
}
