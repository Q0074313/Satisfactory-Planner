/**
 * Operationen auf Fabriken, Stockwerken, Flächen, Gebäuden und Verbindungen.
 *
 * Alle Operationen verändern das übergebene Projekt direkt. Die Web-App ruft
 * sie innerhalb von Immer (`produceWithPatches`) auf; dadurch entstehen
 * Undo/Redo-Patches. Ungültige Eingaben lösen `OpError` aus und lassen das
 * Projekt unverändert.
 */
import type { GameDataIndex } from '../../gamedata/index.ts';
import { findPort, orientPorts, portDefs } from '../../factory/ports.ts';
import { rotate, type Vec2 } from '../../geometry/index.ts';
import { tr } from '../../i18n/index.ts';
import { clone } from '../../model/clone.ts';
import { newId } from '../../model/ids.ts';
import type {
  AreaKind,
  Building,
  BuildingGroup,
  Extraction,
  Floor,
  LinkKind,
  LinkRouting,
  LogisticsLink,
  PlanArea,
  Placement,
  PortRef,
  Project,
  Transfer,
  Vec3,
} from '../../model/schema.ts';
import { makeFactory } from '../create.ts';
import { OpError } from '../errors.ts';

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new OpError(tr('{what} nicht gefunden.', { what }));
  return value;
}

// ---------------------------------------------------------------------------
// Fabriken und Stockwerke
// ---------------------------------------------------------------------------

export function addFactory(p: Project, name: string): string {
  const { factory, floor } = makeFactory(p, name);
  p.factories[factory.id] = factory;
  p.floors[floor.id] = floor;
  return factory.id;
}

export function updateFactory(p: Project, id: string, patch: { name?: string; color?: string; notes?: string }): void {
  const f = must(p.factories[id], tr('Fabrik'));
  Object.assign(f, patch);
}

/** Entfernt eine Fabrik samt Stockwerken, Gebäuden, Verbindungen, Plänen und Transportaufträgen. */
export function removeFactory(p: Project, id: string): void {
  must(p.factories[id], tr('Fabrik'));
  for (const fl of Object.values(p.floors)) if (fl.factoryId === id) delete p.floors[fl.id];
  for (const a of Object.values(p.areas)) if (a.factoryId === id) delete p.areas[a.id];
  for (const b of Object.values(p.buildings)) if (b.factoryId === id) delete p.buildings[b.id];
  for (const l of Object.values(p.links)) if (l.factoryId === id) delete p.links[l.id];
  for (const pl of Object.values(p.productionPlans)) if (pl.factoryId === id) delete p.productionPlans[pl.id];
  for (const m of Object.values(p.measurements)) if (m.factoryId === id) delete p.measurements[m.id];
  for (const s of Object.values(p.stations)) if (s.factoryId === id) s.factoryId = null;
  for (const o of Object.values(p.transportOrders))
    if (o.fromFactoryId === id || o.toFactoryId === id) delete p.transportOrders[o.id];
  delete p.factories[id];
}

export function addFloor(
  p: Project,
  factoryId: string,
  init: Partial<Pick<Floor, 'name' | 'kind' | 'elevationM' | 'heightM'>> = {},
): string {
  const f = must(p.factories[factoryId], tr('Fabrik'));
  const floors = f.floorIds.map((id) => p.floors[id]!).filter(Boolean);
  const top = floors.reduce<Floor | undefined>((acc, fl) => (!acc || fl.elevationM > acc.elevationM ? fl : acc), undefined);
  const floor: Floor = {
    id: newId('floor'),
    factoryId,
    name: init.name ?? tr('Ebene {n}', { n: floors.length + 1 }),
    kind: init.kind ?? 'production',
    elevationM: init.elevationM ?? (top ? top.elevationM + top.heightM : 0),
    heightM: init.heightM ?? 12,
  };
  p.floors[floor.id] = floor;
  f.floorIds.push(floor.id);
  sortFloors(p, factoryId);
  return floor.id;
}

export function updateFloor(p: Project, id: string, patch: Partial<Pick<Floor, 'name' | 'kind' | 'elevationM' | 'heightM'>>): void {
  const fl = must(p.floors[id], tr('Stockwerk'));
  if (patch.heightM !== undefined && !(patch.heightM > 0)) throw new OpError(tr('Die Stockwerkshöhe muss größer als 0 sein.'));
  Object.assign(fl, patch);
  sortFloors(p, fl.factoryId);
}

function sortFloors(p: Project, factoryId: string): void {
  const f = p.factories[factoryId]!;
  f.floorIds.sort((a, b) => p.floors[a]!.elevationM - p.floors[b]!.elevationM);
}

