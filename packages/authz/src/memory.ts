import { Adapter } from 'hexok';
import { Grant, type GrantProps, PermissionSet } from './entities.js';
import type { AccessFilter } from './model.js';
import { type GrantWithActions, type Located, matches } from './model.js';
import {
  type GrantQuery,
  type PathDoc,
  PathStore,
  type PathUpdate,
  PolicyStore,
} from './ports.js';

/** Sets and grants in a `Map`. For tests and sketches. */
export class MemoryPolicyStore extends Adapter(PolicyStore) {
  private readonly sets = new Map<
    string,
    ReturnType<PermissionSet['toProps']>
  >();
  private readonly grants = new Map<string, ReturnType<Grant['toProps']>>();

  override async grantsFor(
    orgId: string,
    principals: readonly string[],
  ): Promise<readonly GrantWithActions[]> {
    const rows: GrantWithActions[] = [];
    for (const grant of this.grants.values()) {
      if (grant.orgId !== orgId || !principals.includes(grant.subject))
        continue;
      const set = this.sets.get(grant.setId);
      if (set === undefined) continue;
      rows.push({
        id: grant.id,
        effect: grant.effect,
        folders: grant.folders,
        actions: set.actions,
        allActions: set.allActions,
      });
    }
    return rows;
  }

  override async getSet(id: string): Promise<PermissionSet | null> {
    const props = this.sets.get(id);
    return props === undefined
      ? null
      : PermissionSet.restore(props as PermissionSet['props']);
  }

  override async saveSet(set: PermissionSet): Promise<void> {
    this.sets.set(set.props.id, set.toProps());
    set.commit();
  }

  override async deleteSet(id: string): Promise<void> {
    this.sets.delete(id);
  }

  override async setInUse(id: string): Promise<boolean> {
    return [...this.grants.values()].some((grant) => grant.setId === id);
  }

  override async getGrant(id: string): Promise<Grant | null> {
    const props = this.grants.get(id);
    return props === undefined ? null : Grant.restore(props as GrantProps);
  }

  override async saveGrant(grant: Grant): Promise<void> {
    this.grants.set(grant.props.id, grant.toProps());
    grant.commit();
  }

  override async deleteGrant(id: string): Promise<void> {
    this.grants.delete(id);
  }

  override async listGrants(query: GrantQuery): Promise<readonly Grant[]> {
    return [...this.grants.values()]
      .filter(
        (grant) =>
          grant.orgId === query.orgId &&
          (query.subject === undefined || grant.subject === query.subject) &&
          (query.folder === undefined || grant.folders.includes(query.folder)),
      )
      .map((grant) => Grant.restore(grant as GrantProps));
  }
}

/** Paths in a `Map`. For tests and sketches. */
export class MemoryPathStore extends Adapter(PathStore) {
  private readonly docs = new Map<string, PathDoc>();

  /** Every stored doc. Pass them to {@link memoryFilter}. */
  all(): readonly PathDoc[] {
    return [...this.docs.values()];
  }

  override async get(ids: readonly string[]): Promise<readonly PathDoc[]> {
    return ids.flatMap((id) => this.docs.get(id) ?? []);
  }

  override async descendants(id: string): Promise<readonly PathDoc[]> {
    return this.all().filter((doc) => doc.path.includes(id));
  }

  override async put(doc: PathDoc): Promise<void> {
    if (doc.resourceId !== undefined) {
      for (const other of this.docs.values()) {
        if (other.id !== doc.id && other.resourceId === doc.resourceId) {
          throw new Error(`duplicate resourceId for ${doc.id}`);
        }
      }
    }
    this.docs.set(doc.id, doc);
  }

  override async update(docs: readonly PathUpdate[]): Promise<void> {
    for (const { id, path, parents } of docs) {
      const doc = this.docs.get(id);
      if (doc !== undefined) this.docs.set(id, { ...doc, path, parents });
    }
  }

  override async remove(id: string): Promise<void> {
    for (const doc of await this.descendants(id)) this.docs.delete(doc.id);
  }
}

/** The documents `filter` admits. The in-memory counterpart of a repository query. */
export function memoryFilter<T extends Located>(
  docs: readonly T[],
  filter: AccessFilter,
): readonly T[] {
  return docs.filter((doc) => matches(filter, doc));
}
