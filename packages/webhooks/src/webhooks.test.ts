import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  Queue,
  type QueueHandler,
  type QueuePublishOptions,
  type QueueSubscribeOptions,
} from '@hexok/queue';
import { Adapter, Event, EventCatalog } from 'hexok';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { WebhookResult } from './http.js';
import { verify } from './signing.js';
import {
  type RetryPolicy,
  retryDelayMs,
  type WebhookEndpoint,
  WebhookEndpoints,
  WebhookError,
  type WebhookFailureInfo,
  type WebhookHooks,
  Webhooks,
  type WebhooksConfig,
} from './webhooks.js';

class ReportSubmitted extends Event(
  'report.submitted',
  z.object({ id: z.string(), title: z.string() }),
) {}
class ReportDue extends Event(
  'report.due',
  z.object({ id: z.string(), dueAt: z.date() }),
) {}
class Anything extends Event('anything', z.object({ value: z.unknown() })) {}
class TestEvents extends EventCatalog('webhooks-test', {
  reportSubmitted: ReportSubmitted,
  reportDue: ReportDue,
  anything: Anything,
}) {}

type TestEvent = ReportSubmitted | ReportDue | Anything;

/** Records each publish with its delay. A test runs the handler itself, one entry at a time. */
class DelayQueue extends Adapter(Queue) {
  readonly published: Array<{
    topic: string;
    payload: unknown;
    delayMs: number;
  }> = [];
  subscription: QueueSubscribeOptions<unknown> | undefined;
  unsubscribed = 0;
  /** A publish whose payload matches throws instead. */
  failOn: ((payload: unknown) => boolean) | undefined;

  async publish(
    topic: string,
    payload: unknown,
    options: QueuePublishOptions = {},
  ): Promise<string> {
    if (this.failOn?.(payload)) throw new Error('queue down');
    this.published.push({ topic, payload, delayMs: options.delayMs ?? 0 });
    return `${this.published.length}-0`;
  }

  // The port's `T` is the caller's claim about payloads. This fake keeps them unknown, as a broker does.
  subscribe<T>(topic: string, options: QueueSubscribeOptions<T>): Promise<void>;
  async subscribe(
    _topic: string,
    options: QueueSubscribeOptions<unknown>,
  ): Promise<void> {
    this.subscription = options;
  }

  async unsubscribe(): Promise<void> {
    this.unsubscribed += 1;
  }

  /** Runs the handler on one payload and resolves what it returned. */
  run(payload: unknown): ReturnType<QueueHandler<unknown>> {
    const handler = this.subscription?.handler;
    if (!handler) throw new Error('not subscribed');
    return handler({ id: '9-0', topic: 'webhooks', payload, deliveries: 1 });
  }

  /** Payloads published since the mark, then moves the mark. */
  #seen = 0;
  take(): unknown[] {
    const fresh = this.published.slice(this.#seen).map((item) => item.payload);
    this.#seen = this.published.length;
    return fresh;
  }
}

class MemoryEndpoints extends Adapter(WebhookEndpoints) {
  readonly rows = new Map<string, WebhookEndpoint & { events: string[] }>();
  subscribedCalls = 0;
  getCalls = 0;
  failGet: Error | undefined;
  failSubscribed: Error | undefined;

  async subscribed(
    _organizationId: string,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]> {
    this.subscribedCalls += 1;
    if (this.failSubscribed) throw this.failSubscribed;
    return [...this.rows.values()].filter((row) =>
      row.events.includes(eventType),
    );
  }

