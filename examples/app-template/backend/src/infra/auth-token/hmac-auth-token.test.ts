import { describe, expect, it } from 'vitest';
import type { Actor } from '../../domain/schemas/actor.js';
import { HmacAuthToken, hmacAuthToken } from './hmac-auth-token.js';

const user: Actor = {
  type: 'user',
  userId: 'u1',
  organizationIds: ['org-1'],
};

const apiKey: Actor = {
  type: 'apiKey',
  apiKeyId: 'k1',
  userId: 'u1',
  organizationIds: ['org-1', 'org-2'],
};

describe('HmacAuthToken', () => {
  it('round-trips a user actor', async () => {
    const tokens = new HmacAuthToken('secret');
    await expect(tokens.verify(await tokens.issue(user))).resolves.toEqual(
      user,
    );
  });

  it('round-trips an apiKey actor', async () => {
    const tokens = new HmacAuthToken('secret');
    await expect(tokens.verify(await tokens.issue(apiKey))).resolves.toEqual(
      apiKey,
    );
  });

  it('returns null for a tampered payload', async () => {
    const tokens = new HmacAuthToken('secret');
    const [payload, signature] = (await tokens.issue(user)).split('.');
    const tampered = Buffer.from(
      JSON.stringify({ ...user, userId: 'u2' }),
    ).toString('base64url');
    expect(payload).toEqual(expect.any(String));
    expect(signature).toEqual(expect.any(String));
    await expect(tokens.verify(`${tampered}.${signature}`)).resolves.toBeNull();
  });

  it('returns null when the secret does not match', async () => {
    const issued = await new HmacAuthToken('a').issue(user);
    await expect(new HmacAuthToken('b').verify(issued)).resolves.toBeNull();
  });

  it('returns null for garbage, empty, and unsigned values', async () => {
    const tokens = new HmacAuthToken('secret');
    await expect(tokens.verify('')).resolves.toBeNull();
    await expect(tokens.verify('not-a-token')).resolves.toBeNull();
    await expect(tokens.verify('abc.')).resolves.toBeNull();
  });
});
