import { Adapter, fail, ok, type Result } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Authenticator, type AuthRefusal } from './authenticator.js';
import { bearerToken } from './bearer.js';
import { DevAuthenticator } from './dev-authenticator.js';
import { AuthError } from './errors.js';
import { resolving } from './resolving.js';
import { StaticTokenAuthenticator } from './static-token-authenticator.js';

type Caller = { readonly kind: 'user' | 'service'; readonly sub: string };
type Actor = { readonly userId: string };

class FixedAuthenticator extends Adapter(Authenticator)<Caller> {
  constructor(private readonly found: Result<Caller, AuthRefusal>) {
    super();
  }
  override async authenticate(): Promise<Result<Caller, AuthRefusal>> {
    return this.found;
  }
}

const toActor = async (caller: Caller) =>
  caller.kind === 'user' ? ok({ userId: caller.sub }) : fail('forbidden');

describe('resolving', () => {
  it('resolves a proven identity to the app actor', async () => {
    const auth = resolving(
      new FixedAuthenticator(ok({ kind: 'user', sub: 'usr_1' })),
      toActor,
    );
    expect(await auth.authenticate('t')).toEqual(ok({ userId: 'usr_1' }));
  });

  it('returns the resolver refusal', async () => {
    const auth = resolving(
      new FixedAuthenticator(ok({ kind: 'service', sub: 'svc' })),
      toActor,
    );
    expect(await auth.authenticate('t')).toEqual(fail('forbidden'));
  });

  it('skips the resolver when the credential is refused', async () => {
    let called = false;
    const auth = resolving(
      new FixedAuthenticator(fail('ended')),
      async (caller) => {
        called = true;
        return toActor(caller);
      },
    );
    expect(await auth.authenticate('t')).toEqual(fail('ended'));
    expect(called).toBe(false);
  });

  it('lets a resolver throw through as a failure, not a refusal', async () => {
    const auth = resolving(
      new FixedAuthenticator(ok({ kind: 'user', sub: 'usr_1' })),
      async () => {
        throw new Error('database down');
      },
    );
    await expect(auth.authenticate('t')).rejects.toThrow('database down');
  });

  it('types the result as the actor and both refusal sets', () => {
    const auth = resolving(new FixedAuthenticator(fail('missing')), toActor);
    expectTypeOf(auth).toExtend<
      Authenticator<Actor, AuthRefusal | 'forbidden'>
    >();
    // @ts-expect-error another actor type is refused
    const other: Authenticator<{ id: number }, AuthRefusal | 'forbidden'> =
      auth;
    void other;
  });
});

describe('StaticTokenAuthenticator', () => {
  const auth = new StaticTokenAuthenticator({
    tokens: [
      ['service-secret', { kind: 'service', sub: 'reports' }],
      ['dev-token', { kind: 'user', sub: 'usr_ada' }],
    ] satisfies Array<[string, Caller]>,
  });

  it('maps each token to its identity', async () => {
    expect(await auth.authenticate('service-secret')).toEqual(
      ok({ kind: 'service', sub: 'reports' }),
    );
  });

  it('refuses an unknown token as invalid and none as missing', async () => {
    expect(await auth.authenticate('nope')).toEqual(fail('invalid'));
    expect(await auth.authenticate(undefined)).toEqual(fail('missing'));
  });

  it('refuses a blank token in config', () => {
    try {
      new StaticTokenAuthenticator({ tokens: [[' ', 1]] });
      throw new Error('expected throw');
    } catch (error) {
      expect(AuthError.is(error)).toBe(true);
      if (AuthError.is(error) && error.code === 'InvalidConfig') {
        expect(error.data.problems).toEqual(['tokens[0]: is blank.']);
      }
    }
  });
});

describe('DevAuthenticator', () => {
  it('answers every call as the configured identity', async () => {
    const auth = new DevAuthenticator({ identity: { userId: 'usr_dev' } });
    expect(await auth.authenticate(undefined)).toEqual(
      ok({ userId: 'usr_dev' }),
    );
  });

  it('refuses every call when no identity is configured', async () => {
    const unset = (): Actor | undefined => undefined;
    const auth = new DevAuthenticator({ identity: unset() });
    expectTypeOf(auth).toExtend<Authenticator<Actor>>();
    expect(await auth.authenticate('anything')).toEqual(fail('invalid'));
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def-ghi_jkl~mno+p/q==', 'abc.def-ghi_jkl~mno+p/q=='],
    ['bearer abc', 'abc'],
    ['BEARER  abc', 'abc'],
    ['Bearer', undefined],
    ['Bearer ', undefined],
    ['Bearer a b', undefined],
    ['Basic abc', undefined],
    ['Bearer abc ', undefined],
    ['Bearer a=b', undefined],
    ['', undefined],
  ])('reads %j as %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it('reads no header as undefined', () => {
    expect(bearerToken(null)).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
