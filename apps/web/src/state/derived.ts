/**
 * Abgeleitete Daten (Befunde, Bilanzen) mit Zwischenspeicher.
 */
import { useMemo } from 'react';
import { createValidator, type Finding, type Project } from '@satis/core';
import type { Mode } from './uiStore';
import { useProjectStore } from './projectStore';

const validate = createValidator();

export function useFindings(): Finding[] {
  const project = useProjectStore((s) => s.project);
  const gd = useProjectStore((s) => s.gd);
  return useMemo(() => {
    if (!project || !gd) return [];
    return validate(project, gd).findings.map((f) => f);
  }, [project, gd]);
}

/** Befunde ohne als „ignoriert“ markierte. */
export function useActiveFindings(): { all: Finding[]; active: Finding[] } {
  const all = useFindings();
  const states = useProjectStore((s) => s.project?.findingStates);
  const active = useMemo(() => all.filter((f) => states?.[f.key]?.status !== 'ignored'), [all, states]);
  return { all, active };
}

/** Objekt-IDs mit Fehlern bzw. Warnungen, für die Markierung im Editor. */
export function useFindingMarks(): Map<string, 'error' | 'warning'> {
  const { active } = useActiveFindings();
  return useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const f of active) {
      if (f.severity === 'info') continue;
      for (const o of f.objects) {
        if (m.get(o.id) === 'error') continue;
        m.set(o.id, f.severity);
      }
    }
    return m;
  }, [active]);
}

/** Bereich einer Ansicht für die Befundliste. */
export function domainOfMode(mode: Mode): Finding['domain'] {
  return mode === 'factory' ? 'factory' : mode;
}

/**
 * Passt ein Befund zur aktuellen Ansicht? Fabrikbefunde gehören zur aktiven
 * Fabrik, Schienenbefunde zum aktiven Netz, Produktionsbefunde zu den Plänen
 * der aktiven Fabrik. Transportbefunde gelten projektweit.
 */
export function findingInView(f: Finding, p: Project, mode: Mode, factoryId: string | null, networkId: string | null): boolean {
  if (f.domain !== domainOfMode(mode)) return false;
  if (mode === 'factory') {
    if (f.location?.factoryId) return f.location.factoryId === factoryId;
    return f.objects.some((o) => {
      if (o.table === 'factories') return o.id === factoryId;
      const obj = (p[o.table] as Record<string, { factoryId?: string | null }>)[o.id];
      return obj?.factoryId === factoryId;
    });
  }
  if (mode === 'production') {
    return f.objects.some((o) => o.table === 'productionPlans' && p.productionPlans[o.id]?.factoryId === factoryId);
  }
  if (mode === 'rail') {
    if (f.location?.networkId) return f.location.networkId === networkId;
    return f.objects.some((o) => {
      if (o.table === 'railNetworks') return o.id === networkId;
      const obj = (p[o.table] as Record<string, { networkId?: string }>)[o.id];
      return obj?.networkId === networkId;
    });
  }
  return true;
}

/** Fehler/Warnungen je Ansicht (für die Zähler an den Reitern). */
export function useFindingCounts(): Record<Mode, { error: number; warning: number }> {
  const { active } = useActiveFindings();
  return useMemo(() => {
    const c: Record<Mode, { error: number; warning: number }> = {
      factory: { error: 0, warning: 0 },
      production: { error: 0, warning: 0 },
      rail: { error: 0, warning: 0 },
      transport: { error: 0, warning: 0 },
    };
    for (const f of active) {
      if (f.severity === 'info') continue;
      const m: Mode = f.domain === 'production' ? 'production' : f.domain === 'rail' ? 'rail' : f.domain === 'transport' ? 'transport' : 'factory';
      c[m][f.severity]++;
    }
    return c;
  }, [active]);
}
