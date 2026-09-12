import { allow, blend } from 'blendx';
import { models } from '../../../../../dbml/test/golden/shop.schema.gen.ts';

export default blend(models.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.store(), a.show(), a.update()],
});
