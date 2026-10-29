/**
 * Hotfix 0.8.2: 3D-Ansicht – Bild hoch/runter wechselt das Stockwerk,
 * Animation der Pfeile, Fundamentraster, scharfe Namen (HTML);
 * Einstellung „Materialfluss animieren“ unter „Darstellung“.
 */
import { expect, test } from '@playwright/test';
import { newProject, projectState } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;
test.setTimeout(60_000);

test('3D: Bild hoch/runter, Animation, Raster und Namen', async ({ page }) => {
  await newProject(page, '3D', { mapTiles: 'off' });
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-large').click();
  await expect(page.locator('.factory-tabs')).toContainText('Rahmenwerk', { timeout: 20_000 });
  await page.locator('.editor-toolbar').getByText('3D', { exact: true }).click();
  const canvas = page.getByTestId('view3d-canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const floors = await projectState<string[]>(page, '(p) => Object.values(p.factories).find((f) => !f.blackbox).floorIds');
  const floorId = () => page.evaluate(() => (window as any).__satis.useUiStore.getState().floorId);
  await page.getByTestId(`view3d-floor-${floors[0]}`).click();
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('PageUp');
  expect(await floorId()).toBe(floors[1]);
  await page.keyboard.press('PageUp');
  expect(await floorId()).toBe(floors[2]);
  await page.keyboard.press('PageDown');
  expect(await floorId()).toBe(floors[1]);

  // Namen als HTML-Beschriftung (scharf)
  await expect(page.locator('.view3d-label').first()).toBeAttached();
  // Animation schaltet die Einstellung „Materialfluss animieren“
  await page.getByTestId('view3d-animate').check();
  expect(await page.evaluate(() => (window as any).__satis.usePrefs.getState().animateFlow)).toBe(true);
  await page.getByTestId('view3d-grid').check();
  // Heranzoomen für die Aufnahme
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.55);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v082-zoom.png` });
  await page.getByTestId('view3d-animate').uncheck();
  expect(await page.evaluate(() => (window as any).__satis.usePrefs.getState().animateFlow)).toBe(false);
});

test('Einstellungen: Materialfluss steht unter „Darstellung“', async ({ page }) => {
  await newProject(page, 'Einstellungen');
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('animate-flow')).toHaveCount(0);
  await page.locator('.segmented').getByText('Darstellung', { exact: true }).click();
  await expect(page.getByTestId('animate-flow')).toBeVisible();
});
