import type { SaveBuilding, SaveConveyor, SaveExtract, SaveRef } from '../src/import/saveTypes.ts';
import { gameData } from './helpers.ts';

const gd = gameData();

/**
 * Künstlicher Spielstand-Auszug (kein echter Spielstand im Repository):
 * Miner → Band, Lift hoch, Band, Lift runter, Band → Schmelzofen → Konstruktor → Lager;
 * Wasserpumpe → Rohrkreuzung → Rohrkreuzung → zwei Kohlekraftwerke (Rohre
 * absichtlich „verkehrt herum“ verkettet); Bahnhof mit Frachtplattform
 * (Entladen) und Lager, Gleise davor und dahinter, Blocksignal, Zug mit Fahrplan.
 */
export function fixture(): SaveExtract {
  const node = gd.map!.nodes.find((n) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && n.purity === 'normal')!;
  const { x, y } = node;
  const z = node.z;
  const ref = (id: string, comp: string): SaveRef => ({ id, comp });
  const bld = (id: string, type: string, bx: number, by: number, extra: Partial<SaveBuilding> = {}): SaveBuilding => ({
    id,
    type,
    x: bx,
    y: by,
    z,
    yawDeg: 0,
    recipe: null,
    clock: 1,
    somersloops: 0,
    node: null,
    fuel: null,
    loadMode: null,
    conns: {},
    track: null,
    platformConns: {},
    ...extra,
  });
  const belt = (id: string, pts: [number, number, number][], c0: SaveRef | null, c1: SaveRef | null, lift = false): SaveConveyor => {
    const points = pts.map(([px, py, pz]) => ({ x: px, y: py, z: pz }));
    return { id, type: lift ? 'Build_ConveyorLiftMk2_C' : 'Build_ConveyorBeltMk2_C', kind: 'belt', lift, points, conns: [c0, c1], ends: [points[0]!, points.at(-1)!] };
  };
  const pipe = (id: string, a: [number, number], b: [number, number], c0: SaveRef | null, c1: SaveRef | null): SaveConveyor => {
    const points = [
      { x: a[0], y: a[1], z: z + 1.75 },
      { x: b[0], y: b[1], z: z + 1.75 },
    ];
    return { id, type: 'Build_Pipeline_C', kind: 'pipe', lift: false, points, conns: [c0, c1], ends: [points[0]!, points[1]!] };
  };
  const track = (id: string, x0: number, x1: number, c0: SaveRef[], c1: SaveRef[], integrated = false) => {
    const t = { x: x1 - x0, y: 0, z: 0 };
    return { id, integrated, points: [{ p: { x: x0, y: y + 80, z }, arrive: t, leave: t }, { p: { x: x1, y: y + 80, z }, arrive: t, leave: t }], conns: [c0, c1] as [SaveRef[], SaveRef[]] };
  };
  const h = z + 1;
  return {
    meta: { sessionName: 'Testwelt', saveName: 'Test_autosave_0', buildVersion: 517554, saveVersion: 60, playSeconds: 3600, savedAt: null, modded: false },
    schematics: [
      'Schematic_StartingRecipes_C',
      ...['1', '1_5', '2', '3', '4', '5'].map((n) => `Schematic_Tutorial${n}_C`),
      'Schematic_1-1_C',
      'Schematic_2-1_C',
      'Schematic_3-1_C',
    ],
    phase: 1,
    buildings: [
      // Rohrkreuzungen vor der Pumpe in der Liste: die Kette beginnt an der richtungsfreien Seite
      bld('J2', 'Build_PipelineJunction_Cross_C', x + 28, y + 30, { conns: { Connection3: ref('P3', 'PipelineConnection0'), Connection1: ref('P4', 'PipelineConnection0') } }),
      bld('J1', 'Build_PipelineJunction_Cross_C', x + 28, y + 20, { conns: { Connection0: ref('P1', 'PipelineConnection0'), Connection1: ref('P3', 'PipelineConnection1'), Connection2: ref('P2', 'PipelineConnection0') } }),
      bld('Miner', 'Build_MinerMk1_C', x, y, { node: node.id, clock: 0.5, conns: { Output0: ref('A', 'ConveyorAny0') } }),
      bld('Smelter', 'Build_SmelterMk1_C', x, y + 20, { recipe: 'Recipe_IngotIron_C', conns: { Input0: ref('B', 'ConveyorAny1'), Output2: ref('C', 'ConveyorAny0') } }),
      bld('Constructor', 'Build_ConstructorMk1_C', x, y + 40, { recipe: 'Recipe_IronPlate_C', conns: { Input0: ref('E', 'ConveyorAny1'), Output0: ref('G', 'ConveyorAny0') } }),
      bld('Plates', 'Build_StorageContainerMk1_C', x, y + 52, { conns: { Input0: ref('G', 'ConveyorAny1') } }),
      bld('Pump', 'Build_WaterPump_C', x + 28, y, { conns: { FGPipeConnectionFactory: ref('P1', 'PipelineConnection1') } }),
      bld('Gen1', 'Build_GeneratorCoal_C', x + 16, y + 50, { fuel: 'Desc_Coal_C', conns: { FGPipeConnectionFactory: ref('P2', 'PipelineConnection1') } }),
      bld('Gen2', 'Build_GeneratorCoal_C', x + 40, y + 50, { fuel: 'Desc_Coal_C', conns: { FGPipeConnectionFactory: ref('P4', 'PipelineConnection1') } }),
      // Bahnhof (vorn) mit Frachtplattform dahinter, Lager am Ausgang der Plattform
      bld('Station', 'Build_TrainStation_C', x + 300, y + 80, { track: 'TS', platformConns: { PlatformConnection0: ref('Platform', 'PlatformConnection1'), PlatformConnection1: null } }),
      bld('Platform', 'Build_TrainDockingStation_C', x + 284, y + 80, {
        track: 'TP',
        loadMode: false,
        platformConns: { PlatformConnection1: ref('Station', 'PlatformConnection0'), PlatformConnection0: null },
        conns: { Output0: ref('F', 'ConveyorAny0') },
      }),
      bld('Box', 'Build_StorageContainerMk1_C', x + 284, y + 100, { conns: { Input0: ref('F', 'ConveyorAny1') } }),
    ],
    conveyors: [
      belt('A', [[x, y + 8, h], [x, y + 12, h]], ref('Miner', 'Output0'), ref('B', 'ConveyorAny0')),
      belt('B', [[x, y + 12, h], [x, y + 17, h]], ref('A', 'ConveyorAny1'), ref('Smelter', 'Input0')),
      belt('C', [[x, y + 22, h], [x, y + 26, h]], ref('Smelter', 'Output2'), ref('L1', 'ConveyorAny0')),
      belt('L1', [[x, y + 26, h], [x, y + 26, h + 4]], ref('C', 'ConveyorAny1'), ref('D', 'ConveyorAny0'), true),
      belt('D', [[x, y + 26, h + 4], [x, y + 34, h + 4]], ref('L1', 'ConveyorAny1'), ref('L2', 'ConveyorAny0')),
      // Lift abwärts: Punkte unten → oben, Fluss von oben nach unten
      belt('L2', [[x, y + 34, h], [x, y + 34, h + 4]], ref('D', 'ConveyorAny1'), ref('E', 'ConveyorAny0'), true),
      belt('E', [[x, y + 34, h], [x, y + 37, h]], ref('L2', 'ConveyorAny1'), ref('Constructor', 'Input0')),
      belt('G', [[x, y + 43, h], [x, y + 48, h]], ref('Constructor', 'Output0'), ref('Plates', 'Input0')),
      belt('F', [[x + 284, y + 86, h], [x + 284, y + 95, h]], ref('Platform', 'Output0'), ref('Box', 'Input0')),
      pipe('P1', [x + 28, y + 20], [x + 28, y + 3], ref('J1', 'Connection0'), ref('Pump', 'FGPipeConnectionFactory')),
      pipe('P2', [x + 27, y + 20], [x + 18, y + 39], ref('J1', 'Connection2'), ref('Gen1', 'FGPipeConnectionFactory')),
      pipe('P3', [x + 28, y + 30], [x + 28, y + 21], ref('J2', 'Connection3'), ref('J1', 'Connection1')),
      pipe('P4', [x + 29, y + 30], [x + 42, y + 39], ref('J2', 'Connection1'), ref('Gen2', 'FGPipeConnectionFactory')),
    ],
    tracks: [
      track('T0', x + 150, x + 276, [], [ref('TP', 'TrackConnection0')]),
      track('TP', x + 276, x + 292, [ref('T0', 'TrackConnection1')], [ref('TS', 'TrackConnection0')], true),
      track('TS', x + 292, x + 308, [ref('TP', 'TrackConnection1')], [ref('T1', 'TrackConnection0')], true),
      track('T1', x + 308, x + 450, [ref('TS', 'TrackConnection1')], []),
    ],
    signals: [{ id: 'Sig', kind: 'block', guarded: [ref('T1', 'TrackConnection0')] }],
    stations: [{ building: 'Station', name: 'Erzbahnhof' }],
    trains: [{ id: 'Train', name: '', vehicles: [{ kind: 'locomotive', type: 'BP_Locomotive_C', reversed: false }, { kind: 'wagon', type: 'BP_FreightWagon_C', reversed: false }], stops: [{ station: 'Station', waitS: 20, rule: 'TDD_FullyLoadUnload' }] }],
    skipped: { Build_PowerLine_C: 3 },
  };
}

