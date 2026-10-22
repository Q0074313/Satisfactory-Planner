/**
 * Import/Export als versioniertes JSON.
 *
 * Dateiaufbau:
 * {
 *   "kind": "satis-planner-project",
 *   "formatVersion": 1,
 *   "exportedAt": "…",
 *   "app": "satis-planner 0.1.0",
 *   "project": { … }
 * }
 */
import { tr } from '../i18n/index.ts';
import { PROJECT_FORMAT_VERSION, ProjectSchema, type Project } from '../model/schema.ts';
import { ImportError } from './errors.ts';
import { migrateProject } from './migrations.ts';

export { ImportError };

export const FILE_KIND = 'satis-planner-project';
export const APP_VERSION = 'satis-planner 0.7.1';

export interface ProjectFile {
  kind: typeof FILE_KIND;
  formatVersion: number;
  exportedAt: string;
  app: string;
  project: Project;
}

export function exportProject(project: Project, now = new Date()): string {
  const file: ProjectFile = {
    kind: FILE_KIND,
    formatVersion: PROJECT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    app: APP_VERSION,
    project,
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  project: Project;
  /** Ausgeführte Migrationsschritte, z. B. ["1 → 2: …"]. */
  migrations: string[];
  /** Referenzfehler, die beim Import automatisch bereinigt wurden. */
  repairs: string[];
}

/**
 * Liest eine Projektdatei (oder ein rohes Projektobjekt), migriert sie auf das
 * aktuelle Format, prüft das Schema und die Referenzen.
 */
export function importProject(input: string | unknown): ImportResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new ImportError(tr('Die Datei ist kein gültiges JSON.'), [(e as Error).message]);
    }
  }
  if (!raw || typeof raw !== 'object') throw new ImportError(tr('Die Datei enthält kein Projekt.'));
  const obj = raw as Record<string, unknown>;
  let projectRaw: unknown = obj;
  if (obj.kind !== undefined) {
    if (obj.kind !== FILE_KIND) throw new ImportError(tr('Unbekannter Dateityp „{kind}“.', { kind: String(obj.kind) }));
    projectRaw = obj.project;
  }
  const { value: migrated, steps } = migrateProject(projectRaw);
  const parsed = ProjectSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new ImportError(
      tr('Das Projekt entspricht nicht dem erwarteten Format.'),
      parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`),
    );
  }
  const repairs = repairReferences(parsed.data);
  return { project: parsed.data, migrations: steps, repairs };
}

/**
 * Entfernt Objekte mit ungültigen Verweisen, damit das Projekt in sich
 * konsistent ist. Liefert eine Liste der Korrekturen.
 */
export function repairReferences(p: Project): string[] {
  const out: string[] = [];
  for (const f of Object.values(p.factories)) {
    const valid = f.floorIds.filter((id) => p.floors[id]?.factoryId === f.id);
    if (valid.length !== f.floorIds.length) {
      out.push(tr('Fabrik {name}: ungültige Stockwerksverweise entfernt.', { name: f.name }));
      f.floorIds = valid;
    }
  }
  for (const fl of Object.values(p.floors)) {
    if (!p.factories[fl.factoryId]) {
      delete p.floors[fl.id];
      out.push(tr('Stockwerk {name} ohne Fabrik entfernt.', { name: fl.name }));
    } else if (!p.factories[fl.factoryId]!.floorIds.includes(fl.id)) {
      p.factories[fl.factoryId]!.floorIds.push(fl.id);
      out.push(tr('Stockwerk {name} der Fabrik zugeordnet.', { name: fl.name }));
    }
  }
  for (const a of Object.values(p.areas)) {
    if (!p.factories[a.factoryId] || !p.floors[a.floorId]) {
      delete p.areas[a.id];
      out.push(tr('Fläche {name} ohne Fabrik/Stockwerk entfernt.', { name: a.name }));
    }
  }
  for (const b of Object.values(p.buildings)) {
    if (!p.factories[b.factoryId]) {
      delete p.buildings[b.id];
      out.push(tr('Gebäude {id} ohne Fabrik entfernt.', { id: b.id }));
    } else if (b.placement && !p.floors[b.placement.floorId]) {
      b.placement = null;
      out.push(tr('Gebäude {id}: Stockwerk fehlt, Platzierung aufgehoben.', { id: b.id }));
    }
  }
  for (const l of Object.values(p.links)) {
    if (!p.buildings[l.from.buildingId] || !p.buildings[l.to.buildingId]) {
      delete p.links[l.id];
      out.push(tr('Verbindung {id} mit fehlendem Gebäude entfernt.', { id: l.id }));
    }
  }
  for (const pl of Object.values(p.productionPlans)) {
    if (!p.factories[pl.factoryId]) {
      delete p.productionPlans[pl.id];
      out.push(tr('Produktionsplan {name} ohne Fabrik entfernt.', { name: pl.name }));
    }
  }
  for (const n of Object.values(p.railNodes)) {
    if (!p.railNetworks[n.networkId]) {
      delete p.railNodes[n.id];
      out.push(tr('Gleisknoten {id} ohne Netz entfernt.', { id: n.id }));
    }
  }
  for (const s of Object.values(p.railSegments)) {
    if (!p.railNodes[s.a.nodeId] || !p.railNodes[s.b.nodeId] || !p.railNetworks[s.networkId]) {
      delete p.railSegments[s.id];
      out.push(tr('Gleissegment {id} mit fehlendem Knoten entfernt.', { id: s.id }));
    }
  }
  for (const s of Object.values(p.railSignals)) {
    if (!p.railNodes[s.nodeId]) {
      delete p.railSignals[s.id];
      out.push(tr('Signal {id} ohne Knoten entfernt.', { id: s.id }));
    }
  }
  for (const st of Object.values(p.stations)) {
    if (!p.railSegments[st.segmentId] || !p.railNodes[st.backNodeId] || !p.railNodes[st.frontNodeId]) {
      delete p.stations[st.id];
      out.push(tr('Bahnhof {name} ohne Gleis entfernt.', { name: st.name }));
    } else if (st.factoryId && !p.factories[st.factoryId]) {
      st.factoryId = null;
      out.push(tr('Bahnhof {name}: Fabrikzuordnung entfernt (Fabrik fehlt).', { name: st.name }));
    }
  }
  for (const s of Object.values(p.railSegments)) {
    if (s.stationId && !p.stations[s.stationId]) s.stationId = null;
  }
  for (const t of Object.values(p.timetables)) {
    const before = t.stops.length;
    t.stops = t.stops.filter((s) => p.stations[s.stationId]);
    if (t.stops.length !== before) out.push(tr('Fahrplan {name}: Halte mit fehlendem Bahnhof entfernt.', { name: t.name }));
  }
  for (const t of Object.values(p.trains)) {
    if (t.timetableId && !p.timetables[t.timetableId]) {
      t.timetableId = null;
      out.push(tr('Zug {name}: fehlender Fahrplan entfernt.', { name: t.name }));
    }
  }
  for (const o of Object.values(p.transportOrders)) {
    if (!p.factories[o.fromFactoryId] || !p.factories[o.toFactoryId]) {
      delete p.transportOrders[o.id];
      out.push(tr('Transportauftrag {name} mit fehlender Fabrik entfernt.', { name: o.name }));
      continue;
    }
    if (o.fromStationId && !p.stations[o.fromStationId]) o.fromStationId = null;
    if (o.toStationId && !p.stations[o.toStationId]) o.toStationId = null;
    o.trainIds = o.trainIds.filter((id) => p.trains[id]);
    if (o.direct?.from && !p.buildings[o.direct.from.buildingId]?.placement) o.direct.from = null;
    if (o.direct?.to && !p.buildings[o.direct.to.buildingId]?.placement) o.direct.to = null;
  }
  return out;
}
