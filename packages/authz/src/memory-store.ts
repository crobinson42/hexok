import { assertTuple } from './refs.js';
import type { Tuple, TupleReader, TupleStore } from './types.js';

/**
 * In-process tuple set for tests and local development.
 * `read` answers from this process. A later adapter loads its own view in `reader()`.
 */
export class MemoryTupleStore implements TupleStore, TupleReader {
  readonly #tuples = new Map<string, Tuple>();
  readonly #keysByObject = new Map<string, Set<string>>();
  readonly #keysByObjectRelation = new Map<string, Set<string>>();
  readonly #idsByType = new Map<string, Set<string>>();
  readonly #objectCounts = new Map<string, number>();

  async write(tuples: readonly Tuple[]): Promise<void> {
    const copies = tuples.map((tuple) => assertTuple(tuple));
    for (const tuple of copies) this.#add(tuple);
  }

  async delete(tuples: readonly Tuple[]): Promise<void> {
    const copies = tuples.map((tuple) => assertTuple(tuple));
    for (const tuple of copies) this.#remove(tuple);
  }

  async reader(): Promise<TupleReader> {
    return this;
  }

  read(object: string, relation?: string): readonly Tuple[] {
    const keys =
      relation === undefined
        ? this.#keysByObject.get(object)
        : this.#keysByObjectRelation.get(bucket(object, relation));
    if (!keys) return [];
    const tuples: Tuple[] = [];
    for (const key of keys) {
      const tuple = this.#tuples.get(key);
      if (tuple) tuples.push(tuple);
    }
    return tuples;
  }

  idsOfType(type: string): readonly string[] {
    const ids = this.#idsByType.get(type);
    if (!ids) return [];
    return [...ids];
  }

  #add(tuple: Tuple): void {
    const key = tupleKey(tuple);
    if (this.#tuples.has(key)) return;
    this.#tuples.set(key, tuple);
    addKey(this.#keysByObject, tuple.object, key);
    addKey(
      this.#keysByObjectRelation,
      bucket(tuple.object, tuple.relation),
      key,
    );
    const parsed = objectParts(tuple.object);
    let ids = this.#idsByType.get(parsed.type);
    if (!ids) {
      ids = new Set();
      this.#idsByType.set(parsed.type, ids);
    }
    ids.add(parsed.id);
    this.#objectCounts.set(
      tuple.object,
      (this.#objectCounts.get(tuple.object) ?? 0) + 1,
    );
  }

  #remove(tuple: Tuple): void {
    const key = tupleKey(tuple);
    if (!this.#tuples.has(key)) return;
    this.#tuples.delete(key);
    removeKey(this.#keysByObject, tuple.object, key);
    removeKey(
      this.#keysByObjectRelation,
      bucket(tuple.object, tuple.relation),
      key,
    );
    const count = (this.#objectCounts.get(tuple.object) ?? 1) - 1;
    if (count > 0) {
      this.#objectCounts.set(tuple.object, count);
      return;
    }
    this.#objectCounts.delete(tuple.object);
    const parsed = objectParts(tuple.object);
    const ids = this.#idsByType.get(parsed.type);
    ids?.delete(parsed.id);
    if (ids && ids.size === 0) this.#idsByType.delete(parsed.type);
  }
}

function tupleKey(tuple: Tuple): string {
  return `${tuple.object}\0${tuple.relation}\0${tuple.subject}`;
}

function bucket(object: string, relation: string): string {
  return `${object}\0${relation}`;
}

function objectParts(object: string): { type: string; id: string } {
  const colon = object.indexOf(':');
  return { type: object.slice(0, colon), id: object.slice(colon + 1) };
}

function addKey(
  index: Map<string, Set<string>>,
  name: string,
  key: string,
): void {
  let keys = index.get(name);
  if (!keys) {
    keys = new Set();
    index.set(name, keys);
  }
  keys.add(key);
}

function removeKey(
  index: Map<string, Set<string>>,
  name: string,
  key: string,
): void {
  const keys = index.get(name);
  if (!keys) return;
  keys.delete(key);
  if (keys.size === 0) index.delete(name);
}
