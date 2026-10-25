import type { FactoryFlow, GameDataIndex, LogisticsLink, ObjectRef, Project, Vec3 } from '@satis/core';
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
import { formatNumber, t } from '../../i18n';
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
  /** Deckkraft von Leitungen und Umrissen auf anderen Stockwerken (0 … 1). */
  otherFloorAlpha?: number;
  /** Zusätzliche Ebenen: unter dem Raster (Kartenbild) bzw. über den Flächen (Vorkommen). */
  underlay?: (ctx: CanvasRenderingContext2D, vp: Viewport) => void;
  afterAreas?: (ctx: CanvasRenderingContext2D, vp: Viewport) => void;
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
    double: link.kind === 'pipe',
    index,
    label,
  };
}

/** Zerlegt einen Verlauf in waagrechte Stücke je Stockwerk (senkrechte Abschnitte trennen). */
function floorRuns(points: Vec3[], floors: (string | null)[]): { floorId: string | null; points: Vec3[] }[] {
  const runs: { floorId: string | null; points: Vec3[] }[] = [];
  let cur: { floorId: string | null; points: Vec3[] } | null = null;
  points.forEach((q, i) => {
    const f = floors[i] ?? null;
    if (!cur || cur.floorId !== f) {
      cur = { floorId: f, points: [q] };
      runs.push(cur);
    } else cur.points.push(q);
  });
  return runs;
}

/** Mitte des längsten waagrechten Abschnitts auf dem Stockwerk (für Beschriftungen). */
function labelPoint(points: Vec3[], floors: (string | null)[], floorId: string): { x: number; y: number } | null {
  let best: { len: number; at: { x: number; y: number } } | null = null;
  for (let i = 1; i < points.length; i++) {
    if (floors[i - 1] !== floorId || floors[i] !== floorId) continue;
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-6 && (!best || len > best.len)) best = { len, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best?.at ?? null;
}

/** Symbol für einen Stockwerkswechsel: Quadrat mit Richtungspfeil, daneben das Ziel. */
function drawFloorChange(ctx: CanvasRenderingContext2D, vp: Viewport, at: { x: number; y: number }, up: boolean, color: string, alpha: number, label: string): void {
  const c = vp.toScreen(at);
  const s = Math.max(10, Math.min(vp.scale * 1.8, 22));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x - s / 2, c.y - s / 2, s, s);
  drawLabel(ctx, up ? '▲' : '▼', c.x, c.y, { size: Math.max(9, s * 0.6), color });
  if (label && vp.scale > 2) drawLabel(ctx, label, c.x + s / 2 + 4, c.y, { size: 10, align: 'left', bg: COLORS.labelBg, color: COLORS.text });
  ctx.globalAlpha = 1;
}

