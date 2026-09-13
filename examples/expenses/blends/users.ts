import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  // Anyone may sign up. After that, a user sees only their own record.
  policy: { store: allow.public, show: allow.owner('id') },
  // The bearer token. Sign-up's reply reveals it, once; no other reply carries it.
  hidden: ['api_token'],
  actions: (a) => [
    a.store({
      // Only the email and the name come from the request: is_approver and api_token keep
      // their schema defaults.
      rules: ({ prev }) =>
        prev.pick({ email: true, name: true }).extend({ email: z.email().max(255) }),
      reveal: ['api_token'],
    }),
    a.show(),
  ],
});
