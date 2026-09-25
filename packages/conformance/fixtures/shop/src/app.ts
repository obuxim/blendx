import { defineApp, HttpProblem, multipart, problem, replaceRelation, z } from 'blendx';
import { and, eq, inArray } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

/**
 * Written out rather than allow.authenticated: `allow` is typed through RegisteredAuth, which
 * register.gen.ts derives from this app, so naming it here would make the app's type circular.
 */
const authenticated = {
  kind: 'authenticated',
  requiresAuth: true,
  description: 'authenticated',
  check: ({ auth }: { auth: { id: number } | null }) => auth !== null,
};

/**
 * The conformance identity is the x-user-id header: a positive integer is that user, anything
 * else is no identity. A real app verifies a token here instead.
 */
export default defineApp({
  auth: ({ request }): { id: number } | null => {
    const id = Number(request.headers.get('x-user-id'));
    return Number.isInteger(id) && id > 0 ? { id } : null;
  },
  actions: (a) => [
    a.action('task_count', {
      method: 'get',
      path: '/reports/task-count',
      policy: authenticated,
      input: z.object({}).strict(),
      reply: { status: 200, body: z.object({ total: z.number().int() }) },
      handler: async ({ db }) => {
        const tasks = await db.select({ id: models.tasks.table.id }).from(models.tasks.table);
        return { status: 200, body: { total: tasks.length } };
      },
    }),
    a.action('accept_invite', {
      method: 'post',
      path: '/invites/:token/accept',
      policy: authenticated,
      input: z.object({}).strict(),
      reply: {
        status: 200,
        body: z.object({ project_id: z.number().int(), accepted: z.literal(true) }),
      },
      writes: [models.project_members, models.invites],
      handler: async ({ params, auth, tx }) => {
        if (!auth) throw new HttpProblem(problem(401));
        const [invite] = await tx
          .select({
            project_id: models.invites.table.project_id,
            accepted_by: models.invites.table.accepted_by,
          })
          .from(models.invites.table)
          .where(eq(models.invites.table.token as never, params.token))
          .limit(1);
        if (!invite) throw new HttpProblem(problem(404, { detail: 'invite not found' }));
        if (invite.accepted_by !== null)
          throw new HttpProblem(problem(409, { detail: 'invite is accepted' }));
        await tx
          .insert(models.project_members.table)
          .values({ project_id: invite.project_id, user_id: auth.id });
        await tx
          .update(models.invites.table)
          .set({ accepted_by: auth.id, accepted_at: new Date().toISOString() })
          .where(eq(models.invites.table.token as never, params.token));
        return { status: 200, body: { project_id: invite.project_id, accepted: true as const } };
      },
    }),
    a.action('upload_avatar', {
      method: 'post',
      path: '/users/:id/avatar',
      policy: authenticated,
      input: multipart(
        z
          .object({
            file: z
              .file()
              .mime(['image/png'])
              .max(256 * 1024),
            caption: z.string().max(120).optional(),
          })
          .strict(),
        { maxBytes: 512 * 1024 },
      ),
      reply: {
        status: 201,
        body: z.object({ id: z.number().int(), byte_length: z.number().int() }),
      },
      writes: [models.uploads, models.users],
      handler: async ({ params, input, auth, tx }) => {
        const userId = Number(params.id);
        if (!auth) throw new HttpProblem(problem(401));
        if (!Number.isInteger(userId) || userId !== auth.id) throw new HttpProblem(problem(403));
        const [upload] = await tx
          .insert(models.uploads.table)
          .values({
            user_id: userId,
            filename: input.file.name,
            content_type: input.file.type,
            byte_length: input.file.size,
          })
          .returning({
            id: models.uploads.table.id,
            byte_length: models.uploads.table.byte_length,
          });
        if (!upload) throw new Error('upload insert returned no row');
        return { status: 201, body: upload };
      },
    }),
    a.action('bulk_assign_tasks', {
      method: 'post',
      path: '/tasks/bulk-assign',
      policy: authenticated,
      input: z.object({
        task_ids: z.array(z.number().int()).min(1),
        assignee_id: z.number().int(),
      }),
      reply: { status: 200, body: z.object({ assigned: z.number().int() }) },
      writes: [models.tasks],
      handler: async ({ input, auth, tx }) => {
        if (!auth) throw new HttpProblem(problem(401));
        const taskIds = [...new Set(input.task_ids)];
        const available = await tx
          .select({ id: models.tasks.table.id, project_id: models.tasks.table.project_id })
          .from(models.tasks.table)
          .innerJoin(
            models.project_members.table,
            and(
              eq(models.project_members.table.project_id as never, models.tasks.table.project_id),
              eq(models.project_members.table.user_id as never, auth.id),
            ),
          )
          .where(inArray(models.tasks.table.id as never, taskIds));
        if (available.length !== taskIds.length) throw new HttpProblem(problem(403));
        const projects = [...new Set(available.map((task) => task.project_id))];
        const assignee = await tx
          .select({ project_id: models.project_members.table.project_id })
          .from(models.project_members.table)
          .where(
            and(
              eq(models.project_members.table.user_id as never, input.assignee_id),
              inArray(models.project_members.table.project_id as never, projects),
            ),
          );
        if (assignee.length !== projects.length) throw new HttpProblem(problem(422));
        const assigned = await tx
          .update(models.tasks.table)
          .set({ assignee_id: input.assignee_id })
          .where(inArray(models.tasks.table.id as never, taskIds))
          .returning({ id: models.tasks.table.id });
        return { status: 200, body: { assigned: assigned.length } };
      },
    }),
    a.action('replace_task_assignees', {
      method: 'put',
      path: '/tasks/:id/assignees',
      policy: authenticated,
      input: z
        .object({
          assignees: z.array(z.object({ id: z.number().int() }).strict()),
        })
        .strict(),
      reply: {
        status: 200,
        body: z.object({
          task_id: z.number().int(),
          assignees: z.array(z.object({ id: z.number().int() }).strict()),
        }),
      },
      writes: [models.tasks, models.task_assignees],
      handler: async ({ params, input, auth, tx }) => {
        if (!auth) throw new HttpProblem(problem(401));
        const taskId = Number(params.id);
        if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new HttpProblem(problem(404));
        // Lock the owner while verifying the actor's project membership. The helper then uses
        // the same transaction to validate targets and replace the join rows.
        const [task] = await tx
          .select({ id: models.tasks.table.id })
          .from(models.tasks.table)
          .innerJoin(
            models.project_members.table,
            and(
              eq(models.project_members.table.project_id as never, models.tasks.table.project_id),
              eq(models.project_members.table.user_id as never, auth.id),
            ),
          )
          .where(eq(models.tasks.table.id as never, taskId))
          .limit(1)
          .for('update');
        if (!task) throw new HttpProblem(problem(404));
        await replaceRelation({
          tx,
          through: models.task_assignees,
          owner: {
            model: models.tasks,
            key: { id: taskId },
            columns: { task_id: 'id' },
          },
          targets: {
            model: models.users,
            keys: input.assignees,
            columns: { user_id: 'id' },
            pointer: '/assignees',
          },
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
