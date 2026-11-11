import { Port, type Result } from 'hexok';

/**
 * Why a credential proved nothing. It is for logs. The app maps every refusal
 * to one wire error, so a caller cannot tell a deleted session from a bad token.
 *
 * - `missing`: no credential.
 * - `invalid`: malformed, a bad signature, or a token this process does not accept.
 * - `expired`: the token, or the session record, passed its absolute end.
 * - `ended`: the token checks out and its session is gone: logged out, idle, or deleted.
 */
export type AuthRefusal = 'missing' | 'invalid' | 'expired' | 'ended';

/**
 * Turns a credential into the identity it proves, or a refusal.
 * The credential is an opaque string the edge extracted, such as a Bearer
 * token or a cookie value. `undefined` is no credential.
 *
 * `I` is the identity the adapter proves. Pass it through `resolving` to get
 * the app's own actor. A refusal is a result. A throw is an infrastructure
 * failure, such as a store that does not answer.
 *
 * ```ts
 * const found = await authenticator.authenticate(bearerToken(header))
 * if (!found.ok) throw AuthError.Unauthenticated()
 * ```
 */
export abstract class Authenticator<
  I,
  E extends string = AuthRefusal,
> extends Port('Authenticator') {
  abstract authenticate(credential: string | undefined): Promise<Result<I, E>>;
}
