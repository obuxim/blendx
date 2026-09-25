/** P17.13: an app action's declaration gives Hono its input, path params and reply type. */
import { expectTypeOf, test } from 'bun:test';
import { allow, defineApp, multipart } from '@blendx/core';
import { type BlendxEnv, runAction } from '@blendx/hono';
import { Hono } from 'hono';
import type { hc, InferRequestType, InferResponseType } from 'hono/client';
import { z } from 'zod';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';

const app = defineApp({
  auth: (): { id: number } => ({ id: 1 }),
  actions: (a) => [
    a.action('accept_invite', {
      method: 'post',
      path: '/invites/:token/accept',
      policy: allow.authenticated,
      input: z.object({ code: z.string() }),
      reply: { status: 200, body: z.object({ accepted: z.literal(true) }) },
      writes: [models.users],
      handler: ({ input, params, auth, tx }) => {
        void input;
        void params;
        void auth;
        void tx;
        return { status: 200, body: { accepted: true as const } };
      },
    }),
  ],
});

const routes = new Hono<BlendxEnv>().post(
  '/invites/:token/accept',
  ...runAction(app, 'accept_invite'),
);
type Client = ReturnType<typeof hc<typeof routes>>;
type AcceptInvite = Client['invites'][':token']['accept']['$post'];

test('an app action keeps its path parameter, JSON input, and declared reply in hc', () => {
  expectTypeOf<InferRequestType<AcceptInvite>['param']>().toEqualTypeOf<{ token: string }>();
  expectTypeOf<InferRequestType<AcceptInvite>['json']>().toEqualTypeOf<{ code: string }>();
  expectTypeOf<InferResponseType<AcceptInvite, 200>>().toEqualTypeOf<{ accepted: true }>();
});

const multipartApp = defineApp({
  actions: (a) => [
    a.action('upload', {
      method: 'post',
      path: '/uploads/:id',
      policy: allow.public,
      input: multipart(z.object({ file: z.file() }).strict(), { maxBytes: 1024 }),
      reply: { status: 201, body: z.object({ id: z.number() }) },
      writes: [models.users],
      handler: ({ input }) => {
        expectTypeOf(input.file).toEqualTypeOf<File>();
        return { status: 201, body: { id: 1 } };
      },
    }),
  ],
});
const multipartRoutes = new Hono<BlendxEnv>().post(
  '/uploads/:id',
  ...runAction(multipartApp, 'upload'),
);
type Upload = ReturnType<typeof hc<typeof multipartRoutes>>['uploads'][':id']['$post'];

test('a multipart action gives hc a typed native form input', () => {
  expectTypeOf<InferRequestType<Upload>['param']>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<InferRequestType<Upload>['form']>().toEqualTypeOf<{ file: File }>();
});
