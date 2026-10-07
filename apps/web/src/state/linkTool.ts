/**
 * Leitungswerkzeug (Förderband/Rohr) mit der zuletzt benutzten Stufe und dem
 * zuletzt benutzten Verlegemodus. Die Auswahl gilt, bis sie geändert wird.
 */
import type { GameDataIndex, LinkKind, LinkRouting } from '@satis/core';
import { usePrefs } from './prefsStore';
import type { Tool } from './uiStore';

export const ROUTING_ORDER: LinkRouting[] = ['direct', 'straight', 'curved'];

export function tiersOf(gd: GameDataIndex, kind: LinkKind) {
  return kind === 'belt' ? gd.beltTiers : gd.pipeTiers;
}

export function linkToolFor(gd: GameDataIndex, kind: LinkKind): Extract<Tool, { kind: 'link' }> {
  const saved = usePrefs.getState().linkTools[kind];
  const tiers = tiersOf(gd, kind);
  const tier = saved && tiers.some((x) => x.id === saved.tier) ? saved.tier : (tiers[0]?.id ?? '');
  const routing = saved && ROUTING_ORDER.includes(saved.routing) ? saved.routing : 'direct';
  return { kind: 'link', linkKind: kind, tier, routing };
}

export function nextRouting(r: LinkRouting): LinkRouting {
  return ROUTING_ORDER[(ROUTING_ORDER.indexOf(r) + 1) % ROUTING_ORDER.length]!;
}

export function nextTier(gd: GameDataIndex, kind: LinkKind, tier: string): string {
  const tiers = tiersOf(gd, kind);
  const i = tiers.findIndex((x) => x.id === tier);
  return tiers[(i + 1) % tiers.length]?.id ?? tier;
}
