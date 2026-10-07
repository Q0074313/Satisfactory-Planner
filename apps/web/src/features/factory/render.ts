import type { FactoryFlow, GameDataIndex, LogisticsLink, ObjectRef, Project } from '@satis/core';
import { localName, placedBounds } from '@satis/core';
import type { Viewport } from '../../canvas/viewport';
import {
  arrowHead,
  CATEGORY_COLORS,
  COLORS,
  drawChevrons,
  drawDimension,
  drawGrid,
  drawLabel,
  pathPolygon,
  pathPolyline,
} from '../../canvas/draw';
import { formatNumber } from '../../i18n';
import type { LayerKey } from '../../state/uiStore';
import { portKey, type FactoryScene, type SceneBuilding } from './scene';

export interface RenderInput {
  project: Project;
  gd: GameDataIndex;
  scene: FactoryScene;
  floorId: string;
  layers: Record<LayerKey, boolean>;
  selection: ObjectRef[];
  marks: Map<string, 'error' | 'warning'>;
  /** Ausgeblendete Gebäude (werden gerade verschoben). */
  hidden?: Set<string>;
  flow?: FactoryFlow;
  /** Phase der Flussanimation (0 … 1). */
  phase?: number;
}

/**
 * Darstellung einer Leitungsstufe: Farbe und Breite steigen mit der Stufe,
 * Rohre Mk.2 bekommen eine helle Mittellinie (Doppellinie).
 */
export function linkTierStyle(gd: GameDataIndex, link: Pick<LogisticsLink, 'kind' | 'tier'>): { color: string; widthFactor: number; double: boolean; index: number; label: string } {
  const tiers = link.kind === 'belt' ? gd.beltTiers : gd.pipeTiers;
  const palette = link.kind === 'belt' ? COLORS.beltTiers : COLORS.pipeTiers;
  const index = Math.max(0, tiers.findIndex((x) => x.id === link.tier));
  const label = /Mk\.?\s*\d+/i.exec(gd.name(link.tier))?.[0] ?? '';
  return {
    color: palette[Math.min(index, palette.length - 1)] ?? (link.kind === 'belt' ? COLORS.belt : COLORS.pipe),
    widthFactor: link.kind === 'belt' ? 0.8 + index * 0.12 : 0.9 + index * 0.45,
    double: link.kind === 'pipe' && index >= 1,
    index,
    label,
  };
}

/** Auslastung → Farbe (grün … gelb … rot). */
function utilColor(u: number): string {
  if (u > 1 + 1e-6) return COLORS.overload;
  if (u > 0.98) return COLORS.warning;
  return '';
}

