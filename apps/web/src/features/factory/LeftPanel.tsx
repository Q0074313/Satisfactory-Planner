import { useMemo, useState } from 'react';
import { factoryOps as ops, getLanguage, localName, type BuildingCategory, type GdBuilding } from '@satis/core';
import { N_, t } from '../../i18n';
import { keyLabel } from '../../state/keymap';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore, type Tool } from '../../state/uiStore';
import { Section } from '../../ui/fields';

const CATEGORY_LABEL: Partial<Record<BuildingCategory, string>> = {
  production: N_('Produktion'),
  extraction: N_('Gewinnung'),
  logistics: N_('Logistik'),
  storage: N_('Lager'),
  power: N_('Energie'),
  rail: N_('Bahn (Frachtplattformen)'),
  other: N_('Sonstiges'),
};

function isCatalogBuilding(b: GdBuilding) {
  if (b.category === 'rail') return !!b.freightPlatform;
  return b.category in CATEGORY_LABEL && !b.conveyor && !b.pipe && b.bounds !== null;
}

const TOOLS: { tool: Tool; label: string; action?: string }[] = [
  { tool: { kind: 'select' }, label: N_('Auswahl'), action: 'factory.select' },
  { tool: { kind: 'measure' }, label: N_('Messen'), action: 'factory.measure' },
  { tool: { kind: 'area', areaKind: 'build-area' }, label: N_('Baufläche'), action: 'factory.area' },
  { tool: { kind: 'area', areaKind: 'foundation' }, label: N_('Fundament') },
  { tool: { kind: 'area', areaKind: 'clearance' }, label: N_('Planungsabstand') },
];

