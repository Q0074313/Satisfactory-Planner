/**
 * Maßstabsgetreuer 2D-Grundrisseditor einer Fabrik (Canvas 2D).
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  buildingFootprint,
  buildingOutline,
  cachedFactoryFlow,
  canUseNode,
  mapOps,
  segmentPolyline,
  segmentShape,
  nodeUsage,
  toLocalOf,
  toWorldOf,
  controlPoints,
  factoryOps as ops,
  geo,
  orientPorts,
  portStubZ,
  routePath,
  worldPorts,
  type Building,
  type GameDataIndex,
  type ObjectRef,
  type Placement,
  type Project,
  type Vec3,
  type WorldPort,
} from '@satis/core';
import { useCanvas, type PointerInfo } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { COLORS, drawChevrons, drawDimension, drawLabel, formatM, pathPolygon, pathPolyline } from '../../canvas/draw';
import { drawMapTiles, onTileLoad } from '../../canvas/mapTiles';
import { drawNode, drawNodeLabel, nodeRadiusPx, visibleNodes } from '../../canvas/mapDraw';
import { t } from '../../i18n';
import { matchAction } from '../../state/keymap';
import { useFindingMarks } from '../../state/derived';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore, type Tool } from '../../state/uiStore';
import { drawBuilding, drawPort, linkTierStyle, renderFactory, snapOrigin } from './render';
import { buildScene, hitTest, hitToRef, neighborGaps, portKey, type FactoryScene, type Hit } from './scene';
import { ElevationView } from './ElevationView';
import { EditorToolbar, ROUTING_LABELS, tierShort } from './EditorToolbar';
import { linkToolFor, nextRouting, nextTier } from '../../state/linkTool';

type Drag =
  | { kind: 'move'; start: geo.Vec2; delta: geo.Vec2; buildingIds: string[]; areaIds: string[]; moved: boolean }
  | { kind: 'marquee'; start: geo.Vec2; current: geo.Vec2; additive: boolean }
  | { kind: 'area-rect'; start: geo.Vec2; current: geo.Vec2; screenStart: geo.Vec2 }
  | { kind: 'vertex'; areaId: string; index: number; current: geo.Vec2; moved: boolean };

interface LinkDraft {
  from: WorldPort;
  buildingId: string;
  waypoints: Vec3[];
}

interface Interaction {
  cursor: geo.Vec2;
  hover: Hit;
  drag: Drag | null;
  areaPoints: geo.Vec2[];
  link: LinkDraft | null;
  measureStart: geo.Vec2 | null;
  shift: boolean;
  alt: boolean;
  phase: number;
}


const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
};

export function FactoryEditor() {
  const view = useUiStore((s) => s.factoryView);
  return view === 'plan' ? <PlanEditor /> : <ElevationView axis={view === 'side-x' ? 'x' : 'y'} />;
}

function PlanEditor() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const factoryId = useUiStore((s) => s.factoryId)!;
  const floorId = useUiStore((s) => s.floorId)!;
  const selection = useUiStore((s) => s.selection);
  const tool = useUiStore((s) => s.tool);
  const layers = useUiStore((s) => s.layers);
  const focus = useUiStore((s) => s.focus);
  const animateFlow = usePrefs((s) => s.animateFlow);
  const theme = usePrefs((s) => s.theme);
  const colors = usePrefs((s) => s.colors);
  const tiles = usePrefs((s) => s.mapTiles);
  const tileOpacity = usePrefs((s) => s.mapOpacity);
  const marks = useFindingMarks();
  const statusRef = useRef<HTMLSpanElement | null>(null);

  const scene = useMemo(() => buildScene(project, gd, factoryId, floorId), [project, gd, factoryId, floorId]);
  const otherFloorOpacity = usePrefs((s) => s.otherFloorOpacity);
  // Durchsatz auch ohne Ebene „Durchsatz“ berechnen, wenn die Förderrichtung animiert wird
  const flow = useMemo(() => (layers.flow || animateFlow ? cachedFactoryFlow(project, gd, factoryId) : undefined), [project, gd, factoryId, layers.flow, animateFlow]);
  const anyFlow = useMemo(() => !!flow && [...flow.links.values()].some((l) => l.total > 1e-6), [flow]);

  const it = useRef<Interaction>({
    cursor: { x: 0, y: 0 },
    hover: null,
    drag: null,
    areaPoints: [],
    link: null,
    measureStart: null,
    shift: false,
    alt: false,
    phase: 0,
  });

  // Aktuelle Werte für die Ereignisbehandlung (ohne Neuregistrierung)
  const usage = useMemo(() => nodeUsage(project), [project]);
  const live = useRef({ project, gd, scene, floorId, factoryId, selection, tool, layers, marks, flow, animate: animateFlow && anyFlow, usage, tiles, tileOpacity });
  live.current = { project, gd, scene, floorId, factoryId, selection, tool, layers, marks, flow, animate: animateFlow && anyFlow, usage, tiles, tileOpacity };

  const floorElevation = (p: Project, id: string) => p.floors[id]?.elevationM ?? 0;

  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => pointerDown(e),
    onPointerMove: (e) => pointerMove(e),
    onPointerUp: (e) => pointerUp(e),
    onDoubleClick: () => finishAreaPolygon(),
    onViewportChange: () => updateStatus(),
    animating: () => live.current.animate && (live.current.layers.belts || live.current.layers.pipes),
    onFrame: (dt) => {
      it.current.phase = (it.current.phase + dt * 1.2) % 1;
    },
  });

  useEffect(requestDraw, [scene, selection, tool, layers, marks, flow, theme, colors, otherFloorOpacity, tiles, tileOpacity, project.factories[factoryId]?.map, requestDraw]);
  useEffect(() => onTileLoad(requestDraw), [requestDraw]);

  // Neue Fabrik: Ansicht auf Inhalt einpassen
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  useEffect(() => {
    if (!focus) return;
    viewport.cx = focus.x;
    viewport.cy = focus.y;
    if (viewport.scale < 4) viewport.scale = 6;
    requestDraw();
  }, [focus, viewport, requestDraw]);

  // Werkzeugwechsel setzt Entwürfe zurück
  useEffect(() => {
    it.current.areaPoints = [];
    it.current.link = null;
    it.current.measureStart = null;
    it.current.drag = null;
    requestDraw();
  }, [tool.kind, requestDraw]);

  function fitView() {
    const { scene: sc } = live.current;
    const rects = sc.buildings.map((b) => b.rect);
    for (const a of sc.areas) rects.push(geo.rectOf(a.polygon));
    if (rects.length === 0) {
      viewport.cx = 0;
      viewport.cy = 0;
      viewport.scale = 6;
    } else {
      viewport.fit({
        minX: Math.min(...rects.map((r) => r.minX)),
        minY: Math.min(...rects.map((r) => r.minY)),
        maxX: Math.max(...rects.map((r) => r.maxX)),
        maxY: Math.max(...rects.map((r) => r.maxY)),
      });
    }
    requestDraw();
    updateStatus();
  }

  function updateStatus() {
    const el = statusRef.current;
    if (!el) return;
    const c = it.current.cursor;
    const m = live.current.project.factories[live.current.factoryId]?.map;
    const w = m ? toWorldOf(m, c) : null;
    el.textContent =
      `x ${c.x.toFixed(1)} m · y ${c.y.toFixed(1)} m · ${t('Maßstab')} ${formatM(100 / viewport.scale)} / 100 px` +
      (w ? ` · ${t('Welt')} ${w.x.toFixed(0)} / ${w.y.toFixed(0)} m` : '');
  }

  const tolM = () => 6 / viewport.scale;

  /**
   * Gewinnungsgebäude rasten auf einem passenden, freien Vorkommen ein, wenn
   * die Fabrik auf der Karte steht (Ursprung des Gebäudes über der Mitte des
   * Vorkommens, Annahme). Alt: ohne Einrasten.
   */
  function nodeSnap(type: string, cursor: geo.Vec2, free: boolean, ownBuildingId?: string): { nodeId: string; at: geo.Vec2 } | null {
    const L = live.current;
    const m = L.project.factories[L.factoryId]?.map;
    if (free || !m || !L.gd.map || !L.layers.nodes || !L.gd.building(type)?.extractor) return null;
    const w = toWorldOf(m, cursor);
    const reach = Math.max(10, 12 / viewport.scale);
    let best: { nodeId: string; at: geo.Vec2; d: number } | null = null;
    for (const n of L.gd.map.nodes) {
      const d = geo.dist(w, n);
      if (d > reach || (best && d >= best.d) || !canUseNode(L.gd, type, n)) continue;
      const users = L.usage.get(n.id) ?? [];
      if (users.some((id) => id !== ownBuildingId)) continue;
      best = { nodeId: n.id, at: toLocalOf(m, n), d };
    }
    return best;
  }

  /** Kartenbild unter dem Grundriss. */
  function drawUnderlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const m = L.project.factories[L.factoryId]?.map;
    if (!m || !L.gd.map || !L.layers.map || L.tiles === 'off') return;
    drawMapTiles(ctx, vp, L.gd.map, L.tiles, L.tileOpacity * 0.35, m);
  }

  /** Gleise aller Schienennetze unter dem Grundriss (in lokalen Koordinaten). */
  function drawRails(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const m = L.project.factories[L.factoryId]?.map;
    if (!m || !L.layers.rail) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of Object.values(L.project.railSegments)) {
      const shape = segmentShape(L.project, seg);
      if (!shape) continue;
      const pts = segmentPolyline(shape, 16).map((q) => toLocalOf(m, q));
      const net = L.project.railNetworks[seg.networkId];
      // Schwellen-Breite: Gleis 3 m, darin die Netzfarbe
      ctx.strokeStyle = COLORS.outlineSoft;
      ctx.lineWidth = Math.max(3, 3.2 * vp.scale);
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
      ctx.strokeStyle = net?.color ?? COLORS.text;
      ctx.lineWidth = Math.max(1.5, 1.2 * vp.scale);
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
    }
  }

  /** Vorkommen unter dem Grundriss (in lokalen Koordinaten). */
  function drawNodes(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const m = L.project.factories[L.factoryId]?.map;
    if (!m || !L.gd.map || !L.layers.nodes) return;
    for (const { node, s } of visibleNodes(vp, L.gd.map.nodes, (n) => toLocalOf(m, n), () => true)) {
      const r = nodeRadiusPx(vp.scale, node);
      drawNode(ctx, s, node, r, { used: L.usage.has(node.id) });
      // Belegte Vorkommen verdeckt das Gebäude; die Beschriftung stünde unter ihm
      if (L.layers.labels && node.kind !== 'well' && !L.usage.has(node.id)) drawNodeLabel(ctx, L.gd, s, node, r);
    }
  }

  /** Fangen am Raster (Ursprung: Fundamentecke unter dem Punkt, sonst Weltursprung). */
  function snapPoint(p: geo.Vec2, free: boolean): geo.Vec2 {
    const step = live.current.project.settings.snapM;
    if (free || step <= 0) return p;
    const o = snapOrigin(live.current.scene, p, geo.pointInPolygon);
    return { x: o.x + geo.snap(p.x - o.x, step), y: o.y + geo.snap(p.y - o.y, step) };
  }

  /** Platzierung so wählen, dass die gedrehte Hülle am Fangraster ausgerichtet ist. */
  function snappedPlacement(gdx: GameDataIndex, type: string, cursor: geo.Vec2, rotationDeg: number, free: boolean, fl: string, vertical?: 'up' | 'down'): Placement {
    const def = gdx.building(type);
    const step = live.current.project.settings.snapM;
    const v = vertical ? { vertical } : {};
    if (!def || free || step <= 0) return { floorId: fl, x: cursor.x, y: cursor.y, zOffsetM: 0, rotationDeg, ...v };
    const r0 = geo.rectOf(buildingOutline(def, { x: 0, y: 0, rotationDeg, vertical }));
    const corner = snapPoint({ x: cursor.x + r0.minX, y: cursor.y + r0.minY }, false);
    return { floorId: fl, x: corner.x - r0.minX, y: corner.y - r0.minY, zOffsetM: 0, rotationDeg, ...v };
  }

  /**
   * Punkte von Bau- und Fundamentflächen rasten im Hauptraster (8 m ab
   * Ursprung, deckungsgleich mit dem Weltraster); Alt: feines Fangraster.
   */
  function areaPoint(p: geo.Vec2, fine: boolean): geo.Vec2 {
    const step = live.current.project.settings.gridM;
    if (fine || step <= 0) return snapPoint(p, false);
    return { x: geo.snap(p.x, step), y: geo.snap(p.y, step) };
  }

  /** Eckpunkt der gewählten Fläche unter dem Mauszeiger. */
  function vertexAt(screen: geo.Vec2): { areaId: string; index: number } | null {
    const L = live.current;
    const sel = L.selection;
    if (sel.length !== 1 || sel[0]!.table !== 'areas') return null;
    const a = L.project.areas[sel[0]!.id];
    if (!a || a.floorId !== L.floorId || a.locked) return null;
    const index = a.polygon.findIndex((q) => {
      const s = viewport.toScreen(q);
      return Math.hypot(s.x - screen.x, s.y - screen.y) <= 7;
    });
    return index >= 0 ? { areaId: a.id, index } : null;
  }

  function snapDelta(raw: geo.Vec2, free: boolean): geo.Vec2 {
    const step = live.current.project.settings.snapM;
    return free || step <= 0 ? raw : { x: geo.snap(raw.x, step), y: geo.snap(raw.y, step) };
  }

  function hit(pt: geo.Vec2, forLink = false): Hit {
    const { scene: sc, project: p, layers: ly, floorId: fl } = live.current;
    return hitTest(sc, p, pt, tolM(), {
      ports: ly.ports || forLink,
      links: ly.belts || ly.pipes,
      floorId: fl,
      measurements: ly.measurements,
      areas: ly.areas,
    });
  }

  // ------------------------------------------------------------------ Zeichnen

  function draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const i = it.current;
    const hidden = i.drag?.kind === 'move' && i.drag.moved ? new Set(i.drag.buildingIds) : undefined;
    renderFactory(ctx, vp, {
      project: L.project,
      gd: L.gd,
      scene: L.scene,
      floorId: L.floorId,
      layers: L.layers,
      selection: L.selection,
      marks: L.marks,
      hidden,
      flow: L.flow,
      phase: L.animate ? i.phase : 0,
      otherFloorAlpha: usePrefs.getState().otherFloorOpacity,
      underlay: drawUnderlay,
      afterAreas: (c, v) => {
        drawRails(c, v);
        drawNodes(c, v);
      },
    });

    // Verschieben: Vorschau + Abstände
    if (i.drag?.kind === 'move' && i.drag.moved) {
      const d = i.drag.delta;
      const moved: geo.Rect[] = [];
      for (const id of i.drag.buildingIds) {
        const sb = L.scene.byId.get(id);
        if (!sb || !sb.onActiveFloor) continue;
        const pl = { ...sb.building.placement!, x: sb.building.placement!.x + d.x, y: sb.building.placement!.y + d.y };
        const def = L.gd.building(sb.building.type)!;
        const parts = buildingFootprint(def, pl, L.project.floors[pl.floorId]);
        drawBuilding(ctx, vp, L.gd, { building: { ...sb.building, placement: pl }, parts }, { selected: true, labels: true });
        moved.push(geo.rectOf(parts.flatMap((x) => x.polygon)));
      }
      for (const id of i.drag.areaIds) {
        const a = L.project.areas[id];
        if (!a) continue;
        pathPolygon(ctx, vp, a.polygon.map((p) => ({ x: p.x + d.x, y: p.y + d.y })));
        ctx.strokeStyle = COLORS.selection;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (moved.length === 1) drawGaps(ctx, vp, moved[0]!, new Set(i.drag.buildingIds));
      const s = vp.toScreen(i.cursor);
      drawLabel(ctx, `Δx ${formatM(d.x)}  Δy ${formatM(d.y)}`, s.x + 14, s.y + 18, { align: 'left', bg: COLORS.labelBg });
    }

    if (i.drag?.kind === 'marquee') {
      const a = vp.toScreen(i.drag.start);
      const b = vp.toScreen(i.drag.current);
      ctx.strokeStyle = COLORS.selection;
      ctx.fillStyle = COLORS.ghost;
      ctx.setLineDash([4, 3]);
      ctx.globalAlpha = 0.4;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.globalAlpha = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }

    const tl = L.tool;
    if ((tl.kind === 'place' || tl.kind === 'group' || tl.kind === 'paste') && !i.drag) drawPlacementGhost(ctx, vp, tl);

    // Gewählte Fläche: Eckpunkte zum Ziehen, beim Ziehen die neue Form
    const selArea = L.selection.length === 1 && L.selection[0]!.table === 'areas' ? L.project.areas[L.selection[0]!.id] : undefined;
    if (selArea && !selArea.locked && selArea.floorId === L.floorId && tl.kind === 'select') {
      const poly = i.drag?.kind === 'vertex' && i.drag.moved ? editedPolygon(selArea.polygon, i.drag.index, i.drag.current) : selArea.polygon;
      if (i.drag?.kind === 'vertex' && i.drag.moved) {
        pathPolygon(ctx, vp, poly);
        ctx.strokeStyle = COLORS.selection;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        const r = geo.rectOf(poly);
        drawDimension(ctx, vp, { x: r.minX, y: r.minY - 1 }, { x: r.maxX, y: r.minY - 1 });
        drawDimension(ctx, vp, { x: r.maxX + 1, y: r.minY }, { x: r.maxX + 1, y: r.maxY });
      }
      ctx.fillStyle = COLORS.selection;
      for (const q of poly) {
        const s = vp.toScreen(q);
        ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      }
    }

    if (tl.kind === 'area') {
      const pts = i.drag?.kind === 'area-rect' ? rectPoly(i.drag.start, i.drag.current) : [...i.areaPoints, areaPoint(i.cursor, i.alt)];
      if (pts.length >= 2) {
        pathPolyline(ctx, vp, i.drag?.kind === 'area-rect' ? [...pts, pts[0]!] : pts);
        ctx.strokeStyle = COLORS.selection;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (i.drag?.kind === 'area-rect') {
          const r = geo.rectOf(pts);
          drawDimension(ctx, vp, { x: r.minX, y: r.minY - 1 }, { x: r.maxX, y: r.minY - 1 });
          drawDimension(ctx, vp, { x: r.maxX + 1, y: r.minY }, { x: r.maxX + 1, y: r.maxY });
        } else if (pts.length >= 2) {
          drawDimension(ctx, vp, pts.at(-2)!, pts.at(-1)!);
        }
      }
      const s = vp.toScreen(areaPoint(i.cursor, i.alt));
      ctx.fillStyle = COLORS.selection;
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }

    if (tl.kind === 'link') drawLinkTool(ctx, vp, tl);

    if (tl.kind === 'measure') {
      const end = measureEnd();
      if (i.measureStart) drawDimension(ctx, vp, i.measureStart, end);
      const s = vp.toScreen(end);
      ctx.strokeStyle = COLORS.measure;
      ctx.beginPath();
      ctx.moveTo(s.x - 6, s.y);
      ctx.lineTo(s.x + 6, s.y);
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x, s.y + 6);
      ctx.stroke();
    }

    // Hover-Rahmen
    if (tl.kind === 'select' && !i.drag && i.hover && i.hover.kind === 'building') {
      const sb = L.scene.byId.get(i.hover.id);
      if (sb) {
        for (const part of sb.parts) {
          pathPolygon(ctx, vp, part.polygon);
          ctx.strokeStyle = COLORS.selection;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawGaps(ctx: CanvasRenderingContext2D, vp: Viewport, rect: geo.Rect, exclude: Set<string>) {
    const others = live.current.scene.buildings.filter((b) => b.onActiveFloor && !exclude.has(b.building.id)).map((b) => b.rect);
    for (const g of neighborGaps(rect, others)) drawDimension(ctx, vp, g.a, g.b, undefined, COLORS.gap);
  }

  function drawPlacementGhost(ctx: CanvasRenderingContext2D, vp: Viewport, tl: Extract<Tool, { kind: 'place' | 'group' | 'paste' }>) {
    const L = live.current;
    const i = it.current;
    if (tl.kind === 'place') {
      const snap = nodeSnap(tl.type, i.cursor, i.alt, tl.buildingId);
      const pl = snap ? { floorId: L.floorId, x: snap.at.x, y: snap.at.y, zOffsetM: 0, rotationDeg: tl.rotationDeg } : snappedPlacement(L.gd, tl.type, i.cursor, tl.rotationDeg, i.alt, L.floorId, tl.vertical);
      const def = L.gd.building(tl.type);
      if (!def) return;
      if (snap) {
        const s = vp.toScreen(snap.at);
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, nodeRadiusPx(vp.scale, { kind: 'node' }) + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      const parts = buildingFootprint(def, pl, L.project.floors[L.floorId]);
      const fake = { id: '_ghost', factoryId: L.factoryId, type: tl.type, label: '', recipeId: tl.recipeId ?? null, clock: 1, somersloops: 0, placement: pl, groupInstance: null, extraction: null, transfer: null, stationPart: null, notes: '' };
      drawBuilding(ctx, vp, L.gd, { building: fake, parts }, { ghost: true, labels: true });
      drawGhostPorts(ctx, vp, fake);
      const rect = geo.rectOf(parts.flatMap((x) => x.polygon));
      drawGaps(ctx, vp, rect, new Set());
      const s = vp.toScreen({ x: rect.maxX, y: rect.minY });
      drawLabel(ctx, `${formatM(rect.maxX - rect.minX)} × ${formatM(rect.maxY - rect.minY)}`, s.x + 6, s.y - 8, { align: 'left', bg: COLORS.labelBg });
      return;
    }
    if (tl.kind === 'paste') {
      const clip = useUiStore.getState().clipboard;
      if (!clip) return;
      const off = pasteOffset(clip.buildingIds);
      for (const id of clip.buildingIds) {
        const b = L.project.buildings[id];
        const def = b && L.gd.building(b.type);
        if (!b?.placement || !def) continue;
        const pl = { ...b.placement, floorId: L.floorId, x: b.placement.x + off.x, y: b.placement.y + off.y };
        drawBuilding(ctx, vp, L.gd, { building: { ...b, placement: pl }, parts: buildingFootprint(def, pl, L.project.floors[L.floorId]) }, { ghost: true });
        drawGhostPorts(ctx, vp, { ...b, placement: pl });
      }
      return;
    }
    const g = L.project.groups[tl.groupId];
    if (!g) return;
    const c = snapPoint(i.cursor, i.alt);
    for (const m of g.members) {
      const def = L.gd.building(m.type);
      if (!def) continue;
      const r = geo.rotate({ x: m.x, y: m.y }, tl.rotationDeg);
      const pl: Placement = { floorId: L.floorId, x: c.x + r.x, y: c.y + r.y, zOffsetM: m.zOffsetM, rotationDeg: m.rotationDeg + tl.rotationDeg };
      const fake = { id: '_g', factoryId: L.factoryId, type: m.type, label: '', recipeId: m.recipeId, clock: m.clock, somersloops: 0, placement: pl, groupInstance: null, extraction: null, transfer: null, stationPart: null, notes: '' };
      drawBuilding(ctx, vp, L.gd, { building: fake, parts: buildingFootprint(def, pl, L.project.floors[L.floorId]) }, { ghost: true });
      drawGhostPorts(ctx, vp, fake);
    }
  }

  /** Ein- und Ausgänge eines noch nicht abgesetzten Gebäudes (Vorschau). */
  function drawGhostPorts(ctx: CanvasRenderingContext2D, vp: Viewport, b: Building) {
    const L = live.current;
    const def = L.gd.building(b.type);
    if (!def) return;
    for (const p of worldPorts(b, def, L.project.floors[L.floorId])) drawPort(ctx, vp, p.world, p.kind, p.direction, false, false, p.role);
  }

  /** Passt ein Anschluss als Gegenstück zum Startanschluss des Entwurfs? */
  function portMatches(start: WorldPort | null, port: WorldPort): boolean {
    if (!start) return true;
    return !('error' in orientPorts(start, port));
  }

  function drawLinkTool(ctx: CanvasRenderingContext2D, vp: Viewport, tl: Extract<Tool, { kind: 'link' }>) {
    const L = live.current;
    const i = it.current;
    // Freie, passende Anschlüsse hervorheben (Start: jeder freie Anschluss der Art)
    for (const sb of L.scene.buildings) {
      if (!sb.onActiveFloor) continue;
      for (const port of sb.ports) {
        if (port.kind !== tl.linkKind) continue;
        const free = !L.scene.connectedPorts.has(portKey(sb.building.id, port.id));
        const wanted = i.link ? sb.building.id !== i.link.buildingId && portMatches(i.link.from, port) : true;
        if (free && wanted) drawPort(ctx, vp, port.world, port.kind, port.direction, false, true, port.role);
      }
    }
    if (!i.link) return;
    const z = floorElevation(L.project, L.floorId) + 1;
    const h = hit(i.cursor, true);
    const target = h?.kind === 'port' && h.port.kind === tl.linkKind && portMatches(i.link.from, h.port) ? h.port : null;
    let pts: Vec3[];
    if (target) {
      const o = orientPorts(i.link.from, target);
      const reversed = !('error' in o) && o.reversed;
      const wps = reversed ? [...i.link.waypoints].reverse() : i.link.waypoints;
      pts = reversed ? routePath(controlPoints(target, i.link.from, wps), tl.routing) : routePath(controlPoints(i.link.from, target, wps), tl.routing);
    } else {
      const end = snapPoint(i.cursor, i.alt);
      const stubStart = { x: i.link.from.world.x + i.link.from.worldNormal.x, y: i.link.from.world.y + i.link.from.worldNormal.y, z: i.link.from.world.z };
      const startZ = i.link.waypoints.at(-1)?.z ?? portStubZ(i.link.from);
      const lift = Math.abs(startZ - z) > 0.01 ? [{ ...end, z: startZ }] : [];
      pts = routePath([i.link.from.world, i.link.from.vertical ? { ...stubStart, z: portStubZ(i.link.from) } : stubStart, ...i.link.waypoints, ...lift, { ...end, z }], tl.routing);
      // Vom Eingang aus gezeichnet: Fluss läuft zum Startanschluss
      if (i.link.from.direction === 'in') pts = [...pts].reverse();
    }
    pathPolyline(ctx, vp, pts);
    ctx.strokeStyle = linkTierStyle(L.gd, { kind: tl.linkKind, tier: tl.tier }).color;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    drawChevrons(ctx, vp, pts, 22, 4);
    const end = snapPoint(i.cursor, i.alt);
    const last = (i.link.waypoints.at(-1) ?? i.link.from.world) as geo.Vec2;
    drawDimension(ctx, vp, last, end);
    const s = vp.toScreen(i.cursor);
    drawLabel(ctx, `${tierShort(L.gd.name(tl.tier))} · ${t(ROUTING_LABELS[tl.routing])}`, s.x + 14, s.y - 14, { align: 'left', bg: COLORS.labelBg, size: 10 });
  }

  // ------------------------------------------------------------------ Eingaben

  function pointerDown(e: PointerInfo) {
    const L = live.current;
    const i = it.current;
    i.shift = e.shift;
    i.alt = e.alt;
    if (e.button !== 0) return;
    const tl = L.tool;

    if (tl.kind === 'select') {
      const v = vertexAt(e.screen);
      if (v) {
        i.drag = { kind: 'vertex', ...v, current: e.world, moved: false };
        return;
      }
      const h = hit(e.world);
      // Gesperrte Fläche: Ziehen zieht einen Auswahlrahmen auf, ein Klick wählt sie aus (siehe pointerUp)
      const ref = h?.kind === 'area' && L.project.areas[h.id]?.locked ? null : hitToRef(h);
      if (ref) {
        const already = L.selection.some((s) => s.id === ref.id);
        let sel = L.selection;
        if (e.shift) sel = already ? sel.filter((s) => s.id !== ref.id) : [...sel, ref];
        else if (!already) sel = [ref];
        useUiStore.getState().select(sel);
        if (!e.shift || !already) {
          const buildingIds = sel.filter((s) => s.table === 'buildings').map((s) => s.id);
          const areaIds = sel.filter((s) => s.table === 'areas' && !L.project.areas[s.id]?.locked).map((s) => s.id);
          if (buildingIds.length || areaIds.length) i.drag = { kind: 'move', start: e.world, delta: { x: 0, y: 0 }, buildingIds, areaIds, moved: false };
        }
      } else {
        i.drag = { kind: 'marquee', start: e.world, current: e.world, additive: e.shift };
        if (!e.shift) useUiStore.getState().select([]);
      }
      return;
    }

    if (tl.kind === 'place') {
      const snap = nodeSnap(tl.type, e.world, e.alt, tl.buildingId);
      const pl = snap ? { floorId: L.floorId, x: snap.at.x, y: snap.at.y, zOffsetM: 0, rotationDeg: tl.rotationDeg } : snappedPlacement(L.gd, tl.type, e.world, tl.rotationDeg, e.alt, L.floorId, tl.vertical);
      if (tl.buildingId) {
        const id = tl.buildingId;
        apply(t('Maschine aufstellen'), (d, g) => {
          ops.placeBuilding(d, id, pl);
          if (snap) mapOps.assignNode(d, g, id, snap.nodeId);
        });
        const next = Object.values(useProjectStore.getState().project!.buildings).find(
          (b) => b.factoryId === L.factoryId && !b.placement && b.type === tl.type && b.recipeId === (tl.recipeId ?? null),
        );
        useUiStore.getState().select([{ table: 'buildings', id }]);
        useUiStore.getState().setTool(next ? { ...tl, buildingId: next.id } : { kind: 'select' });
      } else {
        const id = apply(t('Gebäude platzieren'), (d, g) => {
          const nid = ops.addBuilding(d, g, { factoryId: L.factoryId, type: tl.type, recipeId: tl.recipeId ?? null, placement: pl });
          if (snap) mapOps.assignNode(d, g, nid, snap.nodeId);
          return nid;
        });
        if (id) useUiStore.getState().select([{ table: 'buildings', id }]);
      }
      return;
    }

    if (tl.kind === 'paste') {
      const clip = useUiStore.getState().clipboard;
      if (!clip) return;
      const off = pasteOffset(clip.buildingIds);
      const ids = apply(t('Einfügen'), (d) => ops.duplicateBuildings(d, clip.buildingIds, { x: off.x, y: off.y, z: 0 }, L.floorId));
      if (ids) useUiStore.getState().select(ids.map((id) => ({ table: 'buildings', id })));
      return;
    }

    if (tl.kind === 'group') {
      const c = snapPoint(e.world, e.alt);
      const ids = apply(t('Gruppe einfügen'), (d, g) => ops.instantiateGroup(d, g, tl.groupId, { factoryId: L.factoryId, floorId: L.floorId, x: c.x, y: c.y, rotationDeg: tl.rotationDeg }));
      if (ids) useUiStore.getState().select(ids.map((id) => ({ table: 'buildings', id })));
      return;
    }

    if (tl.kind === 'area') {
      const p = areaPoint(e.world, e.alt);
      if (i.areaPoints.length === 0) {
        i.drag = { kind: 'area-rect', start: p, current: p, screenStart: e.screen };
      } else {
        const first = i.areaPoints[0]!;
        if (i.areaPoints.length >= 3 && geo.dist(first, p) <= tolM() * 1.5) finishAreaPolygon();
        else i.areaPoints.push(p);
      }
      return;
    }

    if (tl.kind === 'link') {
      linkClick(e, tl);
      return;
    }

    if (tl.kind === 'measure') {
      const p = measureEnd();
      if (!i.measureStart) i.measureStart = p;
      else {
        const z = floorElevation(L.project, L.floorId);
        const from = i.measureStart;
        apply(t('Maß hinzufügen'), (d) => ops.addMeasurement(d, { factoryId: L.factoryId, floorId: L.floorId, from: { ...from, z }, to: { ...p, z } }));
        i.measureStart = null;
      }
    }
  }

  function linkClick(e: PointerInfo, tl: Extract<Tool, { kind: 'link' }>) {
    const L = live.current;
    const i = it.current;
    const ui = useUiStore.getState();
    const h = hit(e.world, true);
    const z = floorElevation(L.project, L.floorId) + 1;
    if (!i.link) {
      if (h?.kind === 'port' && h.port.kind === tl.linkKind) {
        if (L.scene.connectedPorts.has(portKey(h.buildingId, h.port.id))) {
          ui.toast(t('Dieser Anschluss ist bereits verbunden.'), 'error');
          return;
        }
        i.link = { from: h.port, buildingId: h.buildingId, waypoints: [] };
      } else {
        ui.toast(tl.linkKind === 'belt' ? t('Zuerst einen freien Band-Anschluss anklicken (Ein- oder Ausgang).') : t('Zuerst einen freien Rohr-Anschluss anklicken (Ein- oder Ausgang).'), 'info');
      }
      return;
    }
    if (h?.kind === 'port') {
      const o = orientPorts(i.link.from, h.port);
      if ('error' in o) {
        ui.toast(o.error, 'error');
        return;
      }
      const draft = i.link;
      const waypoints = [...draft.waypoints];
      const lastZ = waypoints.at(-1)?.z ?? portStubZ(draft.from);
      if (h.port.vertical) {
        // Senkrechter Anschluss (Pumpe): waagrecht bis über bzw. unter den Anschluss, dann senkrecht hinein
        if (Math.abs(lastZ - portStubZ(h.port)) > 0.01) waypoints.push({ x: h.port.world.x, y: h.port.world.y, z: lastZ });
      } else if (Math.abs(lastZ - h.port.world.z) > 0.01) {
        // Höhenwechsel: senkrechter Abschnitt (Lift) vor dem Ziel
        const stub = { x: h.port.world.x + h.port.worldNormal.x * 2, y: h.port.world.y + h.port.worldNormal.y * 2 };
        waypoints.push({ ...stub, z: lastZ }, { ...stub, z: h.port.world.z });
      }
      const id = apply(tl.linkKind === 'belt' ? t('Förderband verbinden') : t('Rohr verbinden'), (d, g) =>
        ops.addLink(d, g, {
          kind: tl.linkKind,
          tier: tl.tier,
          routing: tl.routing,
          from: { buildingId: draft.buildingId, portId: draft.from.id },
          to: { buildingId: h.buildingId, portId: h.port.id },
          waypoints,
        }),
      );
      if (id) i.link = null;
      return;
    }
    const p = snapPoint(e.world, e.alt);
    const lastZ = i.link.waypoints.at(-1)?.z ?? portStubZ(i.link.from);
    if (Math.abs(lastZ - z) > 0.01) i.link.waypoints.push({ ...p, z: lastZ });
    i.link.waypoints.push({ ...p, z });
  }

  function pointerMove(e: PointerInfo) {
    const L = live.current;
    const i = it.current;
    i.cursor = e.world;
    i.shift = e.shift;
    i.alt = e.alt;
    if (i.drag?.kind === 'move') {
      const raw = { x: e.world.x - i.drag.start.x, y: e.world.y - i.drag.start.y };
      // Nur Flächen: im Hauptraster verschieben, damit Fundamente im Weltraster bleiben
      const onlyAreas = i.drag.buildingIds.length === 0 && L.project.settings.gridM > 0;
      i.drag.delta = onlyAreas && !e.alt ? { x: geo.snap(raw.x, L.project.settings.gridM), y: geo.snap(raw.y, L.project.settings.gridM) } : snapDelta(raw, e.alt);
      if (Math.hypot(raw.x, raw.y) * viewport.scale > 3) i.drag.moved = true;
    } else if (i.drag?.kind === 'marquee') {
      i.drag.current = e.world;
    } else if (i.drag?.kind === 'area-rect') {
      i.drag.current = areaPoint(e.world, e.alt);
    } else if (i.drag?.kind === 'vertex') {
      i.drag.current = areaPoint(e.world, e.alt);
      i.drag.moved = true;
    } else if (L.tool.kind === 'select') {
      i.hover = hit(e.world);
    }
    updateStatus();
  }

  function pointerUp(e: PointerInfo) {
    const L = live.current;
    const i = it.current;
    const drag = i.drag;
    i.drag = null;
    if (!drag) return;
    if (drag.kind === 'move' && drag.moved && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const { x, y } = drag.delta;
      apply(t('Verschieben'), (d) => {
        if (drag.buildingIds.length) ops.moveBuildings(d, drag.buildingIds, x, y);
        if (drag.areaIds.length) ops.moveAreas(d, drag.areaIds, x, y);
      });
    } else if (drag.kind === 'marquee') {
      const r = geo.rectOf([drag.start, drag.current]);
      if (r.maxX - r.minX < tolM() && r.maxY - r.minY < tolM()) {
        // Klick ohne Ziehen auf eine gesperrte Fläche: auswählen (zum Entsperren)
        const h = hit(drag.start);
        if (h?.kind === 'area') useUiStore.getState().select([{ table: 'areas', id: h.id }]);
        return;
      }
      const refs: ObjectRef[] = L.scene.buildings.filter((b) => b.onActiveFloor && geo.rectsOverlap(b.rect, r)).map((b) => ({ table: 'buildings', id: b.building.id }));
      const base = drag.additive ? L.selection.filter((s) => !refs.some((x) => x.id === s.id)) : [];
      useUiStore.getState().select([...base, ...refs]);
    } else if (drag.kind === 'vertex') {
      const a = L.project.areas[drag.areaId];
      if (!a || !drag.moved) return;
      const poly = editedPolygon(a.polygon, drag.index, drag.current);
      const r = geo.rectOf(poly);
      if (r.maxX - r.minX > 0 && r.maxY - r.minY > 0 && poly.some((q, k) => q.x !== a.polygon[k]?.x || q.y !== a.polygon[k]?.y))
        apply(t('Fläche bearbeiten'), (d) => ops.updateArea(d, drag.areaId, { polygon: poly }));
    } else if (drag.kind === 'area-rect') {
      const moved = Math.hypot(e.screen.x - drag.screenStart.x, e.screen.y - drag.screenStart.y) > 4;
      if (moved) {
        const poly = rectPoly(drag.start, drag.current);
        const r = geo.rectOf(poly);
        if (r.maxX - r.minX > 0 && r.maxY - r.minY > 0) createArea(poly);
      } else {
        i.areaPoints = [drag.start];
      }
    }
  }

  function finishAreaPolygon() {
    const i = it.current;
    if (live.current.tool.kind !== 'area' || i.areaPoints.length < 3) return;
    createArea(i.areaPoints);
    i.areaPoints = [];
    requestDraw();
  }

  function createArea(polygon: geo.Vec2[]) {
    const L = live.current;
    if (L.tool.kind !== 'area') return;
    const kind = L.tool.areaKind;
    const id = apply(t('Fläche anlegen'), (d) =>
      ops.addArea(d, {
        factoryId: L.factoryId,
        floorId: L.floorId,
        kind,
        polygon,
        foundationType: kind === 'foundation' ? 'Build_Foundation_8x4_01_C' : undefined,
      }),
    );
    if (id) useUiStore.getState().select([{ table: 'areas', id }]);
  }

  function measureEnd(): geo.Vec2 {
    const i = it.current;
    const p = snapPoint(i.cursor, i.alt);
    if (i.measureStart && i.shift) {
      const dx = Math.abs(p.x - i.measureStart.x);
      const dy = Math.abs(p.y - i.measureStart.y);
      return dx >= dy ? { x: p.x, y: i.measureStart.y } : { x: i.measureStart.x, y: p.y };
    }
    return p;
  }

  function pasteOffset(ids: string[]): geo.Vec2 {
    const L = live.current;
    const placed = ids.map((id) => L.project.buildings[id]?.placement).filter((x): x is Placement => !!x);
    if (!placed.length) return { x: 0, y: 0 };
    const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
    const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length;
    return snapDelta({ x: it.current.cursor.x - cx, y: it.current.cursor.y - cy }, it.current.alt);
  }

  // ------------------------------------------------------------------ Tastatur

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.defaultPrevented) return;
      const L = live.current;
      const i = it.current;
      const ui = useUiStore.getState();
      const tl = L.tool;
      const selBuildings = L.selection.filter((s) => s.table === 'buildings').map((s) => s.id);
      const step = L.project.settings.snapM || 1;

      // Feste Tasten für Entwürfe
      if (e.key === 'Escape') {
        if (i.link && i.link.waypoints.length) i.link = null;
        else if (i.link || i.areaPoints.length || i.measureStart) {
          i.link = null;
          i.areaPoints = [];
          i.measureStart = null;
        } else if (tl.kind !== 'select') ui.setTool({ kind: 'select' });
        else ui.select([]);
        requestDraw();
        return;
      }
      if (e.key === 'Enter' && tl.kind === 'area') {
        finishAreaPolygon();
        return;
      }
      if (e.key === 'Backspace' && tl.kind === 'link' && i.link?.waypoints.length) {
        i.link.waypoints.pop();
        requestDraw();
        e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' && tl.kind === 'area' && i.areaPoints.length) {
        i.areaPoints.pop();
        requestDraw();
        e.preventDefault();
        return;
      }

      const action = matchAction(e, 'factory', usePrefs.getState().bindings);
      if (!action) return;
      const linkKey = (kind: 'belt' | 'pipe') => {
        // Erneut drücken bei aktivem Werkzeug: Verlegemodus weiterschalten
        if (tl.kind === 'link' && tl.linkKind === kind) {
          const routing = nextRouting(tl.routing);
          ui.setTool({ ...tl, routing });
          ui.toast(`${kind === 'belt' ? t('Förderband') : t('Rohr')}: ${t(ROUTING_LABELS[routing])}`);
        } else ui.setTool(linkToolFor(L.gd, kind));
      };
      const nudge = (dx: number, dy: number) => {
        if (!selBuildings.length && !L.selection.some((s) => s.table === 'areas')) return;
        e.preventDefault();
        const s = e.shiftKey ? L.project.settings.gridM : step;
        const areas = L.selection.filter((x) => x.table === 'areas' && !L.project.areas[x.id]?.locked).map((x) => x.id);
        if (!selBuildings.length && !areas.length) return;
        apply(t('Verschieben'), (d) => {
          if (selBuildings.length) ops.moveBuildings(d, selBuildings, dx * s, dy * s);
          if (areas.length) ops.moveAreas(d, areas, dx * s, dy * s);
        });
      };
      switch (action) {
        case 'factory.select':
          ui.setTool({ kind: 'select' });
          break;
        case 'factory.measure':
          ui.setTool({ kind: 'measure' });
          break;
        case 'factory.area':
          ui.setTool({ kind: 'area', areaKind: 'build-area' });
          break;
        case 'factory.belt':
          linkKey('belt');
          break;
        case 'factory.pipe':
          linkKey('pipe');
          break;
        case 'factory.tier':
          if (tl.kind === 'link') {
            const tier = nextTier(L.gd, tl.linkKind, tl.tier);
            ui.setTool({ ...tl, tier });
            ui.toast(L.gd.name(tier));
          } else {
            const links = L.selection.filter((s) => s.table === 'links').map((s) => L.project.links[s.id]).filter((l) => !!l);
            if (links.length) {
              apply(t('Stufe ändern'), (d, g) => links.forEach((l) => ops.updateLink(d, g, l.id, { tier: nextTier(L.gd, l.kind, l.tier) })));
            }
          }
          break;
        case 'factory.vertical': {
          const cycle = (v: 'up' | 'down' | undefined) => (v === undefined ? 'up' : v === 'up' ? 'down' : undefined);
          if (tl.kind === 'place') {
            if (L.gd.building(tl.type)?.pump) ui.setTool({ ...tl, vertical: cycle(tl.vertical) });
          } else if (selBuildings.length) {
            const first = selBuildings.map((id) => L.project.buildings[id]).find((b) => b?.placement && L.gd.building(b.type)?.pump);
            if (first) {
              const v = cycle(first.placement!.vertical);
              apply(t('Einbaulage ändern'), (d, g) => ops.setVertical(d, g, selBuildings, v ?? null));
            } else ui.toast(t('Nur Pipeline-Pumpen können senkrecht eingebaut werden.'), 'info');
          }
          break;
        }
        case 'factory.routing':
          if (tl.kind === 'link') {
            ui.setTool({ ...tl, routing: nextRouting(tl.routing) });
          } else {
            const links = L.selection.filter((s) => s.table === 'links').map((s) => s.id);
            if (links.length) {
              const cur = L.project.links[links[0]!]?.routing ?? 'direct';
              const next = nextRouting(cur);
              apply(t('Verlegemodus'), (d, g) => links.forEach((id) => ops.updateLink(d, g, id, { routing: next })));
            }
          }
          break;
        case 'factory.rotate':
        case 'factory.rotateBack': {
          const delta = (action === 'factory.rotateBack' ? -1 : 1) * (L.project.settings.snapAngleDeg || 90);
          if (tl.kind === 'place' || tl.kind === 'group') ui.setTool({ ...tl, rotationDeg: geo.normalizeDeg(tl.rotationDeg + delta) });
          else if (selBuildings.length) apply(t('Drehen'), (d) => ops.rotateBuildings(d, selBuildings, delta));
          break;
        }
        case 'factory.delete':
          if (L.selection.length && tl.kind === 'select') {
            deleteSelection(L.selection);
            e.preventDefault();
          }
          break;
        case 'factory.unplace':
          if (selBuildings.length) {
            apply(t('Aufstellung aufheben'), (d) => ops.unplaceBuildings(d, selBuildings));
            ui.select([]);
          }
          break;
        case 'factory.copy':
          if (selBuildings.length) {
            ui.setClipboard({ buildingIds: selBuildings });
            ui.toast(t('{n} Gebäude kopiert.', { n: selBuildings.length }));
          }
          break;
        case 'factory.paste':
          if (ui.clipboard) {
            ui.setTool({ kind: 'paste', rotationDeg: 0 });
            e.preventDefault();
          }
          break;
        case 'factory.duplicate':
          if (selBuildings.length) {
            e.preventDefault();
            const rects = selBuildings.map((id) => L.scene.byId.get(id)?.rect).filter((r): r is geo.Rect => !!r);
            const w = rects.length ? Math.max(...rects.map((r) => r.maxX)) - Math.min(...rects.map((r) => r.minX)) : 8;
            const dx = Math.ceil(w / step) * step;
            const ids = apply(t('Duplizieren'), (d) => ops.duplicateBuildings(d, selBuildings, { x: dx, y: 0, z: 0 }));
            if (ids) ui.select(ids.map((id) => ({ table: 'buildings', id })));
          }
          break;
        case 'factory.selectAll':
          e.preventDefault();
          ui.select(L.scene.buildings.filter((b) => b.onActiveFloor).map((b) => ({ table: 'buildings', id: b.building.id })));
          break;
        case 'factory.left':
          nudge(-1, 0);
          break;
        case 'factory.right':
          nudge(1, 0);
          break;
        case 'factory.up':
          nudge(0, -1);
          break;
        case 'factory.down':
          nudge(0, 1);
          break;
        case 'factory.fit':
          fitView();
          break;
        case 'factory.zoomIn':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1.25);
          break;
        case 'factory.zoomOut':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 0.8);
          break;
        case 'factory.floorUp':
        case 'factory.floorDown': {
          e.preventDefault();
          const f = L.project.factories[L.factoryId];
          if (!f) break;
          const idx = f.floorIds.indexOf(L.floorId);
          const next = f.floorIds[idx + (action === 'factory.floorUp' ? 1 : -1)];
          if (next) ui.setFloor(next);
          break;
        }
        case 'factory.side':
          ui.setFactoryView('side-x');
          break;
      }
      requestDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function deleteSelection(sel: ObjectRef[]) {
    // Gesperrte Flächen bleiben stehen
    const locked = sel.filter((s) => s.table === 'areas' && live.current.project.areas[s.id]?.locked);
    if (locked.length) useUiStore.getState().toast(t('Gesperrte Flächen werden nicht gelöscht.'), 'info');
    sel = sel.filter((s) => !locked.includes(s));
    if (!sel.length) return;
    const by = (tb: string) => sel.filter((s) => s.table === tb).map((s) => s.id);
    apply(t('Löschen'), (d) => {
      if (by('links').length) ops.removeLinks(d, by('links').filter((id) => d.links[id]));
      if (by('buildings').length) ops.removeBuildings(d, by('buildings'));
      for (const id of by('areas')) ops.removeArea(d, id);
      if (by('measurements').length) ops.removeMeasurements(d, by('measurements'));
    });
    useUiStore.getState().select([]);
  }

  return (
    <div className="editor" data-tour="factory-canvas">
      <canvas ref={canvasRef} className="editor-canvas" tabIndex={0} data-tool={tool.kind} />
      <EditorToolbar />
      <div className="editor-status">
        <span ref={statusRef} />
        <span className="editor-hint">{toolHint(tool)}</span>
      </div>
    </div>
  );
}

