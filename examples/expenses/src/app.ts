import { defineApp } from 'blendx';
import { sql } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

const BEARER = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export default defineApp({
  /**
   * The identity is the user whose api_token is the request's bearer token. Without a token,
   * or with one nobody has, there is no identity, and actions that need one answer 401.
   */
  auth: async ({ request, db }): Promise<{ id: number; is_approver: boolean } | null> => {
    const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return null;
    const users = models.users.table;
    const [user] = await db
      .select({ id: users.id, is_approver: users.is_approver })
      .from(users)
      .where(sql`${users.api_token} = ${token}`)
      .limit(1);
    return user ?? null;
  },
});
