/**
 * HTTP-API: Konten, serverseitige Projekte, schreibgeschützte Freigabelinks.
 *
 * Sicherheit:
 * - Sitzungscookie httpOnly, SameSite=Lax, bei HTTPS „Secure“
 * - Schreibende Anfragen verlangen den Kopf `X-Requested-With: satis-planner`
 *   (Schutz gegen Cross-Site-Formulare; CORS ist nicht freigegeben)
 * - Projekte werden beim Speichern migriert und gegen das Schema geprüft
 * - Anmeldeversuche werden je Adresse und E-Mail begrenzt
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { and, desc, eq, gt } from 'drizzle-orm';
import { APP_VERSION, ImportError, importProject } from '@satis/core';
import { hashPassword, newToken, SESSION_COOKIE, SESSION_DAYS, sessionId, verifyPassword } from './auth.ts';
import type { Db } from './db.ts';
import { projects, sessions, shares, users } from './schema.ts';

export interface ServerOptions {
  db: Db;
  sessionSecret: string;
  publicBaseUrl: string;
  /** Verzeichnis der gebauten Web-App (apps/web/dist), optional. */
  staticDir?: string;
  logger?: boolean;
}

interface UserRow {
  id: string;
  email: string;
  displayName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  if (opts.sessionSecret.length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  const { db } = opts;
  const secure = opts.publicBaseUrl.startsWith('https://');
  await app.register(cookie);
  app.decorateRequest('user', null);
  // JSON mit leerem Rumpf zulassen (z. B. POST ohne Inhalt)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Ungültiges JSON.') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Sitzung auflösen
  app.addHook('preHandler', async (req) => {
    req.user = null;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const sid = sessionId(token, opts.sessionSecret);
    const rows = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())));
    req.user = rows[0] ?? null;
  });

  // Schreibende API-Anfragen nur mit eigenem Kopf
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    if (req.headers['x-requested-with'] !== 'satis-planner') return fail(reply, 403, 'csrf', 'Fehlender Kopf X-Requested-With.');
  });

  const requireUser = (req: FastifyRequest, reply: FastifyReply): UserRow | null => {
    if (!req.user) {
      void fail(reply, 401, 'unauthenticated', 'Nicht angemeldet.');
      return null;
    }
    return req.user;
  };

  async function startSession(reply: FastifyReply, userId: string) {
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await db.insert(sessions).values({ id: sessionId(token, opts.sessionSecret), userId, expiresAt: expires });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires });
  }

  // Begrenzung der Anmeldeversuche (im Speicher, je Prozess)
  const attempts = new Map<string, { n: number; until: number }>();
  const limited = (key: string) => {
    const a = attempts.get(key);
    return !!a && a.until > Date.now() && a.n >= 10;
  };
  const countAttempt = (key: string) => {
    const a = attempts.get(key);
    const now = Date.now();
    if (!a || a.until < now) attempts.set(key, { n: 1, until: now + 15 * 60_000 });
    else a.n++;
  };

  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION }));

  app.post<{ Body: { email?: string; password?: string; displayName?: string } }>('/api/auth/register', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const password = req.body?.password ?? '';
    const displayName = (req.body?.displayName ?? '').trim() || email.split('@')[0]!;
    if (!EMAIL.test(email)) return fail(reply, 400, 'invalid-email', 'Ungültige E-Mail-Adresse.');
    if (password.length < 10) return fail(reply, 400, 'weak-password', 'Das Passwort muss mindestens 10 Zeichen lang sein.');
    const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists.length) return fail(reply, 409, 'email-taken', 'Diese E-Mail-Adresse ist bereits registriert.');
    const id = randomUUID();
    await db.insert(users).values({ id, email, displayName, passwordHash: await hashPassword(password) });
    await startSession(reply, id);
    return reply.status(201).send({ user: { id, email, displayName } });
  });

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    const key = `${req.ip}|${email}`;
    if (limited(key)) return fail(reply, 429, 'rate-limited', 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.');
    const rows = await db.select().from(users).where(eq(users.email, email));
    const u = rows[0];
    if (!u || !(await verifyPassword(req.body?.password ?? '', u.passwordHash))) {
      countAttempt(key);
      return fail(reply, 401, 'invalid-credentials', 'E-Mail oder Passwort ist falsch.');
    }
    attempts.delete(key);
    await startSession(reply, u.id);
    return { user: { id: u.id, email: u.email, displayName: u.displayName } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.id, sessionId(token, opts.sessionSecret)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return fail(reply, 401, 'unauthenticated', 'Nicht angemeldet.');
    return { user: req.user };
  });

  app.get('/api/projects', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db
      .select({ id: projects.id, name: projects.name, updatedAt: projects.updatedAt, datasetId: projects.datasetId, revision: projects.revision })
      .from(projects)
      .where(eq(projects.ownerId, u.id))
      .orderBy(desc(projects.updatedAt));
    return { projects: rows };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db.select().from(projects).where(and(eq(projects.id, req.params.id), eq(projects.ownerId, u.id)));
    const row = rows[0];
    if (!row) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    // Ältere Formate beim Laden migrieren (gleiche Kette wie im Browser)
    const { project } = importProject(row.data);
    return { project, revision: row.revision };
  });

  app.put<{ Params: { id: string }; Body: { project?: unknown; baseRevision?: number | null } }>('/api/projects/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    let project;
    try {
      project = importProject(req.body?.project).project;
    } catch (e) {
      if (e instanceof ImportError) return reply.status(400).send({ error: { code: 'invalid-project', message: e.message, details: e.details } });
      throw e;
    }
    if (project.id !== req.params.id) return fail(reply, 400, 'id-mismatch', 'Projekt-ID passt nicht zur Adresse.');
    const rows = await db.select().from(projects).where(eq(projects.id, project.id));
    const existing = rows[0];
    if (existing && existing.ownerId !== u.id) return fail(reply, 403, 'forbidden', 'Dieses Projekt gehört einem anderen Konto.');
    const base = req.body?.baseRevision;
    if (existing && base !== undefined && base !== null && base !== existing.revision)
      return reply.status(409).send({ error: { code: 'conflict', message: 'Das Projekt wurde zwischenzeitlich anderweitig gespeichert.' }, revision: existing.revision });
    const values = { name: project.name, data: project, formatVersion: project.formatVersion, datasetId: project.gameData.datasetId, updatedAt: new Date() };
    if (existing) {
      const revision = existing.revision + 1;
      await db.update(projects).set({ ...values, revision }).where(eq(projects.id, project.id));
      return { revision };
    }
    await db.insert(projects).values({ id: project.id, ownerId: u.id, ...values, revision: 1 });
    return reply.status(201).send({ revision: 1 });
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    await db.delete(projects).where(and(eq(projects.id, req.params.id), eq(projects.ownerId, u.id)));
    return reply.status(204).send();
  });

  const ownProject = async (id: string, userId: string) => (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, userId))))[0];

  app.post<{ Params: { id: string } }>('/api/projects/:id/shares', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    if (!(await ownProject(req.params.id, u.id))) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    const token = newToken(24);
    await db.insert(shares).values({ token, projectId: req.params.id });
    return reply.status(201).send({ token, url: `${opts.publicBaseUrl.replace(/\/$/, '')}/#/share/${token}` });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/shares', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    if (!(await ownProject(req.params.id, u.id))) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    const rows = await db.select().from(shares).where(and(eq(shares.projectId, req.params.id), eq(shares.revoked, false)));
    return { shares: rows.map((s) => ({ token: s.token, createdAt: s.createdAt, url: `${opts.publicBaseUrl.replace(/\/$/, '')}/#/share/${s.token}` })) };
  });

  app.delete<{ Params: { token: string } }>('/api/shares/:token', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db.select({ projectId: shares.projectId }).from(shares).where(eq(shares.token, req.params.token));
    const s = rows[0];
    if (!s || !(await ownProject(s.projectId, u.id))) return fail(reply, 404, 'not-found', 'Freigabe nicht gefunden.');
    await db.update(shares).set({ revoked: true }).where(eq(shares.token, req.params.token));
    return reply.status(204).send();
  });

  // Öffentlich, schreibgeschützt
  app.get<{ Params: { token: string } }>('/api/share/:token', async (req, reply) => {
    const rows = await db
      .select({ data: projects.data, updatedAt: projects.updatedAt })
      .from(shares)
      .innerJoin(projects, eq(projects.id, shares.projectId))
      .where(and(eq(shares.token, req.params.token), eq(shares.revoked, false)));
    const row = rows[0];
    if (!row) return fail(reply, 404, 'not-found', 'Freigabe nicht gefunden oder widerrufen.');
    const { project } = importProject(row.data);
    return { project, updatedAt: row.updatedAt, readOnly: true };
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return fail(reply, 404, 'not-found', 'Unbekannte API-Adresse.');
      if (req.url.startsWith('/assets/')) return reply.status(404).send('Not found');
      return reply.sendFile('index.html');
    });
  }
  return app;
}
