import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { RedisSessionStore, sessionKey } from './redis-session-store.js';

const actorSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});

describe('RedisSessionStore', () => {
  it('infers the identity from its schema', () => {
    const store = new RedisSessionStore({
      redis: 'redis://127.0.0.1:1',
      identity: actorSchema,
      idleSeconds: 60,
      absoluteSeconds: 600,
    });
    expectTypeOf(store.open)
      .parameter(0)
      .toEqualTypeOf<{ organizationId: string; userId: string }>();
  });

  it('refuses lifetimes that cannot work', () => {
    expect(
      () =>
        new RedisSessionStore({
          redis: 'redis://127.0.0.1:1',
          identity: actorSchema,
          idleSeconds: 600,
          absoluteSeconds: 60,
        }),
    ).toThrow(/must not be greater than absoluteSeconds/);
  });

  it('refuses a call before start', async () => {
    const store = new RedisSessionStore({
      redis: 'redis://127.0.0.1:1',
      identity: actorSchema,
      idleSeconds: 60,
      absoluteSeconds: 600,
    });
    await expect(store.resolve('id')).rejects.toMatchObject({
      code: 'NotStarted',
    });
  });
});

describe('sessionKey', () => {
  it('hashes the id under the prefix', () => {
    const key = sessionKey('abc');
    expect(key.startsWith('hexok:session:')).toBe(true);
    expect(key).not.toContain('abc');
    expect(sessionKey('abc', 'app:s:')).toBe(
      `app:s:${key.slice('hexok:session:'.length)}`,
    );
  });
});
