import { tr } from '../i18n/index.ts';
import { newId } from '../model/ids.ts';
import {
  PROJECT_FORMAT_VERSION,
  ProjectSettingsSchema,
  type Factory,
  type Floor,
  type Project,
} from '../model/schema.ts';

export interface CreateProjectOptions {
  name: string;
  datasetId: string;
  gameVersion: string;
  now?: Date;
  /** Leeres Projekt ohne Beispielfabrik. */
  empty?: boolean;
}

export const FACTORY_COLORS = ['#e8a33d', '#4f9fd8', '#6cbf6a', '#d86a6a', '#a67bd8', '#d8c24f', '#4fc2b8', '#d88a4f'];

export function createProject(opts: CreateProjectOptions): Project {
  const now = (opts.now ?? new Date()).toISOString();
  const project: Project = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: newId('project'),
    name: opts.name,
    description: '',
    createdAt: now,
    updatedAt: now,
    gameData: { datasetId: opts.datasetId, gameVersion: opts.gameVersion },
    settings: ProjectSettingsSchema.parse({}),
    factories: {},
    floors: {},
    areas: {},
    buildings: {},
    links: {},
    groups: {},
    productionPlans: {},
    railNetworks: {},
    railNodes: {},
    railSegments: {},
    railSignals: {},
    stations: {},
    trains: {},
    timetables: {},
    transportOrders: {},
    measurements: {},
    findingStates: {},
  };
  if (!opts.empty) {
    const f = makeFactory(project, tr('Fabrik {n}', { n: 1 }));
    project.factories[f.factory.id] = f.factory;
    project.floors[f.floor.id] = f.floor;
  }
  return project;
}

/** Erzeugt eine Fabrik mit einem Erdgeschoss (ohne sie einzufügen). */
export function makeFactory(project: Project, name: string): { factory: Factory; floor: Floor } {
  const factoryId = newId('factory');
  const floor: Floor = {
    id: newId('floor'),
    factoryId,
    name: tr('Erdgeschoss'),
    kind: 'production',
    elevationM: 0,
    heightM: 12,
  };
  const color = FACTORY_COLORS[Object.keys(project.factories).length % FACTORY_COLORS.length]!;
  return { factory: { id: factoryId, name, color, floorIds: [floor.id], notes: '' }, floor };
}
