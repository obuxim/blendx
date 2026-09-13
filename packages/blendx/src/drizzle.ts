/**
 * blendx/drizzle: the Drizzle builders that a generated schema.gen.ts imports, and the outbox
 * table that a generated outbox.gen.ts re-exports (D27). Going through blendx keeps an app on
 * the exact drizzle-orm that blendx is built against.
 */
export { outbox } from '@blendx/core';
export { sql } from 'drizzle-orm';
export * from 'drizzle-orm/pg-core';
