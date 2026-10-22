/**
 * „Etwas stimmt nicht?“: erst die erweiterte Prüfung (alle Befunde der Fabrik,
 * auch Hinweise und ignorierte), dann die geführte Suche ausgehend von einem
 * Gegenstand oder einer Maschine mit Rückverfolgung des Flusses.
 */
import { useMemo, useState } from 'react';
import { cachedFactoryFlow, diagnoseItem, diagnoseMachine, getLanguage, uncheckedCauses, type DiagnosisLine, type ObjectRef, type Project } from '@satis/core';
import { t } from '../../i18n';
import { useFindings } from '../../state/derived';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, Dialog, Row, Section, Segmented } from '../../ui/fields';
import { revealFinding } from './FindingsPanel';

const ICON: Record<DiagnosisLine['level'], string> = { error: '✖', warning: '⚠', info: 'ℹ', ok: '✔' };

/** Objekte im Grundriss auswählen und anzeigen. */
function reveal(p: Project, factoryId: string, objects: ObjectRef[]) {
  const ui = useUiStore.getState();
  if (objects.length === 0) return;
  if (ui.mode !== 'factory') ui.setMode('factory');
  const first = objects[0]!;
  const b = first.table === 'buildings' ? p.buildings[first.id] : first.table === 'links' ? p.buildings[p.links[first.id]?.from.buildingId ?? ''] : undefined;
  const floorId = b?.placement?.floorId ?? null;
  if (ui.factoryId !== factoryId) ui.setFactory(factoryId, floorId ?? p.factories[factoryId]?.floorIds[0] ?? null);
  if (floorId) ui.setFloor(floorId);
  ui.select(objects);
  if (b?.placement) ui.focusOn(b.placement.x, b.placement.y);
}

