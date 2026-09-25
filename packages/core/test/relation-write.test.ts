/** P17.21: D39 replaces a relation set inside the caller's transaction. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Db, HttpProblem, RelationWriteDefinitionError, replaceRelation } from '@blendx/core';
import { eq } from 'drizzle-orm';
import {
  models,
  project_members,
  projects,
  sections,
  task_assignees,
  task_member_refs,
  tasks,
  users,
} from './fixtures/membership.schema.ts';
import { migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
let queries: string[];

beforeAll(async () => {
  queries = [];
  database = await migratedDatabase(join(import.meta.dir, 'fixtures', 'membership.schema.ts'), {
    log: queries,
  });
  const { db } = database;
  await db.insert(users).values([
    { id: 1, name: 'Ada' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Cy' },
  ]);
  await db.insert(projects).values([
    { id: 10, name: 'Alpha' },
    { id: 20, name: 'Beta' },
  ]);
  await db.insert(project_members).values([
    { project_id: 10, user_id: 1 },
    { project_id: 10, user_id: 3 },
    { project_id: 20, user_id: 2 },
  ]);
  await db.insert(sections).values([
    { id: 1001, project_id: 10, name: 'Alpha work' },
    { id: 2001, project_id: 20, name: 'Beta work' },
  ]);
  await db.insert(tasks).values([
    { id: 101, project_id: 10, section_id: 1001, assignee_id: 1, title: 'open' },
    { id: 201, project_id: 20, section_id: 2001, assignee_id: 2, title: 'closed' },
  ]);
}, 60_000);

afterAll(() => database.close());

beforeEach(async () => {
  await database.db.delete(task_member_refs);
  await database.db.delete(task_assignees);
  await database.db.insert(task_assignees).values({ task_id: 101, user_id: 1 });
  await database.db.update(tasks).set({ title: 'open' }).where(eq(tasks.id, 101));
});

const replaceAssignees = (tx: Db, keys: readonly { readonly id: number }[], taskId = 101) =>
  replaceRelation({
    tx,
    through: models.task_assignees,
    owner: {
      model: models.tasks,
      key: { id: taskId },
      columns: { task_id: 'id' },
    },
    targets: {
      model: models.users,
      keys,
      columns: { user_id: 'id' },
      pointer: '/assignees',
    },
    eligible: {
      model: models.project_members,
      owner: { project_id: 'project_id' },
      target: { user_id: 'id' },
    },
  });

const assignees = async () =>
  (await database.db.select().from(task_assignees).where(eq(task_assignees.task_id, 101)))
    .map((row) => row.user_id)
    .sort((left, right) => left - right);

async function rejected(fn: () => Promise<unknown>): Promise<HttpProblem> {
  const error = await fn().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpProblem);
  return error as HttpProblem;
}

describe('replaceRelation', () => {
  test('replaces the complete set and permits clearing it', async () => {
    await database.db.transaction((tx) => replaceAssignees(tx, [{ id: 3 }, { id: 1 }]));
    expect(await assignees()).toEqual([1, 3]);

    await database.db.transaction((tx) => replaceAssignees(tx, []));
    expect(await assignees()).toEqual([]);
  });

  test('does not leak whether an invalid target is absent or outside the owner project', async () => {
    const unavailable = await rejected(() =>
      database.db.transaction((tx) => replaceAssignees(tx, [{ id: 2 }])),
    );
    const missing = await rejected(() =>
      database.db.transaction((tx) => replaceAssignees(tx, [{ id: 999 }])),
    );
    expect(unavailable.problem).toEqual(missing.problem);
    expect(unavailable.problem).toMatchObject({
      status: 422,
      errors: [{ pointer: '/assignees/0/id', detail: 'is not an eligible relation target' }],
    });
    expect(await assignees()).toEqual([1]);
  });

  test('reports duplicate targets at the duplicate entry and preserves the old set', async () => {
    const error = await rejected(() =>
      database.db.transaction((tx) => replaceAssignees(tx, [{ id: 3 }, { id: 3 }])),
    );
    expect(error.problem).toMatchObject({
      status: 422,
      errors: [{ pointer: '/assignees/1/id', detail: 'is a duplicate relation target' }],
    });
    expect(await assignees()).toEqual([1]);
  });

  test('rolls back caller writes when relation validation fails before replacement', async () => {
    await rejected(() =>
      database.db.transaction(async (tx) => {
        await tx.update(tasks).set({ title: 'will roll back' }).where(eq(tasks.id, 101));
        await replaceAssignees(tx, [{ id: 2 }]);
      }),
    );
    expect((await database.db.select().from(tasks).where(eq(tasks.id, 101)))[0]?.title).toBe(
      'open',
    );
    expect(await assignees()).toEqual([1]);
  });

  test('locks the owner and reports a missing owner as 404', async () => {
    queries.length = 0;
    await database.db.transaction((tx) => replaceAssignees(tx, [{ id: 1 }]));
    expect(queries.some((query) => query.includes('for update'))).toBe(true);

    const error = await rejected(() =>
      database.db.transaction((tx) => replaceAssignees(tx, [{ id: 1 }], 999)),
    );
    expect(error.problem).toMatchObject({ status: 404 });
  });

  test('supports named composite target keys', async () => {
    await database.db.transaction((tx) =>
      replaceRelation({
        tx,
        through: models.task_member_refs,
        owner: {
          model: models.tasks,
          key: { id: 101 },
          columns: { task_id: 'id' },
        },
        targets: {
          model: models.project_members,
          keys: [
            { project_id: 10, user_id: 3 },
            { project_id: 10, user_id: 1 },
          ],
          columns: { member_project_id: 'project_id', member_user_id: 'user_id' },
          pointer: '/members',
        },
        eligible: {
          model: models.project_members,
          owner: { project_id: 'project_id' },
          target: { project_id: 'project_id', user_id: 'user_id' },
        },
      }),
    );
    expect(
      await database.db.select().from(task_member_refs).where(eq(task_member_refs.task_id, 101)),
    ).toEqual([
      { task_id: 101, member_project_id: 10, member_user_id: 3 },
      { task_id: 101, member_project_id: 10, member_user_id: 1 },
    ]);
  });

  test('rejects mappings that do not cover the declared primary key', async () => {
    const error = await database.db
      .transaction((tx) =>
        replaceRelation({
          tx,
          through: models.task_assignees,
          owner: {
            model: models.tasks,
            key: { id: 101 },
            columns: {} as never,
          },
          targets: {
            model: models.users,
            keys: [{ id: 1 }],
            columns: { user_id: 'id' },
            pointer: '/assignees',
          },
          eligible: {
            model: models.project_members,
            owner: { project_id: 'project_id' },
            target: { user_id: 'id' },
          },
        }),
      )
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(RelationWriteDefinitionError);
    expect((error as Error).message).toBe(
      'owner.columns must map every primary-key column of member_tasks exactly once',
    );
  });
});
