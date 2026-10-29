/**
 * Version 0.8: Anschlusslagen aus den Spielpaketen, 3D-Ansicht, verschiebbare
 * Knoten im Produktionsdiagramm; Hotfix-Punkte (keine „−0“, Auswahl nur auf
 * dem gewählten Stockwerk, Standortvorschlag ausblenden).
 */
import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState, setPrefs } from './helpers';

const PREFS = { mapTiles: 'off' };
const SHOTS = process.env.SATIS_SHOTS;

const run = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__satis; const st = s.useProjectStore.getState(); ${fn} })()`);

async function openExample(page: Page, kind: 'simple' | 'medium') {
  await page.goto('/');
  await setPrefs(page, PREFS);
  await page.goto('/');
  await page.getByTestId('list-example-select').selectOption(kind);
  await page.getByTestId('list-example-open').click();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible({ timeout: 20_000 });
}

test('Anschlüsse: Lage „wie im Spiel“ in den Eigenschaften', async ({ page }) => {
  await openExample(page, 'simple');
  const id = await projectState<string>(page, "(p) => Object.values(p.buildings).find((b) => b.type === 'Build_ConstructorMk1_C').id");
  await run(page, `s.useUiStore.getState().select([{ table: 'buildings', id: '${id}' }])`);
  await expect(page.locator('.badge', { hasText: 'wie im Spiel' })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'schematisch' })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v08-ports.png` });
});

test('3D-Ansicht: öffnen, Stockwerke ausblenden, zurück zum Grundriss', async ({ page }) => {
  await openExample(page, 'medium');
  await page.locator('.editor-toolbar').getByText('3D', { exact: true }).click();
  await expect(page.getByTestId('view3d')).toBeVisible();
  await expect(page.getByTestId('view3d-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v08-3d.png` });
  // Einzelnes Stockwerk ausblenden und wieder einblenden
  const box = page.locator('.view3d-panel input[type=checkbox]').first();
  await box.uncheck();
  await expect(box).not.toBeChecked();
  await box.check();
  // Bearbeiten ist nicht möglich: die Ansicht ändert das Projekt nicht
  const before = await projectState<number>(page, '(p) => Object.keys(p.buildings).length');
  const canvas = page.getByTestId('view3d-canvas');
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect(await projectState<number>(page, '(p) => Object.keys(p.buildings).length')).toBe(before);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v08-3d-orbit.png` });
  await page.locator('.editor-toolbar').getByText('Grundriss', { exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveCount(0);
});

test('Produktionsdiagramm: Knoten verschieben und Anordnung zurücksetzen', async ({ page }) => {
  await newProject(page, 'Diagramm', PREFS);
  await run(
    page,
    `const fid = Object.keys(st.project.factories)[0];
     st.apply('Plan', (d, g) => { const id = s.core.productionOps.addPlan(d, fid, 'Plan A'); s.core.productionOps.updatePlan(d, g, id, { targets: [{ itemId: 'Desc_IronPlateReinforced_C', ratePerMin: 5 }] }); });`,
  );
  await page.locator('button[data-mode="production"]').click();
  await page.getByText('Diagramm', { exact: true }).click();
  const node = page.locator('g.fn-node').first();
  await expect(node).toBeVisible();
  const before = await node.getAttribute('transform');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + 20, nb.y + 10);
  await page.mouse.down();
  await page.mouse.move(nb.x + 80, nb.y + 90, { steps: 6 });
  await page.mouse.up();
  const after = await node.getAttribute('transform');
  expect(after).not.toBe(before);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v08-flow-drag.png` });
  await page.getByTestId('flow-reset').click();
  expect(await node.getAttribute('transform')).toBe(before);
});

test('Hotfix: Standortvorschlag lässt sich ausblenden', async ({ page }) => {
  await openExample(page, 'simple');
  await page.locator('button[data-mode="map"]').click();
  await page.getByTestId('site-run').click();
  await expect(page.getByTestId('site-results')).toBeVisible();
  await page.getByTestId('site-clear').click();
  await expect(page.getByTestId('site-results').locator('li.active')).toHaveCount(0);
  await expect(page.getByTestId('site-clear')).toHaveCount(0);
  // Erneut suchen, dann mit Esc ausblenden
  await page.getByTestId('site-run').click();
  await expect(page.getByTestId('site-clear')).toBeVisible();
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('site-clear')).toHaveCount(0);
});
