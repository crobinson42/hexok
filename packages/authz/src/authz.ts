import {
  assertResourceType,
  assertTupleAllowed,
  type Catalog,
  type CatalogAction,
  type CatalogObject,
  type CompiledCatalog,
  compileCatalog,
  permissionFor,
} from './catalog.js';
import { AuthzError } from './errors.js';
import { evaluate } from './evaluator.js';
import { assertTuple, formatObject, resolveActor } from './refs.js';
import type { Actor, Explanation, Tuple, TupleStore } from './types.js';

type ActionObject<A extends string> = A extends `${infer Type}:${string}`
  ? Type
  : never;

type ResourceQuery<C, A extends string> = {
  readonly actor: Actor;
  readonly action: A;
  readonly resource: {
    readonly type: ActionObject<A> & CatalogObject<C>;
    readonly id: string;
  };
};

/**
 * Answers "can this actor perform this action on this resource?"
 * and "which resources of this type allow it?" from relationship tuples.
 */
export class Authz<C> {
  readonly #compiled: CompiledCatalog;
  readonly #store: TupleStore;

  constructor(catalog: C & Catalog, store: TupleStore) {
    this.#compiled = compileCatalog(catalog);
    this.#store = store;
  }

  async write(input: Tuple | readonly Tuple[]): Promise<void> {
    const tuples = normalize(input).map((tuple) => {
      const copy = assertTuple(tuple);
      assertTupleAllowed(this.#compiled, copy);
      return copy;
    });
    if (tuples.length === 0) return;
    await this.#store.write(tuples);
  }

  async delete(input: Tuple | readonly Tuple[]): Promise<void> {
    const tuples = normalize(input).map((tuple) => assertTuple(tuple));
    if (tuples.length === 0) return;
    await this.#store.delete(tuples);
  }

  async check<A extends CatalogAction<C>>(
    input: ResourceQuery<C, A>,
  ): Promise<boolean> {
    const explanation = await this.#explain(
      input.actor,
      input.action,
      input.resource,
    );
    return explanation.allowed;
  }

  async list<A extends CatalogAction<C>>(input: {
    readonly actor: Actor;
    readonly action: A;
    readonly type: ActionObject<A> & CatalogObject<C>;
  }): Promise<string[]> {
    const action = assertAction(input.action);
    const type = assertType(input.type);
    const permission = permissionFor(this.#compiled, action);
    assertResourceType(permission, action, type);
    const actor = resolveActor(input.actor, this.#compiled.objectTypes);
    const reader = await this.#store.reader();
    const visible: string[] = [];
    for (const id of reader.idsOfType(type)) {
      const explanation = evaluate({
        compiled: this.#compiled,
        reader,
        actor,
        action,
        resource: formatObject(type, id),
      });
      if (explanation.allowed) visible.push(id);
    }
    visible.sort();
    return visible;
  }

  /** The first granting path. An empty `steps` array means deny. */
  async explain<A extends CatalogAction<C>>(
    input: ResourceQuery<C, A>,
  ): Promise<Explanation> {
    return this.#explain(input.actor, input.action, input.resource);
  }

  async #explain(
    actorInput: Actor,
    actionInput: string,
    resource: { readonly type: string; readonly id: string },
  ): Promise<Explanation> {
    const action = assertAction(actionInput);
    const resourceType = assertType(resource.type);
    if (typeof resource.id !== 'string') {
      throw new AuthzError('authz: resource needs a type and an id.');
    }
    const permission = permissionFor(this.#compiled, action);
    assertResourceType(permission, action, resourceType);
    const actor = resolveActor(actorInput, this.#compiled.objectTypes);
    const reader = await this.#store.reader();
    return evaluate({
      compiled: this.#compiled,
      reader,
      actor,
      action,
      resource: formatObject(resourceType, resource.id),
    });
  }
}

function normalize(input: Tuple | readonly Tuple[]): readonly Tuple[] {
  if (isTupleList(input)) return input;
  return [input];
}

function isTupleList(
  input: Tuple | readonly Tuple[],
): input is readonly Tuple[] {
  return Array.isArray(input);
}

function assertAction(action: string): string {
  if (typeof action !== 'string') {
    throw new AuthzError('authz: action must be a string.');
  }
  return action;
}

function assertType(type: string): string {
  if (typeof type !== 'string') {
    throw new AuthzError('authz: resource needs a type and an id.');
  }
  return type;
}
