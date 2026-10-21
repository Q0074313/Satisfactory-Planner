/**
 * Prüfungen der Weltkarte: Belegung der Vorkommen, Lage der
 * Gewinnungsgebäude, Überschneidung der Fabrikstandorte.
 */
import type { GameDataIndex } from '../gamedata/index.ts';
import { convexOverlap, dist } from '../geometry/index.ts';
import { formatNumber, tr } from '../i18n/index.ts';
import type { Building, ObjectRef, Project, Purity } from '../model/schema.ts';
import { makeFinding } from '../validation/registry.ts';
import type { Finding } from '../validation/types.ts';
import { buildingWorldPosition, canUseNode, factoryWorldCenter, factoryWorldHull, insideWorld, NODE_SNAP_M, nodesNear, nodeUsage } from './index.ts';
import {
  MAP_FACTORY_OVERLAP,
  MAP_NODE_MISMATCH,
  MAP_NODE_NEARBY,
  MAP_NODE_SHARED,
  MAP_NODE_UNKNOWN,
  MAP_OFF_NODE,
  MAP_OUTSIDE,
  MAP_TERRAIN_UNCHECKED,
} from './rules.ts';

const PURITY_LABEL: Record<Purity, string> = { impure: 'unrein', normal: 'normal', pure: 'rein' };
export const purityLabel = (p: Purity) => tr(PURITY_LABEL[p]);

const bref = (b: Building): ObjectRef => ({ table: 'buildings', id: b.id });

function label(p: Project, gd: GameDataIndex, b: Building) {
  return `${b.label || gd.name(b.type)} (${p.factories[b.factoryId]?.name ?? '?'})`;
}

function at(p: Project, b: Building) {
  return b.placement ? { location: { x: b.placement.x, y: b.placement.y, factoryId: b.factoryId, floorId: b.placement.floorId } } : {};
}

