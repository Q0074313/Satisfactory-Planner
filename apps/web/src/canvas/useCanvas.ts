/**
 * Gemeinsame Canvas-Infrastruktur: Größe/DPI, Zeichenschleife, Zoom und
 * Verschieben der Ansicht. Werkzeuge erhalten Zeigerereignisse in
 * Weltkoordinaten.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Viewport, type Vec } from './viewport';

export interface PointerInfo {
  screen: Vec;
  world: Vec;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface CanvasHandlers {
  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void;
  onPointerDown?(e: PointerInfo): void;
  onPointerMove?(e: PointerInfo): void;
  onPointerUp?(e: PointerInfo): void;
  onDoubleClick?(e: PointerInfo): void;
  onViewportChange?(vp: Viewport): void;
  /** Liefert true, solange jedes Bild neu gezeichnet werden soll (Animation). */
  animating?(): boolean;
  /** Wird bei laufender Animation einmal je Bild mit der Zeit seit dem letzten Bild aufgerufen. */
  onFrame?(dtS: number): void;
}

export function useCanvas(handlers: CanvasHandlers) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vpRef = useRef(new Viewport());
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const dirty = useRef(true);

  // Stabile Identität: wird in Effekt-Abhängigkeiten verwendet.
  const requestDraw = useCallback(() => {
    dirty.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const vp = vpRef.current;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let panning: { x: number; y: number } | null = null;
    let spaceDown = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      vp.width = rect.width;
      vp.height = rect.height;
      dirty.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (handlersRef.current.animating?.()) {
        handlersRef.current.onFrame?.(dt);
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, vp.width, vp.height);
        handlersRef.current.draw(ctx, vp);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const info = (e: PointerEvent | MouseEvent): PointerInfo => {
      const rect = canvas.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      return { screen, world: vp.toWorld(screen), button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    };

    const onDown = (e: PointerEvent) => {
      canvas.focus();
      if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
        panning = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      handlersRef.current.onPointerDown?.(info(e));
      dirty.current = true;
    };
    const onMove = (e: PointerEvent) => {
      if (panning) {
        vp.panBy(e.clientX - panning.x, e.clientY - panning.y);
        panning = { x: e.clientX, y: e.clientY };
        handlersRef.current.onViewportChange?.(vp);
        dirty.current = true;
        return;
      }
      handlersRef.current.onPointerMove?.(info(e));
      dirty.current = true;
    };
    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (panning) {
        panning = null;
        return;
      }
      handlersRef.current.onPointerUp?.(info(e));
      dirty.current = true;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      vp.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, factor);
      handlersRef.current.onViewportChange?.(vp);
      dirty.current = true;
    };
    const onDbl = (e: MouseEvent) => handlersRef.current.onDoubleClick?.(info(e));
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement === canvas) {
        spaceDown = true;
        canvas.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false;
        canvas.style.cursor = '';
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return { canvasRef, viewport: vpRef.current, requestDraw };
}
