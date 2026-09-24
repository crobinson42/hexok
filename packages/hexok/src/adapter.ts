/**
 * Implementation of a port. Missing port methods are errors on the class.
 * `start` and `stop` are optional overrides. The token is the port's token.
 *
 * ```ts
 * class InMemoryUsers extends Adapter(UserRepository) {
 *   override async get(id: string): Promise<User | null> { ... }
 *   override async save(user: User): Promise<void> { ... }
 * }
 * ```
 */
export function Adapter<
  P extends abstract new (
    // biome-ignore lint/suspicious/noExplicitAny: mixin construct signatures are rest parameters
    ...args: any[]
  ) => object,
>(PortClass: P) {
  abstract class AdapterClass extends PortClass {
    /** Called by the application before the adapter is used. Override to connect. */
    async start(): Promise<void> {}

    /** Called by the application when it is finished with the adapter. Override to disconnect. */
    async stop(): Promise<void> {}
  }

  return AdapterClass;
}
