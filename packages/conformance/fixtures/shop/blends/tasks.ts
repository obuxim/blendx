import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

const projectMember = allow.member({
  via: ['project'],
  through: { model: models.project_members, member: 'user_id' },
  related: {
    section_id: { via: ['project'] },
    assignee_id: { member: true },
  },
});

/** The conformance fixture's complete D36 example: one policy covers all four routes. */
export default blend(models.tasks, {
  policy: projectMember,
  actions: (a) => [a.index(), a.store(), a.show(), a.update()],
});