  async get(
    _organizationId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint | null> {
    this.getCalls += 1;
    if (this.failGet) throw this.failGet;
    return this.rows.get(endpointId) ?? null;
  }
}

const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const now = new Date('2026-11-05T12:00:00.000Z');

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
  verified: boolean;
}

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

/** A local endpoint. `respond` answers each request. Every request is checked with `verify`. */
async function endpointServer(
  respond: (res: ServerResponse) => void = (res) => res.writeHead(200).end(),
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({
        headers: req.headers,
        body,
        verified: verify({
          secrets: [secret],
          id: String(req.headers['webhook-id']),
          timestamp: String(req.headers['webhook-timestamp']),
          signature: String(req.headers['webhook-signature']),
          body,
          now,
        }),
      });
      respond(res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server has no port');
  }
  return { url: `http://127.0.0.1:${address.port}/in`, received };
}

function recordingLogger() {
  const errors: Array<{ message: string; fields: unknown }> = [];
  return {
    errors,
    error(message: string | Error, fields?: Record<string, unknown>) {
      errors.push({
        message: message instanceof Error ? message.message : message,
        fields,
      });
    },
  };
}

async function setup(
  options: {
    url?: string;
    hooks?: WebhookHooks<TestEvent>;
    hookTimeoutMs?: number;
    config?: WebhooksConfig;
  } = {},
) {
  const queue = new DelayQueue();
  const endpoints = new MemoryEndpoints();
  if (options.url !== undefined) {
    endpoints.rows.set('ep_1', {
      id: 'ep_1',
      url: options.url,
      secrets: [secret],
      events: ['report.submitted'],
    });
  }
  const logger = recordingLogger();
  const webhooks = new Webhooks(
    {
      events: TestEvents,
      queue,
      endpoints,
      logger,
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    },
    {
      httpsOnly: false,
      allowPrivate: true,
      now: () => now,
      random: () => 0.5,
      ...(options.hookTimeoutMs === undefined
        ? {}
        : { hookTimeoutMs: options.hookTimeoutMs }),
      ...options.config,
    },
  );
  await webhooks.start();
  return { queue, endpoints, logger, webhooks };
}

const report = () => new ReportSubmitted({ id: 'r1', title: 'Q3' });

/** Publishes one event, runs its fan-out, and resolves the delivery entries it wrote. */
async function fannedOut(
  ctx: Awaited<ReturnType<typeof setup>>,
  eventId = 'report.submitted:r1:1',
): Promise<unknown[]> {
  await ctx.webhooks.publish({
    organizationId: 'org_1',
    eventId,
    event: report(),
  });
  const [entry] = ctx.queue.take();
  expect(await ctx.queue.run(entry)).toBe('ack');
  return ctx.queue.take();
}

/** A copy of an entry with some fields changed. */
function patched(
  value: unknown,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('not an entry');
  }
  return { ...value, ...changes };
}

function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || !(name in value)) {
    return undefined;
  }
  return Object.entries(value).find(([key]) => key === name)?.[1];
}

describe('retryDelayMs', () => {
  const policy: RetryPolicy = {
    schedule: [5_000, 300_000],
    maxAttempts: 3,
    jitter: 0.2,
    maxRetryAfterMs: undefined,
  };

  it('follows the schedule with ±20% jitter and ends at maxAttempts', () => {
    expect(retryDelayMs(1, policy, 0.5)).toBe(5_000);
    expect(retryDelayMs(1, policy, 0)).toBe(4_000);
    expect(retryDelayMs(1, policy, 0.999_999)).toBe(6_000);
    expect(retryDelayMs(2, policy, 0.5)).toBe(300_000);
    expect(retryDelayMs(3, policy, 0.5)).toBeUndefined();
  });

  it('repeats the last delay past the schedule, and stops early under a smaller maxAttempts', () => {
    const longer = { ...policy, maxAttempts: 5 };
    expect(retryDelayMs(3, longer, 0.5)).toBe(300_000);
    expect(retryDelayMs(4, longer, 0.5)).toBe(300_000);
    expect(retryDelayMs(5, longer, 0.5)).toBeUndefined();
    expect(retryDelayMs(1, { ...policy, maxAttempts: 1 }, 0.5)).toBeUndefined();
    expect(retryDelayMs(1, { ...policy, schedule: [] }, 0.5)).toBeUndefined();
  });

  it('applies the configured jitter', () => {
    expect(retryDelayMs(1, { ...policy, jitter: 0 }, 0)).toBe(5_000);
    expect(retryDelayMs(1, { ...policy, jitter: 0.5 }, 0)).toBe(2_500);
    expect(retryDelayMs(1, { ...policy, jitter: 0.5 }, 0.999_999)).toBe(7_500);
  });

  it('clamps Retry-After between the delay and maxRetryAfterMs, twice the delay by default', () => {
    expect(retryDelayMs(1, policy, 0.5, 1_000)).toBe(5_000);
    expect(retryDelayMs(1, policy, 0.5, 7_000)).toBe(7_000);
    expect(retryDelayMs(1, policy, 0.5, 60_000)).toBe(10_000);
    const capped = { ...policy, maxRetryAfterMs: 3_600_000 };
    expect(retryDelayMs(1, capped, 0.5, 60_000)).toBe(60_000);
    expect(retryDelayMs(1, capped, 0.5, 7_200_000)).toBe(3_600_000);
    // A cap below the delay never shortens it.
    expect(
      retryDelayMs(1, { ...policy, maxRetryAfterMs: 1_000 }, 0.5, 60_000),
    ).toBe(5_000);
  });
});

