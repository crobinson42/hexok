// RFC 6750 §2.1: "Bearer" 1*SP b64token. The scheme is case-insensitive.
const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

/**
 * The token of an `Authorization: Bearer <token>` header, or `undefined` for
 * no header, another scheme, or anything after the token.
 *
 * ```ts
 * await authenticator.authenticate(bearerToken(request.headers.get('authorization')))
 * ```
 */
export function bearerToken(
  header: string | null | undefined,
): string | undefined {
  if (header === null || header === undefined) return undefined;
  return BEARER.exec(header)?.[1];
}
