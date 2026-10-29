import { expect, test, type Page } from '@playwright/test';
import { clickWorld, newProject, placeFromCatalog, projectState, setPrefs } from './helpers';

const state = <T>(page: Page, fn: string) => projectState<T>(page, fn);

test('Förderband vom Eingang zum Ausgang, Verlegemodus Gerade per erneutem B, Stufe per N', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenbarren', 'Eisenbarren', [[0, 0]]);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[16, 24]]);
  // Lage der Anschlüsse aus den Spieldaten (Gebäude ungedreht)
  const geo = await page.evaluate(() => {
    const w = (window as any).__satis;
    const s = w.useProjectStore.getState();
    const [smelter, ctor] = Object.values(s.project.buildings) as any[];
    const at = (type: string, id: string) => w.core.portDefs(s.gd.building(type)).find((p: { id: string }) => p.id === id).local;
    const o = at('Build_SmelterMk1_C', 'belt-out-0');
    const i = at('Build_ConstructorMk1_C', 'belt-in-0');
    return {
      out: { x: smelter.placement.x + o.x, y: smelter.placement.y + o.y },
      inp: { x: ctor.placement.x + i.x, y: ctor.placement.y + i.y },
    };
  });
  await page.keyboard.press('b');
  await page.keyboard.press('b'); // erneut: Normal → Gerade
  const routing = page.locator('.editor-toolbar .segmented').nth(1);
  const tier = page.locator('.editor-toolbar .segmented').nth(2);
  await expect(routing.locator('button.active')).toHaveText('Gerade');
  await page.keyboard.press('n'); // Mk.1 → Mk.2
  await expect(tier.locator('button.active')).toHaveText('Mk.2');
  // Start am Eingang des Konstruktors, Ende am Ausgang des Schmelzofens
  await clickWorld(page, geo.inp.x, geo.inp.y);
  await clickWorld(page, geo.out.x, geo.out.y);
  const link = await state<{ fromType: string; toType: string; routing: string }>(
    page,
    `(p) => { const l = Object.values(p.links)[0]; return { fromType: p.buildings[l.from.buildingId].type, toType: p.buildings[l.to.buildingId].type, routing: l.routing }; }`,
  );
  expect(link).toEqual({ fromType: 'Build_SmelterMk1_C', toType: 'Build_ConstructorMk1_C', routing: 'straight' });
  expect(await state<string>(page, '(p) => Object.values(p.links)[0].tier')).toBe('Build_ConveyorBeltMk2_C');
  // Auswahl bleibt für die nächste Benutzung des Werkzeugs erhalten
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('b');
  await expect(routing.locator('button.active')).toHaveText('Gerade');
  await expect(tier.locator('button.active')).toHaveText('Mk.2');
});

test('Gebäude im 0,5-m-Raster platzieren', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('snap-select').selectOption('0.5');
  expect(await state<number>(page, '(p) => p.settings.snapM')).toBe(0.5);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[3.3, 2.2]]);
  const pl = await state<{ x: number; y: number }>(page, '(p) => Object.values(p.buildings)[0].placement');
  // Ecke der Hülle liegt auf dem 0,5-m-Raster
  const corner = await page.evaluate(({ x, y }) => {
    const b = (window as any).__satis.useProjectStore.getState().gd.building('Build_ConstructorMk1_C').bounds;
    return { x: x + b.minX, y: y + b.minY };
  }, pl);
  expect((corner.x * 2) % 1).toBeCloseTo(0);
  expect((corner.y * 2) % 1).toBeCloseTo(0);
  expect(corner.x % 1).not.toBe(0); // nicht nur ganzzahlig
});

