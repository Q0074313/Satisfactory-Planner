import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState } from './helpers';

/** Leeres Netz: Ansicht zentriert auf (0,0) mit 2 px/m. */
async function railClick(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  const p = { x: box.x + box.width / 2 + x * 2, y: box.y + box.height / 2 + y * 2 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

/** Bisheriges Verhalten der Tests: 1-m-Gleisraster (Standard ist 4 m). */
const RAIL_1M = { railSnap: { stepM: 1 } };

async function railSetup(page: Page) {
  await newProject(page, 'Schiene', RAIL_1M);
  await page.getByRole('button', { name: 'Schienennetz' }).click();
  await page.locator('[data-tour="add-network"]').click();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  // Bahnhof 1 (Richtung Ost) und Bahnhof 2 (Richtung West), je 2 Bahnsteige
  await page.keyboard.press('s');
  await railClick(page, -40, -80);
  await page.keyboard.press('s');
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await railClick(page, 40, 40);
  const st = await projectState<{ s1: { back: number[]; front: number[] }; s2: { back: number[]; front: number[] } }>(
    page,
    `(p) => {
      const [a, b] = Object.values(p.stations);
      const pos = (id) => [p.railNodes[id].position.x, p.railNodes[id].position.y];
      return { s1: { back: pos(a.backNodeId), front: pos(a.frontNodeId) }, s2: { back: pos(b.backNodeId), front: pos(b.frontNodeId) } };
    }`,
  );
  expect(st.s1.front).toEqual([8, -80]);
  expect(st.s2.front).toEqual([-8, 40]);
  // Rundkurs im Uhrzeigersinn anschließen
  // Einzelne Bögen sind länger als 100 m: Strg + Klick baut trotz Mindestmaßen (Geometrie wie bisher)
  await page.keyboard.press('g');
  await page.keyboard.down('Control');
  for (const [x, y] of [[8, -80], [60, -80], [120, -20], [40, 40]]) await railClick(page, x, y);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  for (const [x, y] of [[-8, 40], [-60, 40], [-120, -20], [-60, -80], [-40, -80]]) await railClick(page, x, y);
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

test('Rundkurs mit Bahnhöfen, Zug und Fahrplan: Ziele erreichbar, Signalfehler werden markiert', async ({ page }) => {
  await railSetup(page);
  expect(await projectState<number>(page, '(p) => Object.keys(p.stations).length')).toBe(2);
  expect(await projectState<number>(page, '(p) => Object.keys(p.railSegments).length')).toBe(9);

  // Fahrplan S1 → S2
  await page.locator('[data-tour="add-timetable"]').click();
  await page.getByRole('button', { name: '+ Halt' }).click();
  await page.getByRole('button', { name: '+ Halt' }).click();
  await page.locator('.stop').nth(1).locator('select').first().selectOption({ label: 'Bahnhof 2' });
  // Zug anlegen und Fahrplan zuordnen
  await page.locator('[data-tour="add-train"]').click();
  await page.locator('.panel-right').locator('.row').filter({ hasText: 'Fahrplan' }).locator('select').selectOption({ label: 'Fahrplan 1' });
  await expect(page.locator('.leg')).toHaveCount(2);
  await expect(page.locator('.leg').filter({ hasText: 'nicht erreichbar' })).toHaveCount(0);
  await expect(page.locator('.finding').filter({ hasText: 'RAIL-007' })).toHaveCount(0);

  // Einzelnes Signal entgegen der Fahrtrichtung oben auf der Strecke → Ziel unerreichbar
  await page.keyboard.press('b');
  // Knoten (60,-80), Strecke nach Osten: Klick links neben dem Gleis (Norden) = Signal für Fahrt nach Westen (gegen den Uhrzeigersinn)
  await railClick(page, 60, -84);
  await expect(page.locator('.finding').filter({ hasText: 'nicht erreichbar' })).toBeVisible();
  const row = page.locator('.finding').filter({ hasText: 'nicht erreichbar' }).first();
  await row.getByRole('button', { name: 'Details' }).click();
  await expect(row).toContainText('Rückseite eines Signals');
  await expect(row).toContainText('RAIL-007');

  // Rückgängig: Befund verschwindet wieder
  await page.keyboard.press('Control+z');
  await expect(page.locator('.finding').filter({ hasText: 'nicht erreichbar' })).toHaveCount(0);
});

test('Blocksignal am Gleisende und fehlende Ausfahrt werden mit Regel und Vorschlag gemeldet', async ({ page }) => {
  await newProject(page, 'Signale', RAIL_1M);
  await page.getByRole('button', { name: 'Schienennetz' }).click();
  await page.locator('[data-tour="add-network"]').click();
  await page.keyboard.press('g');
  for (const [x, y] of [[-80, 0], [0, 0], [80, 0]]) await railClick(page, x, y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await railClick(page, -4, 0); // Signal am mittleren Knoten, Fahrt nach Osten
  await expect(page.locator('.finding').filter({ hasText: 'Block ohne Ausfahrsignal' })).toBeVisible();
  await railClick(page, 76, 0); // Signal am Gleisende
  await expect(page.locator('.finding').filter({ hasText: 'am Gleisende' })).toBeVisible();
  const f = page.locator('.finding').filter({ hasText: 'am Gleisende' });
  await f.getByRole('button', { name: 'Details' }).click();
  await expect(f).toContainText('Vorschlag');
  await expect(f).toContainText('RAIL-001');
});

test('Gleisbau: 4-m-Raster, Mausrad dreht das Gleisende in Rasterwinkeln, Mindestlänge wird geprüft, Auswahl gemeinsam verschieben', async ({ page }) => {
  await newProject(page, 'Raster');
  await page.getByRole('button', { name: 'Schienennetz' }).click();
  await page.locator('[data-tour="add-network"]').click();
  await expect(page.getByTestId('rail-snap-4')).toHaveClass(/active/);
  await expect(page.getByTestId('rail-snap-8')).toHaveCount(0);
  await page.keyboard.press('g');
  // 4-m-Raster: (-41, 1) → (-40, 0); (41, -1) → (40, 0)
  await railClick(page, -41, 1);
  await railClick(page, 41, -1);
  const nodes = () => projectState<number[][]>(page, '(p) => Object.values(p.railNodes).map((n) => [n.position.x, n.position.y, Math.round(n.headingDeg)])');
  expect((await nodes()).map((n) => n.slice(0, 2))).toEqual([[-40, 0], [40, 0]]);

  // Zu kurz (8 m < 12 m): wird nicht gebaut
  await railClick(page, 48, 0);
  await expect(page.locator('.toast-error')).toContainText('zu kurz');
  expect(await projectState<number>(page, '(p) => Object.keys(p.railSegments).length')).toBe(1);

  // Mausrad: je zwei Rastungen eine 15°-Stufe, absolut zum Raster (0° → 15° → 30°)
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 120 * 2, box.y + box.height / 2);
  for (let k = 0; k < 4; k++) await page.mouse.wheel(0, 100);
  await railClick(page, 120, 0);
  expect((await nodes()).find((n) => n[0] === 120)![2]).toBe(30);
  await page.keyboard.press('Escape');

  // Beide Gleise auswählen (Rahmen) und gemeinsam um 8 m nach unten ziehen
  await page.keyboard.press('Escape');
  const at = (x: number, y: number) => ({ x: box.x + box.width / 2 + x * 2, y: box.y + box.height / 2 + y * 2 });
  await page.mouse.move(at(-60, -30).x, at(-60, -30).y);
  await page.mouse.down();
  await page.mouse.move(at(150, 30).x, at(150, 30).y, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(at(0, 0).x, at(0, 0).y);
  await page.mouse.down();
  await page.mouse.move(at(1, 9).x, at(1, 9).y, { steps: 5 });
  await page.mouse.up();
  expect((await nodes()).map((n) => n.slice(0, 2)).sort((a, b) => a[0]! - b[0]!)).toEqual([[-40, 8], [40, 8], [120, 8]]);
});
