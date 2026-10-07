import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber, numberLocale } from '@satis/core';
import { N_, t } from '../i18n';

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {actions}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

/** Beschriftete Zeile. `plain`: ohne <label>-Element (für Knopfgruppen, damit Knöpfe ihren eigenen Namen behalten). */
export function Row({ label, children, hint, plain }: { label: string; children: ReactNode; hint?: string; plain?: boolean }) {
  const inner = (
    <>
      <span className="row-label">{label}</span>
      <span className="row-value">{children}</span>
    </>
  );
  return plain ? (
    <div className="row" title={hint}>
      {inner}
    </div>
  ) : (
    <label className="row" title={hint}>
      {inner}
    </label>
  );
}

/** Zahlenfeld, das erst bei Enter/Verlassen übernimmt. Anzeige mit Komma. */
export function NumberField({
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  disabled,
  digits = 3,
  placeholder,
  allowEmpty,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  digits?: number;
  placeholder?: string;
  /** Leeres Feld übernimmt NaN (z. B. „Standardwert verwenden“). */
  allowEmpty?: boolean;
}) {
  const dec = numberLocale() === 'de-DE' ? ',' : '.';
  const fmt = (v: number) => (Number.isFinite(v) ? String(+v.toFixed(digits)).replace('.', dec) : '');
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (allowEmpty && text.trim() === '') {
      if (Number.isFinite(value)) onCommit(NaN);
      return;
    }
    const v = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(fmt(value));
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (c !== value) onCommit(c);
    setText(fmt(c));
  };
  return (
    <span className="number-field">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = (Number.parseFloat(text.replace(',', '.')) || 0) + (e.key === 'ArrowUp' ? step : -step);
            setText(fmt(v));
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Badge({ kind, children, title }: { kind: 'ok' | 'warn' | 'err' | 'info' | 'muted'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${kind}`} title={title}>
      {children}
    </span>
  );
}

const CONFIDENCE_LABEL = {
  'game-data': [N_('Spieldaten'), 'ok'],
  derived: [N_('abgeleitet'), 'info'],
  documented: [N_('Wiki'), 'info'],
  unverified: [N_('nicht verifiziert'), 'warn'],
} as const;

export function ConfidenceBadge({ confidence, detail }: { confidence: keyof typeof CONFIDENCE_LABEL; detail?: string }) {
  const [label, kind] = CONFIDENCE_LABEL[confidence];
  return (
    <Badge kind={kind} title={detail}>
      {t(label)}
    </Badge>
  );
}

export const fmtNum = (v: number, digits = 2) => formatNumber(v, digits);
export const fmtRate = (v: number) => `${fmtNum(v, 3)} /min`;

/** Kleine Umschaltleiste (Segmente). */
export function Segmented<T extends string>({ value, options, onChange, title }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; title?: string }) {
  return (
    <span className="segmented" title={title}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} title={o.title} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Modales Fenster. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="small" onClick={onClose} aria-label={t('Schließen')}>
            ✕
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