test('Produktion: Diagramm und Sortierung Rohstoff → Endprodukt', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Produktion', exact: true }).click();
  await page.locator('[data-tour="add-plan"]').click();
  await page.getByPlaceholder('Zielprodukt hinzufügen …').fill('Schrauben');
  await expect(page.getByTestId('result-banner')).toContainText('Alle Ziele erreichbar');
  const rows = page.getByTestId('item-table').locator('tbody tr td:first-child');
  await page.getByTestId('item-sort').locator('select').selectOption('raw-first');
  await expect(rows.first()).toContainText('Eisenerz');
  await expect(rows.last()).toContainText('Schrauben');
  await page.getByTestId('item-sort').locator('select').selectOption('final-first');
  await expect(rows.first()).toContainText('Schrauben');
  await page.getByRole('button', { name: 'Diagramm' }).click();
  await expect(page.getByTestId('flow-diagram').locator('g.fn-recipe')).toHaveCount(3);
  await expect(page.getByTestId('flow-diagram').locator('g.fn-supply')).toHaveCount(1);
});

/** Leeres Netz: Ansicht zentriert auf (0,0) mit 2 px/m. */
async function railClick(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas.editor-canvas').boundingBox())!;
  const p = { x: box.x + box.width / 2 + x * 2, y: box.y + box.height / 2 + y * 2 };
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test('Signal auf freiem Gleis teilt das Segment; Richtung nach Klickseite', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Schienennetz' }).click();
  await page.locator('[data-tour="add-network"]').click();
  await page.keyboard.press('g');
  // 90 m (Gleisstücke höchstens 100 m)
  await railClick(page, -45, 0);
  await railClick(page, 45, 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await state<number>(page, '(p) => Object.keys(p.railSegments).length')).toBe(1);
  await page.keyboard.press('p');
  // Gleis nach Osten (+x); Klick rechts der Fahrtrichtung (Süden, +y) = Fahrt nach Osten
  await railClick(page, 0, 2);
  const r = await state<{ segs: number; kind: string; facing: string; x: number }>(
    page,
    `(p) => { const s = Object.values(p.railSignals)[0]; const n = p.railNodes[s.nodeId]; const seg = Object.values(p.railSegments)[0]; const a = p.railNodes[seg.a.nodeId]; return { segs: Object.keys(p.railSegments).length, kind: s.kind, facing: s.facing, x: Math.round(n.position.x) }; }`,
  );
  expect(r.segs).toBe(2);
  expect(r.kind).toBe('path');
  expect(Math.abs(r.x)).toBeLessThanOrEqual(1);
  // Fahrtrichtung des Signals zeigt nach Osten
  const dir = await page.evaluate(() => {
    const p = (window as any).__satis.useProjectStore.getState().project;
    const s = Object.values(p.railSignals)[0] as any;
    const n = p.railNodes[s.nodeId];
    const h = (n.headingDeg * Math.PI) / 180;
    return Math.round(Math.cos(h) * (s.facing === 'forward' ? 1 : -1));
  });
  expect(dir).toBe(1);

  // Auswahlwerkzeug: Klick auf den Signalpfeil wählt das Signal, nicht den Knoten darunter
  await page.keyboard.press('v');
  // Signal nach Osten: Pfeil rechts der Fahrt (Süden), 7 px / 2 px/m + 3 m = 6,5 m neben dem Knoten
  await railClick(page, r.x, 6.5);
  expect(await page.evaluate(() => (window as any).__satis.useUiStore.getState().selection.map((s: any) => s.table))).toEqual(['railSignals']);
});

