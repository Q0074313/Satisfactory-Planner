/**
 * Extrahiert die Spieldaten aus den offiziellen Docs-Dateien einer lokalen
 * Satisfactory-Installation und schreibt sie als normalisiertes JSON nach
 * `data/gamedata/<Spielversion>/`.
 *
 * Aufruf:
 *   npm run gamedata:extract -- [--game <Pfad zur Installation>] [--out <Verzeichnis>]
 *
 * Standardpfad: ~/.steam/steam/steamapps/common/Satisfactory
 * Alternativ per Umgebungsvariable SATISFACTORY_DIR.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BuildingCategory,
  GameData,
  GdAmount,
  GdBounds,
  GdBuilding,
  GdClearanceBox,
  GdFact,
  GdItem,
  GdPortCounts,
  GdRecipe,
  GdVehicle,
  ItemForm,
  SourceRef,
  GdVec3 as Vec3,
} from '../../core/src/gamedata/types.ts';
import { GAMEDATA_SCHEMA_VERSION } from '../../core/src/gamedata/types.ts';
import { asList, asStruct, classNameFromPath, num, parseUe, type UeValue } from './ue-parse.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

type DocsClass = { ClassName: string; [field: string]: string | undefined };
type DocsGroups = Map<string, DocsClass[]>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readUtf16Json(path: string): unknown {
  const buf = readFileSync(path);
  // Die Docs-Dateien sind UTF-16LE mit BOM.
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  return JSON.parse(text);
}

function loadDocs(path: string): DocsGroups {
  const raw = readUtf16Json(path) as { NativeClass: string; Classes: DocsClass[] }[];
  const groups: DocsGroups = new Map();
  for (const g of raw) {
    const m = /\.(\w+)'?$/.exec(g.NativeClass);
    const key = m?.[1] ?? g.NativeClass;
    groups.set(key, [...(groups.get(key) ?? []), ...g.Classes]);
  }
  return groups;
}

function displayNames(groups: DocsGroups): Map<string, string> {
  const map = new Map<string, string>();
  for (const classes of groups.values()) {
    for (const c of classes) if (c.mDisplayName) map.set(c.ClassName, c.mDisplayName);
  }
  return map;
}

const FORM: Record<string, ItemForm | undefined> = {
  RF_SOLID: 'solid',
  RF_LIQUID: 'liquid',
  RF_GAS: 'gas',
};

const ITEM_GROUPS = [
  'FGResourceDescriptor',
  'FGItemDescriptor',
  'FGItemDescriptorBiomass',
  'FGItemDescriptorNuclearFuel',
  'FGItemDescriptorPowerBoosterFuel',
  'FGPowerShardDescriptor',
  'FGConsumableDescriptor',
  'FGEquipmentDescriptor',
  'FGAmmoTypeProjectile',
  'FGAmmoTypeSpreadshot',
  'FGAmmoTypeInstantHit',
];

const BUILDING_GROUPS: Record<string, BuildingCategory> = {
  FGBuildableManufacturer: 'production',
  FGBuildableManufacturerVariablePower: 'production',
  FGBuildableResourceExtractor: 'extraction',
  FGBuildableWaterPump: 'extraction',
  FGBuildableFrackingExtractor: 'extraction',
  FGBuildableFrackingActivator: 'extraction',
  FGBuildableGeneratorFuel: 'power',
  FGBuildableGeneratorNuclear: 'power',
  FGBuildableGeneratorGeoThermal: 'power',
  FGBuildablePowerStorage: 'power',
  FGBuildableConveyorBelt: 'logistics',
  FGBuildableConveyorLift: 'logistics',
  FGBuildableAttachmentSplitter: 'logistics',
  FGBuildableAttachmentMerger: 'logistics',
  FGBuildableSplitterSmart: 'logistics',
  FGBuildableMergerPriority: 'logistics',
  FGBuildablePipeline: 'logistics',
  FGBuildablePipelineJunction: 'logistics',
  FGBuildablePipelinePump: 'logistics',
  FGBuildableStorage: 'storage',
  FGBuildablePipeReservoir: 'storage',
  FGCentralStorageContainer: 'storage',
  FGBuildableRailroadTrack: 'rail',
  FGBuildableRailroadStation: 'rail',
  FGBuildableTrainPlatformCargo: 'rail',
  FGBuildableTrainPlatformEmpty: 'rail',
  FGBuildableRailroadSignal: 'rail',
  FGBuildableFoundationLightweight: 'foundation',
  FGBuildableResourceSink: 'other',
  FGBuildableSpaceElevator: 'other',
  FGBuildableRadarTower: 'other',
  FGBuildableDroneStation: 'other',
  FGBuildableDockingStation: 'other',
  FGBuildableBlueprintDesigner: 'other',
};

const EMPTY_PORTS: GdPortCounts = { beltIn: 0, beltOut: 0, pipeIn: 0, pipeOut: 0, pipeAny: 0 };

const cm = (v: number) => Math.round(v) / 100;

function vec(v: UeValue | undefined): Vec3 {
  const s = asStruct(v);
  return { x: cm(num(s.X) || 0), y: cm(num(s.Y) || 0), z: cm(num(s.Z) || 0) };
}

function parseClearance(raw: string | undefined): GdClearanceBox[] {
  if (!raw) return [];
  const boxes: GdClearanceBox[] = [];
  for (const entry of asList(parseUe(raw))) {
    const e = asStruct(entry);
    const box = asStruct(e.ClearanceBox);
    if (box.IsValid !== 'True') continue;
    const transform = asStruct(e.RelativeTransform);
    const rot = asStruct(transform.Rotation);
    const result: GdClearanceBox = {
      min: vec(box.Min),
      max: vec(box.Max),
      translation: vec(transform.Translation),
      soft: e.Type === 'CT_Soft',
    };
    if (transform.Rotation !== undefined) {
      result.rotation = [num(rot.X) || 0, num(rot.Y) || 0, num(rot.Z) || 0, num(rot.W) || 1];
    }
    boxes.push(result);
  }
  return boxes;
}

function rotate(p: Vec3, q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  // v' = q · v · q⁻¹
  const ix = w * p.x + y * p.z - z * p.y;
  const iy = w * p.y + z * p.x - x * p.z;
  const iz = w * p.z + x * p.y - y * p.x;
  const iw = -x * p.x - y * p.y - z * p.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

function boundsOf(boxes: GdClearanceBox[]): GdBounds | null {
  const hard = boxes.filter((b) => !b.soft);
  const use = hard.length > 0 ? hard : boxes;
  if (use.length === 0) return null;
  const b: GdBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const box of use) {
    for (const cx of [box.min.x, box.max.x])
      for (const cy of [box.min.y, box.max.y])
        for (const cz of [box.min.z, box.max.z]) {
          let p: Vec3 = { x: cx, y: cy, z: cz };
          if (box.rotation) p = rotate(p, box.rotation);
          p = { x: p.x + box.translation.x, y: p.y + box.translation.y, z: p.z + box.translation.z };
          b.minX = Math.min(b.minX, p.x);
          b.maxX = Math.max(b.maxX, p.x);
          b.minY = Math.min(b.minY, p.y);
          b.maxY = Math.max(b.maxY, p.y);
          b.minZ = Math.min(b.minZ, p.z);
          b.maxZ = Math.max(b.maxZ, p.z);
        }
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return { minX: r(b.minX), maxX: r(b.maxX), minY: r(b.minY), maxY: r(b.maxY), minZ: r(b.minZ), maxZ: r(b.maxZ) };
}

function parseAmounts(raw: string | undefined, items: Map<string, GdItem>): GdAmount[] | null {
  const out: GdAmount[] = [];
  for (const entry of asList(parseUe(raw ?? ''))) {
    const e = asStruct(entry);
    const id = classNameFromPath(String(e.ItemClass ?? ''));
    const item = items.get(id);
    if (!item) return null;
    const amount = num(e.Amount);
    // Flüssigkeiten und Gase sind in den Docs in Litern angegeben → m³.
    out.push({ item: id, amount: item.form === 'solid' ? amount : amount / 1000 });
  }
  return out;
}

interface WikiInfobox {
  page: string;
  url: string;
  className: string;
  beltInputs?: number;
  beltOutputs?: number;
  pipeInputs?: number;
  pipeOutputs?: number;
  pipeAny?: number;
  size?: { width?: string; length?: string; height?: string };
}

function main() {
  const gameDir = resolve(arg('game') ?? process.env.SATISFACTORY_DIR ?? join(homedir(), '.steam/steam/steamapps/common/Satisfactory'));
  const docsDir = join(gameDir, 'CommunityResources/Docs');
  if (!existsSync(join(docsDir, 'en-US.json'))) {
    console.error(`Docs nicht gefunden: ${docsDir}\nBitte --game <Pfad zur Satisfactory-Installation> angeben.`);
    process.exit(1);
  }
  const versionFile = join(gameDir, 'Engine/Binaries/Win64/FactoryGameSteam-Win64-Shipping.version');
  const versionInfo = existsSync(versionFile)
    ? (JSON.parse(readFileSync(versionFile, 'utf8')) as { GameVersion?: string; Changelist?: number; BranchName?: string })
    : {};
  const gameVersion = arg('version') ?? versionInfo.GameVersion;
  if (!gameVersion) {
    console.error('Spielversion unbekannt. Bitte --version angeben.');
    process.exit(1);
  }

  const enRaw = readFileSync(join(docsDir, 'en-US.json'));
  const docsHash = createHash('sha256').update(enRaw).digest('hex');
  const en = loadDocs(join(docsDir, 'en-US.json'));
  const deNames = displayNames(loadDocs(join(docsDir, 'de.json')));
  const name = (c: DocsClass) => ({ en: c.mDisplayName ?? c.ClassName, de: deNames.get(c.ClassName) ?? c.mDisplayName ?? c.ClassName });
  const report: string[] = [];

  // ---------- Gegenstände ----------
  const allItems = new Map<string, GdItem>();
  for (const group of ITEM_GROUPS) {
    for (const c of en.get(group) ?? []) {
      const form = FORM[c.mForm ?? ''];
      if (!form) continue;
      allItems.set(c.ClassName, {
        id: c.ClassName,
        name: name(c),
        form,
        stackSize: Number.parseInt(c.mCachedStackSize ?? '0', 10),
        sinkPoints: c.mResourceSinkPoints !== undefined ? Number.parseInt(c.mResourceSinkPoints, 10) : null,
        energyMJ: num(c.mEnergyValue) || 0,
        isResource: group === 'FGResourceDescriptor',
      });
    }
  }

  // ---------- Gebäude ----------
  const buildings: Record<string, GdBuilding> = {};
  const wikiPath = join(here, '../curated/wiki-infobox.json');
  const wiki: Record<string, WikiInfobox> = existsSync(wikiPath)
    ? (JSON.parse(readFileSync(wikiPath, 'utf8')) as { entries: Record<string, WikiInfobox> }).entries
    : {};

  const portOverrides = (
    JSON.parse(readFileSync(join(here, '../curated/ports-overrides.json'), 'utf8')) as {
      overrides: Record<string, { ports: Partial<GdPortCounts>; sourceRef: SourceRef }>;
    }
  ).overrides;

  for (const [group, category] of Object.entries(BUILDING_GROUPS)) {
    for (const c of en.get(group) ?? []) {
      if (!c.ClassName.startsWith('Build_')) continue;
      const clearance = parseClearance(c.mClearanceData);
      const bounds = boundsOf(clearance);
      const b: GdBuilding = {
        id: c.ClassName,
        name: name(c),
        nativeClass: group,
        category,
        powerConsumptionMW: num(c.mPowerConsumption) || 0,
        clearance,
        bounds,
        boundsSource: bounds ? { source: 'docs', detail: 'mClearanceData', confidence: 'game-data' } : null,
        ports: null,
        portsSource: null,
      };
      if (c.mPowerProduction !== undefined) b.powerProductionMW = num(c.mPowerProduction);
      if (c.mPowerConsumptionExponent !== undefined) b.powerExponent = num(c.mPowerConsumptionExponent);
      if (c.mProductionBoostPowerConsumptionExponent !== undefined)
        b.boostPowerExponent = num(c.mProductionBoostPowerConsumptionExponent);
      if (group === 'FGBuildableManufacturerVariablePower') b.variablePower = true;
      if (c.mManufacturingSpeed !== undefined) b.manufacturingSpeed = num(c.mManufacturingSpeed);
      if (c.mMinPotential !== undefined && c.mCanChangePotential === 'True')
        b.clock = { min: num(c.mMinPotential), max: num(c.mMaxPotential) };
      if (c.mProductionShardSlotSize !== undefined && Number.parseInt(c.mProductionShardSlotSize, 10) > 0)
        b.somersloopSlots = Number.parseInt(c.mProductionShardSlotSize, 10);
      if (c.mExtractCycleTime !== undefined) {
        b.extractor = {
          cycleTimeS: num(c.mExtractCycleTime),
          itemsPerCycle: num(c.mItemsPerCycle),
          allowedForms: asList(parseUe(c.mAllowedResourceForms ?? ''))
            .map((f) => FORM[String(f)])
            .filter((f): f is ItemForm => !!f),
          allowedResources: asList(parseUe(c.mAllowedResources ?? '')).map((p) => classNameFromPath(String(p))),
        };
      }
      if (group === 'FGBuildableConveyorBelt' || group === 'FGBuildableConveyorLift') {
        // Docs-Wert mSpeed entspricht dem Doppelten der Items/min (Mk.1: 120 → 60/min).
        b.conveyor = { itemsPerMin: num(c.mSpeed) / 2, isLift: group === 'FGBuildableConveyorLift' };
      }
      if (group === 'FGBuildablePipeline') b.pipe = { m3PerMin: num(c.mFlowLimit) * 60 };
      if (group === 'FGBuildablePipelinePump' && num(c.mDesignPressure) > 0)
        b.pump = { designHeadM: num(c.mDesignPressure), maxHeadM: num(c.mMaxPressure) };
      if (c.mWidth !== undefined && c.mDepth !== undefined && c.mHeight !== undefined)
        b.foundation = { widthM: cm(num(c.mWidth)), depthM: cm(num(c.mDepth)), heightM: cm(num(c.mHeight)) };
      if (group === 'FGBuildableTrainPlatformCargo')
        b.freightPlatform = {
          cargo: c.mFreightCargoType === 'FCT_Liquid' ? 'liquid' : 'solid',
          loadTimeS: num(c.mTimeToCompleteLoad),
          unloadTimeS: num(c.mTimeToCompleteUnload),
        };

      const descId = c.ClassName.replace(/^Build_/, 'Desc_');
      const w = wiki[descId];
      const override = portOverrides[c.ClassName];
      if (override) {
        b.ports = { ...EMPTY_PORTS, ...override.ports };
        b.portsSource = override.sourceRef;
      } else if (w && [w.beltInputs, w.beltOutputs, w.pipeInputs, w.pipeOutputs, w.pipeAny].some((v) => v !== undefined)) {
        b.ports = {
          beltIn: w.beltInputs ?? 0,
          beltOut: w.beltOutputs ?? 0,
          pipeIn: w.pipeInputs ?? 0,
          pipeOut: w.pipeOutputs ?? 0,
          pipeAny: w.pipeAny ?? 0,
        };
        b.portsSource = { source: 'wiki', detail: w.page, confidence: 'documented' };
      }
      buildings[b.id] = b;
    }
  }

  // ---------- Rezepte ----------
  const productionBuildings = new Set(Object.values(buildings).filter((b) => b.category === 'production').map((b) => b.id));
  const recipes: Record<string, GdRecipe> = {};
  const usedItems = new Set<string>();
  for (const c of en.get('FGRecipe') ?? []) {
    const producedIn = asList(parseUe(c.mProducedIn ?? ''))
      .map((p) => classNameFromPath(String(p)))
      .filter((id) => productionBuildings.has(id));
    if (producedIn.length === 0) continue;
    const inputs = parseAmounts(c.mIngredients, allItems);
    const outputs = parseAmounts(c.mProduct, allItems);
    if (!inputs || !outputs) {
      report.push(`Rezept ${c.ClassName} übersprungen: unbekannter Gegenstand.`);
      continue;
    }
    const r: GdRecipe = {
      id: c.ClassName,
      name: name(c),
      alternate: c.ClassName.includes('_Alternate_') || (c.mDisplayName ?? '').startsWith('Alternate:'),
      durationS: num(c.mManufactoringDuration),
      inputs,
      outputs,
      producedIn,
    };
    const vc = num(c.mVariablePowerConsumptionConstant);
    const vf = num(c.mVariablePowerConsumptionFactor);
    if (producedIn.some((id) => buildings[id]?.variablePower)) r.variablePower = { constantMW: vc, factorMW: vf };
    recipes[r.id] = r;
    for (const a of [...inputs, ...outputs]) usedItems.add(a.item);
  }

  // Ableitung: Mindestanzahl Anschlüsse je Produktionsgebäude aus den Rezepten,
  // als Gegenprobe zu den Wiki-Angaben.
  for (const id of productionBuildings) {
    const need: GdPortCounts = { ...EMPTY_PORTS };
    for (const r of Object.values(recipes)) {
      if (!r.producedIn.includes(id)) continue;
      const count = (list: GdAmount[], solid: boolean) =>
        list.filter((a) => (allItems.get(a.item)?.form === 'solid') === solid).length;
      need.beltIn = Math.max(need.beltIn, count(r.inputs, true));
      need.pipeIn = Math.max(need.pipeIn, count(r.inputs, false));
      need.beltOut = Math.max(need.beltOut, count(r.outputs, true));
      need.pipeOut = Math.max(need.pipeOut, count(r.outputs, false));
    }
    const b = buildings[id]!;
    if (!b.ports) {
      b.ports = need;
      b.portsSource = { source: 'docs', detail: 'abgeleitet: maximale Zutaten/Produkte je Form über alle Rezepte', confidence: 'derived' };
      report.push(`${id}: Anschlusszahl nur aus Rezepten abgeleitet (kein Wiki-Eintrag).`);
    } else {
      for (const k of ['beltIn', 'beltOut', 'pipeIn', 'pipeOut'] as const) {
        if (b.ports[k] < need[k]) report.push(`WARNUNG ${id}: Wiki nennt ${k}=${b.ports[k]}, Rezepte benötigen ${need[k]}.`);
      }
    }
  }

  // Abgleich Grundfläche Docs ↔ Wiki
  for (const b of Object.values(buildings)) {
    const w = wiki[b.id.replace(/^Build_/, 'Desc_')];
    if (!w?.size || !b.bounds) continue;
    const dx = b.bounds.maxX - b.bounds.minX;
    const dy = b.bounds.maxY - b.bounds.minY;
    const ww = Number.parseFloat(w.size.width ?? '');
    const wl = Number.parseFloat(w.size.length ?? '');
    if (Number.isFinite(ww) && Number.isFinite(wl)) {
      const docs = [dx, dy].sort((a, c) => a - c);
      const wk = [ww, wl].sort((a, c) => a - c);
      if (Math.abs(docs[0]! - wk[0]!) > 0.6 || Math.abs(docs[1]! - wk[1]!) > 0.6)
        report.push(`Hinweis ${b.id}: Kollisionsbox ${dx}×${dy} m, Wiki nennt ${ww}×${wl} m.`);
    }
  }

  const items: Record<string, GdItem> = {};
  for (const it of allItems.values()) {
    if (it.isResource || usedItems.has(it.id)) items[it.id] = it;
  }

  // ---------- Kuratierte Fakten ----------
  const facts = (JSON.parse(readFileSync(join(here, '../curated/facts.json'), 'utf8')) as { facts: Record<string, GdFact> })
    .facts;
  const shard = (en.get('FGPowerShardDescriptor') ?? []).find((c) => c.ClassName === 'Desc_CrystalShard_C');
  if (shard) {
    facts['production.powerShard.extraClock'] = {
      value: num(shard.mExtraPotential),
      unit: 'Faktor',
      description: 'Zusätzlicher maximaler Takt je Energiesplitter.',
      sourceRef: { source: 'docs', detail: 'Desc_CrystalShard_C.mExtraPotential', confidence: 'game-data' },
    };
  }

  // ---------- Straßenfahrzeuge (LKW-Stationen) ----------
  // Laderaum aus den Docs; Geschwindigkeit und Tankinhalt aus kuratierten Wiki-Fakten.
  const vehicles: Record<string, GdVehicle> = {};
  for (const c of en.get('FGVehicleDescriptor') ?? []) {
    const speed = facts[`vehicle.${c.ClassName}.maxSpeedKmh`]?.value;
    if (speed === undefined || c.mManualFuelConsumption === undefined) continue;
    const fluid = c.mIsFluidStorageInventory === 'True';
    const m3 = facts[`vehicle.${c.ClassName}.fluidM3`]?.value;
    if (fluid && m3 === undefined) {
      report.push(`Fahrzeug ${c.ClassName}: Tankinhalt fehlt in curated/facts.json – ausgelassen.`);
      continue;
    }
    vehicles[c.ClassName] = {
      id: c.ClassName,
      name: name(c),
      cargo: fluid ? { kind: 'liquid', m3: m3! } : { kind: 'solid', slots: Number.parseInt(c.mInventorySize ?? '0', 10) },
      maxSpeedKmh: speed,
      sourceRef: { source: 'docs', detail: `${c.ClassName}.mInventorySize; Geschwindigkeit${fluid ? ', Tankinhalt' : ''}: Wiki`, confidence: 'game-data' },
    };
  }

  const data: GameData = {
    meta: {
      schemaVersion: GAMEDATA_SCHEMA_VERSION,
      datasetId: `sf-${gameVersion}`,
      gameVersion,
      gameBuild: {
        engineChangelist: versionInfo.Changelist !== undefined ? String(versionInfo.Changelist) : undefined,
        branch: versionInfo.BranchName,
      },
      generatedAt: new Date().toISOString(),
      generator: '@satis/gamedata-tools 0.1.0',
      sources: [
        {
          id: 'docs',
          title: 'Satisfactory CommunityResources/Docs (en-US.json, de.json)',
          license:
            'Bestandteil der Spielinstallation, von Coffee Stain Studios für Community-Werkzeuge bereitgestellt. Kein ausdrücklicher Lizenztext; alle Rechte bei Coffee Stain Studios.',
          notes: `SHA-256 en-US.json: ${docsHash}`,
        },
        {
          id: 'wiki',
          title: 'Satisfactory Wiki (satisfactory.wiki.gg)',
          url: 'https://satisfactory.wiki.gg/',
          license: 'CC BY-NC-SA 3.0 – übernommen werden nur einzelne Faktenangaben mit Seitenverweis.',
          retrievedAt: existsSync(wikiPath)
            ? (JSON.parse(readFileSync(wikiPath, 'utf8')) as { retrievedAt: string }).retrievedAt
            : undefined,
        },
        {
          id: 'manual',
          title: 'Manuelle Ergänzung (curated/ports-overrides.json)',
          license: 'Eigene Angabe des Projekts',
          notes: 'Nur dort verwendet, wo keine Quelle verfügbar war; immer als unverified gekennzeichnet.',
        },
      ],
      isDemo: false,
      notes: [
        "Werte mit Quelle 'manual' sind ungeprüfte Spielkenntnis und in der Oberfläche als nicht verifiziert markiert.",
        'Anschlusspositionen an Gebäuden sind in den Docs nicht enthalten. Der Planer zeigt Anschlüsse schematisch und kennzeichnet sie als nicht verifiziert.',
        'Flüssigkeitsmengen wurden von Litern (Docs) in m³ umgerechnet.',
        'Förderband-Durchsatz: Docs-Feld mSpeed / 2 = Items pro Minute.',
      ],
    },
    items,
    recipes,
    buildings,
    facts,
    vehicles,
  };

  const outDir = resolve(arg('out') ?? join(repoRoot, 'data/gamedata', gameVersion));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'gamedata.json'), JSON.stringify(data));
  writeFileSync(
    join(outDir, 'EXTRAKTION.md'),
    [
      `# Extraktionsbericht ${data.meta.datasetId}`,
      '',
      `- Erzeugt: ${data.meta.generatedAt}`,
      `- Spielversion: ${gameVersion} (Engine-Changelist ${data.meta.gameBuild.engineChangelist ?? '?'}, ${data.meta.gameBuild.branch ?? '?'})`,
      `- Gegenstände: ${Object.keys(items).length}, Rezepte: ${Object.keys(recipes).length}, Gebäude: ${Object.keys(buildings).length}, Fahrzeuge: ${Object.keys(vehicles).length}, Fakten: ${Object.keys(facts).length}`,
      `- Quelle Docs SHA-256: \`${docsHash}\``,
      '',
      '## Befunde',
      '',
      ...(report.length ? report.map((r) => `- ${r}`) : ['- keine']),
      '',
    ].join('\n'),
  );
  console.log(`Geschrieben: ${outDir}`);
  console.log(`Gegenstände ${Object.keys(items).length}, Rezepte ${Object.keys(recipes).length}, Gebäude ${Object.keys(buildings).length}`);
  for (const r of report) console.log(' -', r);
}

main();
