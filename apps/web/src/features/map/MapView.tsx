/**
 * Weltkarte (Canvas 2D): Kartenbild, Rohstoffvorkommen, Fabrikstandorte,
 * Schienennetze, Transportaufträge und Standortvorschläge.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  factoryFootprint,
  factoryWorldCenter,
  factoryWorldOutline,
  formatNumber,
  geo,
  mapOps,
  nodeTitle,
  nodeUsage,
  segmentPolyline,
  segmentShape,
  snapToWorldGrid,
  WORLD_GRID_OFFSET_M,
  toWorldOf,
  type FactoryMapPlacement,
  type MapNode,
  type Project,
} from '@satis/core';
import { useCanvas, type PointerInfo } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { COLORS, arrowHead, drawGrid, drawLabel, formatM, pathPolygon, pathPolyline } from '../../canvas/draw';
import { drawMapTiles, onTileLoad, TILE_ATTRIBUTION } from '../../canvas/mapTiles';
import { drawNode, drawNodeLabel, nodeRadiusPx, visibleNodes } from '../../canvas/mapDraw';
import { t } from '../../i18n';
import { matchAction } from '../../state/keymap';
import { mapView, useMapStore, type MapTool } from '../../state/mapStore';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { stationGeometry } from '../rail/scene';
import { nodeFilter } from './filter';

const MODE_COLORS: Record<string, string> = { train: '#e8a33d', vehicle: '#7bd88f', drone: '#4fc3ff', belt: '#d9b526', pipe: '#3fa7d6' };

interface Drag {
  factoryId: string;
  start: geo.Vec2;
  orig: FactoryMapPlacement;
  next: FactoryMapPlacement;
  moved: boolean;
}

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

/** Standort so wählen, dass die Grundrissmitte am Zielpunkt liegt; Fundamente auf dem Weltraster (Alt: frei). */
export function placementAt(p: Project, gd: Parameters<typeof factoryFootprint>[1], factoryId: string, center: geo.Vec2, rotationDeg: number, free: boolean): FactoryMapPlacement {
  const r = factoryFootprint(p, gd, factoryId).rect;
  const c = geo.rotate({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }, rotationDeg);
  const m = { x: center.x - c.x, y: center.y - c.y, rotationDeg };
  return free ? m : snapToWorldGrid(p, factoryId, m);
}

