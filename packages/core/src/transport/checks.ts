/**
 * Prüfungen der Transportplanung zwischen Fabriken.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { ObjectRef, Project, TransportOrder } from '../model/schema.ts';
import { transferCargo, transferInterface } from '../factory/geometry.ts';
import { makeFinding } from '../validation/registry.ts';
import type { Finding } from '../validation/types.ts';
import { orderMapDistance } from '../map/index.ts';
import { cargoKind, estimateOrder, factoryTrade } from './estimate.ts';
import {
  TRN_CAPACITY,
  TRN_DIRECT_CAPACITY,
  TRN_DRONE_CAPACITY,
  TRN_DRONE_FUEL,
  TRN_ESTIMATE,
  TRN_MODE_MISMATCH,
  TRN_NO_INTERFACE,
  TRN_NO_VEHICLE,
  TRN_VEHICLE_CAPACITY,
  TRN_IMPORT_GAP,
  TRN_MAP_DISTANCE,
  TRN_NO_PLATFORM,
  TRN_NO_TRAIN,
  TRN_STATION_FACTORY,
  TRN_STOP_EXCLUDES_ITEM,
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
    if (o.mode !== 'train') {
      out.push(...checkOtherMode(p, gd, o, ref, label));
      continue;
    }
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
      if (te.excludedFrom || te.excludedTo) {
        out.push(
          makeFinding(TRN_STOP_EXCLUDES_ITEM, [ref, tref, ...(t.timetableId ? [{ table: 'timetables', id: t.timetableId } as ObjectRef] : [])], {
            message: te.excludedFrom
              ? tr('{train} hält am Ladebahnhof, lädt {item} dort aber nicht', { train: t.name, item: gd.name(o.itemId) })
              : tr('{train} hält am Entladebahnhof, entlädt {item} dort aber nicht', { train: t.name, item: gd.name(o.itemId) }),
            explanation: tr(TRN_STOP_EXCLUDES_ITEM.description),
            suggestion: tr('Im Fahrplan beim Halt „Umschlag: alles“ wählen oder den Gegenstand in die Auswahl aufnehmen.'),
          }),
        );
      }
      if ((!te.servesFrom && !te.excludedFrom) || (!te.servesTo && !te.excludedTo)) {
        const missFrom = !te.servesFrom && !te.excludedFrom;
        const missTo = !te.servesTo && !te.excludedTo;
        out.push(
          makeFinding(TRN_TIMETABLE_MISSES_STATION, [ref, tref], {
            message:
              missFrom && missTo
                ? tr('{train} hält weder am Lade- noch am Entladebahnhof', { train: t.name })
                : missFrom
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
      const has = Object.values(p.buildings).some(
        (b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === mode && transferInterface(gd.building(b.type)) === 'train',
      );
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
      if (r.fuelGap > 1e-6) {
        out.push(
          makeFinding(
            TRN_DRONE_FUEL,
            [{ table: 'factories', id: f.id }],
            {
              message: tr('{factory}: Drohnen brauchen {need} {item}, verfügbar {have}', {
                factory: f.name,
                need: `${formatNumber(r.transportFuel, 2)} /min`,
                item: gd.name(r.itemId),
                have: `${formatNumber(Math.max(0, r.net + r.imports - r.exports), 2)} /min`,
              }),
              explanation: tr(TRN_DRONE_FUEL.description),
              suggestion: tr('Brennstoff in der Fabrik herstellen, per Transportauftrag liefern oder am Zielhafen einspeisen.'),
            },
            { keyExtra: `fuel:${r.itemId}` },
          ),
        );
      }
    }
  }
  const trainOrders = orders.filter((o) => o.mode === 'train' && o.trainIds.length > 0);
  if (trainOrders.length) {
    out.push(
      makeFinding(TRN_ESTIMATE, trainOrders.map((o) => ({ table: 'transportOrders', id: o.id }) as ObjectRef), {
        message: tr('Zugdurchsatz beruht auf Schätzungen'),
        explanation: tr(TRN_ESTIMATE.description),
        suggestion: tr('Annahmen in der Ansicht „Transport“ anpassen oder Umlaufzeiten mit der Simulation messen.'),
      }),
    );
  }
  return out;
}

/** Prüfungen für Fahrzeugaufträge und direkte Bänder/Rohre. */
/** Angegebene Strecke gegen die Luftlinie laut Karte (Drohne: höchstens 10 % länger). */
export function mapDistanceFinding(p: Project, gd: GameDataIndex, o: TransportOrder, ref: ObjectRef, label: string): Finding | null {
  const given = o.mode === 'vehicle' ? o.vehicle?.distanceM : o.mode === 'drone' ? o.drone?.distanceM : o.direct?.lengthM || undefined;
  const m = given === undefined ? null : orderMapDistance(p, gd, o);
  if (given === undefined || !m || m.distM < 1) return null;
  const tooShort = given < m.distM * 0.95;
  const tooLong = o.mode === 'drone' && given > m.distM * 1.1 + 50;
  if (!tooShort && !tooLong) return null;
  return makeFinding(TRN_MAP_DISTANCE, [ref], {
    message: tooShort
      ? tr('{order}: Strecke {given} m ist kürzer als die Luftlinie {map} m', { order: label, given: formatNumber(given, 0), map: formatNumber(m.distM, 0) })
      : tr('{order}: Strecke {given} m, Drohnen fliegen aber nur die Luftlinie {map} m', { order: label, given: formatNumber(given, 0), map: formatNumber(m.distM, 0) }),
    explanation: `${tr(TRN_MAP_DISTANCE.description)} ${m.basis === 'ports' ? tr('Gemessen zwischen den Übergabegebäuden.') : tr('Gemessen zwischen den Fabrikmitten (keine platzierten Übergabegebäude).')}`,
    suggestion: tr('Im Auftrag „Von Karte übernehmen“ wählen oder die Strecke anpassen.'),
  });
}

