import { useMemo, useState } from 'react';
import { getRule, type Finding, type Project } from '@satis/core';
import { N_, t } from '../../i18n';
import { findingInView, useActiveFindings } from '../../state/derived';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useMapStore } from '../../state/mapStore';
import { Badge, Segmented } from '../../ui/fields';

const SEVERITY = { error: [N_('Fehler'), 'err'], warning: [N_('Warnung'), 'warn'], info: [N_('Hinweis'), 'info'] } as const;
const KIND = {
  'game-rule': N_('Spielregel'),
  recommendation: N_('Empfehlung'),
  unchecked: N_('nicht geprüft'),
} as const;
const DOMAIN_LABEL: Record<Finding['domain'], string> = {
  project: N_('Projekt'),
  factory: N_('Fabrik'),
  production: N_('Produktion'),
  rail: N_('Schiene'),
  transport: N_('Transport'),
  map: N_('Karte'),
};

/** Ort eines Befunds bestimmen und Ansicht dorthin bewegen. */
export function revealFinding(f: Finding, p: Project) {
  const ui = useUiStore.getState();
  if (f.domain === 'rail') {
    const netId = f.location?.networkId ?? networkOf(f, p);
    if (ui.mode !== 'rail') ui.setMode('rail');
    if (netId && ui.networkId !== netId) ui.setNetwork(netId);
    ui.select(f.objects.filter((o) => o.table !== 'railNetworks'));
    if (f.location) ui.focusOn(f.location.x, f.location.y);
    return;
  }
  if (f.domain === 'production') {
    const plan = f.objects[0]?.table === 'productionPlans' ? p.productionPlans[f.objects[0].id] : undefined;
    if (ui.mode !== 'production') ui.setMode('production');
    if (plan && ui.factoryId !== plan.factoryId) ui.setFactory(plan.factoryId, p.factories[plan.factoryId]?.floorIds[0] ?? null);
    return;
  }
  if (f.domain === 'transport') {
    if (ui.mode !== 'transport') ui.setMode('transport');
    ui.select(f.objects.filter((o) => o.table === 'transportOrders').slice(0, 1));
    return;
  }
  // Kartenbefunde zu Fabrikstandorten auf der Karte zeigen, solche zu Gebäuden im Grundriss
  if (f.domain === 'map' && f.objects.every((o) => o.table === 'factories')) {
    if (ui.mode !== 'map') ui.setMode('map');
    const fid = f.objects[0]?.id;
    const m = fid ? p.factories[fid]?.map : null;
    if (fid) useMapStore.getState().select({ kind: 'factory', id: fid });
    if (m) useMapStore.getState().focusOn(m.x, m.y);
    return;
  }
  if (ui.mode !== 'factory') ui.setMode('factory');
  const first = f.objects[0];
  const b = first?.table === 'buildings' ? p.buildings[first.id] : first?.table === 'links' ? p.buildings[p.links[first.id]?.to.buildingId ?? ''] : undefined;
  const factoryId = f.location?.factoryId ?? b?.factoryId;
  const floorId = f.location?.floorId ?? b?.placement?.floorId;
  if (factoryId && ui.factoryId !== factoryId) ui.setFactory(factoryId, floorId ?? p.factories[factoryId]?.floorIds[0] ?? null);
  if (floorId) ui.setFloor(floorId);
  ui.select(f.objects.filter((o) => o.table !== 'factories'));
  const x = f.location?.x ?? b?.placement?.x;
  const y = f.location?.y ?? b?.placement?.y;
  if (x !== undefined && y !== undefined) ui.focusOn(x, y);
}

function networkOf(f: Finding, p: Project): string | undefined {
  for (const o of f.objects) {
    const obj = (p[o.table] as Record<string, { networkId?: string; id: string }>)[o.id];
    if (o.table === 'railNetworks') return o.id;
    if (obj?.networkId) return obj.networkId;
  }
  return undefined;
}

