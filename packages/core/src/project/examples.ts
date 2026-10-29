/**
 * Beispielprojekte für den Einstieg (Tutorial): aus den normalen Operationen
 * aufgebaut, damit sie immer zum Schema und zu den Spieldaten passen.
 *
 * - `simple`: Eisenwerk – Miner → 2 Schmelzöfen → Eisenplatten und -stangen,
 *   alles genau ausgelastet, mit passendem Produktionsplan.
 * - `complex`: Eisenwerk liefert Platten per Lkw und Stangen über ein direktes
 *   Band an eine Montage (verstärkte Eisenplatten), Produktionspläne mit Import.
 * - `medium` / `large`: mit dem automatischen Layout erzeugte Fabriken
 *   (Computer bzw. schwere modulare Rahmen); eine Blackbox-Fabrik
 *   „Rohstoffversorgung“ beliefert die Eingänge über direkte Bänder und Rohre.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { tr } from '../i18n/index.ts';
import type { Project } from '../model/schema.ts';
import { createProject } from './create.ts';
import * as fac from './ops/factory.ts';
import * as prod from './ops/production.ts';
import * as trn from './ops/transport.ts';
import { applyLayout, generateLayouts, type AutoLayoutOptions, type LayoutVariant } from '../factory/autoLayout.ts';
import { portDefs } from '../factory/ports.ts';
import { rotate } from '../geometry/index.ts';
import { solveProduction } from '../production/solver.ts';

export type ExampleKind = 'simple' | 'complex' | 'medium' | 'large';

const MK1 = 'Build_ConveyorBeltMk1_C';

/** Anschlusswahl: Nummer oder Seite in der Fabrik (Fluss nach +x; oben = −y). */
type PortPick = number | 'straight' | 'up' | 'down';

const ROTS = [0, 90, 180, 270];
const rot90 = (v: { x: number; y: number }, deg: number) => {
  const r = rotate(v, deg);
  return { x: Math.round(r.x * 1e6) / 1e6, y: Math.round(r.y * 1e6) / 1e6 };
};

/**
 * Baukasten für eine Fabrik: Gebäude in Flussrichtung (+x) gedreht, je
 * Gebäude eine Reihe (y), auf der sein Bezugsanschluss liegt (erster Eingang,
 * bei `face: 'out'` erster Ausgang bzw. der angegebene); Bänder rechtwinklig.
 */
function builder(p: Project, gd: GameDataIndex, factoryId: string) {
  const floorId = p.factories[factoryId]!.floorIds[0]!;
  const add = (type: string, x: number, row: number, extra: Partial<fac.NewBuilding> = {}, at: { face?: 'in' | 'out'; port?: string } = {}) => {
    const ports = portDefs(gd.building(type)!).filter((q) => q.kind === 'belt');
    const face = at.face ?? (ports.some((q) => q.direction === 'in') ? 'in' : 'out');
    const ref = ports.find((q) => q.direction === face && q.role !== 'fuel') ?? ports.find((q) => q.direction === face)!;
    // Eingänge zeigen gegen den Fluss (−x), Ausgänge mit ihm (+x)
    const want = face === 'in' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const rotationDeg = ROTS.find((r) => { const n = rot90(ref.normal, r); return Math.abs(n.x - want.x) + Math.abs(n.y - want.y) < 1e-6; }) ?? 0;
    const anchor = ports.find((q) => q.id === at.port) ?? ref;
    const off = rot90(anchor.local, rotationDeg);
    return fac.addBuilding(p, gd, { factoryId, type, placement: { floorId, x, y: row - off.y, zOffsetM: 0, rotationDeg }, ...extra });
  };
  /** Anschluss eines Gebäudes nach Nummer oder nach der Seite, zu der er zeigt. */
  const port = (id: string, dir: 'in' | 'out', pick: PortPick) => {
    if (typeof pick === 'number') return `belt-${dir}-${pick}`;
    const b = p.buildings[id]!;
    const want = { straight: { x: dir === 'out' ? 1 : -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } }[pick];
    const q = portDefs(gd.building(b.type)!).find((d) => {
      const n = rot90(d.normal, b.placement!.rotationDeg);
      return d.kind === 'belt' && d.direction === dir && Math.abs(n.x - want.x) + Math.abs(n.y - want.y) < 1e-6;
    });
    if (!q) throw new Error(`${b.type}: kein ${dir}-Anschluss ${pick}`);
    return q.id;
  };
  const belt = (from: string, fromPort: PortPick, to: string, toPort: PortPick) =>
    fac.addLink(p, gd, { kind: 'belt', tier: MK1, routing: 'straight', from: { buildingId: from, portId: port(from, 'out', fromPort) }, to: { buildingId: to, portId: port(to, 'in', toPort) } });
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
  b.belt(split, 'up', s1, 0);
  b.belt(split, 'down', s2, 0);
  b.belt(s1, 0, merge, 'up');
  b.belt(s2, 0, merge, 'down');
  return merge;
}