test('Simulation: Zug fährt animiert, Zeit läuft', async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    const { useProjectStore, useUiStore, core } = (window as any).__satis;
    useProjectStore.getState().apply('setup', (p: any) => {
      const rail = core.railOps;
      const pt = (x: number, y: number) => ({ kind: 'point', position: { x, y, z: 0 } });
      const node = (nodeId: string) => ({ kind: 'node', nodeId });
      const net = rail.addNetwork(p, 'N');
      const pf = [{ type: 'freight', mode: 'load', flipped: false }];
      const s1 = rail.addStation(p, { networkId: net, name: 'A', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: pf });
      const S1 = p.stations[s1];
      const x = rail.addTrack(p, net, node(S1.frontNodeId), pt(92, 60)).toNodeId;
      const y = rail.addTrack(p, net, node(x), pt(32, 120)).toNodeId;
      const s2 = rail.addStation(p, { networkId: net, name: 'B', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, backNodeId: y, platforms: pf });
      const w = rail.addTrack(p, net, node(p.stations[s2].frontNodeId), pt(-60, 60)).toNodeId;
      rail.addTrack(p, net, node(w), node(S1.backNodeId));
      const tt = rail.addTimetable(p, net, 'F', [s1, s2]);
      const t = rail.addTrain(p, net, 'Z');
      rail.updateTrain(p, t, { timetableId: tt });
    });
    useUiStore.getState().setMode('rail');
  });
  await page.getByRole('button', { name: '▶ Züge fahren lassen' }).click();
  await page.waitForTimeout(1500);
  const t = await page.evaluate(() => (window as any).__satis.useSimStore.getState().sim.time);
  expect(t).toBeGreaterThan(5);
  await page.keyboard.press('t'); // anhalten
  expect(await page.evaluate(() => (window as any).__satis.useSimStore.getState().playing)).toBe(false);
});

test('Befunde je Reiter: Fabrikbefunde erscheinen nicht in der Schienenansicht', async ({ page }) => {
  await newProject(page);
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0], [4, 0]]);
  await expect(page.locator('.finding').filter({ hasText: 'überschneiden sich' })).toBeVisible();
  await expect(page.locator('[data-mode="factory"] .badge-err')).toHaveText('1');
  await page.getByRole('button', { name: 'Schienennetz' }).click();
  await page.locator('[data-tour="add-network"]').click();
  await expect(page.locator('.finding').filter({ hasText: 'überschneiden sich' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Alle Bereiche' }).click();
  await expect(page.locator('.finding').filter({ hasText: 'überschneiden sich' })).toBeVisible();
});

test('Farbschema, Sprache und eigene Tastenbelegung', async ({ page }) => {
  await newProject(page);
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: 'Hell' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // Drehen auf Taste E legen
  await page.getByRole('button', { name: 'Tastenkürzel' }).click();
  await page.locator('[data-action="factory.rotate"]').getByRole('button', { name: 'Ändern' }).click();
  await page.keyboard.press('e');
  await expect(page.locator('[data-action="factory.rotate"]')).toContainText('E');
  await page.keyboard.press('Escape');
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0]]);
  await clickWorld(page, 0, 0);
  await page.keyboard.press('e');
  expect(await state<number>(page, '(p) => Object.values(p.buildings)[0].placement.rotationDeg')).toBe(90);
  await page.keyboard.press('r'); // alte Taste wirkt nicht mehr
  expect(await state<number>(page, '(p) => Object.values(p.buildings)[0].placement.rotationDeg')).toBe(90);
  // Sprache Englisch
  await page.getByTestId('settings-button').click();
  await page.getByTestId('language-select').selectOption('en');
  await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-mode="factory"]')).toContainText('Factory floor plan');
  await expect(page.locator('.catalog-group h4').first()).toHaveText('Production');
  // Einstellungen bleiben nach Neuladen erhalten
  await page.reload();
  await expect(page.locator('[data-mode="factory"]')).toContainText('Factory floor plan');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Tutorial: Begrüßung, Einführung, interaktiver Schritt geht automatisch weiter', async ({ page }) => {
  await page.goto('/');
  await setPrefs(page, { welcomed: false });
  await page.goto('/');
  await page.getByPlaceholder('Projektname').fill('Tour');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Einführung starten' }).click();
  await expect(page.getByTestId('tour')).toContainText('Willkommen beim Satis Planner');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour')).toContainText('Vier Ansichten');
  await page.getByRole('button', { name: 'Beenden' }).click();
  await expect(page.getByTestId('tour')).toHaveCount(0);
  // Fabrik-Tour: Schritt 1 erledigt sich durch Auswahl im Katalog
  await page.getByTestId('help-button').click();
  await page.locator('.menu-item').filter({ hasText: 'Fabrikgrundriss' }).click();
  await expect(page.getByTestId('tour')).toContainText('Gebäude suchen');
  await page.locator('#catalog-search').fill('Eisenplatte');
  await page.locator('.item-list li').filter({ hasText: 'Eisenplatte' }).first().click();
  await expect(page.getByTestId('tour')).toContainText('Platzieren', { timeout: 3000 });
});

