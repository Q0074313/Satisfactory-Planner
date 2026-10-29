/**
 * 3D-Ansicht einer Fabrik (nur ansehen, nicht bearbeiten): Gebäude als Körper
 * aus ihren Kollisionsboxen mit Namen, Förderbänder als flache Bahnen, Rohre
 * als runde Rohre, Bau- und Fundamentflächen als Platten (wahlweise mit
 * Fundamentraster). Das links gewählte Stockwerk ist der Schnitt: Stockwerke
 * darüber sind ausgeblendet; Bild hoch/runter wechselt es auch hier. Keine
 * Spielmodelle – die Formen sind die Planungsboxen aus den Spieldaten.
 *
 * Koordinaten: Planer (x, y, z) → three.js (x, z, y), d. h. y oben in three.js
 * ist die Höhe; von oben gesehen entspricht das dem Grundriss.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { cachedFactoryFlow, type ObjectRef } from '@satis/core';
import { COLORS } from '../../canvas/draw';
import { t } from '../../i18n';
import { matchAction } from '../../state/keymap';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { EditorToolbar } from './EditorToolbar';
import { arrowCount, buildItems, hoverInfo, placeArrows, v3, type Item3D, type Kind3D, type Label3D } from './scene3d';

/** Namen weiter weg als das bleiben ausgeblendet (sonst überdecken sie sich). */
const LABEL_MAX_DIST = 450;

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
};

interface Shown {
  object: THREE.Object3D;
  item: Item3D;
  edges?: THREE.LineSegments;
}

