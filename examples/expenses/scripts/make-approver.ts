/**
 * Makes a user an approver: `bun scripts/make-approver.ts ada@example.com`, from the app
 * folder. Approvers are made here, never through the API. On PGlite, stop the server first:
 * only one process at a time can open the data folder.
 */
import { createDatabase } from 'blendx';
import { sql } from 'blendx/drizzle';
import config from '../blendx.config.ts';
import { models } from '../src/generated/schema.gen.ts';

const email = process.argv[2];
if (!email) {
  console.error('usage: bun scripts/make-approver.ts <email>');
  process.exit(2);
}

const database = await createDatabase(config);
const users = models.users.table;
const updated = await database.db
  .update(users)
  .set({ is_approver: true })
  .where(sql`${users.email} = ${email}`)
  .returning({ id: users.id });
await database.close();

console.log(updated.length === 1 ? `${email} is an approver` : `no user has the email ${email}`);
process.exit(updated.length === 1 ? 0 : 1);
