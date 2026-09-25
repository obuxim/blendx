import { allow, blend } from 'blendx';
import { models } from '../../../../dbml/test/golden/shop.schema.gen.ts';

const referencedAuthorize = ({ prev }: { prev: boolean }) => prev;

export default blend(models.orders, {
  policy: allow.public,
  hooks: {
    authorize: ({ prev }) => prev,
  },
  actions: (a) => [
    a.update({
      authorize: ({ prev }) => prev,
      save: async ({ runDefault }) => runDefault(),
    }),
    a.destroy({ authorize: referencedAuthorize }),
  ],
});
