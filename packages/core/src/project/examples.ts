/**
 * Beispielprojekte für den Einstieg (Tutorial): aus den normalen Operationen
 * aufgebaut, damit sie immer zum Schema und zu den Spieldaten passen.
 *
 * - `simple`: Eisenwerk – Miner → 2 Schmelzöfen → Eisenplatten und -stangen,
 *   alles genau ausgelastet, mit passendem Produktionsplan.
 * - `complex`: Eisenwerk liefert Platten per Lkw und Stangen über ein direktes
 *   Band an eine Montage (verstärkte Eisenplatten), Produktionspläne mit Import.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Project } from '../model/schema.ts';
import { createProject } from './create.ts';
import * as fac from './ops/factory.ts';
import * as prod from './ops/production.ts';
import * as trn from './ops/transport.ts';

export type ExampleKind = 'simple' | 'complex';

const MK1 = 'Build_ConveyorBeltMk1_C';
/** Eingänge liegen lokal hinten (−y), Ausgänge vorn (+y); 270° dreht die Ausgänge in Flussrichtung (+x). */
const FLOW_ROT = 270;

/**
 * Baukasten für eine Fabrik: Gebäude in Flussrichtung gedreht, je Gebäude eine
 * Reihe (y), auf der seine Anschlüsse liegen; Bänder rechtwinklig verlegt.
 */
