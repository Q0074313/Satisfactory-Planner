/**
 * Datenbankschema (PostgreSQL, Drizzle ORM). Änderungen hier erzeugen mit
 * `npm run db:generate -w @satis/server` eine neue, versionierte Migration in
 * `apps/server/drizzle/`.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** HMAC des Sitzungstokens – das Token selbst wird nicht gespeichert. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Projekt im aktuellen Dateiformat (nach Migration und Schemaprüfung). */
    data: jsonb('data').notNull(),
    formatVersion: integer('format_version').notNull(),
    datasetId: text('dataset_id').notNull(),
    /** Fortlaufende Revision für optimistische Sperre beim Speichern. */
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('projects_owner_idx').on(t.ownerId)],
);

export const shares = pgTable(
  'shares',
  {
    /** Zufälliges Token des schreibgeschützten Freigabelinks. */
    token: text('token').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shares_project_idx').on(t.projectId)],
);