export function renderFactory(ctx: CanvasRenderingContext2D, vp: Viewport, r: RenderInput): void {
  const { project, gd, scene, layers } = r;
  const selected = new Set(r.selection.map((s) => s.id));
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, vp.width, vp.height);
  if (layers.grid) drawGrid(ctx, vp, project.settings.gridM, project.settings.snapM >= 0.5 ? project.settings.snapM : 1);

  // Andere Stockwerke blass
  if (layers.otherFloors && layers.buildings) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = COLORS.otherFloor;
    ctx.lineWidth = 1;
    for (const sb of scene.buildings) {
      if (sb.onActiveFloor) continue;
      for (const part of sb.parts) {
        if (part.soft) continue;
        pathPolygon(ctx, vp, part.polygon);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  if (layers.areas) {
    for (const a of scene.areas) {
      const style =
        a.kind === 'build-area'
          ? { fill: COLORS.buildArea, stroke: COLORS.buildAreaStroke, dash: [8, 5] }
          : a.kind === 'foundation'
            ? { fill: COLORS.foundation, stroke: COLORS.foundationStroke, dash: [] }
            : { fill: COLORS.clearance, stroke: COLORS.clearanceStroke, dash: [4, 4] };
      pathPolygon(ctx, vp, a.polygon);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.setLineDash(style.dash);
      ctx.strokeStyle = selected.has(a.id) ? COLORS.selection : style.stroke;
      ctx.lineWidth = selected.has(a.id) ? 2 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
      if (a.kind === 'foundation' && vp.scale * 8 > 10) drawFoundationTiles(ctx, vp, a.polygon, gd, a.foundationType);
      if (layers.labels && vp.scale > 1.5) {
        const c = a.polygon.reduce((s, p) => ({ x: s.x + p.x / a.polygon.length, y: s.y + p.y / a.polygon.length }), { x: 0, y: 0 });
        const sc = vp.toScreen({ x: c.x, y: Math.min(...a.polygon.map((p) => p.y)) });
        drawLabel(ctx, a.name, sc.x, sc.y + 10, { color: style.stroke, size: 11 });
      }
    }
  }

  // Leitungen
  for (const sl of scene.links) {
    const isBelt = sl.link.kind === 'belt';
    if ((isBelt && !layers.belts) || (!isBelt && !layers.pipes)) continue;
    const onFloor = sl.visibleOnFloor;
    const style = linkTierStyle(gd, sl.link);
    const base = style.color;
    const fr = r.flow?.links.get(sl.link.id);
    const over = fr && fr.capacity > 0 ? utilColor(Math.max(fr.required, fr.total) / fr.capacity) : '';
    const color = selected.has(sl.link.id) ? COLORS.selection : layers.flow && over ? over : base;
    ctx.globalAlpha = onFloor ? 1 : 0.25;
    ctx.strokeStyle = color;
    const width = Math.max(2, Math.min(vp.scale * (isBelt ? 1.2 : 0.9) * style.widthFactor, 16));
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    pathPolyline(ctx, vp, sl.points);
    ctx.stroke();
    if (style.double) {
      // Rohr Mk.2: helle Mittellinie
      ctx.strokeStyle = COLORS.bg;
      ctx.globalAlpha = (onFloor ? 1 : 0.25) * 0.55;
      ctx.lineWidth = Math.max(1, width * 0.3);
      pathPolyline(ctx, vp, sl.points);
      ctx.stroke();
      ctx.globalAlpha = onFloor ? 1 : 0.25;
    }
    // Förderrichtung: Pfeile entlang der Leitung (bei Fluss animiert)
    const flowing = (fr?.total ?? 0) > 1e-6;
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = Math.max(1.2, width * 0.28);
    ctx.lineCap = 'round';
    const size = Math.max(2.5, width * 0.45);
    const spacing = Math.max(18, width * 3);
    drawChevrons(ctx, vp, sl.points, spacing, size, flowing ? (r.phase ?? 0) : 0);
    // Lifte und Pfeil am Ende
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    for (let i = 1; i < sl.points.length; i++) {
      const a = sl.points[i - 1]!;
      const b = sl.points[i]!;
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) > 1e-6) {
        const sa = vp.toScreen(a);
        const s = Math.max(8, vp.scale * 1.5);
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(sa.x - s / 2, sa.y - s / 2, s, s);
        ctx.strokeRect(sa.x - s / 2, sa.y - s / 2, s, s);
        drawLabel(ctx, b.z > a.z ? '▲' : '▼', sa.x, sa.y, { size: Math.max(9, s * 0.7), color });
        ctx.fillStyle = color;
      }
    }
    const end = sl.points.at(-1)!;
    const prev = sl.points.at(-2);
    if (prev) arrowHead(ctx, vp.toScreen(prev), vp.toScreen(end), Math.max(6, width * 1.2));
    // Durchsatz an der Leitung
    if (layers.flow && fr && onFloor && vp.scale > 2.5 && (fr.total > 1e-6 || fr.required > 1e-6)) {
      const mid = sl.points[Math.floor(sl.points.length / 2)]!;
      const prevMid = sl.points[Math.max(0, Math.floor(sl.points.length / 2) - 1)]!;
      const m = vp.toScreen({ x: (mid.x + prevMid.x) / 2, y: (mid.y + prevMid.y) / 2 });
      const unit = isBelt ? '/min' : 'm³/min';
      const txt =
        fr.required > fr.capacity + 1e-6
          ? `${formatNumber(fr.required, 1)} > ${formatNumber(fr.capacity, 0)} ${unit}`
          : `${formatNumber(fr.total, 1)} / ${formatNumber(fr.capacity, 0)} ${unit}`;
      drawLabel(ctx, `${style.label} · ${txt}`, m.x, m.y - width - 6, { size: 10, bg: COLORS.labelBg, color: over || COLORS.text });
    } else if (layers.labels && onFloor && vp.scale > 4 && style.label) {
      // Stufe an der Leitung
      const k = Math.floor(sl.points.length / 2);
      const a = sl.points[Math.max(0, k - 1)]!;
      const b = sl.points[k]!;
      const m = vp.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      drawLabel(ctx, style.label, m.x, m.y - width - 6, { size: 10, bg: COLORS.labelBg, color: base });
    }
    ctx.globalAlpha = 1;
  }

  if (layers.buildings) {
    for (const sb of scene.buildings) {
      if (!sb.onActiveFloor || r.hidden?.has(sb.building.id)) continue;
      const util = layers.flow ? r.flow?.machines.get(sb.building.id) : undefined;
      drawBuilding(ctx, vp, gd, sb, { selected: selected.has(sb.building.id), mark: r.marks.get(sb.building.id), labels: layers.labels, utilization: util?.utilization });
    }
  }

  // Direkte Bänder/Rohre zu anderen Fabriken: Stummel mit Pfeil und Ziel
  for (const ex of scene.external) {
    const sb = scene.byId.get(ex.buildingId);
    if (!sb?.onActiveFloor || r.hidden?.has(ex.buildingId)) continue;
    const isBelt = ex.port.kind === 'belt';
    if ((isBelt && !layers.belts) || (!isBelt && !layers.pipes)) continue;
    const o = project.transportOrders[ex.orderId];
    const style = o?.direct ? linkTierStyle(gd, { kind: ex.port.kind, tier: o.direct.tier }) : { color: isBelt ? COLORS.belt : COLORS.pipe, widthFactor: 1 };
    const n = ex.port.vertical ? { x: 0, y: -1 } : ex.port.worldNormal;
    const a = { x: ex.port.world.x, y: ex.port.world.y };
    const b = { x: a.x + n.x * 6, y: a.y + n.y * 6 };
    const sa = vp.toScreen(a);
    const sb2 = vp.toScreen(b);
    const width = Math.max(2, Math.min(vp.scale * (isBelt ? 1.2 : 0.9) * style.widthFactor, 16));
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.setLineDash([Math.max(4, width), Math.max(3, width * 0.6)]);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb2.x, sb2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = style.color;
    if (ex.dir === 'out') arrowHead(ctx, sa, sb2, Math.max(7, width * 1.4));
    else arrowHead(ctx, sb2, sa, Math.max(7, width * 1.4));
    if (layers.labels) {
      const other = project.factories[ex.otherFactoryId]?.name ?? '?';
      drawLabel(ctx, ex.dir === 'out' ? `→ ${other}` : `← ${other}`, sb2.x + n.x * 10, sb2.y + n.y * 10, { size: 11, bg: COLORS.labelBg, color: style.color });
    }
  }

  if (layers.ports && vp.scale > 2) {
    for (const sb of scene.buildings) {
      if (!sb.onActiveFloor || r.hidden?.has(sb.building.id)) continue;
      for (const port of sb.ports) {
        if ((port.kind === 'belt' && !layers.belts) || (port.kind === 'pipe' && !layers.pipes)) continue;
        drawPort(ctx, vp, port.world, port.kind, port.direction, scene.connectedPorts.has(portKey(sb.building.id, port.id)), false, port.role);
      }
    }
  }

  if (layers.measurements) {
    for (const m of Object.values(project.measurements)) {
      if (m.floorId !== r.floorId) continue;
      drawDimension(ctx, vp, m.from, m.to, m.label || undefined, selected.has(m.id) ? COLORS.selection : COLORS.measure);
    }
  }
}

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  gd: GameDataIndex,
  sb: Pick<SceneBuilding, 'building' | 'parts'>,
  opts: { selected?: boolean; mark?: 'error' | 'warning'; labels?: boolean; ghost?: boolean; utilization?: number },
): void {
  const def = gd.building(sb.building.type);
  const base = CATEGORY_COLORS[def?.category ?? 'other'] ?? '#555';
  for (const part of sb.parts) {
    pathPolygon(ctx, vp, part.polygon);
    if (!part.soft) {
      ctx.fillStyle = opts.ghost ? COLORS.ghost : base;
      ctx.globalAlpha = opts.ghost ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash(part.soft ? [4, 3] : []);
    ctx.strokeStyle = opts.selected
      ? COLORS.selection
      : opts.mark === 'error'
        ? COLORS.error
        : opts.mark === 'warning'
          ? COLORS.warning
          : part.soft
            ? COLORS.outlineSoft
            : COLORS.outline;
    ctx.lineWidth = opts.selected || opts.mark ? 2 : 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const pl = sb.building.placement;
  const b = def ? placedBounds(def, pl) : null;
  if (!pl || !def || !b) return;
  if (pl.vertical) {
    // Senkrechte Pumpe: Förderrichtung als Pfeil nach oben bzw. unten
    const c = vp.toScreen({ x: pl.x, y: pl.y });
    drawLabel(ctx, pl.vertical === 'up' ? '▲' : '▼', c.x, c.y, { size: Math.max(9, Math.min(vp.scale * 1.1, 18)), color: COLORS.frontMark });
    return;
  }
  // Vorderseite (+y lokal, Ausgänge) als Dreieck markieren
  const toW = (x: number, y: number) => {
    const r = (pl.rotationDeg * Math.PI) / 180;
    return { x: pl.x + x * Math.cos(r) - y * Math.sin(r), y: pl.y + x * Math.sin(r) + y * Math.cos(r) };
  };
  const w = (b.maxX - b.minX) * 0.12;
  const tip = vp.toScreen(toW((b.minX + b.maxX) / 2, b.maxY - 0.2));
  const l = vp.toScreen(toW((b.minX + b.maxX) / 2 - w, b.maxY - 0.2 - w));
  const rr = vp.toScreen(toW((b.minX + b.maxX) / 2 + w, b.maxY - 0.2 - w));
  ctx.fillStyle = COLORS.frontMark;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(l.x, l.y);
  ctx.lineTo(rr.x, rr.y);
  ctx.closePath();
  ctx.fill();

  if (opts.labels && vp.scale * Math.min(b.maxX - b.minX, b.maxY - b.minY) > 40) {
    const c = vp.toScreen(toW((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2));
    drawLabel(ctx, sb.building.label || localName(def.name), c.x, c.y - 6, { size: 11, color: '#f2f2f2' });
    const recipe = sb.building.recipeId ? gd.recipe(sb.building.recipeId) : undefined;
    const ex = sb.building.extraction ? gd.name(sb.building.extraction.itemId) : '';
    const sub = [recipe ? localName(recipe.name) : ex, sb.building.clock !== 1 ? `${+(sb.building.clock * 100).toFixed(2)} %` : '']
      .filter(Boolean)
      .join(' · ');
    if (sub) drawLabel(ctx, sub, c.x, c.y + 8, { size: 10, color: '#c8ccd2' });
    if (opts.utilization !== undefined && opts.utilization < 0.999) {
      drawLabel(ctx, `${formatNumber(opts.utilization * 100, 0)} %`, c.x, c.y + 22, { size: 10, color: opts.utilization < 0.01 ? '#ff8a8a' : '#ffd27f' });
    }
  }
}

export function drawPort(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  p: { x: number; y: number },
  kind: 'belt' | 'pipe',
  direction: 'in' | 'out' | 'any',
  connected: boolean,
  highlight = false,
  role?: 'fuel',
): void {
  const s = vp.toScreen(p);
  const r = Math.max(3, Math.min(vp.scale * 0.6, 9));
  const color = role === 'fuel' ? COLORS.fuelPort : direction === 'in' ? COLORS.portIn : direction === 'out' ? COLORS.portOut : COLORS.pipe;
  ctx.beginPath();
  if (kind === 'belt') ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  else ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
  ctx.fillStyle = connected ? color : COLORS.bg;
  ctx.fill();
  ctx.strokeStyle = highlight ? COLORS.selection : color;
  ctx.lineWidth = highlight ? 3 : 1.5;
  ctx.stroke();
}

function drawFoundationTiles(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  polygon: { x: number; y: number }[],
  gd: GameDataIndex,
  foundationType?: string,
): void {
  const f = foundationType ? gd.building(foundationType)?.foundation : undefined;
  const w = f?.widthM ?? 8;
  const d = f?.depthM ?? 8;
  const minX = Math.min(...polygon.map((p) => p.x));
  const minY = Math.min(...polygon.map((p) => p.y));
  const maxX = Math.max(...polygon.map((p) => p.x));
  const maxY = Math.max(...polygon.map((p) => p.y));
  ctx.save();
  pathPolygon(ctx, vp, polygon);
  ctx.clip();
  ctx.strokeStyle = COLORS.foundationTile;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = minX; x <= maxX + 1e-6; x += w) {
    const a = vp.toScreen({ x, y: minY });
    const b = vp.toScreen({ x, y: maxY });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let y = minY; y <= maxY + 1e-6; y += d) {
    const a = vp.toScreen({ x: minX, y });
    const b = vp.toScreen({ x: maxX, y });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Ursprung des Fangrasters: linke obere Ecke eines Fundaments unter dem Punkt, sonst (0, 0). */
export function snapOrigin(scene: FactoryScene, pt: { x: number; y: number }, inside: (p: { x: number; y: number }, poly: { x: number; y: number }[]) => boolean) {
  for (const a of scene.areas) {
    if (a.kind !== 'foundation' || !inside(pt, a.polygon)) continue;
    return { x: Math.min(...a.polygon.map((p) => p.x)), y: Math.min(...a.polygon.map((p) => p.y)) };
  }
  return { x: 0, y: 0 };
}
