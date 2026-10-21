import type { MapNode } from '@satis/core';
import type { useMapStore } from '../../state/mapStore';

type MapFilterState = Pick<ReturnType<typeof useMapStore.getState>, 'hiddenResources' | 'purities' | 'kinds' | 'onlyFree'>;

/** Schlüssel eines Vorkommens im Rohstofffilter (Gegenstand bzw. `geyser`). */
export const resourceKey = (n: Pick<MapNode, 'kind' | 'itemId'>) => (n.kind === 'geyser' ? 'geyser' : (n.itemId ?? ''));

/** Sichtbarkeit eines Vorkommens laut Filter der Kartenansicht. */
export function nodeFilter(st: MapFilterState, usage: Map<string, string[]>): (n: MapNode) => boolean {
  const hidden = new Set(st.hiddenResources);
  return (n) => {
    if (hidden.has(resourceKey(n))) return false;
    if (n.kind !== 'geyser' && !st.kinds[n.kind]) return false;
    if (n.purity && !st.purities[n.purity]) return false;
    if (st.onlyFree && usage.has(n.id)) return false;
    return true;
  };
}
