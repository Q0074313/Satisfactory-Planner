/**
 * Seitenansicht einer Fabrik über alle Stockwerke (Schnitt entlang x oder y).
 * Zeigt Stockwerksebenen, Gebäudehöhen aus den Kollisionsboxen und den
 * Höhenverlauf von Förderbändern und Rohren (Lifte senkrecht).
 */
import { useEffect, useMemo, useRef } from 'react';
import { buildingFootprint, cachedFactoryFlow, controlPoints, factoryOps as ops, geo, routePath, worldPorts } from '@satis/core';
import { useCanvas } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { CATEGORY_COLORS, COLORS, drawLabel, formatM } from '../../canvas/draw';
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
  color: string;
  label: string;
  floorId: string;
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
  const marks = useFindingMarks();
  const statusRef = useRef<HTMLSpanElement | null>(null);

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
        color: CATEGORY_COLORS[def.category] ?? '#555',
        label: b.label || gd.name(b.type),
        floorId: b.placement.floorId,
      });
    }
    const links: { id: string; kind: 'belt' | 'pipe'; color: string; width: number; pts: { u: number; z: number }[] }[] = [];
    for (const l of Object.values(project.links)) {
      if (l.factoryId !== factoryId) continue;
      const a = project.buildings[l.from.buildingId];
      const b = project.buildings[l.to.buildingId];
      if (!a?.placement || !b?.placement) continue;
      const pa = worldPorts(a, gd.building(a.type)!, project.floors[a.placement.floorId]).find((x) => x.id === l.from.portId);
      const pb = worldPorts(b, gd.building(b.type)!, project.floors[b.placement.floorId]).find((x) => x.id === l.to.portId);
      if (!pa || !pb) continue;
      const style = linkTierStyle(gd, l);
      links.push({ id: l.id, kind: l.kind, color: style.color, width: 2 + style.widthFactor * 1.5, pts: routePath(controlPoints(pa, pb, l.waypoints), l.routing).map((p) => ({ u: u(p), z: p.z })) });
    }
    const floors = (project.factories[factoryId]?.floorIds ?? []).map((id) => project.floors[id]!).filter(Boolean);
    return { boxes, links, floors };
  }, [project, gd, factoryId, axis]);
  const flow = useMemo(() => cachedFactoryFlow(project, gd, factoryId), [project, gd, factoryId]);

  const live = useRef({ data, selection, marks, floorId, flow });
  live.current = { data, selection, marks, floorId, flow };

  const toWorld = (u: number, z: number) => ({ x: u, y: -z });

  const snapStep = () => useProjectStore.getState().project?.settings.snapM ?? 1;
  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const z = -e.world.y;
      const hitBox = [...live.current.data.boxes].reverse().find((b) => e.world.x >= b.u0 && e.world.x <= b.u1 && z >= b.z0 && z <= b.z1);
      useUiStore.getState().select(hitBox ? [{ table: 'buildings', id: hitBox.id }] : []);
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
  useEffect(requestDraw, [data, selection, marks, theme, requestDraw]);
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
      ctx.fillStyle = b.color;
      ctx.globalAlpha = drag.current?.moved && drag.current.id === b.id ? 0.35 : 0.8;
      ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
      ctx.globalAlpha = 1;
      const mark = L.marks.get(b.id);
      ctx.strokeStyle = sel.has(b.id) ? COLORS.selection : mark === 'error' ? COLORS.error : mark === 'warning' ? COLORS.warning : COLORS.outline;
      ctx.lineWidth = sel.has(b.id) || mark ? 2 : 1;
      ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
      if (c.x - a.x > 50) drawLabel(ctx, b.label, (a.x + c.x) / 2, (a.y + c.y) / 2, { size: 10, color: '#f2f2f2' });
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
    // Leitungen
    for (const l of L.data.links) {
      const fr = L.flow.links.get(l.id);
      const over = fr && fr.required > fr.capacity + 1e-6;
      ctx.strokeStyle = sel.has(l.id) ? COLORS.selection : over ? COLORS.overload : l.color;
      ctx.lineWidth = l.width;
      ctx.beginPath();
      l.pts.forEach((p, i) => {
        const s = vp.toScreen(toWorld(p.u, p.z));
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
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
        <span className="editor-hint">{t('Seitenansicht: Gebäude anklicken zum Auswählen · ziehen: seitlich und in der Höhe verschieben (Alt: ohne Fangen) · O: Pumpe senkrecht/waagrecht · Mausrad: zoomen · rechte Maustaste: Ansicht verschieben')}</span>
      </div>
    </div>
  );
}
