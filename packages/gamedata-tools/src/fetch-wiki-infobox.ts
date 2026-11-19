/**
 * Liest Anschlusszahlen (beltInputs/…) und Maße aus den Infoboxen des
 * Satisfactory-Wikis und speichert sie in `curated/wiki-infobox.json`.
 * Die Docs-Dateien des Spiels enthalten keine Anschlussangaben.
 *
 * Aufruf: npm run gamedata:wiki -- [--data data/gamedata/<version>/gamedata.json]
 * Danach erneut `npm run gamedata:extract` ausführen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameData } from '../../core/src/gamedata/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const API = 'https://satisfactory.wiki.gg/api.php';

/** Seitentitel, die vom englischen Anzeigenamen abweichen. */
const PAGE_OVERRIDES: Record<string, string> = {
  Build_ConveyorAttachmentSplitter_C: 'Conveyor Splitter',
  Build_ConveyorAttachmentMerger_C: 'Conveyor Merger',
  Build_ConveyorAttachmentSplitterSmart_C: 'Smart Splitter',
  Build_ConveyorAttachmentSplitterProgrammable_C: 'Programmable Splitter',
  Build_ConveyorAttachmentMergerPriority_C: 'Priority Merger',
  Build_TrainDockingStationLiquid_C: 'Fluid Freight Platform',
  Build_RailroadBlockSignal_C: 'Block Signal',
  Build_RailroadPathSignal_C: 'Block Signal',
};

const RELEVANT = new Set(['production', 'extraction', 'power', 'logistics', 'storage', 'rail', 'other']);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchWikitext(page: string): Promise<{ title: string; text: string } | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SatisfactoryPlanner-gamedata-tools/0.1 (Planungswerkzeug)' } });
  if (!res.ok) return null;
  const json = (await res.json()) as { parse?: { title: string; wikitext: string } };
  return json.parse ? { title: json.parse.title, text: json.parse.wikitext } : null;
}

function infoboxes(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = /\{\{Infobox building([\s\S]*?)\}\}/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const fields: Record<string, string> = {};
    for (const part of m[1]!.split('|')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    out.push(fields);
  }
  return out;
}

async function main() {
  const dataPath = resolve(arg('data') ?? join(repoRoot, 'data/gamedata/1.2.5.1/gamedata.json'));
  const data = JSON.parse(readFileSync(dataPath, 'utf8')) as GameData;
  const entries: Record<string, unknown> = {};
  const missing: string[] = [];
  const cache = new Map<string, { title: string; text: string } | null>();

  for (const b of Object.values(data.buildings)) {
    if (!RELEVANT.has(b.category)) continue;
    if (b.conveyor || b.pipe) continue;
    const page = PAGE_OVERRIDES[b.id] ?? b.name.en;
    if (!cache.has(page)) {
      cache.set(page, await fetchWikitext(page));
      await new Promise((r) => setTimeout(r, 300));
    }
    const wt = cache.get(page);
    const descId = b.id.replace(/^Build_/, 'Desc_');
    const box = wt ? infoboxes(wt.text).find((f) => f.className === descId) : undefined;
    if (!wt || !box) {
      missing.push(`${b.id} (${page})`);
      continue;
    }
    const n = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number.parseInt(v, 10) : undefined);
    // Bereichsangaben wie "1-4" (Rohrkreuzungen) bedeuten richtungsunabhängige Anschlüsse.
    const range = (v: string | undefined) => (v !== undefined && /^\d+-(\d+)$/.exec(v)?.[1]) || undefined;
    const pipeAny = range(box.pipeInputs) ?? range(box.pipeOutputs);
    entries[descId] = {
      page: wt.title,
      url: `https://satisfactory.wiki.gg/wiki/${encodeURIComponent(wt.title.replace(/ /g, '_'))}`,
      className: descId,
      beltInputs: n(box.beltInputs),
      beltOutputs: n(box.beltOutputs),
      pipeInputs: n(box.pipeInputs),
      pipeOutputs: n(box.pipeOutputs),
      pipeAny: pipeAny ? Number.parseInt(pipeAny, 10) : undefined,
      size: { width: box.size_width, length: box.size_length, height: box.size_height },
    };
    console.log(`✓ ${b.id} ← ${wt.title}`);
  }

  writeFileSync(
    join(here, '../curated/wiki-infobox.json'),
    JSON.stringify(
      {
        $comment: 'Automatisch erzeugt durch fetch-wiki-infobox.ts. Quelle: satisfactory.wiki.gg (CC BY-NC-SA 3.0), nur Faktenangaben.',
        retrievedAt: new Date().toISOString(),
        entries,
        missing,
      },
      null,
      1,
    ),
  );
  console.log(`\n${Object.keys(entries).length} Einträge, ${missing.length} ohne Infobox:`);
  for (const m of missing) console.log('  -', m);
}

await main();
