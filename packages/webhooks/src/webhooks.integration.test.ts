import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { RedisQueue } from '@hexok/queue-redis';
import { runNode } from '@hexok/test-redis';
import { Adapter, Event, EventCatalog } from 'hexok';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { verify } from './signing.js';
import {
  type WebhookEndpoint,
  WebhookEndpoints,
  type WebhookHooks,
  Webhooks,
  type WebhooksConfig,
} from './webhooks.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}
const redis = process.env.REDIS_URL ?? '';

// The child worker in the crash test defines the same catalog.
class ReportSubmitted extends Event(
  'report.submitted',
  z.object({ id: z.string() }),
) {}
class WebhookEvents extends EventCatalog('webhooks-it', {
  reportSubmitted: ReportSubmitted,
}) {}

const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

class OneEndpoint extends Adapter(WebhookEndpoints) {
  readonly #endpoint: WebhookEndpoint;

  constructor(url: string) {
    super();
    this.#endpoint = { id: 'ep_1', url, secrets: [secret] };
  }

  async subscribed(): Promise<readonly WebhookEndpoint[]> {
    return [this.#endpoint];
  }

  async get(): Promise<WebhookEndpoint | null> {
    return this.#endpoint;
  }
}

interface Arrival {
  at: number;
  webhookId: string;
  verified: boolean;
}

async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for a webhook');
}

