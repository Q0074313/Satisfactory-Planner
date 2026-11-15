/**
 * Spielfortschritt des Projekts: Phase bzw. HUB-Tier und M.A.M.-Forschung
 * von Hand wählen (oder Stand aus einem Spielstand). Gesperrte Rezepte und
 * Gebäude erscheinen ausgegraut und werden in Produktionsplänen nicht genutzt.
 */
import { useMemo, useState } from 'react';
import { defaultProgress, localName, mamTreeName, maxTierForPhase, MAX_TIER, phaseForTier, unlockState, type GdSchematic, type Progress } from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { Badge, Row, Section } from '../../ui/fields';

const PHASES = [0, 1, 2, 3, 4];

export function ProgressSection() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const progress = project.settings.progress;
  const state = unlockState(gd, progress);
  const set = (label: string, next: Progress | null) => apply(label, (d) => void (d.settings.progress = next));
  const trees = useMemo(() => {
    const m = new Map<string, GdSchematic[]>();
    for (const s of Object.values(gd.data.schematics ?? {})) if (s.kind === 'mam' && s.tree) m.set(s.tree, [...(m.get(s.tree) ?? []), s]);
    return [...m.entries()].sort((a, b) => mamTreeName(a[0]).localeCompare(mamTreeName(b[0])));
  }, [gd]);
  const [openTree, setOpenTree] = useState<string | null>(null);

  if (!gd.data.schematics) return null;
  const phaseLabel = (ph: number) => {
    const max = maxTierForPhase(gd, ph);
    const min = ph === 0 ? 0 : maxTierForPhase(gd, ph - 1) + 1;
    return ph === 0 ? t('vor Phase 1 (Tier 0–{b})', { b: max }) : t('Phase {n} geliefert (Tier {a}–{b})', { n: ph, a: min, b: max });
  };
  const manual = progress?.source === 'manual' ? progress : null;
  const picked = new Set(manual?.schematics ?? []);
  const setTree = (list: GdSchematic[], on: boolean) => {
    if (!manual) return;
    const ids = new Set(manual.schematics);
    for (const s of list) {
      if (on) ids.add(s.id);
      else ids.delete(s.id);
    }
    set(t('M.A.M.-Forschung'), { ...manual, schematics: [...ids].sort() });
  };

  return (
    <Section title={t('Spielfortschritt')}>
      <Row label={t('Freischaltung')} hint={t('Nicht freigeschaltete Rezepte und Gebäude werden ausgegraut und in Produktionsplänen nicht verwendet.')}>
        <select
          value={progress ? 'progress' : 'all'}
          onChange={(e) => set(t('Freischaltung'), e.target.value === 'all' ? null : defaultProgress())}
          data-testid="progress-mode"
        >
          <option value="all">{t('alles frei')}</option>
          <option value="progress">{t('nach Spielfortschritt')}</option>
        </select>
      </Row>
      {progress?.source === 'save' && (
        <>
          <p className="small-text" data-testid="progress-save">
            {t('Aus dem Spielstand: bis Tier {tier}, {n} Schaltpläne gekauft', { tier: progress.maxTier, n: progress.schematics.length })}
            {progress.phase !== null && <> · {t('Phase {n} geliefert', { n: progress.phase })}</>}
          </p>
          <button className="small" onClick={() => set(t('Freischaltung'), { source: 'manual', maxTier: progress.maxTier, phase: null, schematics: progress.schematics.filter((id) => gd.data.schematics?.[id]?.kind === 'mam') })}>
            {t('von Hand anpassen')}
          </button>
        </>
      )}
      {manual && (
        <>
          <Row label={t('Phase')}>
            <select
              value={phaseForTier(gd, manual.maxTier)}
              onChange={(e) => set(t('Phase'), { ...manual, maxTier: maxTierForPhase(gd, Number(e.target.value)) })}
              data-testid="progress-phase"
            >
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>
                  {phaseLabel(ph)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('HUB-Tier bis')}>
            <select value={manual.maxTier} onChange={(e) => set(t('HUB-Tier'), { ...manual, maxTier: Number(e.target.value) })} data-testid="progress-tier">
              {Array.from({ length: MAX_TIER + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {t('Tier {n}', { n: i })}
                </option>
              ))}
            </select>
          </Row>
          <div className="small-text">
            <div className="dim">{t('M.A.M.-Forschung')}</div>
            <ul className="progress-trees">
              {trees.map(([tree, list]) => {
                const n = list.filter((s) => picked.has(s.id)).length;
                return (
                  <li key={tree}>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={n === list.length}
                        ref={(el) => {
                          if (el) el.indeterminate = n > 0 && n < list.length;
                        }}
                        onChange={(e) => setTree(list, e.target.checked)}
                        data-testid={`progress-tree-${tree}`}
                      />
                      {mamTreeName(tree)}{' '}
                      <span className="dim">
                        {n}/{list.length}
                      </span>
                    </label>
                    <button className="link-button small" onClick={() => setOpenTree(openTree === tree ? null : tree)}>
                      {openTree === tree ? t('zuklappen') : t('einzeln')}
                    </button>
                    {openTree === tree && (
                      <ul className="progress-nodes">
                        {[...list]
                          .sort((a, b) => localName(a.name).localeCompare(localName(b.name)))
                          .map((s) => (
                            <li key={s.id}>
                              <label className="check-row">
                                <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => setTree([s], e.target.checked)} />
                                {localName(s.name)}
                              </label>
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="dim small-text">{t('Alternativrezepte (Festplatten) wählst du weiter je Produktionsplan.')}</p>
        </>
      )}
      {state.active && (
        <p className="small-text" data-testid="progress-summary">
          <Badge kind="muted">{t('{r} Rezepte, {b} Gebäude gesperrt', { r: state.lockedRecipes.size, b: state.lockedBuildings.size })}</Badge>
        </p>
      )}
    </Section>
  );
}
