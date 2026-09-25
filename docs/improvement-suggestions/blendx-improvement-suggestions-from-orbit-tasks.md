# Blendx improvement suggestions from Orbit Tasks

These are observations from building Orbit Tasks with `blendx`, `@blendx/cli`, and `@blendx/react` 0.1.0. They are requests for better defaults and tooling, not claims that the workflows are impossible today. The [Blendx React guide](https://github.com/obuxim/blendx/blob/main/docs/guide/react.md) already documents custom blend actions and cross-table invalidation.

## 1. Show custom hook behavior in `blendx review` (high priority)

**What happened:** [Project creation](blends/projects.ts) has a custom `save` hook. It verifies workspace membership and inserts a project owner, a workspace member, and three default sections in the same transaction. Yet [the generated project review](review/projects.yaml) describes the store authorization as `authenticated` and its save stage as a plain insert. A reviewer reading only that artifact would miss the actual access check and related writes.

**Suggestion:** Mark overridden stages prominently in review output. Show the hook source or a source location and an explicit warning that the summary cannot describe its authorization and side effects. A declarative way to list tables written by a hook would also help review and client invalidation.

**Done when:** A change to a custom `authorize` or `save` hook produces a meaningful review diff, and the review cannot be mistaken for the default action pipeline.

## 2. Make project and workspace membership a reusable query policy (high priority)

**What happened:** [Task](blends/tasks.ts), [comment](blends/comments.ts), and section actions repeat project membership checks. Their index policies inspect `project_id` input, while store authorization and record authorization use separate checks. [The auth loader](src/app.ts) fetches every project and workspace membership into arrays on each authenticated request so those checks can run synchronously. [Link validation](src/access.ts) separately verifies that a section and assignee belong to the task's project.

**Suggestion:** Provide a relation-aware policy primitive that can scope index queries and authorize individual reads and writes with database `EXISTS` predicates. It should be reusable across actions and let a project boundary validate related IDs in the same transaction. Keep `allow.when`, `scope`, and custom hooks for cases that need them.

**Done when:** One declared project-member policy can guard index, show, store, and update without loading all memberships into the auth object or repeating a manual check for each action.

## 3. Bring domain endpoints into the typed client workflow (high priority)

**What happened:** Generated blend actions use `@blendx/react`, but [the server](server.ts) also needs routes for sessions, workspaces, invitations, bulk assignee changes, and file uploads. [The UI client](web/api.ts) uses a hand-written `request<T>` for those routes, and [the workspace UI](web/Workspace.tsx) supplies response types and TanStack Query keys manually. Blendx supports custom actions; the friction here is fitting operations outside a single table action, especially authentication and multipart uploads, into the same generated client and query workflow.

**Suggestion:** Document and support typed app-level/domain actions alongside table blends, including JSON and multipart inputs, response types, and cache invalidation metadata. A migration recipe from a handwritten Hono route to a typed Blendx action would be useful.

**Done when:** An invite-acceptance or bulk-assignment endpoint can be defined once on the server and consumed from `@blendx/react` with inferred input/output types and predictable invalidation.

## 4. Add a versioned data backfill workflow to migrations (medium priority)

**What happened:** When workspaces were introduced, generated schema migrations created the new structures, but [server startup](server.ts) also began scanning existing users and projects to create default workspaces and attach legacy projects. That data transformation currently runs on every boot.

**Suggestion:** Offer a documented, versioned data migration step that can run transactionally with or immediately after schema migrations, records completion, and handles a rerun safely. Include a guide for adding a non-null relationship to existing rows.

**Done when:** The workspace backfill can move out of server startup into a one-time migration with a clear execution order and failure report.

## 5. Simplify atomic updates to many-to-many relations (medium priority)

**What happened:** Moving from one assignee to multiple assignees required a `task_assignees` join table. [The task blend](blends/tasks.ts) maintains part of that relation in custom save hooks, while [a separate endpoint](server.ts) replaces the full assignee set. The endpoint must validate every user against the project and update the join rows atomically.

**Suggestion:** Provide a typed relation-write helper for operations such as “replace this task's assignees with these member IDs,” with transactional validation and a declared set of affected tables. It could be an action helper rather than automatic nested writes.

**Done when:** The full assignment set can be replaced through one typed action without hand-writing the delete/insert cycle and cross-project validation each time.

## Scope

The board layout, inline editing, rich text editor, avatar picker, and comment attachment storage are application or UI concerns. They are not presented here as Blendx framework defects.
