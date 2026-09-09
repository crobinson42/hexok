/**
 * Optional adapter capabilities. Intersect these with a port interface.
 * Missing methods fail at **build** with a sentence, not a Symbol lookup.
 *
 * ```ts
 * class PgIncidentRepo implements IncidentRepository, Transactional<IncidentRepository> {
 *   bindTo(uow: UnitOfWork): IncidentRepository { return this }
 * }
 * ```
 */
export interface UnitOfWork {
  onCommit(fn: () => void | Promise<void>): void;
  onRollback(fn: () => void | Promise<void>): void;
}

export interface Transactional<T = unknown> {
  bindTo(uow: UnitOfWork): T;
}

export interface RequestScoped<T = unknown> {
  fork(): T;
}

/**
 * Standard repository shape. Authors write their own port interface;
 * this is the contract `InMemoryRepository` can fake.
 */
export interface CrudRepository<E> {
  get(id: string): Promise<E | null>;
  save(entity: E): Promise<void>;
  list?(): Promise<E[]>;
  delete?(id: string): Promise<void>;
}
