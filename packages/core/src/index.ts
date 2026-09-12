export const PACKAGE = '@blendx/core';

export {
  type App,
  type AppHooks,
  type AppSpec,
  type AuthContext,
  BlendxConfigError,
  defineApp,
  type Register,
  type RegisteredAuth,
} from './app.ts';

export {
  type ActionBuilder,
  type ActionDefinition,
  type ActionHooks,
  type ActionReply,
  type ActionRules,
  BlendxDefinitionError,
  type BuiltinAction,
  blend,
  type HttpMethod,
  type IndexPage,
  type PolicySpec,
  type Resource,
  type ResourceHooks,
  type ResourceSpec,
} from './blend.ts';
export {
  type EffectDefaults,
  type Level,
  type LoadInput,
  type ResolvedEndpoint,
  resolveEndpoint,
  type SaveInput,
  STAGES,
  type Stage,
} from './cascade.ts';
export {
  CONFIG_DEFAULTS,
  type Config,
  type ConfigInput,
  DATABASE_DRIVERS,
  type DatabaseDriver,
  defineConfig,
} from './config.ts';
export { type DeriveOptions, defaultRules } from './derive-rules.ts';
export { type EndpointDefinition, toEndpoints } from './endpoints.ts';
export {
  type DefaultEffectOptions,
  defaultEffects,
  type ExecuteDeps,
  type ExecuteRequest,
  type ExecuteResult,
  execute,
  HttpProblem,
} from './engine.ts';
export type {
  AuthorizeContext,
  CalculateContext,
  CollectionSpec,
  Db,
  IndexSpec,
  Input,
  LoadContext,
  MemberSpec,
  RecordSpec,
  Reply,
  ResolvedReply,
  RespondContext,
  RouteOptions,
  SaveContext,
  StoreSpec,
  UpdateSpec,
} from './hooks.ts';
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
export {
  jsonPointer,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  type ProblemError,
  type ProblemOptions,
  type ProblemStatus,
  problem,
  validationProblem,
} from './problems.ts';
export type {
  DefaultRules,
  EmptyRules,
  IndexQuery,
  IndexRules,
  ResolvedRules,
  StoreRules,
  UpdateRules,
} from './rules.ts';
