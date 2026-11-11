import { Adapter, fail, ok, type Result } from 'hexok';
import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from './memory-session-store.js';
import { OpaqueSessionToken } from './opaque-session-token.js';
import { Sessions, SessionToken } from './sessions.js';

type Actor = { readonly organizationId: string; readonly userId: string };
const ada: Actor = { organizationId: 'org_1', userId: 'usr_ada' };

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

function setup(lifetimes = { idleSeconds: 60, absoluteSeconds: 600 }) {
  const time = clock();
  const store = new MemorySessionStore<Actor>({ ...lifetimes, now: time.now });
  const sessions = new Sessions({ store, token: new OpaqueSessionToken() });
  return { time, store, sessions };
}

describe('Sessions', () => {
  it('authenticates the identity a session was opened for', async () => {
    const { sessions } = setup();
    const token = await sessions.open(ada);
    expect(await sessions.authenticate(token)).toEqual(ok(ada));
  });

  it('opens a new session id on every open', async () => {
    const { sessions } = setup();
    const first = await sessions.open(ada);
    const second = await sessions.open(ada);
    expect(first).not.toBe(second);
  });

  it('refuses no credential as missing', async () => {
    const { sessions } = setup();
    expect(await sessions.authenticate(undefined)).toEqual(fail('missing'));
    expect(await sessions.authenticate('')).toEqual(fail('missing'));
  });

  it('refuses a token that names no session as ended', async () => {
    const { sessions } = setup();
    expect(await sessions.authenticate('not-a-session')).toEqual(fail('ended'));
  });

  it('ends the session the credential names on close', async () => {
    const { sessions } = setup();
    const token = await sessions.open(ada);
    const other = await sessions.open(ada);
    await sessions.close(token);
    expect(await sessions.authenticate(token)).toEqual(fail('ended'));
    expect(await sessions.authenticate(other)).toEqual(ok(ada));
  });

  it('treats closing a missing or unreadable credential as already closed', async () => {
    const { sessions } = setup();
    await expect(sessions.close(undefined)).resolves.toBeUndefined();
    await expect(sessions.close('')).resolves.toBeUndefined();
    await expect(sessions.close('x'.repeat(1000))).resolves.toBeUndefined();
  });

  it('passes the token refusal through without asking the store', async () => {
    class ExpiredToken extends Adapter(SessionToken) {
      override async issue(id: string): Promise<string> {
        return id;
      }
      override async read(): Promise<Result<string, 'invalid' | 'expired'>> {
        return fail('expired');
      }
    }
    const store = new MemorySessionStore<Actor>({
      idleSeconds: 60,
      absoluteSeconds: 600,
    });
    const sessions = new Sessions({ store, token: new ExpiredToken() });
    const token = await sessions.open(ada);
    expect(await sessions.authenticate(token)).toEqual(fail('expired'));
  });

  it('hands the store absolute end to the token', async () => {
    const issued: Date[] = [];
    class Recording extends Adapter(SessionToken) {
      override async issue(id: string, expiresAt: Date): Promise<string> {
        issued.push(expiresAt);
        return id;
      }
      override async read(
        token: string,
      ): Promise<Result<string, 'invalid' | 'expired'>> {
        return ok(token);
      }
    }
    const time = clock(5_000);
    const store = new MemorySessionStore<Actor>({
      idleSeconds: 60,
      absoluteSeconds: 600,
      now: time.now,
    });
    await new Sessions({ store, token: new Recording() }).open(ada);
    expect(issued).toEqual([new Date(5_000 + 600_000)]);
  });
});

describe('MemorySessionStore', () => {
  it('ends a session left idle', async () => {
    const { time, sessions } = setup();
    const token = await sessions.open(ada);
    time.advance(60);
    expect(await sessions.authenticate(token)).toEqual(fail('ended'));
  });

  it('slides the idle window on every resolve', async () => {
    const { time, sessions } = setup();
    const token = await sessions.open(ada);
    for (let i = 0; i < 5; i++) {
      time.advance(59);
      expect(await sessions.authenticate(token)).toEqual(ok(ada));
    }
  });

  it('never slides past the absolute end', async () => {
    const { time, sessions } = setup({ idleSeconds: 60, absoluteSeconds: 100 });
    const token = await sessions.open(ada);
    time.advance(50);
    expect(await sessions.authenticate(token)).toEqual(ok(ada));
    time.advance(49);
    expect(await sessions.authenticate(token)).toEqual(ok(ada));
    time.advance(1);
    expect(await sessions.authenticate(token)).toEqual(fail('ended'));
  });

  it('refuses lifetimes that cannot work', () => {
    expect(
      () => new MemorySessionStore({ idleSeconds: 0, absoluteSeconds: 10 }),
    ).toThrow(/idleSeconds/);
    expect(
      () => new MemorySessionStore({ idleSeconds: 20, absoluteSeconds: 10 }),
    ).toThrow(/greater than absoluteSeconds/);
    expect(
      () => new MemorySessionStore({ idleSeconds: 1.5, absoluteSeconds: 10 }),
    ).toThrow(/whole number/);
  });
});

describe('OpaqueSessionToken', () => {
  it('is the session id', async () => {
    const token = new OpaqueSessionToken();
    expect(await token.issue('abc', new Date())).toBe('abc');
    expect(await token.read('abc')).toEqual(ok('abc'));
  });

  it('refuses a blank or oversized token before the store', async () => {
    const token = new OpaqueSessionToken();
    expect(await token.read('')).toEqual(fail('invalid'));
    expect(await token.read('x'.repeat(513))).toEqual(fail('invalid'));
  });
});
