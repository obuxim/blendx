/** P17.11: member policies expose related root and member checks through the public API. */
import { expect, expectTypeOf, test } from 'bun:test';
import { allow, blend, type MemberPolicy } from '@blendx/core';
import { models } from '../fixtures/membership.schema.ts';

test('allow.member is typed from the membership model', () => {
  const related = {
    section_id: { via: ['project'] },
    assignee_id: { member: true },
  } satisfies Record<string, import('@blendx/core').MemberRelated>;
  expectTypeOf(related.assignee_id.member).toEqualTypeOf<true>();
  const policy = allow.member({
    via: ['project'],
    through: { model: models.project_members, member: 'user_id' },
    related: {
      section_id: { via: ['project'] },
      assignee_id: { member: true },
    },
  });
  expectTypeOf(policy).toExtend<MemberPolicy>();

  const tasks = blend(models.tasks, { policy, actions: (a) => [a.index(), a.show()] });
  expect(tasks.policies.index?.kind).toBe('member');

  const invalidMember = () =>
    allow.member({
      via: ['project'],
      through: {
        model: models.project_members,
        // @ts-expect-error the member column comes from the generated membership model
        member: 'account_id',
      },
    });
  expect(invalidMember).toBeFunction();

  const invalidRelated = () =>
    allow.member({
      via: ['project'],
      through: { model: models.project_members, member: 'user_id' },
      related: {
        section_id: {
          // @ts-expect-error member checks require the literal true
          member: false,
        },
      },
    });
  expect(invalidRelated).toBeFunction();
});
