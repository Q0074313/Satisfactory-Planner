/**
 * Version 0.9: Spielstand importieren, Freischaltung (Phase/Tier), Automatisch
 * verbinden; Hotfix Rohrkreuzung im Raster.
 *
 * Der Import-Test braucht einen echten Spielstand und läuft nur, wenn
 * SATIS_SAVE auf eine .sav-Datei zeigt (Spielstände gehören nicht ins Repository).
 */
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { clickWorld, newProject, placeFromCatalog, projectState, setPrefs } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;
const SAVE = process.env.SATIS_SAVE;
test.setTimeout(120_000);

test('Spielstand importieren: Vorschlag auf der Karte, Projekt mit Fabriken, Schienennetz und Fortschritt', async ({ page }) => {
  test.skip(!SAVE || !existsSync(SAVE), 'SATIS_SAVE nicht gesetzt');
  await page.goto('/');
  await setPrefs(page, { mapTiles: 'off' });
  await page.goto('/');
  await page.getByTestId('open-save-import').click();
  await page.getByTestId('save-file').setInputFiles(SAVE!);
  await expect(page.getByTestId('save-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('save-groups').locator('li').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v09-import.png` });
  await page.getByTestId('save-create').click();
  await expect(page.locator('.factory-tabs')).toBeVisible({ timeout: 60_000 });
  const info = await projectState<{ source: string; factories: number; stations: number }>(
    page,
    '(p) => ({ source: p.settings.progress?.source, factories: Object.keys(p.factories).length, stations: Object.keys(p.stations).length })',
  );
  expect(info.source).toBe('save');
  expect(info.factories).toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v09-imported.png` });
});

test('Freischaltung: Tier 2 graut Stahl aus und der Plan nutzt ihn nicht', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Produktion' }).click();
  await page.getByTestId('progress-mode').selectOption('progress');
  await page.getByTestId('progress-tier').selectOption('2');
  await expect(page.getByTestId('progress-summary')).toContainText('gesperrt');
  const progress = await projectState<{ source: string; maxTier: number }>(page, '(p) => p.settings.progress');
  expect(progress).toMatchObject({ source: 'manual', maxTier: 2 });
  // Phase passt zum Tier
  await expect(page.getByTestId('progress-phase')).toHaveValue('0');
  await page.getByTestId('progress-phase').selectOption('1');
  await expect(page.getByTestId('progress-tier')).toHaveValue('4');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v09-progress.png` });
});

test('Automatisch verbinden: Schmelzofen und Konstruktor von Hand gesetzt, Leitungen samt Ein- und Ausgang', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenbarren', 'Eisenbarren', [[-12, 0]]);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[12, 0]]);
  await page.keyboard.press('Escape');
  await page.getByTestId('factory-autoconnect').click();
  await expect(page.getByTestId('ac-summary')).toContainText('Leitungen');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v09-autoconnect.png` });
  await page.getByTestId('ac-run').click();
  const n = await projectState<{ links: number; boxes: number }>(
    page,
    "(p) => ({ links: Object.keys(p.links).length, boxes: Object.values(p.buildings).filter((b) => b.type === 'Build_StorageContainerMk1_C').length })",
  );
  expect(n.links).toBe(3);
  expect(n.boxes).toBe(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v09-autoconnected.png` });
});

test('Hotfix: Rohrkreuzung rastet mit der Mitte im Raster ein', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Pipeline-Kreuzung', 'Pipeline-Kreuzung', [[3.3, 2.2]]);
  const pl = await projectState<{ x: number; y: number }[]>(page, "(p) => Object.values(p.buildings).filter((b) => b.type === 'Build_PipelineJunction_Cross_C').map((b) => b.placement)");
  expect(pl).toHaveLength(1);
  expect(Number.isInteger(pl[0]!.x) && Number.isInteger(pl[0]!.y)).toBe(true);
});

test('Hotfix 0.9.2: Gebäude einer neuen Fabrik zuweisen, Lage bleibt', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenbarren', 'Eisenbarren', [[-12, 0]]);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[12, 0]]);
  await page.keyboard.press('Escape');
  await clickWorld(page, 12, 0);
  await expect(page.getByTestId('reassign-target')).toBeVisible();
  await page.getByTestId('reassign-name').fill('Platten');
  await page.getByTestId('reassign-run').click();
  const info = await projectState<{ names: string[]; moved: number }>(
    page,
    "(p) => ({ names: Object.values(p.factories).map((f) => f.name), moved: Object.values(p.buildings).filter((b) => p.factories[b.factoryId].name === 'Platten').length })",
  );
  expect(info.names).toContain('Platten');
  expect(info.moved).toBe(1);
  await expect(page.locator('.factory-tabs')).toContainText('Platten');
});
