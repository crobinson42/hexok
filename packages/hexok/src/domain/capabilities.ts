/**
 * Optional adapter capabilities. Intersect these with a port interface.
 * Pass `{ transactional: true }` / `{ requestScoped: true }` to `Port.token`
 * so `provide()` throws if the impl is missing `bindTo` / `fork`.
 *
 * ```ts
 * class PgIncidentRepo implements IncidentRepository, Transactional<IncidentRepository> {
 *   bindTo(uow: UnitOfWork): IncidentRepository { return this }
 * }
 * ```
 */
export interface UnitOfWork {
  /** Register work to run after a successful commit. */
  onCommit(fn: () => void | Promise<void>): void;
  /** Register work to run after a rollback. */
  onRollback(fn: () => void | Promise<void>): void;
}

/** Port capability: the adapter can bind itself to a unit of work. */
export interface Transactional<T = unknown> {
  /** Return this port bound to `uow` (often `return this`). */
  bindTo(uow: UnitOfWork): T;
}

/** Port capability: the adapter can fork a request-scoped instance. */
export interface RequestScoped<T = unknown> {
  /** Return a new instance scoped to the current request. */
  fork(): T;
}

/**
 * Standard repository shape. Authors write their own port interface;
 * this is the contract `InMemoryRepository` can fake.
 */
export interface CrudRepository<E> {
  /** Load one entity by id, or `null` if missing. */
  get(id: string): Promise<E | null>;
  /** Persist an entity. Adapters call `entity.commit()` after a successful write. */
  save(entity: E): Promise<void>;
  /** List all entities. Optional on the port. */
  list?(): Promise<E[]>;
  /** Delete by id. Optional on the port. */
  delete?(id: string): Promise<void>;
}
