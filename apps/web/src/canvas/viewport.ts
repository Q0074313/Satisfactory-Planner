/** Ansichtstransformation Welt (Meter) ↔ Bildschirm (CSS-Pixel). */
export interface Vec {
  x: number;
  y: number;
}

export class Viewport {
  /** Weltpunkt in der Bildmitte. */
  cx = 0;
  cy = 0;
  /** Pixel pro Meter. */
  scale = 8;
  width = 1;
  height = 1;

  static readonly MIN_SCALE = 0.05;
  static readonly MAX_SCALE = 120;

  toScreen(p: Vec): Vec {
    return { x: (p.x - this.cx) * this.scale + this.width / 2, y: (p.y - this.cy) * this.scale + this.height / 2 };
  }

  toWorld(p: Vec): Vec {
    return { x: (p.x - this.width / 2) / this.scale + this.cx, y: (p.y - this.height / 2) / this.scale + this.cy };
  }

  /** Sichtbarer Weltbereich. */
  bounds() {
    const a = this.toWorld({ x: 0, y: 0 });
    const b = this.toWorld({ x: this.width, y: this.height });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  zoomAt(screen: Vec, factor: number): void {
    const before = this.toWorld(screen);
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const after = this.toWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.scale;
    this.cy -= dyScreen / this.scale;
  }

  fit(rect: { minX: number; minY: number; maxX: number; maxY: number }, padding = 40): void {
    const w = Math.max(rect.maxX - rect.minX, 1);
    const h = Math.max(rect.maxY - rect.minY, 1);
    this.cx = (rect.minX + rect.maxX) / 2;
    this.cy = (rect.minY + rect.maxY) / 2;
    this.scale = Math.min(
      Viewport.MAX_SCALE,
      Math.max(Viewport.MIN_SCALE, Math.min((this.width - padding * 2) / w, (this.height - padding * 2) / h)),
    );
  }
}