/** Achsparalleles Rechteck (vier Ecken, jede Kante waagrecht oder senkrecht)? */
function isAxisRect(poly: geo.Vec2[]): boolean {
  if (poly.length !== 4) return false;
  return poly.every((q, k) => {
    const n = poly[(k + 1) % 4]!;
    return Math.abs(q.x - n.x) < 1e-9 || Math.abs(q.y - n.y) < 1e-9;
  });
}

/** Form nach dem Ziehen eines Eckpunkts; Rechtecke bleiben Rechtecke (die gegenüberliegende Ecke bleibt stehen). */
function editedPolygon(poly: geo.Vec2[], index: number, to: geo.Vec2): geo.Vec2[] {
  if (isAxisRect(poly)) {
    const opp = poly[(index + 2) % 4]!;
    return poly.map((q, k) => {
      if (k === index) return { ...to };
      if (k === (index + 2) % 4) return { ...q };
      // Nachbarecken: eine Koordinate von der gezogenen, eine von der gegenüberliegenden Ecke
      return Math.abs(q.x - opp.x) < 1e-9 ? { x: opp.x, y: to.y } : { x: to.x, y: opp.y };
    });
  }
  return poly.map((q, k) => (k === index ? { ...to } : q));
}

function rectPoly(a: geo.Vec2, b: geo.Vec2): geo.Vec2[] {
  const r = geo.rectOf([a, b]);
  return [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
}

function toolHint(tl: Tool): string {
  switch (tl.kind) {
    case 'select':
      return t('Klicken: auswählen · Ziehen: verschieben/Rahmen · gewählte Fläche: Ecken ziehen (8-m-Raster, Alt: fein) · R drehen · Entf löschen · Strg+C/V/D · U Aufstellung aufheben · Leertaste/rechte Maustaste: Ansicht verschieben');
    case 'place':
      return t('Klicken: platzieren · R / Umschalt+R drehen · O: Pumpe senkrecht/waagrecht · Alt: ohne Fangen · Esc: beenden');
    case 'paste':
      return t('Klicken: Kopie einfügen (aktives Stockwerk) · Alt: ohne Fangen · Esc: beenden');
    case 'group':
      return t('Klicken: Gruppe einfügen · R drehen · Esc: beenden');
    case 'area':
      return t('Ziehen: Rechteck · Klicken: Eckpunkte setzen, Doppelklick/Enter/Startpunkt: abschließen · Rücktaste: Punkt entfernen · Raster 8 m (Alt: fein)');
    case 'link':
      return t('Anschluss anklicken (Ein- oder Ausgang) → Zwischenpunkte setzen (Bild↑/↓ für Lifte) → Gegenstück anklicken · B bzw. P erneut: Verlegemodus · N: Stufe (Mk) · Rücktaste: Punkt zurück · Esc: abbrechen');
    case 'measure':
      return t('Zwei Punkte anklicken · Umschalt: waagrecht/senkrecht · Alt: ohne Fangen');
  }
}