function builder(p: Project, gd: GameDataIndex, factoryId: string) {
  const floorId = p.factories[factoryId]!.floorIds[0]!;
  const add = (type: string, x: number, row: number, extra: Partial<fac.NewBuilding> = {}) => {
    // Anschlüsse liegen auf der Mittellinie der Hülle: nach der Drehung bei y − Mitte(x)
    const b = gd.building(type)?.bounds;
    const cx = b ? (b.minX + b.maxX) / 2 : 0;
    return fac.addBuilding(p, gd, { factoryId, type, placement: { floorId, x, y: row + cx, zOffsetM: 0, rotationDeg: FLOW_ROT }, ...extra });
  };
  const belt = (from: string, fromPort: number, to: string, toPort: number) =>
    fac.addLink(p, gd, { kind: 'belt', tier: MK1, routing: 'straight', from: { buildingId: from, portId: `belt-out-${fromPort}` }, to: { buildingId: to, portId: `belt-in-${toPort}` } });
  const area = (x0: number, y0: number, x1: number, y1: number, name: string) =>
    fac.addArea(p, { factoryId, floorId, kind: 'build-area', name, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
  return { add, belt, area };
}

const ore = { extraction: { itemId: 'Desc_OreIron_C', purity: 'normal' as const } };

/** Erz → zwei Schmelzöfen → Zusammenführung: liefert die ID der Zusammenführung (60 Barren/min). */
function smelting(b: ReturnType<typeof builder>) {
  const miner = b.add('Build_MinerMk1_C', 0, 0, { ...ore, label: tr('Eisenerz (normal)') });
  const split = b.add('Build_ConveyorAttachmentSplitter_C', 16, 0);
  const s1 = b.add('Build_SmelterMk1_C', 32, -12, { recipeId: 'Recipe_IngotIron_C' });
  const s2 = b.add('Build_SmelterMk1_C', 32, 12, { recipeId: 'Recipe_IngotIron_C' });
  const merge = b.add('Build_ConveyorAttachmentMerger_C', 48, 0);
  b.belt(miner, 0, split, 0);
  // Nach der Drehung: Splitter-Ausgang 2 oben (−y), 1 geradeaus, 0 unten; Zusammenführung ebenso
  b.belt(split, 2, s1, 0);
  b.belt(split, 0, s2, 0);
  b.belt(s1, 0, merge, 2);
  b.belt(s2, 0, merge, 0);
  return merge;
}

export function buildExampleProject(gd: GameDataIndex, kind: ExampleKind, base: { datasetId: string; gameVersion: string; now?: Date }): Project {
  const p = createProject({ ...base, name: kind === 'simple' ? tr('Beispiel: Eisenwerk') : tr('Beispiel: Montage mit Transport') });
  const first = Object.keys(p.factories)[0]!;
  if (kind === 'simple') {
    fac.updateFactory(p, first, { name: tr('Eisenwerk'), notes: tr('Beispiel: Ein Miner auf einem normalen Eisenvorkommen versorgt zwei Schmelzöfen. Die Barren gehen zu einem Konstruktor für Platten und zwei für Stangen. Alle Maschinen laufen genau mit 100 %.') });
    const b = builder(p, gd, first);
    b.area(-10, -30, 120, 30, tr('Baufläche'));
    const merge = smelting(b);
    const split = b.add('Build_ConveyorAttachmentSplitter_C', 62, 0);
    const plates = b.add('Build_ConstructorMk1_C', 80, -18, { recipeId: 'Recipe_IronPlate_C' });
    const rod1 = b.add('Build_ConstructorMk1_C', 80, 0, { recipeId: 'Recipe_IronRod_C' });
    const rod2 = b.add('Build_ConstructorMk1_C', 80, 18, { recipeId: 'Recipe_IronRod_C' });
    const rodMerge = b.add('Build_ConveyorAttachmentMerger_C', 96, 9);
    const boxPlates = b.add('Build_StorageContainerMk1_C', 108, -18, { label: tr('Eisenplatten') });
    const boxRods = b.add('Build_StorageContainerMk1_C', 108, 9, { label: tr('Eisenstangen') });
    b.belt(merge, 0, split, 0);
    b.belt(split, 2, plates, 0);
    b.belt(split, 1, rod1, 0);
    b.belt(split, 0, rod2, 0);
    b.belt(plates, 0, boxPlates, 0);
    b.belt(rod1, 0, rodMerge, 2);
    b.belt(rod2, 0, rodMerge, 0);
    b.belt(rodMerge, 0, boxRods, 0);
    const plan = prod.addPlan(p, first, tr('Platten und Stangen'));
    prod.updatePlan(p, gd, plan, {
      targets: [
        { itemId: 'Desc_IronPlate_C', ratePerMin: 20 },
        { itemId: 'Desc_IronRod_C', ratePerMin: 30 },
      ],
      supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: 60, origin: 'local' }],
    });
    return p;
  }

  // Komplex: Eisenwerk → Lkw → Montage
  fac.updateFactory(p, first, { name: tr('Eisenwerk'), notes: tr('Liefert Eisenplatten per Lkw und Eisenstangen über ein direktes Band an die Montage. Die Plattenkonstruktoren laufen mit 75 %.') });
  const w = builder(p, gd, first);
  w.area(-10, -30, 140, 30, tr('Baufläche'));
  const merge = smelting(w);
  const split = w.add('Build_ConveyorAttachmentSplitter_C', 62, 0);
  const p1 = w.add('Build_ConstructorMk1_C', 80, -18, { recipeId: 'Recipe_IronPlate_C', clock: 0.75 });
  const p2 = w.add('Build_ConstructorMk1_C', 80, 0, { recipeId: 'Recipe_IronPlate_C', clock: 0.75 });
  const rod = w.add('Build_ConstructorMk1_C', 80, 18, { recipeId: 'Recipe_IronRod_C' });
  const plateMerge = w.add('Build_ConveyorAttachmentMerger_C', 96, -9);
  const truckOut = w.add('Build_TruckStation_C', 116, 4, { label: tr('Lkw-Station (Beladen)'), transfer: { mode: 'load', stationId: null } });
  w.belt(merge, 0, split, 0);
  w.belt(split, 2, p1, 0);
  w.belt(split, 1, p2, 0);
  w.belt(split, 0, rod, 0);
  w.belt(p1, 0, plateMerge, 2);
  w.belt(p2, 0, plateMerge, 0);
  w.belt(plateMerge, 0, truckOut, 0);
  const wPlan = prod.addPlan(p, first, tr('Ausfuhr zur Montage'));
  prod.updatePlan(p, gd, wPlan, {
    targets: [
      { itemId: 'Desc_IronPlate_C', ratePerMin: 30 },
      { itemId: 'Desc_IronRod_C', ratePerMin: 15 },
    ],
    supplies: [{ itemId: 'Desc_OreIron_C', maxPerMin: 60, origin: 'local' }],
  });

  const mId = fac.addFactory(p, tr('Montage'));
  fac.updateFactory(p, mId, { notes: tr('Erhält Platten per Lkw und Stangen über ein direktes Band und fertigt daraus verstärkte Eisenplatten.') });
  const m = builder(p, gd, mId);
  m.area(-20, -30, 100, 30, tr('Baufläche'));
  const truckIn = m.add('Build_TruckStation_C', 0, 4, { label: tr('Lkw-Station (Entladen)'), transfer: { mode: 'unload', stationId: null } });
  const rodSplit = m.add('Build_ConveyorAttachmentSplitter_C', 24, 12);
  const sc1 = m.add('Build_ConstructorMk1_C', 40, 4, { recipeId: 'Recipe_Screw_C', clock: 0.75 });
  const sc2 = m.add('Build_ConstructorMk1_C', 40, 20, { recipeId: 'Recipe_Screw_C', clock: 0.75 });
  const screwMerge = m.add('Build_ConveyorAttachmentMerger_C', 56, 12);
  const asm = m.add('Build_AssemblerMk1_C', 72, -4, { recipeId: 'Recipe_IronPlateReinforced_C' });
  const box = m.add('Build_StorageContainerMk1_C', 92, -4, { label: tr('Verstärkte Eisenplatten') });
  m.belt(truckIn, 0, asm, 0);
  m.belt(rodSplit, 2, sc1, 0);
  m.belt(rodSplit, 0, sc2, 0);
  m.belt(sc1, 0, screwMerge, 2);
  m.belt(sc2, 0, screwMerge, 0);
  m.belt(screwMerge, 0, asm, 1);
  m.belt(asm, 0, box, 0);
  const mPlan = prod.addPlan(p, mId, tr('Verstärkte Eisenplatten'));
  prod.updatePlan(p, gd, mPlan, {
    targets: [{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 5 }],
    supplies: [
      { itemId: 'Desc_IronPlate_C', maxPerMin: null, origin: 'import' },
      { itemId: 'Desc_IronRod_C', maxPerMin: null, origin: 'import' },
    ],
  });

  const order = { name: '', fromFactoryId: first, toFactoryId: mId, fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null };
  trn.addOrder(p, gd, { ...order, itemId: 'Desc_IronPlate_C', ratePerMin: 30, mode: 'vehicle', vehicle: { type: 'Desc_Truck_C', count: 1, distanceM: 800, speedKmh: null } });
  trn.addOrder(p, gd, {
    ...order,
    itemId: 'Desc_IronRod_C',
    ratePerMin: 15,
    mode: 'belt',
    direct: { tier: MK1, lines: 1, lengthM: 800, from: { buildingId: rod, portId: 'belt-out-0' }, to: { buildingId: rodSplit, portId: 'belt-in-0' } },
  });
  return p;
}