export function FindingsPanel() {
  const project = useProjectStore((s) => s.project)!;
  const apply = useProjectStore((s) => s.apply);
  const mode = useUiStore((s) => s.mode);
  const factoryId = useUiStore((s) => s.factoryId);
  const networkId = useUiStore((s) => s.networkId);
  const scope = useUiStore((s) => s.findingsScope);
  const setScope = useUiStore((s) => s.setFindingsScope);
  const { all } = useActiveFindings();
  const [filter, setFilter] = useState({ error: true, warning: true, info: true, ignored: false });
  const [expanded, setExpanded] = useState<string | null>(null);

  const inScope = useMemo(() => (scope === 'all' ? all : all.filter((f) => findingInView(f, project, mode, factoryId, networkId))), [all, scope, project, mode, factoryId, networkId]);
  const list = useMemo(
    () =>
      inScope.filter((f) => {
        const st = project.findingStates[f.key]?.status;
        if (st === 'ignored' && !filter.ignored) return false;
        return filter[f.severity];
      }),
    [inScope, filter, project.findingStates],
  );
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of inScope) if (project.findingStates[f.key]?.status !== 'ignored') counts[f.severity]++;

  const setState = (key: string, status: 'acknowledged' | 'ignored' | null) =>
    apply(status ? t('Befund markieren') : t('Markierung entfernen'), (d) => {
      if (status) d.findingStates[key] = { status, note: '' };
      else delete d.findingStates[key];
    });

  const viewLabel =
    mode === 'factory' ? t('dieser Fabrik') : mode === 'production' ? t('Produktionspläne dieser Fabrik') : mode === 'rail' ? t('dieses Netzes') : mode === 'map' ? t('der Karte') : t('des Transports');

  return (
    <div className="findings" data-tour="findings">
      <div className="findings-filter">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'view', label: t('Nur {what}', { what: viewLabel }) },
            { value: 'all', label: t('Alle Bereiche') },
          ]}
        />
        {(['error', 'warning', 'info'] as const).map((s) => (
          <label key={s}>
            <input type="checkbox" checked={filter[s]} onChange={() => setFilter({ ...filter, [s]: !filter[s] })} />
            <Badge kind={SEVERITY[s][1]}>
              {t(SEVERITY[s][0])} {counts[s]}
            </Badge>
          </label>
        ))}
        <label>
          <input type="checkbox" checked={filter.ignored} onChange={() => setFilter({ ...filter, ignored: !filter.ignored })} /> {t('ignorierte zeigen')}
        </label>
        <span className="spacer" />
        <button className="small" data-testid="diagnose-open" title={t('Geführte Fehlersuche, wenn etwas nicht läuft, obwohl keine Befunde angezeigt werden')} onClick={() => useUiStore.getState().setDiagnoseOpen(true)}>
          🩺 {t('Etwas stimmt nicht?')}
        </button>
      </div>
      {list.length === 0 && <p className="dim pad">{t('Keine Befunde.')}</p>}
      <ul className="finding-list">
        {list.map((f) => {
          const st = project.findingStates[f.key]?.status;
          const rule = getRule(f.ruleId);
          const open = expanded === f.key;
          return (
            <li key={f.key} className={`finding sev-${f.severity} ${st ? `st-${st}` : ''}`}>
              <div className="finding-head" onClick={() => revealFinding(f, project)}>
                <Badge kind={SEVERITY[f.severity][1]}>{t(SEVERITY[f.severity][0])}</Badge>
                {scope === 'all' && <Badge kind="muted">{t(DOMAIN_LABEL[f.domain])}</Badge>}
                <span className="finding-msg">{f.message}</span>
                <span className="finding-meta">
                  <Badge
                    kind="muted"
                    title={f.kind === 'game-rule' ? t('Durch Spielmechanik belegt') : f.kind === 'recommendation' ? t('Persönliche Planungsempfehlung') : t('Aspekt wird nicht geprüft')}
                  >
                    {t(KIND[f.kind])}
                  </Badge>
                  {f.certainty === 'dynamic' && (
                    <Badge kind="warn" title={t('Mögliches Problem, abhängig von Zuglängen, Belegung oder Abläufen – kein Nachweis')}>
                      {t('möglich')}
                    </Badge>
                  )}
                  <code>{f.ruleId}</code>
                </span>
                <button
                  className="link-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(open ? null : f.key);
                  }}
                >
                  {open ? t('weniger') : t('Details')}
                </button>
              </div>
              {open && (
                <div className="finding-body">
                  <p>{f.explanation}</p>
                  <p>
                    <strong>{t('Vorschlag')}:</strong> {f.suggestion}
                  </p>
                  {rule && (
                    <p className="dim">
                      <strong>
                        {t('Regel')} {rule.id}:
                      </strong>{' '}
                      {t(rule.title)}. {t(rule.description)}{' '}
                      {rule.sources.map((s, i) => (
                        <span key={i}>
                          {' '}
                          [
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noreferrer">
                              {t(s.label)}
                            </a>
                          ) : (
                            t(s.label)
                          )}
                          ]
                        </span>
                      ))}
                    </p>
                  )}
                  <div className="button-row">
                    {st !== 'acknowledged' && <button onClick={() => setState(f.key, 'acknowledged')}>{t('Zur Kenntnis genommen')}</button>}
                    {st !== 'ignored' && <button onClick={() => setState(f.key, 'ignored')}>{t('Ignorieren')}</button>}
                    {st && <button onClick={() => setState(f.key, null)}>{t('Markierung entfernen')}</button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
