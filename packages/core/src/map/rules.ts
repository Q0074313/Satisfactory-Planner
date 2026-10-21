import { defineRule } from '../validation/registry.ts';

const SCIM = { label: 'Satisfactory Calculator – Interactive Map (Lage der Vorkommen)', url: 'https://satisfactory-calculator.com/en/interactive-map' };
const NODE = { label: 'Satisfactory Wiki – Resource node', url: 'https://satisfactory.wiki.gg/wiki/Resource_node' };
const PLAN = { label: 'Konsistenz der Kartenplanung' };

export const MAP_NODE_SHARED = defineRule({
  id: 'MAP-001',
  title: 'Vorkommen mehrfach belegt',
  domain: 'map',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Auf einem Vorkommen kann nur ein Gewinnungsgebäude stehen. Mehrere Gebäude sind mit demselben Vorkommen verknüpft.',
  sources: [NODE],
});

export const MAP_OFF_NODE = defineRule({
  id: 'MAP-002',
  title: 'Gebäude steht nicht auf dem verknüpften Vorkommen',
  domain: 'map',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description:
    'Die Fabrik ist auf der Karte platziert, aber das Gewinnungsgebäude steht im Grundriss nicht über dem verknüpften Vorkommen (Abstand des Gebäudeursprungs größer als 8 m). Annahme: Der Gebäudeursprung liegt über der Mitte des Vorkommens.',
  sources: [SCIM, PLAN],
});

export const MAP_NODE_MISMATCH = defineRule({
  id: 'MAP-003',
  title: 'Rohstoff oder Reinheit passt nicht zum Vorkommen',
  domain: 'map',
  kind: 'game-rule',
  certainty: 'static',
  severity: 'error',
  description: 'Das Gebäude ist mit einem Vorkommen verknüpft, fördert aber einen anderen Rohstoff oder rechnet mit einer anderen Reinheit, als das Vorkommen hat.',
  sources: [SCIM, NODE],
});

export const MAP_NODE_UNKNOWN = defineRule({
  id: 'MAP-004',
  title: 'Verknüpftes Vorkommen fehlt in den Kartendaten',
  domain: 'map',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Das verknüpfte Vorkommen ist im Kartendatensatz des Projekts nicht (mehr) enthalten, z. B. nach einem Wechsel des Spieldatensatzes.',
  sources: [SCIM],
});

export const MAP_FACTORY_OVERLAP = defineRule({
  id: 'MAP-005',
  title: 'Fabrikgrundrisse überschneiden sich',
  domain: 'map',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Die Grundrisse zweier Fabriken überschneiden sich auf der Karte (konvexe Hülle der Bau- und Fundamentflächen bzw. der Gebäude). Höhen werden nicht verglichen.',
  sources: [PLAN],
});

export const MAP_OUTSIDE = defineRule({
  id: 'MAP-006',
  title: 'Fabrik außerhalb der Spielwelt',
  domain: 'map',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'warning',
  description: 'Der Standort der Fabrik liegt außerhalb des spielbaren Kartenbereichs.',
  sources: [SCIM],
});

export const MAP_NODE_NEARBY = defineRule({
  id: 'MAP-007',
  title: 'Gebäude steht auf einem Vorkommen, ist aber nicht verknüpft',
  domain: 'map',
  kind: 'recommendation',
  certainty: 'static',
  severity: 'info',
  description:
    'Unter dem Gewinnungsgebäude liegt laut Karte ein passendes Vorkommen. Mit der Verknüpfung übernimmt das Gebäude Rohstoff und Reinheit, und die Karte zeigt das Vorkommen als belegt.',
  sources: [SCIM],
});

export const MAP_TERRAIN_UNCHECKED = defineRule({
  id: 'MAP-008',
  title: 'Gelände und Höhe nicht geprüft',
  domain: 'map',
  kind: 'unchecked',
  certainty: 'static',
  severity: 'info',
  description:
    'Die Karte kennt nur die Lage der Vorkommen, kein Gelände. Ob der Grundriss auf Hängen, im Wasser oder über Felsen liegt und ob die Höhe der Vorkommen zu den Stockwerken passt, wird nicht geprüft.',
  sources: [PLAN],
});
