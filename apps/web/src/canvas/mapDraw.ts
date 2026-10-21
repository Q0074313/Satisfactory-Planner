/** Zeichenhilfen für die Weltkarte: Vorkommen und Fabrikstandorte. */
import { nodeTitle, type GameDataIndex, type MapNode, type Purity } from '@satis/core';
import { COLORS, drawLabel } from './draw';
import type { Vec, Viewport } from './viewport';

/** Farbe je Rohstoff (eigene Zuordnung, angelehnt an die Spielsymbole). */
export const RESOURCE_COLORS: Record<string, string> = {
  Desc_Stone_C: '#e3dac9',
  Desc_OreIron_C: '#8fa3b8',
  Desc_OreCopper_C: '#e0823a',
  Desc_OreGold_C: '#e8c547',
  Desc_Coal_C: '#2f2f33',
  Desc_LiquidOil_C: '#8a3a8a',
  Desc_Sulfur_C: '#d9d33f',
  Desc_OreBauxite_C: '#b8543c',
  Desc_RawQuartz_C: '#f08fd2',
  Desc_OreUranium_C: '#5fe05f',
  Desc_SAM_C: '#9b5fe0',
  Desc_NitrogenGas_C: '#d6ecff',
  Desc_Water_C: '#3fa7d6',
  geyser: '#ff7043',
};

export const PURITY_COLORS: Record<Purity, string> = { impure: '#d23430', normal: '#f2a618', pure: '#38c45a' };

export const resourceColor = (n: Pick<MapNode, 'itemId' | 'kind'>) => RESOURCE_COLORS[n.kind === 'geyser' ? 'geyser' : (n.itemId ?? '')] ?? '#cccccc';

/** Darstellungsradius eines Vorkommens in Pixeln (maßstäblich ab ≈ 4 m, mindestens 5 px). */
export const nodeRadiusPx = (scale: number, n: Pick<MapNode, 'kind'>) => Math.max(n.kind === 'well' ? 4 : 5.5, Math.min(30, (n.kind === 'well-core' ? 7 : 4) * scale));

/**
 * Vorkommen als Ring in Rohstofffarbe mit Reinheit im Kern. Quellenmitten
 * als Raute, Geysire als Dreieck; belegte Vorkommen mit Haken.
 */
export function drawNode(
  ctx: CanvasRenderingContext2D,
  s: Vec,
  n: MapNode,
  r: number,
  opts: { used?: boolean; selected?: boolean; dim?: boolean; highlight?: boolean } = {},
): void {
  ctx.save();
  ctx.globalAlpha = opts.dim ? 0.35 : 1;
  const ring = resourceColor(n);
  ctx.beginPath();
  if (n.kind === 'well-core') {
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r, s.y);
    ctx.closePath();
  } else if (n.kind === 'geyser') {
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r * 0.95, s.y + r * 0.75);
    ctx.lineTo(s.x - r * 0.95, s.y + r * 0.75);
    ctx.closePath();
  } else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.lineWidth = opts.selected || opts.highlight ? 3 : 1.25;
  ctx.strokeStyle = opts.selected ? COLORS.selection : opts.highlight ? COLORS.text : 'rgba(0,0,0,0.75)';
  ctx.stroke();
  if (n.purity) {
    ctx.beginPath();
    ctx.arc(s.x, s.y + (n.kind === 'geyser' ? r * 0.2 : 0), r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = PURITY_COLORS[n.purity];
    ctx.fill();
  }
  if (opts.used) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, r * 0.28);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.45, s.y + r * 0.02);
    ctx.lineTo(s.x - r * 0.1, s.y + r * 0.38);
    ctx.lineTo(s.x + r * 0.5, s.y - r * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

/** Beschriftung eines Vorkommens unter dem Symbol. */
export function drawNodeLabel(ctx: CanvasRenderingContext2D, gd: GameDataIndex, s: Vec, n: MapNode, r: number): void {
  drawLabel(ctx, nodeTitle(gd, n.id), s.x, s.y + r + 9, { size: 10, bg: COLORS.labelBg, color: COLORS.text });
}

/** Sichtbare Vorkommen mit Bildschirmposition (für Zeichnen und Trefferprüfung). */
export function visibleNodes(vp: Viewport, nodes: MapNode[], toView: (n: MapNode) => Vec, filter: (n: MapNode) => boolean): { node: MapNode; s: Vec }[] {
  const out: { node: MapNode; s: Vec }[] = [];
  for (const n of nodes) {
    if (!filter(n)) continue;
    const s = vp.toScreen(toView(n));
    if (s.x < -40 || s.y < -40 || s.x > vp.width + 40 || s.y > vp.height + 40) continue;
    out.push({ node: n, s });
  }
  return out;
}
