/**
 * Policies decide the authorize stage. Every resource must declare one (default-deny),
 * and each policy says up front whether it needs an identity, so a request without one
 * gets 401 before validation runs (docs/decisions.md D3).
 */
import type { Column, Model, Row } from './model.ts';

export interface PolicyContext<M extends Model = Model, Auth = unknown> {
  /** The authenticated identity, or null when the request has none. */
  auth: Auth | null;
  /** The loaded record for member actions; undefined for index, store and collection actions. */
  record: Row<M> | undefined;
  /** The validated input. */
  input: unknown;
  action: string;
}

export type PolicyKind = 'public' | 'authenticated' | 'owner' | 'when' | 'deny';

export interface Policy<M extends Model = Model, Auth = unknown> {
  readonly kind: PolicyKind;
  /** True when a request without an identity is rejected with 401 before validation. */
  readonly requiresAuth: boolean;
  /** Human-readable form, shown in the review YAML. */
  readonly description: string;
  check(context: PolicyContext<M, Auth>): boolean | Promise<boolean>;
}

const readField = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export const allow = {
  /** Anyone, with or without an identity. */
  public: {
    kind: 'public',
    requiresAuth: false,
    description: 'public',
    check: () => true,
  } satisfies Policy as Policy,

  /** Any authenticated identity. */
  authenticated: {
    kind: 'authenticated',
    requiresAuth: true,
    description: 'authenticated',
    check: ({ auth }) => auth !== null && auth !== undefined,
  } satisfies Policy as Policy,

  /**
   * The identity owns the record: `record[column]` equals `auth[authKey]`. Actions
   * without a record (index, store, collection actions) are denied; give them their
   * own policy, and scope index queries in `load`.
   */
  owner<M extends Model, Auth = unknown>(column: Column<M>, authKey = 'id'): Policy<M, Auth> {
    return {
      kind: 'owner',
      requiresAuth: true,
      description: `owner (${column} = auth.${authKey})`,
      check: ({ auth, record }) => {
        if (record === undefined || auth === null || auth === undefined) return false;
        const owner = readField(record, column);
        return owner !== undefined && owner !== null && owner === readField(auth, authKey);
      },
    };
  },

  /** A custom rule. Set `requiresAuth` when the rule cannot pass without an identity. */
  when<M extends Model, Auth = unknown>(
    check: (context: PolicyContext<M, Auth>) => boolean | Promise<boolean>,
    options: { description?: string; requiresAuth?: boolean } = {},
  ): Policy<M, Auth> {
    return {
      kind: 'when',
      requiresAuth: options.requiresAuth ?? false,
      description: options.description ?? 'custom rule',
      check,
    };
  },
};

/** Nobody. Also the schema-level default before a resource declares its policy. */
export const deny: Policy = {
  kind: 'deny',
  requiresAuth: false,
  description: 'deny',
  check: () => false,
};
