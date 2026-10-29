import type { LinkRouting } from '@satis/core';
import { formatM } from '../../canvas/draw';
import { N_, t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { ROUTING_ORDER, tiersOf } from '../../state/linkTool';
import { localName } from '@satis/core';
import { Segmented } from '../../ui/fields';

export const ROUTING_LABELS: Record<LinkRouting, string> = { direct: N_('Normal'), straight: N_('Gerade'), curved: N_('Kurve') };
export { ROUTING_ORDER };
const SNAP_PRESETS = [8, 4, 2, 1, 0.5, 0];

/** Werkzeugleiste über dem Editor: Ansicht, Fangraster, Verlegemodus. */
export function EditorToolbar() {
  const view = useUiStore((s) => s.factoryView);
  const setView = useUiStore((s) => s.setFactoryView);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const snap = useProjectStore((s) => s.project?.settings.snapM ?? 1);
  const gd = useProjectStore((s) => s.gd);
  const apply = useProjectStore((s) => s.apply);
  return (
    <div className="editor-toolbar" data-tour="editor-toolbar">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'plan', label: t('Grundriss') },
          { value: 'side-x', label: t('Seite (x)'), title: t('Seitenansicht: Blick von Süden, alle Stockwerke') },
          { value: 'side-y', label: t('Seite (y)'), title: t('Seitenansicht: Blick von Osten, alle Stockwerke') },
          { value: '3d', label: t('3D'), title: t('3D-Ansicht zum Ansehen (nicht bearbeiten), alle Stockwerke') },
        ]}
      />
      {view === 'plan' && (
        <label className="inline" title={t('Fangraster für Gebäude, Punkte und Verschieben. Auf Fundamenten richtet es sich nach der Fundamentecke aus. Alt gedrückt = frei.')}>
          <span className="dim small-text">{t('Raster')}</span>
          <select
            data-testid="snap-select"
            value={SNAP_PRESETS.includes(snap) ? String(snap) : 'custom'}
            onChange={(e) => apply(t('Fangweite'), (d) => void (d.settings.snapM = Number(e.target.value)))}
          >
            {SNAP_PRESETS.map((v) => (
              <option key={v} value={String(v)}>
                {v === 0 ? t('aus') : formatM(v)}
              </option>
            ))}
            {!SNAP_PRESETS.includes(snap) && <option value="custom">{formatM(snap)}</option>}
          </select>
        </label>
      )}
      {view === 'plan' && tool.kind === 'link' && (
        <Segmented
          value={tool.routing}
          onChange={(routing) => setTool({ ...tool, routing })}
          title={tool.linkKind === 'belt' ? t('Verlegemodus (Taste B erneut drücken)') : t('Verlegemodus (Taste P erneut drücken)')}
          options={ROUTING_ORDER.map((r) => ({ value: r, label: t(ROUTING_LABELS[r]) }))}
        />
      )}
      {view === 'plan' && tool.kind === 'link' && gd && (
        <Segmented
          value={tool.tier}
          onChange={(tier) => setTool({ ...tool, tier })}
          title={t('Stufe (Taste N)')}
          options={tiersOf(gd, tool.linkKind).map((x) => ({ value: x.id, label: tierShort(localName(x.name)), title: localName(x.name) }))}
        />
      )}
    </div>
  );
}

/** Kurzform einer Stufe, z. B. „Förderband Mk.3“ → „Mk.3“. */
export function tierShort(name: string): string {
  return /Mk\.?\s*\d+/i.exec(name)?.[0] ?? name;
}
