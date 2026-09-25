/** P17.21: D39 keeps the owner lock until the caller's PostgreSQL transaction ends. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { replaceRelation } from '@blendx/core';
import type { Pool } from 'pg';
import {
  models,
  project_members,
  projects,
  sections,
  tasks,
  users,
} from './fixtures/membership.schema.ts';
import { postgresDatabase, realPostgres, type TestDatabase } from './support/database.ts';

let database: (TestDatabase & { pool: Pool }) | undefined;

beforeAll(async () => {
  if (!realPostgres) return;
  database = await postgresDatabase(join(import.meta.dir, 'fixtures', 'membership.schema.ts'));
  const { db } = database;
  await db.insert(users).values({ id: 1, name: 'Ada' });
  await db.insert(projects).values({ id: 10, name: 'Alpha' });
  await db.insert(project_members).values({ project_id: 10, user_id: 1 });
  await db.insert(sections).values({ id: 1001, project_id: 10, name: 'Alpha work' });
  await db.insert(tasks).values({
    id: 101,
    project_id: 10,
    section_id: 1001,
    assignee_id: 1,
    title: 'open',
  });
}, 60_000);

afterAll(() => database?.close());

describe.skipIf(!realPostgres)('replaceRelation PostgreSQL lock', () => {
  test('a concurrent transaction cannot lock the owner while replacement holds it', async () => {
    if (!database) throw new Error('no database');

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });

    const replacement = database.db.transaction(async (tx) => {
      await replaceRelation({
        tx,
        through: models.task_assignees,
        owner: {
          model: models.tasks,
          key: { id: 101 },
          columns: { task_id: 'id' },
        },
        targets: {
          model: models.users,
          keys: [],
          columns: { user_id: 'id' },
          pointer: '/assignees',
        },
        eligible: {
          model: models.project_members,
          owner: { project_id: 'project_id' },
          target: { user_id: 'id' },
        },
      });
      holding();
      await gate;
    });
    await held;

    const other = await database.pool.connect();
    try {
      const error = await other
        .query('select id from member_tasks where id = 101 for update nowait')
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );
      expect((error as { code?: string } | undefined)?.code).toBe('55P03');
    } finally {
      other.release();
    }

    release();
    await replacement;
  });
});
