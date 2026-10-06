/**
 * Tastenbelegung: Aktionen mit Standardtasten, eigene Belegungen aus den
 * Benutzereinstellungen und Abgleich mit Tastaturereignissen.
 *
 * Tastenkombinationen werden als Text gespeichert, z. B. `Ctrl+Z`,
 * `Shift+R`, `Delete`, `PageUp`, `+`. Buchstaben stehen in Großschreibung.
 */
import { N_ } from '../i18n';

export type KeyScope = 'global' | 'factory' | 'rail';

export interface KeyAction {
  id: string;
  scope: KeyScope;
  /** Deutscher Bezeichner (wird übersetzt angezeigt). */
  label: string;
  defaults: string[];
  /** Umschalt wird beim Abgleich ignoriert (z. B. Pfeiltasten mit großem Schritt). */
  ignoreShift?: boolean;
}

export const KEY_ACTIONS: KeyAction[] = [
  // Global
  { id: 'global.undo', scope: 'global', label: N_('Rückgängig'), defaults: ['Ctrl+Z'] },
  { id: 'global.redo', scope: 'global', label: N_('Wiederholen'), defaults: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'global.save', scope: 'global', label: N_('Sofort speichern'), defaults: ['Ctrl+S'] },
  { id: 'global.export', scope: 'global', label: N_('Als JSON exportieren'), defaults: ['Ctrl+E'] },
  { id: 'global.search', scope: 'global', label: N_('Katalogsuche'), defaults: ['Ctrl+F'] },
  { id: 'global.help', scope: 'global', label: N_('Tutorial öffnen'), defaults: ['F1'] },
  { id: 'global.settings', scope: 'global', label: N_('Einstellungen'), defaults: ['Ctrl+,'] },
  { id: 'global.mode.factory', scope: 'global', label: N_('Ansicht Fabrikgrundriss'), defaults: ['Alt+1'] },
  { id: 'global.mode.production', scope: 'global', label: N_('Ansicht Produktion'), defaults: ['Alt+2'] },
  { id: 'global.mode.rail', scope: 'global', label: N_('Ansicht Schienennetz'), defaults: ['Alt+3'] },
  { id: 'global.mode.transport', scope: 'global', label: N_('Ansicht Transport'), defaults: ['Alt+4'] },
  // Fabrik
  { id: 'factory.select', scope: 'factory', label: N_('Werkzeug Auswahl'), defaults: ['V'] },
  { id: 'factory.measure', scope: 'factory', label: N_('Werkzeug Messen'), defaults: ['M'] },
  { id: 'factory.area', scope: 'factory', label: N_('Werkzeug Baufläche'), defaults: ['A'] },
  { id: 'factory.belt', scope: 'factory', label: N_('Werkzeug Förderband'), defaults: ['B'] },
  { id: 'factory.pipe', scope: 'factory', label: N_('Werkzeug Rohr'), defaults: ['P'] },
  { id: 'factory.routing', scope: 'factory', label: N_('Verlegemodus wechseln (Normal/Gerade/Kurve)'), defaults: ['N'] },
  { id: 'factory.rotate', scope: 'factory', label: N_('Drehen'), defaults: ['R'] },
  { id: 'factory.rotateBack', scope: 'factory', label: N_('Zurückdrehen'), defaults: ['Shift+R'] },
  { id: 'factory.delete', scope: 'factory', label: N_('Löschen'), defaults: ['Delete', 'Backspace'] },
  { id: 'factory.unplace', scope: 'factory', label: N_('Aufstellung aufheben'), defaults: ['U'] },
  { id: 'factory.copy', scope: 'factory', label: N_('Kopieren'), defaults: ['Ctrl+C'] },
  { id: 'factory.paste', scope: 'factory', label: N_('Einfügen'), defaults: ['Ctrl+V'] },
  { id: 'factory.duplicate', scope: 'factory', label: N_('Duplizieren'), defaults: ['Ctrl+D'] },
  { id: 'factory.selectAll', scope: 'factory', label: N_('Alles auswählen'), defaults: ['Ctrl+A'] },
  { id: 'factory.floorUp', scope: 'factory', label: N_('Stockwerk höher'), defaults: ['PageUp'] },
  { id: 'factory.floorDown', scope: 'factory', label: N_('Stockwerk tiefer'), defaults: ['PageDown'] },
  { id: 'factory.fit', scope: 'factory', label: N_('Ansicht einpassen'), defaults: ['Home'] },
  { id: 'factory.zoomIn', scope: 'factory', label: N_('Vergrößern'), defaults: ['+', '='] },
  { id: 'factory.zoomOut', scope: 'factory', label: N_('Verkleinern'), defaults: ['-'] },
  { id: 'factory.side', scope: 'factory', label: N_('Seitenansicht ein/aus'), defaults: ['Shift+S'] },
  { id: 'factory.left', scope: 'factory', label: N_('Nach links schieben'), defaults: ['ArrowLeft'], ignoreShift: true },
  { id: 'factory.right', scope: 'factory', label: N_('Nach rechts schieben'), defaults: ['ArrowRight'], ignoreShift: true },
  { id: 'factory.up', scope: 'factory', label: N_('Nach oben schieben'), defaults: ['ArrowUp'], ignoreShift: true },
  { id: 'factory.down', scope: 'factory', label: N_('Nach unten schieben'), defaults: ['ArrowDown'], ignoreShift: true },
  // Schiene
  { id: 'rail.select', scope: 'rail', label: N_('Werkzeug Auswahl'), defaults: ['V'] },
  { id: 'rail.track', scope: 'rail', label: N_('Werkzeug Gleis'), defaults: ['G'] },
  { id: 'rail.block', scope: 'rail', label: N_('Werkzeug Blocksignal'), defaults: ['B'] },
  { id: 'rail.path', scope: 'rail', label: N_('Werkzeug Pfadsignal'), defaults: ['P'] },
  { id: 'rail.station', scope: 'rail', label: N_('Werkzeug Bahnhof'), defaults: ['S'] },
  { id: 'rail.measure', scope: 'rail', label: N_('Werkzeug Messen'), defaults: ['M'] },
  { id: 'rail.rotate', scope: 'rail', label: N_('Bahnhof drehen'), defaults: ['R'] },
  { id: 'rail.rotateBack', scope: 'rail', label: N_('Bahnhof zurückdrehen'), defaults: ['Shift+R'] },
  { id: 'rail.flip', scope: 'rail', label: N_('Knotenachse umkehren'), defaults: ['F'] },
  { id: 'rail.delete', scope: 'rail', label: N_('Löschen'), defaults: ['Delete', 'Backspace'] },
  { id: 'rail.fit', scope: 'rail', label: N_('Ansicht einpassen'), defaults: ['Home'] },
  { id: 'rail.zoomIn', scope: 'rail', label: N_('Vergrößern'), defaults: ['+', '='] },
  { id: 'rail.zoomOut', scope: 'rail', label: N_('Verkleinern'), defaults: ['-'] },
  { id: 'rail.play', scope: 'rail', label: N_('Zugsimulation starten/anhalten'), defaults: ['T'] },
];

