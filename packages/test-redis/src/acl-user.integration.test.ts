import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { withAclUser } from './acl-user.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}

const url = process.env.REDIS_URL ?? '';

describe.skipIf(!url)('withAclUser', () => {
  it('reports what Redis refused that user, and deletes the user', async () => {
    const admin = new Redis(url);
    let name = '';
    await withAclUser(
      url,
      // `+info` and `+client` keep the ioredis handshake out of the refusals.
      [
        'on',
        'resetchannels',
        '~acl-test:*',
        '-@all',
        '+get',
        '+info',
        '+client',
      ],
      async (user) => {
        name = user.name;
        const client = new Redis(user.url);
        expect(await client.get('acl-test:a')).toBeNull();
        expect(await user.refusals()).toEqual([]);
        await expect(client.set('acl-test:a', '1')).rejects.toThrow('NOPERM');
        await expect(client.get('other:a')).rejects.toThrow('NOPERM');
        await client.quit();
        const refusals = await user.refusals();
        expect(refusals.map((refusal) => refusal.reason).sort()).toEqual([
          'command',
          'key',
        ]);
      },
    );
    expect(await admin.acl('LIST')).not.toContainEqual(
      expect.stringContaining(name),
    );
    await admin.quit();
  });
});
