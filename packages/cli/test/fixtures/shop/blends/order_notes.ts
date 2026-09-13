import { allow, blend } from 'blendx';
import { models } from '../../../../../dbml/test/golden/shop.schema.gen.ts';

export default blend(models.order_notes, {
  policy: allow.public,
  // show, so that orders may include the notes (D31).
  actions: (a) => [a.index(), a.store(), a.show()],
});
