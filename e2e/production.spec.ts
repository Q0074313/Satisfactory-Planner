import { expect, test } from '@playwright/test';
import { clickWorld, newProject, projectState } from './helpers';

test('Produktionsplan: Ziel berechnen, Maschinen anlegen, im Grundriss platzieren, Abgleich', async ({ page }) => {
  await newProject(page, 'Produktion');
  await page.getByRole('button', { name: 'Produktion', exact: true }).click();
  await page.locator('.section').filter({ hasText: 'Produktionspläne' }).getByRole('button', { name: '+' }).click();
  await page.getByPlaceholder('Zielprodukt hinzufügen …').fill('Eisenplatte');
  await expect(page.locator('.production .row').filter({ hasText: 'Eisenplatte' })).toBeVisible();
  const input = page.locator('.production .row').filter({ hasText: 'Eisenplatte' }).locator('input');
  await input.fill('45');
  await input.press('Enter');
  await expect(page.locator('.result-banner')).toContainText('Alle Ziele erreichbar');
  const row = page.locator('table tr').filter({ hasText: 'Konstruktor' }).first();
  await expect(row).toContainText('2,25');
  await expect(row).toContainText('3 × 75 %');

  // Finding PROD-003: Fabrik hat zu wenige Maschinen
  await expect(page.locator('.finding').filter({ hasText: 'zu wenigen Maschinen' })).toBeVisible();
  await page.getByRole('button', { name: 'Maschinen in Fabrik anlegen' }).click();
  await expect(page.locator('.finding').filter({ hasText: 'zu wenigen Maschinen' })).toHaveCount(0);
  expect(await projectState<number>(page, '(p) => Object.values(p.buildings).filter((b) => b.placement === null).length')).toBe(6);

  // Im Grundriss eine Maschine aus „Nicht platziert“ absetzen
  await page.getByRole('button', { name: 'Fabrikgrundriss' }).click();
  await page.locator('.section').filter({ hasText: 'Nicht platziert' }).locator('li').filter({ hasText: 'Eisenplatte' }).click();
  await clickWorld(page, 0, 0);
  expect(await projectState<number>(page, '(p) => Object.values(p.buildings).filter((b) => b.placement !== null).length')).toBe(1);

  await page.getByRole('button', { name: 'Produktion', exact: true }).click();
  const bal = page.locator('.section').filter({ hasText: 'Abgleich mit der Fabrik' }).locator('tr').filter({ hasText: 'Eisenplatte' });
  await expect(bal).toContainText('2,25');
  await expect(bal.locator('td').nth(3)).toHaveText('0,75');
});

test('Kreislauf und unerreichbares Ziel werden verständlich angezeigt', async ({ page }) => {
  await newProject(page, 'Kreislauf');
  await page.getByRole('button', { name: 'Produktion', exact: true }).click();
  await page.locator('.section').filter({ hasText: 'Produktionspläne' }).getByRole('button', { name: '+' }).click();
  await page.getByPlaceholder('Zielprodukt hinzufügen …').fill('Eisenplatte');
  // Standardrezept für Eisenbarren abwählen → keine Quelle
  await page.getByRole('button', { name: 'bearbeiten' }).click();
  await page.getByPlaceholder('Rezept oder Produkt suchen …').fill('Eisenbarren');
  await page.locator('.recipe-opt').filter({ hasText: /^Eisenbarren/ }).locator('input').uncheck();
  await expect(page.locator('.result-banner')).toContainText('nicht vollständig erreichbar');
  await expect(page.locator('.bottlenecks')).toContainText('Eisenbarren: kein zulässiges Rezept');
  await expect(page.locator('.finding').filter({ hasText: 'es fehlen' })).toBeVisible();
});