function checkOtherMode(p: Project, gd: GameDataIndex, o: TransportOrder, ref: ObjectRef, label: string): Finding[] {
  const out: Finding[] = [];
  const est = estimateOrder(p, gd, o);
  const u = unit(gd, o.itemId);
  const fname = (id: string) => p.factories[id]?.name ?? '?';
  const distance = mapDistanceFinding(p, gd, o, ref, label);
  if (distance) out.push(distance);
  if (o.mode === 'vehicle') {
    const v = est.vehicle;
    if (v && !v.kindOk) {
      out.push(
        makeFinding(TRN_MODE_MISMATCH, [ref], {
          message: tr('{order}: {vehicle} kann {item} nicht befördern', { order: label, vehicle: gd.name(v.vehicleId), item: gd.name(o.itemId) }),
          explanation: tr(TRN_MODE_MISMATCH.description),
          suggestion: cargoKind(gd, o.itemId) === 'solid' ? tr('Schlepper, Lkw oder Explorer wählen.') : tr('Tanklaster wählen.'),
        }),
      );
    } else if (v && v.count === 0) {
      out.push(
        makeFinding(TRN_NO_VEHICLE, [ref], {
          message: tr('{order}: kein Fahrzeug eingeplant', { order: label }),
          explanation: tr(TRN_NO_VEHICLE.description),
          suggestion: tr('Anzahl der Fahrzeuge im Auftrag festlegen.'),
        }),
      );
    } else if (v && !est.ok) {
      out.push(
        makeFinding(TRN_VEHICLE_CAPACITY, [ref], {
          message: tr('{order}: geschätzt {have} statt {need}', { order: label, have: `${formatNumber(est.perMin, 1)} ${u}`, need: `${formatNumber(o.ratePerMin, 1)} ${u}` }),
          explanation: `${tr('{n} × {vehicle}: {cap} je Fahrt, Umlauf {cycle}.', {
            n: v.count,
            vehicle: gd.name(v.vehicleId),
            cap: `${formatNumber(v.capacityPerTrip, 0)} ${cargoKind(gd, o.itemId) === 'solid' ? tr('Stück') : 'm³'}`,
            cycle: v.cycleS ? `${formatNumber(v.cycleS, 0)} s` : '–',
          })} ${tr(TRN_VEHICLE_CAPACITY.description)}`,
          suggestion: tr('Mindestens {n} Fahrzeuge einsetzen, ein größeres Fahrzeug wählen oder die Strecke verkürzen.', {
            n: v.capacityPerTrip > 0 && v.cycleS ? Math.ceil((o.ratePerMin * v.cycleS) / (60 * v.capacityPerTrip)) : '?',
          }),
        }),
      );
    }
    // LKW- bzw. Tanklaster-Station im passenden Modus
    const solid = cargoKind(gd, o.itemId) === 'solid';
    for (const [factoryId, mode] of [
      [o.fromFactoryId, 'load'],
      [o.toFactoryId, 'unload'],
    ] as const) {
      const has = Object.values(p.buildings).some((b) => {
        const def = gd.building(b.type);
        return b.factoryId === factoryId && b.placement && b.transfer?.mode === mode && transferInterface(def) === 'vehicle' && (transferCargo(def!) === 'solid') === solid;
      });
      if (!has) {
        out.push(
          makeFinding(
            TRN_NO_INTERFACE,
            [ref, { table: 'factories', id: factoryId }],
            {
              message:
                mode === 'load'
                  ? tr('{factory}: keine beladende {station} im Grundriss', { factory: fname(factoryId), station: gd.name(solid ? 'Build_TruckStation_C' : 'Build_FluidTruckStation_C') })
                  : tr('{factory}: keine entladende {station} im Grundriss', { factory: fname(factoryId), station: gd.name(solid ? 'Build_TruckStation_C' : 'Build_FluidTruckStation_C') }),
              explanation: tr(TRN_NO_INTERFACE.description),
              suggestion: tr('Station im Grundriss platzieren und in den Eigenschaften Be- bzw. Entladen wählen.'),
            },
            { keyExtra: mode },
          ),
        );
      }
    }
    return out;
  }
  if (o.mode === 'drone') {
    const dr = est.drone;
    if (dr && !dr.kindOk) {
      out.push(
        makeFinding(TRN_MODE_MISMATCH, [ref], {
          message: tr('{order}: Drohnen befördern keine Flüssigkeiten', { order: label }),
          explanation: tr(TRN_MODE_MISMATCH.description),
          suggestion: tr('Abgefüllte Form transportieren, Tanklaster, Zug oder Rohr wählen.'),
        }),
      );
    } else if (dr && dr.count === 0) {
      out.push(
        makeFinding(TRN_NO_VEHICLE, [ref], {
          message: tr('{order}: keine Drohne eingeplant', { order: label }),
          explanation: tr(TRN_NO_VEHICLE.description),
          suggestion: tr('Anzahl der Drohnen im Auftrag festlegen.'),
        }),
      );
    } else if (dr && !est.ok) {
      out.push(
        makeFinding(TRN_DRONE_CAPACITY, [ref], {
          message: tr('{order}: geschätzt {have} statt {need}', { order: label, have: `${formatNumber(est.perMin, 1)} ${u}`, need: `${formatNumber(o.ratePerMin, 1)} ${u}` }),
          explanation: `${tr('{n} Drohne(n): {cap} Stück je Flug, Umlauf {cycle}.', { n: dr.count, cap: formatNumber(dr.capacityPerTrip, 0), cycle: dr.cycleS ? `${formatNumber(dr.cycleS, 0)} s` : '–' })} ${tr(TRN_DRONE_CAPACITY.description)}`,
          suggestion: tr('Mindestens {n} Drohnen (je Drohne ein Hafen beim Absender) einsetzen oder einen schnelleren Brennstoff wählen.', {
            n: dr.capacityPerTrip > 0 && dr.cycleS ? Math.ceil((o.ratePerMin * dr.cycleS) / (60 * dr.capacityPerTrip)) : '?',
          }),
        }),
      );
    }
    for (const [factoryId, mode] of [
      [o.fromFactoryId, 'load'],
      [o.toFactoryId, 'unload'],
    ] as const) {
      const has = Object.values(p.buildings).some((b) => b.factoryId === factoryId && b.placement && b.transfer?.mode === mode && transferInterface(gd.building(b.type)) === 'drone');
      if (!has) {
        out.push(
          makeFinding(
            TRN_NO_INTERFACE,
            [ref, { table: 'factories', id: factoryId }],
            {
              message:
                mode === 'load'
                  ? tr('{factory}: kein beladender Drohnenhafen im Grundriss', { factory: fname(factoryId) })
                  : tr('{factory}: kein entladender Drohnenhafen im Grundriss', { factory: fname(factoryId) }),
              explanation: tr(TRN_NO_INTERFACE.description),
              suggestion: tr('Drohnenhafen im Grundriss platzieren und in den Eigenschaften Be- bzw. Entladen wählen.'),
            },
            { keyExtra: mode },
          ),
        );
      }
    }
    return out;
  }
  // Direkte Bänder und Rohre
  const d = est.direct;
  if (d && !d.kindOk) {
    out.push(
      makeFinding(TRN_MODE_MISMATCH, [ref], {
        message:
          o.mode === 'belt'
            ? tr('{order}: {item} passt nicht auf ein Förderband', { order: label, item: gd.name(o.itemId) })
            : tr('{order}: {item} passt nicht in ein Rohr', { order: label, item: gd.name(o.itemId) }),
        explanation: tr(TRN_MODE_MISMATCH.description),
        suggestion: o.mode === 'belt' ? tr('Rohr wählen.') : tr('Förderband wählen.'),
      }),
    );
  } else if (d && !est.ok) {
    const per = d.lines > 0 ? d.capacity / d.lines : 0;
    out.push(
      makeFinding(TRN_DIRECT_CAPACITY, [ref], {
        message: tr('{order}: {lines} × {tier} schaffen {have}, benötigt {need}', {
          order: label,
          lines: d.lines,
          tier: gd.name(d.tier),
          have: `${formatNumber(d.capacity, 0)} ${u}`,
          need: `${formatNumber(o.ratePerMin, 1)} ${u}`,
        }),
        explanation: tr(TRN_DIRECT_CAPACITY.description),
        suggestion: tr('Höhere Stufe wählen oder mindestens {n} parallele Leitungen verlegen.', { n: per > 0 ? Math.ceil(o.ratePerMin / per - 1e-9) : '?' }),
      }),
    );
  }
  for (const [end, factoryId, role] of [
    [o.direct?.from, o.fromFactoryId, 'from'],
    [o.direct?.to, o.toFactoryId, 'to'],
  ] as const) {
    if (end) continue;
    out.push(
      makeFinding(
        TRN_NO_INTERFACE,
        [ref, { table: 'factories', id: factoryId }],
        {
          message:
            role === 'from'
              ? tr('{factory}: kein Ausgang für die Leitung zu {other} gewählt', { factory: fname(factoryId), other: fname(o.toFactoryId) })
              : tr('{factory}: kein Eingang für die Leitung von {other} gewählt', { factory: fname(factoryId), other: fname(o.fromFactoryId) }),
          explanation: tr(TRN_NO_INTERFACE.description),
          suggestion: tr('Im Transportauftrag den Übergabeanschluss in beiden Fabriken wählen.'),
        },
        { keyExtra: role },
      ),
    );
  }
  return out;
}