describe.skipIf(!redis)('webhooks over RedisQueue', () => {
  const servers: Server[] = [];
  const stops: Array<() => Promise<void>> = [];
  const keys: string[] = [];

  afterEach(async () => {
    for (const stop of stops.splice(0).reverse()) await stop();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          }),
      ),
    );
    const admin = new Redis(redis);
    if (keys.length > 0) await admin.del(...keys.splice(0));
    await admin.quit();
  });

  /** A local endpoint. `respond` gets the 0-based request number. Every request is checked with `verify`. */
  async function endpoint(
    respond: (res: ServerResponse, index: number) => void,
  ): Promise<{ url: string; arrivals: Arrival[] }> {
    const arrivals: Arrival[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const webhookId = String(req.headers['webhook-id']);
        arrivals.push({
          at: Date.now(),
          webhookId,
          verified: verify({
            secrets: [secret],
            id: webhookId,
            timestamp: String(req.headers['webhook-timestamp']),
            signature: String(req.headers['webhook-signature']),
            body,
          }),
        });
        respond(res, arrivals.length - 1);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the test server has no port');
    }
    return { url: `http://127.0.0.1:${address.port}/in`, arrivals };
  }

  function prefixes() {
    const id = randomUUID();
    const keyPrefix = `hexok:queue:it:webhooks:${id}:`;
    const delayedPrefix = `hexok:queue-delayed:it:webhooks:${id}:`;
    keys.push(`${keyPrefix}webhooks`, `${delayedPrefix}webhooks`);
    return { keyPrefix, delayedPrefix };
  }

  /** A started queue and a started worker on it. */
  async function worker(options: {
    url: string;
    prefixes: { keyPrefix: string; delayedPrefix: string };
    visibilityMs?: number;
    hooks?: WebhookHooks<ReportSubmitted>;
    config?: WebhooksConfig;
  }) {
    const queue = new RedisQueue({
      redis,
      ...options.prefixes,
      promoteMs: 50,
      blockMs: 50,
      ...(options.visibilityMs === undefined
        ? {}
        : { visibilityMs: options.visibilityMs }),
    });
    await queue.start();
    const webhooks = new Webhooks(
      {
        events: WebhookEvents,
        queue,
        endpoints: new OneEndpoint(options.url),
        logger: { error: () => {} },
        ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      },
      { httpsOnly: false, allowPrivate: true, ...options.config },
    );
    await webhooks.start();
    stops.push(async () => {
      await webhooks.stop();
      await queue.stop();
    });
    return webhooks;
  }

  it('delivers a publish to a server whose verify() passes', async () => {
    const server = await endpoint((res) => res.writeHead(200).end());
    const webhooks = await worker({ url: server.url, prefixes: prefixes() });
    const webhookId = await webhooks.publish({
      organizationId: 'org_1',
      eventId: 'report.submitted:r1:1',
      event: new ReportSubmitted({ id: 'r1' }),
    });
    await waitFor(() => server.arrivals.length === 1);
    expect(server.arrivals[0]).toMatchObject({ webhookId, verified: true });
  });

  it('a failing server receives the retry after its delay', async () => {
    const server = await endpoint((res, index) =>
      res.writeHead(index === 0 ? 500 : 200).end(),
    );
    const webhooks = await worker({
      url: server.url,
      prefixes: prefixes(),
      config: { retrySchedule: [600], random: () => 0.5 },
    });
    await webhooks.publish({
      organizationId: 'org_1',
      eventId: 'report.submitted:r1:1',
      event: new ReportSubmitted({ id: 'r1' }),
    });
    await waitFor(() => server.arrivals.length === 2);
    const [first, second] = server.arrivals;
    const gap = (second?.at ?? 0) - (first?.at ?? 0);
    // The retry is due 600 ms after the failure, then waits up to promoteMs plus blockMs for its promote and read.
    expect(gap).toBeGreaterThanOrEqual(600 - 20);
    expect(gap).toBeLessThan(600 + 50 + 50 + 300);
    expect(second?.webhookId).toBe(first?.webhookId);
    expect(second?.verified).toBe(true);
  });

  it('a worker killed mid-send leads to a second delivery with the same webhook-id and deliveryId', async () => {
    let holding = true;
    const server = await endpoint((res) => {
      // The first request is never answered. The worker dies while it waits.
      if (!holding) res.writeHead(200).end();
    });
    const keyPrefixes = prefixes();
    const visibilityMs = 1000;
    const child = runNode(
      `
import { writeSync } from 'node:fs';
const { RedisQueue } = await import('@hexok/queue-redis');
const { Adapter, Event, EventCatalog } = await import('hexok');
const { z } = await import('zod');
const { Webhooks, WebhookEndpoints } = await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)});
class ReportSubmitted extends Event('report.submitted', z.object({ id: z.string() })) {}
class WebhookEvents extends EventCatalog('webhooks-it', { reportSubmitted: ReportSubmitted }) {}
const endpoint = { id: 'ep_1', url: process.env.URL, secrets: [process.env.SECRET] };
class OneEndpoint extends Adapter(WebhookEndpoints) {
  async subscribed() { return [endpoint]; }
  async get() { return endpoint; }
}
const queue = new RedisQueue({
  redis: process.env.REDIS_URL,
  keyPrefix: process.env.KEY_PREFIX,
  delayedPrefix: process.env.DELAYED_PREFIX,
  visibilityMs: Number(process.env.VISIBILITY_MS),
  promoteMs: 50,
  blockMs: 50,
});
await queue.start();
const webhooks = new Webhooks(
  {
    events: WebhookEvents,
    queue,
    endpoints: new OneEndpoint(),
    logger: { error: () => {} },
    hooks: {
      onWebhookCall: (call) => {
        // Synchronous, so the line is out before SIGKILL.
        writeSync(1, JSON.stringify({ webhookId: call.webhookId, deliveryId: call.deliveryId }) + '\\n');
        setTimeout(() => process.kill(process.pid, 'SIGKILL'), 300);
      },
    },
  },
  { httpsOnly: false, allowPrivate: true },
);
await webhooks.start();
await webhooks.publish({
  organizationId: 'org_1',
  eventId: 'report.submitted:r1:1',
  event: new ReportSubmitted({ id: 'r1' }),
});
`,
      {
        env: {
          URL: server.url,
          SECRET: secret,
          KEY_PREFIX: keyPrefixes.keyPrefix,
          DELAYED_PREFIX: keyPrefixes.delayedPrefix,
          VISIBILITY_MS: String(visibilityMs),
        },
      },
    );
    const killed = await child;
    expect(killed.signal).toBe('SIGKILL');
    expect(killed.stderr).toBe('');
    expect(server.arrivals).toHaveLength(1);
    const printed: unknown = JSON.parse(killed.stdout.trim());
    holding = false;

    const calls: Array<{
      webhookId: string;
      deliveryId: string;
      attempt: number;
    }> = [];
    await worker({
      url: server.url,
      prefixes: keyPrefixes,
      visibilityMs,
      hooks: {
        onWebhookCall: (call) =>
          void calls.push({
            webhookId: call.webhookId,
            deliveryId: call.deliveryId,
            attempt: call.attempt,
          }),
      },
    });
    await waitFor(() => server.arrivals.length === 2);
    // One redelivery, of the same attempt, with the ids the killed worker had.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.attempt).toBe(1);
    expect(printed).toEqual({
      webhookId: calls[0]?.webhookId,
      deliveryId: calls[0]?.deliveryId,
    });
    expect(server.arrivals[1]?.webhookId).toBe(server.arrivals[0]?.webhookId);
    expect(server.arrivals[1]?.verified).toBe(true);
  });
});
