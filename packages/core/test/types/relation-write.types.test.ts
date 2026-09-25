/** P17.21: relation replacement is typed from generated model primary keys and columns. */
import { expect, expectTypeOf, test } from 'bun:test';
import { type Db, replaceRelation } from '@blendx/core';
import { models } from '../fixtures/membership.schema.ts';

declare const tx: Db;

test('replaceRelation accepts named scalar and composite primary keys', () => {
  const scalar = () =>
    replaceRelation({
      tx,
      through: models.task_assignees,
      owner: {
        model: models.tasks,
        key: { id: 101 },
        columns: { task_id: 'id' },
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
    });
  expectTypeOf(scalar).toBeFunction();

  const composite = () =>
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
        keys: [{ project_id: 10, user_id: 1 }],
        columns: { member_project_id: 'project_id', member_user_id: 'user_id' },
        pointer: '/members',
      },
      eligible: {
        model: models.project_members,
        owner: { project_id: 'project_id' },
        target: { project_id: 'project_id', user_id: 'user_id' },
      },
    });
  expectTypeOf(composite).toBeFunction();

  const invalid = () =>
    replaceRelation({
      tx,
      through: models.task_assignees,
      owner: {
        model: models.tasks,
        // @ts-expect-error owner keys are model primary-key fields
        key: { task_id: 101 },
        columns: { task_id: 'id' },
      },
      targets: {
        model: models.users,
        // @ts-expect-error target keys are model primary-key fields
        keys: [{ user_id: 1 }],
        columns: { user_id: 'id' },
        pointer: '/assignees',
      },
      eligible: {
        model: models.project_members,
        owner: { project_id: 'project_id' },
        target: { user_id: 'id' },
      },
    });
  expect(invalid).toBeFunction();
});
