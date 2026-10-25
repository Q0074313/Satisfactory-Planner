/**
 * Hotfix 0.7.2: gesperrte Fundamente, Darstellungseinstellungen (Farben,
 * Deckkraft anderer Stockwerke), Seitenansicht ohne Pumpenwerkzeug.
 */
import { expect, test } from '@playwright/test';
import { clickWorld, newProject, projectState, toScreen } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;

test('Gesperrtes Fundament: nicht verschieben, nicht löschen; Klick wählt es zum Entsperren', async ({ page }) => {
  await newProject(page, 'Sperren', { mapTiles: 'off' });
  await page.evaluate(`(() => {
    const s = window.__satis; const st = s.useProjectStore.getState();
    const f = Object.values(st.project.factories)[0];
    st.apply('Fundament', (d) => s.core.factoryOps.addArea(d, { factoryId: f.id, floorId: f.floorIds[0], kind: 'foundation', name: 'Boden', polygon: [{ x: -16, y: -16 }, { x: 16, y: -16 }, { x: 16, y: 16 }, { x: -16, y: 16 }] }));
  })()`);
  const areaId = await projectState<string>(page, '(p) => Object.keys(p.areas)[0]');
  // Auswählen und sperren
  await clickWorld(page, 0, 0);
  await page.getByTestId('area-locked').check();
  expect(await projectState<boolean>(page, `(p) => p.areas['${areaId}'].locked`)).toBe(true);
  // Ziehen verschiebt nicht (Auswahlrahmen), Entf löscht nicht
  const a = await toScreen(page, 0, 0);
  const b = await toScreen(page, 8, 8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  expect(await projectState<{ x: number; y: number }>(page, `(p) => p.areas['${areaId}'].polygon[0]`)).toEqual({ x: -16, y: -16 });
  await clickWorld(page, 0, 0);
  await page.locator('canvas.editor-canvas').focus();
  await page.keyboard.press('Delete');
  expect(await projectState<boolean>(page, `(p) => !!p.areas['${areaId}']`)).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/area-locked.png` });
  // Entsperren über die Eigenschaften
  await page.getByTestId('area-locked').uncheck();
  expect(await projectState<boolean>(page, `(p) => 'locked' in p.areas['${areaId}']`)).toBe(false);
});

test('Darstellung: eigene Farben und Deckkraft anderer Stockwerke werden gespeichert; Seitenansicht ohne Pumpenwerkzeug', async ({ page }) => {
  await newProject(page, 'Darstellung', { mapTiles: 'off' });
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: 'Darstellung' }).click();
  await page.getByTestId('color-belt1').fill('#00ff00');
  await page.getByTestId('other-floor-opacity').fill('60');
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('satis-planner:prefs')!));
  expect(prefs.colors.belt1).toBe('#00ff00');
  expect(prefs.otherFloorOpacity).toBeCloseTo(0.6);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-display.png` });
  await page.getByTestId('colors-reset').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('satis-planner:prefs')!).colors)).toEqual({});
  await page.keyboard.press('Escape');
  await page.evaluate(`window.__satis.useUiStore.getState().setFactoryView('side-x')`);
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  await expect(page.getByTestId('elevation-tools')).toHaveCount(0);
});
