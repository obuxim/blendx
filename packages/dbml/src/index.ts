export const PACKAGE = '@blendx/dbml';

export { loadDbmlCore } from './dbml-core.ts';
export { constraintNames, emitDrizzle } from './emit-drizzle.ts';
export { type DbmlDiagnostic, DbmlError } from './errors.ts';
export * from './ir.ts';
export { parseDbml } from './parse.ts';
export { type MappedType, mapColumnType } from './types.ts';
export { loadSchema, RESERVED_QUERY_PARAMS, validateSchema } from './validate.ts';
