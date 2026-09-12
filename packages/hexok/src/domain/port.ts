declare const portType: unique symbol;

/** Runtime flags checked by `App.provide`. Type the port with `Transactional` / `RequestScoped` as well. */
export type PortCapabilities = {
  transactional?: boolean;
  requestScoped?: boolean;
};

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
 * Pass `{ transactional: true }` / `{ requestScoped: true }` so `provide`
 * throws if the impl is missing `bindTo` / `fork`.
 */
export class PortToken<out I> {
  /** Name used in runtime provide/completeness errors. */
  readonly key: string;
  /** Runtime capability flags. `provide()` checks `bindTo` / `fork` when set. */
  readonly capabilities: {
    readonly transactional: boolean;
    readonly requestScoped: boolean;
  };
  declare readonly [portType]: I;

  private constructor(key: string, capabilities?: PortCapabilities) {
    this.key = key;
    this.capabilities = Object.freeze({
      transactional: capabilities?.transactional === true,
      requestScoped: capabilities?.requestScoped === true,
    });
    Object.freeze(this);
  }

  /** Create a token for interface `I`. Prefer `Port.token<I>('Name')` at call sites. */
  static token<I>(key: string, capabilities?: PortCapabilities): PortToken<I> {
    return new PortToken<I>(key, capabilities);
  }
}

/** `Port.token<I>('Name')` — the usual way to create a `PortToken`. */
export const Port: { token: typeof PortToken.token } = {
  token: PortToken.token,
};

/** Interface stored on a `PortToken`. */
export type PortType<T> = T extends PortToken<infer I> ? I : never;