export const SCOPE_LABEL: Record<KeyScope, string> = {
  global: N_('Allgemein'),
  factory: N_('Fabrikgrundriss'),
  rail: N_('Schienennetz'),
};

const MOD_ONLY = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** Normalisierte Tastenkombination eines Ereignisses (null bei reiner Modifikatortaste). */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>, ignoreShift = false): string | null {
  if (MOD_ONLY.has(e.key)) return null;
  let key = e.key;
  if (key === ' ') key = 'Space';
  // Buchstaben/Ziffern über den physischen Code (unabhängig von Umschalt und Alt-Zeichen)
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code) && (e.altKey || e.ctrlKey)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  const printable = key.length === 1 && !/[A-Z0-9]/.test(key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Bei Satzzeichen ist Umschalt Teil des Zeichens (z. B. „+“)
  if (e.shiftKey && !printable && !ignoreShift) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export type Bindings = Record<string, string[]>;

export function resolveBindings(overrides: Bindings): Bindings {
  const out: Bindings = {};
  for (const a of KEY_ACTIONS) out[a.id] = overrides[a.id] ?? a.defaults;
  return out;
}

/** Erste passende Aktion des Bereichs (globale Aktionen separat abfragen). */
export function matchAction(e: KeyboardEvent, scope: KeyScope, bindings: Bindings): string | null {
  for (const a of KEY_ACTIONS) {
    if (a.scope !== scope) continue;
    const combo = comboOf(e, a.ignoreShift);
    if (combo && bindings[a.id]?.includes(combo)) return a.id;
  }
  return null;
}

/** Konflikte: dieselbe Kombination in demselben Bereich oder zwischen Bereich und „Allgemein“. */
export function conflicts(bindings: Bindings): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of KEY_ACTIONS)
    for (const b of KEY_ACTIONS) {
      if (a.id >= b.id) continue;
      const related = a.scope === b.scope || a.scope === 'global' || b.scope === 'global';
      if (!related) continue;
      const shared = (bindings[a.id] ?? []).filter((k) => (bindings[b.id] ?? []).includes(k));
      for (const k of shared) {
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
        out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
        void k;
      }
    }
  return out;
}

/** Anzeige einer Kombination, z. B. „Strg+Z“. */
export function formatCombo(combo: string, lang: 'de' | 'en'): string {
  const map: Record<string, [string, string]> = {
    Ctrl: ['Strg', 'Ctrl'],
    Shift: ['Umschalt', 'Shift'],
    Delete: ['Entf', 'Del'],
    Backspace: ['Rücktaste', 'Backspace'],
    PageUp: ['Bild↑', 'PgUp'],
    PageDown: ['Bild↓', 'PgDn'],
    Home: ['Pos1', 'Home'],
    Escape: ['Esc', 'Esc'],
    ArrowLeft: ['←', '←'],
    ArrowRight: ['→', '→'],
    ArrowUp: ['↑', '↑'],
    ArrowDown: ['↓', '↓'],
    Space: ['Leertaste', 'Space'],
  };
  return combo
    .split('+')
    .map((p, i, arr) => (p === '' && i === arr.length - 1 ? '+' : (map[p]?.[lang === 'de' ? 0 : 1] ?? p)))
    .filter((p, i, arr) => !(p === '' && i < arr.length - 1))
    .join('+');
}

/** Erste Belegung einer Aktion zur Anzeige (z. B. in Werkzeugknöpfen). */
export function keyLabel(bindings: Bindings, id: string, lang: 'de' | 'en'): string {
  const k = bindings[id]?.[0];
  return k ? formatCombo(k, lang) : '';
}
