/**
 * Anzeige einer laufenden Führung: hebt das Zielelement hervor und zeigt
 * Text, Fortschritt und Schaltflächen. Klicks gehen an die Oberfläche durch,
 * damit Aufgaben direkt erledigt werden können.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { usePrefs } from '../../state/prefsStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { counts, TOURS, type Counts } from './tours';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function TourOverlay() {
  const tour = useUiStore((s) => s.tour);
  const project = useProjectStore((s) => s.project);
  const ui = useUiStore();
  const def = tour ? TOURS.find((x) => x.id === tour.id) : undefined;
  const step = def && tour ? def.steps[tour.step] : undefined;
  const [rect, setRect] = useState<Rect | null>(null);
  const base = useRef<Counts>(counts(project));
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popSize, setPopSize] = useState({ w: 360, h: 180 });

  // Ansicht für den Schritt einstellen und Ausgangswerte merken
  useEffect(() => {
    if (!step) return;
    base.current = counts(useProjectStore.getState().project);
    const u = useUiStore.getState();
    if (step.mode && u.mode !== step.mode) u.setMode(step.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, tour?.step]);

  // Zielelement verfolgen
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const update = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) => (prev && prev.x === r.x && prev.y === r.y && prev.w === r.width && prev.h === r.height ? prev : { x: r.x, y: r.y, w: r.width, h: r.height }));
      } else setRect(null);
      raf = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => {
    if (popRef.current) setPopSize({ w: popRef.current.offsetWidth, h: popRef.current.offsetHeight });
  }, [step, rect]);

  // Aufgabe erledigt → weiter
  const done = !!step?.until?.({ p: project, ui, base: base.current });
  useEffect(() => {
    if (done && tour && def) {
      const id = setTimeout(() => next(), 500);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (!tour || !def || !step) return null;
  const last = tour.step === def.steps.length - 1;
  function next() {
    const u = useUiStore.getState();
    if (!u.tour || !def) return;
    if (u.tour.step >= def.steps.length - 1) finish();
    else u.setTourStep(u.tour.step + 1);
  }
  function finish() {
    usePrefs.getState().markTourDone(def!.id);
    useUiStore.getState().endTour();
  }

  // Lage des Textfensters: rechts, links, unter oder über dem Ziel
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 14;
  let pos: { left: number; top: number };
  if (!rect) pos = { left: (vw - popSize.w) / 2, top: (vh - popSize.h) / 2 };
  else if (rect.x + rect.w + gap + popSize.w < vw) pos = { left: rect.x + rect.w + gap, top: rect.y };
  else if (rect.x - gap - popSize.w > 0) pos = { left: rect.x - gap - popSize.w, top: rect.y };
  else if (rect.y + rect.h + gap + popSize.h < vh) pos = { left: rect.x, top: rect.y + rect.h + gap };
  else pos = { left: rect.x, top: Math.max(8, rect.y - gap - popSize.h) };
  pos.left = Math.min(Math.max(8, pos.left), vw - popSize.w - 8);
  pos.top = Math.min(Math.max(8, pos.top), vh - popSize.h - 8);

  return (
    <div className="tour-layer" data-testid="tour">
      {rect ? <div className="tour-spot" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} /> : <div className="tour-dim" />}
      <div className="tour-pop" ref={popRef} style={pos} role="dialog" aria-label={t(step.title)}>
        <div className="tour-progress">
          {t(def.title)} · {tour.step + 1} / {def.steps.length}
        </div>
        <h3>{t(step.title)}</h3>
        <p>{t(step.body)}</p>
        {step.until && <p className={`tour-task ${done ? 'done' : ''}`}>{done ? t('✓ Erledigt') : t('Aufgabe: Probiere es aus – es geht automatisch weiter.')}</p>}
        <div className="button-row">
          <button onClick={finish}>{t('Beenden')}</button>
          <span className="spacer" />
          <button disabled={tour.step === 0} onClick={() => useUiStore.getState().setTourStep(tour.step - 1)}>
            {t('Zurück')}
          </button>
          <button className="primary" onClick={next} data-testid="tour-next">
            {last ? t('Fertig') : step.until && !done ? t('Überspringen') : t('Weiter')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hilfemenü mit allen Führungen. */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const done = usePrefs((s) => s.toursDone);
  return (
    <div className="menu">
      <button onClick={() => setOpen(!open)} title={t('Hilfe und Tutorial (F1)')} data-testid="help-button">
        ?
      </button>
      {open && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <p className="dim small-text">{t('Geführte Touren')}</p>
          {TOURS.map((tour) => (
            <button
              key={tour.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                useUiStore.getState().startTour(tour.id);
              }}
            >
              {t(tour.title)} {done.includes(tour.id) && <span className="dim">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Begrüßung beim ersten Start mit Angebot der Einführung. */
export function WelcomeCard() {
  const welcomed = usePrefs((s) => s.welcomed);
  const tour = useUiStore((s) => s.tour);
  if (welcomed || tour) return null;
  return (
    <div className="welcome-card" data-testid="welcome">
      <h3>{t('Willkommen!')}</h3>
      <p>{t('Möchtest du eine kurze Einführung in die Bedienung? Du kannst sie jederzeit über „?“ oben rechts erneut starten.')}</p>
      <div className="button-row">
        <button
          className="primary"
          onClick={() => {
            usePrefs.getState().setWelcomed();
            useUiStore.getState().startTour('intro');
          }}
        >
          {t('Einführung starten')}
        </button>
        <button onClick={() => usePrefs.getState().setWelcomed()}>{t('Später')}</button>
      </div>
    </div>
  );
}
