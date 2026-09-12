declare const portType: unique symbol;

/**
 * A port is a TypeScript interface plus a token used at compose time.
 *
 * ```ts
 * export interface IncidentRepository {
 *   get(id: string): Promise<Incident | null>
 *   save(incident: Incident): Promise<void>
 * }
 * export const IncidentRepository = Port.token<IncidentRepository>(
 *   'IncidentRepository',
 * )
 * ```
 *
 * `.build()` names a missing port by its use-case alias
 * (`ports: { incidents: IncidentRepository }` → `"incidents"`).
 */
export class PortToken<out I> {
  /** Name used in runtime provide/completeness errors. */
  readonly key: string;
  declare readonly [portType]: I;

  private constructor(key: string) {
    this.key = key;
    Object.freeze(this);
  }

  /** Create a token for interface `I`. Prefer `Port.token<I>('Name')` at call sites. */
  static token<I>(key: string): PortToken<I> {
    return new PortToken<I>(key);
  }
}

/** `Port.token<I>('Name')` — the usual way to create a `PortToken`. */
export const Port: { token: typeof PortToken.token } = {
  token: PortToken.token,
};

/** Interface stored on a `PortToken`. */
export type PortType<T> = T extends PortToken<infer I> ? I : never;
