import type { Db } from './hooks.ts';

export interface DataMigration {
  readonly kind: 'blendx/data-migration';
  readonly id: string;
  readonly up: (context: { readonly tx: Db }) => void | Promise<void>;
}

const ID = /^[0-9]{8,}_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Declares one immutable, versioned application data migration (D38). */
export function dataMigration(definition: Omit<DataMigration, 'kind'>): DataMigration {
  if (!ID.test(definition.id)) {
    throw new Error('data migration id must be a versioned lower_snake_case string');
  }
  if (typeof definition.up !== 'function')
    throw new Error(`data migration ${definition.id} needs an up function`);
  return Object.freeze({
    kind: 'blendx/data-migration' as const,
    id: definition.id,
    up: definition.up,
  });
}
