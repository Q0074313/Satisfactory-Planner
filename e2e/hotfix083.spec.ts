/**
 * Hotfix 0.8.3: Startseite – Planer-Version je Projekt, Beispiele über eine
 * Auswahlliste mit Beschreibung und Logistikebene.
 */
import { expect, test } from '@playwright/test';
import { projectState, setPrefs } from './helpers';

const SHOTS = process.env.SATIS_SHOTS;
test.setTimeout(60_000);

test('Startseite: Beispiel auswählen, mit Logistikebene öffnen; Version in der Liste', async ({ page }) => {
  await page.goto('/');
  await setPrefs(page, { mapTiles: 'off' });
  await page.goto('/');
  const picker = page.getByTestId('example-picker');
  await expect(picker).toContainText('Eisenwerk');
  // Logistikebene nur bei Auto-Layout-Beispielen
  await expect(page.getByTestId('list-example-logistics')).toBeDisabled();
  await page.getByTestId('list-example-select').selectOption('medium');
  await expect(picker).toContainText('28 Maschinen');
  await page.getByTestId('list-example-logistics').check();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v083-start.png` });
  await page.getByTestId('list-example-open').click();
  await expect(page.locator('.factory-tabs')).toContainText('Computerfabrik', { timeout: 20_000 });
  const kinds = await projectState<string[]>(page, '(p) => Object.values(p.floors).map((f) => f.kind)');
  expect(kinds).toContain('logistics');

  // Zurück zur Startseite: das Projekt steht mit der aktuellen Planer-Version in der Liste
  await page.waitForTimeout(1500);
  await page.locator('.brand').click();
  const version = (await page.locator('.app-version').textContent()) ?? '';
  const row = page.getByTestId('recent-list').locator('tr', { hasText: 'Computerfabrik' }).first();
  await expect(row).toBeVisible();
  const v = (await row.locator('td').nth(2).textContent())!.trim();
  expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  expect(version).toContain(v);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v083-list.png` });
});