describe('Webhooks config', () => {
  it('throws on a number out of range', () => {
    const deps = {
      events: TestEvents,
      queue: new DelayQueue(),
      endpoints: new MemoryEndpoints(),
      logger: recordingLogger(),
    };
    const cases: Array<[WebhooksConfig, string]> = [
      [{ concurrency: 0 }, 'webhooks: concurrency must be a positive integer'],
      [
        { endpointConcurrency: 1.5 },
        'webhooks: endpointConcurrency must be a positive integer',
      ],
      [
        { maxPayloadBytes: -1 },
        'webhooks: maxPayloadBytes must be a positive integer',
      ],
      [
        { maxResponseBytes: 0 },
        'webhooks: maxResponseBytes must be a positive integer',
      ],
      [{ timeoutMs: 0 }, 'webhooks: timeoutMs must be a finite number above 0'],
      [
        { hookTimeoutMs: Number.POSITIVE_INFINITY },
        'webhooks: hookTimeoutMs must be a finite number above 0',
      ],
      [
        { retrySchedule: [1000, Number.NaN] },
        'webhooks: every retrySchedule delay must be a finite number, zero or more',
      ],
      [{ maxAttempts: 0 }, 'webhooks: maxAttempts must be a positive integer'],
      [
        { retrySchedule: [], maxAttempts: 2 },
        'webhooks: maxAttempts above 1 needs at least one retrySchedule delay',
      ],
      [
        { retryJitter: 1.5 },
        'webhooks: retryJitter must be a number from 0 to 1',
      ],
      [
        { maxRetryAfterMs: -1 },
        'webhooks: maxRetryAfterMs must be a finite number, zero or more',
      ],
    ];
    for (const [config, message] of cases) {
      expect(() => new Webhooks(deps, config)).toThrow(message);
    }
    expect(
      () => new Webhooks(deps, { retrySchedule: [], maxAttempts: 1 }),
    ).not.toThrow();
  });
});

describe('Webhooks.publish', () => {
  it('writes one event entry and resolves the webhook-id', async () => {
    const { queue, webhooks } = await setup();
    const id = await webhooks.publish({
      organizationId: 'org_1',
      eventId: 'report.submitted:r1:1',
      event: report(),
    });
    expect(id).toMatch(/^msg_[0-9a-f]{26}$/);
    expect(queue.published).toEqual([
      {
        topic: 'webhooks',
        delayMs: 0,
        payload: {
          kind: 'event',
          organizationId: 'org_1',
          eventId: 'report.submitted:r1:1',
          key: 'reportSubmitted',
          data: { id: 'r1', title: 'Q3' },
          timestamp: '2026-11-05T12:00:00.000Z',
          failures: 0,
        },
      },
    ]);
  });

  it('rejects a payload over 256 KB, one that is not JSON, and an event with a Date field', async () => {
    const { queue, webhooks } = await setup();
    const publish = (event: TestEvent) =>
      webhooks.publish({ organizationId: 'org_1', eventId: 'e1', event });
    const large = publish(new Anything({ value: 'x'.repeat(256 * 1024) }));
    await expect(large).rejects.toSatisfy(
      (error) => WebhookError.is(error) && error.code === 'PayloadTooLarge',
    );
    await expect(publish(new Anything({ value: 1n }))).rejects.toSatisfy(
      (error) => WebhookError.is(error) && error.code === 'InvalidPayload',
    );
    await expect(
      publish(new ReportDue({ id: 'r1', dueAt: new Date() })),
    ).rejects.toSatisfy(
      (error) => WebhookError.is(error) && error.code === 'InvalidPayload',
    );
    // Just under the cap is accepted.
    await publish(new Anything({ value: 'x'.repeat(200 * 1024) }));
    expect(queue.published).toHaveLength(1);
  });
});

