/**
 * Prüfungen des Fabrikgrundrisses.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { GameDataIndex } from '../gamedata/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import { convexOverlap, polygonArea, rectOf, rectsOverlap, type Rect, type Vec2 } from '../geometry/index.ts';
import type { Building, ObjectRef, Project } from '../model/schema.ts';
import { makeFinding } from '../validation/registry.ts';
import type { Finding } from '../validation/types.ts';
import { computeFactoryFlow, type FactoryFlow } from './flow.ts';
import { buildingFootprint, buildingHeight, type FootprintPart } from './geometry.ts';
import { linkPath, verticalSections } from './linkPath.ts';
import {
  FAB_FLOOR_CHANGE_WITHOUT_LIFT,
  FAB_FLOW_ASSUMPTIONS,
  FAB_HARD_OVERLAP,
  FAB_IN_CLEARANCE,
  FAB_LIFT_THROUGH_FLOOR,
  FAB_LINK_UNCHECKED,
  FAB_NO_RECIPE,
  FAB_OUTPUT_BLOCKED,
  FAB_OUTSIDE_AREA,
  FAB_OVER_CAPACITY,
  FAB_PIPE_HEAD,
  FAB_PORTS_UNVERIFIED,
  FAB_SOFT_OVERLAP,
  FAB_TALLER_THAN_FLOOR,
  FAB_UNDERSUPPLIED,
  FAB_UNKNOWN_TYPE,
  FAB_UNPLACED,
  FAB_WRONG_ITEM,
} from './rules.ts';

interface Shape {
  building: Building;
  parts: (FootprintPart & { rect: Rect })[];
  rect: Rect;
}

const ref = (b: Building): ObjectRef => ({ table: 'buildings', id: b.id });

/** Platziertes Gebäude als Grundrissteile mit Hüllrechtecken. */
export function placedShapes(p: Project, gd: GameDataIndex, factoryId: string): Shape[] {
  const out: Shape[] = [];
  for (const b of Object.values(p.buildings)) {
    if (b.factoryId !== factoryId || !b.placement) continue;
    const def = gd.building(b.type);
    if (!def) continue;
    const parts = buildingFootprint(def, b.placement, p.floors[b.placement.floorId]).map((part) => ({
      ...part,
      rect: rectOf(part.polygon),
    }));
    out.push({ building: b, parts, rect: rectOf(parts.flatMap((x) => x.polygon)) });
  }
  return out;
}

