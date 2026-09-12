import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.store(), a.show(), a.update()],
});
