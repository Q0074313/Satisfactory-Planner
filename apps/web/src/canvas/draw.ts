/** Zeichenhilfen für Canvas 2D in Weltkoordinaten. */
import { numberLocale } from '@satis/core';
import type { Viewport, Vec } from './viewport';

const DARK = {
  bg: '#16181c',
  gridMinor: 'rgba(255,255,255,0.045)',
  gridMajor: 'rgba(255,255,255,0.12)',
  axis: 'rgba(232,163,61,0.35)',
  selection: '#4fc3ff',
  error: '#ff5a5a',
  warning: '#ffc048',
  text: '#e6e6e6',
  textDim: '#9aa0a6',
  belt: '#c9a227',
  pipe: '#3fa7d6',
  portIn: '#5ad19a',
  portOut: '#ff9f43',
  buildArea: 'rgba(79,195,255,0.06)',
  buildAreaStroke: 'rgba(79,195,255,0.6)',
  foundation: 'rgba(180,180,190,0.10)',
  foundationStroke: 'rgba(200,200,210,0.35)',
  foundationTile: 'rgba(200,200,210,0.12)',
  clearance: 'rgba(255,90,90,0.10)',
  clearanceStroke: 'rgba(255,90,90,0.6)',
  measure: '#e0e0ff',
  outline: 'rgba(255,255,255,0.55)',
  outlineSoft: 'rgba(255,255,255,0.35)',
  frontMark: 'rgba(255,255,255,0.35)',
  otherFloor: 'rgba(255,255,255,0.18)',
  otherNetwork: 'rgba(255,255,255,0.15)',
  labelBg: 'rgba(0,0,0,0.65)',
  ghost: 'rgba(79,195,255,0.25)',
  gap: '#9be7a1',
  overload: '#ff5a5a',
  station: 'rgba(120,80,60,0.18)',
  stationStroke: 'rgba(255,180,120,0.55)',
  stationBuilding: 'rgba(232,163,61,0.35)',
  node: '#d0d4da',
  nodeSwitch: '#ffd27f',
  nodeEnd: '#ff8a8a',
  blockSignal: '#38c172',
  pathSignal: '#a77bff',
  signalInk: '#111',
  fuelPort: '#ff5ce1',
  /** Förderbänder Mk.1 … Mk.6 (Farbton steigt mit der Stufe). */
  beltTiers: ['#b8a45a', '#e2c12a', '#f0962e', '#ea5f3a', '#d64fa0', '#9b78f0'],
  /** Rohre Mk.1, Mk.2. */
  pipeTiers: ['#4fb3e0', '#2a6fe0'],
};

type Palette = typeof DARK;

const LIGHT: Palette = {
  bg: '#f4f5f7',
  gridMinor: 'rgba(0,0,0,0.05)',
  gridMajor: 'rgba(0,0,0,0.14)',
  axis: 'rgba(200,120,20,0.45)',
  selection: '#0a84d6',
  error: '#d62828',
  warning: '#c77c00',
  text: '#1d1f23',
  textDim: '#5f6670',
  belt: '#a07c00',
  pipe: '#1f7fb8',
  portIn: '#1f9e62',
  portOut: '#d36b00',
  buildArea: 'rgba(10,132,214,0.06)',
  buildAreaStroke: 'rgba(10,132,214,0.6)',
  foundation: 'rgba(90,90,100,0.08)',
  foundationStroke: 'rgba(80,80,90,0.4)',
  foundationTile: 'rgba(80,80,90,0.14)',
  clearance: 'rgba(214,40,40,0.08)',
  clearanceStroke: 'rgba(214,40,40,0.6)',
  measure: '#3a3a8a',
  outline: 'rgba(0,0,0,0.55)',
  outlineSoft: 'rgba(0,0,0,0.3)',
  frontMark: 'rgba(255,255,255,0.65)',
  otherFloor: 'rgba(0,0,0,0.22)',
  otherNetwork: 'rgba(0,0,0,0.15)',
  labelBg: 'rgba(255,255,255,0.85)',
  ghost: 'rgba(10,132,214,0.22)',
  gap: '#1f8a3a',
  overload: '#d62828',
  station: 'rgba(200,140,90,0.15)',
  stationStroke: 'rgba(180,100,40,0.6)',
  stationBuilding: 'rgba(232,163,61,0.45)',
  node: '#555b63',
  nodeSwitch: '#c77c00',
  nodeEnd: '#d62828',
  blockSignal: '#1f9e4a',
  pathSignal: '#7b4fd6',
  signalInk: '#fff',
  fuelPort: '#b0249a',
  beltTiers: ['#8a7a3a', '#a88a00', '#c06a10', '#c0401c', '#a8317c', '#6a46c8'],
  pipeTiers: ['#2a8fc0', '#1048b0'],
};

/** Aktuelle Zeichenfarben (werden beim Wechsel des Farbschemas ersetzt). */
export const COLORS: Palette = { ...DARK };