export function DiagnoseDialog() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const close = () => useUiStore.getState().setDiagnoseOpen(false);
  const uiFactory = useUiStore((s) => s.factoryId);
  const selection = useUiStore((s) => s.selection);
  const [factoryId, setFactoryId] = useState(uiFactory ?? Object.keys(project.factories)[0] ?? '');
  const findings = useFindings();
  const [question, setQuestion] = useState<'machine' | 'item'>('machine');

  // Erweiterte Prüfung: alle Befunde der Fabrik und ihrer Produktionspläne, auch Hinweise und ignorierte
  const extended = useMemo(
    () =>
      findings.filter((f) => {
        if (f.domain === 'factory') {
          const o = f.objects[0];
          const fid = f.location?.factoryId ?? (o?.table === 'buildings' ? project.buildings[o.id]?.factoryId : o?.table === 'links' ? project.links[o.id]?.factoryId : o?.table === 'factories' ? o.id : undefined);
          return fid === factoryId;
        }
        if (f.domain === 'production') return f.objects.some((o) => o.table === 'productionPlans' && project.productionPlans[o.id]?.factoryId === factoryId);
        return false;
      }),
    [findings, project, factoryId],
  );
  const hidden = extended.filter((f) => f.severity === 'info' || project.findingStates[f.key]?.status === 'ignored');

  const flow = useMemo(() => (factoryId ? cachedFactoryFlow(project, gd, factoryId) : null), [project, gd, factoryId]);
  const machines = useMemo(() => {
    if (!flow) return [];
    return [...flow.machines.values()]
      .map((m) => ({ id: m.buildingId, util: m.utilization, name: project.buildings[m.buildingId]?.label || gd.name(project.buildings[m.buildingId]?.type ?? '') }))
      .sort((a, b) => a.util - b.util || a.name.localeCompare(b.name, getLanguage()));
  }, [flow, project, gd]);
  // Auffällige Gebäude: Produktionsgebäude ohne Rezept, stillstehende und nicht voll laufende Maschinen
  const noRecipe = useMemo(
    () =>
      Object.values(project.buildings)
        .filter((b) => b.factoryId === factoryId && !b.recipeId && gd.building(b.type)?.category === 'production')
        .map((b) => ({ id: b.id, name: b.label || gd.name(b.type), placed: !!b.placement })),
    [project, gd, factoryId],
  );
  const idle = machines.filter((m) => m.util < 1e-3);
  const partial = machines.filter((m) => m.util >= 1e-3 && m.util < 0.999);
  const items = useMemo(() => {
    const set = new Set<string>();
    for (const m of flow?.machines.values() ?? []) for (const x of [...m.inputs, ...m.outputs]) set.add(x.itemId);
    return [...set].sort((a, b) => gd.name(a).localeCompare(gd.name(b), getLanguage()));
  }, [flow, gd]);

  const selected = selection.find((s) => s.table === 'buildings' && flow?.machines.has(s.id))?.id;
  const [machineId, setMachineId] = useState<string>(selected ?? machines[0]?.id ?? '');
  const [itemId, setItemId] = useState<string>('');
  const lines = useMemo(() => {
    if (question === 'machine') return machineId && project.buildings[machineId] ? diagnoseMachine(project, gd, machineId) : [];
    return itemId ? diagnoseItem(project, gd, factoryId, itemId) : [];
  }, [question, machineId, itemId, project, gd, factoryId]);

  return (
    <Dialog title={t('Etwas stimmt nicht?')} onClose={close} wide>
      <Row label={t('Fabrik')}>
        <select
          value={factoryId}
          onChange={(e) => {
            setFactoryId(e.target.value);
            setMachineId('');
            setItemId('');
          }}
        >
          {Object.values(project.factories).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>

      <Section title={t('1. Erweiterte Prüfung')}>
        <p className="dim small-text">
          {t('Alle Befunde dieser Fabrik und ihrer Produktionspläne, auch Hinweise und ignorierte ({n} davon sonst leicht zu übersehen).', { n: hidden.length })}
        </p>
        {extended.length === 0 ? (
          <p className="small-text">{t('Keine Befunde.')}</p>
        ) : (
          <ul className="diagnosis" data-testid="diagnose-findings">
            {extended.map((f) => (
              <li
                key={f.key}
                className={`lvl-${f.severity}`}
                onClick={() => {
                  revealFinding(f, project);
                  close();
                }}
              >
                <Badge kind={f.severity === 'error' ? 'err' : f.severity === 'warning' ? 'warn' : 'info'}>{f.ruleId}</Badge> {f.message}
                {project.findingStates[f.key]?.status === 'ignored' && <Badge kind="muted">{t('ignoriert')}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('2. Auffällige Gebäude')}>
        {noRecipe.length + idle.length + partial.length === 0 ? (
          <p className="small-text" data-testid="diagnose-conspicuous-none">
            {machines.length > 0 ? t('Alle aufgestellten Maschinen laufen voll, und jedes Produktionsgebäude hat ein Rezept.') : t('Keine Maschinen aufgestellt.')}
          </p>
        ) : (
          <ul className="diagnosis" data-testid="diagnose-conspicuous">
            {noRecipe.map((b) => (
              <li
                key={b.id}
                className={`lvl-error ${b.placed ? 'clickable' : ''}`}
                onClick={() => {
                  if (!b.placed) return;
                  reveal(project, factoryId, [{ table: 'buildings', id: b.id }]);
                  close();
                }}
              >
                <Badge kind="err">{t('kein Rezept')}</Badge> {b.name}
                {!b.placed && <span className="dim"> · {t('nicht platziert')}</span>}
              </li>
            ))}
            {idle.map((m) => (
              <li key={m.id} className="lvl-error clickable" onClick={() => {
                  setQuestion('machine');
                  setMachineId(m.id);
                }} title={t('Ursache unten anzeigen')}>
                <Badge kind="err">{t('steht still')}</Badge> {m.name} (0 %)
              </li>
            ))}
            {partial.map((m) => (
              <li key={m.id} className="lvl-warning clickable" onClick={() => {
                  setQuestion('machine');
                  setMachineId(m.id);
                }} title={t('Ursache unten anzeigen')}>
                <Badge kind="warn">{t('läuft nicht voll')}</Badge> {m.name} ({Math.round(m.util * 100)} %)
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('3. Was stimmt nicht?')}>
        <Segmented
          value={question}
          onChange={setQuestion}
          options={[
            { value: 'machine', label: t('Maschine steht / läuft nicht voll') },
            { value: 'item', label: t('Gegenstand kommt nicht an') },
          ]}
        />
        {question === 'machine' ? (
          <Row label={t('Maschine')}>
            <select data-testid="diagnose-machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">{t('– wählen –')}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.util < 1e-3 ? `⛔ ${m.name} (${t('steht still')})` : `${m.name} (${Math.round(m.util * 100)} %)`}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <Row label={t('Gegenstand')}>
            <select data-testid="diagnose-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('– wählen –')}</option>
              {items.map((i) => (
                <option key={i} value={i}>
                  {gd.name(i)}
                </option>
              ))}
            </select>
          </Row>
        )}
        {machines.length === 0 && <p className="dim small-text">{t('In dieser Fabrik sind noch keine Maschinen aufgestellt.')}</p>}
        {lines.length > 0 && (
          <ul className="diagnosis" data-testid="diagnose-result">
            {lines.map((l, i) => (
              <li
                key={i}
                className={`lvl-${l.level} ${l.objects.length ? 'clickable' : ''}`}
                style={{ paddingLeft: 8 + l.depth * 18 }}
                title={l.objects.length ? t('Im Grundriss zeigen') : undefined}
                onClick={() => {
                  if (!l.objects.length) return;
                  reveal(project, factoryId, l.objects);
                  close();
                }}
              >
                <span className="diag-icon">{ICON[l.level]}</span> {l.text}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('4. Was der Planer nicht prüft')}>
        <p className="dim small-text">{t('Findet der Planer nichts, liegt die Ursache oft hier:')}</p>
        <ul className="small-text">
          {uncheckedCauses().map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>
    </Dialog>
  );
}
