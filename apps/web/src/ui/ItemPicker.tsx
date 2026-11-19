/**
 * Auswahl mehrerer Gegenstände: gewählte als Chips, Suche mit Trefferliste
 * und Vorschläge (z. B. aus Transportaufträgen) zum schnellen Hinzufügen.
 */
import { useMemo, useState } from 'react';
import { getLanguage, localName, type GdItem } from '@satis/core';
import { t } from '../i18n';

export function ItemPicker({
  items,
  value,
  onChange,
  suggestions = [],
  empty,
}: {
  items: GdItem[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Vorschläge mit Begründung, z. B. „Auftrag“. */
  suggestions?: { id: string; reason: string }[];
  /** Hinweis, solange nichts gewählt ist. */
  empty?: string;
}) {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selected = new Set(value);
  const q = query.trim().toLowerCase();
  const hits = q
    ? items
        .filter((i) => !selected.has(i.id) && (localName(i.name).toLowerCase().includes(q) || i.name.en.toLowerCase().includes(q)))
        .sort((a, b) => localName(a.name).localeCompare(localName(b.name), getLanguage()))
        .slice(0, 12)
    : [];
  const open = suggestions.filter((s) => !selected.has(s.id) && byId.has(s.id));
  const add = (id: string) => {
    onChange([...value, id]);
    setQuery('');
  };
  return (
    <div className="item-picker">
      <div className="chips">
        {value.length === 0 && <span className="dim small-text">{empty ?? t('Noch kein Gegenstand gewählt – an diesem Halt wird dann nichts umgeschlagen.')}</span>}
        {value.map((id) => (
          <span key={id} className="chip">
            {byId.get(id) ? localName(byId.get(id)!.name) : id}
            <button className="link-button" title={t('Entfernen')} onClick={() => onChange(value.filter((x) => x !== id))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      {open.length > 0 && (
        <div className="chips">
          {open.map((s) => (
            <button key={s.id} className="small chip-add" title={s.reason} onClick={() => add(s.id)}>
              + {localName(byId.get(s.id)!.name)}
            </button>
          ))}
        </div>
      )}
      <input
        className="search"
        type="search"
        placeholder={t('Gegenstand suchen …')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) add(hits[0].id);
        }}
      />
      {hits.length > 0 && (
        <ul className="picker-results">
          {hits.map((i) => (
            <li key={i.id} onClick={() => add(i.id)}>
              {localName(i.name)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
