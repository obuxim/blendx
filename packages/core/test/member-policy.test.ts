/** P17.9: allow.member() scopes default reads with a membership EXISTS predicate. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  allow,
  BlendxDefinitionError,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  isMemberPolicy,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { eq } from 'drizzle-orm';
import {
  models,
  project_members,
  projects,
  sections,
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
  ]);
  await db.insert(projects).values([
    { id: 10, name: 'Alpha' },
    { id: 20, name: 'Beta' },
  ]);
  await db.insert(project_members).values([
    { project_id: 10, user_id: 1 },
    { project_id: 20, user_id: 2 },
  ]);
  await db.insert(sections).values([
    { id: 1001, project_id: 10, name: 'Alpha work' },
    { id: 2001, project_id: 20, name: 'Beta work' },
  ]);
  await db.insert(tasks).values([
    { id: 101, project_id: 10, section_id: 1001, assignee_id: 1, title: 'open' },
    { id: 102, project_id: 10, section_id: 1001, assignee_id: 1, title: 'closed' },
    { id: 201, project_id: 20, section_id: 2001, assignee_id: 2, title: 'open' },
    { id: 202, project_id: 20, section_id: 2001, assignee_id: 2, title: 'closed' },
  ]);
}, 60_000);

afterAll(() => database.close());

const app = defineApp({});
const member = allow.member({
  via: ['project'],
  through: { model: models.project_members, member: 'user_id' },
  related: {
    section_id: { via: ['project'] },
    assignee_id: { member: true },
  },
});

function endpoint(resource: Resource, action: string, perPage?: number) {
  const found = toEndpoints(resource).find((candidate) => candidate.action === action);
  if (!found) throw new Error(`no ${action}`);
  return resolveEndpoint(found, { app, defaults: defaultEffects(found, { perPage }) });
}

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  params: {},
  query: {},
  body: undefined,
  auth: { id: 1 },
  ...overrides,
});

const ids = (body: unknown) => (body as { data: { id: number }[] }).data.map((row) => row.id);
const meta = (body: unknown) => (body as { meta: unknown }).meta;

const protectedTasks = blend(models.tasks, {
  policy: member,
  actions: (a) => [
    a.index(),
    a.store(),
    a.show(),
    a.update(),
    a.replace(),
    a.member('reassign', { calculate: () => ({ project_id: 20 }) }),
    a.member('move', { save: ({ runDefault }) => runDefault({ project_id: 20 }) }),
  ],
});

describe('allow.member definition', () => {
  test('resolves a forward relation and membership root while retaining the identity key', () => {
    const policy = protectedTasks.policies.index;
    expect(policy).toMatchObject({
      kind: 'member',
      authKey: 'id',
      path: [{ relation: 'project', column: 'project_id', key: 'id' }],
      membershipRoot: { column: 'project_id', key: 'id' },
      resolvedRelated: [
        { kind: 'via', field: 'section_id' },
        { kind: 'member', field: 'assignee_id' },
      ],
    });
    const resolved = policy && isMemberPolicy(policy) ? policy : undefined;
    expect(Object.isFrozen(resolved?.resolvedRelated)).toBe(true);
  });

  test('rejects invalid paths, membership links and member columns', () => {
    expect(() =>
      blend(models.tasks, {
        policy: allow.member({
          via: ['workspace'],
          through: { model: models.project_members, member: 'user_id' },
        }),
        actions: (a) => [a.index()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy relation "workspace" is not a relation of member_tasks',
      ),
    );

    expect(() =>
      blend(models.tasks, {
        policy: allow.member({
          via: ['project'],
          through: { model: models.users, member: 'id' },
        }),
        actions: (a) => [a.index()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy member_users has no foreign key to member_projects',
      ),
    );

    expect(() =>
      blend(models.tasks, {
        policy: allow.member({
          via: ['project'],
          through: { model: models.project_members, member: 'missing' as never },
        }),
        actions: (a) => [a.index()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy member "missing" is not a column of member_project_members',
      ),
    );
  });

  test('rejects invalid related field declarations', () => {
    const declaration = (related: Record<string, unknown>) => () =>
      blend(models.tasks, {
        policy: allow.member({
          via: ['project'],
          through: { model: models.project_members, member: 'user_id' },
          related: related as never,
        }),
        actions: (a) => [a.store()],
      });

    expect(declaration({ title: { via: [] } })).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy related "title" is not a single-column foreign key',
      ),
    );
    expect(declaration({ section_id: { via: [] } })).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy related "section_id" does not resolve to member_projects',
      ),
    );
    expect(declaration({ section_id: { via: ['workspace'] } })).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy related "section_id" relation "workspace" is not a relation of member_sections',
      ),
    );
    expect(declaration({ section_id: { member: true } })).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'member policy related "section_id" must reference the same identity as user_id',
      ),
    );
  });

  test('refuses store on a policy rooted on its own table', () => {
    expect(() =>
      blend(models.projects, {
        policy: allow.member({
          via: [],
          through: { model: models.project_members, member: 'user_id' },
        }),
        actions: (a) => [a.index(), a.store()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_projects',
        'store cannot use a member policy rooted on its own table; nothing is a member yet',
      ),
    );
  });

  test('does not let protected routes replace their default load', () => {
    expect(() =>
      blend(models.tasks, {
        policy: member,
        actions: (a) => [a.index({ load: ({ runDefault }) => runDefault() })],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'index has a member policy, so it cannot replace the default load',
      ),
    );
    expect(() =>
      blend(models.tasks, {
        policy: member,
        actions: (a) => [a.show({ load: ({ runDefault }) => runDefault() })],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'member_tasks',
        'show has a member policy, so it cannot replace the default load',
      ),
    );
  });
});

describe('allow.member reads', () => {
  test('requires its configured identity key before it validates the request', async () => {
    const anonymous = await execute(
      endpoint(protectedTasks, 'index'),
      request({ auth: null }),
      database,
    );
    expect(anonymous.status).toBe(401);
    const missingKey = await execute(
      endpoint(protectedTasks, 'index'),
      request({ auth: {}, query: { unknown: 'field' } }),
      database,
    );
    expect(missingKey.status).toBe(401);
  });

  test('supports a membership policy on its root with an empty path', async () => {
    const protectedProjects = blend(models.projects, {
      policy: allow.member({
        via: [],
        through: { model: models.project_members, member: 'user_id' },
      }),
      actions: (a) => [a.index()],
    });
    const reply = await execute(endpoint(protectedProjects, 'index'), request(), database);
    expect(ids(reply.body)).toEqual([10]);
    expect(meta(reply.body)).toEqual({ page: 1, per_page: 25, total: 1 });
  });
  test('scopes index rows and totals to the caller membership', async () => {
    const first = await execute(endpoint(protectedTasks, 'index', 1), request(), database);
    expect(first.status).toBe(200);
    expect(ids(first.body)).toEqual([101]);
    expect(meta(first.body)).toEqual({ page: 1, per_page: 1, total: 2 });

    const second = await execute(
      endpoint(protectedTasks, 'index', 1),
      request({ query: { page: '2' } }),
      database,
    );
    expect(ids(second.body)).toEqual([102]);
    expect(meta(second.body)).toEqual({ page: 2, per_page: 1, total: 2 });
  });

  test('combines membership visibility with filters and scope', async () => {
    const filtered = await execute(
      endpoint(protectedTasks, 'index'),
      request({ query: { project_id: '20' } }),
      database,
    );
    expect(ids(filtered.body)).toEqual([]);
    expect(meta(filtered.body)).toEqual({ page: 1, per_page: 25, total: 0 });

    const openTasks = blend(models.tasks, {
      policy: member,
      actions: (a) => [a.index({ scope: () => ({ title: 'open' }) })],
    });
    const scoped = await execute(endpoint(openTasks, 'index'), request(), database);
    expect(ids(scoped.body)).toEqual([101]);
    expect(meta(scoped.body)).toEqual({ page: 1, per_page: 25, total: 1 });
  });

  test('hides inaccessible member rows as 404s', async () => {
    const allowed = await execute(
      endpoint(protectedTasks, 'show'),
      request({ params: { id: '101' } }),
      database,
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ id: 101, project_id: 10 });

    const shown = await execute(
      endpoint(protectedTasks, 'show'),
      request({ params: { id: '201' } }),
      database,
    );
    expect(shown.status).toBe(404);

    const update = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '201' }, body: { title: 'blocked' } }),
      database,
    );
    expect(update.status).toBe(404);
    expect(await database.db.select().from(tasks).where(eq(tasks.id, 201))).toMatchObject([
      { id: 201, project_id: 20, title: 'open' },
    ]);
  });

  test('scopes rows an include nests to the caller membership too', async () => {
    const openSections = blend(models.sections, {
      policy: allow.authenticated,
      includes: { tasks: { blend: protectedTasks, limit: 10 } },
      actions: (a) => [a.show()],
    });
    const insider = await execute(
      endpoint(openSections, 'show'),
      request({ params: { id: '1001' }, query: { include: 'tasks' } }),
      database,
    );
    expect(insider.status).toBe(200);
    expect((insider.body as { tasks: { id: number }[] }).tasks.map((task) => task.id)).toEqual([
      101, 102,
    ]);

    const outsider = await execute(
      endpoint(openSections, 'show'),
      request({ params: { id: '1001' }, query: { include: 'tasks' }, auth: { id: 2 } }),
      database,
    );
    expect(outsider.status).toBe(200);
    expect((outsider.body as { tasks: unknown }).tasks).toEqual([]);
  });

  test('loads an accessible mutation row under the usual lock', async () => {
    queries.length = 0;
    const reply = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '101' }, body: { title: 'changed' } }),
      database,
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ id: 101, title: 'changed' });
    expect(queries.some((query) => query.includes('for update'))).toBe(true);
  });
});

describe('allow.member default writes', () => {
  const task = async (id = 101) =>
    (await database.db.select().from(tasks).where(eq(tasks.id, id)))[0];

  test('stores only inside the caller root and retains failed rows', async () => {
    const before = await database.db.$count(tasks);
    const valid = await execute(
      endpoint(protectedTasks, 'store'),
      request({
        body: { id: 301, project_id: 10, section_id: 1001, assignee_id: null, title: 'new task' },
      }),
      database,
    );
    expect(valid.status).toBe(201);

    const inaccessibleRoot = await execute(
      endpoint(protectedTasks, 'store'),
      request({
        body: { id: 302, project_id: 20, section_id: 2001, assignee_id: 2, title: 'blocked' },
      }),
      database,
    );
    expect(inaccessibleRoot.status).toBe(403);

    const otherSection = await execute(
      endpoint(protectedTasks, 'store'),
      request({
        body: { id: 303, project_id: 10, section_id: 2001, assignee_id: 1, title: 'wrong section' },
      }),
      database,
    );
    expect(otherSection.status).toBe(422);
    expect(otherSection.body).toMatchObject({ errors: [{ pointer: '/section_id' }] });

    const otherAssignee = await execute(
      endpoint(protectedTasks, 'store'),
      request({
        body: {
          id: 304,
          project_id: 10,
          section_id: 1001,
          assignee_id: 2,
          title: 'wrong assignee',
        },
      }),
      database,
    );
    expect(otherAssignee.status).toBe(422);
    expect(otherAssignee.body).toMatchObject({ errors: [{ pointer: '/assignee_id' }] });
    expect(await database.db.$count(tasks)).toBe(before + 1);
  });

  test('validates calculated and default writes before they can move a task', async () => {
    const calculatedMove = await execute(
      endpoint(protectedTasks, 'reassign'),
      request({ params: { id: '101' } }),
      database,
    );
    expect(calculatedMove.status).toBe(403);

    const rootMove = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '101' }, body: { project_id: 20 } }),
      database,
    );
    expect(rootMove.status).toBe(403);

    const sectionMove = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '101' }, body: { section_id: 2001 } }),
      database,
    );
    expect(sectionMove.status).toBe(422);
    expect(sectionMove.body).toMatchObject({ errors: [{ pointer: '/section_id' }] });

    const assigneeMove = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '101' }, body: { assignee_id: 2 } }),
      database,
    );
    expect(assigneeMove.status).toBe(422);
    expect(assigneeMove.body).toMatchObject({ errors: [{ pointer: '/assignee_id' }] });
    expect(await task()).toMatchObject({ project_id: 10, section_id: 1001, assignee_id: 1 });

    const allowed = await execute(
      endpoint(protectedTasks, 'update'),
      request({ params: { id: '101' }, body: { title: 'still allowed' } }),
      database,
    );
    expect(allowed.status).toBe(200);
    expect(await task()).toMatchObject({ title: 'still allowed' });
  });

  test('also protects replace and custom runDefault writes', async () => {
    const replacement = await execute(
      endpoint(protectedTasks, 'replace'),
      request({
        params: { id: '101' },
        body: { project_id: 20, section_id: 2001, assignee_id: 2, title: 'moved' },
      }),
      database,
    );
    expect(replacement.status).toBe(403);

    const custom = await execute(
      endpoint(protectedTasks, 'move'),
      request({ params: { id: '101' } }),
      database,
    );
    expect(custom.status).toBe(403);
    expect(await task()).toMatchObject({ project_id: 10, section_id: 1001, assignee_id: 1 });
  });
});
