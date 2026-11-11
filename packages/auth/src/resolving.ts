import { Adapter, type Result } from 'hexok';
import { Authenticator } from './authenticator.js';

/**
 * Turns a proven identity into the app's actor, or a refusal the app names,
 * such as `unknown` for a subject with no account or `forbidden` for a
 * service token on a user route. A throw is an infrastructure failure.
 */
export type Resolve<I, A, R extends string> = (
  identity: I,
) => Promise<Result<A, R>>;

class ResolvingAuthenticator<
  I,
  A,
  E extends string,
  R extends string,
> extends Adapter(Authenticator)<A, E | R> {
  readonly #authenticator: Authenticator<I, E>;
  readonly #resolve: Resolve<I, A, R>;

  constructor(authenticator: Authenticator<I, E>, resolve: Resolve<I, A, R>) {
    super();
    this.#authenticator = authenticator;
    this.#resolve = resolve;
  }

  override async authenticate(
    credential: string | undefined,
  ): Promise<Result<A, E | R>> {
    const found = await this.#authenticator.authenticate(credential);
    if (!found.ok) return found;
    return this.#resolve(found.value);
  }
}

/**
 * The seam between proving a credential and knowing the caller. The result is
 * an `Authenticator` of the app's actor `A`. Its refusals are the
 * authenticator's and the resolver's. A refusal from the authenticator skips
 * the resolver.
 *
 * ```ts
 * const auth = resolving(sessions, async (identity) => {
 *   const user = await users.bySubject(identity.subject)
 *   return user === undefined ? fail('unknown') : ok({ userId: user.id })
 * })
 * ```
 */
export function resolving<I, A, E extends string, R extends string>(
  authenticator: Authenticator<I, E>,
  resolve: Resolve<I, A, R>,
): Authenticator<A, E | R> {
  return new ResolvingAuthenticator(authenticator, resolve);
}
