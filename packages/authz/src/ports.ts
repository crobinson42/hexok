import { Port } from 'hexok';
import type { Grant, PermissionSet } from './entities.js';
import type { GrantWithActions } from './model.js';

export type Membership = {
  readonly orgId: string;
  readonly groups: readonly string[];
};

/** Implemented by the product. It reads memberships from the product's user data. */
export abstract class Principals extends Port('Principals') {
  /** `[]` when the subject is not a member. */
  abstract memberships(
    subject: string,
    orgId?: string,
  ): Promise<readonly Membership[]>;
}

export type GrantQuery = {
  readonly orgId: string;
  readonly subject?: string;
  readonly folder?: string;
};

/** Sets and grants. Implemented by an adapter package. */
export abstract class PolicyStore extends Port('PolicyStore') {
  /** Each grant of these principals joined with its set's actions. */
  abstract grantsFor(
    orgId: string,
    principals: readonly string[],
  ): Promise<readonly GrantWithActions[]>;
  abstract getSet(id: string): Promise<PermissionSet | null>;
  abstract saveSet(set: PermissionSet): Promise<void>;
  abstract deleteSet(id: string): Promise<void>;
  abstract setInUse(id: string): Promise<boolean>;
  abstract getGrant(id: string): Promise<Grant | null>;
  abstract saveGrant(grant: Grant): Promise<void>;
  abstract deleteGrant(id: string): Promise<void>;
  abstract listGrants(query: GrantQuery): Promise<readonly Grant[]>;
}

export type PathDoc = {
  /** Unique within the product, such as `scan:91`. */
  readonly id: string;
  readonly orgId: string;
  /** Every ancestor folder plus the record itself. */
  readonly path: readonly string[];
  /** The ids this record sits under. A move recomputes the path from them. */
  readonly parents: readonly string[];
  /** On a copy only: the value the resource's own `_id` holds. Opaque here. */
  readonly resourceId?: unknown;
};

export type PathUpdate = Pick<PathDoc, 'id' | 'path' | 'parents'>;

/** Paths in one database. Use one instance per database. */
export abstract class PathStore extends Port('PathStore') {
  /** The docs this store holds for `ids`, in any order. */
  abstract get(ids: readonly string[]): Promise<readonly PathDoc[]>;
  /** Every doc whose path contains `id`, including `id` itself. */
  abstract descendants(id: string): Promise<readonly PathDoc[]>;
  /** Upsert by id. A repeat is safe. */
  abstract put(doc: PathDoc): Promise<void>;
  /** Writes `path` and `parents` by id. Ignores ids this store does not hold. */
  abstract update(docs: readonly PathUpdate[]): Promise<void>;
  /** Removes every doc whose path contains `id`. */
  abstract remove(id: string): Promise<void>;
}
