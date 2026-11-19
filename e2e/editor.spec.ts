import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickWorld, newProject, placeFromCatalog, projectState, toScreen } from './helpers';

const countBuildings = '(p) => Object.keys(p.buildings).length';

test('Gebäude platzieren, verschieben, rückgängig machen und wiederholen', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0], [24, 0]]);
  expect(await projectState<number>(page, countBuildings)).toBe(2);

  // Ziehen verschiebt um 8 m (Fangweite 1 m)
  const a = await toScreen(page, 24, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 24, a.y, { steps: 5 });
  await page.mouse.move(a.x + 48, a.y, { steps: 5 });
  await page.mouse.up();
  const xs = await projectState<number[]>(page, '(p) => Object.values(p.buildings).map((b) => b.placement.x).sort((a,b)=>a-b)');
  expect(xs).toEqual([0, 32]);

  await page.keyboard.press('Control+z');
  expect(await projectState<number[]>(page, '(p) => Object.values(p.buildings).map((b) => b.placement.x).sort((a,b)=>a-b)')).toEqual([0, 24]);
  await page.keyboard.press('Control+y');
  expect(await projectState<number[]>(page, '(p) => Object.values(p.buildings).map((b) => b.placement.x).sort((a,b)=>a-b)')).toEqual([0, 32]);

  // Drehen mit R, Kopieren mit Strg+D, Löschen mit Entf
  await page.keyboard.press('r');
  expect(await projectState<number[]>(page, '(p) => Object.values(p.buildings).map((b) => b.placement.rotationDeg).sort()')).toContain(90);
  await page.keyboard.press('Control+d');
  expect(await projectState<number>(page, countBuildings)).toBe(3);
  await page.keyboard.press('Delete');
  expect(await projectState<number>(page, countBuildings)).toBe(2);
});

test('Überschneidung wird als Fehler mit Regel, Erklärung und Vorschlag gemeldet', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0], [4, 0]]);
  const row = page.locator('.finding').filter({ hasText: 'überschneiden sich' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Details' }).click();
  await expect(row).toContainText('FAB-001');
  await expect(row).toContainText('Vorschlag');
  await expect(row).toContainText('Spielregel');
});

test('Förderband zwischen Ausgang und Eingang verbinden', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenbarren', 'Eisenbarren', [[0, 0]]);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 24]]);
  const ports = await projectState<{ out: { x: number; y: number }; inp: { x: number; y: number } }>(
    page,
    `(p) => {
      const [smelter, ctor] = Object.values(p.buildings);
      return { out: { x: smelter.placement.x, y: smelter.placement.y }, inp: { x: ctor.placement.x, y: ctor.placement.y } };
    }`,
  );
  await page.keyboard.press('b');
  // Lage der Anschlüsse aus den Spieldaten (Gebäude ungedreht)
  const local = await page.evaluate(() => {
    const s = (window as any).__satis;
    const gd = s.useProjectStore.getState().gd;
    const at = (type: string, id: string) => s.core.portDefs(gd.building(type)).find((p: { id: string }) => p.id === id).local;
    return { out: at('Build_SmelterMk1_C', 'belt-out-0'), inp: at('Build_ConstructorMk1_C', 'belt-in-0') };
  });
  await clickWorld(page, ports.out.x + local.out.x, ports.out.y + local.out.y);
  await clickWorld(page, ports.inp.x + local.inp.x, ports.inp.y + local.inp.y);
  expect(await projectState<number>(page, '(p) => Object.keys(p.links).length')).toBe(1);
  await page.locator('.bottom-tabs').getByRole('button', { name: 'Bilanz' }).click();
  await expect(page.locator('.balance')).toContainText('Eisenplatte');
});

test('Fläche zeichnen und Flächenstatistik', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Baufläche' }).click();
  const a = await toScreen(page, -16, -16);
  const b = await toScreen(page, 16, 16);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  expect(await projectState<number>(page, '(p) => Object.keys(p.areas).length')).toBe(1);
  await page.locator('.bottom-tabs').getByRole('button', { name: 'Flächen' }).click();
  await expect(page.locator('.bottom-body table')).toContainText('1.024');
});

test('Autosave: Projekt ist nach Neuladen wieder da', async ({ page }) => {
  await newProject(page, 'Persistenz');
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0]]);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 });
  await page.reload();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  expect(await projectState<string>(page, '(p) => p.name')).toBe('Persistenz');
  expect(await projectState<number>(page, countBuildings)).toBe(1);
});

test('Export und Import als versioniertes JSON', async ({ page }) => {
  await newProject(page, 'Export');
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0], [16, 0]]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  const file = await download.path();
  const json = JSON.parse(readFileSync(file!, 'utf8'));
  expect(json.kind).toBe('satis-planner-project');
  expect(json.formatVersion).toBe(5);
  expect(Object.keys(json.project.buildings)).toHaveLength(2);

  // Projekt leeren und wieder importieren
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await projectState<number>(page, countBuildings)).toBe(0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import', exact: true }).click()]);
  await chooser.setFiles(file!);
  await expect(page.locator('.toast').filter({ hasText: 'importiert' })).toBeVisible();
  expect(await projectState<number>(page, countBuildings)).toBe(2);
});
