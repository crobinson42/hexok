/**
 * A port is the contract an adapter implements.
 * Extend the returned class and declare the abstract methods of the seam.
 * Each call has its own private brand, so a structural lookalike is not a port.
 *
 * ```ts
 * abstract class UserRepository extends Port('UserRepository') {
 *   abstract get(id: string): Promise<User | null>
 *   abstract save(user: User): Promise<void>
 * }
 * ```
 */
export function Port<const Token extends string>(token: Token) {
  abstract class PortClass {
    /** Port name. Literal type of the string passed to {@link Port}. */
    static readonly token: Token = token;
    /** Nominal marker. Each `Port(...)` call is a distinct class. */
    readonly #brand = true;

    constructor() {
      void this.#brand;
    }
  }

  return PortClass;
}
