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
declare const portType: unique symbol;

export class PortToken<out I> {
  readonly key: string;
  declare readonly [portType]: I;

  private constructor(key: string) {
    this.key = key;
    Object.freeze(this);
  }

  static token<I>(key: string): PortToken<I> {
    return new PortToken<I>(key);
  }
}

export const Port: { token: typeof PortToken.token } = {
  token: PortToken.token,
};

export type PortType<T> = T extends PortToken<infer I> ? I : never;
