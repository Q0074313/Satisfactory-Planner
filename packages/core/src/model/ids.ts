import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const generate = customAlphabet(alphabet, 12);

/** Präfixe machen IDs in Exporten und Fehlermeldungen lesbar. */
export const ID_PREFIX = {
  project: 'prj',
  factory: 'fac',
  floor: 'flr',
  area: 'area',
  building: 'bld',
  link: 'lnk',
  group: 'grp',
  groupInstance: 'gin',
  productionPlan: 'plan',
  railNetwork: 'net',
  railNode: 'node',
  railSegment: 'seg',
  railSignal: 'sig',
  station: 'sta',
  platform: 'plt',
  train: 'trn',
  timetable: 'tt',
  stop: 'stp',
  transportOrder: 'ord',
  measurement: 'msr',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

export function newId(kind: IdKind): string {
  return `${ID_PREFIX[kind]}_${generate()}`;
}
