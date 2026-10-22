/**
 * Version 0.7: automatisches Fabriklayout, Blackbox-Fabriken, Rezepte
 * nachschlagen, Anschlüsse in der Bauvorschau, auffällige Gebäude in der Fehlersuche.
 */
import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState, toScreen } from './helpers';

const PREFS = { mapTiles: 'off' };
const SHOTS = process.env.SATIS_SHOTS;

const run = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__satis; const st = s.useProjectStore.getState(); ${fn} })()`);

async function withPlan(page: Page, itemId: string, rate: number) {
  await run(
    page,
    `const fid = Object.keys(st.project.factories)[0];
     st.apply('Plan', (d, g) => { const id = s.core.productionOps.addPlan(d, fid, 'Plan A'); s.core.productionOps.updatePlan(d, g, id, { targets: [{ itemId: '${itemId}', ratePerMin: ${rate} }] }); });`,
  );
}

test('Auto-Layout: Varianten prüfen und übernehmen', async ({ page }) => {
  await newProject(page, 'Auto-Layout', PREFS);
  await withPlan(page, 'Desc_IronPlateReinforced_C', 10);
  await page.getByTestId('factory-autolayout').click();
  await expect(page.getByTestId('al-variant-rows')).toBeVisible();
  await expect(page.getByTestId('al-variant-compact')).toBeVisible();
  // Prüfung durch das Durchsatzmodell: alle Maschinen voll, keine Überschneidungen
  await expect(page.getByTestId('al-check')).toContainText('100', { timeout: 15_000 });
  await expect(page.getByTestId('al-check')).toContainText('0 Überschneidungen');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/al-compact.png` });
  await page.getByTestId('al-variant-rows').click();
  await expect(page.getByTestId('al-check')).toContainText('100', { timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/al-rows.png` });
  await page.getByTestId('al-take').click();
  const placed = await projectState<number>(page, '(p) => Object.values(p.buildings).filter((b) => b.recipeId && b.placement).length');
  expect(placed).toBeGreaterThan(5);
  const links = await projectState<number>(page, '(p) => Object.keys(p.links).length');
  expect(links).toBeGreaterThan(10);
  // Ein Undo-Schritt nimmt alles zurück
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/al-applied.png` });
  await page.keyboard.press('Control+z');
  expect(await projectState<number>(page, '(p) => Object.keys(p.buildings).length')).toBe(0);
});

test('Auto-Layout aus dem Produktionsplan: mehrere Etagen', async ({ page }) => {
  await newProject(page, 'Etagen', PREFS);
  await withPlan(page, 'Desc_Plastic_C', 60);
  await page.locator('button[data-mode="production"]').click();
  await page.getByTestId('plan-autolayout').click();
  await page.locator('.al-options input[type="text"]').last().fill('2');
  await page.locator('.al-options input[type="text"]').last().press('Enter');
  await page.getByTestId('al-variant-floors').click();
  await expect(page.getByTestId('al-check')).toContainText('100', { timeout: 15_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/al-floors.png` });
  await page.getByTestId('al-take').click();
  expect(await projectState<number>(page, '(p) => Object.values(p.factories)[0].floorIds.length')).toBe(2);
});

test('Blackbox: Ein- und Ausgänge aus dem Plan, keine Grundrissbefunde', async ({ page }) => {
  await newProject(page, 'Blackbox', PREFS);
  await withPlan(page, 'Desc_IronPlate_C', 60);
  await page.getByTestId('factory-blackbox').click();
  await expect(page.getByTestId('blackbox-view')).toContainText('Eisenerz');
  await expect(page.getByTestId('blackbox-view')).toContainText('Eisenplatte');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/blackbox.png` });
  expect(await projectState<boolean>(page, '(p) => Object.values(p.factories)[0].blackbox')).toBe(true);
  // Aus der Blackbox heraus ein Layout erzeugen: Blackbox endet
  await page.getByTestId('blackbox-autolayout').click();
  await expect(page.getByTestId('al-check')).toContainText('100', { timeout: 15_000 });
  await page.getByTestId('al-take').click();
  expect(await projectState<boolean>(page, '(p) => Object.values(p.factories)[0].blackbox')).toBe(false);
});

