/**
 * Migrationen des Projektformats.
 *
 * Jede Änderung am Schema, die alte Dateien unlesbar machen würde, erhöht
 * `PROJECT_FORMAT_VERSION` und ergänzt hier einen Schritt `n → n+1`. Schritte
 * arbeiten auf untypisierten Rohdaten, weil alte Formate nicht mehr dem
 * aktuellen Typ entsprechen. Die Kette wird beim Laden aus IndexedDB, beim
 * Import und auf dem Server identisch ausgeführt.
 */
import { tr } from '../i18n/index.ts';
import { clone } from '../model/clone.ts';
import { PROJECT_FORMAT_VERSION } from '../model/schema.ts';
import { ImportError } from './errors.ts';

type Raw = Record<string, unknown>;

interface MigrationStep {
  from: number;
  description: string;
  migrate(project: Raw): Raw;
}

const table = (p: Raw, key: string): Record<string, Raw> => {
  const t = p[key];
  return t && typeof t === 'object' ? (t as Record<string, Raw>) : {};
};

/** Registrierte Schritte. */
export const MIGRATIONS: MigrationStep[] = [
  {
    from: 1,
    description: 'Verlegemodus für Leitungen, Gewinnung und Frachtplattformen ergänzt; Haltedauer durch Umschlagzeit ersetzt',
    migrate(p) {
      for (const l of Object.values(table(p, 'links'))) l.routing ??= 'direct';
      for (const b of Object.values(table(p, 'buildings'))) {
        b.extraction ??= null;
        b.transfer ??= null;
      }
      for (const g of Object.values(table(p, 'groups'))) {
        for (const m of (g.members as Raw[] | undefined) ?? []) m.extraction ??= null;
        for (const l of (g.links as Raw[] | undefined) ?? []) l.routing ??= 'direct';
      }
      const settings = (p.settings ?? {}) as Raw;
      const sim = (settings.simulation ?? {}) as Raw;
      delete sim.stopDurationS;
      sim.dockingS ??= 27.08;
      settings.simulation = sim;
      p.settings = settings;
      return p;
    },
  },
  {
    from: 2,
    description: 'Fabrikstandort auf der Weltkarte und Verknüpfung von Gewinnungsgebäuden mit Vorkommen ergänzt',
    migrate(p) {
      for (const f of Object.values(table(p, 'factories'))) f.map ??= null;
      for (const b of Object.values(table(p, 'buildings'))) {
        const ex = b.extraction as Raw | null | undefined;
        if (ex) ex.nodeId ??= null;
      }
      for (const g of Object.values(table(p, 'groups'))) {
        for (const m of (g.members as Raw[] | undefined) ?? []) {
          const ex = m.extraction as Raw | null | undefined;
          if (ex) ex.nodeId ??= null;
        }
      }
      return p;
    },
  },
  {
    from: 3,
    description: 'Fabriken können als Blackbox (ohne Grundriss) geplant werden',
    migrate(p) {
      for (const f of Object.values(table(p, 'factories'))) f.blackbox ??= false;
      return p;
    },
  },
];

export function migrateProject(raw: unknown, steps: MigrationStep[] = MIGRATIONS, target = PROJECT_FORMAT_VERSION) {
  if (!raw || typeof raw !== 'object') throw new ImportError(tr('Projektdaten fehlen.'));
  let value = clone(raw) as Raw;
  const version = value.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ImportError(tr('Die Formatversion des Projekts fehlt.'));
  }
  if (version > target) {
    throw new ImportError(
      tr('Das Projekt wurde mit einer neueren Version gespeichert (Format {version}, unterstützt bis {target}). Bitte die Anwendung aktualisieren.', { version, target }),
    );
  }
  const applied: string[] = [];
  for (let v = version; v < target; v++) {
    const step = steps.find((s) => s.from === v);
    if (!step) throw new ImportError(tr('Keine Migration von Format {from} auf {to} vorhanden.', { from: v, to: v + 1 }));
    value = step.migrate(value);
    value.formatVersion = v + 1;
    applied.push(`${v} → ${v + 1}: ${tr(step.description)}`);
  }
  return { value, steps: applied };
}
