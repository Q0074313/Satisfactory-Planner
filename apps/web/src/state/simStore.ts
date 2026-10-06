/**
 * Laufende Zugsimulation des aktiven Schienennetzes (nur Oberfläche, nicht
 * im Projekt gespeichert). Wird zurückgesetzt, sobald sich das Netz ändert.
 */
import { create } from 'zustand';
import { simSettingsFrom, TrainSimulation, type GameDataIndex, type Project } from '@satis/core';

interface SimState {
  sim: TrainSimulation | null;
  networkId: string | null;
  /** Projektstand, für den die Simulation erzeugt wurde. */
  source: Project | null;
  playing: boolean;
  /** Simulierte Sekunden je echter Sekunde. */
  speed: number;
  /** Zähler für Oberflächenaktualisierungen (Ereignisliste, Kennzahlen). */
  tick: number;
  ensure(p: Project, gd: GameDataIndex, networkId: string): TrainSimulation;
  reset(): void;
  setPlaying(v: boolean): void;
  setSpeed(v: number): void;
  advance(realDtS: number): void;
  runFor(seconds: number, p: Project, gd: GameDataIndex, networkId: string): void;
}

const STEP = 0.25;

export const useSimStore = create<SimState>((set, get) => ({
  sim: null,
  networkId: null,
  source: null,
  playing: false,
  speed: 10,
  tick: 0,
  ensure(p, gd, networkId) {
    const s = get();
    if (s.sim && s.networkId === networkId && s.source === p) return s.sim;
    const sim = new TrainSimulation(p, networkId, simSettingsFrom(p, gd));
    set({ sim, networkId, source: p, tick: s.tick + 1 });
    return sim;
  },
  reset() {
    set((s) => ({ sim: null, source: null, playing: false, tick: s.tick + 1 }));
  },
  setPlaying(playing) {
    set({ playing });
  },
  setSpeed(speed) {
    set({ speed });
  },
  advance(realDtS) {
    const { sim, playing, speed } = get();
    if (!sim || !playing) return;
    let remaining = realDtS * speed;
    while (remaining > 1e-9) {
      const dt = Math.min(STEP, remaining);
      sim.step(dt);
      remaining -= dt;
    }
    // Oberfläche nur gelegentlich benachrichtigen
    if (Math.floor(sim.time) % 2 === 0) set((s) => ({ tick: s.tick + 1 }));
  },
  runFor(seconds, p, gd, networkId) {
    const sim = get().ensure(p, gd, networkId);
    sim.run(seconds, STEP);
    set((s) => ({ tick: s.tick + 1 }));
  },
}));
