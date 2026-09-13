/**
 * Type-only shims for the portability check (tsconfig.portable.json only).
 *
 * drizzle-orm/zod's column mapping tests `data extends Buffer`. Without any runtime types
 * loaded, `Buffer` is unresolved, the check degrades, and every schema type loses its
 * precision (found in the P1.3 spike). Declaring the interface restores precise types.
 * No `declare var Buffer` on purpose: core code still cannot use a Buffer *value*, so
 * the gate keeps rejecting runtime-specific code.
 */
interface Buffer extends Uint8Array {}