test('Transport: Auftrag mit Zug und geschätztem Durchsatz', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: '+ Fabrik' }).click();
  await page.locator('[data-mode="transport"]').click();
  await page.locator('[data-tour="add-order"]').click();
  await expect(page.getByTestId('orders-table')).toContainText('kein Zug');
  await expect(page.locator('.finding').filter({ hasText: 'kein Zug zugeordnet' })).toBeVisible();
  await expect(page.getByTestId('trade-table')).toBeVisible();
});

test('Stockwerke: neue Ebenen 18 m bzw. 6 m mit 2 m Decke, Anzeige des Bereichs', async ({ page }) => {
  await newProject(page);
  const floors = page.locator('.section').filter({ hasText: 'Stockwerke' });
  await expect(floors.locator('.floor-list li')).toHaveText([/Erdgeschoss.*0 m – 18 m/]);
  await floors.getByRole('button', { name: '+ Logistik' }).click();
  await floors.getByRole('button', { name: '+ Ebene' }).click();
  await expect(floors.locator('.floor-list li')).toHaveText([/28 m – 46 m/, /Logistik · 20 m – 26 m/, /0 m – 18 m/]);
});

test('Softwareversion und ausführliches Tutorial', async ({ page }) => {
  await newProject(page);
  await expect(page.locator('.topbar .app-version')).toHaveText(/^v\d+\.\d+\.\d+/);
  await page.getByTestId('help-button').click();
  await page.getByRole('button', { name: 'Einführung' }).click();
  await expect(page.getByTestId('tour-detail')).toHaveCount(0);
  await page.getByTestId('tour-detail-toggle').click();
  await expect(page.getByTestId('tour-detail')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__satis.usePrefs.getState().detailedTours)).toBe(true);
});

test('Fahrplan: nur bestimmte Gegenstände per Suche auswählen', async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    const { useProjectStore, useUiStore, core } = (window as any).__satis;
    let ttId = '';
    useProjectStore.getState().apply('setup', (p: any) => {
      const rail = core.railOps;
      const net = rail.addNetwork(p, 'N');
      const pf = [{ type: 'freight', mode: 'load', flipped: false }];
      const s1 = rail.addStation(p, { networkId: net, name: 'A', position: { x: 0, y: 0, z: 0 }, headingDeg: 0, platforms: pf });
      const s2 = rail.addStation(p, { networkId: net, name: 'B', position: { x: 0, y: 100, z: 0 }, headingDeg: 0, platforms: pf });
      ttId = rail.addTimetable(p, net, 'F', [s1, s2]);
      useUiStore.getState().setNetwork(net);
    });
    useUiStore.getState().setMode('rail');
    useUiStore.getState().select([{ table: 'timetables', id: ttId }]);
  });
  const stop = page.locator('.stop').first();
  await stop.locator('.row').filter({ hasText: 'Umschlag' }).locator('select').selectOption('items');
  await stop.getByPlaceholder('Gegenstand suchen …').fill('Eisenerz');
  await stop.locator('.picker-results li').filter({ hasText: 'Eisenerz' }).first().click();
  await expect(stop.locator('.chip')).toHaveText([/Eisenerz/]);
  // Güterbahnsteig: Flüssigkeiten stehen nicht zur Auswahl
  await stop.getByPlaceholder('Gegenstand suchen …').fill('Rohöl');
  await expect(stop.locator('.picker-results li')).toHaveCount(0);
  expect(await state<string[]>(page, '(p) => Object.values(p.timetables)[0].stops[0].itemIds')).toEqual(['Desc_OreIron_C']);
});

