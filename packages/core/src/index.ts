export const PACKAGE = '@blendx/core';

export {
  type ActionBuilder,
  type ActionDefinition,
  type ActionHooks,
  BlendxDefinitionError,
  type BuiltinAction,
  blend,
  type CustomSpec,
  type HookSpec,
  type HttpMethod,
  type PolicySpec,
  type Resource,
  type ResourceSpec,
} from './blend.ts';
export type {
  Column,
  ConstraintKind,
  ConstraintMeta,
  Insert,
  Model,
  ModelMeta,
  PublicRow,
  Row,
  SoftDeletes,
  WritableColumn,
  Writes,
} from './model.ts';
export {
  allow,
  deny,
  type Policy,
  type PolicyContext,
  type PolicyKind,
} from './policy.ts';
export type {
  DefaultRules,
  EmptyRules,
  ResolvedRules,
  StoreRules,
  UpdateRules,
} from './rules.ts';
