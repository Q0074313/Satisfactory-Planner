/**
 * Seitenansicht einer Fabrik über alle Stockwerke (Schnitt entlang x oder y).
 * Zeigt Stockwerksebenen, Gebäudehöhen aus den Kollisionsboxen und den
 * Höhenverlauf von Förderbändern und Rohren (Lifte senkrecht, Übergänge
 * zwischen Stockwerken markiert).
 */
import { useEffect, useMemo, useRef } from 'react';
import { buildingFootprint, cachedFactoryFlow, controlPoints, factoryOps as ops, geo, routePath, worldPorts, type LogisticsLink } from '@satis/core';
import { useCanvas } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { CATEGORY_COLORS, COLORS, drawChevrons, drawLabel, formatM, pathPolyline } from '../../canvas/draw';
import { t } from '../../i18n';
import { matchAction } from '../../state/keymap';
import { useFindingMarks } from '../../state/derived';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { EditorToolbar } from './EditorToolbar';
import { linkTierStyle } from './render';

interface Box {
  id: string;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  category: string;
  label: string;
  floorId: string;
}

/** Treffer auf einer Leitung in der Seitenansicht. */
interface LinkHit {
  linkId: string;
  u: number;
  z: number;
}

/** Verschieben in der Seitenansicht: entlang der Blickachse (u) und in der Höhe (z). */
interface ElevDrag {
  id: string;
  start: { u: number; z: number };
  du: number;
  dz: number;
  moved: boolean;
}