/**
 * Entfernt ein Stockwerk. Gebäude darauf bleiben als **nicht platzierte**
 * Maschinen erhalten (der Produktionsplan verliert nichts), ihre
 * Verbindungen und die Flächen des Stockwerks werden entfernt.
 */
export function removeFloor(p: Project, id: string): void {
  const fl = must(p.floors[id], tr('Stockwerk'));
  const f = p.factories[fl.factoryId]!;
  if (f.floorIds.length <= 1) throw new OpError(tr('Eine Fabrik benötigt mindestens ein Stockwerk.'));
  const ids = Object.values(p.buildings)
    .filter((b) => b.placement?.floorId === id)
    .map((b) => b.id);
  unplaceBuildings(p, ids);
  for (const a of Object.values(p.areas)) if (a.floorId === id) delete p.areas[a.id];
  for (const m of Object.values(p.measurements)) if (m.floorId === id) delete p.measurements[m.id];
  f.floorIds = f.floorIds.filter((x) => x !== id);
  delete p.floors[id];
}

// ---------------------------------------------------------------------------
// Flächen
// ---------------------------------------------------------------------------

export function addArea(
  p: Project,
  init: { factoryId: string; floorId: string; kind: AreaKind; polygon: Vec2[]; name?: string; foundationType?: string },
): string {
  must(p.factories[init.factoryId], tr('Fabrik'));
  const fl = must(p.floors[init.floorId], tr('Stockwerk'));
  if (fl.factoryId !== init.factoryId) throw new OpError(tr('Das Stockwerk gehört nicht zu dieser Fabrik.'));
  if (init.polygon.length < 3) throw new OpError(tr('Eine Fläche benötigt mindestens drei Eckpunkte.'));
  const names: Record<AreaKind, string> = { 'build-area': tr('Baufläche'), foundation: tr('Fundament'), clearance: tr('Planungsabstand') };
  const area: PlanArea = {
    id: newId('area'),
    factoryId: init.factoryId,
    floorId: init.floorId,
    kind: init.kind,
    name: init.name ?? names[init.kind],
    polygon: init.polygon.map((v) => ({ x: v.x, y: v.y })),
  };
  if (init.foundationType) area.foundationType = init.foundationType;
  p.areas[area.id] = area;
  return area.id;
}

export function updateArea(p: Project, id: string, patch: Partial<Pick<PlanArea, 'name' | 'kind' | 'polygon' | 'foundationType'>>): void {
  const a = must(p.areas[id], tr('Fläche'));
  if (patch.polygon && patch.polygon.length < 3) throw new OpError(tr('Eine Fläche benötigt mindestens drei Eckpunkte.'));
  Object.assign(a, patch);
}

export function removeArea(p: Project, id: string): void {
  must(p.areas[id], tr('Fläche'));
  delete p.areas[id];
}

export function moveAreas(p: Project, ids: string[], dx: number, dy: number): void {
  for (const id of ids) {
    const a = must(p.areas[id], tr('Fläche'));
    a.polygon = a.polygon.map((v) => ({ x: v.x + dx, y: v.y + dy }));
  }
}

// ---------------------------------------------------------------------------
// Gebäude
// ---------------------------------------------------------------------------

export interface NewBuilding {
  factoryId: string;
  type: string;
  recipeId?: string | null;
  clock?: number;
  somersloops?: number;
  placement?: Placement | null;
  label?: string;
  extraction?: Extraction | null;
  transfer?: Transfer | null;
}

function checkBuildingInput(p: Project, gd: GameDataIndex, nb: NewBuilding): void {
  must(p.factories[nb.factoryId], tr('Fabrik'));
  const def = gd.building(nb.type);
  if (!def) throw new OpError(tr('Gebäudetyp {type} ist im Spieldatensatz nicht vorhanden.', { type: nb.type }));
  if (nb.recipeId) {
    const r = gd.recipe(nb.recipeId);
    if (!r) throw new OpError(tr('Rezept {id} ist nicht vorhanden.', { id: nb.recipeId }));
    if (!r.producedIn.includes(nb.type)) throw new OpError(tr('{recipe} kann nicht in {building} hergestellt werden.', { recipe: gd.name(r.id), building: gd.name(nb.type) }));
  }
  if (nb.placement) {
    const fl = must(p.floors[nb.placement.floorId], tr('Stockwerk'));
    if (fl.factoryId !== nb.factoryId) throw new OpError(tr('Das Stockwerk gehört nicht zu dieser Fabrik.'));
  }
  if (nb.clock !== undefined) checkClock(gd, nb.type, nb.clock);
  if (nb.somersloops !== undefined) checkSomersloops(gd, nb.type, nb.somersloops);
  if (nb.extraction) checkExtraction(gd, nb.type, nb.extraction);
  if (nb.transfer) checkTransfer(p, gd, nb.type, nb.transfer);
}

