import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createProject, PROJECT_FORMAT_VERSION } from '@satis/core';
import { buildServer, redactUrl } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { RateLimiter } from '../src/rateLimit.ts';
import { isProjectId, newProjectId, ProjectStore } from '../src/storage.ts';

const H = { 'x-requested-with': 'satis-planner', 'content-type': 'application/json' };
const newProj = (name: string) => createProject({ name, datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });
const fixture = (name: string) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

let dir: string;
let store: ProjectStore;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'satis-test-'));
  store = new ProjectStore(dir);
  await store.init();
  app = await buildServer({ store, limits: { maxProjectBytes: 200_000, createPerHour: 1000 } });
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

async function create(name = 'Werk') {
  const r = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: newProj(name) } });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string; revision: string };
}

describe('Konfiguration', () => {
  it('kommt ohne Pflichtvariablen aus und liest Limits', () => {
    const c = loadConfig({ STORAGE_DIR: '/srv/x', MAX_PROJECT_BYTES: '1000', RATE_CREATE_PER_HOUR: 'abc' });
    expect(c.port).toBe(8080);
    expect(c.storageDir).toBe('/srv/x');
    expect(c.limits.maxProjectBytes).toBe(1000);
    expect(c.limits.createPerHour).toBe(10);
    expect(c.trustProxy).toBe(false);
  });
});

describe('Projekt-IDs', () => {
  it('haben 128 Bit Zufall, sind URL-sicher und eindeutig', () => {
    const ids = new Set(Array.from({ length: 1000 }, newProjectId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isProjectId(id)).toBe(true);
    expect(Buffer.from([...ids][0]!, 'base64url').length).toBe(16);
  });

  it('lehnen Pfadangriffe und falsche Formate ab', () => {
    for (const bad of ['../../etc/passwd', '..%2F..%2Fetc', 'a'.repeat(21), 'a'.repeat(23), 'abc/def', '', 'prj_abc']) expect(isProjectId(bad)).toBe(false);
  });

  it('werden in Logs gekürzt', () => {
    expect(redactUrl('/api/factory/AbCdEfGhIjKlMnOpQrStUv')).toBe('/api/factory/AbCd…');
    expect(redactUrl('/f/AbCdEfGhIjKlMnOpQrStUv?x=1')).toBe('/f/AbCd…?x=1');
  });
});

describe('API', () => {
  it('Health-Endpunkt prüft den Speicherordner', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, storage: 'ok' });
  });

  it('anlegen, laden, speichern; Datei liegt im Speicherordner', async () => {
    const { id, revision } = await create('Werk');
    expect(isProjectId(id)).toBe(true);
    expect(await readdir(join(dir, 'projects'))).toContain(`${id}.json`);
    const got = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().project.name).toBe('Werk');
    expect(got.json().revision).toBe(revision);
    expect(got.headers['cache-control']).toBe('no-store');

    const p = got.json().project;
    const put = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project: { ...p, name: 'Werk 2' }, baseRevision: revision } });
    expect(put.statusCode).toBe(200);
    expect(put.json().revision).not.toBe(revision);
    const again = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect(again.json().project.name).toBe('Werk 2');
    // Auf der Platte steht das Projekt selbst, mit Formatversion auf oberster Ebene
    const disk = JSON.parse(await readFile(join(dir, 'projects', `${id}.json`), 'utf8'));
    expect(disk.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(disk.name).toBe('Werk 2');
  });

  it('Planer-Version beim Speichern bleibt erhalten (Hotfix 0.8.3), ältere Stände ohne Feld laden weiter', async () => {
    const { id, revision } = await create('Versioniert');
    const project = { ...newProj('Versioniert'), appVersion: '0.8.3' };
    const put = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project, baseRevision: revision } });
    expect(put.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect((got.json() as { project: { appVersion?: string } }).project.appVersion).toBe('0.8.3');
    const old = await create('Alt');
    expect(((await app.inject({ method: 'GET', url: `/api/factory/${old.id}` })).json() as { project: { appVersion?: string } }).project.appVersion).toBeUndefined();
  });

  it('erkennt Konflikte zwischen zwei Geräten (409), Überschreiben ohne Revision ist möglich', async () => {
    const { id, revision } = await create('Konflikt');
    const p = (await app.inject({ method: 'GET', url: `/api/factory/${id}` })).json().project;
    const a = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project: { ...p, name: 'Gerät A' }, baseRevision: revision } });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project: { ...p, name: 'Gerät B' }, baseRevision: revision } });
    expect(b.statusCode).toBe(409);
    expect(b.json().revision).toBe(a.json().revision);
    const force = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project: { ...p, name: 'Gerät B' }, baseRevision: null } });
    expect(force.statusCode).toBe(200);
  });

  it('gleichzeitiges Speichern: Datei bleibt gültig, keine temporären Reste', async () => {
    const { id } = await create('Parallel');
    const p = (await app.inject({ method: 'GET', url: `/api/factory/${id}` })).json().project;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project: { ...p, name: `Stand ${i}` } } })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const disk = JSON.parse(await readFile(join(dir, 'projects', `${id}.json`), 'utf8'));
    expect(disk.name).toMatch(/^Stand \d+$/);
    expect((await readdir(join(dir, 'projects'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('unbekannte und ungültige IDs: 404, kein Dateizugriff außerhalb des Ordners', async () => {
    await writeFile(join(dir, 'geheim.json'), '{"x":1}');
    for (const url of ['/api/factory/AAAAAAAAAAAAAAAAAAAAAA', '/api/factory/..%2Fgeheim', '/api/factory/..%2F..%2Fgeheim', '/api/factory/%2E%2E']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
    }
    const put = await app.inject({ method: 'PUT', url: '/api/factory/AAAAAAAAAAAAAAAAAAAAAA', headers: H, payload: { project: newProj('x') } });
    expect(put.statusCode).toBe(404); // Anlegen nur über POST mit zufälliger ID
  });

  it('ungültiges JSON, ungültige Projekte und fehlender Kopf werden abgelehnt', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: '{"project": ' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid-json');
    const invalid = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: { formatVersion: PROJECT_FORMAT_VERSION, id: 'x' } } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('invalid-project');
    const empty = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: {} });
    expect(empty.statusCode).toBe(400);
    const csrf = await app.inject({ method: 'POST', url: '/api/factory', headers: { 'content-type': 'application/json' }, payload: { project: newProj('x') } });
    expect(csrf.statusCode).toBe(403);
  });

  it('Größenlimit pro Projekt (413)', async () => {
    const p = newProj('Groß');
    p.description = 'x'.repeat(150_000);
    expect((await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: p } })).statusCode).toBe(201);
    p.description = 'x'.repeat(210_000);
    const big = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: p } });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('too-large');
    p.description = 'x'.repeat(400_000);
    expect((await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: p } })).statusCode).toBe(413);
  });

  it('Sicherheitsköpfe: kein Referrer, nicht indexieren', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    // Kartenkacheln: nur Bilder von dieser einen Quelle, keine Skripte oder Verbindungen
    expect(r.headers['content-security-policy']).toMatch(/img-src [^;]*https:\/\/static\.satisfactory-calculator\.com/);
    expect(r.headers['content-security-policy']).toMatch(/connect-src 'self' https:\/\/api\.github\.com;/);
  });
});

