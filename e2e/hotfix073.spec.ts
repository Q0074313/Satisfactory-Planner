/**
 * Hotfix 0.7.3: Bedarf je Eingang, Absender/Empfänger tauschen,
 * Logistikebenen (Beispiel und Auto-Layout), Deckkraft 0 … 100 %.
 */
import { expect, test } from '@playwright/test';
import { newProject, projectState } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;
const PREFS = { mapTiles: 'off' };

test('Transport: Bedarf je Eingang, Menge übernehmen, Richtung tauschen bei zwei Fabriken', async ({ page }) => {
  await newProject(page, 'Eingänge', PREFS);
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-large').click();
  await expect(page.locator('.factory-tabs')).toContainText('Rahmenwerk', { timeout: 20_000 });
  await page.evaluate(`window.__satis.useUiStore.getState().setMode('transport')`);
  const table = page.getByTestId('inputs-table');
  await expect(table).toContainText('Eingang: Eisenerz (1/2)', { timeout: 20_000 });
  await expect(table).toContainText('720');
  await expect(table).toContainText('Kohle');
  await expect(table.getByText('gedeckt')).toHaveCount(4);
  // Auftrag verkleinern → fehlt, Menge übernehmen stellt den Bedarf wieder her
  const orderId = await projectState<string>(page, `(p) => Object.values(p.transportOrders).find((o) => o.itemId === 'Desc_Coal_C').id`);
  await page.evaluate(`(() => { const s = window.__satis; s.useProjectStore.getState().apply('x', (d, g) => s.core.transportOps.updateOrder(d, g, '${orderId}', { ratePerMin: 100 })); })()`);
  await expect(table.getByText('fehlt', { exact: false })).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inputs-table.png` });
  await table.getByRole('button', { name: 'Menge übernehmen' }).click();
  expect(await projectState<number>(page, `(p) => p.transportOrders['${orderId}'].ratePerMin`)).toBeCloseTo(450, 1);
  // Bei zwei Fabriken: Absender auf den Empfänger setzen tauscht beide
  await page.evaluate(`window.__satis.useUiStore.getState().select([{ table: 'transportOrders', id: '${orderId}' }])`);
  const before = await projectState<[string, string]>(page, `(p) => [p.transportOrders['${orderId}'].fromFactoryId, p.transportOrders['${orderId}'].toFactoryId]`);
  await page.getByTestId('order-from').selectOption(before[1]);
  expect(await projectState<[string, string]>(page, `(p) => [p.transportOrders['${orderId}'].fromFactoryId, p.transportOrders['${orderId}'].toFactoryId]`)).toEqual([before[1], before[0]]);
  await page.getByTestId('order-swap').click();
  expect(await projectState<[string, string]>(page, `(p) => [p.transportOrders['${orderId}'].fromFactoryId, p.transportOrders['${orderId}'].toFactoryId]`)).toEqual(before);
});

test('Logistikebenen: Beispiel aus dem Hilfemenü und Option im Auto-Layout; Deckkraft bis 0 %', async ({ page }) => {
  await newProject(page, 'Logistik', PREFS);
  await page.getByTestId('help-button').click();
  await page.getByTestId('example-medium-logistics').click();
  await expect(page.locator('.factory-tabs')).toContainText('Computerfabrik', { timeout: 20_000 });
  const kinds = await projectState<string[]>(page, `(p) => { const f = Object.values(p.factories).find((x) => !x.blackbox); return f.floorIds.map((id) => p.floors[id].kind); }`);
  expect(kinds).toEqual(['logistics', 'production']);
  expect(await projectState<number>(page, `(p) => { const f = Object.values(p.factories).find((x) => !x.blackbox); return Object.values(p.buildings).filter((b) => b.recipeId && b.placement && p.floors[b.placement.floorId].kind === 'logistics').length; }`)).toBe(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/example-logistics.png` });
  // Auto-Layout-Dialog: Bauart „Mit Logistikebene“
  await page.getByTestId('factory-autolayout').click();
  await page.getByTestId('al-preset').selectOption('logistics');
  await expect(page.getByTestId('al-check')).toContainText('0 Kreuzungen auf gleicher Höhe', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  // Deckkraft anderer Stockwerke: Standard 15 %, 0 möglich
  expect(await page.evaluate(`window.__satis.usePrefs.getState().otherFloorOpacity`)).toBeCloseTo(0.15);
  await page.evaluate(`window.__satis.usePrefs.getState().setOtherFloorOpacity(0)`);
  expect(await page.evaluate(`window.__satis.usePrefs.getState().otherFloorOpacity`)).toBe(0);
});
