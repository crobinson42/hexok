/**
 * A port is a TypeScript interface plus a token used at compose time.
 *
 * ```ts
 * export interface IncidentRepository {
 *   get(id: string): Promise<Incident | null>
 *   save(incident: Incident): Promise<void>
 * }
 * export const IncidentRepository = Port.token<IncidentRepository>('IncidentRepository')
 * ```
 */
declare const portType: unique symbol;

export class PortToken<out I, Name extends string = string> {
  readonly name: Name;
  declare readonly [portType]: I;

  private constructor(name: Name) {
    this.name = name;
    Object.freeze(this);
  }

  static token<I>(name: string): PortToken<I> {
    return new PortToken<I, string>(name);
  }
}

export const Port = {
  token: PortToken.token,
};

export type PortType<T> = T extends PortToken<infer I, string> ? I : never;