describe('Datenformat-Migration', () => {
  it('ein Projekt im Format 1 wird beim Laden auf das aktuelle Format migriert und so gespeichert', async () => {
    const id = newProjectId();
    const v1 = await fixture('project-v1.json');
    expect(JSON.parse(v1).formatVersion).toBe(1);
    await writeFile(join(dir, 'projects', `${id}.json`), v1);

    const got = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect(got.statusCode).toBe(200);
    const { project, revision, migrations } = got.json();
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(project.settings.simulation.dockingS).toBe(27.08);
    expect(project.settings.simulation.stopDurationS).toBeUndefined();
    expect(migrations).toHaveLength(PROJECT_FORMAT_VERSION - 1);
    expect(migrations[0]).toMatch(/^1 → 2/);
    // Datei bleibt bis zum nächsten Speichern unverändert
    expect(JSON.parse(await readFile(join(dir, 'projects', `${id}.json`), 'utf8')).formatVersion).toBe(1);

    const put = await app.inject({ method: 'PUT', url: `/api/factory/${id}`, headers: H, payload: { project, baseRevision: revision } });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(await readFile(join(dir, 'projects', `${id}.json`), 'utf8')).formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });

  it('Hochladen eines alten Projekts (z. B. aus dem Browser) migriert ebenfalls', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: JSON.parse(await fixture('project-v1.json')) } });
    expect(r.statusCode).toBe(201);
    const disk = JSON.parse(await readFile(join(dir, 'projects', `${r.json().id}.json`), 'utf8'));
    expect(disk.formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });

  it('ein Projekt im Format 2 bekommt Kartenstandort und Vorkommensverknüpfung (leer)', async () => {
    const id = newProjectId();
    const v2 = await fixture('project-v2.json');
    expect(JSON.parse(v2).formatVersion).toBe(2);
    await writeFile(join(dir, 'projects', `${id}.json`), v2);

    const got = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect(got.statusCode).toBe(200);
    const { project, migrations } = got.json();
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(migrations[0]).toMatch(/^2 → 3/);
    expect(project.factories.fac_v2erzwerk01.map).toBeNull();
    expect(project.buildings.bld_v2miner0001.extraction).toEqual({ itemId: 'Desc_OreIron_C', purity: 'pure', nodeId: null });
    expect(project.buildings.bld_v2smelter01.extraction).toBeNull();
    expect(project.groups.grp_v2miners001.members[0].extraction.nodeId).toBeNull();
    expect(project.groups.grp_v2miners001.members[1].extraction).toBeNull();
  });

  it('ein Projekt im Format 3 bekommt das Blackbox-Merkmal (aus) und behält Kartenstandort und Plan', async () => {
    const id = newProjectId();
    const v3 = await fixture('project-v3.json');
    expect(JSON.parse(v3).formatVersion).toBe(3);
    await writeFile(join(dir, 'projects', `${id}.json`), v3);

    const got = await app.inject({ method: 'GET', url: `/api/factory/${id}` });
    expect(got.statusCode).toBe(200);
    const { project, migrations } = got.json();
    expect(project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(migrations[0]).toMatch(/^3 → 4/);
    expect(project.factories.fac_v3platten01.blackbox).toBe(false);
    expect(project.factories.fac_v3platten01.map).toEqual({ x: -120000, y: 80000, rotationDeg: 0 });
    expect(project.productionPlans.pln_v3platten01.targets).toEqual([{ itemId: 'Desc_IronPlate_C', ratePerMin: 40 }]);
  });

  it('neuere Formate als unterstützt werden abgelehnt', async () => {
    const p = { ...newProj('Zukunft'), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const r = await app.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: p } });
    expect(r.statusCode).toBe(400);
  });
});