describe('Webhooks fan-out', () => {
  it('writes one delivery entry per subscribed endpoint, and no entry holds a secret', async () => {
    const ctx = await setup({ url: 'http://127.0.0.1:1/in' });
    ctx.endpoints.rows.set('ep_2', {
      id: 'ep_2',
      url: 'http://127.0.0.1:2/in',
      secrets: ['whsec_c2Vjb25kc2VjcmV0c2Vjb25kc2VjcmV0'],
      events: ['report.submitted'],
    });
    ctx.endpoints.rows.set('ep_3', {
      id: 'ep_3',
      url: 'http://127.0.0.1:3/in',
      secrets: [secret],
      events: ['report.due'],
    });
    const deliveries = await fannedOut(ctx);
    expect(deliveries.map((entry) => field(entry, 'endpointId'))).toEqual([
      'ep_1',
      'ep_2',
    ]);
    expect(deliveries.map((entry) => field(entry, 'attempt'))).toEqual([1, 1]);
    expect(
      new Set(deliveries.map((entry) => field(entry, 'deliveryId'))).size,
    ).toBe(2);
    const stored = JSON.stringify(ctx.queue.published);
    expect(stored).not.toContain('whsec_');
    expect(stored).not.toContain('127.0.0.1');
  });

  it('endpointIds limits a publish without calling subscribed()', async () => {
    const ctx = await setup({ url: 'http://127.0.0.1:1/in' });
    await ctx.webhooks.publish({
      organizationId: 'org_1',
      eventId: 'report.submitted:r1:1',
      event: report(),
      endpointIds: ['ep_9'],
    });
    const [entry] = ctx.queue.take();
    expect(await ctx.queue.run(entry)).toBe('ack');
    expect(ctx.queue.take().map((item) => field(item, 'endpointId'))).toEqual([
      'ep_9',
    ]);
    expect(ctx.endpoints.subscribedCalls).toBe(0);
  });

  it('a failed publish mid fan-out retries only the endpoints not yet published', async () => {
    const ctx = await setup();
    for (const id of ['ep_1', 'ep_2', 'ep_3', 'ep_4', 'ep_5']) {
      ctx.endpoints.rows.set(id, {
        id,
        url: `https://${id}.example.com/in`,
        secrets: [secret],
        events: ['report.submitted'],
      });
    }
    await ctx.webhooks.publish({
      organizationId: 'org_1',
      eventId: 'e1',
      event: report(),
    });
    const [entry] = ctx.queue.take();
    ctx.queue.failOn = (payload) => field(payload, 'endpointId') === 'ep_3';
    const first = await ctx.queue.run(entry);
    expect(first).toMatchObject({
      retryInMs: 30_000,
      payload: {
        kind: 'event',
        failures: 1,
        endpointIds: ['ep_3', 'ep_4', 'ep_5'],
      },
    });
    expect(ctx.logger.errors[0]?.message).toBe('queue down');
    ctx.queue.failOn = undefined;
    expect(await ctx.queue.run(field(first, 'payload'))).toBe('ack');
    expect(ctx.queue.take().map((item) => field(item, 'endpointId'))).toEqual([
      'ep_1',
      'ep_2',
      'ep_3',
      'ep_4',
      'ep_5',
    ]);
    // The retry used the ids it carried.
    expect(ctx.endpoints.subscribedCalls).toBe(1);
  });

  it('a throwing subscribed() is retried with backoff', async () => {
    const ctx = await setup();
    ctx.endpoints.failSubscribed = new Error('db down');
    await ctx.webhooks.publish({
      organizationId: 'org_1',
      eventId: 'e1',
      event: report(),
    });
    const [entry] = ctx.queue.take();
    const first = await ctx.queue.run(entry);
    expect(first).toMatchObject({
      retryInMs: 30_000,
      payload: { kind: 'event', failures: 1 },
    });
    const second = await ctx.queue.run(field(first, 'payload'));
    expect(second).toMatchObject({
      retryInMs: 60_000,
      payload: { failures: 2 },
    });
    expect(ctx.logger.errors[0]?.message).toBe('db down');
  });
});

