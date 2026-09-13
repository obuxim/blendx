/**
 * blendx: the only package app code imports. It re-exports the authoring API from
 * @blendx/core, the Hono adapter, and zod's `z`.
 */
export const PACKAGE = 'blendx';

export {
  type App,
  type AppSpec,
  allow,
  BlendxConfigError,
  BlendxDefinitionError,
  blend,
  type Db,
  type DrainResult,
  defineApp,
  defineConfig,
  deny,
  drainOutbox,
  HttpProblem,
  type Model,
  type OutboxOptions,
  type OutboxWorker,
  type Policy,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  type PublicRow,
  problem,
  type Register,
  type RegisteredAuth,
  type Reply,
  type Resource,
  type Row,
  startOutbox,
  type Writes,
} from '@blendx/core';
export { type BlendxEnv, createServer, router, run, type ServerOptions } from '@blendx/hono';
export { z } from 'zod';
export { createDatabase, type Database, type DatabaseConfig } from './database.ts';