describe('Rate-Limit und Obergrenzen', () => {
  it('begrenzt das Anlegen je IP (429 mit Retry-After)', async () => {
    const d = await mkdtemp(join(tmpdir(), 'satis-rl-'));
    const s = new ProjectStore(d);
    await s.init();
    const a = await buildServer({ store: s, limits: { createPerHour: 2 } });
    const post = (ip: string) => a.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: newProj('x') }, remoteAddress: ip });
    expect((await post('1.1.1.1')).statusCode).toBe(201);
    expect((await post('1.1.1.1')).statusCode).toBe(201);
    const third = await post('1.1.1.1');
    expect(third.statusCode).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect((await post('2.2.2.2')).statusCode).toBe(201);
    await a.close();
    await rm(d, { recursive: true, force: true });
  });

  it('nutzt hinter einem vertrauten Proxy die weitergeleitete Client-IP', async () => {
    const d = await mkdtemp(join(tmpdir(), 'satis-rl-'));
    const s = new ProjectStore(d);
    await s.init();
    const a = await buildServer({ store: s, limits: { createPerHour: 1 }, trustProxy: 'loopback,uniquelocal' });
    const post = (xff: string) =>
      a.inject({ method: 'POST', url: '/api/factory', headers: { ...H, 'x-forwarded-for': xff }, payload: { project: newProj('x') }, remoteAddress: '172.18.0.1' });
    expect((await post('203.0.113.5')).statusCode).toBe(201);
    expect((await post('203.0.113.6')).statusCode).toBe(201);
    // Vorgetäuschte Adresse vorne im Kopf hilft nicht: maßgeblich ist der letzte nicht vertraute Eintrag
    expect((await post('9.9.9.9, 203.0.113.5')).statusCode).toBe(429);
    await a.close();
    await rm(d, { recursive: true, force: true });
  });

  it('Gesamtzahl der Projekte ist begrenzt (507)', async () => {
    const d = await mkdtemp(join(tmpdir(), 'satis-max-'));
    const s = new ProjectStore(d);
    await s.init();
    const a = await buildServer({ store: s, limits: { maxProjects: 1 } });
    expect((await a.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: newProj('a') } })).statusCode).toBe(201);
    expect((await a.inject({ method: 'POST', url: '/api/factory', headers: H, payload: { project: newProj('b') } })).statusCode).toBe(507);
    await a.close();
    await rm(d, { recursive: true, force: true });
  });

  it('Zeitfenster läuft ab', () => {
    let now = 0;
    const rl = new RateLimiter({ max: 1, windowMs: 1000 }, () => now);
    expect(rl.hit('a')).toBe(0);
    expect(rl.hit('a')).toBe(1);
    now = 1000;
    expect(rl.hit('a')).toBe(0);
  });

  it('räumt verwaiste temporäre Dateien beim Start auf', async () => {
    const d = await mkdtemp(join(tmpdir(), 'satis-tmp-'));
    const s1 = new ProjectStore(d);
    await s1.init();
    await writeFile(join(s1.dir, 'AAAAAAAAAAAAAAAAAAAAAA.json.abc.tmp'), '{"halb');
    const s2 = new ProjectStore(d);
    await s2.init();
    expect(await readdir(s2.dir)).toEqual([]);
    await rm(d, { recursive: true, force: true });
  });
});
