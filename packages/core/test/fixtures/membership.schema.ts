/** A compact project boundary for the P17.9 member-policy engine tests. */
import { foreignKey, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

export const users = pgTable('member_users', {
  id: integer().primaryKey(),
  name: text().notNull(),
});

export const projects = pgTable('member_projects', {
  id: integer().primaryKey(),
  name: text().notNull(),
});

export const project_members = pgTable(
  'member_project_members',
  {
    project_id: integer().notNull(),
    user_id: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.project_id, table.user_id] }),
    foreignKey({ columns: [table.project_id], foreignColumns: [projects.id] }),
    foreignKey({ columns: [table.user_id], foreignColumns: [users.id] }),
  ],
);

export const sections = pgTable(
  'member_sections',
  {
    id: integer().primaryKey(),
    project_id: integer().notNull(),
    name: text().notNull(),
  },
  (table) => [foreignKey({ columns: [table.project_id], foreignColumns: [projects.id] })],
);

export const tasks = pgTable(
  'member_tasks',
  {
    id: integer().primaryKey(),
    project_id: integer().notNull(),
    section_id: integer().notNull(),
    assignee_id: integer(),
    title: text().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.project_id], foreignColumns: [projects.id] }),
    foreignKey({ columns: [table.section_id], foreignColumns: [sections.id] }),
    foreignKey({ columns: [table.assignee_id], foreignColumns: [users.id] }),
    index('member_tasks_title_idx').on(table.title),
  ],
);

/** The P17.21 scalar-target join fixture. */
export const task_assignees = pgTable(
  'member_task_assignees',
  {
    task_id: integer().notNull(),
    user_id: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.task_id, table.user_id] }),
    foreignKey({ columns: [table.task_id], foreignColumns: [tasks.id] }),
    foreignKey({ columns: [table.user_id], foreignColumns: [users.id] }),
  ],
);

/** A compact composite-target join fixture: task -> project member. */
export const task_member_refs = pgTable(
  'member_task_member_refs',
  {
    task_id: integer().notNull(),
    member_project_id: integer().notNull(),
    member_user_id: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.task_id, table.member_project_id, table.member_user_id] }),
    foreignKey({ columns: [table.task_id], foreignColumns: [tasks.id] }),
    foreignKey({
      columns: [table.member_project_id, table.member_user_id],
      foreignColumns: [project_members.project_id, project_members.user_id],
    }),
  ],
);

export const models = {
  users: {
    name: 'member_users',
    table: users,
    meta: {
      primaryKey: ['id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_users_pkey: { kind: 'primaryKey', columns: ['id'] },
      },
    },
  },
  projects: {
    name: 'member_projects',
    table: projects,
    meta: {
      primaryKey: ['id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_projects_pkey: { kind: 'primaryKey', columns: ['id'] },
      },
    },
  },
  project_members: {
    name: 'member_project_members',
    table: project_members,
    meta: {
      primaryKey: ['project_id', 'user_id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_project_members_pkey: { kind: 'primaryKey', columns: ['project_id', 'user_id'] },
        member_project_members_project_id_fkey: {
          kind: 'foreignKey',
          columns: ['project_id'],
          references: { table: 'member_projects', columns: ['id'] },
        },
        member_project_members_user_id_fkey: {
          kind: 'foreignKey',
          columns: ['user_id'],
          references: { table: 'member_users', columns: ['id'] },
        },
      },
    },
  },
  sections: {
    name: 'member_sections',
    table: sections,
    meta: {
      primaryKey: ['id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_sections_pkey: { kind: 'primaryKey', columns: ['id'] },
        member_sections_project_id_fkey: {
          kind: 'foreignKey',
          columns: ['project_id'],
          references: { table: 'member_projects', columns: ['id'] },
        },
      },
    },
  },
  tasks: {
    name: 'member_tasks',
    table: tasks,
    meta: {
      primaryKey: ['id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_tasks_pkey: { kind: 'primaryKey', columns: ['id'] },
        member_tasks_project_id_fkey: {
          kind: 'foreignKey',
          columns: ['project_id'],
          references: { table: 'member_projects', columns: ['id'] },
        },
        member_tasks_section_id_fkey: {
          kind: 'foreignKey',
          columns: ['section_id'],
          references: { table: 'member_sections', columns: ['id'] },
        },
        member_tasks_assignee_id_fkey: {
          kind: 'foreignKey',
          columns: ['assignee_id'],
          references: { table: 'member_users', columns: ['id'] },
        },
      },
    },
  },
  task_assignees: {
    name: 'member_task_assignees',
    table: task_assignees,
    meta: {
      primaryKey: ['task_id', 'user_id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_task_assignees_pkey: { kind: 'primaryKey', columns: ['task_id', 'user_id'] },
        member_task_assignees_task_id_fkey: {
          kind: 'foreignKey',
          columns: ['task_id'],
          references: { table: 'member_tasks', columns: ['id'] },
        },
        member_task_assignees_user_id_fkey: {
          kind: 'foreignKey',
          columns: ['user_id'],
          references: { table: 'member_users', columns: ['id'] },
        },
      },
    },
  },
  task_member_refs: {
    name: 'member_task_member_refs',
    table: task_member_refs,
    meta: {
      primaryKey: ['task_id', 'member_project_id', 'member_user_id'],
      timestamps: { createdAt: null, updatedAt: null },
      softDelete: null,
      generated: [],
      constraints: {
        member_task_member_refs_pkey: {
          kind: 'primaryKey',
          columns: ['task_id', 'member_project_id', 'member_user_id'],
        },
        member_task_member_refs_task_id_fkey: {
          kind: 'foreignKey',
          columns: ['task_id'],
          references: { table: 'member_tasks', columns: ['id'] },
        },
        member_task_member_refs_member_fkey: {
          kind: 'foreignKey',
          columns: ['member_project_id', 'member_user_id'],
          references: {
            table: 'member_project_members',
            columns: ['project_id', 'user_id'],
          },
        },
      },
    },
  },
} as const;