/** Paarweise Überschneidungen mit einfacher Rasterbeschleunigung. */
export function findOverlaps(shapes: Shape[], cell = 16): { a: Shape; b: Shape; hard: boolean }[] {
  const grid = new Map<string, number[]>();
  shapes.forEach((s, i) => {
    for (let gx = Math.floor(s.rect.minX / cell); gx <= Math.floor(s.rect.maxX / cell); gx++)
      for (let gy = Math.floor(s.rect.minY / cell); gy <= Math.floor(s.rect.maxY / cell); gy++) {
        const k = `${gx},${gy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });
  const seen = new Set<string>();
  const result: { a: Shape; b: Shape; hard: boolean }[] = [];
  for (const list of grid.values()) {
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const i = Math.min(list[x]!, list[y]!);
        const j = Math.max(list[x]!, list[y]!);
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = shapes[i]!;
        const b = shapes[j]!;
        if (!rectsOverlap(a.rect, b.rect)) continue;
        let hard = false;
        let any = false;
        for (const pa of a.parts)
          for (const pb of b.parts) {
            if (pa.zMax <= pb.zMin + 1e-6 || pb.zMax <= pa.zMin + 1e-6) continue;
            if (!rectsOverlap(pa.rect, pb.rect)) continue;
            if (!convexOverlap(pa.polygon, pb.polygon, 1e-4)) continue;
            any = true;
            if (!pa.soft && !pb.soft) hard = true;
          }
        if (any) result.push({ a, b, hard });
      }
  }
  return result;
}

const toPoly = (pts: Vec2[]): Polygon => [pts.map((v) => [v.x, v.y] as [number, number])];

function multiArea(mp: MultiPolygon): number {
  let a = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      const area = polygonArea(ring.map(([x, y]) => ({ x, y })));
      a += i === 0 ? area : -area;
    });
  }
  return a;
}

function union(polys: Polygon[]): MultiPolygon {
  if (polys.length === 0) return [];
  const [first, ...rest] = polys;
  return polygonClipping.union(first!, ...rest);
}

function covers(container: MultiPolygon, poly: Vec2[]): boolean {
  if (container.length === 0) return false;
  const diff = polygonClipping.difference(toPoly(poly), container);
  return multiArea(diff) < 0.01;
}

function intersects(container: MultiPolygon, poly: Vec2[]): boolean {
  if (container.length === 0) return false;
  return multiArea(polygonClipping.intersection(toPoly(poly), container)) > 0.01;
}

export interface FloorAreaStats {
  floorId: string;
  /** Vereinigte Grundfläche aller Gebäude auf dem Stockwerk (feste Boxen). */
  occupiedM2: number;
  /** Selbst festgelegte Baufläche (Vereinigung). */
  buildAreaM2: number;
  foundationM2: number;
  clearanceM2: number;
  /** Hüllrechteck der Gebäude (Breite × Tiefe). */
  extent: { widthM: number; depthM: number } | null;
  buildingCount: number;
}

export function floorAreaStats(p: Project, gd: GameDataIndex, factoryId: string): FloorAreaStats[] {
  const f = p.factories[factoryId];
  if (!f) return [];
  const shapes = placedShapes(p, gd, factoryId);
  return f.floorIds.map((floorId) => {
    const own = shapes.filter((s) => s.building.placement!.floorId === floorId);
    const polys = own.flatMap((s) => {
      const hard = s.parts.filter((x) => !x.soft);
      return (hard.length ? hard : s.parts).map((x) => toPoly(x.polygon));
    });
    const areas = Object.values(p.areas).filter((a) => a.floorId === floorId);
    const areaOf = (kind: string) => multiArea(union(areas.filter((a) => a.kind === kind).map((a) => toPoly(a.polygon))));
    const rect = own.length ? rectOf(own.flatMap((s) => s.parts.flatMap((x) => x.polygon))) : null;
    return {
      floorId,
      occupiedM2: multiArea(union(polys)),
      buildAreaM2: areaOf('build-area'),
      foundationM2: areaOf('foundation'),
      clearanceM2: areaOf('clearance'),
      extent: rect ? { widthM: rect.maxX - rect.minX, depthM: rect.maxY - rect.minY } : null,
      buildingCount: own.length,
    };
  });
}

export function checkFactory(p: Project, gd: GameDataIndex, factoryId: string, opts: { flow?: FactoryFlow } = {}): Finding[] {
  const findings: Finding[] = [];
  const f = p.factories[factoryId];
  if (!f) return findings;
  const buildings = Object.values(p.buildings).filter((b) => b.factoryId === factoryId);
  const nameOf = (b: Building) => b.label || gd.name(b.type);

  for (const b of buildings) {
    if (!gd.building(b.type)) {
      findings.push(
        makeFinding(FAB_UNKNOWN_TYPE, [ref(b)], {
          message: tr('Unbekannter Gebäudetyp {type}', { type: b.type }),
          explanation: tr('Der Typ fehlt im Spieldatensatz des Projekts. Maße, Anschlüsse und Rezepte sind unbekannt.'),
          suggestion: tr('Gebäude löschen oder durch einen vorhandenen Typ ersetzen.'),
        }),
      );
    }
  }

  const shapes = placedShapes(p, gd, factoryId);
  for (const o of findOverlaps(shapes)) {
    const rule = o.hard ? FAB_HARD_OVERLAP : FAB_SOFT_OVERLAP;
    const na = nameOf(o.a.building);
    const nb = nameOf(o.b.building);
    const pl = o.a.building.placement!;
    findings.push(
      makeFinding(
        rule,
        [ref(o.a.building), ref(o.b.building)],
        {
          message: o.hard ? tr('{a} und {b} überschneiden sich', { a: na, b: nb }) : tr('Weiche Zonen von {a} und {b} überschneiden sich', { a: na, b: nb }),
          explanation: o.hard
            ? tr('Die festen Kollisionsboxen beider Gebäude überschneiden sich im Grundriss und in der Höhe. Das Spiel lässt so nicht bauen.')
            : tr('Mindestens eine der beteiligten Boxen ist eine weiche Freihaltezone. Ob das Spiel diese Überschneidung erlaubt, ist nicht verifiziert.'),
          suggestion: tr('Eines der Gebäude verschieben oder drehen, bis sich die Umrisse nicht mehr überschneiden.'),
        },
        { location: { x: pl.x, y: pl.y, factoryId, floorId: pl.floorId } },
      ),
    );
  }

  // Bauflächen und Planungsabstände je Stockwerk
  for (const floorId of f.floorIds) {
    const areas = Object.values(p.areas).filter((a) => a.floorId === floorId);
    const build = union(areas.filter((a) => a.kind === 'build-area').map((a) => toPoly(a.polygon)));
    const clear = union(areas.filter((a) => a.kind === 'clearance').map((a) => toPoly(a.polygon)));
    const floor = p.floors[floorId]!;
    for (const s of shapes) {
      const pl = s.building.placement!;
      if (pl.floorId !== floorId) continue;
      const hard = s.parts.filter((x) => !x.soft);
      const parts = hard.length ? hard : s.parts;
      const name = nameOf(s.building);
      const loc = { x: pl.x, y: pl.y, factoryId, floorId };
      if (build.length > 0 && !parts.every((x) => covers(build, x.polygon))) {
        findings.push(
          makeFinding(
            FAB_OUTSIDE_AREA,
            [ref(s.building)],
            {
              message: tr('{name} liegt außerhalb der Baufläche', { name }),
              explanation: tr('Auf „{floor}“ ist eine Baufläche festgelegt. Das Gebäude liegt ganz oder teilweise außerhalb davon.', { floor: floor.name }),
              suggestion: tr('Gebäude in die Baufläche verschieben oder die Baufläche erweitern.'),
            },
            { location: loc },
          ),
        );
      }
      if (clear.length > 0 && parts.some((x) => intersects(clear, x.polygon))) {
        findings.push(
          makeFinding(
            FAB_IN_CLEARANCE,
            [ref(s.building)],
            {
              message: tr('{name} ragt in einen Planungsabstand', { name }),
              explanation: tr('Das Gebäude überschneidet einen selbst festgelegten Freihaltebereich, z. B. einen Wartungs- oder Laufweg.'),
              suggestion: tr('Gebäude verschieben oder den Planungsabstand anpassen.'),
            },
            { location: loc },
          ),
        );
      }
      const def = gd.building(s.building.type);
      if (def && buildingHeight(def) + pl.zOffsetM > floor.heightM + 1e-6 && f.floorIds.some((id) => p.floors[id]!.elevationM > floor.elevationM)) {
        findings.push(
          makeFinding(
            FAB_TALLER_THAN_FLOOR,
            [ref(s.building)],
            {
              message: tr('{name} ({h} m) ist höher als „{floor}“ ({fh} m)', { name, h: formatNumber(buildingHeight(def), 1), floor: floor.name, fh: formatNumber(floor.heightM, 1) }),
              explanation: tr('Das Gebäude ragt in das darüberliegende Stockwerk.'),
              suggestion: tr('Stockwerkshöhe erhöhen oder die Decke an dieser Stelle aussparen.'),
            },
            { location: loc },
          ),
        );
      }
    }
  }

  const unplaced = buildings.filter((b) => !b.placement);
  if (unplaced.length > 0) {
    findings.push(
      makeFinding(
        FAB_UNPLACED,
        unplaced.map(ref),
        {
          message: tr('{n} geplante Maschine(n) noch nicht aufgestellt', { n: unplaced.length }),
          explanation: tr('Diese Maschinen sind angelegt und zählen in der Bilanz als „geplant“, stehen aber noch nicht im Grundriss.'),
          suggestion: tr('In der Liste „Nicht platziert“ auswählen und im Grundriss absetzen.'),
        },
        { keyExtra: factoryId },
      ),
    );
  }
  for (const b of buildings) {
    const def = gd.building(b.type);
    if (def?.category === 'production' && !b.recipeId) {
      findings.push(
        makeFinding(FAB_NO_RECIPE, [ref(b)], {
          message: tr('{name} ohne Rezept', { name: nameOf(b) }),
          explanation: tr('Ohne Rezept trägt die Maschine nichts zur Produktionsbilanz bei.'),
          suggestion: tr('In den Eigenschaften ein Rezept wählen.'),
        }),
      );
    }
  }

  findings.push(...checkFlow(p, gd, factoryId, opts.flow));
  findings.push(...checkHeights(p, gd, factoryId));

  if (shapes.some((s) => (gd.building(s.building.type)?.ports ?? null) !== null)) {
    findings.push(
      makeFinding(FAB_PORTS_UNVERIFIED, [{ table: 'factories', id: factoryId }], {
        message: tr('Anschlusslagen sind schematisch dargestellt'),
        explanation: tr(FAB_PORTS_UNVERIFIED.description),
        suggestion: tr('Anschlussseiten im Spiel kontrollieren, bevor Bandverläufe endgültig festgelegt werden.'),
      }),
    );
  }
  if (Object.values(p.links).some((l) => l.factoryId === factoryId)) {
    findings.push(
      makeFinding(FAB_LINK_UNCHECKED, [{ table: 'factories', id: factoryId }], {
        message: tr('Baubarkeit der Förderbänder und Rohre nicht geprüft'),
        explanation: tr(FAB_LINK_UNCHECKED.description),
        suggestion: tr('Leitungsverläufe im Spiel prüfen. Der Planer prüft nur Anschlussart, Richtung und Durchsatz.'),
      }),
    );
  }
  return findings;
}

const rate = (gd: GameDataIndex, itemId: string, v: number) =>
  `${formatNumber(v, 2)} ${gd.item(itemId)?.form === 'solid' ? '/min' : 'm³/min'}`;

/** Befunde aus dem Durchsatzmodell: Kapazität, Versorgung, Abfluss, falsche Gegenstände. */
export function checkFlow(p: Project, gd: GameDataIndex, factoryId: string, cached?: FactoryFlow): Finding[] {
  const out: Finding[] = [];
  const links = Object.values(p.links).filter((l) => l.factoryId === factoryId);
  if (links.length === 0) return out;
  const flow = cached ?? computeFactoryFlow(p, gd, factoryId);
  if (flow.status !== 'ok') return out;
  const locOf = (buildingId: string) => {
    const pl = p.buildings[buildingId]?.placement;
    return pl ? { x: pl.x, y: pl.y, factoryId, floorId: pl.floorId } : undefined;
  };
  for (const l of links) {
    const r = flow.links.get(l.id);
    if (!r) continue;
    const loc = locOf(l.to.buildingId);
    if (r.required > r.capacity + 1e-6) {
      const unit = l.kind === 'belt' ? '/min' : 'm³/min';
      out.push(
        makeFinding(FAB_OVER_CAPACITY, [{ table: 'links', id: l.id }], {
          message: tr('{tier}: benötigt {need}, Kapazität {cap}', {
            tier: gd.name(l.tier),
            need: `${formatNumber(r.required, 2)} ${unit}`,
            cap: `${formatNumber(r.capacity, 2)} ${unit}`,
          }),
          explanation: tr('Ohne Kapazitätsgrenze müsste die Verbindung {need} tragen ({items}). Die gezeichnete Stufe schafft {cap}. Die angeschlossenen Maschinen laufen dadurch langsamer.', {
            need: `${formatNumber(r.required, 2)} ${unit}`,
            items: r.requiredItems.map((x) => `${gd.name(x.itemId)} ${formatNumber(x.perMin, 2)}`).join(', '),
            cap: `${formatNumber(r.capacity, 2)} ${unit}`,
          }),
          suggestion: tr('Höhere Stufe wählen oder den Strom auf zwei Leitungen aufteilen.'),
        }, { location: loc }),
      );
    }
    for (const it of r.rejectedItems) {
      const target = p.buildings[l.to.buildingId];
      out.push(
        makeFinding(
          FAB_WRONG_ITEM,
          [{ table: 'links', id: l.id }, ...(target ? [ref(target)] : [])],
          {
            message: tr('{item} kommt an {target} an, wird dort aber nicht verarbeitet', { item: gd.name(it), target: target ? target.label || gd.name(target.type) : '?' }),
            explanation: tr('Über diese Verbindung kann {item} ankommen. Das Zielgebäude nimmt diesen Gegenstand nicht an; im Spiel staut sich die Leitung.', { item: gd.name(it) }),
            suggestion: tr('Verbindung an ein passendes Gebäude führen, vorher aussortieren (Splitter) oder das Rezept anpassen.'),
          },
          { location: loc, keyExtra: it },
        ),
      );
    }
  }
  for (const m of flow.machines.values()) {
    const b = p.buildings[m.buildingId];
    if (!b) continue;
    const name = b.label || gd.name(b.type);
    const loc = locOf(b.id);
    for (const iss of m.issues) {
      if (iss.kind === 'output-blocked') {
        out.push(
          makeFinding(
            FAB_OUTPUT_BLOCKED,
            [ref(b)],
            {
              message: tr('{name}: {item} wird nicht abgeführt', { name, item: gd.name(iss.itemId) }),
              explanation: iss.portId
                ? tr('Der Ausgang für {item} ist nicht verbunden, oder hinter der Verbindung nimmt niemand {item} ab. Sobald der Ausgangspuffer voll ist, hält die Maschine an.', { item: gd.name(iss.itemId) })
                : tr('Für {item} hat das Gebäude keinen passenden Ausgang. Sobald der Ausgangspuffer voll ist, hält die Maschine an.', { item: gd.name(iss.itemId) }),
              suggestion: tr('Ausgang mit einem Abnehmer verbinden (Maschine, Lager, Frachtplattform oder AWESOME-Schredder).'),
            },
            { location: loc, keyExtra: iss.itemId },
          ),
        );
      }
    }
    const missing = m.issues.filter((x) => x.kind === 'input-missing');
    const short = m.issues.filter((x) => x.kind === 'input-short');
    if (missing.length || short.length || m.issues.some((x) => x.kind === 'belt-limit')) {
      const parts: string[] = [];
      for (const x of missing) parts.push(tr('{item}: keine Zuleitung, über die es ankommen kann', { item: gd.name(x.itemId) }));
      if (short.length && !missing.length) parts.push(tr('Vorprodukte reichen nur für {pct} % (Zulieferung zu gering)', { pct: formatNumber(m.utilizationUncapped * 100, 1) }));
      if (m.issues.some((x) => x.kind === 'belt-limit'))
        parts.push(tr('Mit den gezeichneten Leitungsstufen nur {pct} % statt {pct2} %', { pct: formatNumber(m.utilization * 100, 1), pct2: formatNumber(m.utilizationUncapped * 100, 1) }));
      out.push(
        makeFinding(
          FAB_UNDERSUPPLIED,
          [ref(b)],
          {
            message: tr('{name} läuft mit {pct} % seines Takts', { name, pct: formatNumber(m.utilization * 100, 1) }),
            explanation: `${parts.join('. ')}. ${m.inputs.map((x) => `${gd.name(x.itemId)}: ${rate(gd, x.itemId, x.received)} / ${rate(gd, x.itemId, x.nominal)}`).join('; ')}`,
            suggestion: missing.length
              ? tr('Fehlende Zutaten zuführen (Band oder Rohr vom Erzeuger, Lager oder einer Frachtplattform).')
              : tr('Mehr Vorprodukte bereitstellen oder Leitungsstufen erhöhen.'),
          },
          { location: loc },
        ),
      );
    }
  }
  out.push(
    makeFinding(FAB_FLOW_ASSUMPTIONS, [{ table: 'factories', id: factoryId }], {
      message: tr('Durchsatz nach vereinfachtem Modell berechnet'),
      explanation: flow.assumptions.join(' '),
      suggestion: tr('Engpässe im Spiel mit Durchsatzmessern kontrollieren.'),
    }),
  );
  return out;
}

/** Lifte, Höhenwechsel und Rohrsteigungen. */
export function checkHeights(p: Project, gd: GameDataIndex, factoryId: string): Finding[] {
  const out: Finding[] = [];
  const f = p.factories[factoryId];
  if (!f) return out;
  const floors = f.floorIds.map((id) => p.floors[id]!).filter(Boolean);
  for (const l of Object.values(p.links)) {
    if (l.factoryId !== factoryId) continue;
    const path = linkPath(p, gd, l);
    if (!path || path.length < 2) continue;
    const loc = { x: path[0]!.x, y: path[0]!.y, factoryId, floorId: p.buildings[l.from.buildingId]?.placement?.floorId };
    const lifts = verticalSections(path);
    for (const v of lifts) {
      const lo = Math.min(v.z0, v.z1);
      const hi = Math.max(v.z0, v.z1);
      const crossed = floors.filter((fl) => fl.elevationM > lo + 0.5 && fl.elevationM < hi - 0.5);
      if (crossed.length) {
        out.push(
          makeFinding(
            FAB_LIFT_THROUGH_FLOOR,
            [{ table: 'links', id: l.id }],
            {
              message: tr('{kind} durchquert {floors}', { kind: l.kind === 'belt' ? tr('Förderlift') : tr('Senkrechtes Rohr'), floors: crossed.map((x) => `„${x.name}“`).join(', ') }),
              explanation: tr('Der senkrechte Abschnitt bei x {x} m, y {y} m führt durch den Boden. Dort ist eine Aussparung nötig.', { x: formatNumber(v.at.x, 1), y: formatNumber(v.at.y, 1) }),
              suggestion: tr('Aussparung im Fundament vorsehen oder den Lift an den Rand verlegen.'),
            },
            { location: { ...loc, x: v.at.x, y: v.at.y }, keyExtra: `${v.at.x.toFixed(1)},${v.at.y.toFixed(1)}` },
          ),
        );
      }
    }
    const dz = path.at(-1)!.z - path[0]!.z;
    if (Math.abs(dz) > 1 && lifts.length === 0) {
      out.push(
        makeFinding(FAB_FLOOR_CHANGE_WITHOUT_LIFT, [{ table: 'links', id: l.id }], {
          message: tr('Höhenwechsel um {dz} m ohne senkrechten Abschnitt', { dz: formatNumber(dz, 1) }),
          explanation: tr(FAB_FLOOR_CHANGE_WITHOUT_LIFT.description),
          suggestion: tr('Beim Zeichnen das Stockwerk wechseln (Bild↑/Bild↓), damit ein Lift entsteht, oder die Steigung im Spiel prüfen.'),
        }, { location: loc }),
      );
    }
    if (l.kind === 'pipe') {
      let rise = 0;
      let minZ = path[0]!.z;
      for (const pt of path) {
        minZ = Math.min(minZ, pt.z);
        rise = Math.max(rise, pt.z - minZ);
      }
      if (rise > 0.5) {
        out.push(
          makeFinding(FAB_PIPE_HEAD, [{ table: 'links', id: l.id }], {
            message: tr('Rohr steigt um {h} m', { h: formatNumber(rise, 1) }),
            explanation: tr(FAB_PIPE_HEAD.description),
            suggestion: tr('Förderhöhe im Spiel prüfen und bei Bedarf eine Pipeline-Pumpe einplanen.'),
          }, { location: loc }),
        );
      }
    }
  }
  return out;
}