export function checkMap(p: Project, gd: GameDataIndex): Finding[] {
  const out: Finding[] = [];
  if (!gd.map) return out;

  // Belegung und Übereinstimmung mit dem Vorkommen
  for (const [nodeId, ids] of nodeUsage(p)) {
    const node = gd.mapNode(nodeId);
    const buildings = ids.map((id) => p.buildings[id]!);
    if (!node) {
      for (const b of buildings)
        out.push(
          makeFinding(
            MAP_NODE_UNKNOWN,
            [bref(b)],
            {
              message: tr('{building}: Vorkommen {id} fehlt in den Kartendaten', { building: label(p, gd, b), id: nodeId }),
              explanation: tr(MAP_NODE_UNKNOWN.description),
              suggestion: tr('Verknüpfung lösen und das Gebäude einem vorhandenen Vorkommen zuordnen.'),
            },
            at(p, b),
          ),
        );
      continue;
    }
    if (buildings.length > 1) {
      out.push(
        makeFinding(MAP_NODE_SHARED, buildings.map(bref), {
          message: tr('Vorkommen {item} ({purity}) ist {n}-mal belegt', { item: gd.name(node.itemId ?? ''), purity: node.purity ? purityLabel(node.purity) : '', n: buildings.length }),
          explanation: tr(MAP_NODE_SHARED.description),
          suggestion: tr('Nur ein Gebäude mit dem Vorkommen verknüpfen; für die übrigen ein freies Vorkommen wählen.'),
        }, { keyExtra: nodeId }),
      );
    }
    for (const b of buildings) {
      const ex = b.extraction!;
      if (!canUseNode(gd, b.type, node) || ex.itemId !== node.itemId || ex.purity !== node.purity) {
        out.push(
          makeFinding(
            MAP_NODE_MISMATCH,
            [bref(b)],
            {
              message: tr('{building}: fördert {item} ({purity}), das Vorkommen hat {nodeItem} ({nodePurity})', {
                building: label(p, gd, b),
                item: gd.name(ex.itemId),
                purity: purityLabel(ex.purity),
                nodeItem: gd.name(node.itemId ?? ''),
                nodePurity: node.purity ? purityLabel(node.purity) : '–',
              }),
              explanation: tr(MAP_NODE_MISMATCH.description),
              suggestion: tr('Das Vorkommen erneut zuweisen (übernimmt Rohstoff und Reinheit) oder die Verknüpfung lösen.'),
            },
            at(p, b),
          ),
        );
      }
      const pos = buildingWorldPosition(p, b);
      if (pos) {
        const d = dist(pos, node);
        if (d > NODE_SNAP_M) {
          out.push(
            makeFinding(
              MAP_OFF_NODE,
              [bref(b)],
              {
                message: tr('{building}: steht {d} m neben dem verknüpften Vorkommen', { building: label(p, gd, b), d: formatNumber(d, 0) }),
                explanation: tr(MAP_OFF_NODE.description),
                suggestion: tr('Gebäude im Grundriss auf das Vorkommen setzen (Ebene „Vorkommen“) oder den Fabrikstandort auf der Karte verschieben.'),
              },
              at(p, b),
            ),
          );
        }
      }
    }
  }

  // Nicht verknüpfte Gewinnungsgebäude über einem passenden Vorkommen
  const used = nodeUsage(p);
  for (const b of Object.values(p.buildings)) {
    if (!gd.building(b.type)?.extractor || b.extraction?.nodeId) continue;
    const pos = buildingWorldPosition(p, b);
    if (!pos) continue;
    const near = nodesNear(gd, pos, { maxDistM: NODE_SNAP_M, filter: (n) => canUseNode(gd, b.type, n) && !used.has(n.id) })[0];
    if (!near) continue;
    out.push(
      makeFinding(
        MAP_NODE_NEARBY,
        [bref(b)],
        {
          message: tr('{building}: steht auf einem Vorkommen {item} ({purity})', { building: label(p, gd, b), item: gd.name(near.node.itemId ?? ''), purity: near.node.purity ? purityLabel(near.node.purity) : '' }),
          explanation: tr(MAP_NODE_NEARBY.description),
          suggestion: tr('In den Eigenschaften des Gebäudes das Vorkommen auswählen.'),
        },
        { ...at(p, b), keyExtra: near.node.id },
      ),
    );
  }

  // Fabrikstandorte
  const placed = Object.values(p.factories).filter((f) => f.map);
  for (const f of placed) {
    const c = factoryWorldCenter(p, gd, f.id)!;
    if (!insideWorld(gd, c)) {
      out.push(
        makeFinding(MAP_OUTSIDE, [{ table: 'factories', id: f.id }], {
          message: tr('Fabrik „{name}“ liegt außerhalb der Spielwelt', { name: f.name }),
          explanation: tr(MAP_OUTSIDE.description),
          suggestion: tr('Fabrik auf der Karte in den spielbaren Bereich verschieben.'),
        }),
      );
    }
  }
  const hulls = placed.map((f) => ({ f, hull: factoryWorldHull(p, gd, f.id)! }));
  for (let i = 0; i < hulls.length; i++) {
    for (let j = i + 1; j < hulls.length; j++) {
      const a = hulls[i]!;
      const b = hulls[j]!;
      if (a.hull.length < 3 || b.hull.length < 3 || !convexOverlap(a.hull, b.hull)) continue;
      out.push(
        makeFinding(
          MAP_FACTORY_OVERLAP,
          [
            { table: 'factories', id: a.f.id },
            { table: 'factories', id: b.f.id },
          ],
          {
            message: tr('Fabriken „{a}“ und „{b}“ überschneiden sich auf der Karte', { a: a.f.name, b: b.f.name }),
            explanation: tr(MAP_FACTORY_OVERLAP.description),
            suggestion: tr('Eine der Fabriken auf der Karte verschieben oder drehen; bei übereinander geplanten Fabriken den Befund ignorieren.'),
          },
        ),
      );
    }
  }
  if (placed.length) {
    out.push(
      makeFinding(MAP_TERRAIN_UNCHECKED, [{ table: 'factories', id: placed[0]!.id }], {
        message: tr('Gelände und Höhenlage der Standorte werden nicht geprüft'),
        explanation: tr(MAP_TERRAIN_UNCHECKED.description),
        suggestion: tr('Standort im Spiel bzw. auf der Kartenansicht „realistisch“ prüfen.'),
      }, { keyExtra: 'all' }),
    );
  }
  return out;
}

/** Name eines Vorkommens für die Anzeige, z. B. „Eisenerz (rein)“. */
export function nodeTitle(gd: GameDataIndex, id: string): string {
  const n = gd.mapNode(id);
  if (!n) return id;
  if (n.kind === 'geyser') return `${tr('Geysir')}${n.purity ? ` (${purityLabel(n.purity)})` : ''}`;
  const item = n.itemId ? gd.name(n.itemId) : '';
  if (n.kind === 'well-core') return tr('{item}-Quelle (Mitte)', { item });
  return n.purity ? `${item} (${purityLabel(n.purity)})` : item;
}
