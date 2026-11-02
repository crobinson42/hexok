import { EventHandler } from 'hexok';
import { AuthzError } from './errors.js';
import { unionPaths } from './model.js';
import type { PathDoc, PathStore } from './ports.js';

type EventClass = Parameters<typeof EventHandler>[1];

type PayloadOf<E> = E extends new (
  // biome-ignore lint/suspicious/noExplicitAny: event constructors take a payload whose type varies per event
  ...args: any[]
) => { readonly payload: infer Payload }
  ? Payload
  : never;

/** A record's id and what it sits under. No parent makes it a tenant root. */
export type Placement = (
  | { readonly id: string; readonly parent?: string; readonly parents?: never }
  | {
      readonly id: string;
      readonly parents: readonly string[];
      readonly parent?: never;
    }
) & {
  /** The value the resource's own `_id` holds, such as an ObjectId. Defaults to `id`. */
  readonly resourceId?: unknown;
};

/** A record's id and where it goes. */
export type Move =
  | { readonly id: string; readonly parent: string; readonly parents?: never }
  | {
      readonly id: string;
      readonly parents: readonly string[];
      readonly parent?: never;
    };

/** A constructed event handler. Subscribe it like any other. */
export type PathHandler<E extends EventClass = EventClass> = {
  readonly token: string;
  readonly event: E;
  handle(event: never): Promise<void>;
};

function parentsOf(target: {
  readonly parent?: string;
  readonly parents?: readonly string[];
}): readonly string[] {
  if (target.parents !== undefined) return target.parents;
  return target.parent !== undefined ? [target.parent] : [];
}

function pathHandler<E extends EventClass>(
  verb: string,
  event: E,
  work: (payload: PayloadOf<E>) => Promise<void>,
): PathHandler<E> {
  class Handler extends EventHandler(
    `authz.paths.${verb}.${event.token}`,
    event,
  ) {
    async handle(instance: never): Promise<void> {
      await work((instance as { payload: PayloadOf<E> }).payload);
    }
  }
  return new Handler() as unknown as PathHandler<E>;
}

/**
 * Keeps paths current. Central is the source of truth. Each copy holds the
 * paths of the records stored in its database.
 */
export class Paths<Copies extends Record<string, PathStore>> {
  constructor(private readonly deps: { central: PathStore; copies: Copies }) {}

  /**
   * Writes central, then the named copy. A record already in central keeps its
   * path, so a redelivered event cannot undo a move. It throws
   * `ParentNotPlaced` while a parent has no path, so a queue retries.
   */
  async place(target: Placement, copy?: keyof Copies & string): Promise<void> {
    const { central, copies } = this.deps;
    const [existing] = await central.get([target.id]);
    const doc = existing ?? (await this.compute(target));
    if (existing === undefined) await central.put(doc);
    if (copy !== undefined) {
      await copies[copy]?.put({
        ...doc,
        resourceId: target.resourceId ?? target.id,
      });
    }
  }

  /**
   * Recomputes the subtree from each record's parents, then writes central and
   * every copy. A retry computes the same result. Resource documents are not
   * touched.
   */
  async move(target: Move): Promise<void> {
    const { central, copies } = this.deps;
    const parents = parentsOf(target);
    const subtree = new Map(
      (await central.descendants(target.id)).map((doc) => [doc.id, doc]),
    );
    const moved = subtree.get(target.id);
    if (moved === undefined) {
      throw AuthzError.ParentNotPlaced({ id: target.id });
    }
    if (parents.length === 0 || parents.some((id) => subtree.has(id))) {
      throw AuthzError.InvalidPath({ id: target.id });
    }

    const parentsById = (doc: PathDoc) =>
      doc.id === target.id ? parents : doc.parents;
    const outside = [
      ...new Set([...subtree.values()].flatMap(parentsById)),
    ].filter((id) => !subtree.has(id));
    const outsideDocs = await central.get(outside);
    for (const id of outside) {
      if (!outsideDocs.some((doc) => doc.id === id)) {
        throw AuthzError.ParentNotPlaced({ id });
      }
    }
    const newParentDocs = outsideDocs.filter((doc) => parents.includes(doc.id));
    if (newParentDocs.some((doc) => doc.orgId !== moved.orgId)) {
      throw AuthzError.InvalidPath({ id: target.id });
    }

    const computed = new Map(outsideDocs.map((doc) => [doc.id, doc.path]));
    const pathOf = (id: string): readonly string[] => {
      const known = computed.get(id);
      if (known !== undefined) return known;
      const doc = subtree.get(id) as PathDoc;
      const path = unionPaths([...parentsById(doc).map(pathOf), [id]]);
      computed.set(id, path);
      return path;
    };
    const updates = [...subtree.values()].map((doc) => ({
      id: doc.id,
      path: pathOf(doc.id),
      parents: parentsById(doc),
    }));

    await central.update(updates);
    await Promise.all(
      Object.values(copies).map((store) => store.update(updates)),
    );
  }

  /** Removes the record and everything under it, in central and every copy. */
  async remove(id: string): Promise<void> {
    const { central, copies } = this.deps;
    await central.remove(id);
    await Promise.all(Object.values(copies).map((store) => store.remove(id)));
  }

  /** A handler that places a record when `event` arrives. */
  placeOn<E extends EventClass>(
    event: E,
    select: (payload: PayloadOf<E>) => Placement,
    copy?: keyof Copies & string,
  ): PathHandler<E> {
    return pathHandler('place', event, (payload) =>
      this.place(select(payload), copy),
    );
  }

  /** A handler that moves a record and its subtree when `event` arrives. */
  moveOn<E extends EventClass>(
    event: E,
    select: (payload: PayloadOf<E>) => Move,
  ): PathHandler<E> {
    return pathHandler('move', event, (payload) => this.move(select(payload)));
  }

  /** A handler that removes a record and its subtree when `event` arrives. */
  removeOn<E extends EventClass>(
    event: E,
    select: (payload: PayloadOf<E>) => string,
  ): PathHandler<E> {
    return pathHandler('remove', event, (payload) =>
      this.remove(select(payload)),
    );
  }

  /** The handlers the application subscribes. */
  handlers(list: readonly PathHandler[]): readonly PathHandler[] {
    return list;
  }

  /** The new doc: the union of the parents' central paths, plus the id. */
  private async compute(target: Placement): Promise<PathDoc> {
    const parents = parentsOf(target);
    if (parents.includes(target.id)) {
      throw AuthzError.InvalidPath({ id: target.id });
    }
    if (parents.length === 0) {
      return { id: target.id, orgId: target.id, path: [target.id], parents };
    }
    const found = await this.deps.central.get(parents);
    const docs = parents.map((id) => {
      const doc = found.find((candidate) => candidate.id === id);
      if (doc === undefined) throw AuthzError.ParentNotPlaced({ id });
      return doc;
    });
    const orgId = (docs[0] as PathDoc).orgId;
    if (docs.some((doc) => doc.orgId !== orgId)) {
      throw AuthzError.InvalidPath({ id: target.id });
    }
    return {
      id: target.id,
      orgId,
      path: unionPaths([...docs.map((doc) => doc.path), [target.id]]),
      parents,
    };
  }
}