/** Beispiel mit automatischem Layout und Blackbox-Rohstoffversorgung. */
function layoutExample(
  p: Project,
  gd: GameDataIndex,
  init: { name: string; notes: string; itemId: string; ratePerMin: number; variant: LayoutVariant; options: Partial<AutoLayoutOptions> },
): void {
  const fid = Object.keys(p.factories)[0]!;
  fac.updateFactory(p, fid, { name: init.name, notes: init.notes });
  const planId = prod.addPlan(p, fid, gd.name(init.itemId));
  prod.updatePlan(p, gd, planId, { targets: [{ itemId: init.itemId, ratePerMin: init.ratePerMin }] });
  const res = solveProduction(gd, p.productionPlans[planId]!);
  const drafts = generateLayouts(gd, res, init.options);
  const draft = drafts.find((d) => d.variant === init.variant) ?? drafts[0]!;
  const r = applyLayout(p, gd, fid, draft, { x: 0, y: 0 }, { foundations: true });
  // Rohstoffe kommen aus einer Blackbox-Fabrik über direkte Leitungen an die Eingänge
  const supplier = fac.addFactory(p, tr('Rohstoffversorgung'));
  fac.updateFactory(p, supplier, { notes: tr('Blackbox: steht für Miner, Extraktoren und Züge, die die Eingänge der Fabrik beliefern.') });
  p.factories[supplier]!.blackbox = true;
  const need = new Map<string, number>();
  for (const t of draft.terminals) if (t.dir === 'in') need.set(t.itemId, (need.get(t.itemId) ?? 0) + t.perMin);
  const sPlan = prod.addPlan(p, supplier, tr('Rohstoffe'));
  prod.updatePlan(p, gd, sPlan, { targets: [...need].map(([itemId, ratePerMin]) => ({ itemId, ratePerMin: Math.ceil(ratePerMin * 1e4) / 1e4 })) });
  for (const t of draft.terminals) {
    if (t.dir !== 'in') continue;
    const fluid = gd.item(t.itemId)?.form !== 'solid';
    const tier = fluid ? (init.options.pipeTier ?? 'Build_PipelineMK2_C') : (init.options.beltTier ?? 'Build_ConveyorBeltMk5_C');
    const cap = fluid ? gd.building(tier)!.pipe!.m3PerMin : gd.building(tier)!.conveyor!.itemsPerMin;
    trn.addOrder(p, gd, {
      name: '',
      itemId: t.itemId,
      ratePerMin: Math.ceil(t.perMin * 1e4) / 1e4,
      fromFactoryId: supplier,
      toFactoryId: fid,
      fromStationId: null,
      toStationId: null,
      trainIds: [],
      roundTripEstimateS: null,
      mode: fluid ? 'pipe' : 'belt',
      direct: { tier, lines: Math.max(1, Math.ceil(t.perMin / cap - 1e-9)), lengthM: 300, from: null, to: { buildingId: r.keyToId.get(t.key)!, portId: t.portId } },
    });
  }
}

const EXAMPLE_NAMES: Record<ExampleKind, string> = {
  simple: 'Beispiel: Eisenwerk',
  complex: 'Beispiel: Montage mit Transport',
  medium: 'Beispiel: Computerfabrik (Auto-Layout)',
  large: 'Beispiel: Schwere modulare Rahmen (Auto-Layout, groß)',
};

/**
 * Beispielprojekt. `logistics` (nur mittleres und großes Beispiel): Layout mit
 * einer Logistikebene unter jeder Produktionsebene.
 */