describe('Webhooks delivery', () => {
  it('signs, sends the Standard Webhooks envelope, and runs the hooks in order, awaited', async () => {
    const order: string[] = [];
    const server = await endpointServer((res) => {
      order.push('request');
      res.writeHead(200).end('thanks');
    });
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookCall: async (call) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push(`call:${call.event.token}:${call.attempt}`);
        },
        onWebhookSuccess: async (_call, result) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push(`success:${result.status}:${result.responseBody}`);
        },
      },
    });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(order).toEqual([
      'call:report.submitted:1',
      'request',
      'success:200:thanks',
    ]);
    const [request] = server.received;
    expect(request?.verified).toBe(true);
    expect(JSON.parse(request?.body ?? '')).toEqual({
      type: 'report.submitted',
      timestamp: '2026-11-05T12:00:00.000Z',
      data: { id: 'r1', title: 'Q3' },
    });
    expect(request?.headers['webhook-id']).toMatch(/^msg_[0-9a-f]{26}$/);
    expect(request?.headers['webhook-timestamp']).toBe(
      String(now.getTime() / 1000),
    );
  });

  it('signs with every secret during a rotation', async () => {
    const server = await endpointServer();
    const ctx = await setup({ url: server.url });
    ctx.endpoints.rows.set('ep_1', {
      id: 'ep_1',
      url: server.url,
      secrets: ['whsec_bmV3c2VjcmV0bmV3c2VjcmV0bmV3c2VjcmV0', secret],
      events: ['report.submitted'],
    });
    const [delivery] = await fannedOut(ctx);
    await ctx.queue.run(delivery);
    const signature = String(server.received[0]?.headers['webhook-signature']);
    expect(signature.split(' ')).toHaveLength(2);
    expect(server.received[0]?.verified).toBe(true);
  });

  it('logs a throwing or hanging hook, aborts its signal, and leaves the result unchanged', async () => {
    const server = await endpointServer();
    let signal: AbortSignal | undefined;
    const ctx = await setup({
      url: server.url,
      hookTimeoutMs: 50,
      hooks: {
        onWebhookCall: () => {
          throw new Error('log store down');
        },
        onWebhookSuccess: (call) => {
          signal = call.signal;
          return new Promise(() => {});
        },
      },
    });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(server.received).toHaveLength(1);
    expect(signal?.aborted).toBe(true);
    expect(ctx.logger.errors).toEqual([
      {
        message: 'log store down',
        fields: expect.objectContaining({
          hook: 'onWebhookCall',
          endpointId: 'ep_1',
        }),
      },
      {
        message: 'webhooks: onWebhookSuccess did not finish within 50ms',
        fields: expect.objectContaining({
          hook: 'onWebhookSuccess',
          attempt: 1,
        }),
      },
    ]);
  });

  it('a 500 schedules attempt 2 at the first offset, and the 8th failure is exhausted', async () => {
    const server = await endpointServer((res) =>
      res.writeHead(500).end('boom'),
    );
    const failures: WebhookFailureInfo[] = [];
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookFailure: (_call, result, info) => {
          expect(result).toMatchObject({ status: 500, error: 'http' });
          failures.push(info);
        },
      },
    });
    const [fanned] = await fannedOut(ctx);
    // An attempt resets the push-back count.
    let entry: unknown = patched(fanned, { pushbacks: 2 });
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const outcome = await ctx.queue.run(entry);
      expect(outcome).toMatchObject({
        payload: { attempt: attempt + 1, pushbacks: 0 },
      });
      delays.push(Number(field(outcome, 'retryInMs')));
      entry = field(outcome, 'payload');
    }
    expect(await ctx.queue.run(entry)).toBe('ack');
    expect(delays).toEqual([
      5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000,
    ]);
    expect(failures[0]).toEqual({
      attempt: 1,
      exhausted: false,
      gone: false,
      nextAttemptAt: new Date(now.getTime() + 5_000),
    });
    expect(failures[7]).toEqual({ attempt: 8, exhausted: true, gone: false });
    expect(server.received).toHaveLength(8);
    // Every attempt carries the same webhook-id.
    expect(
      new Set(server.received.map((r) => r.headers['webhook-id'])).size,
    ).toBe(1);
  });

  it('a 410 reports gone and stops', async () => {
    const server = await endpointServer((res) => res.writeHead(410).end());
    const failures: WebhookFailureInfo[] = [];
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookFailure: (_call, _result, info) => void failures.push(info),
      },
    });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(failures).toEqual([{ attempt: 1, exhausted: true, gone: true }]);
  });

  it('honours Retry-After on a 503, clamped to twice the delay or to maxRetryAfterMs', async () => {
    const server = await endpointServer((res) =>
      res.writeHead(503, { 'retry-after': '3600' }).end(),
    );
    const ctx = await setup({ url: server.url });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toMatchObject({ retryInMs: 10_000 });
    const capped = await setup({
      url: server.url,
      config: { maxRetryAfterMs: 7_200_000 },
    });
    const [later] = await fannedOut(capped);
    expect(await capped.queue.run(later)).toMatchObject({
      retryInMs: 3_600_000,
    });
  });

  it('maxAttempts and retryJitter set the attempts and exact delays', async () => {
    const server = await endpointServer((res) => res.writeHead(500).end());
    const failures: WebhookFailureInfo[] = [];
    const ctx = await setup({
      url: server.url,
      config: { retrySchedule: [1_000], maxAttempts: 3, retryJitter: 0 },
      hooks: {
        onWebhookFailure: (_call, _result, info) => void failures.push(info),
      },
    });
    let [entry] = await fannedOut(ctx);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await ctx.queue.run(entry);
      expect(outcome).toMatchObject({ retryInMs: 1_000 });
      entry = field(outcome, 'payload');
    }
    expect(await ctx.queue.run(entry)).toBe('ack');
    expect(failures.map((info) => info.exhausted)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('shouldRetry ends retries for the failures it refuses, and a throw counts as true', async () => {
    const server = await endpointServer((res) => res.writeHead(400).end());
    const failures: WebhookFailureInfo[] = [];
    const seen: WebhookResult[] = [];
    const ctx = await setup({
      url: server.url,
      config: {
        shouldRetry: (result) => {
          seen.push(result);
          return result.status !== 400;
        },
      },
      hooks: {
        onWebhookFailure: (_call, _result, info) => void failures.push(info),
      },
    });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(seen).toEqual([expect.objectContaining({ status: 400 })]);
    expect(failures).toEqual([{ attempt: 1, exhausted: true, gone: false }]);

    const throwing = await setup({
      url: server.url,
      config: {
        shouldRetry: () => {
          throw new Error('policy broke');
        },
      },
    });
    const [again] = await fannedOut(throwing);
    expect(await throwing.queue.run(again)).toMatchObject({ retryInMs: 5_000 });
    expect(throwing.logger.errors[0]?.message).toBe('policy broke');
  });

  it('an endpoint retry policy overrides the config, and one that cannot work is logged and ignored', async () => {
    const server = await endpointServer((res) => res.writeHead(500).end());
    const ctx = await setup({ url: server.url });
    const row = ctx.endpoints.rows.get('ep_1');
    if (!row) throw new Error('missing endpoint');
    ctx.endpoints.rows.set('ep_1', {
      ...row,
      retry: { schedule: [2_000], maxAttempts: 2 },
    });
    const [delivery] = await fannedOut(ctx);
    const first = await ctx.queue.run(delivery);
    expect(first).toMatchObject({ retryInMs: 2_000 });
    expect(await ctx.queue.run(field(first, 'payload'))).toBe('ack');

    // A schedule alone sets the attempts to its length plus one.
    ctx.endpoints.rows.set('ep_1', { ...row, retry: { schedule: [] } });
    const [single] = await fannedOut(ctx, 'report.submitted:r2:1');
    expect(await ctx.queue.run(single)).toBe('ack');

    ctx.endpoints.rows.set('ep_1', { ...row, retry: { maxAttempts: 0 } });
    const [broken] = await fannedOut(ctx, 'report.submitted:r3:1');
    expect(await ctx.queue.run(broken)).toMatchObject({ retryInMs: 5_000 });
    expect(ctx.logger.errors.map((error) => error.message)).toEqual([
      'webhooks: endpoint retry ignored, maxAttempts must be a positive integer',
    ]);
  });

  it('keeps maxResponseBytes of the response body', async () => {
    const server = await endpointServer((res) =>
      res.writeHead(200).end('x'.repeat(100)),
    );
    const bodies: string[] = [];
    const ctx = await setup({
      url: server.url,
      config: { maxResponseBytes: 10 },
      hooks: {
        onWebhookSuccess: (_call, result) =>
          void bodies.push(result.responseBody),
      },
    });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(bodies).toEqual(['x'.repeat(10)]);
  });

  it('an endpoint with no secrets is not sent to, reports cancelled, and is logged', async () => {
    const server = await endpointServer();
    const failures: Array<{ url: string; error: unknown }> = [];
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookFailure: (call, result, info) => {
          failures.push({ url: call.endpoint.url, error: result.error });
          expect(info).toEqual({ attempt: 1, exhausted: true, gone: false });
        },
      },
    });
    const row = ctx.endpoints.rows.get('ep_1');
    if (!row) throw new Error('missing endpoint');
    ctx.endpoints.rows.set('ep_1', { ...row, secrets: [] });
    const [delivery] = await fannedOut(ctx);
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(failures).toEqual([{ url: server.url, error: 'cancelled' }]);
    expect(ctx.logger.errors.map((error) => error.message)).toEqual([
      'webhooks: endpoint ep_1 has no secrets',
    ]);
    expect(
      await ctx.webhooks.sendTest({
        endpoint: { id: 'ep_1', url: server.url, secrets: [] },
        event: report(),
      }),
    ).toEqual({ error: 'cancelled', durationMs: 0, responseBody: '' });
    expect(server.received).toEqual([]);
  });

  it('get() returning null sends nothing and reports cancelled', async () => {
    const server = await endpointServer();
    const calls: string[] = [];
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookCall: () => void calls.push('call'),
        onWebhookFailure: (call, result, info) => {
          calls.push('failure');
          expect(call.endpoint).toEqual({ id: 'ep_1', url: '' });
          expect(result).toEqual({
            error: 'cancelled',
            durationMs: 0,
            responseBody: '',
          });
          expect(info).toEqual({ attempt: 1, exhausted: true, gone: false });
        },
      },
    });
    const [delivery] = await fannedOut(ctx);
    ctx.endpoints.rows.delete('ep_1');
    expect(await ctx.queue.run(delivery)).toBe('ack');
    expect(calls).toEqual(['failure']);
    expect(server.received).toEqual([]);
  });

  it('a throwing get() is retried with backoff and leaves the attempt count unchanged', async () => {
    const server = await endpointServer();
    const ctx = await setup({ url: server.url });
    const [delivery] = await fannedOut(ctx);
    ctx.endpoints.failGet = new Error('cache down');
    const outcome = await ctx.queue.run(delivery);
    expect(outcome).toMatchObject({
      retryInMs: 30_000,
      payload: {
        kind: 'delivery',
        attempt: 1,
        failures: 1,
        deliveryId: field(delivery, 'deliveryId'),
      },
    });
    expect(server.received).toEqual([]);
  });

  it('drops and logs an entry that no longer parses', async () => {
    const ctx = await setup({ url: 'http://127.0.0.1:1/in' });
    const [delivery] = await fannedOut(ctx);
    // The schema now requires a field the entry lacks.
    expect(await ctx.queue.run(patched(delivery, { data: { id: 'r1' } }))).toBe(
      'drop',
    );
    // The event was removed from the catalog.
    expect(
      await ctx.queue.run(patched(delivery, { key: 'removedEvent' })),
    ).toBe('drop');
    expect(await ctx.queue.run(patched(delivery, { attempt: 0 }))).toBe('drop');
    expect(await ctx.queue.run({ kind: 'nonsense' })).toBe('drop');
    expect(ctx.logger.errors).toHaveLength(4);
    expect(ctx.endpoints.getCalls).toBe(0);
  });

  it('pushes back a sixth concurrent delivery to one endpoint without an attempt', async () => {
    const held: ServerResponse[] = [];
    let holding = true;
    const server = await endpointServer((res) => {
      if (holding) held.push(res);
      else res.writeHead(200).end();
    });
    const ctx = await setup({ url: server.url });
    const deliveries: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      deliveries.push(...(await fannedOut(ctx, `report.submitted:r${i}:1`)));
    }
    const running = deliveries.slice(0, 5).map((entry) => ctx.queue.run(entry));
    while (held.length < 5)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const sixth = deliveries[5];
    const pushed = await ctx.queue.run(sixth);
    expect(pushed).toEqual({
      retryInMs: 3000,
      payload: patched(sixth, { pushbacks: 1 }),
    });
    // Each push-back in a row doubles the wait, up to 60 s.
    expect(await ctx.queue.run(field(pushed, 'payload'))).toEqual({
      retryInMs: 6000,
      payload: patched(sixth, { pushbacks: 2 }),
    });
    expect(await ctx.queue.run(patched(sixth, { pushbacks: 5 }))).toEqual({
      retryInMs: 60_000,
      payload: patched(sixth, { pushbacks: 6 }),
    });
    expect(server.received).toHaveLength(5);
    holding = false;
    for (const res of held) res.writeHead(200).end();
    expect(await Promise.all(running)).toEqual([
      'ack',
      'ack',
      'ack',
      'ack',
      'ack',
    ]);
    // The slot frees once a send ends.
    expect(await ctx.queue.run(sixth)).toBe('ack');
  });

  it('a resend gets a new deliveryId and keeps the webhook-id', async () => {
    const server = await endpointServer();
    const deliveryIds: string[] = [];
    const ctx = await setup({
      url: server.url,
      hooks: {
        onWebhookSuccess: (call) => void deliveryIds.push(call.deliveryId),
      },
    });
    const [first] = await fannedOut(ctx);
    await ctx.queue.run(first);
    await ctx.webhooks.publish({
      organizationId: 'org_1',
      eventId: 'report.submitted:r1:1',
      event: report(),
      endpointIds: ['ep_1'],
    });
    const [resend] = ctx.queue.take();
    await ctx.queue.run(resend);
    const [second] = ctx.queue.take();
    await ctx.queue.run(second);
    expect(deliveryIds).toHaveLength(2);
    expect(deliveryIds[0]).not.toBe(deliveryIds[1]);
    expect(server.received[0]?.headers['webhook-id']).toBe(
      server.received[1]?.headers['webhook-id'],
    );
  });

  it('stop() aborts a send in progress and leaves the attempt pending', async () => {
    const server = await endpointServer(() => {});
    const ctx = await setup({ url: server.url });
    const [delivery] = await fannedOut(ctx);
    const pending = ctx.queue.run(delivery);
    while (server.received.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await ctx.webhooks.stop();
    expect(await pending).toBe('retry');
    expect(ctx.queue.unsubscribed).toBe(1);
  });
});

