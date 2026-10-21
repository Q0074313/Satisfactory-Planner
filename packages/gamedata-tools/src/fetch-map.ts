/**
 * Lädt die Lage der Rohstoffvorkommen (Nodes, Quellen, Geysire) von der
 * interaktiven Karte auf satisfactory-calculator.com und speichert sie als
 * `data/gamedata/<version>/map.json` im Planer-Format (Meter statt Zentimeter).
 *
 * Übernommen werden nur Lage, Rohstoff und Reinheit (Fakten über die
 * Spielwelt), keine Bilder oder Texte.
 *
 * Aufruf: npm run gamedata:map -- [--version 1.2.4.0]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_SCHEMA_VERSION, type MapData, type MapNode } from '../../core/src/map/types.ts';
import type { Purity } from '../../core/src/model/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const STATIC = 'https://static.satisfactory-calculator.com/data/json';
const PAGE = 'https://satisfactory-calculator.com/en/interactive-map';

/** Spielbarer Bereich laut Kartenwerkzeug der Quelle (cm). */
const BOUNDS_CM = { west: -324698.832031, east: 425301.832031, north: -375000, south: 375000 };

const PURITY: Record<string, Purity> = { RP_Inpure: 'impure', RP_Normal: 'normal', RP_Pure: 'pure' };
/** Abweichende Typnamen der Quelle → Gegenstand im Spieldatensatz. */
const ITEM_ALIAS: Record<string, string> = { Desc_LiquidOilWell_C: 'Desc_LiquidOil_C' };

interface Marker {
  pathName: string;
  x: number;
  y: number;
  z: number;
  type?: string;
  purity?: string;
  core?: string;
  obstructed?: boolean;
}
interface Layer {
  layerId: string;
  purity?: string;
  markers: Marker[];
}
interface Group {
  type?: string;
  options: Layer[];
}
interface Tab {
  tabId: string;
  options: Group[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const shortId = (pathName: string) => pathName.replace(/^.*PersistentLevel\./, '');
const m = (cm: number) => Math.round(cm) / 100;

async function main() {
  const gameVersion = arg('version') ?? '1.2.4.0';
  const headers = { 'User-Agent': 'SatisPlanner-gamedata-tools/0.1 (Planungswerkzeug)' };
  const version = (await (await fetch(`${STATIC}/lastVersion-Stable`, { headers })).text()).trim();
  const url = `${STATIC}/mapData/en-Stable.json?v=${version}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Abruf fehlgeschlagen: ${res.status} ${url}`);
  const text = await res.text();
  const raw = JSON.parse(text) as { options: Tab[]; version: number; lastBuild: string };

  const nodes: MapNode[] = [];
  const cores = new Map<string, { item: string; pts: Marker[] }>();
  const counts: Record<string, number> = {};
  for (const tab of raw.options) {
    if (tab.tabId !== 'resource_nodes' && tab.tabId !== 'resource_wells') continue;
    for (const group of tab.options) {
      for (const layer of group.options) {
        for (const mk of layer.markers) {
          const purity = PURITY[mk.purity ?? layer.purity ?? ''];
          if (!purity) continue;
          const isGeyser = group.type === 'Desc_Geyser_C';
          const type = mk.type ?? group.type ?? '';
          const itemId = isGeyser ? null : (ITEM_ALIAS[type] ?? type);
          const kind: MapNode['kind'] = isGeyser ? 'geyser' : mk.core ? 'well' : 'node';
          const node: MapNode = { id: shortId(mk.pathName), kind, itemId, purity, x: m(mk.x), y: m(mk.y), z: m(mk.z) };
          if (mk.core) {
            node.coreId = shortId(mk.core);
            const c = cores.get(node.coreId) ?? { item: itemId!, pts: [] };
            c.pts.push(mk);
            cores.set(node.coreId, c);
          }
          if (mk.obstructed) node.obstructed = true;
          nodes.push(node);
          const key = `${kind}:${itemId ?? 'geyser'}:${purity}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }
  }
  // Quellenmitte: Mittelpunkt der Satelliten (Lage der Mitte liefert die Quelle nicht)
  for (const [id, c] of cores) {
    const avg = (k: 'x' | 'y' | 'z') => c.pts.reduce((s, p) => s + p[k], 0) / c.pts.length;
    nodes.push({ id, kind: 'well-core', itemId: c.item, purity: null, x: m(avg('x')), y: m(avg('y')), z: m(avg('z')) });
  }
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`Doppelte ID ${n.id}`);
    ids.add(n.id);
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const data: MapData = {
    schemaVersion: MAP_SCHEMA_VERSION,
    meta: {
      source: 'Satisfactory Calculator – Interactive Map (satisfactory-calculator.com)',
      url: PAGE,
      retrievedAt: new Date().toISOString(),
      sourceVersion: String(raw.version),
      sourceBuild: String(raw.lastBuild),
      license:
        'Kein ausdrücklicher Lizenztext. Übernommen werden nur Lage, Rohstoff und Reinheit der Vorkommen (Fakten über die Spielwelt), keine Bilder oder Texte.',
      notes: [
        `SHA-256 der Rohdaten: ${createHash('sha256').update(text).digest('hex')}`,
        'Koordinaten in Metern (Spiel: Zentimeter), auf 1 cm gerundet; x nach Osten, y nach Süden, z nach oben.',
        'Quellenmitten (well-core) sind aus den Satelliten gemittelt, die Quelle nennt ihre Lage nicht.',
        `Anzahl je Art: ${Object.entries(counts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}, Quellenmitten=${cores.size}`,
      ],
    },
    world: { west: m(BOUNDS_CM.west), east: m(BOUNDS_CM.east), north: m(BOUNDS_CM.north), south: m(BOUNDS_CM.south) },
    nodes,
  };
  const out = join(repoRoot, 'data/gamedata', gameVersion, 'map.json');
  writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
  console.log(`${nodes.length} Einträge → ${out}`);
  console.log(data.meta.notes.at(-1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
