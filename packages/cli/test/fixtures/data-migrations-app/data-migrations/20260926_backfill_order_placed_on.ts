import { dataMigration } from 'blendx';
import { sql } from 'blendx/drizzle';

export default dataMigration({
  id: '20260926_backfill_order_placed_on',
  async up({ tx }) {
    await tx.execute(
      sql.raw('update orders set placed_on = created_at::date where placed_on is null'),
    );
  },
});
