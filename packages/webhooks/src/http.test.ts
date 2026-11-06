import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkUrl,
  type HttpOptions,
  send,
  type WebhookResolver,
} from './http.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

async function serve(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server has no port');
  }
  return `http://127.0.0.1:${address.port}`;
}

/** A local server, so private addresses and plain http are allowed. */
const local: HttpOptions = {
  httpsOnly: false,
  allowPrivate: true,
  timeoutMs: 15_000,
  maxResponseBytes: 20 * 1024,
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
};

/** The production defaults, with a resolver that never reaches the network. */
function strict(resolve: WebhookResolver): HttpOptions {
  return {
    httpsOnly: true,
    allowPrivate: false,
    timeoutMs: 15_000,
    maxResponseBytes: 20 * 1024,
    resolve,
  };
}

/** The result of one send. */
async function sent(...args: Parameters<typeof send>) {
  return (await send(...args)).result;
}

function post(url: string, signal = new AbortController().signal) {
  return {
    url,
    headers: { 'webhook-id': 'msg_1' },
    body: '{"a":1}',
    signal,
  };
}

describe('send', () => {
  it('POSTs the body and headers, and a 2xx is success', async () => {
    const seen: Array<{
      method: string | undefined;
      headers: unknown;
      body: string;
    }> = [];
    const url = await serve((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        seen.push({ method: req.method, headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    expect(await sent(post(`${url}/hook`), local)).toEqual({
      status: 204,
      durationMs: expect.any(Number),
      responseBody: '',
    });
    expect(seen).toEqual([
      {
        method: 'POST',
        headers: expect.objectContaining({
          'webhook-id': 'msg_1',
          'content-type': 'application/json',
          'content-length': '7',
        }),
        body: '{"a":1}',
      },
    ]);
  });

  it('fails a 301 and never requests its Location', async () => {
    let followed = 0;
    const elsewhere = await serve((_req, res) => {
      followed += 1;
      res.end('ok');
    });
    const url = await serve((_req, res) => {
      res.writeHead(301, { location: elsewhere }).end('moved');
    });
    const result = await sent(post(url), local);
    expect(result).toMatchObject({
      status: 301,
      error: 'http',
      responseBody: 'moved',
    });
    expect(followed).toBe(0);
  });

  it('cuts off a server that sends one byte every few seconds at 15 s', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('.');
      const drip = setInterval(() => res.write('.'), 3000);
      res.on('close', () => clearInterval(drip));
    });
    const result = await sent(post(url), local);
    expect(result.error).toBe('timeout');
    expect(result.durationMs).toBeGreaterThanOrEqual(15_000);
    expect(result.durationMs).toBeLessThan(16_000);
    expect(result.responseBody).toBe('.....');
  }, 25_000);

  it('stores the first 20 KB of a 1 MB response', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200).end('x'.repeat(1024 * 1024));
    });
    const result = await sent(post(url), local);
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
    expect(result.responseBody).toBe('x'.repeat(20 * 1024));
  });

  it('blocks private IP literals, IPv4-mapped, IPv4-compatible, and NAT64 IPv6 included, without resolving', async () => {
    const resolve = vi.fn<WebhookResolver>(async () => []);
    for (const url of [
      'https://127.0.0.1',
      'https://[::1]',
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:10.0.0.1]',
      'https://0.0.0.0',
      'https://[fd00::1]',
      'https://[::7f00:1]',
      'https://[::a00:1]',
      'https://[64:ff9b:1::a00:1]',
    ]) {
      expect(await sent(post(url), strict(resolve))).toMatchObject({
        error: 'blocked',
      });
      expect(await checkUrl(url, strict(resolve))).toEqual({
        ok: false,
        code: 'blocked',
      });
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('blocks a hostname that resolves to one public and one private address at connect time', async () => {
    const resolve = vi.fn<WebhookResolver>(async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const result = await sent(
      post('https://hooks.example.com/in'),
      strict(resolve),
    );
    expect(result).toMatchObject({ error: 'blocked' });
    expect(result.status).toBeUndefined();
    // The only resolution is the socket's own lookup.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(
      await checkUrl('https://hooks.example.com/in', strict(resolve)),
    ).toEqual({ ok: false, code: 'blocked' });
  });

  it('fails plain http under httpsOnly', async () => {
    const resolve = vi.fn<WebhookResolver>(async () => [
      { address: '93.184.215.14', family: 4 },
    ]);
    expect(
      await sent(post('http://hooks.example.com'), strict(resolve)),
    ).toMatchObject({ error: 'blocked' });
    expect(await checkUrl('http://hooks.example.com', strict(resolve))).toEqual(
      { ok: false, code: 'scheme' },
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('names dns, tls, connection, and cancelled failures', async () => {
    const missing = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    expect(
      await sent(
        post('https://nowhere.example'),
        strict(async () => {
          throw missing;
        }),
      ),
    ).toMatchObject({ error: 'dns' });
    expect(
      await sent(
        post('https://nowhere.example'),
        strict(async () => []),
      ),
    ).toMatchObject({ error: 'dns' });

    const plain = await serve((_req, res) => res.end('ok'));
    expect(
      await sent(post(plain.replace('http:', 'https:')), local),
    ).toMatchObject({ error: 'tls' });

    const closed = await serve(() => {});
    const server = servers.pop();
    await new Promise((resolve) => server?.close(resolve));
    expect(await sent(post(closed), local)).toMatchObject({
      error: 'connection',
    });

    const hanging = await serve(() => {});
    const stop = new AbortController();
    const pending = sent(post(hanging, stop.signal), local);
    setTimeout(() => stop.abort(), 50);
    expect(await pending).toMatchObject({ error: 'cancelled' });
  });
});

describe('checkUrl', () => {
  it('accepts a public https URL and refuses an invalid or unresolvable one', async () => {
    const publicHost = strict(async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
    ]);
    const accepted = await checkUrl('https://hooks.example.com/in', publicHost);
    expect(accepted.ok && accepted.value.href).toBe(
      'https://hooks.example.com/in',
    );
    // An IPv4-mapped public address is still public.
    expect(
      (await checkUrl('https://[::ffff:93.184.215.14]', publicHost)).ok,
    ).toBe(true);
    expect(await checkUrl('not a url', publicHost)).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(await checkUrl('ftp://hooks.example.com', publicHost)).toEqual({
      ok: false,
      code: 'scheme',
    });
    expect(
      await checkUrl(
        'https://nowhere.example',
        strict(async () => {
          throw new Error('ENOTFOUND');
        }),
      ),
    ).toEqual({ ok: false, code: 'unresolved' });
  });

  it('allows private addresses only with allowPrivate', async () => {
    const options = { ...strict(async () => []), allowPrivate: true };
    expect((await checkUrl('https://127.0.0.1', options)).ok).toBe(true);
  });
});

describe('send Retry-After', () => {
  it('returns Retry-After in seconds or as an HTTP date', async () => {
    const url = await serve((req, res) => {
      const header =
        req.url === '/date'
          ? new Date(Date.now() + 120_000).toUTCString()
          : req.url === '/bad'
            ? 'soon'
            : '30';
      res.writeHead(503, { 'retry-after': header }).end();
    });
    expect(await send(post(url), local)).toMatchObject({
      result: { status: 503, error: 'http' },
      retryAfterMs: 30_000,
    });
    const dated = await send(post(`${url}/date`), local);
    expect(dated.retryAfterMs).toBeGreaterThan(115_000);
    expect(dated.retryAfterMs).toBeLessThanOrEqual(120_000);
    expect(
      (await send(post(`${url}/bad`), local)).retryAfterMs,
    ).toBeUndefined();
  });
});
