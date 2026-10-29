/**
 * Grafische Darstellung eines Produktionsergebnisses: Versorgung → Rezepte →
 * Ziele/Überschüsse. Kantenbreite ∝ Menge, Farbe je Gegenstand. Knoten lassen
 * sich verschieben; die Verschiebung bleibt für denselben Graphen erhalten,
 * solange die Seite offen ist.
 */
import { useMemo, useRef, useState } from 'react';
import { buildFlowGraph, layoutFlowGraph, type FlowNodeKind, type SolveResult } from '@satis/core';
import { t, formatNumber } from '../../i18n';
import { useProjectStore } from '../../state/projectStore';

const KIND_CLASS: Record<FlowNodeKind, string> = {
  supply: 'fn-supply',
  recipe: 'fn-recipe',
  target: 'fn-target',
  surplus: 'fn-surplus',
  shortfall: 'fn-shortfall',
};

type Offsets = Record<string, { dx: number; dy: number }>;
/** Verschobene Knoten je Graph (Schlüssel: Knoten-IDs), nur im Speicher. */
const savedOffsets = new Map<string, Offsets>();

function itemHue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function FlowDiagram({ result }: { result: SolveResult }) {
  const gd = useProjectStore((s) => s.gd)!;
  const layout = useMemo(() => layoutFlowGraph(buildFlowGraph(gd, result)), [gd, result]);
  const [k, setK] = useState(1);
  const box = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const graphKey = useMemo(() => layout.nodes.map((n) => n.id).sort().join('|'), [layout]);
  const [offsets, setOffsetsState] = useState<Offsets>(() => savedOffsets.get(graphKey) ?? {});
  const [offsetsKey, setOffsetsKey] = useState(graphKey);
  if (offsetsKey !== graphKey) {
    setOffsetsKey(graphKey);
    setOffsetsState(savedOffsets.get(graphKey) ?? {});
  }
  const setOffsets = (o: Offsets) => {
    savedOffsets.set(graphKey, o);
    setOffsetsState(o);
  };
  const nodeDrag = useRef<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const nodes = layout.nodes.map((n) => {
    const o = offsets[n.id];
    return o ? { ...n, x: Math.max(0, n.x + o.dx), y: Math.max(0, n.y + o.dy) } : n;
  });
  const maxRate = Math.max(1, ...layout.edges.map((e) => e.perMin));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Anschlusspunkte je Knoten verteilen
  const outIdx = new Map<string, number>();
  const inIdx = new Map<string, number>();
  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of layout.edges) {
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  }
  if (layout.nodes.length === 0) return <p className="dim pad">{t('Kein Ergebnis zum Darstellen.')}</p>;
  const W = Math.max(layout.width, 400, ...nodes.map((n) => n.x + n.w + 20));
  const H = Math.max(layout.height, 200, ...nodes.map((n) => n.y + n.h + 60));
  const unit = (item: string) => (gd.item(item)?.form === 'solid' ? '/min' : 'm³/min');

  return (
    <div className="flow-diagram" data-testid="flow-diagram">
      <div className="flow-toolbar">
        <button className="small" onClick={() => setK((v) => Math.min(3, v * 1.25))}>
          +
        </button>
        <button className="small" onClick={() => setK((v) => Math.max(0.3, v / 1.25))}>
          −
        </button>
        <button className="small" onClick={() => setK(1)}>
          100 %
        </button>
        {Object.keys(offsets).length > 0 && (
          <button className="small" onClick={() => setOffsets({})} data-testid="flow-reset">
            {t('Anordnung zurücksetzen')}
          </button>
        )}
        <span className="dim small-text">{t('Strg+Mausrad: zoomen · Ziehen: Ansicht verschieben · Knoten ziehen: Knoten verschieben · Linien zeigen Mengen je Gegenstand (proportional verteilt)')}</span>
        <span className="spacer" />
        <span className="legend">
          <span className="fn-supply">{t('Versorgung')}</span>
          <span className="fn-recipe">{t('Rezept')}</span>
          <span className="fn-target">{t('Ziel')}</span>
          <span className="fn-surplus">{t('Überschuss')}</span>
          <span className="fn-shortfall">{t('Fehlmenge')}</span>
        </span>
      </div>
      <div
        className="flow-scroll"
        ref={box}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setK((v) => Math.min(3, Math.max(0.3, v * Math.exp(-e.deltaY * 0.0015))));
        }}
        onMouseDown={(e) => box.current && (drag.current = { x: e.clientX, y: e.clientY, sl: box.current.scrollLeft, st: box.current.scrollTop })}
        onMouseMove={(e) => {
          const nd = nodeDrag.current;
          if (nd) {
            const dx = nd.dx + (e.clientX - nd.x) / k;
            const dy = nd.dy + (e.clientY - nd.y) / k;
            if (Math.abs(e.clientX - nd.x) + Math.abs(e.clientY - nd.y) > 2) nd.moved = true;
            if (nd.moved) setOffsets({ ...offsets, [nd.id]: { dx, dy } });
            return;
          }
          if (!drag.current || !box.current) return;
          box.current.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
          box.current.scrollTop = drag.current.st - (e.clientY - drag.current.y);
        }}
        onMouseUp={() => {
          drag.current = null;
          nodeDrag.current = null;
        }}
        onMouseLeave={() => {
          drag.current = null;
          nodeDrag.current = null;
        }}
      >
      <svg viewBox={`0 0 ${W} ${H}`} width={W * k} height={H * k}>
        <g>
          {layout.edges.map((e, i) => {
            const a = byId.get(e.from)!;
            const b = byId.get(e.to)!;
            const oi = outIdx.get(e.from) ?? 0;
            outIdx.set(e.from, oi + 1);
            const ii = inIdx.get(e.to) ?? 0;
            inIdx.set(e.to, ii + 1);
            const y1 = a.y + (a.h * (oi + 1)) / ((outCount.get(e.from) ?? 1) + 1);
            const y2 = b.y + (b.h * (ii + 1)) / ((inCount.get(e.to) ?? 1) + 1);
            const x1 = a.x + a.w;
            const x2 = b.x;
            const width = 1.5 + 10 * Math.sqrt(e.perMin / maxRate);
            const hue = itemHue(e.itemId);
            let d: string;
            if (e.back || x2 <= x1) {
              const low = Math.max(a.y + a.h, b.y + b.h) + 30 + (i % 3) * 8;
              d = `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x1 + 60} ${low}, ${(x1 + x2) / 2} ${low} S ${x2 - 60} ${y2}, ${x2} ${y2}`;
            } else {
              const mx = (x1 + x2) / 2;
              d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            }
            const key = `${e.from}>${e.to}>${e.itemId}`;
            const dim = hover && hover !== e.itemId;
            return (
              <g key={key} onMouseEnter={() => setHover(e.itemId)} onMouseLeave={() => setHover(null)}>
                <path d={d} fill="none" stroke={`hsl(${hue} 65% 55%)`} strokeOpacity={dim ? 0.12 : 0.75} strokeWidth={width} strokeDasharray={e.back ? '6 4' : undefined}>
                  <title>{`${gd.name(e.itemId)}: ${formatNumber(e.perMin, 2)} ${unit(e.itemId)}${e.back ? ` (${t('Kreislauf')})` : ''}`}</title>
                </path>
                {!dim && width > 3 && (
                  <text className="fn-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - width / 2 - 2} textAnchor="middle">
                    {formatNumber(e.perMin, 1)}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x} ${n.y})`}
              className={`${KIND_CLASS[n.kind]} fn-node`}
              data-node={n.id}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const o = offsets[n.id] ?? { dx: 0, dy: 0 };
                nodeDrag.current = { id: n.id, x: e.clientX, y: e.clientY, dx: o.dx, dy: o.dy, moved: false };
              }}
            >
              <rect width={n.w} height={n.h} rx={5} />
              <text x={8} y={18} className="fn-title">
                {n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label}
                <title>{n.label}</title>
              </text>
              <text x={8} y={35} className="fn-sub">
                {n.sublabel.length > 34 ? `${n.sublabel.slice(0, 33)}…` : n.sublabel}
                <title>{n.sublabel}</title>
              </text>
            </g>
          ))}
        </g>
      </svg>
      </div>
    </div>
  );
}