export function LeftPanel() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const factoryId = useUiStore((s) => s.factoryId)!;
  const floorId = useUiStore((s) => s.floorId);
  const setFloor = useUiStore((s) => s.setFloor);
  const bindings = usePrefs((s) => s.bindings);
  const lang = usePrefs((s) => s.language);
  const [query, setQuery] = useState('');
  const factory = project.factories[factoryId];
  const key = (id?: string) => (id ? keyLabel(bindings, id, lang) : '');

  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    const buildings = Object.values(gd.data.buildings).filter(isCatalogBuilding);
    const groups = new Map<string, GdBuilding[]>();
    for (const b of buildings) {
      if (q && !b.name.de.toLowerCase().includes(q) && !b.name.en.toLowerCase().includes(q)) continue;
      const k = CATEGORY_LABEL[b.category]!;
      groups.set(k, [...(groups.get(k) ?? []), b]);
    }
    for (const list of groups.values()) list.sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage()));
    const recipes =
      q.length >= 2
        ? Object.values(gd.data.recipes)
            .filter((r) => r.name.de.toLowerCase().includes(q) || r.name.en.toLowerCase().includes(q) || r.outputs.some((o) => gd.name(o.item).toLowerCase().includes(q)))
            .slice(0, 30)
        : [];
    return { groups: [...groups.entries()], recipes };
  }, [gd, query]);

  const unplaced = useMemo(() => {
    const map = new Map<string, { type: string; recipeId: string | null; ids: string[] }>();
    for (const b of Object.values(project.buildings)) {
      if (b.factoryId !== factoryId || b.placement) continue;
      const k = `${b.type}|${b.recipeId}`;
      const e = map.get(k) ?? { type: b.type, recipeId: b.recipeId, ids: [] };
      e.ids.push(b.id);
      map.set(k, e);
    }
    return [...map.values()];
  }, [project.buildings, factoryId]);

  const linkTool = (kind: 'belt' | 'pipe'): Tool => ({
    kind: 'link',
    linkKind: kind,
    tier: tool.kind === 'link' && tool.linkKind === kind ? tool.tier : ((kind === 'belt' ? gd.beltTiers[0]?.id : gd.pipeTiers[0]?.id) ?? ''),
    routing: tool.kind === 'link' ? tool.routing : 'direct',
  });
  const isActive = (tl: Tool) => tl.kind === tool.kind && (tl.kind !== 'area' || (tool.kind === 'area' && tool.areaKind === tl.areaKind));

  return (
    <aside className="panel panel-left" data-tour="left-panel">
      <Section title={t('Werkzeuge')}>
        <div className="tool-grid" data-tour="factory-tools">
          {TOOLS.map((tl) => (
            <button key={tl.label} className={isActive(tl.tool) ? 'active' : ''} onClick={() => setTool(tl.tool)} title={tl.action ? t('Taste {key}', { key: key(tl.action) }) : undefined}>
              {t(tl.label)}
              {tl.action && <kbd>{key(tl.action)}</kbd>}
            </button>
          ))}
          <button data-tour="tool-belt" className={tool.kind === 'link' && tool.linkKind === 'belt' ? 'active' : ''} onClick={() => setTool(linkTool('belt'))}>
            {t('Förderband')}
            <kbd>{key('factory.belt')}</kbd>
          </button>
          <button className={tool.kind === 'link' && tool.linkKind === 'pipe' ? 'active' : ''} onClick={() => setTool(linkTool('pipe'))}>
            {t('Rohr')}
            <kbd>{key('factory.pipe')}</kbd>
          </button>
        </div>
        {tool.kind === 'link' && (
          <label className="row">
            <span className="row-label">{t('Stufe')}</span>
            <select value={tool.tier} onChange={(e) => setTool({ ...tool, tier: e.target.value })}>
              {(tool.linkKind === 'belt' ? gd.beltTiers : gd.pipeTiers).map((b) => (
                <option key={b.id} value={b.id}>
                  {localName(b.name)} ({b.conveyor ? `${b.conveyor.itemsPerMin}/min` : `${b.pipe!.m3PerMin} m³/min`})
                </option>
              ))}
            </select>
          </label>
        )}
      </Section>

      {factory && (
        <Section
          title={t('Stockwerke')}
          actions={
            <button className="small" onClick={() => apply(t('Stockwerk hinzufügen'), (d) => ops.addFloor(d, factoryId))} title={t('Stockwerk oben hinzufügen')}>
              +
            </button>
          }
        >
          <ul className="floor-list" data-tour="floors">
            {[...factory.floorIds].reverse().map((id) => {
              const fl = project.floors[id]!;
              return (
                <li key={id} className={id === floorId ? 'active' : ''} onClick={() => setFloor(id)}>
                  <span>{fl.name}</span>
                  <span className="dim">
                    {fl.kind === 'logistics' ? `${t('Logistik')} · ` : ''}
                    {fl.elevationM.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')} m
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {unplaced.length > 0 && (
        <Section title={t('Nicht platziert')}>
          <ul className="item-list">
            {unplaced.map((u) => (
              <li
                key={`${u.type}|${u.recipeId}`}
                className={tool.kind === 'place' && tool.buildingId && u.ids.includes(tool.buildingId) ? 'active' : ''}
                onClick={() => setTool({ kind: 'place', type: u.type, buildingId: u.ids[0], recipeId: u.recipeId, rotationDeg: 0 })}
                title={t('Anklicken und im Grundriss absetzen')}
              >
                <span>{gd.name(u.type)}</span>
                <span className="dim">
                  {u.recipeId ? gd.name(u.recipeId) : t('ohne Rezept')} · {u.ids.length}×
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {Object.keys(project.groups).length > 0 && (
        <Section title={t('Gebäudegruppen')}>
          <ul className="item-list">
            {Object.values(project.groups).map((g) => {
              const instances = new Set(Object.values(project.buildings).filter((b) => b.groupInstance?.groupId === g.id).map((b) => b.groupInstance!.instanceId)).size;
              return (
                <li key={g.id} className={tool.kind === 'group' && tool.groupId === g.id ? 'active' : ''} onClick={() => setTool({ kind: 'group', groupId: g.id, rotationDeg: 0 })} title={t('Anklicken und im Grundriss einfügen')}>
                  <span>{g.name}</span>
                  <span className="dim">
                    {t('{n} Gebäude', { n: g.members.length })} · {t('{n} Instanzen', { n: instances })}
                    <button
                      className="link-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        apply(t('Gruppe löschen'), (d) => ops.removeGroup(d, g.id));
                      }}
                      title={t('Vorlage löschen (eingefügte Gebäude bleiben)')}
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title={t('Katalog')}>
        <input type="search" className="search" placeholder={t('Gebäude oder Rezept suchen …')} value={query} onChange={(e) => setQuery(e.target.value)} id="catalog-search" data-tour="catalog-search" />
        {catalog.recipes.length > 0 && (
          <div className="catalog-group">
            <h4>{t('Rezepte')}</h4>
            <ul className="item-list">
              {catalog.recipes.map((r) => (
                <li
                  key={r.id}
                  onClick={() => setTool({ kind: 'place', type: r.producedIn[0]!, recipeId: r.id, rotationDeg: 0 })}
                  className={tool.kind === 'place' && !tool.buildingId && tool.recipeId === r.id ? 'active' : ''}
                >
                  <span>
                    {localName(r.name)} {r.alternate && <span className="badge badge-info">{t('Alt')}</span>}
                  </span>
                  <span className="dim">{gd.name(r.producedIn[0]!)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {catalog.groups.map(([label, list]) => (
          <div key={label} className="catalog-group">
            <h4>{t(label)}</h4>
            <ul className="item-list">
              {list.map((b) => {
                const bb = b.bounds!;
                return (
                  <li key={b.id} className={tool.kind === 'place' && !tool.buildingId && !tool.recipeId && tool.type === b.id ? 'active' : ''} onClick={() => setTool({ kind: 'place', type: b.id, recipeId: null, rotationDeg: 0 })}>
                    <span>{localName(b.name)}</span>
                    <span className="dim">
                      {+(bb.maxX - bb.minX).toFixed(1)} × {+(bb.maxY - bb.minY).toFixed(1)} m
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Section>
    </aside>
  );
}
