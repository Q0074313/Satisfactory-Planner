import { expect, test } from '@playwright/test';
import { newProject, placeFromCatalog } from './helpers';

test('Konto: registrieren, im Konto speichern, Freigabelink schreibgeschützt öffnen, als Kopie übernehmen', async ({ page, browser }) => {
  await newProject(page, 'Geteiltes Werk');
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0]]);
  await page.getByTestId('account-button').click();
  await page.getByRole('button', { name: 'Neues Konto anlegen' }).click();
  const email = `e2e-${Date.now()}@example.org`;
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('ein-sicheres-passwort');
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByTestId('account-button')).toContainText('e2e-');
  await page.getByTestId('account-button').click();
  await page.locator('.menu-item').filter({ hasText: 'Freigabelink' }).click();
  await page.getByRole('button', { name: 'Speichern und Link erstellen' }).click();
  const link = await page.locator('.share-list input').first().inputValue();
  expect(link).toMatch(/#\/share\/[\w-]+$/);

  // Anderer Browser ohne Konto öffnet den Link
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.setItem('satis-planner:prefs', JSON.stringify({ language: 'de', welcomed: true })));
  await other.reload();
  await other.goto(link.replace('http://localhost:5199', ''));
  await expect(other.getByTestId('shared-banner')).toBeVisible();
  await expect(other.locator('.project-name input')).toHaveValue('Geteiltes Werk');
  // Bearbeiten ist gesperrt
  await other.locator('canvas.editor-canvas').click({ position: { x: 400, y: 300 } });
  await other.keyboard.press('Control+a');
  await other.keyboard.press('Delete');
  expect(await other.evaluate(() => Object.keys((window as any).__satis.useProjectStore.getState().project.buildings).length)).toBe(1);
  await expect(other.locator('.toast-error').filter({ hasText: 'Schreibgeschützt' })).toBeVisible();
  // Als Kopie übernehmen → bearbeitbar
  await other.getByRole('button', { name: 'Als Kopie übernehmen' }).click();
  await expect(other.getByTestId('shared-banner')).toHaveCount(0);
  await expect(other.locator('.project-name input')).toHaveValue('Geteiltes Werk (Kopie)');
  await ctx.close();
});
