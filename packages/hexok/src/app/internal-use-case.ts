import { CallableUseCase } from './callable-use-case.js';

/**
 * Composition-only request/response use case. Same execute shape as
 * ExternalUseCase. Omitted from `deriveContract`, `app.contract`, `app.local`,
 * and HTTP. Still in completeness. Invocable via `ctx.run`.
 *
 * ```ts
 * class CreateUser extends InternalUseCase {
 *   static readonly key = 'user.create'
 *   static readonly input = z.object({ id: z.string(), name: z.string() })
 *   static readonly output = z.object({ id: z.string() })
 *   static readonly errors = { USER_EXISTS: { message: 'User already exists' } } as const
 *   static readonly ports = { users: UserRepository }
 *   async execute({ input, ports, errors }: ExecuteCtx<typeof CreateUser>) {
 *     if (await ports.users.getUser(input.id)) throw errors.USER_EXISTS()
 *     await ports.users.saveUser(input)
 *     return { id: input.id }
 *   }
 * }
 * ```
 */
export abstract class InternalUseCase extends CallableUseCase {
  /** Discriminator for `App.from` / `isInternalUseCase`. Do not override. */
  static readonly trigger = 'internal' as const;
}
