import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createProject, PROJECT_FORMAT_VERSION } from '@satis/core';
import { buildServer } from '../src/app.ts';
import { openDatabase, type Database } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';

let app: FastifyInstance;
let database: Database;
const H = { 'x-requested-with': 'satis-planner', 'content-type': 'application/json' };

const cookieOf = (r: LightMyRequestResponse) => {
  const c = r.cookies.find((x) => x.name === 'sp_session');
  return c ? `sp_session=${c.value}` : '';
};

async function register(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email, password: 'geheim-genug-123', displayName: 'Test' } });
  expect(r.statusCode).toBe(201);
  return cookieOf(r);
}

const newProj = (name: string) => createProject({ name, datasetId: 'sf-1.2.4.0', gameVersion: '1.2.4.0' });

beforeAll(async () => {
  database = await openDatabase('pglite:memory');
  app = await buildServer({ db: database.db, sessionSecret: 'x'.repeat(40), publicBaseUrl: 'https://planer.example' });
}, 60_000);

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('Konfiguration', () => {
  it('verlangt alle Umgebungsvariablen und kein Geheimnis im Code', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL, SESSION_SECRET, PUBLIC_BASE_URL/);
    const c = loadConfig({ DATABASE_URL: 'pglite:memory', SESSION_SECRET: 's'.repeat(40), PUBLIC_BASE_URL: 'http://localhost:8080' });
    expect(c.port).toBe(8080);
  });

  it('lehnt zu kurze Sitzungsschlüssel ab', async () => {
    await expect(buildServer({ db: database.db, sessionSecret: 'kurz', publicBaseUrl: 'http://x' })).rejects.toThrow(/32 Zeichen/);
  });
});

describe('Konten', () => {
  it('Registrieren, Anmelden, Abmelden; Passwort wird nicht im Klartext gespeichert', async () => {
    const cookie = await register('anna@example.org');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.email).toBe('anna@example.org');
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'Anna@example.org', password: 'geheim-genug-123' } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'anna@example.org', password: 'falsch-falsch' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'anna@example.org', password: 'geheim-genug-123' } });
    expect(ok.statusCode).toBe(200);
    const rows = await database.db.query.users.findMany();
    expect(rows.every((u) => u.passwordHash.startsWith('scrypt$') && !u.passwordHash.includes('geheim'))).toBe(true);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...H, cookie: cookieOf(ok) } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOf(ok) } });
    expect(after.statusCode).toBe(401);
  });

  it('schreibende Anfragen ohne X-Requested-With werden abgewiesen', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: { email: 'a@b.c', password: 'x' } });
    expect(r.statusCode).toBe(403);
  });

  it('kurze Passwörter und ungültige Adressen werden abgelehnt', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'x@y.z', password: 'kurz' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'keine-mail', password: 'lang-genug-123' } })).statusCode).toBe(400);
  });
});

describe('Projekte und Rechte', () => {
  it('Speichern, Laden, Revisionen, Konflikt, fremde Projekte', async () => {
    const anna = await register('a2@example.org');
    const bert = await register('b2@example.org');
    const p = newProj('Werk');
    const put = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: anna }, payload: { project: p } });
    expect(put.statusCode).toBe(201);
    expect(put.json().revision).toBe(1);
    const again = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: anna }, payload: { project: { ...p, name: 'Werk 2' }, baseRevision: 1 } });
    expect(again.json().revision).toBe(2);
    const stale = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: anna }, payload: { project: p, baseRevision: 1 } });
    expect(stale.statusCode).toBe(409);
    const list = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: anna } });
    expect(list.json().projects.map((x: { name: string }) => x.name)).toEqual(['Werk 2']);
    // Bert darf weder lesen noch überschreiben
    expect((await app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: bert } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: bert }, payload: { project: p } })).statusCode).toBe(403);
    // Ohne Anmeldung
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(401);
    const got = await app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: anna } });
    expect(got.json().project.name).toBe('Werk 2');
    expect(got.json().project.formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });

  it('ungültige Projekte werden mit Details abgelehnt, alte Formate migriert', async () => {
    const anna = await register('a3@example.org');
    const bad = await app.inject({ method: 'PUT', url: '/api/projects/x', headers: { ...H, cookie: anna }, payload: { project: { formatVersion: PROJECT_FORMAT_VERSION, id: 'x' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid-project');
    // Format 1 (ohne neue Felder) wird angenommen und migriert
    const p = newProj('Alt') as unknown as Record<string, unknown>;
    const v1 = { ...p, formatVersion: 1, settings: { gridM: 8, snapM: 1, snapAngleDeg: 90, simulation: { trainAverageSpeedKmh: 80, stopDurationS: 40, timeStepS: 0.5, durationS: 1800 } } };
    const r = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: anna }, payload: { project: v1 } });
    expect(r.statusCode).toBe(201);
    const got = await app.inject({ method: 'GET', url: `/api/projects/${p.id}`, headers: { cookie: anna } });
    expect(got.json().project.settings.simulation.dockingS).toBe(27.08);
  });

  it('Freigabelink: schreibgeschützt lesbar ohne Anmeldung, widerrufbar nur vom Besitzer', async () => {
    const anna = await register('a4@example.org');
    const bert = await register('b4@example.org');
    const p = newProj('Geteilt');
    await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, headers: { ...H, cookie: anna }, payload: { project: p } });
    const share = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/shares`, headers: { ...H, cookie: anna } });
    expect(share.statusCode).toBe(201);
    const { token, url } = share.json();
    expect(url).toBe(`https://planer.example/#/share/${token}`);
    const pub = await app.inject({ method: 'GET', url: `/api/share/${token}` });
    expect(pub.json().project.name).toBe('Geteilt');
    expect(pub.json().readOnly).toBe(true);
    // Fremde dürfen weder Freigaben anlegen noch widerrufen
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/shares`, headers: { ...H, cookie: bert } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/shares/${token}`, headers: { ...H, cookie: bert } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/shares/${token}`, headers: { ...H, cookie: anna } })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/share/${token}` })).statusCode).toBe(404);
  });
});