export function ElevationView({ axis }: { axis: 'x' | 'y' }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const drag = useRef<ElevDrag | null>(null);
  const factoryId = useUiStore((s) => s.factoryId)!;
  const floorId = useUiStore((s) => s.floorId);
  const selection = useUiStore((s) => s.selection);
  const theme = usePrefs((s) => s.theme);
  const colors = usePrefs((s) => s.colors);
  const animateFlow = usePrefs((s) => s.animateFlow);
  const marks = useFindingMarks();
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const phase = useRef(0);

  const data = useMemo(() => {
    const u = (p: { x: number; y: number }) => (axis === 'x' ? p.x : p.y);
    const boxes: Box[] = [];
    for (const b of Object.values(project.buildings)) {
      if (b.factoryId !== factoryId || !b.placement) continue;
      const def = gd.building(b.type);
      if (!def) continue;
      const parts = buildingFootprint(def, b.placement, project.floors[b.placement.floorId]).filter((p) => !p.soft);
      if (!parts.length) continue;
      const us = parts.flatMap((p) => p.polygon.map(u));
      boxes.push({
        id: b.id,
        u0: Math.min(...us),
        u1: Math.max(...us),
        z0: Math.min(...parts.map((p) => p.zMin)),
        z1: Math.max(...parts.map((p) => p.zMax)),
        category: def.category,
        label: b.label || gd.name(b.type),
        floorId: b.placement.floorId,
      });
    }
    const links: { id: string; link: LogisticsLink; pts: { u: number; z: number }[] }[] = [];
    for (const l of Object.values(project.links)) {
      if (l.factoryId !== factoryId) continue;
      const a = project.buildings[l.from.buildingId];
      const b = project.buildings[l.to.buildingId];
      if (!a?.placement || !b?.placement) continue;
      const pa = worldPorts(a, gd.building(a.type)!, project.floors[a.placement.floorId]).find((x) => x.id === l.from.portId);
      const pb = worldPorts(b, gd.building(b.type)!, project.floors[b.placement.floorId]).find((x) => x.id === l.to.portId);
      if (!pa || !pb) continue;
      const path = routePath(controlPoints(pa, pb, l.waypoints), l.routing);
      links.push({ id: l.id, link: l, pts: path.map((p) => ({ u: u(p), z: p.z })) });
    }
    const floors = (project.factories[factoryId]?.floorIds ?? []).map((id) => project.floors[id]!).filter(Boolean);
    return { boxes, links, floors };
  }, [project, gd, factoryId, axis]);
  const flow = useMemo(() => cachedFactoryFlow(project, gd, factoryId), [project, gd, factoryId]);
  const anyFlow = useMemo(() => [...flow.links.values()].some((l) => l.total > 1e-6), [flow]);

  const live = useRef({ data, selection, marks, floorId, flow, gd, animate: animateFlow && anyFlow, otherAlpha: 0.15 });
  live.current = { data, selection, marks, floorId, flow, gd, animate: animateFlow && anyFlow, otherAlpha: usePrefs.getState().otherFloorOpacity };

  const toWorld = (u: number, z: number) => ({ x: u, y: -z });

  /** Nächste Leitung im Umkreis von 10 Pixeln. */
  const hitLink = (u: number, z: number): LinkHit | null => {
    const tol = 10 / viewport.scale;
    let best: (LinkHit & { d: number }) | null = null;
    for (const l of live.current.data.links) {
      for (let i = 0; i < l.pts.length - 1; i++) {
        const a = l.pts[i]!;
        const b = l.pts[i + 1]!;
        const du = b.u - a.u;
        const dz = b.z - a.z;
        const len2 = du * du + dz * dz;
        const tt = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((u - a.u) * du + (z - a.z) * dz) / len2));
        const d = Math.hypot(a.u + du * tt - u, a.z + dz * tt - z);
        if (d > tol || (best && d >= best.d)) continue;
        best = { linkId: l.id, u: a.u + du * tt, z: a.z + dz * tt, d };
      }
    }
    return best;
  };

  const snapStep = () => useProjectStore.getState().project?.settings.snapM ?? 1;
  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const z = -e.world.y;
      const hitBox = [...live.current.data.boxes].reverse().find((b) => e.world.x >= b.u0 && e.world.x <= b.u1 && z >= b.z0 && z <= b.z1);
      const hitL = hitBox ? null : hitLink(e.world.x, z);
      useUiStore.getState().select(hitBox ? [{ table: 'buildings', id: hitBox.id }] : hitL ? [{ table: 'links', id: hitL.linkId }] : []);
      drag.current = hitBox ? { id: hitBox.id, start: { u: e.world.x, z }, du: 0, dz: 0, moved: false } : null;
    },
    onPointerMove: (e) => {
      const z = -e.world.y;
      if (statusRef.current) statusRef.current.textContent = `${axis} ${e.world.x.toFixed(1)} m · z ${z.toFixed(1)} m`;
      const d = drag.current;
      if (!d) return;
      const step = snapStep();
      const raw = { u: e.world.x - d.start.u, z: z - d.start.z };
      d.du = e.alt || step <= 0 ? raw.u : geo.snap(raw.u, step);
      d.dz = e.alt || step <= 0 ? raw.z : geo.snap(raw.z, step);
      if (Math.hypot(raw.u, raw.z) * viewport.scale > 3) d.moved = true;
      requestDraw();
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved || (d.du === 0 && d.dz === 0)) return;
      const dx = axis === 'x' ? d.du : 0;
      const dy = axis === 'y' ? d.du : 0;
      apply(t('Verschieben'), (p) => ops.moveBuildings(p, [d.id], dx, dy, d.dz));
    },
    animating: () => live.current.animate,
    onFrame: (dt) => {
      phase.current = (phase.current + dt * 1.2) % 1;
    },
  });
  // Tasten der Seitenansicht: Pumpe senkrecht/waagrecht
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.defaultPrevented || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'))) return;
      if (e.key === 'Escape' && drag.current) {
        drag.current = null;
        requestDraw();
        return;
      }
      if (matchAction(e, 'factory', usePrefs.getState().bindings) !== 'factory.vertical') return;
      const st = useProjectStore.getState();
      const ids = useUiStore.getState().selection.filter((x) => x.table === 'buildings').map((x) => x.id);
      const first = ids.map((id) => st.project!.buildings[id]).find((b) => b?.placement && st.gd!.building(b.type)?.pump);
      if (!first) {
        if (ids.length) useUiStore.getState().toast(t('Nur Pipeline-Pumpen können senkrecht eingebaut werden.'), 'info');
        return;
      }
      const cur = first.placement!.vertical;
      const next = cur === undefined ? 'up' : cur === 'up' ? 'down' : null;
      apply(t('Einbaulage ändern'), (d, g) => ops.setVertical(d, g, ids, next));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, requestDraw]);
  const otherFloorOpacity = usePrefs((s) => s.otherFloorOpacity);
  useEffect(requestDraw, [data, selection, marks, theme, colors, otherFloorOpacity, requestDraw]);
  useEffect(() => {
    const { boxes, floors } = live.current.data;
    const us = boxes.flatMap((b) => [b.u0, b.u1]);
    const zs = [...boxes.flatMap((b) => [b.z0, b.z1]), ...floors.flatMap((f) => [f.elevationM, f.elevationM + f.heightM])];
    if (!us.length) us.push(-40, 40);
    viewport.fit({ minX: Math.min(...us) - 10, maxX: Math.max(...us) + 10, minY: -Math.max(...zs, 12) - 4, maxY: -Math.min(...zs, 0) + 4 }, 50);
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, factoryId]);

  function draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const sel = new Set(L.selection.map((s) => s.id));
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);
    // Stockwerke
    for (const f of L.data.floors) {
      const y0 = vp.toScreen(toWorld(0, f.elevationM)).y;
      const y1 = vp.toScreen(toWorld(0, f.elevationM + f.heightM)).y;
      ctx.fillStyle = f.id === L.floorId ? COLORS.buildArea : 'transparent';
      ctx.fillRect(0, y1, vp.width, y0 - y1);
      ctx.strokeStyle = COLORS.foundationStroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(vp.width, y0);
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y1);
      ctx.lineTo(vp.width, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Gebäude
    for (const b of L.data.boxes) {
      const a = vp.toScreen(toWorld(b.u0, b.z1));
      const c = vp.toScreen(toWorld(b.u1, b.z0));
      ctx.fillStyle = CATEGORY_COLORS[b.category] ?? '#555';
      ctx.globalAlpha = drag.current?.moved && drag.current.id === b.id ? 0.35 : 0.8;
      ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.globalAlpha = 1;
      const mark = L.marks.get(b.id);
      ctx.strokeStyle = sel.has(b.id) ? COLORS.selection : mark === 'error' ? COLORS.error : mark === 'warning' ? COLORS.warning : COLORS.outline;
      ctx.lineWidth = sel.has(b.id) || mark ? 2 : 1;
      ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
      if (c.x - a.x > 30 && c.y - a.y > 12) drawLabel(ctx, b.label, (a.x + c.x) / 2, (a.y + c.y) / 2, { size: 10, color: '#f2f2f2', maxWidth: c.x - a.x - 6 });
    }
    // Stockwerksbeschriftung über den Gebäuden
    for (const f of L.data.floors) {
      const y0 = vp.toScreen(toWorld(0, f.elevationM)).y;
      drawLabel(ctx, `${f.name} · ${formatM(f.elevationM)} (${t('lichte Höhe')} ${formatM(f.heightM)})`, 8, y0 - 9, { align: 'left', size: 11, color: COLORS.textDim, bg: COLORS.labelBg });
    }
    // Verschieben: Vorschau mit Versatz
    const dg = drag.current;
    if (dg?.moved) {
      const b = L.data.boxes.find((x) => x.id === dg.id);
      if (b) {
        const a = vp.toScreen(toWorld(b.u0 + dg.du, b.z1 + dg.dz));
        const c = vp.toScreen(toWorld(b.u1 + dg.du, b.z0 + dg.dz));
        ctx.strokeStyle = COLORS.selection;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
        ctx.setLineDash([]);
        drawLabel(ctx, `Δ${axis} ${formatM(dg.du)}  Δz ${formatM(dg.dz)}`, c.x + 8, a.y - 10, { align: 'left', bg: COLORS.labelBg });
      }
    }
    // Leitungen: Abschnitte auf anderen Stockwerken blass, Pfeile in Förderrichtung (bei Fluss animiert)
    const activeFloor = L.data.floors.find((f) => f.id === L.floorId);
    const onActive = (z: number) => !activeFloor || L.data.floors.filter((f) => f.elevationM <= z + 1e-3).sort((a, b) => b.elevationM - a.elevationM)[0]?.id === activeFloor.id;
    const crossings: { u: number; z: number; color: string }[] = [];
    for (const l of L.data.links) {
      const fr = L.flow.links.get(l.id);
      const over = fr && fr.required > fr.capacity + 1e-6;
      const style = linkTierStyle(L.gd, l.link);
      const color = over ? COLORS.overload : style.color;
      const width = 2 + style.widthFactor * 1.5;
      const pts = l.pts.map((p) => toWorld(p.u, p.z));
      if (sel.has(l.id)) {
        ctx.strokeStyle = COLORS.selection;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = width + 8;
        pathPolyline(ctx, vp, pts);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1]!;
        const b = l.pts[i]!;
        ctx.globalAlpha = onActive(Math.min(a.z, b.z) + 0.01) || onActive(Math.max(a.z, b.z) - 0.01) ? 1 : L.otherAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        pathPolyline(ctx, vp, [pts[i - 1]!, pts[i]!]);
        ctx.stroke();
        // Übergang zwischen Stockwerken: Stelle, an der die Leitung einen Stockwerksboden kreuzt
        for (const f of L.data.floors) {
          const lo = Math.min(a.z, b.z);
          const hi = Math.max(a.z, b.z);
          if (f.elevationM <= lo + 1e-3 || f.elevationM >= hi - 1e-3) continue;
          const tt = (f.elevationM - a.z) / (b.z - a.z);
          crossings.push({ u: a.u + (b.u - a.u) * tt, z: f.elevationM, color });
        }
      }
      ctx.globalAlpha = 1;
      const flowing = (fr?.total ?? 0) > 1e-6;
      if (l.link.kind === 'belt' || flowing) {
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = Math.max(1.2, width * 0.28);
        drawChevrons(ctx, vp, pts, 22, Math.max(2.5, width * 0.45), flowing ? phase.current : 0);
      }
    }
    for (const c of crossings) {
      const s = vp.toScreen(toWorld(c.u, c.z));
      ctx.fillStyle = COLORS.bg;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y);
      ctx.lineTo(s.x, s.y + 6);
      ctx.lineTo(s.x - 6, s.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    drawLabel(ctx, axis === 'x' ? t('Blick von Süden: links = −x, rechts = +x, oben = Höhe') : t('Blick von Osten: links = −y, rechts = +y, oben = Höhe'), vp.width - 10, 16, {
      align: 'right',
      size: 11,
      color: COLORS.textDim,
    });
  }

  return (
    <div className="editor" data-tour="factory-canvas">
      <canvas ref={canvasRef} className="editor-canvas" tabIndex={0} data-tool="select" />
      <EditorToolbar />
      <div className="editor-status">
        <span ref={statusRef} />
        <span className="editor-hint">{t('Seitenansicht: Gebäude oder Leitung anklicken zum Auswählen · ziehen: seitlich und in der Höhe verschieben (Alt: ohne Fangen) · O: Pumpe senkrecht/waagrecht · Mausrad: zoomen · rechte Maustaste: Ansicht verschieben')}</span>
      </div>
    </div>
  );
}
