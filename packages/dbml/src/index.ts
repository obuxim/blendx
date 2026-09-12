export const PACKAGE = '@blendx/dbml';

export { loadDbmlCore } from './dbml-core.ts';
export * from './ir.ts';
export { type DbmlDiagnostic, DbmlError, parseDbml } from './parse.ts';
export { type MappedType, mapColumnType } from './types.ts';
