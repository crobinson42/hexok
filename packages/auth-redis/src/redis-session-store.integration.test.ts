import { randomUUID } from 'node:crypto';
import { MemorySessionStore, OpaqueSessionToken, Sessions } from '@hexok/auth';
import {
  describeRedisLifecycle,
  documentedAclRules,
  withAclUser,
} from '@hexok/test-redis';
import { fail, ok } from 'hexok';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RedisSessionStore, sessionKey } from './redis-session-store.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

const url = process.env.REDIS_URL ?? '';
const actorSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});
const ada = { organizationId: 'org_1', userId: 'usr_ada' };

function clock(start = Date.now()) {
  let now = start;
  return {
    now: () => now,
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

describeRedisLifecycle('RedisSessionStore', ({ redis, stopTimeoutMs }) => {
  const store = new RedisSessionStore({
    redis,
    stopTimeoutMs,
    identity: actorSchema,
    idleSeconds: 60,
    absoluteSeconds: 600,
    keyPrefix: `hexok:session:it:${randomUUID()}:`,
  });
  return {
    start: () => store.start(),
    stop: () => store.stop(),
    operate: () => store.resolve('missing'),
  };
});

describe.skipIf(!url)('RedisSessionStore', () => {
  let admin: Redis;
  const stores: RedisSessionStore<typeof actorSchema>[] = [];

  beforeAll(() => {
    admin = new Redis(url);
  });

  afterAll(async () => {
    await Promise.all(stores.map((store) => store.stop()));
    admin.disconnect();
  });

  async function started(
    options: {
      idleSeconds?: number;
      absoluteSeconds?: number;
      now?: () => number;
      redis?: string;
    } = {},
  ) {
    const keyPrefix = `hexok:session:it:${randomUUID()}:`;
    const store = new RedisSessionStore({
      redis: options.redis ?? url,
      identity: actorSchema,
      idleSeconds: options.idleSeconds ?? 60,
      absoluteSeconds: options.absoluteSeconds ?? 600,
      keyPrefix,
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    stores.push(store);
    await store.start();
    return { store, keyPrefix };
  }

  it('resolves the identity a session was opened for', async () => {
    const { store } = await started();
    const session = await store.open(ada);
    expect(await store.resolve(session.id)).toEqual(ok(ada));
  });

  it('keeps the record under a hash of the id, with a TTL at the idle window', async () => {
    const { store, keyPrefix } = await started();
    const session = await store.open(ada);
    const key = sessionKey(session.id, keyPrefix);
    const keys = await admin.keys(`${keyPrefix}*`);
    expect(keys).toEqual([key]);
    expect(keys.join()).not.toContain(session.id);
    const record = await admin.hgetall(key);
    expect(JSON.parse(record.i ?? '')).toEqual(ada);
    expect(record.v).toBe('1');
    const ttl = await admin.pttl(key);
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('slides the idle window, never past the absolute end', async () => {
    const time = clock();
    const { store, keyPrefix } = await started({
      idleSeconds: 60,
      absoluteSeconds: 100,
      now: time.now,
    });
    const session = await store.open(ada);
    const key = sessionKey(session.id, keyPrefix);
    time.advance(70);
    expect(await store.resolve(session.id)).toEqual(ok(ada));
    const ttl = await admin.pttl(key);
    expect(ttl).toBeLessThanOrEqual(30_000);
    expect(ttl).toBeGreaterThan(25_000);
  });

  it('ends a session left idle', async () => {
    const { store } = await started({ idleSeconds: 1, absoluteSeconds: 600 });
    const session = await store.open(ada);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await store.resolve(session.id)).toEqual(fail('ended'));
  });

  it('reports a record past its absolute end as expired and deletes it', async () => {
    const time = clock();
    const { store, keyPrefix } = await started({
      idleSeconds: 600,
      absoluteSeconds: 600,
      now: time.now,
    });
    const session = await store.open(ada);
    time.advance(600);
    expect(await store.resolve(session.id)).toEqual(fail('expired'));
    expect(await admin.exists(sessionKey(session.id, keyPrefix))).toBe(0);
  });

  it('closes a session and treats a missing one as closed', async () => {
    const { store } = await started();
    const session = await store.open(ada);
    await store.close(session.id);
    await store.close(session.id);
    expect(await store.resolve(session.id)).toEqual(fail('ended'));
  });

  it.each([
    ['bad JSON', { i: '{', e: String(Date.now() + 60_000) }],
    [
      'an identity the schema refuses',
      { i: '{"userId":1}', e: String(Date.now() + 60_000) },
    ],
    ['no absolute end', { i: JSON.stringify(ada) }],
  ])('deletes a record with %s and reports ended', async (_name, fields) => {
    const { store, keyPrefix } = await started();
    const key = sessionKey('planted', keyPrefix);
    await admin.hset(key, fields);
    expect(await store.resolve('planted')).toEqual(fail('ended'));
    expect(await admin.exists(key)).toBe(0);
  });

  it('deletes a key of another type and reports ended', async () => {
    const { store, keyPrefix } = await started();
    const key = sessionKey('planted', keyPrefix);
    await admin.set(key, 'x');
    expect(await store.resolve('planted')).toEqual(fail('ended'));
    expect(await admin.exists(key)).toBe(0);
  });

  it('refuses to open an identity its schema refuses', async () => {
    const { store } = await started();
    await expect(
      store.open({ organizationId: 'org_1' } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('runs Sessions end to end with the same results as the memory store', async () => {
    const { store } = await started();
    const memory = new MemorySessionStore<z.infer<typeof actorSchema>>({
      idleSeconds: 60,
      absoluteSeconds: 600,
    });
    for (const sessions of [
      new Sessions({ store, token: new OpaqueSessionToken() }),
      new Sessions({ store: memory, token: new OpaqueSessionToken() }),
    ]) {
      const token = await sessions.open(ada);
      expect(await sessions.authenticate(token)).toEqual(ok(ada));
      await sessions.close(token);
      expect(await sessions.authenticate(token)).toEqual(fail('ended'));
    }
  });

  it('works as the least-privilege ACL user in the README', async () => {
    const rules = await documentedAclRules(
      new URL('../README.md', import.meta.url),
    );
    const prefixed = rules.map((rule) =>
      rule === '~hexok:session:*' ? '~hexok:session:acl:*' : rule,
    );
    await withAclUser(url, prefixed, async (user) => {
      const store = new RedisSessionStore({
        redis: user.url,
        identity: actorSchema,
        idleSeconds: 60,
        absoluteSeconds: 600,
        keyPrefix: `hexok:session:acl:${randomUUID()}:`,
      });
      await store.start();
      try {
        const session = await store.open(ada);
        expect(await store.resolve(session.id)).toEqual(ok(ada));
        await store.close(session.id);
        expect(await store.resolve(session.id)).toEqual(fail('ended'));
      } finally {
        await store.stop();
      }
      expect(await user.refusals()).toEqual([]);
    });
  });
});
