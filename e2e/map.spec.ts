/**
 * Weltkarte (Version 0.6): Vorkommen, Fabrikstandort, Miner auf Vorkommen,
 * Entfernung im Transport, Standortvorschlag. Ohne Kartenbild (kein Internet nötig).
 */
import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState } from './helpers';

const PREFS = { mapTiles: 'off' };

async function canvasCenter(page: Page) {
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Reiner Eisenerz-Node aus den Kartendaten. */
async function pureIron(page: Page) {
  return page.evaluate(() => {
    const gd = (window as any).__satis.useProjectStore.getState().gd;
    return gd.map.nodes.find((n: any) => n.kind === 'node' && n.itemId === 'Desc_OreIron_C' && n.purity === 'pure') as { id: string; x: number; y: number };
  });
}

async function setFactoryMap(page: Page, index: number, m: { x: number; y: number; rotationDeg: number }) {
  await page.evaluate(
    ([i, m]) => {
      const s = (window as any).__satis;
      const fid = Object.keys(s.useProjectStore.getState().project.factories)[i as number];
      s.useProjectStore.getState().apply('Standort', (d: any) => s.core.mapOps.setFactoryMap(d, fid, m));
    },
    [index, m] as const,
  );
}

test('Karte: Vorkommen anklicken, filtern, Fabrik platzieren, ziehen, drehen, entfernen', async ({ page }) => {
  await newProject(page, 'Karte', PREFS);
  await page.locator('button[data-mode="map"]').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();

  // Vorkommen: zentrieren und anklicken → Förderraten
  const node = await pureIron(page);
  await page.evaluate((n) => (window as any).__satis.useMapStore.getState().focusOn(n.x, n.y, 4), node);
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('.panel-right')).toContainText('Eisenerz (rein)');
  await expect(page.getByTestId('node-rates')).toContainText('Miner Mk.1');
  await expect(page.getByTestId('node-rates')).toContainText('120');

  // Filter: Eisenerz ausblenden → Klick trifft nichts mehr
  await page.getByTestId('map-resources').locator('li').filter({ hasText: 'Eisenerz' }).click();
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('.panel-right')).not.toContainText('Eisenerz (rein)');
  await page.getByTestId('map-resources').locator('li').filter({ hasText: 'Eisenerz' }).click();

  // Fabrik platzieren: Grundrissmitte am Mauszeiger; ohne Fundamente liegt der Ursprung auf dem Weltraster (Vielfache von 8 m)
  await page.locator('[data-testid^="place-factory-"]').first().click();
  await page.mouse.move(c.x + 3, c.y + 3);
  await page.mouse.click(c.x + 3, c.y + 3);
  const m = await projectState<{ x: number; y: number; rotationDeg: number }>(page, '(p) => Object.values(p.factories)[0].map');
  // Weltraster (0.9): Fundamentkanten bei 8k + 4 m
  expect((((m.x - 4) % 8) + 8) % 8).toBe(0);
  expect((((m.y - 4) % 8) + 8) % 8).toBe(0);
  expect(Math.abs(m.x - node.x)).toBeLessThan(40);
  await expect(page.getByTestId('map-factories')).toContainText('auf der Karte');

  // Ziehen um 40 m nach Osten (4 px/m) und drehen
  const start = { x: c.x + 3, y: c.y + 3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y, { steps: 5 });
  await page.mouse.move(start.x + 160, start.y, { steps: 5 });
  await page.mouse.up();
  const moved = await projectState<{ x: number }>(page, '(p) => Object.values(p.factories)[0].map');
  expect(moved.x).toBe(m.x + 40);
  await page.keyboard.press('r');
  expect(await projectState<number>(page, '(p) => Object.values(p.factories)[0].map.rotationDeg')).toBe(90);
  await page.keyboard.press('Delete');
  expect(await projectState<unknown>(page, '(p) => Object.values(p.factories)[0].map')).toBeNull();
});

