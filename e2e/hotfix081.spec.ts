/**
 * Hotfix 0.8.1: 3D-Ansicht – Splitter und Zusammenführungen, Bänder flach und
 * Rohre rund, Stockwerk links = Schnitt, Namen, Infos beim Überfahren,
 * Flussrichtung, Fundamentkacheln.
 */
import { expect, test } from '@playwright/test';
import { newProject, projectState } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;

test.setTimeout(60_000);

test('3D: Stockwerk links ist der Schnitt, Infos beim Überfahren, Kacheln', async ({ page }) => {
  await newProject(page, '3D', { mapTiles: 'off' });
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-large').click();
  await expect(page.locator('.factory-tabs')).toContainText('Rahmenwerk', { timeout: 20_000 });
  await page.locator('.editor-toolbar').getByText('3D', { exact: true }).click();
  await expect(page.getByTestId('view3d-canvas')).toBeVisible({ timeout: 15_000 });

  const floors = await projectState<string[]>(page, '(p) => Object.values(p.factories).find((f) => !f.blackbox).floorIds');
  expect(floors.length).toBeGreaterThan(2);
  // Unterstes Stockwerk in der 3D-Liste wählen → auch links gewählt, darüberliegende blass
  await page.getByTestId(`view3d-floor-${floors[0]}`).click();
  expect(await page.evaluate(() => (window as any).__satis.useUiStore.getState().floorId)).toBe(floors[0]);
  await expect(page.getByTestId(`view3d-floor-${floors[2]}`)).toHaveClass(/dim/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v081-cut.png` });
  // Auswahl links (Stockwerksliste) wirkt in 3D
  await page.evaluate((id) => (window as any).__satis.useUiStore.getState().setFloor(id), floors[2]);
  await expect(page.getByTestId(`view3d-floor-${floors[2]}`)).toHaveClass(/active/);
  await expect(page.getByTestId(`view3d-floor-${floors[0]}`)).not.toHaveClass(/dim/);
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v081-all.png` });

  // Überfahren zeigt ein Infoschild (Raster über die Ansicht, bis etwas getroffen wird)
  const b = (await page.getByTestId('view3d-canvas').boundingBox())!;
  let shown = false;
  for (let i = 1; i < 8 && !shown; i++)
    for (let j = 1; j < 8 && !shown; j++) {
      await page.mouse.move(b.x + (b.width * i) / 8, b.y + (b.height * j) / 8);
      shown = await page.getByTestId('view3d-tip').isVisible();
    }
  expect(shown).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v081-tip.png` });

  await page.getByTestId('view3d-grid').check();
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v081-grid.png` });
  await page.getByTestId('view3d-names').uncheck();
  await page.getByTestId('view3d-arrows').uncheck();
  await expect(page.getByTestId('view3d-names')).not.toBeChecked();
});
