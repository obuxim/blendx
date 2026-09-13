import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  // Anyone may sign up; everything else needs an identity. Users list and update only themselves.
  policy: { default: allow.authenticated, store: allow.public, update: allow.owner('id') },
  hidden: ['password'],
  actions: (a) => [
    a.index({ scope: ({ auth }) => ({ id: auth?.id }) }),
    a.store(),
    a.show(),
    a.update(),
  ],
});
