/**
 * HTTP-API ohne Konten: Wer den Link /f/<id> kennt, kann das Projekt laden und
 * speichern. Liefert außerdem die gebaute Web-App aus (SPA-Fallback).
 *
 * Endpunkte:
 * - GET  /api/health          Lebenszeichen inkl. Prüfung des Speicherordners
 * - POST /api/factory         neues Projekt anlegen → { id, revision }
 * - GET  /api/factory/:id     Projekt laden (ältere Formate werden migriert)
 * - PUT  /api/factory/:id     Projekt speichern (optimistische Sperre über die Revision)
 *
 * Sicherheit (die Seite ist öffentlich erreichbar):
 * - IDs mit 128 Bit Zufall, Format wird vor jedem Dateizugriff geprüft
 * - Größenlimit je Projekt, Gesamtzahl begrenzt, Rate-Limit je IP
 * - Projekte werden migriert und gegen das Schema geprüft, bevor sie gespeichert werden
 * - Schreibende Anfragen verlangen den Kopf `X-Requested-With: satis-planner`
 * - Referrer-Policy no-referrer (der Link ist das Geheimnis), noindex, CSP
 * - Projekt-IDs werden in Logs gekürzt
 */
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { APP_VERSION, ImportError, importProject, type Project } from '@satis/core';
import { DEFAULT_LIMITS, type Limits } from './config.ts';
import { RateLimiter } from './rateLimit.ts';
import { ConflictError, isProjectId, ProjectStore } from './storage.ts';

export interface ServerOptions {
  store: ProjectStore;
  limits?: Partial<Limits>;
  /** Verzeichnis der gebauten Web-App (apps/web/dist), optional. */
  staticDir?: string;
  trustProxy?: string | false;
  logger?: boolean;
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

/** Kürzt Projekt-IDs in Adressen, damit Logs keine vollständigen Zugangslinks enthalten. */
export const redactUrl = (url: string) => url.replace(/(\/(?:f|api\/factory)\/)([A-Za-z0-9_-]{4})[A-Za-z0-9_-]*/g, '$1$2…');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Kartenkacheln lädt der Browser direkt von satisfactory-calculator.com (ohne Referrer)
  "img-src 'self' data: blob: https://static.satisfactory-calculator.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const { store } = opts;
  const app = Fastify({
    // Etwas Spielraum für die Hülle { project, baseRevision }; das Projekt selbst wird unten genau geprüft.
    bodyLimit: limits.maxProjectBytes + 64 * 1024,
    trustProxy: opts.trustProxy ?? false,
    logger: opts.logger
      ? {
          serializers: {
            req: (req: FastifyRequest) => ({ method: req.method, url: redactUrl(req.url), ip: req.ip }),
          },
        }
      : false,
  });

  // JSON mit leerem Rumpf zulassen; ungültiges JSON → 400
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Ungültiges JSON.') as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'invalid-json';
      done(err, undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    if (status === 413) return fail(reply, 413, 'too-large', 'Das Projekt ist zu groß.');
    if (status === 400) return fail(reply, 400, err.code === 'invalid-json' ? 'invalid-json' : 'bad-request', err.message);
    return fail(reply, status, 'error', status >= 500 ? 'Interner Fehler.' : err.message);
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Content-Security-Policy', CSP);
  });

  // Schreibende API-Anfragen nur mit eigenem Kopf (kein Absenden aus fremden Formularen)
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    if (req.headers['x-requested-with'] !== 'satis-planner') return fail(reply, 403, 'csrf', 'Fehlender Kopf X-Requested-With.');
  });

  const createLimit = new RateLimiter({ max: limits.createPerHour, windowMs: 3600_000 });
  const saveLimit = new RateLimiter({ max: limits.savePerMinute, windowMs: 60_000 });
  const loadLimit = new RateLimiter({ max: limits.loadPerMinute, windowMs: 60_000 });
  const limited = (limiter: RateLimiter, req: FastifyRequest, reply: FastifyReply) => {
    const wait = limiter.hit(req.ip);
    if (!wait) return false;
    reply.header('Retry-After', String(wait));
    void fail(reply, 429, 'rate-limited', 'Zu viele Anfragen. Bitte später erneut versuchen.');
    return true;
  };

  /** Migriert und prüft ein übermitteltes Projekt; antwortet selbst mit 400/413. */
  const validate = (raw: unknown, reply: FastifyReply): Project | null => {
    let project: Project;
    try {
      project = importProject(raw).project;
    } catch (e) {
      if (e instanceof ImportError) {
        void reply.status(400).send({ error: { code: 'invalid-project', message: e.message, details: e.details } });
        return null;
      }
      throw e;
    }
    if (Buffer.byteLength(JSON.stringify(project)) > limits.maxProjectBytes) {
      void fail(reply, 413, 'too-large', 'Das Projekt ist zu groß.');
      return null;
    }
    return project;
  };

  // Leise: der Docker-Healthcheck fragt alle 30 s
  app.get('/api/health', { logLevel: 'warn' }, async (_req, reply) => {
    const storage = await store.writable();
    return reply.status(storage ? 200 : 503).send({ ok: storage, version: APP_VERSION, storage: storage ? 'ok' : 'nicht beschreibbar' });
  });

  app.post<{ Body: { project?: unknown } }>('/api/factory', async (req, reply) => {
    if (limited(createLimit, req, reply)) return;
    if (store.size >= limits.maxProjects) return fail(reply, 507, 'storage-full', 'Die maximale Anzahl an Projekten ist erreicht.');
    const project = validate(req.body?.project, reply);
    if (!project) return;
    const r = await store.create(project);
    return reply.status(201).send(r);
  });

  app.get<{ Params: { id: string } }>('/api/factory/:id', async (req, reply) => {
    if (limited(loadLimit, req, reply)) return;
    if (!isProjectId(req.params.id)) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    const stored = await store.read(req.params.id);
    if (!stored) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    // Ältere Formate beim Laden migrieren (gleiche Kette wie im Browser)
    const { project, migrations } = importProject(stored.data);
    reply.header('Cache-Control', 'no-store');
    return { project, revision: stored.revision, migrations };
  });

  app.put<{ Params: { id: string }; Body: { project?: unknown; baseRevision?: string | null } }>('/api/factory/:id', async (req, reply) => {
    if (limited(saveLimit, req, reply)) return;
    if (!isProjectId(req.params.id)) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
    const base = req.body?.baseRevision;
    if (base !== undefined && base !== null && typeof base !== 'string') return fail(reply, 400, 'bad-request', 'baseRevision muss ein Text sein.');
    const project = validate(req.body?.project, reply);
    if (!project) return;
    try {
      const r = await store.update(req.params.id, project, base ?? null);
      if (!r) return fail(reply, 404, 'not-found', 'Projekt nicht gefunden.');
      return r;
    } catch (e) {
      if (e instanceof ConflictError)
        return reply.status(409).send({ error: { code: 'conflict', message: 'Das Projekt wurde zwischenzeitlich anderweitig gespeichert.' }, revision: e.revision });
      throw e;
    }
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, {
      root: opts.staticDir,
      wildcard: false,
      setHeaders(reply, path) {
        // Dateien unter /assets/ tragen einen Inhalts-Hash im Namen
        reply.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return fail(reply, 404, 'not-found', 'Unbekannte API-Adresse.');
      if (req.url.startsWith('/assets/') || (req.method !== 'GET' && req.method !== 'HEAD')) return reply.status(404).send('Not found');
      // SPA-Fallback, z. B. für /f/<id>
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }
  return app;
}
