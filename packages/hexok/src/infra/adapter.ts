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
  of<I, Deps extends unknown[]>(
    token: PortToken<I>,
    create: (...deps: Deps) => I,
  ): { token: PortToken<I>; create: (...deps: Deps) => I } {
    return { token, create };
  },
};