function checkClock(gd: GameDataIndex, type: string, clock: number): void {
  const def = gd.building(type);
  if (!def?.clock) {
    if (clock !== 1) throw new OpError(tr('Der Takt dieses Gebäudes kann nicht verändert werden.'));
    return;
  }
  const max = gd.fact('production.clock.maxWithShards') ?? 2.5;
  if (clock < def.clock.min - 1e-9 || clock > max + 1e-9)
    throw new OpError(tr('Takt muss zwischen {min} % und {max} % liegen.', { min: def.clock.min * 100, max: max * 100 }));
}

function checkSomersloops(gd: GameDataIndex, type: string, count: number): void {
  const slots = gd.building(type)?.somersloopSlots ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > slots)
    throw new OpError(slots === 0 ? tr('Dieses Gebäude hat keine Somersloop-Plätze.') : tr('Höchstens {n} Somersloops möglich.', { n: slots }));
}

/** Rohstoffe, die ein Gewinnungsgebäude laut Spieldaten fördern kann. */
export function extractableResources(gd: GameDataIndex, type: string): string[] {
  const ex = gd.building(type)?.extractor;
  if (!ex) return [];
  if (ex.allowedResources.length) return ex.allowedResources.filter((id) => gd.item(id));
  return Object.values(gd.data.items)
    .filter((i) => i.isResource && ex.allowedForms.includes(i.form))
    .map((i) => i.id);
}

function checkExtraction(gd: GameDataIndex, type: string, ex: Extraction): void {
  if (!gd.building(type)?.extractor) throw new OpError(tr('Nur Gewinnungsgebäude fördern Rohstoffe.'));
  if (!extractableResources(gd, type).includes(ex.itemId))
    throw new OpError(tr('{building} kann {item} nicht fördern.', { building: gd.name(type), item: gd.name(ex.itemId) }));
}

function checkTransfer(p: Project, gd: GameDataIndex, type: string, t: Transfer): void {
  if (!gd.building(type)?.freightPlatform) throw new OpError(tr('Be- und Entladen ist nur an Frachtplattformen möglich.'));
  if (t.stationId && !p.stations[t.stationId]) throw new OpError(tr('{what} nicht gefunden.', { what: tr('Bahnhof') }));
}

export function addBuilding(p: Project, gd: GameDataIndex, nb: NewBuilding): string {
  checkBuildingInput(p, gd, nb);
  const def = gd.building(nb.type)!;
  const b: Building = {
    id: newId('building'),
    factoryId: nb.factoryId,
    type: nb.type,
    label: nb.label ?? '',
    recipeId: nb.recipeId ?? null,
    clock: nb.clock ?? 1,
    somersloops: nb.somersloops ?? 0,
    placement: nb.placement ? { ...nb.placement } : null,
    groupInstance: null,
    extraction: nb.extraction ?? defaultExtraction(gd, nb.type),
    transfer: nb.transfer ?? (def.freightPlatform ? { mode: 'unload', stationId: null } : null),
    notes: '',
  };
  p.buildings[b.id] = b;
  return b.id;
}

/** Wasserextraktor: Wasser ist der einzige Rohstoff; sonst bleibt die Auswahl offen. */
function defaultExtraction(gd: GameDataIndex, type: string): Extraction | null {
  const res = extractableResources(gd, type);
  return res.length === 1 ? { itemId: res[0]!, purity: 'normal' } : null;
}

export interface BuildingPatch {
  label?: string;
  recipeId?: string | null;
  clock?: number;
  somersloops?: number;
  notes?: string;
  type?: string;
  extraction?: Extraction | null;
  transfer?: Transfer | null;
}

