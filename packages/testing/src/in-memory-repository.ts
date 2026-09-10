import type {
  CrudRepository,
  Entity,
  EntityConstructor,
  PortToken,
} from '@plinth/domain';

type CrudKeys = 'get' | 'save' | 'list' | 'delete';

type ExtraKeys<I> = Exclude<keyof I, CrudKeys | 'bindTo' | 'fork'>;

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
  ? ExtraKeys<I> extends never
    ? I
    : `plinth: InMemoryRepository cannot fake extra methods; write a custom fake`
  : `plinth: InMemoryRepository.of expects a CRUD repository port`;

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

  static of<I>(
    _token: [AssertCrud<I>] extends [I] ? PortToken<I> : AssertCrud<I>,
    options: {
      keyBy: EntityKey<RepoEntity<I>>;
      seed?: RepoEntity<I>[];
    },
  ): I {
    const repo = new InMemoryRepository(
      options.keyBy,
      (options.seed ?? []) as Entity<Record<string, unknown>>[],
    );
    return repo as unknown as I;
  }

  async get(id: string): Promise<E | null> {
    const found = this.#store.get(id);
    return found ? cloneEntity(found) : null;
  }

  async save(entity: E): Promise<void> {
    this.#store.set(this.keyOf(entity), cloneEntity(entity));
  }

  async list(): Promise<E[]> {
    return [...this.#store.values()].map((entity) => cloneEntity(entity));
  }

  async delete(id: string): Promise<void> {
    this.#store.delete(id);
  }

  private keyOf(entity: E): string {
    const props = entity.toProps() as Record<string, unknown>;
    const key = props[this.#keyBy];
    if (typeof key !== 'string') {
      throw new Error(
        `plinth: InMemoryRepository keyBy "${this.#keyBy}" is not a string`,
      );
    }
    return key;
  }
}

function cloneEntity<E extends Entity<Record<string, unknown>>>(entity: E): E {
  const Ctor = entity.constructor as EntityConstructor & {
    restore(props: unknown): E;
  };
  return Ctor.restore(entity.toProps());
}
