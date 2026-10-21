/**
 * Kartenbild aus den Kacheln der interaktiven Karte von
 * satisfactory-calculator.com. Die Kacheln werden zur Laufzeit direkt vom
 * Browser geladen (nichts davon liegt im Repository oder auf dem Server).
 *
 * Kachelraster (aus dem Kartencode der Quelle): Gesamtbild 32 768 px für den
 * spielbaren Bereich plus 4096 px Rand je Seite, also 40 960 px bei Zoomstufe
 * 8; Kacheln 256 px, Zoomstufen 3 … 8. Spielbereich West/Ost/Nord/Süd siehe
 * `MapData.world`.
 */
import type { FactoryMapPlacement, MapData } from '@satis/core';
import { toLocalOf, toWorldOf } from '@satis/core';
import type { Viewport } from './viewport';

export type TileLayer = 'game' | 'realistic';

const TILE_HOST = 'https://static.satisfactory-calculator.com';
export const TILE_ATTRIBUTION = 'satisfactory-calculator.com';
const MIN_Z = 3;
const MAX_Z = 8;
const TILE_PX = 256;
const BASE_PX = 32768;
const EXTRA_PX = 4096;

interface TileGrid {
  west: number;
  north: number;
  /** Kantenlänge des Gesamtbilds (m). */
  size: number;
}

function grid(map: MapData): TileGrid {
  const w = map.world;
  const pad = ((w.east - w.west) / BASE_PX) * EXTRA_PX;
  return { west: w.west - pad, north: w.north - pad, size: w.east - w.west + 2 * pad };
}

const images = new Map<string, HTMLImageElement | 'error'>();
const listeners = new Set<() => void>();

/** Benachrichtigung, sobald eine Kachel geladen ist (zum Neuzeichnen). */
export function onTileLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function tile(url: string): HTMLImageElement | null {
  const hit = images.get(url);
  if (hit === 'error') return null;
  if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
  const img = new Image();
  // Der Projekt-Link ist geheim: nie als Referrer mitsenden
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = () => listeners.forEach((f) => f());
  img.onerror = () => images.set(url, 'error');
  img.src = url;
  images.set(url, img);
  return null;
}

const tileUrl = (layer: TileLayer, version: string, z: number, x: number, y: number) =>
  `${TILE_HOST}/imgMap/${layer}Layer/Stable/${z}/${x}/${y}.png?v=${encodeURIComponent(version)}`;

/**
 * Zeichnet das Kartenbild. Ohne `factory` liegt die Ansicht in
 * Weltkoordinaten; mit `factory` in lokalen Koordinaten einer platzierten
 * Fabrik (Karte entsprechend verschoben und gedreht).
 */
export function drawMapTiles(ctx: CanvasRenderingContext2D, vp: Viewport, map: MapData, layer: TileLayer, opacity: number, factory?: FactoryMapPlacement | null): void {
  const g = grid(map);
  const m = factory ?? { x: 0, y: 0, rotationDeg: 0 };
  // Welt → lokal → Bildschirm als eine affine Abbildung
  const r = (m.rotationDeg * Math.PI) / 180;
  const c = Math.cos(r) * vp.scale;
  const s = Math.sin(r) * vp.scale;
  const o = vp.toScreen(toLocalOf(m, { x: 0, y: 0 }));
  // Sichtbarer Weltbereich (Hülle der Bildecken)
  const corners = [
    { x: 0, y: 0 },
    { x: vp.width, y: 0 },
    { x: 0, y: vp.height },
    { x: vp.width, y: vp.height },
  ].map((q) => toWorldOf(m, vp.toWorld(q)));
  const minX = Math.min(...corners.map((q) => q.x));
  const maxX = Math.max(...corners.map((q) => q.x));
  const minY = Math.min(...corners.map((q) => q.y));
  const maxY = Math.max(...corners.map((q) => q.y));

  // Zoomstufe: Kachel höchstens 1,5-fach vergrößert
  const pxPerMAt8 = (BASE_PX + 2 * EXTRA_PX) / g.size;
  const want = MAX_Z - Math.log2((pxPerMAt8 * 1.5) / vp.scale);
  const z = Math.min(MAX_Z, Math.max(MIN_Z, Math.ceil(want)));

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.imageSmoothingEnabled = true;
  // lokal = Drehung(−θ)(Welt − Standort): x' = x·cos + y·sin, y' = −x·sin + y·cos
  ctx.transform(c, -s, s, c, o.x, o.y);
  // Nur der spielbare Bereich (der Kachelrand der Quelle ist leer)
  const w = map.world;
  ctx.beginPath();
  ctx.rect(w.west, w.north, w.east - w.west, w.south - w.north);
  ctx.clip();
  // Grobe Stufe als Untergrund (lückenlos, solange feinere Kacheln laden), dann die passende Stufe
  const levels = z > MIN_Z ? [MIN_Z, z] : [z];
  for (const zl of levels) {
    const n = Math.round(((BASE_PX + 2 * EXTRA_PX) / TILE_PX) * 2 ** (zl - MAX_Z));
    const ts = g.size / n;
    const x0 = Math.max(0, Math.floor((minX - g.west) / ts));
    const x1 = Math.min(n - 1, Math.floor((maxX - g.west) / ts));
    const y0 = Math.max(0, Math.floor((minY - g.north) / ts));
    const y1 = Math.min(n - 1, Math.floor((maxY - g.north) / ts));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const img = tile(tileUrl(layer, map.meta.sourceVersion, zl, x, y));
        // Halbes Pixel Überlappung gegen feine Fugen zwischen den Kacheln
        const e = 0.5 / vp.scale;
        if (img) ctx.drawImage(img, g.west + x * ts, g.north + y * ts, ts + e, ts + e);
      }
    }
  }
  ctx.restore();
}
