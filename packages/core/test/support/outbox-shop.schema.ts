/**
 * The shop schema plus the outbox table (D27), for the tests of later hooks. An app gets the
 * table the same way: its generated outbox.gen.ts re-exports it once it has a later hook.
 */
export * from '../../../dbml/test/golden/shop.schema.gen.ts';
export { outbox } from '../../src/outbox.ts';
