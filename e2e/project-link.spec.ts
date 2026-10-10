import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newProject, placeFromCatalog, projectState, setPrefs } from './helpers';

const countBuildings = '(p) => Object.keys(p.buildings).length';
const LINK = /\/f\/[A-Za-z0-9_-]{22}$/;

async function openLink(page: Page, url: string) {
  await page.goto('/');
  await setPrefs(page);
  await page.goto(url);
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
}

test('Projekt-Link: anlegen, auf zweitem Gerät öffnen und bearbeiten', async ({ page, browser }) => {
  await newProject(page, 'Gemeinsames Werk');
  const link = await page.getByTestId('project-link').inputValue();
  expect(link).toMatch(LINK);
  // Die Adresszeile zeigt die geheime ID nicht (Streams, Bildschirmfreigabe)
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('link-bar')).toContainText('Lesezeichen');
  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0]]);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 });

  // Zweites Gerät (eigener Browser-Kontext, leerer Speicher)
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openLink(other, new URL(link).pathname);
  await expect(other.locator('.project-name input')).toHaveValue('Gemeinsames Werk');
  await expect(other).toHaveURL(/\/$/);
  expect(await projectState<number>(other, countBuildings)).toBe(1);
  await placeFromCatalog(other, 'Eisenplatte', 'Eisenplatte', [[16, 0]]);
  await expect(other.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 });

  // Erstes Gerät sieht den neuen Stand nach dem Neuladen
  await page.reload();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  expect(await projectState<number>(page, countBuildings)).toBe(2);

  // Startseite: Projekt steht unter „Zuletzt auf diesem Gerät geöffnet“
  await other.locator('.brand').click();
  await expect(other.getByTestId('recent-list')).toContainText('Gemeinsames Werk');
  await ctx.close();
});

test('Projekt-Link: gleichzeitiges Bearbeiten führt zu einer Rückfrage statt zu stillem Überschreiben', async ({ page, browser }) => {
  await newProject(page, 'Konflikt');
  const path = new URL(await page.getByTestId('project-link').inputValue()).pathname;
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openLink(other, path);

  await placeFromCatalog(page, 'Eisenplatte', 'Eisenplatte', [[0, 0]]);
  await expect(page.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 });

  // Das zweite Gerät kennt den neuen Stand nicht → Rückfrage; „OK“ = eigenen Stand speichern
  let asked = '';
  other.once('dialog', (d) => {
    asked = d.message();
    void d.accept();
  });
  await placeFromCatalog(other, 'Eisenplatte', 'Eisenplatte', [[16, 0], [32, 0]]);
  await expect(other.locator('.save-status')).toHaveText('Gespeichert', { timeout: 5000 });
  expect(asked).toContain('anderen Gerät');

  await page.reload();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  expect(await projectState<number>(page, countBuildings)).toBe(2);
  await ctx.close();
});

test('Ungültiger oder unbekannter Link zeigt eine Meldung und die Startseite', async ({ page }) => {
  await page.goto('/');
  await setPrefs(page);
  await page.goto('/f/AAAAAAAAAAAAAAAAAAAAAA');
  await expect(page.locator('.toast-error')).toContainText('nicht gefunden');
  await expect(page.getByRole('button', { name: 'Neues Projekt' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('Lokale Projekte (IndexedDB, altes Format 1) werden zum Hochladen angeboten und migriert', async ({ page, request }) => {
  await page.goto('/');
  await setPrefs(page);
  const v1 = JSON.parse(readFileSync('apps/server/test/fixtures/project-v1.json', 'utf8'));
  await page.evaluate(async (project) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('satis-planner', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('projects', { keyPath: 'id' });
        open.result.createObjectStore('index', { keyPath: 'id' });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(['projects', 'index'], 'readwrite');
        tx.objectStore('projects').put({ id: project.id, data: project, savedAt: project.updatedAt });
        tx.objectStore('index').put({ id: project.id, name: project.name, updatedAt: project.updatedAt, datasetId: 'sf-1.2.4.0', factories: 1, buildings: 0, railSegments: 0 });
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    });
  }, v1);
  await page.reload();
  const offer = page.getByTestId('upload-offer');
  await expect(offer).toContainText('Altes Werk (Format 1)');
  await offer.getByRole('button', { name: 'Hochladen' }).click();
  await expect(page.locator('canvas.editor-canvas')).toBeVisible();
  const uploaded = await page.getByTestId('project-link').inputValue();
  expect(uploaded).toMatch(LINK);
  expect(await projectState<number>(page, '(p) => p.formatVersion')).toBe(2);

  // Auf dem Server liegt das Projekt im aktuellen Format
  const id = new URL(uploaded).pathname.split('/').pop()!;
  const r = await request.get(`/api/factory/${id}`);
  expect((await r.json()).project.formatVersion).toBe(2);

  // Angebot merkt sich den Upload und lässt sich ausblenden
  await page.locator('.brand').click();
  await expect(offer.getByRole('button', { name: 'Hochgeladen – öffnen' })).toBeVisible();
  await offer.getByRole('button', { name: 'Nicht mehr anzeigen' }).click();
  await page.reload();
  await page.locator('.brand').click();
  await expect(page.getByTestId('upload-offer')).toHaveCount(0);
});

test('Streamer-Modus verdeckt den Link, Neuladen öffnet das Projekt dieses Tabs', async ({ page }) => {
  await newProject(page, 'Stream-Werk');
  const link = await page.getByTestId('project-link').inputValue();
  await page.getByTestId('settings-button').click();
  await page.getByTestId('streamer-mode').check();
  await page.keyboard.press('Escape');
  const shown = await page.getByTestId('project-link').inputValue();
  expect(shown).not.toBe(link);
  expect(shown).not.toContain(new URL(link).pathname.split('/').pop()!);

  // Ein zweites Projekt anlegen, dann zurück: Zurück-Taste öffnet wieder das erste
  await page.locator('.brand').click();
  await page.getByPlaceholder('Projektname').fill('Zweites Werk');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await expect(page.locator('.project-name input')).toHaveValue('Zweites Werk');
  await page.goBack();
  await expect(page.locator('.project-name input')).toHaveValue('Stream-Werk');
  await page.reload();
  await expect(page.locator('.project-name input')).toHaveValue('Stream-Werk');
  await expect(page).toHaveURL(/\/$/);
});
