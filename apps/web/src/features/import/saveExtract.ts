/**
 * Spielstand (gelesen mit @etothepii/satisfactory-file-parser) → neutraler
 * Auszug (`SaveExtract`, siehe packages/core/src/import/saveTypes.ts).
 *
 * Übernommen werden nur die für die Planung nötigen Angaben: Gebäude mit
 * Lage, Rezept, Takt, Somersloops, Vorkommen und Anschlüssen; Bänder, Lifte
 * und Rohre als Punktfolge; Gleise, Signale, Bahnhöfe, Züge und Fahrpläne;
 * gekaufte Schaltpläne, die Phase des Weltraumlifts und Fundamente.
 * Spielerdaten und Inventare bleiben außen vor.
 */
import type { SaveBuilding, SaveConveyor, SaveExtract, SaveRef, SaveTrack, SaveTrain, Vec3 } from '@satis/core';

/* Die Bibliothek liefert ein tief verschachteltes, lose typisiertes Objektmodell. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = any;

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

const cm = (v: number) => v / 100;
const classOf = (path: string) => path.split('.').pop() ?? path;
/** `Persistent_Level:PersistentLevel.Build_X_C_123.Input0` → `{ id: 'Build_X_C_123', comp: 'Input0' }`. */
function refOf(pathName: string | undefined): SaveRef | null {
  if (!pathName) return null;
  const parts = pathName.split('.');
  if (parts.length < 3) return null;
  return { id: parts[parts.length - 2]!, comp: parts[parts.length - 1]! };
}
/** Objektname ohne Ebenenpräfix: `Persistent_Level:PersistentLevel.Build_X_C_123` → `Build_X_C_123`. */
const nameOf = (pathName: string) => pathName.split('.').pop() ?? pathName;

