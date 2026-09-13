/**
 * P11.5: the conformance suite on Node (24, type stripping) against PostgreSQL through the pg
 * driver. DATABASE_URL must point at a scratch database, whose public schema it resets:
 *
 *   DATABASE_URL=postgres://postgres@localhost:5432/blendx_test node packages/conformance/harness/node.ts
 *
 * It prints every failing case and exits 1, or exits 0 when all pass.
 */
import { runSuite } from './shop.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('conformance: set DATABASE_URL to a scratch database');
  process.exit(1);
}

const result = await runSuite({ driver: 'pg', url });
for (const failure of result.failed) {
  console.error(`${failure.id}: ${failure.title}`);
  for (const problem of failure.problems) console.error(`  ${problem}`);
}
console.log(
  `conformance on Node ${process.version} with pg: ${result.passed} passed, ${result.failed.length} failed`,
);
process.exitCode = result.failed.length === 0 ? 0 : 1;
