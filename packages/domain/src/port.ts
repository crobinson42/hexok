/**
 * A port is a TypeScript interface plus a token used at compose time.
 *
 * ```ts
 * export interface IncidentRepository {
 *   get(id: string): Promise<Incident | null>
 *   save(incident: Incident): Promise<void>
 * }
 * export const IncidentRepository = Port.token<IncidentRepository>()(
 *   'IncidentRepository',
 * )
 * ```
 *
 * `Port.token<I>()(key)` infers a literal `Key`.
 * `Port.token<I, 'Key'>('Key')` is equivalent.
 * `Port.token<I>(key)` widens `Key` to `string`; `.build()` then uses the
 * ports alias.
 */
declare const portType: unique symbol;

export class PortToken<out I, out Key extends string = string> {
  readonly key: Key;
  declare readonly [portType]: I;

  private constructor(key: Key) {
    this.key = key;
    Object.freeze(this);
  }

  /**
   * Zero-arg form binds `I`; the returned function infers a literal `Key`.
   * One-arg `Port.token<Clock>('Clock')` widens `Key` to `string` (TypeScript
   * does not infer a later type parameter when an earlier one is specified).
   * `Port.token<Clock, 'Clock'>('Clock')` keeps the literal without currying.
   */
  static token<I>(): <const Key extends string>(key: Key) => PortToken<I, Key>;
  static token<I, const Key extends string = string>(
    key: Key,
  ): PortToken<I, Key>;
  static token<I, Key extends string>(
    key?: Key,
  ): PortToken<I, Key> | (<K extends string>(key: K) => PortToken<I, K>) {
    if (key === undefined) {
      return <K extends string>(k: K) => new PortToken<I, K>(k);
    }
    return new PortToken<I, Key>(key);
  }
}

export const Port: { token: typeof PortToken.token } = {
  token: PortToken.token,
};

export type PortType<T> = T extends PortToken<infer I, infer _Key> ? I : never;
