/**
 * Einfaches Rate-Limit pro Schlüssel (z. B. IP) mit festem Zeitfenster, im
 * Speicher des Prozesses. Für einen einzelnen Container ausreichend.
 */
export interface Limit {
  max: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: Limit,
    private readonly now: () => number = Date.now,
  ) {}

  /** Zählt einen Zugriff. Liefert die Wartezeit in Sekunden, falls das Limit überschritten ist, sonst 0. */
  hit(key: string): number {
    const now = this.now();
    this.sweep(now);
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + this.limit.windowMs });
      return 0;
    }
    e.n++;
    return e.n > this.limit.max ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }
}
