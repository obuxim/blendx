/**
 * The outbox worker (D27). drainOutbox runs every due entry once; startOutbox drains on an
 * interval. Entries are claimed with FOR UPDATE SKIP LOCKED and held for a lease, so several
 * workers can share the table, and an entry whose worker stopped runs again when its lease
 * ends. A later hook therefore runs at least once, and may run twice.
 */
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { App } from './app.ts';
import type { Resource } from './blend.ts';
import { type LaterInput, type Level, resolveEndpoint } from './cascade.ts';
import { toEndpoints } from './endpoints.ts';
import { defaultEffects } from './engine.ts';
import type { Db } from './hooks.ts';
import { outbox } from './outbox.ts';

export interface OutboxOptions {
  app: App;
  db: Db;
  /** Every blend of the app: routes.gen.ts exports them as `resources`. */
  resources: readonly Resource[];
  /** Gets what a later hook throws, and any other failure of the worker. console.error by default. */
  onError?: (error: unknown) => void;
  /** Entries claimed at a time: 10 by default. */
  batch?: number;
  /** Runs before an entry is kept as failed: 10 by default. */
  attempts?: number;
  /** Seconds a worker holds an entry it claimed before another may run it: 300 by default. */
  lease?: number;
  /** Seconds to wait after the given failed attempt: 2 ** attempt by default, at most an hour. */
  retryDelay?: (attempt: number) => number;
}

/** What one drain did: entries that ran and were deleted, will run again, or failed for good. */
export interface DrainResult {
  ran: number;
  retried: number;
  failed: number;
}

export interface OutboxWorker {
  /** Stops polling, and waits for a drain in progress. */
  stop(): Promise<void>;
}

const defaultDelay = (attempt: number) => Math.min(2 ** attempt, 3600);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const reporter = (options: OutboxOptions) =>
  options.onError ?? ((error: unknown) => console.error(error));

/** True when the app, or any resource or action, has a later hook: only then is there an outbox. */
export function hasLaterHooks(app: App, resources: readonly Resource[]): boolean {
  const has = (hooks: object) => typeof (hooks as { later?: unknown }).later === 'function';
  return (
    has(app.spec.hooks ?? {}) ||
    resources.some(
      (resource) => has(resource.hooks) || resource.actions.some((action) => has(action.hooks)),
    )
  );
}

type Hook = (context: LaterInput) => Promise<unknown>;

/** Finds the later hook an entry names, by resource, action and level. */
function hookFinder(app: App, resources: readonly Resource[]) {
  const endpoints = new Map(
    resources.flatMap((resource) =>
      toEndpoints(resource).map(
        (definition) =>
          [
            `${definition.resource}.${definition.action}`,
            resolveEndpoint(definition, { app, defaults: defaultEffects(definition) }),
          ] as const,
      ),
    ),
  );
  return (entry: { resource: string; action: string; level: string }): Hook | undefined =>
    endpoints.get(`${entry.resource}.${entry.action}`)?.laterAt(entry.level as Level);
}

/** Claims due entries: an attempt more each, held for the lease. SKIP LOCKED keeps workers apart. */
async function claim(db: Db, batch: number, lease: number) {
  const due = db
    // Through sql: drizzle reads a number-mode bigint as "id"::text, which `in` cannot compare.
    .select({ id: sql<number>`${outbox.id}` })
    .from(outbox)
    .where(and(isNull(outbox.failed_at), lte(outbox.run_at, sql`now()`)))
    .orderBy(asc(outbox.run_at), asc(outbox.id))
    .limit(batch)
    .for('update', { skipLocked: true });
  const claimed = await db
    .update(outbox)
    .set({
      attempts: sql`${outbox.attempts} + 1`,
      run_at: sql`now() + make_interval(secs => ${lease}::double precision)`,
    })
    .where(inArray(outbox.id, due))
    .returning();
  return claimed.sort((a, b) => a.id - b.id);
}

/** Runs every due entry once, and returns what happened to them. */
export async function drainOutbox(options: OutboxOptions): Promise<DrainResult> {
  const result: DrainResult = { ran: 0, retried: 0, failed: 0 };
  const { app, db, resources } = options;
  if (!hasLaterHooks(app, resources)) return result;
  const report = reporter(options);
  const attempts = options.attempts ?? 10;
  const retryDelay = options.retryDelay ?? defaultDelay;
  const find = hookFinder(app, resources);

  for (;;) {
    const claimed = await claim(db, options.batch ?? 10, options.lease ?? 300);
    if (claimed.length === 0) return result;
    for (const entry of claimed) {
      const hook = find(entry);
      try {
        if (!hook) {
          throw new Error(
            `${entry.resource}.${entry.action} has no later hook at the ${entry.level} level`,
          );
        }
        const { payload } = entry;
        await hook({
          ...payload,
          record: payload.record,
          // The identity as stored with the write: the JSON of what auth returned (D27).
          auth: payload.auth as LaterInput['auth'],
          db,
          id: entry.id,
          attempt: entry.attempts,
        });
        await db.delete(outbox).where(eq(outbox.id, entry.id));
        result.ran += 1;
      } catch (error) {
        report(error);
        // A hook that is gone will not come back by waiting: that entry fails at once.
        const last = !hook || entry.attempts >= attempts;
        const delay = retryDelay(entry.attempts);
        await db
          .update(outbox)
          .set(
            last
              ? { failed_at: sql`now()`, last_error: messageOf(error) }
              : {
                  run_at: sql`now() + make_interval(secs => ${delay}::double precision)`,
                  last_error: messageOf(error),
                },
          )
          .where(eq(outbox.id, entry.id));
        if (last) result.failed += 1;
        else result.retried += 1;
      }
    }
  }
}

/** Drains the outbox every `every` seconds (1 by default) until stopped. */
export function startOutbox(options: OutboxOptions & { every?: number }): OutboxWorker {
  if (!hasLaterHooks(options.app, options.resources)) return { stop: async () => {} };
  const report = reporter(options);
  const every = (options.every ?? 1) * 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining: Promise<void> = Promise.resolve();
  const tick = () => {
    draining = drainOutbox(options)
      .then(() => undefined, report)
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, every);
      });
  };
  timer = setTimeout(tick, 0);
  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await draining;
    },
  };
}