export function updateBuildings(p: Project, gd: GameDataIndex, ids: string[], patch: BuildingPatch): void {
  for (const id of ids) {
    const b = must(p.buildings[id], tr('Gebäude'));
    const type = patch.type ?? b.type;
    if (patch.type !== undefined && !gd.building(patch.type)) throw new OpError(tr('Gebäudetyp {type} unbekannt.', { type: patch.type }));
    let recipeId = patch.recipeId !== undefined ? patch.recipeId : b.recipeId;
    // Typwechsel ohne neues Rezept: unpassendes altes Rezept verwerfen.
    if (patch.type !== undefined && patch.recipeId === undefined && recipeId && !gd.recipe(recipeId)?.producedIn.includes(type))
      recipeId = null;
    if (recipeId) {
      const r = gd.recipe(recipeId);
      if (!r) throw new OpError(tr('Rezept {id} ist nicht vorhanden.', { id: recipeId }));
      if (!r.producedIn.includes(type)) throw new OpError(tr('{recipe} kann nicht in {building} hergestellt werden.', { recipe: gd.name(r.id), building: gd.name(type) }));
    }
    if (patch.clock !== undefined) checkClock(gd, type, patch.clock);
    if (patch.somersloops !== undefined) checkSomersloops(gd, type, patch.somersloops);
    if (patch.extraction) checkExtraction(gd, type, patch.extraction);
    if (patch.transfer) checkTransfer(p, gd, type, patch.transfer);
    Object.assign(b, patch, { recipeId });
    const def = gd.building(type);
    if (!def?.clock) b.clock = 1;
    if ((def?.somersloopSlots ?? 0) < b.somersloops) b.somersloops = 0;
    if (!def?.extractor) b.extraction = null;
    if (!def?.freightPlatform) b.transfer = null;
  }
}

export function placeBuilding(p: Project, id: string, placement: Placement): void {
  const b = must(p.buildings[id], tr('Gebäude'));
  const fl = must(p.floors[placement.floorId], tr('Stockwerk'));
  if (fl.factoryId !== b.factoryId) throw new OpError(tr('Das Stockwerk gehört nicht zur Fabrik des Gebäudes.'));
  b.placement = { ...placement };
}

export function moveBuildings(p: Project, ids: string[], dx: number, dy: number, dz = 0): void {
  for (const id of ids) {
    const b = must(p.buildings[id], tr('Gebäude'));
    if (!b.placement) continue;
    b.placement.x += dx;
    b.placement.y += dy;
    b.placement.zOffsetM += dz;
  }
  moveLinkWaypoints(p, ids, dx, dy, dz);
}

/** Verschiebt Zwischenpunkte von Verbindungen, deren beide Enden mitbewegt werden. */
function moveLinkWaypoints(p: Project, ids: string[], dx: number, dy: number, dz: number): void {
  const set = new Set(ids);
  for (const l of Object.values(p.links)) {
    if (set.has(l.from.buildingId) && set.has(l.to.buildingId)) {
      l.waypoints = l.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy, z: w.z + dz }));
    }
  }
}

/** Dreht Gebäude um einen gemeinsamen Drehpunkt. */
export function rotateBuildings(p: Project, ids: string[], deltaDeg: number, pivot?: Vec2): void {
  const placed = ids.map((id) => must(p.buildings[id], tr('Gebäude'))).filter((b) => b.placement);
  if (placed.length === 0) return;
  const c =
    pivot ??
    placed.reduce((acc, b) => ({ x: acc.x + b.placement!.x / placed.length, y: acc.y + b.placement!.y / placed.length }), {
      x: 0,
      y: 0,
    });
  for (const b of placed) {
    const pl = b.placement!;
    const r = rotate({ x: pl.x - c.x, y: pl.y - c.y }, deltaDeg);
    pl.x = c.x + r.x;
    pl.y = c.y + r.y;
    pl.rotationDeg = (((pl.rotationDeg + deltaDeg) % 360) + 360) % 360;
  }
  const set = new Set(ids);
  for (const l of Object.values(p.links)) {
    if (set.has(l.from.buildingId) && set.has(l.to.buildingId)) {
      l.waypoints = l.waypoints.map((w) => {
        const r = rotate({ x: w.x - c.x, y: w.y - c.y }, deltaDeg);
        return { x: c.x + r.x, y: c.y + r.y, z: w.z };
      });
    }
  }
}

/** Hebt die Platzierung auf: Maschine bleibt geplant, Verbindungen werden entfernt. */
export function unplaceBuildings(p: Project, ids: string[]): void {
  const set = new Set(ids);
  for (const id of ids) {
    const b = must(p.buildings[id], tr('Gebäude'));
    b.placement = null;
  }
  for (const l of Object.values(p.links)) if (set.has(l.from.buildingId) || set.has(l.to.buildingId)) delete p.links[l.id];
}

export function removeBuildings(p: Project, ids: string[]): void {
  const set = new Set(ids);
  for (const id of ids) {
    must(p.buildings[id], tr('Gebäude'));
    delete p.buildings[id];
  }
  for (const l of Object.values(p.links)) if (set.has(l.from.buildingId) || set.has(l.to.buildingId)) delete p.links[l.id];
}

