import { allow, blend } from 'blendx';
import { models } from '../../../../../dbml/test/golden/shop.schema.gen.ts';

export default blend(models.order_notes, {
  policy: allow.public,
  actions: (a) => [a.index(), a.store()],
});
