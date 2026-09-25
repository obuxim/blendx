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
  type AppActionBuilder,
  type AppActionContext,
  type AppActionDefinition,
  AppActionDefinitionError,
  type AppActionHandler,
  type AppActionMethod,
  type AppActionReply,
  type AppActionResult,
  appActionHasJsonBody,
  appActionProblemStatuses,
  appActions,
  type MultipartInput,
  multipart,
  validateAppActions,
} from './app-action.ts';
export type { HasManySpec, IncludesSpec, IncludeTarget } from './blend.ts';
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
export { type DataMigration, dataMigration } from './data-migration.ts';
export { type DeriveOptions, defaultRules, indexSorts, recordSchema } from './derive-rules.ts';
export {
  defaultStatus,
  type EndpointDefinition,
  includePaths,
  resolveIncludes,
  toEndpoints,
} from './endpoints.ts';
export {
  type DefaultEffectOptions,
  databaseError,
  defaultEffects,
  defaultPrev,
  type ExecuteDeps,
  type ExecuteRequest,
  type ExecuteResult,
  execute,
  HttpProblem,
  resetColumns,
} from './engine.ts';
export { type ExampleRun, runExamples } from './examples.ts';
export type {
  AfterContext,
  AuthorizeContext,
  CalculateContext,
  CollectionSpec,
  Db,
  IndexSpec,
  Input,
  LaterContext,
  LoadContext,
  MemberSpec,
  RecordSpec,
  Reply,
  ReplyDeclaration,
  ReplyOption,
  ReplySchema,
  ResolvedReply,
  RespondContext,
  RouteOptions,
  SaveContext,
  StoreSpec,
  UpdateSpec,
} from './hooks.ts';
export { describeFields, describeSchema, toJsonSchema } from './json-schema.ts';
export type {
  Column,
  ConstraintKind,
  ConstraintMeta,
  ForeignKeysTo,
  Insert,
  Model,
  ModelMeta,
  PublicRow,
  Relation,
  RelationTable,
  Row,
  SoftDeletes,
  WritableColumn,
  Writes,
} from './model.ts';
export {
  buildOpenApi,
  type JsonObject,
  type OpenApiOptions,
  type OpenApiResult,
  stringifyOpenApi,
} from './openapi.ts';
export { enqueueLater, type OutboxPayload, outbox } from './outbox.ts';
export {
  allow,
  deny,
  isMemberPolicy,
  type MemberPathHop,
  type MemberPolicy,
  type MemberPolicyOptions,
  type MemberRelated,
  type MemberRelatedMember,
  type MemberRelatedPath,
  type MembershipRoot,
  type MembershipThrough,
  type Policy,
  type PolicyContext,
  type PolicyKind,
  type ResolvedMemberRelated,
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
export {
  type RelationColumnMap,
  type RelationKey,
  type RelationKeyColumnMap,
  RelationWriteDefinitionError,
  type ReplaceRelationOptions,
  replaceRelation,
} from './relation-write.ts';
export { type BelongsTo, foreignKeysTo, relationsOf } from './relations.ts';
export {
  type ActionReview,
  type AppActionReview,
  type AppReview,
  type CalculateReview,
  type ReplyReview,
  type ResourceReview,
  reviewAppActions,
  reviewResource,
  type StageReview,
} from './review.ts';
export type {
  DefaultRules,
  EmptyRules,
  IndexQuery,
  IndexRules,
  ResolvedRules,
  StoreRules,
  UpdateRules,
} from './rules.ts';
export {
  type DrainResult,
  drainOutbox,
  hasLaterHooks,
  type OutboxOptions,
  type OutboxWorker,
  startOutbox,
} from './worker.ts';