/**
 * Kopiert Gebäude (mit den Verbindungen zwischen ihnen) um einen Versatz,
 * optional auf ein anderes Stockwerk. Liefert die neuen IDs.
 */
export function duplicateBuildings(p: Project, ids: string[], offset: Vec3, targetFloorId?: string): string[] {
  const map = new Map<string, string>();
  for (const id of ids) {
    const src = must(p.buildings[id], tr('Gebäude'));
    const copy: Building = clone(src);
    copy.id = newId('building');
    copy.groupInstance = null;
    if (copy.placement) {
      copy.placement.x += offset.x;
      copy.placement.y += offset.y;
      copy.placement.zOffsetM += offset.z;
      if (targetFloorId) {
        const fl = must(p.floors[targetFloorId], tr('Stockwerk'));
        if (fl.factoryId !== copy.factoryId) throw new OpError(tr('Kopieren in eine andere Fabrik ist nicht möglich.'));
        copy.placement.floorId = targetFloorId;
      }
    }
    p.buildings[copy.id] = copy;
    map.set(id, copy.id);
  }
  for (const l of Object.values(p.links)) {
    const from = map.get(l.from.buildingId);
    const to = map.get(l.to.buildingId);
    if (!from || !to) continue;
    const copy: LogisticsLink = {
      ...clone(l),
      id: newId('link'),
      from: { buildingId: from, portId: l.from.portId },
      to: { buildingId: to, portId: l.to.portId },
      waypoints: l.waypoints.map((w) => ({ x: w.x + offset.x, y: w.y + offset.y, z: w.z + offset.z })),
    };
    p.links[copy.id] = copy;
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Verbindungen (Förderbänder, Rohre)
// ---------------------------------------------------------------------------

/** Ist der Anschluss bereits durch eine Verbindung belegt? */
export function linkAtPort(p: Project, ref: PortRef): LogisticsLink | undefined {
  return Object.values(p.links).find(
    (l) =>
      (l.from.buildingId === ref.buildingId && l.from.portId === ref.portId) ||
      (l.to.buildingId === ref.buildingId && l.to.portId === ref.portId),
  );
}

/**
 * Verbindet zwei Anschlüsse. Die Reihenfolge ist beliebig: Wird vom Eingang
 * zum Ausgang gezeichnet, dreht die Operation Richtung und Zwischenpunkte um.
 * Gespeichert wird immer in Flussrichtung (Ausgang → Eingang).
 */
export function addLink(
  p: Project,
  gd: GameDataIndex,
  init: { kind: LinkKind; tier: string; from: PortRef; to: PortRef; waypoints?: Vec3[]; routing?: LinkRouting },
): string {
  const a = must(p.buildings[init.from.buildingId], tr('Startgebäude'));
  const b = must(p.buildings[init.to.buildingId], tr('Zielgebäude'));
  if (a.id === b.id) throw new OpError(tr('Ein Gebäude kann nicht mit sich selbst verbunden werden.'));
  if (a.factoryId !== b.factoryId) throw new OpError(tr('Verbindungen zwischen Fabriken laufen über Transportaufträge.'));
  if (!a.placement || !b.placement) throw new OpError(tr('Beide Gebäude müssen im Grundriss platziert sein.'));
  const pa = findPort(must(gd.building(a.type), tr('Gebäudetyp')), init.from);
  const pb = findPort(must(gd.building(b.type), tr('Gebäudetyp')), init.to);
  if (!pa || !pb) throw new OpError(tr('Anschluss nicht gefunden.'));
  const o = orientPorts(pa, pb);
  if ('error' in o) throw new OpError(o.error);
  if (pa.kind !== init.kind) throw new OpError(tr('Verbindungsart passt nicht zum Anschluss.'));
  const tier = gd.building(init.tier);
  if (!tier || (init.kind === 'belt' ? !tier.conveyor : !tier.pipe))
    throw new OpError(tr('Die gewählte Stufe passt nicht zur Verbindungsart.'));
  if (linkAtPort(p, init.from)) throw new OpError(tr('Der Startanschluss ist bereits verbunden.'));
  if (linkAtPort(p, init.to)) throw new OpError(tr('Der Zielanschluss ist bereits verbunden.'));
  const waypoints = (init.waypoints ?? []).map((w) => ({ ...w }));
  const link: LogisticsLink = {
    id: newId('link'),
    factoryId: a.factoryId,
    kind: init.kind,
    tier: init.tier,
    from: o.reversed ? { ...init.to } : { ...init.from },
    to: o.reversed ? { ...init.from } : { ...init.to },
    waypoints: o.reversed ? waypoints.reverse() : waypoints,
    routing: init.routing ?? 'direct',
  };
  p.links[link.id] = link;
  return link.id;
}

export function updateLink(p: Project, gd: GameDataIndex, id: string, patch: { tier?: string; waypoints?: Vec3[]; routing?: LinkRouting }): void {
  const l = must(p.links[id], tr('Verbindung'));
  if (patch.tier) {
    const tier = gd.building(patch.tier);
    if (!tier || (l.kind === 'belt' ? !tier.conveyor : !tier.pipe)) throw new OpError(tr('Die gewählte Stufe passt nicht zur Verbindungsart.'));
    l.tier = patch.tier;
  }
  if (patch.waypoints) l.waypoints = patch.waypoints.map((w) => ({ ...w }));
  if (patch.routing) l.routing = patch.routing;
}

/** Kehrt die Flussrichtung um, sofern beide Anschlüsse richtungsfrei sind (Rohrkreuzungen). */
export function reverseLink(p: Project, gd: GameDataIndex, id: string): void {
  const l = must(p.links[id], tr('Verbindung'));
  const a = p.buildings[l.from.buildingId];
  const b = p.buildings[l.to.buildingId];
  const pa = a && gd.building(a.type) ? findPort(gd.building(a.type)!, l.from) : undefined;
  const pb = b && gd.building(b.type) ? findPort(gd.building(b.type)!, l.to) : undefined;
  if (pa?.direction !== 'any' || pb?.direction !== 'any') throw new OpError(tr('Nur Verbindungen zwischen richtungsfreien Anschlüssen lassen sich umkehren.'));
  [l.from, l.to] = [l.to, l.from];
  l.waypoints.reverse();
}

export function removeLinks(p: Project, ids: string[]): void {
  for (const id of ids) {
    must(p.links[id], tr('Verbindung'));
    delete p.links[id];
  }
}

// ---------------------------------------------------------------------------
// Gebäudegruppen (Vorlagen)
// ---------------------------------------------------------------------------

/** Lage einer Gruppeninstanz: Ursprung und Drehung relativ zur Vorlage. */
export interface InstanceTransform {
  floorId: string;
  x: number;
  y: number;
  rotationDeg: number;
  /** Höhe des Stockwerks der Instanz (Bezug für z der Zwischenpunkte). */
  floorElevationM: number;
}

export function instanceBuildings(p: Project, instanceId: string): Building[] {
  return Object.values(p.buildings).filter((b) => b.groupInstance?.instanceId === instanceId);
}

/** Leitet Ursprung und Drehung einer Instanz aus einem ihrer Gebäude ab. */
export function instanceTransform(p: Project, g: BuildingGroup, instanceId: string): InstanceTransform | null {
  for (const b of instanceBuildings(p, instanceId)) {
    const m = g.members.find((x) => x.key === b.groupInstance?.memberKey);
    if (!m || !b.placement) continue;
    const rot = (((b.placement.rotationDeg - m.rotationDeg) % 360) + 360) % 360;
    const r = rotate({ x: m.x, y: m.y }, rot);
    return {
      floorId: b.placement.floorId,
      x: b.placement.x - r.x,
      y: b.placement.y - r.y,
      rotationDeg: rot,
      floorElevationM: p.floors[b.placement.floorId]?.elevationM ?? 0,
    };
  }
  return null;
}

function groupFromBuildings(p: Project, members: Building[], origin: { x: number; y: number; rotationDeg: number; elevationM: number }) {
  const floorIds = new Set(members.map((b) => b.placement!.floorId));
  const baseFloor = p.floors[members[0]!.placement!.floorId]!;
  const keyOf = new Map(members.map((b, i) => [b.id, `m${i}`]));
  const toLocal = (x: number, y: number) => rotate({ x: x - origin.x, y: y - origin.y }, -origin.rotationDeg);
  return {
    keyOf,
    members: members.map((b) => {
      const fl = p.floors[b.placement!.floorId]!;
      const l = toLocal(b.placement!.x, b.placement!.y);
      return {
        key: keyOf.get(b.id)!,
        type: b.type,
        recipeId: b.recipeId,
        clock: b.clock,
        somersloops: b.somersloops,
        x: l.x,
        y: l.y,
        zOffsetM: b.placement!.zOffsetM + (floorIds.size > 1 ? fl.elevationM - baseFloor.elevationM : 0),
        rotationDeg: (((b.placement!.rotationDeg - origin.rotationDeg) % 360) + 360) % 360,
        extraction: b.extraction ? { ...b.extraction } : null,
      };
    }),
    links: Object.values(p.links)
      .filter((l) => keyOf.has(l.from.buildingId) && keyOf.has(l.to.buildingId))
      .map((l) => ({
        kind: l.kind,
        tier: l.tier,
        routing: l.routing,
        from: { memberKey: keyOf.get(l.from.buildingId)!, portId: l.from.portId },
        to: { memberKey: keyOf.get(l.to.buildingId)!, portId: l.to.portId },
        waypoints: l.waypoints.map((w) => {
          const q = toLocal(w.x, w.y);
          return { x: q.x, y: q.y, z: w.z - origin.elevationM };
        }),
      })),
  };
}

/**
 * Legt eine Vorlage aus den gewählten Gebäuden an. Die Gebäude werden zur
 * ersten Instanz der Gruppe, damit spätere Änderungen übertragen werden können.
 */
export function createGroupFromBuildings(p: Project, ids: string[], name: string): string {
  const members = ids.map((id) => must(p.buildings[id], tr('Gebäude'))).filter((b) => b.placement);
  if (members.length === 0) throw new OpError(tr('Für eine Gruppe muss mindestens ein platziertes Gebäude gewählt sein.'));
  const cx = members.reduce((s, b) => s + b.placement!.x, 0) / members.length;
  const cy = members.reduce((s, b) => s + b.placement!.y, 0) / members.length;
  const baseFloor = p.floors[members[0]!.placement!.floorId]!;
  const built = groupFromBuildings(p, members, { x: cx, y: cy, rotationDeg: 0, elevationM: baseFloor.elevationM });
  const group: BuildingGroup = { id: newId('group'), name, members: built.members, links: built.links };
  p.groups[group.id] = group;
  const instanceId = newId('groupInstance');
  for (const b of members) b.groupInstance = { groupId: group.id, instanceId, memberKey: built.keyOf.get(b.id)! };
  return group.id;
}

export function renameGroup(p: Project, id: string, name: string): void {
  must(p.groups[id], tr('Gruppe')).name = name;
}

/** Fügt eine Instanz einer Gruppe ein. Liefert die IDs der neuen Gebäude. */
export function instantiateGroup(
  p: Project,
  gd: GameDataIndex,
  groupId: string,
  at: { factoryId: string; floorId: string; x: number; y: number; rotationDeg: number },
  instanceId: string = newId('groupInstance'),
): string[] {
  const g = must(p.groups[groupId], tr('Gruppe'));
  const fl = must(p.floors[at.floorId], tr('Stockwerk'));
  if (fl.factoryId !== at.factoryId) throw new OpError(tr('Das Stockwerk gehört nicht zu dieser Fabrik.'));
  const ids = new Map<string, string>();
  for (const m of g.members) {
    if (!gd.building(m.type)) throw new OpError(tr('Gebäudetyp {type} der Gruppe ist im Spieldatensatz nicht vorhanden.', { type: m.type }));
    const r = rotate({ x: m.x, y: m.y }, at.rotationDeg);
    const id = newId('building');
    const def = gd.building(m.type)!;
    p.buildings[id] = {
      id,
      factoryId: at.factoryId,
      type: m.type,
      label: '',
      recipeId: m.recipeId,
      clock: m.clock,
      somersloops: m.somersloops,
      placement: {
        floorId: at.floorId,
        x: at.x + r.x,
        y: at.y + r.y,
        zOffsetM: m.zOffsetM,
        rotationDeg: (((m.rotationDeg + at.rotationDeg) % 360) + 360) % 360,
      },
      groupInstance: { groupId, instanceId, memberKey: m.key },
      extraction: m.extraction ? { ...m.extraction } : null,
      transfer: def.freightPlatform ? { mode: 'unload', stationId: null } : null,
      notes: '',
    };
    ids.set(m.key, id);
  }
  for (const l of g.links) {
    const id = newId('link');
    p.links[id] = {
      id,
      factoryId: at.factoryId,
      kind: l.kind,
      tier: l.tier,
      routing: l.routing,
      from: { buildingId: ids.get(l.from.memberKey)!, portId: l.from.portId },
      to: { buildingId: ids.get(l.to.memberKey)!, portId: l.to.portId },
      waypoints: l.waypoints.map((w) => {
        const r = rotate({ x: w.x, y: w.y }, at.rotationDeg);
        return { x: at.x + r.x, y: at.y + r.y, z: w.z + fl.elevationM };
      }),
    };
  }
  return [...ids.values()];
}

/**
 * Übernimmt den aktuellen Stand einer Instanz als neue Vorlage. Ursprung und
 * Drehung der Instanz bleiben erhalten, damit andere Instanzen beim Abgleich
 * nicht springen. Neue Gebäude können vorher mit {@link addToInstance}
 * aufgenommen werden.
 */
export function updateGroupFromInstance(p: Project, groupId: string, instanceId: string): void {
  const g = must(p.groups[groupId], tr('Gruppe'));
  const members = instanceBuildings(p, instanceId).filter((b) => b.placement);
  if (members.length === 0) throw new OpError(tr('Die Instanz enthält keine platzierten Gebäude.'));
  const t = instanceTransform(p, g, instanceId) ?? {
    x: members[0]!.placement!.x,
    y: members[0]!.placement!.y,
    rotationDeg: 0,
    floorElevationM: p.floors[members[0]!.placement!.floorId]?.elevationM ?? 0,
  };
  const built = groupFromBuildings(p, members, { x: t.x, y: t.y, rotationDeg: t.rotationDeg, elevationM: t.floorElevationM });
  g.members = built.members;
  g.links = built.links;
  for (const b of members) b.groupInstance = { groupId, instanceId, memberKey: built.keyOf.get(b.id)! };
}

/** Nimmt Gebäude in eine bestehende Instanz auf (z. B. vor „Vorlage aktualisieren“). */
export function addToInstance(p: Project, ids: string[], groupId: string, instanceId: string): void {
  must(p.groups[groupId], tr('Gruppe'));
  for (const id of ids) {
    const b = must(p.buildings[id], tr('Gebäude'));
    b.groupInstance = { groupId, instanceId, memberKey: null };
  }
}

/** Löst eine Instanz von ihrer Vorlage; die Gebäude bleiben unverändert stehen. */
export function detachInstance(p: Project, instanceId: string): void {
  for (const b of instanceBuildings(p, instanceId)) b.groupInstance = null;
}

/**
 * Baut alle übrigen Instanzen einer Gruppe nach der aktuellen Vorlage neu auf
 * (gleicher Ursprung, gleiche Drehung). Verbindungen zu Gebäuden außerhalb der
 * Instanz gehen dabei verloren; ihre Zahl wird zurückgegeben.
 */
export function syncGroupInstances(p: Project, gd: GameDataIndex, groupId: string, exceptInstanceId?: string): { instances: number; lostLinks: number } {
  const g = must(p.groups[groupId], tr('Gruppe'));
  const instances = new Map<string, Building[]>();
  for (const b of Object.values(p.buildings)) {
    if (b.groupInstance?.groupId !== groupId || b.groupInstance.instanceId === exceptInstanceId) continue;
    instances.set(b.groupInstance.instanceId, [...(instances.get(b.groupInstance.instanceId) ?? []), b]);
  }
  let lostLinks = 0;
  let count = 0;
  for (const [instanceId, buildings] of instances) {
    const t = instanceTransform(p, g, instanceId);
    if (!t) continue;
    const factoryId = buildings[0]!.factoryId;
    const ids = new Set(buildings.map((b) => b.id));
    for (const l of Object.values(p.links)) {
      const inA = ids.has(l.from.buildingId);
      const inB = ids.has(l.to.buildingId);
      if (inA !== inB) lostLinks++;
    }
    removeBuildings(p, [...ids]);
    instantiateGroup(p, gd, groupId, { factoryId, floorId: t.floorId, x: t.x, y: t.y, rotationDeg: t.rotationDeg }, instanceId);
    count++;
  }
  return { instances: count, lostLinks };
}

export function removeGroup(p: Project, id: string): void {
  must(p.groups[id], tr('Gruppe'));
  delete p.groups[id];
  for (const b of Object.values(p.buildings)) if (b.groupInstance?.groupId === id) b.groupInstance = null;
}

// ---------------------------------------------------------------------------
// Maße
// ---------------------------------------------------------------------------

export function addMeasurement(
  p: Project,
  init: { factoryId: string | null; floorId: string | null; from: Vec3; to: Vec3; label?: string },
): string {
  const id = newId('measurement');
  p.measurements[id] = { id, factoryId: init.factoryId, floorId: init.floorId, from: init.from, to: init.to, label: init.label ?? '' };
  return id;
}

export function removeMeasurements(p: Project, ids: string[]): void {
  for (const id of ids) delete p.measurements[id];
}

/** Hilfsfunktion für die Oberfläche: alle Anschluss-IDs eines Gebäudetyps. */
export function portIdsOf(gd: GameDataIndex, type: string): string[] {
  const def = gd.building(type);
  return def ? portDefs(def).map((x) => x.id) : [];
}
