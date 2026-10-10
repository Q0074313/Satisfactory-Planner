/**
 * Grafischer Schieneneditor (Canvas 2D) mit Zuganimation aus der Simulation.
 */
import { produce } from 'immer';
import { useEffect, useMemo, useRef } from 'react';
import {
  closestT,
  factoryOps,
  segmentMinRadius,
  geo,
  lengthAtT,
  outward,
  railOps as ops,
  segmentPolyline,
  segmentShape,
  tAtLength,
  type ObjectRef,
  type Project,
  type Vec3,
} from '@satis/core';
import { useCanvas, type PointerInfo } from '../../canvas/useCanvas';
import type { Viewport } from '../../canvas/viewport';
import { COLORS, drawDimension, drawGrid, drawLabel, formatM, pathPolygon, pathPolyline } from '../../canvas/draw';
import { t } from '../../i18n';
import { matchAction } from '../../state/keymap';
import { useFindingMarks } from '../../state/derived';
import { RAIL_SNAP_STEPS, usePrefs, type RailSnap } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useSimStore } from '../../state/simStore';
import { useUiStore, type RailTool } from '../../state/uiStore';
import { buildRailScene, railHitTest, sceneCrossings, signalGlyph, stationGeometry, type RailHit } from './scene';

const BLOCK_COLORS = ['#e8a33d', '#4fc3ff', '#9be7a1', '#ff8a8a', '#c49bff', '#ffe08a', '#7fe0d6', '#ff9fd2', '#b3c7ff', '#d6ff8a'];

type Endpoint = ops.TrackEndpoint;

interface Interaction {
  cursor: geo.Vec2;
  hover: RailHit;
  from: Endpoint | null;
  drag:
    | { kind: 'node'; id: string; start: geo.Vec2; delta: geo.Vec2; moved: boolean }
    | { kind: 'station'; id: string; start: geo.Vec2; delta: geo.Vec2; moved: boolean }
    | { kind: 'marquee'; start: geo.Vec2; current: geo.Vec2 }
    | { kind: 'group'; refs: ObjectRef[]; start: geo.Vec2; delta: geo.Vec2; moved: boolean }
    | null;
  /** Feste Fahrtrichtung am Ende des entstehenden Gleises (Mausrad, absolut zum Raster); null = automatisch. */
  endHeading: number | null;
  /** Aufsummierte Raddrehung bis zur nächsten Winkelstufe. */
  wheelAcc: number;
  measureStart: geo.Vec2 | null;
  shift: boolean;
  alt: boolean;
}

/** Ziel des Signalwerkzeugs unter dem Mauszeiger. */
type SignalTarget =
  | { kind: 'node'; nodeId: string; pos: geo.Vec2; dir: geo.Vec2; facing: 'forward' | 'backward' }
  | { kind: 'segment'; segId: string; t: number; pos: geo.Vec2; dir: geo.Vec2; facing: 'forward' | 'backward'; fromA: number; toB: number };

/** Raddrehung je Winkelstufe beim Gleisbau (Pixel-Delta; eine Rastung ≈ 100). */
const WHEEL_PER_STEP = 200;

/** Fangbereich des Signalwerkzeugs seitlich neben dem Gleis (m). */
const SIGNAL_CAPTURE_M = 3;
/** Raster für Signale auf freiem Gleis entlang des Gleises (m). */
const SIGNAL_STEP_M = 1;

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

/** Rechte Seite der Fahrtrichtung (y nach unten). */
const rightOf = (d: geo.Vec2) => geo.rotate(d, 90);

/** Signal als Pfeil neben dem Gleis mit Haltelinie am Knoten. */
function drawSignalSymbol(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  node: geo.Vec2,
  dir: geo.Vec2,
  kind: 'block' | 'path',
  opts: { selected?: boolean; mark?: 'error' | 'warning'; ghost?: boolean },
) {
  const color = kind === 'path' ? COLORS.pathSignal : COLORS.blockSignal;
  const glyph = signalGlyph(node, dir, vp.scale);
  const r = glyph.r;
  const right = rightOf(dir);
  const n = vp.toScreen(node);
  const head = vp.toScreen(glyph.head);
  const sd = { x: dir.x, y: dir.y };
  const sr = { x: right.x, y: right.y };
  ctx.globalAlpha = opts.ghost ? 0.6 : 1;
  // Haltelinie quer über das Gleis (rechte Hälfte) und Mast zum Signal
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, r * 0.45);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(n.x - sr.x * r * 0.9, n.y - sr.y * r * 0.9);
  ctx.lineTo(n.x + sr.x * r * 0.9, n.y + sr.y * r * 0.9);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(n.x + sr.x * r * 0.9, n.y + sr.y * r * 0.9);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
  // Pfeil in Fahrtrichtung (Spitze vorn)
  const tip = { x: head.x + sd.x * r * 1.2, y: head.y + sd.y * r * 1.2 };
  const bl = { x: head.x - sd.x * r * 0.8 - sr.x * r * 0.9, y: head.y - sd.y * r * 0.8 - sr.y * r * 0.9 };
  const br = { x: head.x - sd.x * r * 0.8 + sr.x * r * 0.9, y: head.y - sd.y * r * 0.8 + sr.y * r * 0.9 };
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = opts.selected ? COLORS.selection : opts.mark === 'error' ? COLORS.error : opts.mark === 'warning' ? COLORS.warning : COLORS.signalInk;
  ctx.lineWidth = opts.selected || opts.mark ? 2.5 : 1;
  ctx.stroke();
  drawLabel(ctx, kind === 'path' ? 'P' : 'B', head.x, head.y, { size: Math.max(8, r * 0.9), color: COLORS.signalInk });
  ctx.globalAlpha = 1;
}