test('Rezepte nachschlagen: Standard und Alternativen im Vergleich', async ({ page }) => {
  await newProject(page, 'Rezepte', PREFS);
  await page.locator('button[data-mode="production"]').click();
  await page.getByTestId('open-recipe-book').click();
  await page.getByTestId('rb-search').fill('Schrauben');
  await expect(page.getByTestId('rb-row').first()).toBeVisible();
  expect(await page.getByTestId('rb-row').count()).toBeGreaterThan(2);
  await expect(page.getByTestId('rb-table')).toContainText('Alt');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/recipes.png` });
});

test('Bauvorschau zeigt Anschlüsse; Fehlersuche meldet Gebäude ohne Rezept und Stillstand', async ({ page }) => {
  await newProject(page, 'Hotfix', PREFS);
  // Konstruktor aus dem Katalog wählen und über dem Grundriss schweben
  await run(page, `s.useUiStore.getState().setTool({ kind: 'place', type: 'Build_ConstructorMk1_C', rotationDeg: 0 });`);
  const at = await toScreen(page, 20, 20);
  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 2, at.y + 2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ghost-ports.png` });
  await page.mouse.click(at.x + 2, at.y + 2);
  await page.keyboard.press('Escape');
  // Zweites Gebäude mit Rezept, aber ohne Zufuhr
  await run(
    page,
    `const fid = Object.keys(st.project.factories)[0]; const fl = st.project.factories[fid].floorIds[0];
     st.apply('Bau', (d, g) => s.core.factoryOps.addBuilding(d, g, { factoryId: fid, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IngotIron_C', placement: { floorId: fl, x: 60, y: 20, zOffsetM: 0, rotationDeg: 0 } }));`,
  );
  await run(page, `s.useUiStore.getState().setDiagnoseOpen(true);`);
  await expect(page.getByTestId('diagnose-conspicuous')).toContainText('kein Rezept');
  await expect(page.getByTestId('diagnose-conspicuous')).toContainText('steht still');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/diagnose.png` });
});

test('Hotfix 0.7.1: Bauart wählen und speichern, Kreuzungsprüfung, mittleres Beispiel', async ({ page }) => {
  await newProject(page, 'Bauarten', PREFS);
  await withPlan(page, 'Desc_Computer_C', 5);
  await page.getByTestId('factory-autolayout').click();
  await page.getByTestId('al-preset').selectOption('block');
  await expect(page.getByTestId('al-variant-compact')).toHaveClass(/active/);
  await expect(page.getByTestId('al-check')).toContainText('0 Kreuzungen auf gleicher Höhe', { timeout: 20_000 });
  await expect(page.getByTestId('al-check')).toContainText('Auslastung min. 100');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/al-block.png` });
  // Eigene Bauart speichern
  page.once('dialog', (d) => void d.accept('Meine Bauart'));
  await page.getByTestId('al-save-preset').click();
  await expect(page.getByTestId('al-preset')).toHaveValue('user:Meine Bauart');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satis-planner:prefs')!).layoutPresets.map((x: { name: string }) => x.name))).toEqual(['Meine Bauart']);
  await page.keyboard.press('Escape');
  // Mittleres Beispiel aus dem Hilfemenü: läuft voll, ohne Warnungen
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-medium').click();
  await expect(page.locator('.factory-tabs')).toContainText('Computerfabrik', { timeout: 20_000 });
  expect(await projectState<number>(page, '(p) => Object.values(p.buildings).filter((b) => b.recipeId && b.placement).length')).toBe(28);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/example-medium.png` });
});

