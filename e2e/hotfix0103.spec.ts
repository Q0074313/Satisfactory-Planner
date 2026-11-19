/**
 * Hotfix 0.10.3: Projekt öffnet sich nach dem Anlegen auch dann, wenn die
 * Startseite ohne offenes Projekt angezeigt wurde (z. B. nach „Zurück“);
 * Fabrik-Reiter per Ziehen umsortieren, „+ Fabrik“ und „Fabrik löschen“
 * bleiben rechts sichtbar.
 */
import { expect, test } from '@playwright/test';
import { newProject, projectState, setPrefs } from './helpers';

test.setTimeout(60_000);

test('Startseite nach „Zurück“ ohne Projekt: neues Projekt öffnet sich sofort', async ({ page }) => {
  await page.goto('/');
  await setPrefs(page);
  await page.goto('/');
  // Zurück/Vor ohne Projekt-ID im Verlauf: Liste soll angezeigt werden
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await page.getByPlaceholder('Projektname').fill('Nach Zurück');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await expect(page.locator('.factory-tabs')).toBeVisible();
  await expect(page.locator('.project-list')).toHaveCount(0);
});

test('Fabrik-Reiter umsortieren; Schaltflächen bleiben rechts', async ({ page }) => {
  await newProject(page, 'Reiter');
  const add = page.getByRole('button', { name: '+ Fabrik' });
  // Viele Fabriken: die Reiter scrollen, die Schaltflächen nicht
  for (let i = 0; i < 12; i++) await add.click();
  const names = () => projectState<string[]>(page, '(p) => Object.values(p.factories).map((f) => f.name)');
  const before = await names();
  expect(before).toHaveLength(13);
  const bar = (await page.locator('.factory-tabs').boundingBox())!;
  const btn = (await add.boundingBox())!;
  expect(btn.x + btn.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  await expect(page.getByRole('button', { name: 'Fabrik löschen' })).toBeInViewport();

  // Dritten Reiter vor den ersten ziehen
  const tabs = page.getByTestId('factory-tab');
  await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: 8 } });
  await expect.poll(names).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
  await expect(tabs.nth(0)).toHaveText(before[2]!);
  // Rückgängig stellt die alte Reihenfolge her
  await page.keyboard.press('Control+z');
  await expect.poll(names).toEqual(before);
});
