import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.order_notes, {
  policy: allow.authenticated,
  actions: (a) => [a.index(), a.store()],
});