function rotateQ(q: Quat, v: Vec3): Vec3 {
  // v' = q · v · q⁻¹
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

const yawOf = (q: Quat) => (Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180) / Math.PI;

const prop = (o: Obj, name: string): any => o?.properties?.[name];
const val = (o: Obj, name: string): any => prop(o, name)?.value;
const vals = (o: Obj, name: string): any[] => prop(o, name)?.values ?? [];

/** Spline-Punkte (lokal, cm) → Weltkoordinaten (m), mit Zwischenpunkten in Kurven. */
function splineWorld(o: Obj): { p: Vec3; arrive: Vec3; leave: Vec3 }[] {
  const t = o.transform;
  const q: Quat = t.rotation;
  const world = (v: Vec3): Vec3 => {
    const r = rotateQ(q, v);
    return { x: cm(t.translation.x + r.x), y: cm(t.translation.y + r.y), z: cm(t.translation.z + r.z) };
  };
  const dir = (v: Vec3): Vec3 => {
    const r = rotateQ(q, v);
    return { x: cm(r.x), y: cm(r.y), z: cm(r.z) };
  };
  return vals(o, 'mSplineData').map((s: Obj) => ({
    p: world(s.properties.Location.value),
    arrive: dir(s.properties.ArriveTangent.value),
    leave: dir(s.properties.LeaveTangent.value),
  }));
}

/**
 * Spline als Polylinie mit Ecken: gerade Stücke ohne Zwischenpunkt, jede Kurve
 * als ein Eckpunkt (Schnitt von Austritts- und Eintrittsrichtung), eine
 * S-Kurve als zwei Ecken. Höhen werden zwischen den Enden verteilt.
 */
function cornerSpline(pts: { p: Vec3; arrive: Vec3; leave: Vec3 }[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    if (i === 0) out.push(a.p);
    const b = pts[i + 1];
    if (!b) break;
    const d = { x: b.p.x - a.p.x, y: b.p.y - a.p.y };
    const len = Math.hypot(d.x, d.y);
    const unit = (t: Vec3) => {
      const l = Math.hypot(t.x, t.y);
      return l < 1e-9 ? { x: d.x / (len || 1), y: d.y / (len || 1) } : { x: t.x / l, y: t.y / l };
    };
    const u = unit(a.leave);
    const v = unit(b.arrive);
    const cross = u.x * v.y - u.y * v.x;
    const along = (u.x * d.x + u.y * d.y) / (len || 1);
    const zAt = (s: number) => a.p.z + (b.p.z - a.p.z) * Math.min(1, Math.max(0, s));
    if (len > 0.5 && Math.abs(cross) > 1e-3) {
      // Schnittpunkt a + s·u = b − t·v
      const s = (d.x * v.y - d.y * v.x) / cross;
      const t = (d.x * u.y - d.y * u.x) / cross;
      if (s > 0.1 && t > 0.1 && s < 4 * len && t < 4 * len) out.push({ x: a.p.x + u.x * s, y: a.p.y + u.y * s, z: zAt(s / (s + t)) });
    } else if (len > 0.5 && along < 0.9999 && Math.abs(u.x * v.x + u.y * v.y) > 0.99) {
      // S-Kurve (parallele Richtungen, seitlich versetzt): zwei Ecken auf halber Strecke
      const h = (u.x * d.x + u.y * d.y) / 2;
      const p1 = { x: a.p.x + u.x * h, y: a.p.y + u.y * h };
      const p2 = { x: b.p.x - v.x * h, y: b.p.y - v.y * h };
      out.push({ ...p1, z: zAt(0.5) }, { ...p2, z: zAt(0.5) });
    }
    out.push(b.p);
  }
  return out;
}

const CONVEYOR = /^Build_(ConveyorBelt|ConveyorLift|Pipeline(MK2)?(_NoIndicator)?_C$)/;
const SKIP = /^Build_(Foundation|Wall|Ramp|Power(Line|Pole|Tower|Switch|Storage)|Pillar|Beam|Walkway|Catwalk|Stair|Railing|Ladder|Fence|Sign|Light|Roof|Window|Door|Concrete|Barrier|Frame|Quarter|Inverted|Down|Flat|Gate|Pipeline(Support|FlowIndicator)|ConveyorPole|ConveyorCeiling|PipeHyper|PipeSupport|VehiclePath|Elevator|Lookout|Standalone|Hypertube|Snow|Xmas|Wire|Blueprint|Passthrough|FoundationPassthrough)/;

export function extractSave(save: Obj): SaveExtract {
  const objs: Obj[] = Object.values(save.levels as Record<string, { objects: Obj[] }>).flatMap((l) => l.objects);
  const byName = new Map<string, Obj>(objs.map((o) => [o.instanceName as string, o]));
  const comp = (owner: Obj, name: string): Obj | undefined => byName.get(`${owner.instanceName}.${name}`);
  const header = save.header ?? {};
  const out: SaveExtract = {
    meta: {
      sessionName: String(header.sessionName ?? ''),
      saveName: String(header.saveName ?? save.name ?? ''),
      buildVersion: Number(header.buildVersion ?? 0),
      saveVersion: Number(header.saveVersion ?? 0),
      playSeconds: Number(header.playDurationSeconds ?? 0),
      savedAt: header.saveDateTime ? new Date(Number(header.saveDateTime)).toISOString() : null,
      modded: Boolean(header.isModdedSave),
    },
    schematics: [],
    phase: null,
    buildings: [],
    conveyors: [],
    tracks: [],
    signals: [],
    stations: [],
    trains: [],
    foundations: [],
    skipped: {},
  };
  const skip = (cls: string) => (out.skipped[cls] = (out.skipped[cls] ?? 0) + 1);

  for (const o of objs) {
    const cls = classOf(o.typePath ?? '');
    if (cls === 'BP_SchematicManager_C') out.schematics = vals(o, 'mPurchasedSchematics').map((v: Obj) => classOf(v.pathName));
    if (cls === 'BP_GamePhaseManager_C') {
      const m = /Phase_(\d+)/.exec(val(o, 'mCurrentGamePhase')?.pathName ?? '');
      out.phase = m ? Number(m[1]) : null;
    }
    if (cls === 'FGLightweightBuildableSubsystem') {
      for (const group of o.specialProperties?.buildables ?? []) {
        const type = classOf(group.typeReference?.pathName ?? '');
        if (!/^Build_Foundation/.test(type)) continue;
        for (const inst of group.instances ?? []) {
          const tt = inst.transform;
          (out.foundations ??= []).push({ type, x: cm(tt.translation.x), y: cm(tt.translation.y), z: cm(tt.translation.z), yawDeg: yawOf(tt.rotation) });
        }
      }
    }
    if (cls === 'FGTrainStationIdentifier') {
      const st = val(o, 'mStation')?.pathName;
      if (st) out.stations.push({ building: nameOf(st), name: String(val(o, 'mStationName')?.value ?? '') });
    }
    if (!cls.startsWith('Build_') || o.type !== 'SaveEntity') continue;
    const id = nameOf(o.instanceName);
    const t = o.transform;

    // Bänder, Lifte, Rohre
    if (CONVEYOR.test(cls)) {
      const pipe = cls.startsWith('Build_Pipeline');
      const lift = cls.startsWith('Build_ConveyorLift');
      const names = pipe ? ['PipelineConnection0', 'PipelineConnection1'] : ['ConveyorAny0', 'ConveyorAny1'];
      const conns = names.map((n) => refOf(val(comp(o, n), 'mConnectedComponent')?.pathName)) as [SaveRef | null, SaveRef | null];
      let points: Vec3[];
      if (lift) {
        const bottom = { x: cm(t.translation.x), y: cm(t.translation.y), z: cm(t.translation.z) };
        const top = val(o, 'mTopTransform')?.properties?.Translation?.value ?? { x: 0, y: 0, z: 0 };
        const r = rotateQ(t.rotation, top);
        points = [bottom, { x: bottom.x + cm(r.x), y: bottom.y + cm(r.y), z: bottom.z + cm(r.z) }];
      } else points = cornerSpline(splineWorld(o));
      if (points.length < 2) {
        skip(cls);
        continue;
      }
      const c: SaveConveyor = { id, type: cls, kind: pipe ? 'pipe' : 'belt', lift, points, conns, ends: [points[0]!, points.at(-1)!] };
      out.conveyors.push(c);
      continue;
    }
    // Gleise
    if (cls === 'Build_RailroadTrack_C' || cls === 'Build_RailroadTrackIntegrated_C') {
      const conns = ['TrackConnection0', 'TrackConnection1'].map((n) =>
        vals(comp(o, n), 'mConnectedComponents')
          .map((v: Obj) => refOf(v.pathName))
          .filter((r: SaveRef | null): r is SaveRef => r !== null),
      ) as [SaveRef[], SaveRef[]];
      const tr: SaveTrack = { id, integrated: cls === 'Build_RailroadTrackIntegrated_C', points: splineWorld(o), conns };
      if (tr.points.length >= 2) out.tracks.push(tr);
      continue;
    }
    if (cls === 'Build_RailroadBlockSignal_C' || cls === 'Build_RailroadPathSignal_C') {
      out.signals.push({
        id,
        kind: cls === 'Build_RailroadPathSignal_C' ? 'path' : 'block',
        guarded: vals(o, 'mGuardedConnections')
          .map((v: Obj) => refOf(v.pathName))
          .filter((r: SaveRef | null): r is SaveRef => r !== null),
      });
      continue;
    }
    if (/^Build_Foundation_/.test(cls)) {
      (out.foundations ??= []).push({ type: cls, x: cm(t.translation.x), y: cm(t.translation.y), z: cm(t.translation.z), yawDeg: yawOf(t.rotation) });
      continue;
    }
    if (SKIP.test(cls)) {
      skip(cls);
      continue;
    }

    // Gebäude: Anschlüsse aus den Komponenten
    const conns: Record<string, SaveRef | null> = {};
    const platformConns: Record<string, SaveRef | null> = {};
    let somersloops = 0;
    for (const c of o.components ?? []) {
      const name = nameOf(c.pathName);
      const co = byName.get(c.pathName);
      if (!co) continue;
      const ct = classOf(co.typePath ?? '');
      if (ct === 'FGFactoryConnectionComponent' || ct === 'FGPipeConnectionComponent' || ct === 'FGPipeConnectionFactory' || ct === 'FGPipeConnectionComponentHyper')
        conns[name] = refOf(val(co, 'mConnectedComponent')?.pathName);
      else if (ct === 'FGTrainPlatformConnection') platformConns[name] = refOf(val(co, 'mConnectedTo')?.pathName);
      else if (name === 'InventoryPotential')
        for (const s of vals(co, 'mInventoryStacks')) {
          const item = s?.properties?.Item?.value?.itemReference?.pathName ?? '';
          if (item.includes('Desc_WAT1')) somersloops += Number(s.properties.NumItems?.value ?? 0);
        }
    }
    const recipe = val(o, 'mCurrentRecipe')?.pathName;
    const node = val(o, 'mExtractableResource')?.pathName;
    const fuel = val(o, 'mCurrentFuelClass')?.pathName;
    const track = val(o, 'mRailroadTrack')?.pathName;
    // Senkrecht eingebaut: lokale x-Achse zeigt nach oben bzw. unten
    const ax = rotateQ(t.rotation, { x: 1, y: 0, z: 0 });
    const b: SaveBuilding = {
      id,
      type: cls,
      ...(Math.abs(ax.z) > 0.9 ? { vertical: ax.z > 0 ? ('up' as const) : ('down' as const) } : {}),
      x: cm(t.translation.x),
      y: cm(t.translation.y),
      z: cm(t.translation.z),
      yawDeg: yawOf(t.rotation),
      recipe: recipe ? classOf(recipe) : null,
      clock: Number(val(o, 'mCurrentPotential') ?? 1) || 1,
      somersloops,
      node: node && nameOf(node).startsWith('BP_') ? nameOf(node) : null,
      fuel: fuel ? classOf(fuel) : null,
      // Frachtplattform bzw. Lkw-Station: fehlt die Eigenschaft, gilt der Standard (Beladen)
      loadMode: /^Build_(TrainDockingStation|TruckStation|FluidTruckStation)/.test(cls) ? val(o, 'mIsInLoadMode') !== false : null,
      conns,
      track: track ? nameOf(track) : null,
      platformConns,
    };
    out.buildings.push(b);
  }

  // Züge: Fahrzeuge über „vehicleBehind“, Fahrplan mit Halten
  const identToStation = new Map<string, string>();
  for (const o of objs) if (classOf(o.typePath ?? '') === 'FGTrainStationIdentifier') identToStation.set(nameOf(o.instanceName), nameOf(val(o, 'mStation')?.pathName ?? ''));
  for (const o of objs) {
    if (classOf(o.typePath ?? '') !== 'BP_Train_C') continue;
    const vehicles: SaveTrain['vehicles'] = [];
    let v = byName.get(val(o, 'FirstVehicle')?.pathName ?? '');
    const seen = new Set<string>();
    while (v && !seen.has(v.instanceName)) {
      seen.add(v.instanceName);
      const cls = classOf(v.typePath);
      vehicles.push({ kind: /Locomotive/.test(cls) ? 'locomotive' : 'wagon', type: cls, reversed: val(v, 'mIsOrientationReversed') === true });
      v = byName.get(v.specialProperties?.vehicleBehind?.pathName ?? '');
    }
    const tt = byName.get(val(o, 'TimeTable')?.pathName ?? '');
    const stops = vals(tt, 'mStops').map((s: Obj) => {
      const rules = s.properties?.DockingRuleSet?.value?.properties ?? {};
      return {
        station: identToStation.get(nameOf(s.properties?.Station?.value?.pathName ?? '')) ?? '',
        waitS: Number(rules.DockForDuration?.value ?? 0),
        rule: String(rules.DockingDefinition?.value?.value ?? '').replace(/^.*::/, ''),
      };
    });
    const name = val(o, 'mTrainName')?.value;
    out.trains.push({ id: nameOf(o.instanceName), name: name ? String(name) : '', vehicles, stops: stops.filter((s: { station: string }) => s.station) });
  }
  return out;
}
