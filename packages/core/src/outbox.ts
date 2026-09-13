/**
 * The outbox (D27). An action's later hooks do not run in the request: the engine writes one
 * entry per level into blendx_outbox, in the action's transaction, and a worker runs them at
 * least once. core defines the table; an app's generated outbox.gen.ts re-exports it once the
 * app has a later hook, so the app's own migrations create it.
 */
import { bigint, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { ResolvedEndpoint } from './cascade.ts';
import type { Db } from './hooks.ts';

/** What a later hook receives besides db, id and attempt, stored as JSON with the write. */
export interface OutboxPayload {
  saved: unknown;
  /** The row as loaded; absent for store. */
  record?: unknown;
  input: unknown;
  auth: unknown;
}

const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const outbox = pgTable(
  'blendx_outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    /** Whose hook the entry runs: app, resource or action. */
    level: text('level').notNull(),
    payload: jsonb('payload').$type<OutboxPayload>().notNull(),
    /** Runs started so far. */
    attempts: integer('attempts').notNull().default(0),
    /** When the entry is due: now when written, later after a failure or while a worker holds it. */
    run_at: stamp('run_at').notNull().defaultNow(),
    last_error: text('last_error'),
    /** Set when the last attempt failed: the entry is kept, and no longer run. */
    failed_at: stamp('failed_at'),
    created_at: stamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('blendx_outbox_due').on(table.run_at)],
);

/** Writes an entry for each level with a later hook, in the action's transaction (D27). */
export async function enqueueLater(
  tx: Db,
  endpoint: ResolvedEndpoint,
  payload: OutboxPayload,
): Promise<void> {
  const levels = endpoint.provenance.later.filter((level) => level !== 'schema');
  if (levels.length === 0) return;
  await tx.insert(outbox).values(
    levels.map((level) => ({
      resource: endpoint.resource,
      action: endpoint.action,
      level,
      payload,
    })),
  );
}