test('Transport per Lkw und per direktem Förderband zwischen zwei Fabriken', async ({ page }) => {
  await newProject(page);
  // Fabrik 1: Schmelzofen, Fabrik 2: Konstruktor
  await page.evaluate(() => {
    const { useProjectStore, useUiStore, core } = (window as any).__satis;
    useProjectStore.getState().apply('setup', (p: any, gd: any) => {
      const fac = core.factoryOps;
      const [a] = Object.values(p.factories) as any[];
      const b = fac.addFactory(p, 'Werk B');
      const fb = p.factories[b];
      fac.addBuilding(p, gd, { factoryId: a.id, type: 'Build_SmelterMk1_C', recipeId: 'Recipe_IngotIron_C', placement: { floorId: a.floorIds[0], x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
      const c = fac.addBuilding(p, gd, { factoryId: b, type: 'Build_ConstructorMk1_C', recipeId: 'Recipe_IronPlate_C', placement: { floorId: fb.floorIds[0], x: 0, y: 0, zOffsetM: 0, rotationDeg: 0 } });
      const sink = fac.addBuilding(p, gd, { factoryId: b, type: 'Build_ResourceSink_C', placement: { floorId: fb.floorIds[0], x: 40, y: 0, zOffsetM: 0, rotationDeg: 0 } });
      fac.addLink(p, gd, { kind: 'belt', tier: 'Build_ConveyorBeltMk1_C', from: { buildingId: c, portId: 'belt-out-0' }, to: { buildingId: sink, portId: 'belt-in-0' } });
    });
    useUiStore.getState().setMode('transport');
  });
  await page.locator('[data-tour="add-order"]').click();
  const props = page.locator('.panel-right');
  // Lkw: Schätzung erscheint
  await props.getByTestId('transport-mode').selectOption('vehicle');
  await props.getByTestId('vehicle-type').selectOption('Desc_Truck_C');
  await expect(props.getByTestId('vehicle-sum')).toContainText('/ 60');
  await expect(page.getByTestId('orders-table')).toContainText('1 × Lkw');
  await expect(page.locator('.finding').filter({ hasText: 'keine entladende Lkw-Station' })).toBeVisible();
  // Förderband: Gegenstand Eisenbarren, Anschlüsse wählen
  await props.getByTestId('transport-mode').selectOption('belt');
  const item = props.locator('.row').filter({ hasText: 'Gegenstand' }).locator('input');
  await item.fill('Eisenbarren');
  await item.blur();
  await props.getByTestId('direct-from').selectOption({ index: 1 });
  await props.getByTestId('direct-to').selectOption({ index: 1 });
  await expect(props.getByTestId('direct-capacity')).toContainText('60 / 60');
  const o = await projectState<any>(page, '(p) => Object.values(p.transportOrders)[0]');
  expect(o.mode).toBe('belt');
  expect(o.itemId).toBe('Desc_IronIngot_C');
  expect(o.direct.from.portId).toBe('belt-out-0');
  expect(o.direct.to.portId).toMatch(/^belt-in-/);
  // Im Grundriss der empfangenden Fabrik: Konstruktor wird über die Leitung versorgt
  const util = await page.evaluate(() => {
    const { useProjectStore, core } = (window as any).__satis;
    const { project, gd } = useProjectStore.getState();
    const f = Object.values(project.factories).find((x: any) => x.name === 'Werk B') as any;
    const ctor = Object.values(project.buildings).find((b: any) => b.factoryId === f.id && b.type === 'Build_ConstructorMk1_C') as any;
    return core.computeFactoryFlow(project, gd, f.id).machines.get(ctor.id).utilization;
  });
  expect(util).toBeGreaterThan(0.99);
});