describe('Webhooks.start', () => {
  it('subscribes with the configured concurrency and no delivery ceiling', async () => {
    const { queue } = await setup();
    expect(queue.subscription).toMatchObject({
      consumerGroup: 'webhooks',
      maxDeliveries: 'unlimited',
      concurrency: 50,
    });
  });
});

describe('Webhooks.sendTest and checkUrl', () => {
  it('sendTest returns the result without touching the queue or the hooks', async () => {
    const server = await endpointServer((res) => res.writeHead(202).end('ok'));
    const calls: string[] = [];
    const ctx = await setup({
      hooks: { onWebhookCall: () => void calls.push('call') },
    });
    const result = await ctx.webhooks.sendTest({
      endpoint: { id: 'ep_new', url: server.url, secrets: [secret] },
      event: report(),
    });
    expect(result).toMatchObject({ status: 202, responseBody: 'ok' });
    expect(server.received[0]?.verified).toBe(true);
    expect(ctx.queue.published).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('checkUrl throws UnsafeUrl with the reason under the default options', async () => {
    const webhooks = new Webhooks({
      events: TestEvents,
      queue: new DelayQueue(),
      endpoints: new MemoryEndpoints(),
      logger: recordingLogger(),
    });
    for (const [url, reason] of [
      ['http://hooks.example.com', 'scheme'],
      ['https://10.1.2.3/in', 'blocked'],
      ['nope', 'invalid'],
    ] as const) {
      const error: unknown = await webhooks
        .checkUrl(url)
        .catch((e: unknown) => e);
      expect(
        WebhookError.is(error) && error.code === 'UnsafeUrl' && error.data,
      ).toEqual({ reason });
    }
  });
});
