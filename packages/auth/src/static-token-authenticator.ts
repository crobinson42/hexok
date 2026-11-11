import { createHash } from 'node:crypto';
import { Adapter, fail, ok, type Result } from 'hexok';
import { Authenticator, type AuthRefusal } from './authenticator.js';
import { invalidConfig } from './errors.js';

/**
 * Fixed tokens, each mapped to an identity. It fits service tokens and local
 * development. The map is keyed by a SHA-256 of each token, so the raw tokens
 * are not kept, and a lookup does not compare token strings. A token cannot
 * be revoked except by restarting without it.
 *
 * ```ts
 * new StaticTokenAuthenticator({ tokens: [[process.env.REPORTS_TOKEN, { service: 'reports' }]] })
 * ```
 */
export class StaticTokenAuthenticator<I> extends Adapter(Authenticator)<I> {
  readonly #identities = new Map<string, I>();

  constructor(config: {
    readonly tokens: Iterable<readonly [token: string, identity: I]>;
  }) {
    super();
    const problems: string[] = [];
    let index = 0;
    for (const [token, identity] of config.tokens) {
      if (token.trim() === '') problems.push(`tokens[${index}]: is blank.`);
      else this.#identities.set(digest(token), identity);
      index += 1;
    }
    if (problems.length > 0) throw invalidConfig(problems);
  }

  override async authenticate(
    credential: string | undefined,
  ): Promise<Result<I, AuthRefusal>> {
    if (credential === undefined || credential === '') return fail('missing');
    const key = digest(credential);
    if (!this.#identities.has(key)) return fail('invalid');
    return ok(this.#identities.get(key) as I);
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