export function applyCanvasTheme(theme: 'dark' | 'light'): void {
  Object.assign(COLORS, theme === 'light' ? LIGHT : DARK);
}

/** Gebäudefarben je Kategorie (in beiden Farbschemata gut lesbar). */
export const CATEGORY_COLORS: Record<string, string> = {
  production: '#3d5a80',
  extraction: '#6b4f2a',
  power: '#5a3d80',
  logistics: '#4a5560',
  storage: '#3f6b4f',
  rail: '#6b3f3f',
  foundation: '#444a50',
  other: '#4f4f4f',
};

export function pathPolygon(ctx: CanvasRenderingContext2D, vp: Viewport, pts: Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = vp.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

export function pathPolyline(ctx: CanvasRenderingContext2D, vp: Viewport, pts: Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = vp.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
}

export function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, majorM: number, minorM: number): void {
  const b = vp.bounds();
  const drawLines = (step: number, color: string) => {
    if (step * vp.scale < 6) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(b.minX / step) * step; x <= b.maxX; x += step) {
      const s = Math.round(vp.toScreen({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(s, 0);
      ctx.lineTo(s, vp.height);
    }
    for (let y = Math.floor(b.minY / step) * step; y <= b.maxY; y += step) {
      const s = Math.round(vp.toScreen({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, s);
      ctx.lineTo(vp.width, s);
    }
    ctx.stroke();
  };
  if (minorM > 0 && minorM < majorM) drawLines(minorM, COLORS.gridMinor);
  let major = majorM;
  while (major * vp.scale < 12) major *= 4;
  drawLines(major, COLORS.gridMajor);
  // Ursprung
  const o = vp.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = COLORS.axis;
  ctx.beginPath();
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, vp.height);
  ctx.moveTo(0, o.y);
  ctx.lineTo(vp.width, o.y);
  ctx.stroke();
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { color?: string; size?: number; bg?: string; align?: CanvasTextAlign } = {},
): void {
  ctx.font = `${opts.size ?? 11}px system-ui, sans-serif`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (opts.bg) {
    const w = ctx.measureText(text).width + 6;
    const h = (opts.size ?? 11) + 4;
    const left = opts.align === 'left' ? x - 3 : opts.align === 'right' ? x - w + 3 : x - w / 2;
    ctx.fillStyle = opts.bg;
    ctx.fillRect(left, y - h / 2, w, h);
  }
  ctx.fillStyle = opts.color ?? COLORS.text;
  ctx.fillText(text, x, y);
}

/** Bemaßungslinie zwischen zwei Weltpunkten mit Längenangabe. */
export function drawDimension(ctx: CanvasRenderingContext2D, vp: Viewport, a: Vec, b: Vec, label?: string, color = COLORS.measure): void {
  const sa = vp.toScreen(a);
  const sb = vp.toScreen(b);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  const dx = sb.x - sa.x;
  const dy = sb.y - sa.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * 5;
  const ny = (dx / l) * 5;
  ctx.moveTo(sa.x - nx, sa.y - ny);
  ctx.lineTo(sa.x + nx, sa.y + ny);
  ctx.moveTo(sb.x - nx, sb.y - ny);
  ctx.lineTo(sb.x + nx, sb.y + ny);
  ctx.stroke();
  drawLabel(ctx, label ?? formatM(len), (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 - 9, { color, bg: COLORS.labelBg });
}

export function formatM(v: number): string {
  return `${v.toLocaleString(numberLocale(), { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1 })} m`;
}

/**
 * Richtungspfeile („Chevrons“) entlang einer Polylinie in Bildschirmabständen.
 * `phase` (0 … 1) verschiebt die Pfeile für eine Flussanimation.
 */
export function drawChevrons(ctx: CanvasRenderingContext2D, vp: Viewport, pts: Vec[], spacingPx: number, sizePx: number, phase = 0): void {
  const scr = pts.map((p) => vp.toScreen(p));
  // Pfeile wandern mit steigender Phase in Förderrichtung
  let carry = spacingPx * (phase % 1);
  ctx.beginPath();
  for (let i = 1; i < scr.length; i++) {
    const a = scr[i - 1]!;
    const b = scr[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let d = carry;
    while (d < len) {
      const cx = a.x + ux * d;
      const cy = a.y + uy * d;
      ctx.moveTo(cx - ux * sizePx - uy * sizePx * 0.8, cy - uy * sizePx + ux * sizePx * 0.8);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx - ux * sizePx + uy * sizePx * 0.8, cy - uy * sizePx - ux * sizePx * 0.8);
      d += spacingPx;
    }
    carry = d - len;
  }
  ctx.stroke();
}

export function arrowHead(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, size: number): void {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a - 0.45), to.y - size * Math.sin(a - 0.45));
  ctx.lineTo(to.x - size * Math.cos(a + 0.45), to.y - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}
