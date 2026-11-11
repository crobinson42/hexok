import { createHash } from 'node:crypto';
import { AuthError } from '@hexok/auth';
import { fail, ok } from 'hexok';
import { decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  generateSecret,
  JoseSessionToken,
  joseConfig,
} from './jose-session-token.js';

const secret = generateSecret();
const config = {
  secrets: [secret],
  issuer: 'billing',
  audience: 'billing-web',
};
const inAnHour = () => new Date(Date.now() + 3_600_000);

function kidOf(value: string): string {
  return createHash('sha256')
    .update(Buffer.from(value, 'base64url'))
    .digest('hex')
    .slice(0, 16);
}

/** Signs claims with the test secret, so only the field under test differs. */
function forge(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  alg = 'HS256',
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({
      alg,
      typ: 'session+jwt',
      kid: kidOf(secret),
      ...header,
    })
    .sign(new Uint8Array(Buffer.from(secret, 'base64url')));
}

const valid = () => ({
  jti: 'sess_1',
  iss: 'billing',
  aud: 'billing-web',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
});

function problemsOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (AuthError.is(error) && error.code === 'InvalidConfig') {
      return error.data.problems;
    }
    throw error;
  }
  throw new Error('expected throw');
}

describe('JoseSessionToken', () => {
  const tokens = new JoseSessionToken(config);

  it('reads back the session id it issued', async () => {
    const token = await tokens.issue('sess_1', inAnHour());
    expect(await tokens.read(token)).toEqual(ok('sess_1'));
  });

  it('signs only the session reference', async () => {
    const expiresAt = new Date(Date.now() + 600_000);
    const token = await tokens.issue('sess_1', expiresAt);
    const [, payload = ''] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
    ]);
    expect(claims.exp).toBe(Math.floor(expiresAt.getTime() / 1000));
    expect(decodeProtectedHeader(token)).toEqual({
      alg: 'HS256',
      typ: 'session+jwt',
      kid: kidOf(secret),
    });
  });

  it('accepts a forged-shape token only when every check passes', async () => {
    expect(await tokens.read(await forge(valid()))).toEqual(ok('sess_1'));
  });

  it.each([
    ['a wrong issuer', { iss: 'other' }],
    ['a wrong audience', { aud: 'other' }],
    ['no exp', { exp: undefined }],
    ['no jti', { jti: undefined }],
    ['a blank jti', { jti: '' }],
  ])('refuses a token with %s as invalid', async (_name, change) => {
    const claims: Record<string, unknown> = { ...valid(), ...change };
    for (const key of Object.keys(claims)) {
      if (claims[key] === undefined) delete claims[key];
    }
    expect(await tokens.read(await forge(claims))).toEqual(fail('invalid'));
  });

  it('refuses a wrong typ, a wrong alg, and an unknown kid as invalid', async () => {
    expect(await tokens.read(await forge(valid(), { typ: 'at+jwt' }))).toEqual(
      fail('invalid'),
    );
    expect(await tokens.read(await forge(valid(), {}, 'HS512'))).toEqual(
      fail('invalid'),
    );
    expect(await tokens.read(await forge(valid(), { kid: 'unknown' }))).toEqual(
      fail('invalid'),
    );
  });

  it('refuses an unsigned token', async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({
      alg: 'none',
      typ: 'session+jwt',
      kid: kidOf(secret),
    });
    expect(await tokens.read(`${header}.${encode(valid())}.`)).toEqual(
      fail('invalid'),
    );
  });

  it('refuses a tampered payload', async () => {
    const token = await tokens.issue('sess_1', inAnHour());
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(
      JSON.stringify({ ...valid(), jti: 'sess_2' }),
    ).toString('base64url');
    expect(await tokens.read(`${header}.${payload}.${signature}`)).toEqual(
      fail('invalid'),
    );
  });

  it('refuses garbage as invalid', async () => {
    expect(await tokens.read('not-a-jwt')).toEqual(fail('invalid'));
  });

  it('reads an authentic token past exp as expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(
      await tokens.read(await forge({ ...valid(), exp: past, iat: past - 10 })),
    ).toEqual(fail('expired'));
  });

  it('keeps verifying tokens signed with a previous secret', async () => {
    const next = generateSecret();
    const before = await tokens.issue('sess_old', inAnHour());
    const rotated = new JoseSessionToken({
      ...config,
      secrets: [next, secret],
    });
    expect(await rotated.read(before)).toEqual(ok('sess_old'));
    const after = await rotated.issue('sess_new', inAnHour());
    expect(decodeProtectedHeader(after).kid).toBe(kidOf(next));
    expect(await tokens.read(after)).toEqual(fail('invalid'));
  });

  it('refuses config that cannot sign safely', () => {
    expect(
      problemsOf(
        () =>
          new JoseSessionToken({
            secrets: ['short', 'not base64url!'],
            issuer: ' ',
            audience: '',
          }),
      ),
    ).toEqual([
      'secrets[0]: must decode to at least 32 bytes.',
      'secrets[1]: must be base64url.',
      'issuer: is blank.',
      'audience: is blank.',
    ]);
    expect(
      problemsOf(() => new JoseSessionToken({ ...config, secrets: [] })),
    ).toEqual(['secrets: needs one secret.']);
  });
});

describe('joseConfig', () => {
  it('reads secrets newest first, the issuer, and the audience', () => {
    const next = generateSecret();
    expect(
      joseConfig({
        AUTH_TOKEN_SECRETS: ` ${next}, ${secret} ,`,
        AUTH_TOKEN_ISSUER: 'billing',
        AUTH_TOKEN_AUDIENCE: 'billing-web',
      }),
    ).toEqual({
      secrets: [next, secret],
      issuer: 'billing',
      audience: 'billing-web',
    });
  });

  it('names every missing or bad variable without the secret', () => {
    const problems = problemsOf(() =>
      joseConfig({ BILLING_SECRETS: 'tooshort' }, { prefix: 'BILLING_' }),
    );
    expect(problems).toEqual([
      'BILLING_SECRETS[0]: must decode to at least 32 bytes.',
      'BILLING_ISSUER: is required.',
      'BILLING_AUDIENCE: is required.',
    ]);
    expect(problems.join()).not.toContain('tooshort');
    expect(problemsOf(() => joseConfig({}))[0]).toBe(
      'AUTH_TOKEN_SECRETS: is required.',
    );
  });
});

describe('generateSecret', () => {
  it('is 32 random bytes in base64url', () => {
    const value = generateSecret();
    expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    expect(value).not.toBe(generateSecret());
  });
});