test('Fabrikgrundriss: Miner rastet auf dem Vorkommen ein und übernimmt Rohstoff und Reinheit', async ({ page }) => {
  await newProject(page, 'Miner', PREFS);
  const node = await pureIron(page);
  // Vorkommen liegt im Grundriss bei (20, 0)
  await setFactoryMap(page, 0, { x: node.x - 20, y: node.y, rotationDeg: 0 });
  await page.locator('#catalog-search').fill('Miner Mk.1');
  await page.locator('.item-list li').filter({ hasText: 'Miner Mk.1' }).first().click();
  const c = await canvasCenter(page);
  // 4 m neben dem Vorkommen klicken (6 px/m)
  await page.mouse.move(c.x + 24 * 6, c.y + 2 * 6);
  await page.mouse.click(c.x + 24 * 6, c.y + 2 * 6);
  await page.keyboard.press('Escape');
  const b = await projectState<{ placement: { x: number; y: number }; extraction: { itemId: string; purity: string; nodeId: string } }>(page, '(p) => Object.values(p.buildings)[0]');
  expect(b.placement.x).toBeCloseTo(20, 1);
  expect(b.placement.y).toBeCloseTo(0, 1);
  expect(b.extraction).toEqual({ itemId: 'Desc_OreIron_C', purity: 'pure', nodeId: node.id });
  await expect(page.getByTestId('extraction-node')).toHaveValue(node.id);

  // Fabrik auf der Karte verschieben → Befund „steht neben dem Vorkommen“
  await setFactoryMap(page, 0, { x: node.x, y: node.y + 80, rotationDeg: 0 });
  await page.getByRole('button', { name: 'Alle Bereiche' }).click();
  await expect(page.locator('.finding-head').filter({ hasText: 'neben dem verknüpften Vorkommen' })).toBeVisible();
});

test('Transport: Luftlinie laut Karte übernehmen; Standortvorschlag platziert die Fabrik', async ({ page }) => {
  await newProject(page, 'Strecke', PREFS);
  await page.evaluate(() => {
    const s = (window as any).__satis;
    s.useProjectStore.getState().apply('B', (d: any) => s.core.factoryOps.addFactory(d, 'Stahlwerk'));
  });
  await setFactoryMap(page, 0, { x: 0, y: 0, rotationDeg: 0 });
  await setFactoryMap(page, 1, { x: 600, y: 800, rotationDeg: 0 });
  await page.evaluate(() => {
    const s = (window as any).__satis;
    const ids = Object.keys(s.useProjectStore.getState().project.factories);
    s.useProjectStore.getState().apply('Auftrag', (d: any, g: any) =>
      s.core.transportOps.addOrder(d, g, { name: '', itemId: 'Desc_OreIron_C', ratePerMin: 60, fromFactoryId: ids[0], toFactoryId: ids[1], fromStationId: null, toStationId: null, trainIds: [], roundTripEstimateS: null, mode: 'vehicle' }),
    );
  });
  // Neuer Auftrag übernimmt die Luftlinie (1000 m) als Strecke
  expect(await projectState<number>(page, '(p) => Object.values(p.transportOrders)[0].vehicle.distanceM')).toBe(1000);
  await page.locator('button[data-mode="transport"]').click();
  await page.getByTestId('orders-table').locator('tbody tr').first().click();
  await expect(page.getByTestId('map-distance')).toContainText('1.000 m Luftlinie');
  // Fabrik verschieben → Übernehmen-Knopf erscheint
  await setFactoryMap(page, 1, { x: 1200, y: 1600, rotationDeg: 0 });
  await page.getByTestId('map-distance-take').click();
  expect(await projectState<number>(page, '(p) => Object.values(p.transportOrders)[0].vehicle.distanceM')).toBe(2000);

  // Standortvorschlag für einen Stahlplan der zweiten Fabrik
  await page.evaluate(() => {
    const s = (window as any).__satis;
    const ids = Object.keys(s.useProjectStore.getState().project.factories);
    s.useProjectStore.getState().apply('Plan', (d: any, g: any) => {
      const id = s.core.productionOps.addPlan(d, ids[1], 'Stahl');
      s.core.productionOps.updatePlan(d, g, id, { targets: [{ itemId: 'Desc_SteelPlate_C', ratePerMin: 60 }] });
    });
  });
  await page.locator('button[data-mode="map"]').click();
  await page.getByTestId('site-run').click();
  await expect(page.getByTestId('site-results').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('site-results').locator('li').first()).toContainText('100 %');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('site-place').click();
  const m = await projectState<{ x: number; y: number }>(page, '(p) => Object.values(p.factories)[1].map');
  expect(m.x === 1200 && m.y === 1600).toBe(false);
});
