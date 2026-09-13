import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  // Anyone may sign up. After that, a user sees only their own record.
  policy: { store: allow.public, show: allow.owner('id') },
  actions: (a) => [
    a.store({
      // Only the email and the name come from the request: is_approver and api_token keep
      // their schema defaults. The 201 reply carries the new api_token, the bearer token.
      rules: ({ prev }) =>
        prev.pick({ email: true, name: true }).extend({ email: z.email().max(255) }),
    }),
    a.show(),
  ],
});
