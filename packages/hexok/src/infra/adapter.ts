import type { PortToken } from '../domain/index.js';

/**
 * Typed factory holder. Composition still receives the **impl**, not this object.
 *
 * ```ts
 * const factory = Adapter.of(IncidentRepository, (db: Pool) => new PgIncidentRepo(db))
 * const app = App.from(useCases).provide(IncidentRepository, factory.create(pool))
 * ```
 */
export const Adapter = {
  /**
   * Pair a port token with a factory. Call `create(...deps)` and pass the impl
   * to `App.provide` — not this holder.
   */
  of<I, Deps extends unknown[]>(
    token: PortToken<I>,
    create: (...deps: Deps) => I,
  ): {
    /** Port token for this adapter. Use with `App.provide(token, impl)`. */
    token: PortToken<I>;
    /** Build the adapter impl. Composition receives that value, not the holder. */
    create: (...deps: Deps) => I;
  } {
    return { token, create };
  },
};
