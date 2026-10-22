/**
 * „Rezepte nachschlagen“: alle Rezepte eines Gegenstands (Standard und
 * Alternativen) mit Ein- und Ausgängen je Maschine, Strom und den Kosten für
 * 60/min im Vergleich. Gegenstände lassen sich anklicken (Vorprodukte, Verwendung).
 */
import { useId, useMemo, useState } from 'react';
import { getLanguage, localName, recipesFor, type RecipeInfo } from '@satis/core';
import { t } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Badge, Dialog, fmtNum } from '../../ui/fields';

export function RecipeBook() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const req = useUiStore((s) => s.recipeBook)!;
  const close = () => useUiStore.getState().closeRecipeBook();
  const [history, setHistory] = useState<string[]>(req.itemId ? [req.itemId] : []);
  const itemId = history.at(-1) ?? null;
  const open = (id: string) => setHistory((h) => (h.at(-1) === id ? h : [...h, id]));
  const listId = useId();
  const [text, setText] = useState('');
  const items = useMemo(
    () =>
      Object.values(gd.data.items)
        .filter((i) => gd.recipesProducing(i.id).length > 0 || gd.recipesConsuming(i.id).length > 0)
        .sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage())),
    [gd],
  );
  const commit = (v: string) => {
    const q = v.trim().toLowerCase();
    const hit = items.find((i) => i.name.de.toLowerCase() === q || i.name.en.toLowerCase() === q);
    if (hit) {
      open(hit.id);
      setText('');
    }
  };
  const infos = useMemo(() => (itemId ? recipesFor(gd, itemId) : []), [gd, itemId]);
  const used = useMemo(() => {
    const set = new Set<string>();
    for (const b of Object.values(project.buildings)) if (b.recipeId) set.add(b.recipeId);
    for (const p of Object.values(project.productionPlans)) for (const r of p.enabledAlternates) set.add(r);
    return set;
  }, [project]);
  const consumers = useMemo(() => (itemId ? gd.recipesConsuming(itemId).filter((r) => !r.generator) : []), [gd, itemId]);
  const standard = infos.filter((x) => !x.recipe.alternate && x.cost).reduce<number | null>((m, x) => (m === null ? x.cost!.weighted : Math.min(m, x.cost!.weighted)), null);
  const unit = (id: string) => (gd.item(id)?.form === 'solid' ? '/min' : 'm³/min');
  const rateList = (rows: { itemId: string; perMin: number }[], highlight?: string) => (
    <span className="rb-rates">
      {rows.map((r) => (
        <button key={r.itemId} className={`link-button small ${r.itemId === highlight ? 'strong' : ''}`} onClick={() => open(r.itemId)} title={t('Rezepte für {item}', { item: gd.name(r.itemId) })}>
          {fmtNum(r.perMin, 2)} {unit(r.itemId)} {gd.name(r.itemId)}
        </button>
      ))}
    </span>
  );

  return (
    <Dialog title={t('Rezepte nachschlagen')} onClose={close} xwide>
      <div className="inline pad-x">
        {history.length > 1 && (
          <button className="small" onClick={() => setHistory((h) => h.slice(0, -1))} title={t('Zurück')}>
            ←
          </button>
        )}
        <input
          list={listId}
          data-testid="rb-search"
          value={text}
          placeholder={t('Gegenstand suchen …')}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        />
        <datalist id={listId}>
          {items.map((i) => (
            <option key={i.id} value={localName(i.name)} />
          ))}
        </datalist>
        {itemId && <h3 className="rb-title">{gd.name(itemId)}</h3>}
      </div>
      {!itemId ? (
        <p className="dim pad">{t('Einen Gegenstand suchen, um alle Rezepte dafür zu vergleichen.')}</p>
      ) : (
        <>
          {infos.length === 0 ? (
            <p className="pad">{gd.item(itemId)?.isResource ? t('Rohstoff: wird gefördert, nicht hergestellt.') : t('Kein Rezept stellt diesen Gegenstand her.')}</p>
          ) : (
            <div className="scroll-x">
              <table className="table rb-table" data-testid="rb-table">
                <thead>
                  <tr>
                    <th>{t('Rezept')}</th>
                    <th>{t('Gebäude')}</th>
                    <th>{t('Eingänge je Maschine')}</th>
                    <th>{t('Ausgänge je Maschine')}</th>
                    <th className="num">{t('Strom')}</th>
                    <th>{t('Für 60/min: Rohstoffe')}</th>
                    <th className="num">{t('Maschinen')}</th>
                    <th className="num" title={t('Gewichteter Rohstoffbedarf im Verhältnis zum besten Standardrezept (weniger ist besser)')}>
                      {t('Rohstoffe vs. Standard')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {infos.map((x: RecipeInfo) => (
                    <tr key={x.recipe.id} data-testid="rb-row">
                      <td>
                        {localName(x.recipe.name)} {x.recipe.alternate && <Badge kind="info">{t('Alt')}</Badge>}{' '}
                        {used.has(x.recipe.id) && <Badge kind="ok">{t('im Projekt')}</Badge>}
                        <div className="dim small-text">{t('{s} s je Zyklus', { s: fmtNum(x.recipe.durationS, 2) })}</div>
                      </td>
                      <td>{gd.name(x.building)}</td>
                      <td>{rateList(x.inputs)}</td>
                      <td>{rateList(x.outputs, itemId)}</td>
                      <td className="num">{fmtNum(x.powerMW, 1)} MW</td>
                      <td>
                        {x.cost ? (
                          <>
                            {rateList(x.cost.resources)}
                            {x.cost.byproducts.length > 0 && (
                              <div className="dim small-text">
                                {t('Nebenprodukte:')} {x.cost.byproducts.map((b) => `${fmtNum(b.perMin, 1)} ${gd.name(b.itemId)}`).join(', ')}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="dim">{t('nicht berechenbar')}</span>
                        )}
                      </td>
                      <td className="num">{x.cost ? `${fmtNum(x.cost.machines, 1)} · ${fmtNum(x.cost.powerMW, 0)} MW` : '–'}</td>
                      <td className="num">
                        {x.cost && standard && standard > 0 ? (
                          <Badge kind={x.cost.weighted < standard - 1e-6 ? 'ok' : x.cost.weighted > standard + 1e-6 ? 'warn' : 'muted'}>{fmtNum((x.cost.weighted / standard) * 100, 0)} %</Badge>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {consumers.length > 0 && (
            <div className="pad-x small-text rb-used">
              <strong>{t('Wird verwendet in:')}</strong>{' '}
              {consumers.map((r) => (
                <button key={r.id} className="link-button small" onClick={() => open(r.outputs[0]!.item)} title={t('Rezepte für {item}', { item: gd.name(r.outputs[0]!.item) })}>
                  {localName(r.name)}
                  {r.alternate ? ` (${t('Alt')})` : ''}
                </button>
              ))}
            </div>
          )}
          <p className="dim small-text pad-x">
            {t(
              'Kosten: 60/min des Gegenstands nur mit diesem Rezept, Vorprodukte mit Standardrezepten, Maschinen bei 100 % Takt (Summe der Maschinenäquivalente). Wie ein Rezept freigeschaltet wird (Festplatte, M.A.M., Meilenstein), steht nicht in den Spieldaten des Planers.',
            )}
          </p>
        </>
      )}
    </Dialog>
  );
}
