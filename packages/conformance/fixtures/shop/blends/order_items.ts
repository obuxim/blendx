import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.order_items, {
  // A line of an order. Its key is (order_id, line), so a line is /order_items/:order_id/:line,
  // and both columns are input on store (D33).
  policy: allow.authenticated,
  actions: (a) => [a.index(), a.store(), a.show(), a.update(), a.replace(), a.destroy()],
});