export function MapView() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const tiles = usePrefs((s) => s.mapTiles);
  const opacity = usePrefs((s) => s.mapOpacity);
  const theme = usePrefs((s) => s.theme);
  const colors = usePrefs((s) => s.colors);
  const st = useMapStore();
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const usage = useMemo(() => nodeUsage(project), [project]);

  const it = useRef<{ cursor: geo.Vec2; hover: MapNode | null; drag: Drag | null; alt: boolean }>({ cursor: { x: 0, y: 0 }, hover: null, drag: null, alt: false });
  const live = useRef({ project, gd, st, usage, tiles, opacity });
  live.current = { project, gd, st, usage, tiles, opacity };

  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => pointerDown(e),
    onPointerMove: (e) => pointerMove(e),
    onPointerUp: () => pointerUp(),
    onDoubleClick: (e) => doubleClick(e),
    onViewportChange: () => updateStatus(),
  });

  useEffect(requestDraw, [project, st, tiles, opacity, theme, colors, requestDraw]);
  useEffect(() => onTileLoad(requestDraw), [requestDraw]);
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!st.focus) return;
    viewport.cx = st.focus.x;
    viewport.cy = st.focus.y;
    viewport.scale = st.focus.scale ?? Math.max(viewport.scale, 0.6);
    requestDraw();
  }, [st.focus, viewport, requestDraw]);

  function fitView() {
    const w = live.current.gd.map?.world;
    if (w) viewport.fit({ minX: w.west, minY: w.north, maxX: w.east, maxY: w.south }, 20);
    requestDraw();
  }

  function updateStatus() {
    const el = statusRef.current;
    if (!el) return;
    const c = it.current.cursor;
    el.textContent = `x ${formatNumber(c.x, 0)} m · y ${formatNumber(c.y, 0)} m · ${t('Maßstab')} ${formatM(100 / viewport.scale)} / 100 px`;
  }

  // ------------------------------------------------------------------ Treffer

  const filter = () => {
    const L = live.current;
    return nodeFilter(L.st, L.usage);
  };

  function nodeAt(screen: geo.Vec2): MapNode | null {
    const L = live.current;
    if (!L.st.layers.nodes || !L.gd.map) return null;
    let best: { n: MapNode; d: number } | null = null;
    for (const { node, s } of visibleNodes(viewport, L.gd.map.nodes, (n) => n, filter())) {
      const d = Math.hypot(s.x - screen.x, s.y - screen.y);
      if (d <= nodeRadiusPx(viewport.scale, node) + 3 && (!best || d < best.d)) best = { n: node, d };
    }
    return best?.n ?? null;
  }

  function factoryAt(world: geo.Vec2): string | null {
    const L = live.current;
    if (!L.st.layers.factories) return null;
    const ids = Object.keys(L.project.factories).reverse();
    for (const id of ids) {
      const outline = factoryWorldOutline(L.project, L.gd, id);
      if (outline?.some((poly) => geo.pointInPolygon(world, poly))) return id;
    }
    return null;
  }

  // ------------------------------------------------------------------ Zeichnen

  function draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const { project: p, gd: g, st: s } = L;
    mapView.rect = vp.bounds();
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);
    const map = g.map;
    if (!map) {
      drawLabel(ctx, t('Der Spieldatensatz enthält keine Kartendaten.'), vp.width / 2, vp.height / 2, { size: 13 });
      return;
    }
    if (L.tiles !== 'off') drawMapTiles(ctx, vp, map, L.tiles, L.opacity);
    // Spielbereich
    const w = map.world;
    const a = vp.toScreen({ x: w.west, y: w.north });
    const b = vp.toScreen({ x: w.east, y: w.south });
    ctx.strokeStyle = COLORS.outlineSoft;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
    if (s.layers.grid) drawGrid(ctx, vp, p.settings.gridM, 0, WORLD_GRID_OFFSET_M);

    if (s.layers.rail) drawRail(ctx, vp, p);
    if (s.layers.factories) drawFactories(ctx, vp);
    if (s.layers.transport) drawTransport(ctx, vp);
    drawSites(ctx, vp);
    if (s.layers.nodes) drawNodes(ctx, vp);
    drawTool(ctx, vp, s.tool);

    const hv = it.current.hover;
    if (hv && s.layers.nodes) {
      const sc = vp.toScreen(hv);
      const users = L.usage.get(hv.id) ?? [];
      const by = users.map((id) => p.buildings[id]).filter(Boolean)[0];
      const txt = `${nodeTitle(g, hv.id)}${by ? ` · ${t('belegt: {what}', { what: `${by.label || g.name(by.type)} (${p.factories[by.factoryId]?.name ?? ''})` })}` : ''}`;
      drawLabel(ctx, txt, sc.x + 12, sc.y - 14, { align: 'left', bg: COLORS.labelBg, size: 11 });
    }
    drawLabel(ctx, t('Kartenbild: {src}', { src: TILE_ATTRIBUTION }), vp.width - 8, vp.height - 10, { align: 'right', size: 10, color: COLORS.textDim, bg: COLORS.labelBg });
  }

  function drawRail(ctx: CanvasRenderingContext2D, vp: Viewport, p: Project) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of Object.values(p.railSegments)) {
      const shape = segmentShape(p, seg);
      if (!shape) continue;
      ctx.strokeStyle = p.railNetworks[seg.networkId]?.color ?? COLORS.text;
      ctx.lineWidth = Math.max(1.5, Math.min(vp.scale * 1.6, 8));
      pathPolyline(ctx, vp, segmentPolyline(shape, 12));
      ctx.stroke();
    }
    for (const station of Object.values(p.stations)) {
      const g = stationGeometry(p, station);
      if (!g) continue;
      pathPolygon(ctx, vp, g.outline);
      ctx.fillStyle = COLORS.stationBuilding;
      ctx.fill();
      if (live.current.st.layers.labels && vp.scale > 0.4) {
        const c = vp.toScreen(g.front);
        drawLabel(ctx, station.name, c.x, c.y - 12, { size: 10, bg: COLORS.labelBg });
      }
    }
  }

  function drawFactories(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const sel = L.st.selection?.kind === 'factory' ? L.st.selection.id : null;
    const dg = it.current.drag;
    for (const f of Object.values(L.project.factories)) {
      if (!f.map) continue;
      const m = dg?.factoryId === f.id && dg.moved ? dg.next : f.map;
      const fp = factoryFootprint(L.project, L.gd, f.id);
      const polys = fp.polygons.map((poly) => poly.map((q) => toWorldOf(m, q)));
      for (const poly of polys) {
        pathPolygon(ctx, vp, poly);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = f.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = sel === f.id ? COLORS.selection : f.color;
        ctx.lineWidth = sel === f.id ? 3 : 2;
        if (fp.source !== 'areas') ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Kleine Fabriken bleiben bei geringem Maßstab als Punkt sichtbar
      const c = toWorldOf(m, { x: (fp.rect.minX + fp.rect.maxX) / 2, y: (fp.rect.minY + fp.rect.maxY) / 2 });
      const sc = vp.toScreen(c);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.strokeStyle = sel === f.id ? COLORS.selection : '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Nordpfeil des Grundrisses (lokal −y) zeigt die Drehung
      const up = vp.toScreen(toWorldOf(m, { x: (fp.rect.minX + fp.rect.maxX) / 2, y: fp.rect.minY }));
      if (Math.hypot(up.x - sc.x, up.y - sc.y) > 14) {
        ctx.fillStyle = sel === f.id ? COLORS.selection : f.color;
        arrowHead(ctx, sc, up, 8);
      }
      if (L.st.layers.labels) drawLabel(ctx, f.name, sc.x, sc.y - 14, { size: 12, bg: COLORS.labelBg });
    }
  }

  function drawTransport(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    for (const o of Object.values(L.project.transportOrders)) {
      const a = factoryWorldCenter(L.project, L.gd, o.fromFactoryId);
      const b = factoryWorldCenter(L.project, L.gd, o.toFactoryId);
      if (!a || !b || geo.dist(a, b) < 1) continue;
      const sa = vp.toScreen(a);
      const sb = vp.toScreen(b);
      const color = MODE_COLORS[o.mode] ?? COLORS.text;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(o.mode === 'drone' ? [8, 6] : o.mode === 'vehicle' ? [2, 5] : []);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
      arrowHead(ctx, sa, mid, 9);
      if (L.st.layers.labels) {
        const unit = L.gd.item(o.itemId)?.form === 'solid' ? '/min' : ' m³/min';
        drawLabel(ctx, `${L.gd.name(o.itemId)} ${formatNumber(o.ratePerMin, 1)}${unit} · ${formatM(geo.dist(a, b))}`, mid.x, mid.y + 12, { size: 10, bg: COLORS.labelBg, color });
      }
    }
  }

  function drawSites(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const sites = L.st.sites;
    if (!sites) return;
    sites.results.forEach((r, i) => {
      const active = sites.active === i;
      const c = vp.toScreen(r.center);
      if (active) {
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        for (const pk of r.picks) {
          const n = L.gd.mapNode(pk.nodeId);
          if (!n) continue;
          const s = vp.toScreen(n);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const rad = r.maxDistM * vp.scale;
        if (rad > 10) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.selection;
          ctx.globalAlpha = 0.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, active ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = active ? COLORS.selection : COLORS.labelBg;
      ctx.fill();
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.stroke();
      drawLabel(ctx, String(i + 1), c.x, c.y, { size: 12, color: active ? '#000' : COLORS.text });
    });
  }

  function drawNodes(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const map = L.gd.map!;
    const selId = L.st.selection?.kind === 'node' ? L.st.selection.id : null;
    const sites = L.st.sites;
    const picked = sites && sites.active !== null ? new Set(sites.results[sites.active]?.picks.map((x) => x.nodeId)) : null;
    const vis = visibleNodes(vp, map.nodes, (n) => n, nodeFilter(L.st, L.usage));
    // Quellen: Satelliten mit ihrer Mitte verbinden
    ctx.strokeStyle = COLORS.outlineSoft;
    ctx.lineWidth = 1;
    for (const { node, s } of vis) {
      if (node.kind !== 'well' || !node.coreId) continue;
      const core = L.gd.mapNode(node.coreId);
      if (!core) continue;
      const c = vp.toScreen(core);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    const labels = L.st.layers.labels && vp.scale > 0.9;
    for (const { node, s } of vis) {
      const r = nodeRadiusPx(vp.scale, node);
      drawNode(ctx, s, node, r, { used: L.usage.has(node.id), selected: node.id === selId, dim: !!picked && !picked.has(node.id), highlight: !!picked?.has(node.id) });
      if (labels && node.kind !== 'well') drawNodeLabel(ctx, L.gd, s, node, r);
    }
    // Aus einer Liste überfahren: auffälliger Ring, auch wenn der Filter das Vorkommen ausblendet
    const hv = L.st.hoverNodeId ? L.gd.mapNode(L.st.hoverNodeId) : undefined;
    if (hv) {
      const s = vp.toScreen(hv);
      const r = nodeRadiusPx(vp.scale, hv);
      drawNode(ctx, s, hv, r, { used: L.usage.has(hv.id), highlight: true });
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawTool(ctx: CanvasRenderingContext2D, vp: Viewport, tool: MapTool) {
    if (tool.kind !== 'place-factory') return;
    const L = live.current;
    const f = L.project.factories[tool.factoryId];
    if (!f) return;
    const m = placementAt(L.project, L.gd, f.id, it.current.cursor, tool.rotationDeg, it.current.alt);
    for (const poly of factoryFootprint(L.project, L.gd, f.id).polygons) {
      pathPolygon(ctx, vp, poly.map((q) => toWorldOf(m, q)));
      ctx.fillStyle = COLORS.ghost;
      ctx.fill();
      ctx.strokeStyle = COLORS.selection;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const c = vp.toScreen(it.current.cursor);
    drawLabel(ctx, `${f.name} · ${tool.rotationDeg}°`, c.x + 14, c.y + 16, { align: 'left', bg: COLORS.labelBg });
  }

  // ------------------------------------------------------------------ Eingaben

  function pointerDown(e: PointerInfo) {
    if (e.button !== 0) return;
    const L = live.current;
    it.current.alt = e.alt;
    const tool = L.st.tool;
    if (tool.kind === 'place-factory') {
      const m = placementAt(L.project, L.gd, tool.factoryId, e.world, tool.rotationDeg, e.alt);
      apply(t('Fabrik auf der Karte platzieren'), (d) => mapOps.setFactoryMap(d, tool.factoryId, m));
      L.st.setTool({ kind: 'select' });
      L.st.select({ kind: 'factory', id: tool.factoryId });
      return;
    }
    // Klick wählt das Vorkommen, Ziehen verschiebt die Fabrik darunter
    const n = nodeAt(e.screen);
    const fid = factoryAt(e.world);
    if (fid) {
      const f = L.project.factories[fid]!;
      it.current.drag = { factoryId: fid, start: e.world, orig: { ...f.map! }, next: { ...f.map! }, moved: false };
    }
    if (n) L.st.select({ kind: 'node', id: n.id });
    else if (fid) selectFactory(fid);
    else L.st.select(null);
  }

  function pointerMove(e: PointerInfo) {
    const i = it.current;
    i.cursor = e.world;
    i.alt = e.alt;
    const d = i.drag;
    if (d) {
      const dx = e.world.x - d.start.x;
      const dy = e.world.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * viewport.scale > 3) {
        d.moved = true;
        selectFactory(d.factoryId);
      }
      const raw = { x: d.orig.x + dx, y: d.orig.y + dy, rotationDeg: d.orig.rotationDeg };
      d.next = e.alt ? raw : snapToWorldGrid(live.current.project, d.factoryId, raw);
    } else {
      const h = nodeAt(e.screen);
      if (h !== i.hover) i.hover = h;
    }
    updateStatus();
  }

  function selectFactory(fid: string) {
    live.current.st.select({ kind: 'factory', id: fid });
    const f = live.current.project.factories[fid];
    if (f && useUiStore.getState().factoryId !== fid) useUiStore.getState().setFactory(fid, f.floorIds[0] ?? null);
  }

  function pointerUp() {
    const d = it.current.drag;
    it.current.drag = null;
    if (!d || !d.moved) return;
    if (d.next.x === d.orig.x && d.next.y === d.orig.y) return;
    apply(t('Fabrik auf der Karte verschieben'), (p) => mapOps.setFactoryMap(p, d.factoryId, d.next));
  }

  function doubleClick(e: PointerInfo) {
    const fid = factoryAt(e.world);
    if (!fid) return;
    const f = live.current.project.factories[fid]!;
    const ui = useUiStore.getState();
    ui.setMode('factory');
    ui.setFactory(fid, f.floorIds[0] ?? null);
  }

  // ------------------------------------------------------------------ Tastatur

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.defaultPrevented) return;
      const L = live.current;
      const s = L.st;
      if (e.key === 'Escape') {
        if (s.tool.kind !== 'select') s.setTool({ kind: 'select' });
        else if (s.selection) s.select(null);
        // Standortvorschläge ausblenden (Kreis und Linien zu den Vorkommen)
        else if (s.sites?.results.length) s.setSites({ ...s.sites, results: [], active: null });
        requestDraw();
        return;
      }
      const action = matchAction(e, 'map', usePrefs.getState().bindings);
      if (!action) return;
      const step = L.project.settings.snapAngleDeg || 90;
      switch (action) {
        case 'map.rotate':
        case 'map.rotateBack': {
          const delta = action === 'map.rotate' ? step : -step;
          if (s.tool.kind === 'place-factory') s.setTool({ ...s.tool, rotationDeg: geo.normalizeDeg(s.tool.rotationDeg + delta) });
          else if (s.selection?.kind === 'factory' && L.project.factories[s.selection.id]?.map) {
            const id = s.selection.id;
            apply(t('Fabrik auf der Karte drehen'), (p) => rotateAroundCenter(p, id, delta));
          }
          break;
        }
        case 'map.remove':
          if (s.selection?.kind === 'factory' && L.project.factories[s.selection.id]?.map) {
            e.preventDefault();
            const id = s.selection.id;
            apply(t('Fabrik von der Karte nehmen'), (p) => mapOps.setFactoryMap(p, id, null));
          }
          break;
        case 'map.fit':
          fitView();
          break;
        case 'map.zoomIn':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1.25);
          break;
        case 'map.zoomOut':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 0.8);
          break;
      }
      requestDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Drehen um die Grundrissmitte (die Fabrik bleibt an ihrem Platz). */
  function rotateAroundCenter(p: Project, factoryId: string, delta: number) {
    const L = live.current;
    const m = p.factories[factoryId]!.map!;
    const c = factoryWorldCenter(p, L.gd, factoryId)!;
    const rot = geo.normalizeDeg(m.rotationDeg + delta);
    mapOps.setFactoryMap(p, factoryId, placementAt(p, L.gd, factoryId, c, rot, false));
  }

  const tool = st.tool;
  return (
    <div className="editor" data-tour="map-canvas">
      <canvas ref={canvasRef} className="editor-canvas" tabIndex={0} data-testid="map-canvas" data-tool={tool.kind === 'select' ? 'select' : 'place'} />
      <div className="editor-status">
        <span ref={statusRef} />
        <span className="editor-hint">
          {tool.kind === 'place-factory'
            ? t('Klicken: Fabrik setzen (Grundrissmitte am Mauszeiger, Fundamente auf dem Weltraster) · R: drehen · Alt: ohne Raster · Esc: abbrechen')
            : t('Klicken: Vorkommen bzw. Fabrik auswählen · Fabrik ziehen: verschieben (Weltraster, Alt: frei) · R: drehen · Entf: von der Karte nehmen · Doppelklick: Fabrik öffnen')}
        </span>
      </div>
    </div>
  );
}
