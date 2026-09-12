import type {
  CrudRepository,
  Entity,
  EntityConstructor,
  PortToken,
} from '../domain/index.js';

type CrudKeys = 'get' | 'save' | 'list' | 'delete';

type ExtraKeys<I> = Exclude<keyof I, CrudKeys | 'bindTo' | 'fork'>;

type ExtraOption<I> = [ExtraKeys<I>] extends [never]
  ? unknown
  : { extra: Pick<I, ExtraKeys<I>> };

type RepoEntity<I> = I extends {
  get: (id: string) => Promise<infer E>;
}
  ? NonNullable<E>
  : Entity<Record<string, unknown>>;

type EntityKey<E> = E extends { toProps(): infer P }
  ? P extends object
    ? keyof P & string
    : string
  : string;

type AssertCrud<I> = 'get' | 'save' extends keyof I
  ? I
  : `hexok: InMemoryRepository.of expects a CRUD repository port`;

/**
 * In-memory fake for the standard CRUD port `{ get, save, list, delete }`.
 * Clones on get/save so tests do not mutate the store by accident.
 *
 * ```ts
 * .provide(IncidentRepository, InMemoryRepository.of(IncidentRepository, {
 *   keyBy: 'id',
 *   seed: [Incident.open('1')],
 * }))
 * ```
 */
export class InMemoryRepository<E extends Entity<Record<string, unknown>>>
  implements CrudRepository<E>
{
  readonly #keyBy: string;
  readonly #store = new Map<string, E>();

  private constructor(keyBy: string, seed: E[]) {
    this.#keyBy = keyBy;
    for (const entity of seed) {
      this.#store.set(this.keyOf(entity), cloneEntity(entity));
    }
  }

  /** Fake a CRUD port. Extra methods beyond get/save/list/delete go in `extra`. */
  static of<I>(
    _token: [AssertCrud<I>] extends [I] ? PortToken<I> : AssertCrud<I>,
    options: {
      keyBy: EntityKey<RepoEntity<I>>;
      seed?: RepoEntity<I>[];
    } & ExtraOption<I>,
  ): I {
    const repo = new InMemoryRepository(
      options.keyBy,
      (options.seed ?? []) as Entity<Record<string, unknown>>[],
    );
    if ('extra' in options && options.extra !== undefined) {
      return Object.assign(repo, options.extra) as unknown as I;
    }
    return repo as unknown as I;
  }

  /** Clone of the stored entity, or `null`. */
  async get(id: string): Promise<E | null> {
    const found = this.#store.get(id);
    return found ? cloneEntity(found) : null;
  }

  /** Clone into the store and `commit()` the working entity. */
  async save(entity: E): Promise<void> {
    this.#store.set(this.keyOf(entity), cloneEntity(entity));
    entity.commit();
  }

  /** Clones of every stored entity. */
  async list(): Promise<E[]> {
    return [...this.#store.values()].map((entity) => cloneEntity(entity));
  }

  /** Remove by id. No-op if missing. */
  async delete(id: string): Promise<void> {
    this.#store.delete(id);
  }

  private keyOf(entity: E): string {
    const props = entity.toProps() as Record<string, unknown>;
    const key = props[this.#keyBy];
    if (typeof key !== 'string') {
      throw new Error(
        `hexok: InMemoryRepository keyBy "${this.#keyBy}" is not a string`,
      );
    }
    return key;
  }
}

function cloneEntity<E extends Entity<Record<string, unknown>>>(entity: E): E {
  const Ctor = entity.constructor as unknown as EntityConstructor & {
    restore(props: unknown): E;
  };
  return Ctor.restore(entity.toProps());
}
