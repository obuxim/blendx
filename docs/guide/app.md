# The app and identity

`src/app.ts` default-exports `defineApp(spec)`: who is making a request, and the settings that apply to every table. Every key is optional; `defineApp({})` is a working app in which every request is anonymous.

| Key | |
|---|---|
| `auth` | resolves the identity of a request ([below](#the-identity)) |
| `actions` | declares typed app-owned domain routes ([below](#multipart-domain-actions)) |
| `hooks` | rules, authorize and respond hooks for every table ([App hooks](#app-hooks)) |
| `index` | paging: `{ perPage, maxPerPage }` ([Paging](#paging)) |
| `problems` | `{ typeBase }`, the base URI of problem types ([Problem types](#problem-types)) |

## The identity

`auth({ request, db })` runs once for every request, before routing, and returns the identity, or `null` when there is none. It answers "who is this?" and nothing else: whether they may do something is for policies and authorize hooks to decide.

From [`examples/expenses`](../../examples/expenses/src/app.ts), where the identity is the user whose API token is the bearer token:

```ts
import { defineApp } from 'blendx';
import { sql } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

const BEARER = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export default defineApp({
  auth: async ({ request, db }): Promise<{ id: number; is_approver: boolean } | null> => {
    const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return null;
    const users = models.users.table;
    const [user] = await db
      .select({ id: users.id, is_approver: users.is_approver })
      .from(users)
      .where(sql`${users.api_token} = ${token}`)
      .limit(1);
    return user ?? null;
  },
});
```

- Annotate the return type. Whatever `auth` returns, minus `null`, is the type of `auth` in every policy and hook, so `auth?.is_approver` is a boolean there and `auth?.admin` is a type error.
- Check a token's shape before it reaches the database. `api_token` is a `uuid` column, and PostgreSQL fails on a string that is not a UUID; that failure happens outside any action, so it would be a 500.
- A request with no identity, or one that `auth` does not recognise, is anonymous. An action whose policy needs an identity answers it with 401.
- `db` is the app's database. `auth` can also verify a JWT from an identity provider and return its claims, or look up a session; blendx only needs the result.

The type reaches the hooks through `src/generated/register.gen.ts`, which `blendx generate` writes: it registers `typeof app` with blendx. If `auth` is `unknown` in a hook, run `blendx generate`.

For tests, an app can take its identity from a header, as the [conformance fixture](../../packages/conformance/fixtures/shop/src/app.ts) does with `x-user-id`. Keep that out of production ([Testing](testing.md#identities-in-tests)).

## Relation-set domain actions

An app action is a good home for replacing an entire many-to-many set. The handler owns
authorization and its transaction; `replaceRelation()` locks the task, validates every target
against the task's project, then deletes and inserts the join rows atomically. Its `writes`
must name both the logical owner and the join model so review output and React invalidation stay
accurate.

```ts
import { defineApp, HttpProblem, problem, replaceRelation, z } from 'blendx';
import { and, eq } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

// authenticated is the app's identity-requiring policy.
export default defineApp({
  actions: (a) => [
    a.action('replace_task_assignees', {
      method: 'put',
      path: '/tasks/:id/assignees',
      policy: authenticated,
      input: z.object({ assignees: z.array(z.object({ id: z.number().int() }).strict()) }).strict(),
      reply: {
        status: 200,
        body: z.object({ task_id: z.number().int(), assignees: z.array(z.object({ id: z.number().int() }).strict()) }),
      },
      writes: [models.tasks, models.task_assignees],
      handler: async ({ params, input, auth, tx }) => {
        const taskId = Number(params.id);
        if (!auth || !Number.isSafeInteger(taskId) || taskId <= 0) throw new HttpProblem(problem(404));
        const [task] = await tx.select({ id: models.tasks.table.id }).from(models.tasks.table)
          .innerJoin(models.project_members.table, and(
            eq(models.project_members.table.project_id, models.tasks.table.project_id),
            eq(models.project_members.table.user_id, auth.id),
          ))
          .where(eq(models.tasks.table.id, taskId)).limit(1).for('update');
        if (!task) throw new HttpProblem(problem(404));
        await replaceRelation({
          tx,
          through: models.task_assignees,
          owner: { model: models.tasks, key: { id: taskId }, columns: { task_id: 'id' } },
          targets: { model: models.users, keys: input.assignees, columns: { user_id: 'id' }, pointer: '/assignees' },
          eligible: {
            model: models.project_members,
            owner: { project_id: 'project_id' },
            target: { user_id: 'id' },
          },
        });
        return { status: 200, body: { task_id: taskId, assignees: input.assignees } };
      },
    }),
  ],
});
```

An empty `assignees` array clears the set. Duplicate, missing, and out-of-project users answer
422 at the corresponding `/assignees/<index>/id` pointer; a task the caller cannot access and a
missing task both answer 404. The full runnable version is in the
[conformance fixture](../../packages/conformance/fixtures/shop/src/app.ts).

## Multipart domain actions

A domain action can receive a typed upload without a handwritten Hono route. Start with a route such as this:

```ts
router.post('/users/:id/avatar', async (c) => {
  const form = await c.req.parseBody();
  // authenticate, validate `form.file`, enforce a size limit, start a transaction,
  // write metadata, and keep its client invalidation in sync here.
});
```

Move the contract into `src/app.ts`. `multipart()` accepts the same strict Zod schema as a JSON action, but `z.file()` receives a native `File`. Its `maxBytes` caps the request body Blendx buffers. The declaration supplies the route type, OpenAPI `multipart/form-data` request body, review metadata, transaction, and React invalidation targets.

```ts
import { defineApp, HttpProblem, multipart, problem, z } from 'blendx';
import { models } from './generated/schema.gen.ts';

export default defineApp({
  // auth and the authenticated policy are defined elsewhere in this app.
  actions: (a) => [
    a.action('upload_avatar', {
      method: 'post',
      path: '/users/:id/avatar',
      policy: authenticated,
      input: multipart(
        z.object({
          file: z.file().mime(['image/png']).max(256 * 1024),
          caption: z.string().max(120).optional(),
        }).strict(),
        { maxBytes: 512 * 1024 },
      ),
      reply: { status: 201, body: z.object({ id: z.number().int() }) },
      writes: [models.uploads, models.users],
      handler: async ({ params, input, auth, tx }) => {
        if (!auth || Number(params.id) !== auth.id) throw new HttpProblem(problem(403));
        const [upload] = await tx.insert(models.uploads.table).values({
          user_id: auth.id,
          filename: input.file.name,
          content_type: input.file.type,
          byte_length: input.file.size,
        }).returning({ id: models.uploads.table.id });
        return { status: 201, body: upload! };
      },
    }),
  ],
});
```

The generated Hono client accepts a native `FormData` body. Let the browser set its multipart boundary:

```ts
const form = new FormData();
form.set('file', file);
form.set('caption', 'Profile image');
await client.users[':id'].avatar.$post({ param: { id: '42' }, form });
```

A React app passes the generated `appActions` map to `createBlendxClient()` and calls `api.appActions.upload_avatar.mutationOptions()`. On success it invalidates the declared `uploads` and `users` queries. `maxBytes` bounds the request Blendx buffers; set an equal or lower limit at a reverse proxy, inspect file contents rather than trusting MIME metadata, and store file bytes in object storage while keeping only safe metadata and a reference in the transaction. Do not set the `content-type` multipart boundary yourself.

## App hooks

App hooks run for every action of every table, before the resource's and the action's hooks ([The cascade](hooks.md#the-cascade)). They can hook `rules`, `authorize`, `respond`, `after` and `later`, receive the action's name (`action`) and its `model`, and must return the type they receive. An app `after` runs once every write of every table has committed, before the resource's and the action's, so it is where an audit log goes ([Hooks](hooks.md#after)); an app `later` runs from the outbox for every write ([Hooks](hooks.md#later)). `authorize` also receives the identity, `auth`, typed from what the app's `auth` function returns.

```ts
type Identity = { id: number; suspended: boolean };

export default defineApp({
  // lookUp stands for finding the identity, as in the example above.
  auth: async ({ request, db }): Promise<Identity | null> => lookUp(request, db),
  hooks: {
    // A suspended account is refused everywhere, whatever the policies say.
    authorize: ({ prev, auth }) => prev && auth?.suspended !== true,
    // No reply is cached.
    respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'cache-control': 'no-store' } }),
  },
});
```

`action` lets a hook single out actions: `({ prev, action }) => prev && action !== 'destroy'` refuses every destroy, in every table.

Write `auth` before `hooks`. TypeScript reads the object in order, and the hooks' `auth` type comes from the `auth` function; written the other way round, `auth` is `never` in the hooks, and `tsc` reports the `auth` function as not assignable.

## Paging

```ts
defineApp({ index: { perPage: 50, maxPerPage: 200 } });
```

`perPage` is the page size when a request does not send `per_page`, 25 by default. `maxPerPage` is the largest `per_page` accepted, 100 by default; a larger one is a 422. Both are positive integers, and `perPage` cannot exceed `maxPerPage`: `defineApp` throws when they do.

## Problem types

```ts
defineApp({ problems: { typeBase: 'https://api.example.com/problems/' } });
```

By default a problem's `type` is `about:blank`. With `typeBase`, it is a URI under it, one per status: `.../bad-request`, `.../unauthorized`, `.../forbidden`, `.../not-found`, `.../conflict`, `.../validation-error` and `.../internal-error`. Publish a page at each if clients should be able to look them up. A problem that a hook builds with `problem()` has `about:blank` unless it passes `typeBase` itself ([Hooks](hooks.md#stopping-with-a-problem)).
