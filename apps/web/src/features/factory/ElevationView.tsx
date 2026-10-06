/**
 * Seitenansicht einer Fabrik über alle Stockwerke (Schnitt entlang x oder y).
 * Zeigt Stockwerksebenen, Gebäudehöhen aus den Kollisionsboxen und den
 * Höhenverlauf von Förderbändern und Rohren (Lifte senkrecht).
 */
import { useEffect, useMemo, useRef } from 'react';
import { buildingFootprint, cachedFactoryFlow, controlPoints, routePath, worldPorts } from '@satis/core';
import { useCanvas } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { CATEGORY_COLORS, COLORS, drawLabel, formatM } from '../../canvas/draw';
import { t } from '../../i18n';
import { useFindingMarks } from '../../state/derived';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { EditorToolbar } from './EditorToolbar';

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

export function ElevationView({ axis }: { axis: 'x' | 'y' }) {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
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
    const links: { id: string; kind: 'belt' | 'pipe'; pts: { u: number; z: number }[] }[] = [];
    for (const l of Object.values(project.links)) {
      if (l.factoryId !== factoryId) continue;
      const a = project.buildings[l.from.buildingId];
      const b = project.buildings[l.to.buildingId];
      if (!a?.placement || !b?.placement) continue;
      const pa = worldPorts(a, gd.building(a.type)!, project.floors[a.placement.floorId]).find((x) => x.id === l.from.portId);
      const pb = worldPorts(b, gd.building(b.type)!, project.floors[b.placement.floorId]).find((x) => x.id === l.to.portId);
      if (!pa || !pb) continue;
      links.push({ id: l.id, kind: l.kind, pts: routePath(controlPoints(pa, pb, l.waypoints), l.routing).map((p) => ({ u: u(p), z: p.z })) });
    }
    const floors = (project.factories[factoryId]?.floorIds ?? []).map((id) => project.floors[id]!).filter(Boolean);
    return { boxes, links, floors };
  }, [project, gd, factoryId, axis]);
  const flow = useMemo(() => cachedFactoryFlow(project, gd, factoryId), [project, gd, factoryId]);

  const live = useRef({ data, selection, marks, floorId, flow });
  live.current = { data, selection, marks, floorId, flow };

  const toWorld = (u: number, z: number) => ({ x: u, y: -z });

  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const z = -e.world.y;
      const hitBox = [...live.current.data.boxes].reverse().find((b) => e.world.x >= b.u0 && e.world.x <= b.u1 && z >= b.z0 && z <= b.z1);
      useUiStore.getState().select(hitBox ? [{ table: 'buildings', id: hitBox.id }] : []);
    },
    onPointerMove: (e) => {
      if (statusRef.current) statusRef.current.textContent = `${axis} ${e.world.x.toFixed(1)} m · z ${(-e.world.y).toFixed(1)} m`;
    },
  });
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
      ctx.globalAlpha = 0.8;
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
    // Leitungen
    for (const l of L.data.links) {
      const fr = L.flow.links.get(l.id);
      const over = fr && fr.required > fr.capacity + 1e-6;
      ctx.strokeStyle = sel.has(l.id) ? COLORS.selection : over ? COLORS.overload : l.kind === 'belt' ? COLORS.belt : COLORS.pipe;
      ctx.lineWidth = 3;
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
        <span className="editor-hint">{t('Seitenansicht: Gebäude anklicken zum Auswählen · Mausrad: zoomen · rechte Maustaste: verschieben · Bearbeiten im Grundriss')}</span>
      </div>
    </div>
  );
}