export function buildExampleProject(gd: GameDataIndex, kind: ExampleKind, base: { datasetId: string; gameVersion: string; now?: Date }, opts: { logistics?: boolean } = {}): Project {
  const logistics = !!opts.logistics && (kind === 'medium' || kind === 'large');
  const p = createProject({ ...base, name: tr(EXAMPLE_NAMES[kind]) + (logistics ? ` – ${tr('mit Logistikebenen')}` : '') });
  const withLogistics = (notes: string) => (logistics ? `${notes} ${tr('Bus, Zuführungen und Sammelleitungen liegen auf einer Logistikebene unter jeder Produktionsebene.')}` : notes);
  if (kind === 'medium') {
    layoutExample(p, gd, {
      name: tr('Computerfabrik'),
      notes: withLogistics(tr('Mittelgroßes Beispiel, mit dem automatischen Layout erzeugt (Bauart „Kompakter Block“): 5 Computer pro Minute mit Raffinerien, Rohren und Hauptbus.')),
      itemId: 'Desc_Computer_C',
      ratePerMin: 5,
      variant: 'compact',
      options: { beltTier: 'Build_ConveyorBeltMk4_C', pipeTier: 'Build_Pipeline_C', crossings: 'avoid', distribution: 'manifold', spacing: 'compact', logistics },
    });
    return p;
  }
  if (kind === 'large') {
    layoutExample(p, gd, {
      name: tr('Rahmenwerk'),
      notes: withLogistics(tr('Großes Beispiel, mit dem automatischen Layout erzeugt (Bauart „Hochbau“): 5 schwere modulare Rahmen pro Minute, rund 150 Maschinen auf drei Etagen.')),
      itemId: 'Desc_ModularFrameHeavy_C',
      ratePerMin: 5,
      variant: 'floors',
      options: { beltTier: 'Build_ConveyorBeltMk5_C', pipeTier: 'Build_PipelineMK2_C', crossings: 'avoid', distribution: 'manifold', spacing: 'compact', maxFloors: 3, logistics },
    });
    return p;
  }
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
    b.belt(split, 'up', plates, 0);
    b.belt(split, 'straight', rod1, 0);
    b.belt(split, 'down', rod2, 0);
    b.belt(plates, 0, boxPlates, 0);
    b.belt(rod1, 0, rodMerge, 'up');
    b.belt(rod2, 0, rodMerge, 'down');
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
  // Lkw-Station: Ladung auf den inneren Bandeingang (der äußere füllt nur Treibstoff)
  const truckOut = w.add('Build_TruckStation_C', 116, -9, { label: tr('Lkw-Station (Beladen)'), transfer: { mode: 'load', stationId: null } });
  w.belt(merge, 0, split, 0);
  w.belt(split, 'up', p1, 0);
  w.belt(split, 'straight', p2, 0);
  w.belt(split, 'down', rod, 0);
  w.belt(p1, 0, plateMerge, 'up');
  w.belt(p2, 0, plateMerge, 'down');
  w.belt(plateMerge, 0, truckOut, 1);
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
  const truckIn = m.add('Build_TruckStation_C', 0, -4, { label: tr('Lkw-Station (Entladen)'), transfer: { mode: 'unload', stationId: null } }, { face: 'out' });
  const rodSplit = m.add('Build_ConveyorAttachmentSplitter_C', 24, 8);
  const sc1 = m.add('Build_ConstructorMk1_C', 40, 0, { recipeId: 'Recipe_Screw_C', clock: 0.75 });
  const sc2 = m.add('Build_ConstructorMk1_C', 40, 16, { recipeId: 'Recipe_Screw_C', clock: 0.75 });
  const screwMerge = m.add('Build_ConveyorAttachmentMerger_C', 56, 8);
  // Montage: Platten oben (Eingang 1), Schrauben unten (Eingang 2)
  const asm = m.add('Build_AssemblerMk1_C', 72, 8, { recipeId: 'Recipe_IronPlateReinforced_C' }, { port: 'belt-in-1' });
  const box = m.add('Build_StorageContainerMk1_C', 92, 6, { label: tr('Verstärkte Eisenplatten') });
  m.belt(truckIn, 0, asm, 0);
  m.belt(rodSplit, 'up', sc1, 0);
  m.belt(rodSplit, 'down', sc2, 0);
  m.belt(sc1, 0, screwMerge, 'up');
  m.belt(sc2, 0, screwMerge, 'down');
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