export function renderFactory(ctx: CanvasRenderingContext2D, vp: Viewport, r: RenderInput): void {
  const { project, gd, scene, layers } = r;
  const selected = new Set(r.selection.map((s) => s.id));
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, vp.width, vp.height);
  r.underlay?.(ctx, vp);
  if (layers.grid) drawGrid(ctx, vp, project.settings.gridM, project.settings.snapM >= 0.5 ? project.settings.snapM : 1);

  // Andere Stockwerke blass
  if (layers.otherFloors && layers.buildings) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = COLORS.outline;
    ctx.globalAlpha = Math.min(1, (r.otherFloorAlpha ?? 0.15) * 1.3);
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
    ctx.globalAlpha = 1;
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
        const xs = a.polygon.map((p) => p.x);
        drawLabel(ctx, a.locked ? `🔒 ${a.name}` : a.name, sc.x, sc.y + 10, { color: style.stroke, size: 11, maxWidth: (Math.max(...xs) - Math.min(...xs)) * vp.scale - 6 });
      }
    }
  }

  r.afterAreas?.(ctx, vp);

  // Leitungen: Abschnitte auf dem aktiven Stockwerk kräftig, auf anderen blass
  const faded = r.otherFloorAlpha ?? 0.15;
  const activeFloor = project.floors[r.floorId];
  for (const sl of scene.links) {
    const isBelt = sl.link.kind === 'belt';
    if ((isBelt && !layers.belts) || (!isBelt && !layers.pipes)) continue;
    const onFloor = sl.visibleOnFloor;
    const style = linkTierStyle(gd, sl.link);
    const base = style.color;
    const fr = r.flow?.links.get(sl.link.id);
    // Nur Überlastung bekommt eine eigene Farbe; voll ausgelastet ist der Normalfall
    const over = layers.flow && fr && fr.capacity > 0 && Math.max(fr.required, fr.total) > fr.capacity + 1e-6 ? COLORS.overload : '';
    const isSel = selected.has(sl.link.id);
    const color = over || base;
    const width = Math.max(2, Math.min(vp.scale * (isBelt ? 1.2 : 0.9) * style.widthFactor, 16));
    const flowing = (fr?.total ?? 0) > 1e-6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const run of floorRuns(sl.points, sl.floors)) {
      const alpha = run.floorId === r.floorId ? 1 : faded;
      if (isSel) {
        // Ausgewählt: breiter Saum in Auswahlfarbe, die Stufenfarbe bleibt sichtbar
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = width + 8;
        ctx.globalAlpha = 0.55 * alpha;
        pathPolyline(ctx, vp, run.points);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      pathPolyline(ctx, vp, run.points);
      ctx.stroke();
      if (style.double) {
        // Rohre: helle Mittellinie (unterscheidet sie von Bändern)
        ctx.strokeStyle = COLORS.bg;
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = Math.max(1, width * 0.3);
        pathPolyline(ctx, vp, run.points);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      // Förderrichtung: Pfeile entlang der Leitung (bei Fluss animiert; Rohre nur bei Fluss)
      if (isBelt || flowing) {
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = Math.max(1.2, width * 0.28);
        ctx.lineCap = 'round';
        const size = Math.max(2.5, width * 0.45);
        const spacing = Math.max(18, width * 3);
        drawChevrons(ctx, vp, run.points, spacing, size, flowing ? (r.phase ?? 0) : 0);
      }
    }
    // Stockwerkswechsel: Symbol am Lift mit Richtung und Ziel
    for (let i = 1; i < sl.points.length; i++) {
      const a = sl.points[i - 1]!;
      const b = sl.points[i]!;
      const fa = sl.floors[i - 1] ?? null;
      const fb = sl.floors[i] ?? null;
      if (fa === fb || Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6) continue;
      const here = fa === r.floorId || fb === r.floorId;
      const through = !here && !!activeFloor && activeFloor.elevationM > Math.min(a.z, b.z) && activeFloor.elevationM < Math.max(a.z, b.z);
      const other = fa === r.floorId ? fb : fb === r.floorId ? fa : null;
      const text = !here
        ? through
          ? t('durchquert')
          : ''
        : fa === r.floorId
          ? t('nach {floor}', { floor: (other && project.floors[other]?.name) || '?' })
          : t('von {floor}', { floor: (other && project.floors[other]?.name) || '?' });
      drawFloorChange(ctx, vp, a, b.z > a.z, color, here || through ? 1 : faded, layers.labels ? text : '');
    }
    // Endpfeil in Förderrichtung: letzter Punkt mit seitlichem Abstand (senkrechte Enden, z. B. an
    // senkrechten Pumpen, haben im Grundriss keine Richtung)
    ctx.globalAlpha = sl.floors.at(-1) === r.floorId ? 1 : faded;
    ctx.fillStyle = color;
    const end = vp.toScreen(sl.points.at(-1)!);
    const prev = [...sl.points]
      .reverse()
      .map((q) => vp.toScreen(q))
      .find((q) => Math.hypot(q.x - end.x, q.y - end.y) > 0.5);
    if (prev) arrowHead(ctx, prev, end, Math.max(6, width * 1.2));
    ctx.globalAlpha = 1;
    // Durchsatz an der Leitung (Mitte des längsten Abschnitts auf dem aktiven Stockwerk)
    const mid = onFloor ? labelPoint(sl.points, sl.floors, r.floorId) : null;
    if (mid && layers.flow && fr && vp.scale > 2.5 && (fr.total > 1e-6 || fr.required > 1e-6)) {
      const m = vp.toScreen(mid);
      const unit = isBelt ? '/min' : 'm³/min';
      const txt =
        fr.required > fr.capacity + 1e-6
          ? `${formatNumber(fr.required, 1)} > ${formatNumber(fr.capacity, 0)} ${unit}`
          : `${formatNumber(fr.total, 1)} / ${formatNumber(fr.capacity, 0)} ${unit}`;
      drawLabel(ctx, `${style.label} · ${txt}`, m.x, m.y - width - 6, { size: 10, bg: COLORS.labelBg, color: over || COLORS.text });
    } else if (mid && layers.labels && vp.scale > 4 && style.label) {
      // Stufe an der Leitung
      const m = vp.toScreen(mid);
      drawLabel(ctx, style.label, m.x, m.y - width - 6, { size: 10, bg: COLORS.labelBg, color: base });
    }
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
    ctx.lineWidth = opts.selected ? 3 : opts.mark ? 2 : 1;
    if (opts.selected && !part.soft) {
      // Ausgewählt: leuchtender Rand, damit die Auswahl auch neben gleichfarbigen Leitungen auffällt
      ctx.shadowColor = COLORS.selection;
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
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
    // Beschriftung bleibt innerhalb des Gebäudes: Breite und Höhe auf dem Bildschirm (bei Drehung vertauscht)
    const quarter = Math.round((((pl.rotationDeg % 360) + 360) % 360) / 90) % 2 === 1;
    const straight = Math.abs(pl.rotationDeg / 90 - Math.round(pl.rotationDeg / 90)) < 1e-6;
    const dx = (b.maxX - b.minX) * vp.scale;
    const dy = (b.maxY - b.minY) * vp.scale;
    const boxW = (straight ? (quarter ? dy : dx) : Math.min(dx, dy)) - 6;
    const boxH = (straight ? (quarter ? dx : dy) : Math.min(dx, dy)) - 6;
    const recipe = sb.building.recipeId ? gd.recipe(sb.building.recipeId) : undefined;
    const ex = sb.building.extraction ? gd.name(sb.building.extraction.itemId) : '';
    const sub = [recipe ? localName(recipe.name) : ex, sb.building.clock !== 1 ? `${+(sb.building.clock * 100).toFixed(2)} %` : '']
      .filter(Boolean)
      .join(' · ');
    const lines: { text: string; size: number; color: string }[] = [{ text: sb.building.label || localName(def.name), size: 11, color: '#f2f2f2' }];
    if (opts.utilization !== undefined && opts.utilization < 0.999) {
      lines.push({ text: `${formatNumber(opts.utilization * 100, 0)} %`, size: 10, color: opts.utilization < 0.01 ? '#ff8a8a' : '#ffd27f' });
    }
    if (sub) lines.splice(1, 0, { text: sub, size: 10, color: '#c8ccd2' });
    // Produktionsgebäude ohne Rezept: deutlich kennzeichnen (steht immer still)
    else if (def.category === 'production' && !sb.building.recipeId && !sb.building.id.startsWith('_')) lines.splice(1, 0, { text: t('kein Rezept'), size: 10, color: '#ff8a8a' });
    // So viele Zeilen wie in die Höhe passen; die Auslastung hat Vorrang vor der Rezeptzeile
    const fit = Math.max(1, Math.min(lines.length, Math.floor(boxH / 14)));
    const shown = fit < lines.length && sub && lines.length === 3 ? [lines[0]!, lines[2]!].slice(0, fit) : lines.slice(0, fit);
    const c = vp.toScreen(toW((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2));
    shown.forEach((ln, i) => drawLabel(ctx, ln.text, c.x, c.y + (i - (shown.length - 1) / 2) * 14, { size: ln.size, color: ln.color, maxWidth: boxW }));
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
