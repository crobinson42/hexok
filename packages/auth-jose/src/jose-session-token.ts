import { createHash, randomBytes } from 'node:crypto';
import { type Env, invalidConfig, SessionToken } from '@hexok/auth';
import { Adapter, fail, ok, type Result } from 'hexok';
import { decodeProtectedHeader, errors, jwtVerify, SignJWT } from 'jose';

const MIN_SECRET_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface JoseSessionTokenConfig {
  /**
   * HMAC secrets, base64url, at least 32 bytes each, newest first. The first
   * signs. Every one verifies, so a rotation keeps sessions signed with the
   * previous secret. `generateSecret()` makes one.
   */
  readonly secrets: readonly string[];
  /** The `iss` this process signs and requires. */
  readonly issuer: string;
  /** The `aud` this process signs and requires. */
  readonly audience: string;
  /** The `typ` header this process signs and requires. Default `session+jwt`. */
  readonly typ?: string | undefined;
  /** How far `exp` may be passed and still verify. Default 5. */
  readonly clockToleranceSeconds?: number | undefined;
}

type Key = { readonly kid: string; readonly bytes: Uint8Array };

/** A new HMAC secret: 32 random bytes, base64url. */
export function generateSecret(): string {
  return randomBytes(MIN_SECRET_BYTES).toString('base64url');
}

/**
 * A session id in a signed JWT. The payload names the session and nothing
 * about the person: `jti` is the session id, with `iss`, `aud`, `iat`, and
 * `exp` at the session's absolute end. The header pins `HS256`, the `typ`, and
 * a `kid` that picks the secret.
 *
 * A token is checked before the store is asked, and it is bound to one issuer
 * and audience. Anyone holding a token can read its payload, so it carries no
 * identity.
 *
 * ```ts
 * const token = new JoseSessionToken(joseConfig(env))
 * const sessions = new Sessions({ store, token })
 * ```
 */
export class JoseSessionToken extends Adapter(SessionToken) {
  readonly #keys: readonly Key[];
  readonly #issuer: string;
  readonly #audience: string;
  readonly #typ: string;
  readonly #clockTolerance: number;

  constructor(config: JoseSessionTokenConfig) {
    super();
    const problems = [
      ...config.secrets.flatMap((secret, index) =>
        secretProblems(secret, `secrets[${index}]`),
      ),
      ...(config.secrets.length === 0 ? ['secrets: needs one secret.'] : []),
      ...(config.issuer.trim() === '' ? ['issuer: is blank.'] : []),
      ...(config.audience.trim() === '' ? ['audience: is blank.'] : []),
    ];
    if (problems.length > 0) throw invalidConfig(problems);
    this.#keys = config.secrets.map(keyOf);
    this.#issuer = config.issuer;
    this.#audience = config.audience;
    this.#typ = config.typ ?? 'session+jwt';
    this.#clockTolerance = config.clockToleranceSeconds ?? 5;
  }

  override async issue(id: string, expiresAt: Date): Promise<string> {
    const signing = this.#keys[0] as Key;
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: this.#typ, kid: signing.kid })
      .setJti(id)
      .setIssuer(this.#issuer)
      .setAudience(this.#audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(signing.bytes);
  }

  override async read(
    token: string,
  ): Promise<Result<string, 'invalid' | 'expired'>> {
    const key = this.#keyFor(token);
    if (key === undefined) return fail('invalid');
    try {
      const { payload } = await jwtVerify(token, key.bytes, {
        algorithms: ['HS256'],
        issuer: this.#issuer,
        audience: this.#audience,
        typ: this.#typ,
        requiredClaims: ['jti', 'exp'],
        clockTolerance: this.#clockTolerance,
      });
      return typeof payload.jti === 'string' && payload.jti !== ''
        ? ok(payload.jti)
        : fail('invalid');
    } catch (error) {
      // jose checks the signature before the claims, so only an authentic token reads as expired.
      return error instanceof errors.JWTExpired
        ? fail('expired')
        : fail('invalid');
    }
  }

  #keyFor(token: string): Key | undefined {
    let kid: unknown;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      return undefined;
    }
    return this.#keys.find((key) => key.kid === kid);
  }
}

/**
 * Reads `<prefix>SECRETS` (comma separated, newest first), `<prefix>ISSUER`,
 * and `<prefix>AUDIENCE` from `env`. Throws `AuthError.InvalidConfig` naming
 * every bad variable. The secrets are never in the message.
 *
 * ```ts
 * const token = new JoseSessionToken(joseConfig(process.env))
 * ```
 */
export function joseConfig(
  env: Env,
  options: { readonly prefix?: string } = {},
): JoseSessionTokenConfig {
  const prefix = options.prefix ?? 'AUTH_TOKEN_';
  const secrets = (env[`${prefix}SECRETS`] ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret !== '');
  const issuer = env[`${prefix}ISSUER`]?.trim() ?? '';
  const audience = env[`${prefix}AUDIENCE`]?.trim() ?? '';
  const problems = [
    ...(secrets.length === 0 ? [`${prefix}SECRETS: is required.`] : []),
    ...secrets.flatMap((secret, index) =>
      secretProblems(secret, `${prefix}SECRETS[${index}]`),
    ),
    ...(issuer === '' ? [`${prefix}ISSUER: is required.`] : []),
    ...(audience === '' ? [`${prefix}AUDIENCE: is required.`] : []),
  ];
  if (problems.length > 0) throw invalidConfig(problems);
  return { secrets, issuer, audience };
}

function secretProblems(secret: string, label: string): string[] {
  if (!BASE64URL.test(secret)) return [`${label}: must be base64url.`];
  if (Buffer.from(secret, 'base64url').length < MIN_SECRET_BYTES) {
    return [`${label}: must decode to at least ${MIN_SECRET_BYTES} bytes.`];
  }
  return [];
}

function keyOf(secret: string): Key {
  const bytes = new Uint8Array(Buffer.from(secret, 'base64url'));
  const kid = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return { kid, bytes };
}