export function RailEditor() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const apply = useProjectStore((s) => s.apply);
  const networkId = useUiStore((s) => s.networkId)!;
  const selection = useUiStore((s) => s.selection);
  const tool = useUiStore((s) => s.railTool);
  const layers = useUiStore((s) => s.railLayers);
  const focus = useUiStore((s) => s.focus);
  const theme = usePrefs((s) => s.theme);
  const playing = useSimStore((s) => s.playing);
  const marks = useFindingMarks();
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const scene = useMemo(() => buildRailScene(project, networkId), [project, networkId]);

  const it = useRef<Interaction>({ cursor: { x: 0, y: 0 }, hover: null, from: null, drag: null, measureStart: null, shift: false, alt: false, endHeading: null, wheelAcc: 0 });
  const railSnap = usePrefs((s) => s.railSnap);
  const live = useRef({ project, scene, selection, tool, layers, marks, networkId, gd });
  live.current = { project, scene, selection, tool, layers, marks, networkId, gd };

  const { canvasRef, viewport, requestDraw } = useCanvas({
    draw: (ctx, vp) => draw(ctx, vp),
    onPointerDown: (e) => pointerDown(e),
    onPointerMove: (e) => pointerMove(e),
    onPointerUp: () => pointerUp(),
    onViewportChange: () => updateStatus(),
    onWheel: (e) => wheel(e),
    animating: () => useSimStore.getState().playing,
    onFrame: (dt) => useSimStore.getState().advance(dt),
  });

  useEffect(requestDraw, [scene, selection, tool, layers, marks, theme, playing, railSnap, requestDraw]);
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId]);
  // Änderungen am Netz machen eine laufende Simulation ungültig
  useEffect(() => {
    const s = useSimStore.getState();
    if (s.sim && (s.source !== project || s.networkId !== networkId)) s.reset();
  }, [project, networkId]);
  useEffect(() => {
    if (!focus) return;
    viewport.cx = focus.x;
    viewport.cy = focus.y;
    if (viewport.scale < 2) viewport.scale = 3;
    requestDraw();
  }, [focus, viewport, requestDraw]);
  useEffect(() => {
    it.current.from = null;
    it.current.measureStart = null;
    it.current.endHeading = null;
    requestDraw();
  }, [tool.kind, requestDraw]);

  function fitView() {
    const pts = live.current.scene.segments.flatMap((s) => s.points);
    if (pts.length === 0) {
      viewport.cx = 0;
      viewport.cy = 0;
      viewport.scale = 2;
    } else viewport.fit(geo.rectOf(pts), 60);
    requestDraw();
  }

  function updateStatus() {
    const el = statusRef.current;
    if (!el) return;
    const c = it.current.cursor;
    el.textContent = `x ${c.x.toFixed(1)} m · y ${c.y.toFixed(1)} m · ${t('Maßstab')} ${formatM(100 / viewport.scale)} / 100 px`;
  }

  const tolM = () => 7 / viewport.scale;
  // Gleisraster (Einstellung im Editor, Standard 4 m: Ecken, Kantenmitten und Mitten der Fundamente)
  const snapStep = () => usePrefs.getState().railSnap.stepM;
  const snapPt = (p: geo.Vec2, free: boolean) => (free ? p : geo.snapToGrid(p, usePrefs.getState().railSnap.stepM, 'corner'));
  const trackLimits = () => {
    const gd = live.current.gd;
    return { minLen: gd.fact('rail.track.minSegmentLengthM') ?? 12, maxLen: gd.fact('rail.track.maxSegmentLengthM') ?? 100, minR: gd.fact('rail.track.minTurnRadiusM') ?? 17 };
  };

  /**
   * Mausrad beim Gleisbau: Richtung am Gleisende in Winkelstufen des Rasters
   * (Vielfache von 15°, Umschalt: 5°). Erst nach etwa zwei Rastungen des
   * Rads geht es eine Stufe weiter. Strg + Rad zoomt.
   */
  function wheel(e: PointerInfo & { deltaY: number }): boolean {
    const i = it.current;
    if (live.current.tool.kind !== 'track' || !i.from || e.ctrl || e.deltaY === 0) return false;
    i.wheelAcc += e.deltaY;
    if (Math.abs(i.wheelAcc) < WHEEL_PER_STEP) return true;
    const dir = Math.sign(i.wheelAcc);
    i.wheelAcc = 0;
    const step = e.shift ? 5 : 15;
    // Ausgangswert: aktuelle (automatische) Richtung, auf die nächste Stufe in Drehrichtung
    let base = i.endHeading;
    if (base === null) {
      const { ep, splitSeg } = endpointAt(i.cursor, live.current.tool.z);
      const pv = previewTrack(i.from, ep, splitSeg);
      const a = pv?.pts.at(-2);
      const b = pv?.pts.at(-1);
      base = a && b ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : 0;
      base = (dir > 0 ? Math.floor(base / step + 1e-6) : Math.ceil(base / step - 1e-6)) * step;
    } else base = Math.round(base / step) * step;
    i.endHeading = geo.normalizeDeg(base + dir * step + 180) - 180;
    return true;
  }

  function hit(pt: geo.Vec2, segTolM?: number): RailHit {
    return railHitTest(live.current.scene, live.current.project, pt, tolM(), { nodes: true, segments: true, stations: true, scale: viewport.scale, segTolM });
  }

  /** Endpunkt für das Gleiswerkzeug unter dem Mauszeiger. */
  function endpointAt(pt: geo.Vec2, z: number): { ep: Endpoint; splitSeg?: { id: string; t: number } } {
    const L = live.current;
    const h = hit(pt);
    if (h?.kind === 'node') return { ep: { kind: 'node', nodeId: h.id } };
    if (h?.kind === 'segment') {
      const seg = L.project.railSegments[h.id];
      const shape = seg && segmentShape(L.project, seg);
      if (seg && shape && !seg.stationId) {
        const c = closestT(shape, pt);
        if (c.t > 0.05 && c.t < 0.95) return { ep: { kind: 'node', nodeId: '__split__' }, splitSeg: { id: h.id, t: c.t } };
      }
    }
    let p = snapPt(pt, it.current.alt);
    // Umschalt: gerade Fortsetzung entlang der Tangente
    const from = it.current.from;
    if (it.current.shift && from?.kind === 'node') {
      const n = L.project.railNodes[from.nodeId];
      if (n) {
        const side = ops.continueSide(L.project, n, pt);
        const d = outward(n, side);
        const along = Math.max(1, geo.dot(geo.sub(pt, n.position), d));
        p = geo.add(n.position, geo.scale(d, along));
      }
    }
    return { ep: { kind: 'point', position: { x: p.x, y: p.y, z }, headingDeg: it.current.endHeading ?? undefined } };
  }

  /**
   * Ziel des Signalwerkzeugs: Knoten oder Stelle auf einem Segment. Die Seite
   * des Mauszeigers neben dem Gleis bestimmt die Fahrtrichtung (Signal steht
   * rechts der Fahrtrichtung); der Mauszeiger darf bis 3 m neben dem Gleis
   * stehen. Auf Segmenten rastet die Stelle in 1-m-Schritten (Alt: frei), und
   * es gilt der Mindestabstand zum Segmentende (Wiki: 12 m); näher am Ende wird
   * der Knoten verwendet.
   */
  function signalTarget(pt: geo.Vec2): SignalTarget | null {
    const L = live.current;
    const h = hit(pt, SIGNAL_CAPTURE_M);
    const facingFor = (pos: geo.Vec2, dir: geo.Vec2) => (geo.dot(geo.sub(pt, pos), rightOf(dir)) >= 0 ? 'forward' : 'backward');
    const nodeTarget = (nodeId: string): SignalTarget | null => {
      const n = L.project.railNodes[nodeId];
      if (!n) return null;
      const d = geo.dirFromDeg(n.headingDeg);
      const facing = facingFor(n.position, d);
      return { kind: 'node', nodeId, pos: n.position, dir: facing === 'forward' ? d : geo.scale(d, -1), facing };
    };
    if (h?.kind === 'node') return nodeTarget(h.id);
    if (h?.kind !== 'segment') return null;
    const seg = L.project.railSegments[h.id];
    const shape = seg && segmentShape(L.project, seg);
    if (!seg || !shape) return null;
    const c = closestT(shape, pt);
    const len = lengthAtT(shape, 1);
    const minD = L.gd.fact('rail.signal.minDistanceFromSegmentEndM') ?? 12;
    if (seg.stationId) return nodeTarget(c.t < 0.5 ? seg.a.nodeId : seg.b.nodeId);
    let along = lengthAtT(shape, c.t);
    if (!it.current.alt) along = Math.round(along / SIGNAL_STEP_M) * SIGNAL_STEP_M;
    if (along < minD) return nodeTarget(seg.a.nodeId);
    if (len - along < minD) return nodeTarget(seg.b.nodeId);
    const t = tAtLength(shape, along);
    const pos = geo.bezierPoint(shape.curve, t);
    const tan = geo.normalize(geo.bezierDerivative(shape.curve, t));
    const facing = facingFor(pos, tan);
    return { kind: 'segment', segId: seg.id, t, pos, dir: facing === 'forward' ? tan : geo.scale(tan, -1), facing, fromA: along, toB: len - along };
  }

  // ------------------------------------------------------------------ Zeichnen

  function draw(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const L = live.current;
    const sc = L.scene;
    const sel = new Set(L.selection.map((s) => s.id));
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);
    if (L.layers.grid) drawGrid(ctx, vp, L.project.settings.gridM, 0);

    if (L.layers.otherNetworks) {
      ctx.strokeStyle = COLORS.otherNetwork;
      ctx.lineWidth = Math.max(1.5, vp.scale * 1.2);
      for (const s of sc.others) {
        pathPolyline(ctx, vp, s.points);
        ctx.stroke();
      }
    }

    // Bahnhöfe (unter den Gleisen)
    for (const st of sc.stations) {
      pathPolygon(ctx, vp, st.outline);
      ctx.fillStyle = COLORS.station;
      ctx.fill();
      ctx.strokeStyle = sel.has(st.station.id) ? COLORS.selection : COLORS.stationStroke;
      ctx.lineWidth = sel.has(st.station.id) ? 2 : 1;
      ctx.stroke();
      pathPolygon(ctx, vp, st.building);
      ctx.fillStyle = COLORS.stationBuilding;
      ctx.fill();
      st.platforms.forEach((poly, i) => {
        pathPolygon(ctx, vp, poly);
        ctx.strokeStyle = COLORS.stationStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        const pf = st.station.platforms[i]!;
        if (L.layers.labels && vp.scale > 1.2) {
          const c = poly.reduce((a, q) => ({ x: a.x + q.x / 4, y: a.y + q.y / 4 }), { x: 0, y: 0 });
          const s = vp.toScreen(c);
          const txt = pf.type === 'empty' ? t('leer') : `${pf.type === 'fluid' ? t('Flüssig') : t('Güter')} ${pf.mode === 'load' ? '↑' : '↓'}`;
          drawLabel(ctx, txt, s.x, s.y + 14, { size: 10, color: COLORS.textDim });
        }
      });
      if (L.layers.labels) {
        const c = st.building.reduce((a, q) => ({ x: a.x + q.x / 4, y: a.y + q.y / 4 }), { x: 0, y: 0 });
        const s = vp.toScreen(c);
        drawLabel(ctx, st.station.name, s.x, s.y - 14, { size: 11, bg: COLORS.labelBg });
      }
    }

    // Gleise
    const blockIds = [...sc.analysis.blocks.blocks.keys()].sort();
    const blockColor = new Map(blockIds.map((id, i) => [id, BLOCK_COLORS[i % BLOCK_COLORS.length]!]));
    const netColor = L.project.railNetworks[L.networkId]?.color ?? COLORS.text;
    // Vom gewählten Signal geschützter Block
    const selSig = L.selection.find((s) => s.table === 'railSignals');
    const protectedBlock = selSig ? sc.analysis.blocks.signalInfo.get(selSig.id)?.entryBlock : null;
    for (const s of sc.segments) {
      const block = sc.analysis.blocks.blockOf.get(s.id);
      const mark = L.marks.get(s.id);
      let color = L.layers.blocks && block ? blockColor.get(block)! : netColor;
      if (sel.has(s.id)) color = COLORS.selection;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, Math.min(vp.scale * (s.isStation ? 2.2 : 1.6), 12));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      pathPolyline(ctx, vp, s.points);
      ctx.stroke();
      if (protectedBlock && block === protectedBlock) {
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = Math.max(4, Math.min(vp.scale * 2.6, 16));
        ctx.globalAlpha = 0.35;
        pathPolyline(ctx, vp, s.points);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (mark) {
        ctx.strokeStyle = mark === 'error' ? COLORS.error : COLORS.warning;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        pathPolyline(ctx, vp, s.points);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Kreuzungen
    if (L.layers.crossings) {
      for (const c of sceneCrossings(sc)) {
        const s = vp.toScreen(c.point);
        ctx.strokeStyle = c.sameLevel ? COLORS.warning : COLORS.textDim;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y - 6);
        ctx.lineTo(s.x + 6, s.y + 6);
        ctx.moveTo(s.x + 6, s.y - 6);
        ctx.lineTo(s.x - 6, s.y + 6);
        ctx.stroke();
        if (L.layers.labels && vp.scale > 1) {
          const label = c.sameLevel ? t('Kreuzung (gleiche Höhe)') : t('Überführung Δh {h} m', { h: Math.abs(c.zA - c.zB).toFixed(1) });
          drawLabel(ctx, label, s.x + 10, s.y - 10, { size: 10, align: 'left', color: c.sameLevel ? COLORS.warning : COLORS.textDim });
        }
      }
    }

    // Knoten
    if (L.layers.nodes && vp.scale > 0.6) {
      for (const n of sc.nodes) {
        const s = vp.toScreen(n.pos);
        const isSwitch = n.a > 1 || n.b > 1;
        const isEnd = n.a === 0 || n.b === 0;
        ctx.fillStyle = sel.has(n.id) ? COLORS.selection : isSwitch ? COLORS.nodeSwitch : isEnd ? COLORS.nodeEnd : COLORS.node;
        const r = isSwitch ? 5 : 3.5;
        ctx.beginPath();
        if (isSwitch) {
          ctx.moveTo(s.x, s.y - r);
          ctx.lineTo(s.x + r, s.y);
          ctx.lineTo(s.x, s.y + r);
          ctx.lineTo(s.x - r, s.y);
          ctx.closePath();
        } else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (L.layers.labels && n.pos.z !== 0 && vp.scale > 1.5) drawLabel(ctx, `${n.pos.z} m`, s.x + 8, s.y + 10, { size: 9, align: 'left', color: COLORS.textDim });
        if (sel.has(n.id) || (it.current.hover?.kind === 'node' && it.current.hover.id === n.id)) {
          const d = geo.dirFromDeg(n.headingDeg);
          const tip = vp.toScreen(geo.add(n.pos, geo.scale(d, 18 / vp.scale + 2)));
          ctx.strokeStyle = COLORS.selection;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(tip.x, tip.y);
          ctx.stroke();
          drawLabel(ctx, 'B', tip.x, tip.y, { size: 9, color: COLORS.selection });
        }
      }
    }

    // Signale: Haltelinie, Mast und Pfeil in Fahrtrichtung
    for (const sg of sc.signals) {
      drawSignalSymbol(ctx, vp, sg.node, sg.dir, sg.signal.kind, { selected: sel.has(sg.signal.id), mark: L.marks.get(sg.signal.id) });
    }

    // Maße (netzunabhängig: factoryId/floorId = null)
    for (const m of Object.values(L.project.measurements)) {
      if (m.factoryId !== null || m.floorId !== null) continue;
      drawDimension(ctx, vp, m.from, m.to, m.label || undefined, sel.has(m.id) ? COLORS.selection : COLORS.measure);
    }

    if (L.layers.trains) drawTrains(ctx, vp);
    drawToolOverlay(ctx, vp, L.tool);

    // Verschieben: betroffene Gleise gestrichelt an der neuen Lage
    const dg = it.current.drag;
    if (dg && dg.kind !== 'marquee' && dg.moved) {
      const refs: ObjectRef[] = dg.kind === 'group' ? dg.refs : [{ table: dg.kind === 'node' ? 'railNodes' : 'stations', id: dg.id }];
      const ids = new Set(ops.nodesOfSelection(L.project, refs));
      const delta = { x: dg.delta.x, y: dg.delta.y, z: 0 };
      produce(L.project, (d: Project) => {
        ops.moveNodes(d, [...ids], delta);
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = Math.max(2, vp.scale * 1.2);
        ctx.setLineDash([6, 4]);
        for (const seg of Object.values(d.railSegments)) {
          if (seg.networkId !== L.networkId || (!ids.has(seg.a.nodeId) && !ids.has(seg.b.nodeId))) continue;
          const shape = segmentShape(d, seg);
          if (!shape) continue;
          pathPolyline(ctx, vp, segmentPolyline(shape, 24));
          ctx.stroke();
        }
        ctx.setLineDash([]);
      });
      const c = vp.toScreen(it.current.cursor);
      drawLabel(ctx, `Δx ${formatM(dg.delta.x)}  Δy ${formatM(dg.delta.y)}`, c.x + 14, c.y + 18, { align: 'left', bg: COLORS.labelBg });
    }

    if (it.current.drag?.kind === 'marquee') {
      const a = vp.toScreen(it.current.drag.start);
      const b = vp.toScreen(it.current.drag.current);
      ctx.strokeStyle = COLORS.selection;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
  }

  function drawTrains(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const s = useSimStore.getState();
    if (!s.sim || s.networkId !== live.current.networkId) return;
    const w = Math.max(6, Math.min(vp.scale * 3.2, 20));
    const vehicleM = live.current.gd.fact('rail.freightCar.lengthM') ?? 16;
    for (const tr of s.sim.trains) {
      const pts = s.sim.trainPolyline(tr);
      if (pts.length < 2) continue;
      // Kontrast zu Blockfarben und Bahnhöfen: Abstand in Hintergrundfarbe,
      // kräftige Kontur in Textfarbe, darin die Zugfarbe
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = w + 8;
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = w + 4;
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = w;
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
      // Dunkler Mittelstreifen: Zug unterscheidet sich auch bei gleicher Farbe vom Gleis
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = Math.max(1.5, w * 0.28);
      pathPolyline(ctx, vp, pts);
      ctx.stroke();
      // Fahrzeuggrenzen alle 16 m
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let acc = 0;
      let next = vehicleM;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]!;
        const b = pts[k]!;
        const len = geo.dist(a, b);
        while (len > 1e-9 && acc + len >= next - 1e-6 && next < tr.lengthM - 1e-6) {
          const q = geo.add(a, geo.scale(geo.sub(b, a), (next - acc) / len));
          const n = geo.rotate(geo.normalize(geo.sub(b, a)), 90);
          const p1 = vp.toScreen(geo.add(q, geo.scale(n, w / 2 / vp.scale)));
          const p2 = vp.toScreen(geo.add(q, geo.scale(n, -w / 2 / vp.scale)));
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          next += vehicleM;
        }
        acc += len;
      }
      ctx.stroke();
      // Zugspitze als Pfeil in Fahrtrichtung
      const head = vp.toScreen(pts[0]!);
      const behind = vp.toScreen(pts[1]!);
      const dx = head.x - behind.x;
      const dy = head.y - behind.y;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl;
      const uy = dy / dl;
      ctx.fillStyle = COLORS.text;
      ctx.beginPath();
      ctx.moveTo(head.x + ux * w * 0.9, head.y + uy * w * 0.9);
      ctx.lineTo(head.x - uy * w * 0.75, head.y + ux * w * 0.75);
      ctx.lineTo(head.x + uy * w * 0.75, head.y - ux * w * 0.75);
      ctx.closePath();
      ctx.fill();
      const status =
        tr.status === 'waiting' ? ` ⏸ ${t('wartet')}` : tr.status === 'docked' ? ` ⛁ ${Math.max(0, Math.ceil(tr.dockRemaining))} s` : tr.status === 'no-route' ? ` ⚠ ${t('kein Weg')}` : '';
      drawLabel(ctx, `${tr.name}${status}`, head.x + 10, head.y - 12, { size: 11, align: 'left', bg: COLORS.labelBg, color: tr.status === 'no-route' ? COLORS.error : COLORS.text });
    }
    const lbl = `${t('Simulation')} t = ${formatTime(s.sim.time)}${s.sim.deadlock ? ` · ${t('Deadlock!')}` : ''}`;
    drawLabel(ctx, lbl, vp.width - 12, 16, { align: 'right', size: 12, bg: COLORS.labelBg, color: s.sim.deadlock ? COLORS.error : COLORS.text });
  }

  /**
   * Vorschau eines Gleisstücks über einen temporären Entwurf, mit Länge,
   * kleinstem Radius und – falls nicht baubar – dem Grund (Mindestlänge,
   * Höchstlänge, Mindestradius laut Wiki).
   */
  function previewTrack(from: Endpoint, to: Endpoint, split?: { id: string; t: number }): { pts: Vec3[]; len: number; radius: number; problem: string | null } | null {
    const L = live.current;
    try {
      let out: { pts: Vec3[]; len: number; radius: number; problem: string | null } | null = null;
      produce(L.project, (d: Project) => {
        let target = to;
        if (split) target = { kind: 'node', nodeId: ops.splitSegment(d, split.id, split.t) };
        const r = ops.addTrack(d, L.networkId, from, target);
        const shape = segmentShape(d, d.railSegments[r.segmentId]!);
        if (!shape) return;
        const len = lengthAtT(shape, 1);
        const radius = segmentMinRadius(shape);
        const lim = trackLimits();
        const problem =
          len < lim.minLen - 1e-6
            ? t('Gleis zu kurz: {len} (mindestens {min} m)', { len: formatM(len), min: lim.minLen })
            : len > lim.maxLen + 1e-6
              ? t('Gleis zu lang: {len} (höchstens {max} m) – Zwischenpunkt setzen', { len: formatM(len), max: lim.maxLen })
              : radius < lim.minR - 1e-6
                ? t('Kurve zu eng: Radius {r} (mindestens {min} m)', { r: formatM(radius), min: lim.minR })
                : null;
        out = { pts: segmentPolyline(shape, 24), len, radius, problem };
      });
      return out;
    } catch {
      return null;
    }
  }

  function drawToolOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, tl: RailTool) {
    const L = live.current;
    const i = it.current;
    if (tl.kind === 'track') {
      const { ep, splitSeg } = endpointAt(i.cursor, tl.z);
      const pos = ep.kind === 'point' ? ep.position : splitSeg ? null : L.project.railNodes[ep.nodeId]?.position;
      const markAt = pos ?? (splitSeg ? closestPointOnSeg(splitSeg.id, i.cursor) : null);
      if (markAt) {
        const s = vp.toScreen(markAt);
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
      }
      if (i.from) {
        const pv = previewTrack(i.from, ep, splitSeg);
        if (pv) {
          ctx.strokeStyle = pv.problem ? COLORS.error : COLORS.selection;
          ctx.lineWidth = Math.max(2, vp.scale * 1.6);
          ctx.globalAlpha = 0.6;
          pathPolyline(ctx, vp, pv.pts);
          ctx.stroke();
          ctx.globalAlpha = 1;
          const last = vp.toScreen(pv.pts.at(-1)!);
          const parts = [formatM(pv.len)];
          if (Number.isFinite(pv.radius) && pv.radius < 1000) parts.push(`R ${formatM(pv.radius)}`);
          if (i.endHeading !== null) parts.push(`∠ ${i.endHeading}°`);
          drawLabel(ctx, parts.join(' · '), last.x + 12, last.y - 12, { align: 'left', bg: COLORS.labelBg });
          if (pv.problem) drawLabel(ctx, pv.problem, last.x + 12, last.y + 6, { align: 'left', bg: COLORS.labelBg, color: COLORS.error, size: 10 });
        }
      }
    }
    if (tl.kind === 'signal') {
      const target = signalTarget(i.cursor);
      if (target) {
        drawSignalSymbol(ctx, vp, target.pos, target.dir, tl.signalKind, { ghost: true, selected: true });
        const s = vp.toScreen(geo.add(target.pos, geo.scale(rightOf(target.dir), 8 / vp.scale + 6)));
        const what = tl.signalKind === 'path' ? t('Pfadsignal') : t('Blocksignal');
        const where = target.kind === 'segment' ? `${t('teilt das Gleis')} (${formatM(target.fromA)} | ${formatM(target.toB)})` : t('am Knoten');
        drawLabel(ctx, `${what} · ${where} · ${t('Fahrt in Pfeilrichtung')}`, s.x + 8, s.y, { align: 'left', bg: COLORS.labelBg, size: 10 });
      }
    }
    if (tl.kind === 'station') {
      const ghost = stationGhost(tl);
      if (ghost) {
        pathPolygon(ctx, vp, ghost.outline);
        ctx.strokeStyle = COLORS.selection;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        pathPolygon(ctx, vp, ghost.building);
        ctx.fillStyle = COLORS.ghost;
        ctx.fill();
        const a = vp.toScreen(geo.add(ghost.front, geo.scale(ghost.dir, -8)));
        const b = vp.toScreen(geo.add(ghost.front, geo.scale(ghost.dir, 6)));
        ctx.strokeStyle = COLORS.selection;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    if (tl.kind === 'measure' && i.measureStart) drawDimension(ctx, vp, i.measureStart, measureEnd());
  }

  function closestPointOnSeg(segId: string, pt: geo.Vec2): geo.Vec2 | null {
    const L = live.current;
    const seg = L.project.railSegments[segId];
    const shape = seg && segmentShape(L.project, seg);
    if (!shape) return null;
    return geo.bezierPoint(shape.curve, closestT(shape, pt).t);
  }

  function stationGhost(tl: Extract<RailTool, { kind: 'station' }>) {
    const L = live.current;
    const i = it.current;
    const h = i.hover;
    try {
      let ghost = null as ReturnType<typeof stationGeometry>;
      produce(L.project, (d: Project) => {
        const id = ops.addStation(d, {
          networkId: L.networkId,
          name: '',
          position: { ...snapPt(i.cursor, i.alt), z: 0 },
          headingDeg: tl.rotationDeg,
          platforms: Array.from({ length: tl.platforms }, () => ({ type: tl.platformType, mode: 'load' as const, flipped: false })),
          backNodeId: h?.kind === 'node' ? h.id : undefined,
        });
        ghost = stationGeometry(d, d.stations[id]!);
      });
      return ghost;
    } catch {
      return null;
    }
  }

  function measureEnd(): geo.Vec2 {
    const i = it.current;
    const p = snapPt(i.cursor, i.alt);
    if (i.measureStart && i.shift) {
      const dx = Math.abs(p.x - i.measureStart.x);
      const dy = Math.abs(p.y - i.measureStart.y);
      return dx >= dy ? { x: p.x, y: i.measureStart.y } : { x: i.measureStart.x, y: p.y };
    }
    return p;
  }

  // ------------------------------------------------------------------ Eingaben

  function hitToRef(h: RailHit): ObjectRef | null {
    if (!h) return null;
    const table = { signal: 'railSignals', node: 'railNodes', segment: 'railSegments', station: 'stations', measurement: 'measurements' } as const;
    return { table: table[h.kind], id: h.id };
  }

  function pointerDown(e: PointerInfo) {
    const L = live.current;
    const i = it.current;
    i.shift = e.shift;
    i.alt = e.alt;
    if (e.button !== 0) return;
    const tl = L.tool;
    const ui = useUiStore.getState();

    if (tl.kind === 'select') {
      const h = hit(e.world);
      const ref = hitToRef(h);
      if (ref) {
        const already = L.selection.some((s) => s.id === ref.id);
        const next = e.shift ? (already ? L.selection.filter((s) => s.id !== ref.id) : [...L.selection, ref]) : already ? L.selection : [ref];
        if (next !== L.selection) ui.select(next);
        const inSel = next.some((s) => s.id === ref.id);
        // Mehrere Objekte oder ein Gleisstück: alles Ausgewählte gemeinsam verschieben
        if (inSel && (next.length > 1 || h?.kind === 'segment')) i.drag = { kind: 'group', refs: next, start: e.world, delta: { x: 0, y: 0 }, moved: false };
        else if (h?.kind === 'node') i.drag = { kind: 'node', id: h.id, start: e.world, delta: { x: 0, y: 0 }, moved: false };
        else if (h?.kind === 'station') i.drag = { kind: 'station', id: h.id, start: e.world, delta: { x: 0, y: 0 }, moved: false };
      } else {
        if (!e.shift) ui.select([]);
        i.drag = { kind: 'marquee', start: e.world, current: e.world };
      }
      return;
    }

    if (tl.kind === 'track') {
      const { ep, splitSeg } = endpointAt(e.world, tl.z);
      if (!i.from) {
        if (!splitSeg) {
          i.from = ep;
          return;
        }
        const nodeId = apply(t('Gleis teilen'), (d) => ops.splitSegment(d, splitSeg.id, splitSeg.t));
        if (nodeId) i.from = { kind: 'node', nodeId };
        return;
      }
      const from = i.from;
      // Mindestlänge, Höchstlänge und Mindestradius vor dem Bauen prüfen
      const pv = previewTrack(from, ep, splitSeg);
      if (pv?.problem && !e.ctrl) {
        ui.toast(`${pv.problem} ${t('(Strg + Klick: trotzdem bauen)')}`, 'error');
        return;
      }
      const r = apply(t('Gleis zeichnen'), (d) => {
        const target: Endpoint = splitSeg ? { kind: 'node', nodeId: ops.splitSegment(d, splitSeg.id, splitSeg.t) } : ep;
        return ops.addTrack(d, L.networkId, from, target);
      });
      if (r) {
        i.from = { kind: 'node', nodeId: r.toNodeId };
        i.endHeading = null;
      }
      return;
    }

    if (tl.kind === 'signal') {
      const h = hit(e.world);
      if (h?.kind === 'signal') {
        const sig = L.project.railSignals[h.id]!;
        if (sig.kind !== tl.signalKind) apply(t('Signaltyp ändern'), (d) => ops.updateSignal(d, h.id, { kind: tl.signalKind }));
        else apply(t('Signal entfernen'), (d) => ops.removeSignals(d, [h.id]));
        return;
      }
      const target = signalTarget(e.world);
      if (!target) {
        ui.toast(t('Signale werden auf ein Gleis oder an einen Gleisknoten gesetzt.'), 'info');
        return;
      }
      if (target.kind === 'segment') {
        const r = apply(t('Signal setzen'), (d) => ops.addSignalOnSegment(d, target.segId, target.t, tl.signalKind, target.facing));
        if (r) ui.select([{ table: 'railSignals', id: r.signalId }]);
        return;
      }
      const existing = Object.values(L.project.railSignals).find((s) => s.nodeId === target.nodeId && s.facing === target.facing);
      if (existing) {
        if (existing.kind !== tl.signalKind) apply(t('Signaltyp ändern'), (d) => ops.updateSignal(d, existing.id, { kind: tl.signalKind }));
        else apply(t('Signal entfernen'), (d) => ops.removeSignals(d, [existing.id]));
      } else {
        const id = apply(t('Signal setzen'), (d) => ops.addSignal(d, target.nodeId, tl.signalKind, target.facing));
        if (id) ui.select([{ table: 'railSignals', id }]);
      }
      return;
    }

    if (tl.kind === 'station') {
      const h = hit(e.world);
      const count = Object.keys(L.project.stations).length + 1;
      const id = apply(t('Bahnhof anlegen'), (d) =>
        ops.addStation(d, {
          networkId: L.networkId,
          name: t('Bahnhof {n}', { n: count }),
          position: { ...snapPt(e.world, e.alt), z: 0 },
          headingDeg: tl.rotationDeg,
          platforms: Array.from({ length: tl.platforms }, () => ({ type: tl.platformType, mode: 'load' as const, flipped: false })),
          backNodeId: h?.kind === 'node' ? h.id : undefined,
        }),
      );
      if (id) {
        ui.select([{ table: 'stations', id }]);
        ui.setRailTool({ kind: 'select' });
      }
      return;
    }

    if (tl.kind === 'measure') {
      const p = measureEnd();
      if (!i.measureStart) i.measureStart = p;
      else {
        const from = i.measureStart;
        apply(t('Maß hinzufügen'), (d) => factoryOps.addMeasurement(d, { factoryId: null, floorId: null, from: { ...from, z: 0 }, to: { ...p, z: 0 } }));
        i.measureStart = null;
      }
    }
  }

  function pointerMove(e: PointerInfo) {
    const i = it.current;
    i.cursor = e.world;
    i.shift = e.shift;
    i.alt = e.alt;
    const d = i.drag;
    if (d && (d.kind === 'node' || d.kind === 'station' || d.kind === 'group')) {
      const raw = { x: e.world.x - d.start.x, y: e.world.y - d.start.y };
      const step = snapStep();
      // Bezugspunkt rastet im Gleisraster: Knoten bzw. hinterer Bahnhofsknoten bzw. erster Knoten der Auswahl
      const L = live.current;
      const anchorId =
        d.kind === 'node' ? d.id : d.kind === 'station' ? L.project.stations[d.id]?.backNodeId : ops.nodesOfSelection(L.project, d.refs)[0];
      const anchor = anchorId ? L.project.railNodes[anchorId]?.position : undefined;
      if (e.alt || step <= 0 || !anchor) d.delta = raw;
      else {
        const target = snapPt(geo.add(anchor, raw), false);
        d.delta = geo.sub(target, anchor);
      }
      if (Math.hypot(raw.x, raw.y) * viewport.scale > 3) d.moved = true;
    } else if (d?.kind === 'marquee') d.current = e.world;
    else i.hover = hit(e.world);
    updateStatus();
  }

  function pointerUp() {
    const L = live.current;
    const d = it.current.drag;
    it.current.drag = null;
    if (!d) return;
    if (d.kind === 'group' && d.moved && (d.delta.x || d.delta.y)) {
      const delta = { x: d.delta.x, y: d.delta.y, z: 0 };
      apply(t('Auswahl verschieben'), (p) => ops.moveSelection(p, d.refs, delta));
    }
    if ((d.kind === 'node' || d.kind === 'station') && d.moved && (d.delta.x || d.delta.y)) {
      const delta = { x: d.delta.x, y: d.delta.y, z: 0 };
      if (d.kind === 'station') apply(t('Bahnhof verschieben'), (p) => ops.moveStation(p, d.id, delta));
      else {
        const st = Object.values(L.project.stations).find((s) => s.backNodeId === d.id || s.frontNodeId === d.id);
        if (st) apply(t('Bahnhof verschieben'), (p) => ops.moveStation(p, st.id, delta));
        else apply(t('Knoten verschieben'), (p) => ops.moveNodes(p, [d.id], delta));
      }
    }
    if (d.kind === 'marquee') {
      const r = geo.rectOf([d.start, d.current]);
      if (r.maxX - r.minX < tolM() && r.maxY - r.minY < tolM()) return;
      const refs: ObjectRef[] = [];
      for (const s of L.scene.segments) if (s.points.every((q) => geo.rectContains(r, q))) refs.push({ table: 'railSegments', id: s.id });
      for (const sg of L.scene.signals) if (geo.rectContains(r, signalGlyph(sg.node, sg.dir, viewport.scale).head)) refs.push({ table: 'railSignals', id: sg.signal.id });
      useUiStore.getState().select(refs);
    }
  }

  // ------------------------------------------------------------------ Tastatur

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.defaultPrevented) return;
      const L = live.current;
      const ui = useUiStore.getState();
      const tl = L.tool;
      if (e.key === 'Escape') {
        if (it.current.drag?.kind === 'group') it.current.drag = null;
        else if (it.current.from || it.current.measureStart) {
          it.current.from = null;
          it.current.measureStart = null;
          it.current.endHeading = null;
        } else if (tl.kind !== 'select') ui.setRailTool({ kind: 'select' });
        else ui.select([]);
        requestDraw();
        return;
      }
      const action = matchAction(e, 'rail', usePrefs.getState().bindings);
      if (!action) return;
      switch (action) {
        case 'rail.delete':
          if (L.selection.length && tl.kind === 'select') {
            e.preventDefault();
            deleteSelection(L.selection);
          }
          break;
        case 'rail.rotate':
        case 'rail.rotateBack': {
          const delta = (action === 'rail.rotateBack' ? -1 : 1) * (L.project.settings.snapAngleDeg || 90);
          if (tl.kind === 'station') ui.setRailTool({ ...tl, rotationDeg: geo.normalizeDeg(tl.rotationDeg + delta) });
          else {
            const st = L.selection.find((s) => s.table === 'stations');
            if (st) apply(t('Bahnhof drehen'), (p) => ops.moveStation(p, st.id, { x: 0, y: 0, z: 0 }, delta));
          }
          break;
        }
        case 'rail.flip': {
          const n = L.selection.find((s) => s.table === 'railNodes');
          if (n) apply(t('Knotenachse umkehren'), (p) => ops.flipNode(p, n.id));
          break;
        }
        case 'rail.fit':
          fitView();
          break;
        case 'rail.zoomIn':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 1.25);
          break;
        case 'rail.zoomOut':
          viewport.zoomAt({ x: viewport.width / 2, y: viewport.height / 2 }, 0.8);
          break;
        case 'rail.select':
          ui.setRailTool({ kind: 'select' });
          break;
        case 'rail.track':
          ui.setRailTool({ kind: 'track', z: tl.kind === 'track' ? tl.z : 0 });
          break;
        case 'rail.block':
          ui.setRailTool({ kind: 'signal', signalKind: 'block' });
          break;
        case 'rail.path':
          ui.setRailTool({ kind: 'signal', signalKind: 'path' });
          break;
        case 'rail.station':
          ui.setRailTool({ kind: 'station', platforms: 2, platformType: 'freight', rotationDeg: 0 });
          break;
        case 'rail.measure':
          ui.setRailTool({ kind: 'measure' });
          break;
        case 'rail.play': {
          const s = useSimStore.getState();
          if (!s.playing) s.ensure(L.project, L.gd, L.networkId);
          s.setPlaying(!s.playing);
          break;
        }
      }
      requestDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function deleteSelection(sel: ObjectRef[]) {
    const of = (tb: string) => sel.filter((s) => s.table === tb).map((s) => s.id);
    apply(t('Löschen'), (d) => {
      const sigs = of('railSignals').filter((id) => d.railSignals[id]);
      if (sigs.length) ops.removeSignals(d, sigs);
      for (const id of of('stations')) if (d.stations[id]) ops.removeStation(d, id);
      const segs = of('railSegments').filter((id) => d.railSegments[id] && !d.railSegments[id]!.stationId);
      if (segs.length) ops.removeSegments(d, segs);
      const nodes = of('railNodes').filter((id) => d.railNodes[id]);
      if (nodes.length) ops.removeNodes(d, nodes);
      for (const id of of('measurements')) delete d.measurements[id];
    });
    useUiStore.getState().select([]);
  }

  return (
    <div className="editor" data-tour="rail-canvas">
      <canvas ref={canvasRef} className="editor-canvas" tabIndex={0} data-tool={tool.kind === 'select' ? 'select' : 'place'} />
      <RailSnapBar value={railSnap} onChange={(v) => usePrefs.getState().setRailSnap(v)} />
      <div className="editor-status">
        <span ref={statusRef} />
        <span className="editor-hint">{railHint(tool)}</span>
      </div>
    </div>
  );
}

