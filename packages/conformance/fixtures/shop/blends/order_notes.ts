import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.order_notes, {
  policy: allow.authenticated,
  // show decides who sees a note, on its own and nested by ?include=notes on orders (D31).
  actions: (a) => [a.index(), a.store(), a.show()],
});
