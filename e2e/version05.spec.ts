import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState, setPrefs } from './helpers';

const state = <T>(page: Page, fn: string) => projectState<T>(page, fn);

async function openExampleFromList(page: Page) {
  await page.goto('/');
  await setPrefs(page);
  await page.goto('/');
  await page.getByTestId('list-example-open').click();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
}

test('Beispielprojekt aus der Projektliste: Eisenwerk mit Plan, geführte Fehlersuche meldet volle Auslastung', async ({ page }) => {
  await openExampleFromList(page);
  const info = await state<{ factories: string[]; buildings: number; plans: number }>(
    page,
    '(p) => ({ factories: Object.values(p.factories).map((f) => f.name), buildings: Object.keys(p.buildings).length, plans: Object.keys(p.productionPlans).length })',
  );
  expect(info.factories).toEqual(['Eisenwerk']);
  expect(info.buildings).toBeGreaterThan(8);
  expect(info.plans).toBe(1);

  await page.getByTestId('diagnose-open').click();
  await expect(page.getByRole('dialog', { name: 'Etwas stimmt nicht?' })).toBeVisible();
  await page.getByTestId('diagnose-machine').selectOption({ index: 1 });
  await expect(page.getByTestId('diagnose-result')).toContainText('läuft laut Planer mit 100 %');
  await page.getByRole('button', { name: 'Gegenstand kommt nicht an' }).click();
  await page.getByTestId('diagnose-item').selectOption({ label: 'Eisenbarren' });
  await expect(page.getByTestId('diagnose-result')).toContainText('erhalten laut Planer ihre volle Menge');
});

test('Geführte Fehlersuche findet eine fehlende Zuleitung und springt zum Objekt', async ({ page }) => {
  await openExampleFromList(page);
  // Band vom Splitter zum Plattenkonstruktor entfernen
  await page.evaluate(() => {
    const s = (window as any).__satis.useProjectStore.getState();
    const p = s.project;
    const ctor = Object.values(p.buildings).find((b: any) => b.recipeId === 'Recipe_IronPlate_C') as any;
    const link = Object.values(p.links).find((l: any) => l.to.buildingId === ctor.id) as any;
    s.apply('Test', (d: any) => void delete d.links[link.id]);
  });
  await page.getByTestId('diagnose-open').click();
  const select = page.getByTestId('diagnose-machine');
  // Maschinen sind nach Auslastung sortiert: der Plattenkonstruktor (0 %) steht oben
  await select.selectOption({ index: 1 });
  await expect(page.getByTestId('diagnose-result')).toContainText('Keine Leitung bringt Eisenbarren hierher');
  await page.getByTestId('diagnose-result').locator('li.clickable').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sel = await page.evaluate(() => (window as any).__satis.useUiStore.getState().selection.map((s: any) => s.table));
  expect(sel).toContain('buildings');
});

test('Komplexes Beispiel über das Hilfemenü; Transport per Drohne mit Batterieverbrauch', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-complex').click();
  await expect.poll(() => state<number>(page, '(p) => Object.keys(p.factories).length')).toBe(2);
  expect(await state<string[]>(page, '(p) => Object.values(p.transportOrders).map((o) => o.mode).sort()')).toEqual(['belt', 'vehicle']);

  await page.locator('.modes button[data-mode="transport"]').click();
  await page.locator('[data-tour="transport-left"] li').filter({ hasText: 'Eisenplatte' }).first().click();
  await page.getByTestId('transport-mode').selectOption('drone');
  await expect(page.getByTestId('drone-fuel')).toHaveValue('Desc_Battery_C');
  await expect(page.getByTestId('drone-fuel-rate')).toContainText('/min');
  expect(await state<string>(page, '(p) => Object.values(p.transportOrders).find((o) => o.itemId === "Desc_IronPlate_C").mode')).toBe('drone');
});

test('Produktion: Kraftwerke vorgeben und Alternativrezepte vorschlagen', async ({ page }) => {
  await newProject(page);
  await page.locator('.modes button[data-mode="production"]').click();
  await page.locator('[data-tour="add-plan"]').click();
  await page.getByPlaceholder('Zielprodukt hinzufügen …').fill('Verstärkte Eisenplatte');
  await expect(page.locator('.production .row').filter({ hasText: 'Verstärkte Eisenplatte' })).toBeVisible();

  await page.getByTestId('power-add').click();
  await page.getByTestId('power-row').locator('input').fill('16');
  await page.getByTestId('power-row').locator('input').press('Enter');
  await expect(page.getByTestId('result-banner')).toContainText('erzeugt 1.200 MW');
  await expect(page.getByTestId('item-table')).toContainText('Kohle');
  const gens = await state<{ recipeId: string; count: number }[]>(page, '(p) => Object.values(p.productionPlans)[0].power.generators');
  expect(gens).toEqual([{ recipeId: 'Power_Build_GeneratorCoal_C_Desc_Coal_C', count: 16 }]);

  await page.getByText('Alternativrezepte vorschlagen', { exact: true }).click();
  await expect(page.getByTestId('alt-suggestions')).toBeVisible();
  const before = await state<number>(page, '(p) => Object.values(p.productionPlans)[0].enabledAlternates.length');
  await page.getByTestId('alt-suggestions').getByRole('button', { name: 'übernehmen' }).first().click();
  await expect.poll(() => state<number>(page, '(p) => Object.values(p.productionPlans)[0].enabledAlternates.length')).toBeGreaterThan(before);
});
