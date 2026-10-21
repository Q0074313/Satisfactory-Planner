/**
 * Hotfix 0.6.1: Vorkommen von der Karte belegen, Bedarf gegen Vorkommen,
 * Flächen im 8-m-Raster mit Ecken-Bearbeitung, Bahnhofsabgleich, Hervorheben.
 */
import { expect, test, type Page } from '@playwright/test';
import { newProject, projectState, toScreen } from './helpers';

const PREFS = { mapTiles: 'off' };

const run = (page: Page, fn: string) => page.evaluate(`(() => { const s = window.__satis; const st = s.useProjectStore.getState(); ${fn} })()`);

test('Karte: Vorkommen belegen und freigeben, Bedarf gedeckt, Hervorheben beim Überfahren', async ({ page }) => {
  await newProject(page, 'Belegen', PREFS);
  // Fabrik mit Plan (90 Eisenerz/min) neben einem reinen Eisenerz-Node
  await run(
    page,
    `const fid = Object.keys(st.project.factories)[0];
     const n = st.gd.map.nodes.find((x) => x.kind === 'node' && x.itemId === 'Desc_OreIron_C' && x.purity === 'pure');
     window.__node = n.id;
     st.apply('Karte', (d) => s.core.mapOps.setFactoryMap(d, fid, { x: n.x - 40, y: n.y, rotationDeg: 0 }));
     st.apply('Plan', (d, g) => { const id = s.core.productionOps.addPlan(d, fid, 'Platten'); s.core.productionOps.updatePlan(d, g, id, { targets: [{ itemId: 'Desc_IronPlate_C', ratePerMin: 60 }] }); });`,
  );
  await page.locator('button[data-mode="map"]').click();
  // Fabrik gewählt: Bedarf noch nicht gedeckt
  await run(page, `s.useMapStore.getState().select({ kind: 'factory', id: Object.keys(st.project.factories)[0] });`);
  await expect(page.getByTestId('node-demand')).toContainText('fehlt');
  // Hervorheben aus der Liste „Vorkommen in der Nähe“
  await page.locator('.panel-right li').filter({ hasText: 'Eisenerz (rein)' }).first().hover();
  expect(await page.evaluate(() => (window as any).__satis.useMapStore.getState().hoverNodeId)).toBe(await page.evaluate(() => (window as any).__node));

  // Vorkommen wählen und belegen
  await run(page, `s.useMapStore.getState().select({ kind: 'node', id: window.__node });`);
  await page.getByTestId('occupy-type').selectOption('Build_MinerMk1_C');
  await page.getByTestId('occupy-node').click();
  const b = await projectState<{ type: string; placement: unknown; extraction: { nodeId: string } }>(page, '(p) => Object.values(p.buildings)[0]');
  expect(b.type).toBe('Build_MinerMk1_C');
  expect(b.placement).not.toBeNull();
  expect(b.extraction.nodeId).toBe(await page.evaluate(() => (window as any).__node));
  await expect(page.getByTestId('node-occupy')).toHaveCount(0);

  await run(page, `s.useMapStore.getState().select({ kind: 'factory', id: Object.keys(st.project.factories)[0] });`);
  await expect(page.getByTestId('node-demand')).toContainText('gedeckt');

  // Freigeben löst die Verknüpfung, das Gebäude bleibt
  await run(page, `s.useMapStore.getState().select({ kind: 'node', id: window.__node });`);
  await page.getByTestId('node-release').click();
  expect(await projectState<unknown>(page, '(p) => Object.values(p.buildings)[0].extraction.nodeId')).toBeNull();
  await expect(page.getByTestId('node-occupy')).toBeVisible();
});

test('Fabrikgrundriss: Baufläche im 8-m-Raster, Ecke nachträglich ziehen', async ({ page }) => {
  await newProject(page, 'Flächen', PREFS);
  await page.keyboard.press('a');
  const a = await toScreen(page, 1, 1);
  const b = await toScreen(page, 21, 13);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  const poly = await projectState<{ x: number; y: number }[]>(page, '(p) => Object.values(p.areas)[0].polygon');
  for (const q of poly) {
    expect(Math.abs(q.x % 8)).toBe(0);
    expect(Math.abs(q.y % 8)).toBe(0);
  }
  expect(Math.max(...poly.map((q) => q.x))).toBe(24);
  expect(Math.max(...poly.map((q) => q.y))).toBe(16);

  // Auswahl: Ecke (24, 16) nach (31, 23) ziehen → Rechteck bis (32, 24)
  await page.keyboard.press('v');
  const c = await toScreen(page, 24, 16);
  const d = await toScreen(page, 31, 23);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 6 });
  await page.mouse.up();
  const poly2 = await projectState<{ x: number; y: number }[]>(page, '(p) => Object.values(p.areas)[0].polygon');
  expect(poly2).toHaveLength(4);
  expect(Math.max(...poly2.map((q) => q.x))).toBe(32);
  expect(Math.max(...poly2.map((q) => q.y))).toBe(24);
  expect(Math.min(...poly2.map((q) => q.x))).toBe(0);
});

test('Bahnhof im Schienennetz erscheint im Grundriss; Verschieben im Grundriss bewegt den Bahnhof (ein Undo-Schritt)', async ({ page }) => {
  await newProject(page, 'Bahnhof', PREFS);
  await run(
    page,
    `const fid = Object.keys(st.project.factories)[0];
     st.apply('Karte', (d) => s.core.mapOps.setFactoryMap(d, fid, { x: 0, y: 0, rotationDeg: 0 }));
     st.apply('Bahnhof', (d) => {
       const net = s.core.railOps.addNetwork(d, 'Netz');
       const id = s.core.railOps.addStation(d, { networkId: net, name: 'Erzbahnhof', position: { x: 0, y: -60, z: 0 }, headingDeg: 0, platforms: [{ type: 'freight', mode: 'load', flipped: false }] });
       s.core.railOps.updateStation(d, id, { factoryId: fid });
     });`,
  );
  const parts = await projectState<string[]>(page, '(p) => Object.values(p.buildings).filter((b) => b.stationPart).map((b) => b.type).sort()');
  expect(parts).toEqual(['Build_TrainDockingStation_C', 'Build_TrainStation_C']);
  // Bahnsteig im Grundriss auswählen: Hinweis auf den Abgleich
  await run(page, `const b = Object.values(s.useProjectStore.getState().project.buildings).find((x) => x.type === 'Build_TrainDockingStation_C'); s.useUiStore.getState().select([{ table: 'buildings', id: b.id }]);`);
  await expect(page.getByTestId('station-part')).toContainText('Erzbahnhof');
  // Pfeiltaste verschiebt um die Fangweite (1 m) nach rechts → Bahnhof im Netz ebenso
  await page.locator('canvas.editor-canvas').focus();
  await page.keyboard.press('ArrowRight');
  expect(await projectState<number>(page, '(p) => p.railNodes[Object.values(p.stations)[0].backNodeId].position.x')).toBeCloseTo(1);
  await page.keyboard.press('Control+z');
  expect(await projectState<number>(page, '(p) => p.railNodes[Object.values(p.stations)[0].backNodeId].position.x')).toBeCloseTo(0);
  expect(await projectState<number>(page, '(p) => Object.values(p.buildings).find((b) => b.type === "Build_TrainDockingStation_C").placement.x')).toBeCloseTo(8);
});
