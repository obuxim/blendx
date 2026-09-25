/**
 * Policies decide the authorize stage. Every resource must declare one (default-deny),
 * and each policy says up front whether it needs an identity, so a request without one
 * gets 401 before validation runs (docs/decisions.md D3).
 */

import type { PgTable } from 'drizzle-orm/pg-core';
import type { RegisteredAuth } from './app.ts';
import type { Column, Model, Row } from './model.ts';

export interface PolicyContext<M extends Model = Model, Auth = RegisteredAuth> {
  /** The authenticated identity, or null when the request has none. */
  auth: Auth | null;
  /** The loaded record for member actions; undefined for index, store and collection actions. */
  record: Row<M> | undefined;
  /** The validated input. */
  input: unknown;
  action: string;
}

export type PolicyKind = 'public' | 'authenticated' | 'owner' | 'member' | 'when' | 'deny';

export interface Policy<M extends Model = Model, Auth = RegisteredAuth> {
  readonly kind: PolicyKind;
  /** True when a request without an identity is rejected with 401 before validation. */
  readonly requiresAuth: boolean;
  /** Human-readable form, shown in the review YAML. */
  readonly description: string;
  check(context: PolicyContext<M, Auth>): boolean | Promise<boolean>;
}

/** The membership table and column that holds the identity allowed to access a root row. */
export interface MembershipThrough<M extends Model = Model> {
  readonly model: M;
  readonly member: Column<M>;
}

/** A foreign-key field that must remain in the policy root, or name a root member. */
export type MemberRelated =
  | { readonly via: readonly string[]; readonly member?: never }
  | { readonly member: true; readonly via?: never };

/** The declaration before blend() resolves its relation path to table metadata. */
export interface MemberPolicyOptions<M extends Model = Model> {
  /** Forward belongs-to relation names from this resource to the membership root. */
  readonly via: readonly string[];
  readonly through: MembershipThrough<M>;
  /** Writable foreign-key fields the policy validates before default persistence. */
  readonly related?: Readonly<Record<string, MemberRelated>>;
  /** Identity field compared with through.member. Defaults to id. */
  readonly authKey?: string;
}

/** One resolved hop from a resource table to the next table on a membership path. */
export interface MemberPathHop {
  readonly relation: string;
  readonly column: string;
  readonly key: string;
  readonly table: PgTable;
}

/** The membership table's foreign key to the path root. */
export interface MembershipRoot {
  readonly column: string;
  readonly key: string;
}

/** A related field whose referenced row resolves to the membership root through `path`. */
export interface MemberRelatedPath {
  readonly kind: 'via';
  readonly field: string;
  readonly key: string;
  readonly table: PgTable;
  readonly path: readonly MemberPathHop[];
}

/** A related field whose value must name a member of the resolved root. */
export interface MemberRelatedMember {
  readonly kind: 'member';
  readonly field: string;
}

/** Definition-time metadata used by the mutation validator. */
export type ResolvedMemberRelated = MemberRelatedPath | MemberRelatedMember;

/** A relation-aware policy. blend() fills path, root and membershipRoot before serving it. */
export interface MemberPolicy<M extends Model = Model, Auth = RegisteredAuth>
  extends Policy<M, Auth> {
  readonly kind: 'member';
  readonly via: readonly string[];
  readonly through: MembershipThrough;
  readonly related: Readonly<Record<string, MemberRelated>>;
  readonly authKey: string;
  readonly path?: readonly MemberPathHop[];
  readonly root?: PgTable;
  readonly membershipRoot?: MembershipRoot;
  readonly resolvedRelated?: readonly ResolvedMemberRelated[];
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
  } satisfies Policy<Model, unknown> as Policy<Model, unknown>,

  /** Any authenticated identity. */
  authenticated: {
    kind: 'authenticated',
    requiresAuth: true,
    description: 'authenticated',
    check: ({ auth }) => auth !== null && auth !== undefined,
  } satisfies Policy<Model, unknown> as Policy<Model, unknown>,

  /**
   * The identity owns the record: `record[column]` equals `auth[authKey]`. Actions
   * without a record (index, store, collection actions) are denied; give them their
   * own policy, and scope index queries in `load`.
   */
  owner<M extends Model, Auth = RegisteredAuth>(
    column: Column<M>,
    authKey = 'id',
  ): Policy<M, Auth> {
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

  /**
   * Access through a membership row. blend() resolves via against the resource's generated
   * foreign keys, then the default index and member loads apply its EXISTS predicate (D36).
   */
  member<Through extends Model, Auth = RegisteredAuth>(
    options: MemberPolicyOptions<Through>,
  ): MemberPolicy<Model, Auth> {
    return {
      kind: 'member',
      requiresAuth: true,
      description: `member (via ${options.via.join('.') || 'self'}, through ${options.through.model.name}.${options.through.member} = auth.${options.authKey ?? 'id'})`,
      via: Object.freeze([...options.via]),
      through: Object.freeze({ ...options.through }),
      related: Object.freeze({ ...(options.related ?? {}) }),
      authKey: options.authKey ?? 'id',
      check: ({ auth }) => auth !== null && auth !== undefined,
    } as MemberPolicy<Model, Auth>;
  },

  /** A custom rule. Set `requiresAuth` when the rule cannot pass without an identity. */
  when<M extends Model, Auth = RegisteredAuth>(
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

export const isMemberPolicy = (policy: Policy): policy is MemberPolicy => policy.kind === 'member';
