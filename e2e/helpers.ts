import { expect, type Page } from '@playwright/test';

/** Rechnet Weltkoordinaten (Meter) in Bildschirmkoordinaten des Editors um. */
export async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  // Leere Fabrik: Ansicht zentriert auf (0,0) mit 6 px/m
  return { x: box.x + box.width / 2 + x * 6, y: box.y + box.height / 2 + y * 6 };
}

export async function clickWorld(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

export async function projectState<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(${fn})(window.__satis.useProjectStore.getState().project)`) as Promise<T>;
}

/** Benutzereinstellungen für Tests: Deutsch, Begrüßung bereits gesehen. */
export async function setPrefs(page: Page, prefs: Record<string, unknown> = {}) {
  // Der Dev-Server kann beim ersten Aufruf neu laden (Abhängigkeitsoptimierung) → bei Bedarf wiederholen
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState('networkidle');
      await page.evaluate((p) => {
        localStorage.clear();
        localStorage.setItem('satis-planner:prefs', JSON.stringify({ language: 'de', theme: 'dark', welcomed: true, animateFlow: false, ...p }));
      }, prefs);
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(500);
    }
  }
}

export async function newProject(page: Page, name = 'E2E', prefs: Record<string, unknown> = {}) {
  await page.goto('/');
  await setPrefs(page, prefs);
  await page.goto('/');
  await page.getByPlaceholder('Projektname').fill(name);
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
}

export async function placeFromCatalog(page: Page, search: string, entry: string, points: [number, number][]) {
  await page.locator('#catalog-search').fill(search);
  await page.locator('.item-list li').filter({ hasText: entry }).first().click();
  for (const [x, y] of points) await clickWorld(page, x, y);
  await page.keyboard.press('Escape');
}
