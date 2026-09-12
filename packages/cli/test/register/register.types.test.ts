/**
 * P7.2: the generated register.gen.ts (./generated) registers app.ts through the blendx
 * facade. This folder is its own tsconfig project, because the augmentation is global.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { allow, type Policy, type RegisteredAuth } from 'blendx';
import type { models } from '../../../dbml/test/golden/shop.schema.gen.ts';
import type { User } from './app.ts';

describe('register.gen.ts', () => {
  test('the app registered through blendx decides the auth type', () => {
    expectTypeOf<RegisteredAuth>().toEqualTypeOf<User>();
  });

  test('policies see the registered identity', () => {
    const admins: Policy<typeof models.orders> = allow.when(({ auth }) => {
      expectTypeOf(auth).toEqualTypeOf<User | null>();
      return auth?.role === 'admin';
    });
    expect(admins.kind).toBe('when');
  });
});