/** Fangraster des Schieneneditors. */
function RailSnapBar({ value, onChange }: { value: RailSnap; onChange: (v: RailSnap) => void }) {
  return (
    <div
      className="editor-toolbar rail-snap"
      data-testid="rail-snap"
      title={t('4 m trifft im Fundamentraster Ecken, Kantenmitten und Mitten der Fundamente; 1 m für Feinarbeit. Alt: ohne Fangen.')}
    >
      <span className="dim small-text">{t('Raster')}</span>
      {RAIL_SNAP_STEPS.map((step) => (
        <button key={step} className={`small ${value.stepM === step ? 'active' : ''}`} onClick={() => onChange({ stepM: step })} data-testid={`rail-snap-${step}`}>
          {step} m
        </button>
      ))}
    </div>
  );
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')} min`;
}

function railHint(tl: RailTool): string {
  switch (tl.kind) {
    case 'select':
      return t('Klicken: auswählen (Umschalt: mehrere, Rahmen aufziehen) · Ziehen: Auswahl verschieben (im Gleisraster, Alt: frei) · R: Bahnhof drehen · F: Knotenachse umkehren · Entf: löschen · T: Simulation');
    case 'track':
      return t('Klicken: Start/nächster Punkt (tangentialer Bogen) · Mausrad: Richtung am Gleisende in 15°-Stufen zum Raster (Umschalt: 5°, Strg + Rad: zoomen) · Knoten/Gleis anklicken: verbinden bzw. abzweigen · Umschalt: gerade · Alt: ohne Fangen · Strg + Klick: trotz Mindestmaß bauen · Esc: Zug beenden');
    case 'signal':
      return t('Auf ein Gleis (bis 3 m daneben) oder einen Knoten klicken – Seite neben dem Gleis = Fahrtrichtung (Signal steht rechts, Pfeil zeigt die Fahrt) · auf freiem Gleis in 1-m-Schritten, Alt: stufenlos · erneut klicken: entfernen bzw. Typ wechseln');
    case 'station':
      return t('Klicken: Bahnhof setzen (auf freien Knoten: anschließen) · R: drehen · Fahrtrichtung beim Halten = Pfeil');
    case 'measure':
      return t('Zwei Punkte anklicken · Umschalt: waagrecht/senkrecht');
  }
}