export default function View3D() {
  const project = useProjectStore((s) => s.project)!;
  const gd = useProjectStore((s) => s.gd)!;
  const factoryId = useUiStore((s) => s.factoryId)!;
  const floorId = useUiStore((s) => s.floorId);
  const selection = useUiStore((s) => s.selection);
  const theme = usePrefs((s) => s.theme);
  const colors = usePrefs((s) => s.colors);
  const animate = usePrefs((s) => s.animateFlow);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbove, setShowAbove] = useState(false);
  const [showLinks, setShowLinks] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [showArrows, setShowArrows] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const floors = useMemo(
    () => (project.factories[factoryId]?.floorIds ?? []).map((id) => project.floors[id]!).filter(Boolean).sort((a, b) => a.elevationM - b.elevationM),
    [project, factoryId],
  );
  /** Schnitt: Stockwerke bis einschließlich des gewählten (oder alle). */
  const visibleFloors = useMemo(() => {
    const cut = project.floors[floorId ?? '']?.elevationM ?? Infinity;
    return new Set(floors.filter((f) => showAbove || f.elevationM <= cut + 1e-6).map((f) => f.id));
  }, [floors, floorId, showAbove, project]);

  const built = useMemo(() => buildItems(project, gd, factoryId, showGrid), [project, gd, factoryId, showGrid]);
  /** Leitungen mit Durchsatz (nur deren Pfeile laufen). */
  const flowing = useMemo(() => {
    const flow = cachedFactoryFlow(project, gd, factoryId);
    return new Set([...flow.links.values()].filter((l) => l.total > 1e-6).map((l) => l.linkId));
  }, [project, gd, factoryId]);

  const live = useRef<{
    renderer: THREE.WebGLRenderer;
    labels: CSS2DRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    shown: Shown[];
    names: { object: CSS2DObject; label: Label3D }[];
    framedFor: string | null;
    render: () => void;
    info: (ref: ObjectRef) => string[];
    /** Pfeile animieren (Einstellung „Materialfluss animieren“ und Pfeile sichtbar). */
    animate: boolean;
    flowing: Set<string>;
    showNames: boolean;
  } | null>(null);
  if (live.current) {
    live.current.info = (ref) => hoverInfo(project, gd, factoryId, ref);
    live.current.flowing = flowing;
  }

  // Renderer, Kamera und Steuerung einmalig anlegen
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(t('Die 3D-Ansicht braucht WebGL, das in diesem Browser nicht verfügbar ist.'));
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.className = 'editor-canvas';
    renderer.domElement.dataset.testid = 'view3d-canvas';
    host.prepend(renderer.domElement);
    // Namen als HTML über der Szene: in jeder Entfernung scharf
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'view3d-labels';
    host.insertBefore(labels.domElement, renderer.domElement.nextSibling);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI * 0.495;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.6, 1, -0.4);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    let frame = 0;
    const start = performance.now();
    const draw = () => {
      const L = live.current;
      if (L?.animate) {
        const time = (performance.now() - start) / 1000;
        for (const s of L.shown) {
          if (s.item.kind !== 'arrow' || !s.object.visible || !L.flowing.has(s.item.ref.id)) continue;
          const mesh = s.object as THREE.InstancedMesh;
          placeArrows(s.item.arrows!, time * (s.item.speed ?? 2), (i, m) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      if (L) declutter(L.names, L.showNames, camera, host.clientWidth, host.clientHeight);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const moving = controls.update();
        draw();
        if (moving || live.current?.animate) render();
      });
    };
    controls.addEventListener('change', render);
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Klick (ohne Ziehen) wählt aus, Überfahren zeigt ein Schild mit Infos.
    // Böden und Flächen verdecken, was darunter liegt (keine Auswahl durch den Boden).
    const ray = new THREE.Raycaster();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const L = live.current;
      if (!L) return null;
      const targets = L.shown.filter((s) => s.object.visible && s.item.kind !== 'arrow' && s.item.kind !== 'grid').map((s) => s.object);
      const hit = ray.intersectObjects(targets, false)[0];
      const item = hit ? (L.shown.find((s) => s.object === hit.object)?.item ?? null) : null;
      return item && item.kind !== 'area' ? item : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      const item = pick(e);
      useUiStore.getState().select(item ? [item.ref] : []);
    };
    const tip = (lines: string[], e?: PointerEvent) => {
      const el = tipRef.current;
      if (!el) return;
      if (!lines.length || !e) {
        el.hidden = true;
        return;
      }
      el.replaceChildren(...lines.map((l, i) => Object.assign(document.createElement(i === 0 ? 'b' : 'div'), { textContent: l })));
      const r = host.getBoundingClientRect();
      el.style.left = `${e.clientX - r.left + 14}px`;
      el.style.top = `${e.clientY - r.top + 14}px`;
      el.hidden = false;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return tip([]);
      const item = pick(e);
      const lines = item && live.current ? live.current.info(item.ref) : [];
      if (statusRef.current) statusRef.current.textContent = lines[0] ?? '';
      tip(lines, e);
    };
    const onLeave = () => tip([]);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    // Bild hoch/runter: Stockwerk wechseln (wie im Grundriss)
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || e.defaultPrevented) return;
      const action = matchAction(e, 'factory', usePrefs.getState().bindings);
      if (action !== 'factory.floorUp' && action !== 'factory.floorDown') return;
      e.preventDefault();
      const ui = useUiStore.getState();
      const p = useProjectStore.getState().project;
      const ids = [...(p?.factories[ui.factoryId ?? '']?.floorIds ?? [])].sort((a, b) => (p!.floors[a]?.elevationM ?? 0) - (p!.floors[b]?.elevationM ?? 0));
      const next = ids[ids.indexOf(ui.floorId ?? '') + (action === 'factory.floorUp' ? 1 : -1)];
      if (next) ui.setFloor(next);
    };
    window.addEventListener('keydown', onKey);

    live.current = { renderer, labels, scene, camera, controls, group, shown: [], names: [], framedFor: null, render, info: () => [], animate: false, flowing: new Set(), showNames: true };
    return () => {
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      clear(live.current);
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
      live.current = null;
    };
  }, []);

  // Körper neu aufbauen, wenn sich die Fabrik ändert
  useEffect(() => {
    const L = live.current;
    if (!L) return;
    clear(L);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
    for (const item of built.items) {
      let object: THREE.Object3D;
      if (item.kind === 'grid') {
        object = new THREE.LineSegments(item.geometry, new THREE.LineBasicMaterial({ color: item.color, transparent: true, opacity: item.opacity }));
      } else if (item.kind === 'arrow') {
        const mesh = new THREE.InstancedMesh(item.geometry, new THREE.MeshBasicMaterial({ color: item.color, side: THREE.DoubleSide }), arrowCount(item.arrows!));
        placeArrows(item.arrows!, 0, (i, m) => mesh.setMatrixAt(i, m));
        object = mesh;
      } else {
        object = new THREE.Mesh(
          item.geometry,
          new THREE.MeshStandardMaterial({
            color: item.color,
            transparent: item.opacity < 1,
            opacity: item.opacity,
            // Rohre glänzen metallisch, Bänder und Gebäude matt
            roughness: item.kind === 'pipe' ? 0.35 : 0.75,
            metalness: item.kind === 'pipe' ? 0.45 : 0.05,
            side: item.kind === 'building' || item.kind === 'area' ? THREE.DoubleSide : THREE.FrontSide,
            depthWrite: item.opacity >= 1,
          }),
        );
      }
      L.group.add(object);
      let edges: THREE.LineSegments | undefined;
      if (item.kind === 'building') {
        edges = new THREE.LineSegments(new THREE.EdgesGeometry(item.geometry, 30), edgeMat);
        L.group.add(edges);
      }
      L.shown.push({ object, item, edges });
    }
    for (const label of built.labels) {
      const el = document.createElement('div');
      el.className = 'view3d-label';
      el.textContent = label.text;
      const object = new CSS2DObject(el);
      object.position.copy(label.at);
      L.group.add(object);
      L.names.push({ object, label });
    }
    // Kamera beim ersten Mal bzw. bei einer anderen Fabrik auf alles ausrichten
    if (L.framedFor !== factoryId) {
      L.framedFor = factoryId;
      const box = new THREE.Box3();
      for (const s of L.shown) if (s.item.kind !== 'arrow') box.expandByObject(s.object);
      if (box.isEmpty()) box.set(v3(-40, -40, 0), v3(40, 40, 10));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      L.controls.target.copy(center);
      L.camera.position.copy(center).add(new THREE.Vector3(-0.55, 0.65, 0.75).multiplyScalar(Math.max(30, size * 0.6)));
      L.camera.far = Math.max(2000, size * 20);
      L.camera.updateProjectionMatrix();
      L.controls.update();
    }
    L.render();
  }, [built, factoryId]);

  // Sichtbarkeit (Schnitt und Optionen), Auswahl, Animation und Farbschema
  useEffect(() => {
    const L = live.current;
    if (!L) return;
    L.scene.background = new THREE.Color(COLORS.bg);
    const sel = new Set(selection.map((s) => s.id));
    const onFloor = (f: string | null) => !f || visibleFloors.has(f);
    const kinds: Record<Kind3D, boolean> = { building: true, belt: showLinks, pipe: showLinks, arrow: showLinks && showArrows, area: showAreas, grid: showAreas };
    for (const { object, item, edges } of L.shown) {
      const visible = onFloor(item.floorId) && kinds[item.kind];
      object.visible = visible;
      if (edges) edges.visible = visible;
      if (item.kind === 'arrow') {
        // Animation aus: Pfeile zurück in die Mitte ihrer Teilstücke
        if (!animate) {
          const mesh = object as THREE.InstancedMesh;
          placeArrows(item.arrows!, 0, (i, m) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
        }
        continue;
      }
      if (item.kind === 'grid') continue;
      const mat = (object as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissive.set(sel.has(item.ref.id) ? COLORS.selection : '#000000');
      mat.emissiveIntensity = sel.has(item.ref.id) ? 0.6 : 0;
    }
    for (const n of L.names) n.object.userData.onFloor = onFloor(n.label.floorId);
    L.showNames = showNames;
    L.animate = animate && showLinks && showArrows;
    L.render();
  }, [built, visibleFloors, showLinks, showAreas, showNames, showArrows, selection, theme, colors, animate]);

  const check = (label: string, value: boolean, set: (v: boolean) => void, testId?: string, title?: string) => (
    <label className="check-row small-text" title={title}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );

  return (
    <div className="editor" data-tour="factory-canvas" ref={hostRef} data-testid="view3d">
      {error && <p className="pad dim">{error}</p>}
      <EditorToolbar />
      <div className="view3d-panel">
        <b className="small-text" title={t('Das gewählte Stockwerk (auch links) ist der Schnitt: Stockwerke darüber sind ausgeblendet.')}>
          {t('Stockwerke')}
        </b>
        {[...floors].reverse().map((f) => (
          <button
            key={f.id}
            className={`small view3d-floor ${f.id === floorId ? 'active' : ''} ${visibleFloors.has(f.id) ? '' : 'dim'}`}
            onClick={() => useUiStore.getState().setFloor(f.id)}
            data-testid={`view3d-floor-${f.id}`}
          >
            {f.name}
          </button>
        ))}
        {floors.length > 1 && check(t('darüberliegende zeigen'), showAbove, setShowAbove, 'view3d-above')}
        <b className="small-text">{t('Einblenden')}</b>
        {check(t('Förderbänder und Rohre'), showLinks, setShowLinks)}
        {check(t('Flussrichtung'), showArrows, setShowArrows, 'view3d-arrows')}
        {check(t('animiert'), animate, (v) => usePrefs.getState().setAnimateFlow(v), 'view3d-animate', t('Pfeile laufen auf Leitungen mit Durchsatz (Einstellung „Materialfluss animieren“)'))}
        {check(t('Namen'), showNames, setShowNames, 'view3d-names')}
        {check(t('Flächen'), showAreas, setShowAreas)}
        {check(t('Fundamentraster'), showGrid, setShowGrid, 'view3d-grid', t('8-m-Raster der Fundamente auf den Fundamentflächen'))}
      </div>
      <div className="view3d-tip" ref={tipRef} hidden data-testid="view3d-tip" />
      <div className="editor-status">
        <span ref={statusRef} />
        <span className="editor-hint">
          {t('3D-Ansicht (nur ansehen): linke Maustaste drehen · rechte Maustaste verschieben · Mausrad zoomen · Klick wählt aus · Bild hoch/runter: Stockwerk. Körper sind die Kollisionsboxen der Spieldaten, keine Spielmodelle.')}
        </span>
      </div>
    </div>
  );
}

/**
 * Sichtbare Namen: auf einem gezeigten Stockwerk, nicht zu weit weg und ohne
 * Überschneidung mit einem näheren Namen (sonst wird es im dichten Bereich
 * unlesbar).
 */
function declutter(names: { object: CSS2DObject; label: Label3D }[], show: boolean, camera: THREE.Camera, w: number, h: number): void {
  const v = new THREE.Vector3();
  const cand: { n: (typeof names)[number]; d: number; x: number; y: number; hw: number }[] = [];
  for (const n of names) {
    n.object.visible = false;
    if (!show || !n.object.userData.onFloor) continue;
    const d = camera.position.distanceTo(n.object.position);
    if (d > LABEL_MAX_DIST) continue;
    v.copy(n.object.position).project(camera);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
    cand.push({ n, d, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, hw: n.label.text.length * 3.4 + 6 });
  }
  cand.sort((a, b) => a.d - b.d);
  const kept: typeof cand = [];
  for (const c of cand) {
    if (kept.some((k) => Math.abs(k.x - c.x) < k.hw + c.hw && Math.abs(k.y - c.y) < 17)) continue;
    kept.push(c);
    c.n.object.visible = true;
  }
}

/** Alle Körper und Namen entfernen und freigeben. */
function clear(L: { group: THREE.Group; shown: Shown[]; names: { object: CSS2DObject }[] } | null): void {
  if (!L) return;
  for (const s of L.shown) {
    L.group.remove(s.object);
    const o = s.object as THREE.Mesh;
    o.geometry?.dispose();
    (o.material as THREE.Material | undefined)?.dispose();
    if (s.edges) {
      L.group.remove(s.edges);
      s.edges.geometry.dispose();
    }
  }
  for (const n of L.names) {
    L.group.remove(n.object);
    n.object.element.remove();
  }
  L.shown = [];
  L.names = [];
}
