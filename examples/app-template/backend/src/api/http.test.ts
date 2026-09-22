import { describe, expect, it } from 'vitest';
import { createApi } from './index.js';

function rpc(
  fetch: (request: Request) => Promise<Response>,
  key: string,
  input: unknown,
  authorization?: string,
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (authorization !== undefined) headers.authorization = authorization;
  return fetch(
    new Request(`http://app/rpc/${key.split('.').join('/')}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    }),
  );
}

async function loginReady() {
  const api = createApi();
  await api.app.start();
  await api.app.local.organization.register({
    organization: { id: 'org-1', name: 'Acme' },
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  });
  await api.app.local.user.setupCredentials({
    id: 'cred-1',
    userId: 'u1',
    passwordHash: 'secret',
  });
  return api;
}

describe('HTTP auth gates', () => {
  it('auth.login with no Authorization is 200', async () => {
    const { fetch, app } = await loginReady();
    const response = await rpc(fetch, 'auth.login', {
      email: 'ada@example.com',
      password: 'secret',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    await app.stop();
  });

  it('auth.login with Bearer not-a-token is 401', async () => {
    const { fetch, app } = createApi();
    const response = await rpc(
      fetch,
      'auth.login',
      { email: 'ada@example.com', password: 'secret' },
      'Bearer not-a-token',
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    await app.stop();
  });

  it('empty Bearer on login is 200', async () => {
    const { fetch, app } = await loginReady();
    const response = await rpc(
      fetch,
      'auth.login',
      { email: 'ada@example.com', password: 'secret' },
      'Bearer ',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    await app.stop();
  });

  it('apiKey.create with no Bearer is 401, not VALIDATION', async () => {
    const { fetch, app } = createApi();
    await app.start();
    const response = await rpc(fetch, 'apiKey.create', {});
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    await app.stop();
  });

  it('empty Bearer on apiKey.create is 401', async () => {
    const { fetch, app } = createApi();
    await app.start();
    const response = await rpc(fetch, 'apiKey.create', {}, 'Bearer ');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAUTHORIZED' },
    });
    await app.stop();
  });
});
