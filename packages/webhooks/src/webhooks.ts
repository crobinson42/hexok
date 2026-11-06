import { randomUUID } from 'node:crypto';
import type {
  Queue,
  QueueDisposition,
  QueueMessage,
  QueueRetryIn,
} from '@hexok/queue';
import { Errors, Port, type StandardSchemaV1 } from 'hexok';
import {
  checkUrl as checkHttpUrl,
  type HttpOptions,
  type SendOutcome,
  send,
  systemResolver,
  type UnsafeUrlReason,
  type WebhookResolver,
  type WebhookResult,
} from './http.js';
import { sign, webhookId } from './signing.js';

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  /** whsec_ secrets, newest first. Return two during a rotation window. */
  readonly secrets: readonly string[];
}

export abstract class WebhookEndpoints extends Port('WebhookEndpoints') {
  /** Enabled endpoints of this organization that receive this event token. Called once per publish, by the worker. */
  abstract subscribed(
    organizationId: string,
    eventType: string,
  ): Promise<readonly WebhookEndpoint[]>;
  /** The endpoint as it stands now, or null when disabled or deleted. Called before every attempt. */
  abstract get(
    organizationId: string,
    endpointId: string,
  ): Promise<WebhookEndpoint | null>;
}

/** An event of the catalog. Its `token` is the envelope's `type`. */
export interface WebhookEvent {
  readonly token: string;
  readonly payload: unknown;
}

/** What `Webhooks` uses of a hexok `EventCatalog`. Pass the catalog class. */
export interface WebhookEventCatalog<E extends WebhookEvent> {
  message(event: E): { readonly key: string; readonly payload: unknown };
  parse(value: unknown): E;
}

export interface WebhookCall<E> {
  readonly organizationId: string;
  /** The product's id. */
  readonly eventId: string;
  /** The webhook-id header, the same on every attempt and every resend. */
  readonly webhookId: string;
  /** Random per endpoint delivery, the same across its retries. A resend gets a new one. */
  readonly deliveryId: string;
  /** Rebuilt with the catalog's parse. Narrows on `event.token`. */
  readonly event: E;
  /** `url` is empty when `get()` returned null, because the endpoint is gone. */
  readonly endpoint: { readonly id: string; readonly url: string };
  /** 1-based. */
  readonly attempt: number;
  /** Aborted when this hook's timeout passes. */
  readonly signal: AbortSignal;
}

export interface WebhookFailureInfo {
  readonly attempt: number;
  /** No further attempt is scheduled. */
  readonly exhausted: boolean;
  /** The endpoint answered 410. */
  readonly gone: boolean;
  /** Set when another attempt is scheduled. */
  readonly nextAttemptAt?: Date;
}

export interface WebhookHooks<E> {
  onWebhookCall?(call: WebhookCall<E>): void | Promise<void>;
  onWebhookSuccess?(
    call: WebhookCall<E>,
    result: WebhookResult,
  ): void | Promise<void>;
  onWebhookFailure?(
    call: WebhookCall<E>,
    result: WebhookResult,
    info: WebhookFailureInfo,
  ): void | Promise<void>;
}

/** Structural logger. `@hexok/logger` and `console` fit it. */
export interface WebhookLogger {
  error(message: string | Error, fields?: Record<string, unknown>): void;
}

export interface WebhooksDeps<E extends WebhookEvent> {
  readonly events: WebhookEventCatalog<E>;
  /** A queue that supports `delayMs` and retry results, such as a `RedisQueue`. The app starts and stops it. */
  readonly queue: Queue;
  readonly endpoints: WebhookEndpoints;
  readonly logger: WebhookLogger;
  readonly hooks?: WebhookHooks<E>;
}

export interface WebhooksConfig {
  /** Sends at once per worker process. Default 50. */
  readonly concurrency?: number;
  /** Sends at once to one endpoint per worker process. Default 5. */
  readonly endpointConcurrency?: number;
  /** One deadline over DNS, connect, TLS, and the response body. Default 15000. */
  readonly timeoutMs?: number;
  /** How long each hook may run. Default 10000. */
  readonly hookTimeoutMs?: number;
  /** The delay before each attempt after the first, in milliseconds. Its length plus one is the number of attempts. */
  readonly retrySchedule?: readonly number[];
  /** The largest serialized payload `publish` accepts. Default 262144, 256 KB. */
  readonly maxPayloadBytes?: number;
  /** Refuses `http:` endpoints. Default true. */
  readonly httpsOnly?: boolean;
  /** Allows private and loopback addresses. Default false. For local development and tests. */
  readonly allowPrivate?: boolean;
  /** For tests. Defaults to the system clock. */
  readonly now?: () => Date;
  /** For tests. A number in [0, 1). Defaults to `Math.random`. */
  readonly random?: () => number;
  /** For tests. Defaults to the operating system resolver. */
  readonly resolve?: WebhookResolver;
}

export interface WebhookPublish<E> {
  readonly organizationId: string;
  /** The product's id for this event, such as `report.submitted:<id>:<version>`. The webhook-id derives from it. */
  readonly eventId: string;
  readonly event: E;
  /** Sends only to these endpoints, without calling `subscribed()`. For a resend. */
  readonly endpointIds?: readonly string[];
}

export interface WebhookTest<E> {
  readonly endpoint: WebhookEndpoint;
  readonly event: E;
}

const REASONS: readonly UnsafeUrlReason[] = [
  'invalid',
  'scheme',
  'blocked',
  'unresolved',
];

const unsafeUrlData: StandardSchemaV1<{ readonly reason: UnsafeUrlReason }> = {
  '~standard': {
    version: 1,
    vendor: 'hexok-webhooks',
    validate(value) {
      if (typeof value === 'object' && value !== null && 'reason' in value) {
        const reason = REASONS.find((known) => known === value.reason);
        if (reason !== undefined) return { value: { reason } };
      }
      return { issues: [{ message: 'reason is not an UnsafeUrlReason' }] };
    },
  },
};

export class WebhookError extends Errors('webhooks', {
  UnsafeUrl: { message: 'Webhook URL is not allowed', data: unsafeUrlData },
  InvalidPayload: { message: 'Webhook payload is not valid for its event' },
  PayloadTooLarge: { message: 'Webhook payload is too large' },
}) {}

/** Svix's schedule: 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h. Eight attempts over about 27.5 hours. */
const RETRY_SCHEDULE = [
  5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000,
];

/** Statuses whose `Retry-After` is honoured. */
const THROTTLED = new Set([429, 502, 503, 504]);

const TOPIC = 'webhooks';
const GROUP = 'webhooks';

const CANCELLED: WebhookResult = {
  error: 'cancelled',
  durationMs: 0,
  responseBody: '',
};

/**
 * Milliseconds until the attempt after `attempt`, or undefined when `attempt` was the last.
 * The schedule's delay gets ±20% jitter from `random`. A `retryAfterMs` replaces it, clamped between the delay and twice it.
 */
export function retryDelayMs(
  attempt: number,
  schedule: readonly number[],
  random: number,
  retryAfterMs?: number,
): number | undefined {
  const base = schedule[attempt - 1];
  if (base === undefined) return undefined;
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(retryAfterMs, base), base * 2);
  }
  return Math.round(base * (0.8 + 0.4 * random));
}

/** Our own failures back off from 30 s, doubling to 5 min. */
function ownBackoffMs(failures: number): number {
  return Math.min(30_000 * 2 ** failures, 300_000);
}

/** Fields shared by both entry kinds. `data` is the payload's JSON form. `failures` counts our own failures in a row. */
interface EntryBase {
  readonly organizationId: string;
  readonly eventId: string;
  readonly key: string;
  readonly data: unknown;
  readonly timestamp: string;
  readonly failures: number;
}

/** A published event, before fan-out. */
interface EventEntry extends EntryBase {
  readonly kind: 'event';
  readonly endpointIds?: readonly string[];
}

/** One endpoint's delivery. It holds the endpoint id, never its URL or secrets. */
interface DeliveryEntry extends EntryBase {
  readonly kind: 'delivery';
  readonly endpointId: string;
  readonly deliveryId: string;
  readonly attempt: number;
}

type Entry = EventEntry | DeliveryEntry;

type Outcome = QueueDisposition | QueueRetryIn<Entry>;

type HookOutcome = { failed: false } | { failed: true; error: unknown };

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isCount(value: unknown, min: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min
  );
}

/** The entry, or undefined when the value is not one. */
function entryOf(value: unknown): Entry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (
    !('kind' in value) ||
    !('organizationId' in value) ||
    !('eventId' in value) ||
    !('key' in value) ||
    !('data' in value) ||
    !('timestamp' in value) ||
    !('failures' in value)
  ) {
    return undefined;
  }
  const { organizationId, eventId, key, data, timestamp, failures } = value;
  if (
    typeof organizationId !== 'string' ||
    typeof eventId !== 'string' ||
    typeof key !== 'string' ||
    typeof timestamp !== 'string' ||
    !isCount(failures, 0)
  ) {
    return undefined;
  }
  const base = { organizationId, eventId, key, data, timestamp, failures };
  if (value.kind === 'event') {
    if (!('endpointIds' in value)) return { kind: 'event', ...base };
    const { endpointIds } = value;
    return isStringArray(endpointIds)
      ? { kind: 'event', ...base, endpointIds }
      : undefined;
  }
  if (
    value.kind !== 'delivery' ||
    !('endpointId' in value) ||
    !('deliveryId' in value) ||
    !('attempt' in value)
  ) {
    return undefined;
  }
  const { endpointId, deliveryId, attempt } = value;
  if (
    typeof endpointId !== 'string' ||
    typeof deliveryId !== 'string' ||
    !isCount(attempt, 1)
  ) {
    return undefined;
  }
  return { kind: 'delivery', ...base, endpointId, deliveryId, attempt };
}

/** The Standard Webhooks envelope, `{ type, timestamp, data }`, serialized. */
function bodyOf(type: string, timestamp: string, data: unknown): string {
  return JSON.stringify({ type, timestamp, data });
}

/**
 * Sends a catalog's events to the endpoints a product stores, over a queue.
 * `publish` writes one entry. The worker fans it out to one delivery per endpoint, signs, sends, retries, and calls the hooks.
 */
export class Webhooks<E extends WebhookEvent> {
  readonly #events: WebhookEventCatalog<E>;
  readonly #queue: Queue;
  readonly #endpoints: WebhookEndpoints;
  readonly #logger: WebhookLogger;
  readonly #hooks: WebhookHooks<E>;
  readonly #concurrency: number;
  readonly #endpointConcurrency: number;
  readonly #hookTimeoutMs: number;
  readonly #retrySchedule: readonly number[];
  readonly #maxPayloadBytes: number;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #http: HttpOptions;
  /** Sends in progress per organization and endpoint, in this process. */
  readonly #active = new Map<string, number>();
  /** Aborts every send on `stop()`. */
  #stopping = new AbortController();

  constructor(deps: WebhooksDeps<E>, config: WebhooksConfig = {}) {
    this.#events = deps.events;
    this.#queue = deps.queue;
    this.#endpoints = deps.endpoints;
    this.#logger = deps.logger;
    this.#hooks = deps.hooks ?? {};
    this.#concurrency = config.concurrency ?? 50;
    this.#endpointConcurrency = config.endpointConcurrency ?? 5;
    this.#hookTimeoutMs = config.hookTimeoutMs ?? 10_000;
    this.#retrySchedule = config.retrySchedule ?? RETRY_SCHEDULE;
    this.#maxPayloadBytes = config.maxPayloadBytes ?? 256 * 1024;
    this.#now = config.now ?? (() => new Date());
    this.#random = config.random ?? Math.random;
    this.#http = {
      httpsOnly: config.httpsOnly ?? true,
      allowPrivate: config.allowPrivate ?? false,
      timeoutMs: config.timeoutMs ?? 15_000,
      resolve: config.resolve ?? systemResolver,
    };
  }

  /**
   * Validates the event's JSON form and size, then writes one queue entry. Resolves the webhook-id.
   * Throws `WebhookError.InvalidPayload` when the payload has no JSON form or its JSON form fails the schema, such as a `Date` field,
   * and `WebhookError.PayloadTooLarge` when the envelope is over `maxPayloadBytes`.
   */
  async publish(input: WebhookPublish<E>): Promise<string> {
    const timestamp = this.#now().toISOString();
    const { key, data } = this.#prepare(input.event, timestamp);
    const entry: EventEntry = {
      kind: 'event',
      organizationId: input.organizationId,
      eventId: input.eventId,
      key,
      data,
      timestamp,
      failures: 0,
      ...(input.endpointIds === undefined
        ? {}
        : { endpointIds: input.endpointIds }),
    };
    await this.#queue.publish(TOPIC, entry);
    return webhookId(input.organizationId, input.eventId);
  }

  /** Subscribes the worker to the queue. Call it in worker processes only. */
  async start(): Promise<void> {
    this.#stopping = new AbortController();
    await this.#queue.subscribe(TOPIC, {
      consumerGroup: GROUP,
      // The attempt count lives in the entry, so the queue never gives up.
      maxDeliveries: 'unlimited',
      concurrency: this.#concurrency,
      handler: (message) => this.#handle(message),
    });
  }

  /** Aborts every send in progress, then unsubscribes. An aborted attempt stays pending and runs again in another worker. */
  async stop(): Promise<void> {
    this.#stopping.abort();
    await this.#queue.unsubscribe(TOPIC, { consumerGroup: GROUP });
  }

  /** Runs the sender's URL check for an endpoint form. Throws `WebhookError.UnsafeUrl` with the reason. */
  async checkUrl(url: string): Promise<void> {
    const checked = await checkHttpUrl(url, this.#http);
    if (!checked.ok) throw WebhookError.UnsafeUrl({ reason: checked.code });
  }

  /** Sends the event once, now, to this endpoint, with the same checks. No queue, retries, or hooks. */
  async sendTest(input: WebhookTest<E>): Promise<WebhookResult> {
    const timestamp = this.#now().toISOString();
    const { data } = this.#prepare(input.event, timestamp);
    const id = webhookId(input.endpoint.id, randomUUID());
    const body = bodyOf(input.event.token, timestamp, data);
    return (await this.#send(input.endpoint, id, body)).result;
  }

  /** The event's catalog key and JSON form, checked against its schema and the size cap. */
  #prepare(event: E, timestamp: string): { key: string; data: unknown } {
    const { key, payload } = this.#events.message(event);
    let data: unknown;
    try {
      data = JSON.parse(JSON.stringify(payload));
    } catch {
      throw WebhookError.InvalidPayload(
        `webhooks: "${event.token}" payload is not JSON`,
      );
    }
    try {
      this.#events.parse({ key, payload: data });
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : '';
      throw WebhookError.InvalidPayload(
        `webhooks: "${event.token}" payload fails its schema in JSON form${reason}`,
      );
    }
    const bytes = Buffer.byteLength(bodyOf(event.token, timestamp, data));
    if (bytes > this.#maxPayloadBytes) {
      throw WebhookError.PayloadTooLarge(
        `webhooks: "${event.token}" payload is ${bytes} bytes, over ${this.#maxPayloadBytes}`,
      );
    }
    return { key, data };
  }

  /** An entry that no longer parses is logged and dropped. */
  async #handle(message: QueueMessage<unknown>): Promise<Outcome> {
    const entry = entryOf(message.payload);
    let event: E;
    try {
      if (entry === undefined) throw new Error('webhooks: not a webhook entry');
      event = this.#events.parse({ key: entry.key, payload: entry.data });
    } catch (error) {
      this.#logger.error(
        error instanceof Error
          ? error
          : new Error('webhooks: entry parse failed'),
        { package: 'webhooks', id: message.id },
      );
      return 'drop';
    }
    return entry.kind === 'event'
      ? this.#fanOut(entry, event)
      : this.#deliver(entry, event);
  }

  /** Publishes one delivery entry per endpoint. */
  async #fanOut(entry: EventEntry, event: E): Promise<Outcome> {
    try {
      const endpointIds =
        entry.endpointIds ??
        (
          await this.#endpoints.subscribed(entry.organizationId, event.token)
        ).map((endpoint) => endpoint.id);
      for (const endpointId of endpointIds) {
        const delivery: DeliveryEntry = {
          kind: 'delivery',
          organizationId: entry.organizationId,
          eventId: entry.eventId,
          key: entry.key,
          data: entry.data,
          timestamp: entry.timestamp,
          failures: 0,
          endpointId,
          deliveryId: randomUUID(),
          attempt: 1,
        };
        await this.#queue.publish(TOPIC, delivery);
      }
      return 'ack';
    } catch (error) {
      return this.#ownFailure(entry, error);
    }
  }

  /** Over the per-endpoint cap, the delivery is pushed back 1 to 5 s without counting an attempt. */
  async #deliver(entry: DeliveryEntry, event: E): Promise<Outcome> {
    const slot = `${entry.organizationId}\0${entry.endpointId}`;
    const active = this.#active.get(slot) ?? 0;
    if (active >= this.#endpointConcurrency) {
      return {
        retryInMs: 1000 + Math.floor(this.#random() * 4000),
        payload: entry,
      };
    }
    this.#active.set(slot, active + 1);
    try {
      return await this.#attempt(entry, event);
    } finally {
      const left = (this.#active.get(slot) ?? 1) - 1;
      if (left === 0) this.#active.delete(slot);
      else this.#active.set(slot, left);
    }
  }

  async #attempt(entry: DeliveryEntry, event: E): Promise<Outcome> {
    let endpoint: WebhookEndpoint | null;
    try {
      endpoint = await this.#endpoints.get(
        entry.organizationId,
        entry.endpointId,
      );
    } catch (error) {
      return this.#ownFailure(entry, error);
    }
    const call: Omit<WebhookCall<E>, 'signal'> = {
      organizationId: entry.organizationId,
      eventId: entry.eventId,
      webhookId: webhookId(entry.organizationId, entry.eventId),
      deliveryId: entry.deliveryId,
      event,
      endpoint: { id: entry.endpointId, url: endpoint?.url ?? '' },
      attempt: entry.attempt,
    };
    const fields = this.#fields(entry);
    if (endpoint === null) {
      await this.#hook('onWebhookFailure', call, fields, (withSignal) =>
        this.#hooks.onWebhookFailure?.(withSignal, CANCELLED, {
          attempt: entry.attempt,
          exhausted: true,
          gone: false,
        }),
      );
      return 'ack';
    }
    await this.#hook('onWebhookCall', call, fields, (withSignal) =>
      this.#hooks.onWebhookCall?.(withSignal),
    );
    const outcome = await this.#send(
      endpoint,
      call.webhookId,
      bodyOf(event.token, entry.timestamp, entry.data),
    );
    const { result } = outcome;
    if (result.error === undefined) {
      await this.#hook('onWebhookSuccess', call, fields, (withSignal) =>
        this.#hooks.onWebhookSuccess?.(withSignal, result),
      );
      return 'ack';
    }
    // stop() cut the send short. The entry stays pending, and the same attempt runs again in another worker.
    if (result.error === 'cancelled') return 'retry';
    const gone = result.status === 410;
    const retryAfterMs =
      result.status !== undefined && THROTTLED.has(result.status)
        ? outcome.retryAfterMs
        : undefined;
    const delayMs = gone
      ? undefined
      : retryDelayMs(
          entry.attempt,
          this.#retrySchedule,
          this.#random(),
          retryAfterMs,
        );
    const info: WebhookFailureInfo =
      delayMs === undefined
        ? { attempt: entry.attempt, exhausted: true, gone }
        : {
            attempt: entry.attempt,
            exhausted: false,
            gone,
            nextAttemptAt: new Date(this.#now().getTime() + delayMs),
          };
    await this.#hook('onWebhookFailure', call, fields, (withSignal) =>
      this.#hooks.onWebhookFailure?.(withSignal, result, info),
    );
    if (delayMs === undefined) return 'ack';
    return {
      retryInMs: delayMs,
      payload: { ...entry, attempt: entry.attempt + 1, failures: 0 },
    };
  }

  /** Signs with every secret and sends. The stop signal aborts it. */
  #send(
    endpoint: WebhookEndpoint,
    id: string,
    body: string,
  ): Promise<SendOutcome> {
    const timestamp = Math.floor(this.#now().getTime() / 1000);
    const signature = endpoint.secrets
      .map((secret) => sign({ secret, id, timestamp, body }))
      .join(' ');
    return send(
      {
        url: endpoint.url,
        headers: {
          'webhook-id': id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signature,
        },
        body,
        signal: this.#stopping.signal,
      },
      this.#http,
    );
  }

  /** A throw from `subscribed()`, `get()`, or the fan-out publish. Retried with backoff, and no attempt is counted. */
  #ownFailure(entry: Entry, error: unknown): QueueRetryIn<Entry> {
    this.#logger.error(
      error instanceof Error
        ? error
        : new Error('webhooks: endpoint lookup failed'),
      this.#fields(entry),
    );
    return {
      retryInMs: ownBackoffMs(entry.failures),
      payload: { ...entry, failures: entry.failures + 1 },
    };
  }

  /**
   * Runs one hook with its own signal, awaited up to `hookTimeoutMs`. The signal aborts at the timeout.
   * A throw or a timeout is logged and changes nothing else.
   */
  async #hook(
    name: keyof WebhookHooks<E>,
    call: Omit<WebhookCall<E>, 'signal'>,
    fields: Record<string, unknown>,
    run: (call: WebhookCall<E>) => void | Promise<void> | undefined,
  ): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.#hookTimeoutMs);
    });
    // It never rejects, so a hook that throws after its timeout is not an unhandled rejection.
    const finished = Promise.resolve()
      .then(() => run({ ...call, signal: controller.signal }))
      .then(
        (): HookOutcome => ({ failed: false }),
        (error: unknown): HookOutcome => ({ failed: true, error }),
      );
    const outcome = await Promise.race([finished, timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      const error = new Error(
        `webhooks: ${name} did not finish within ${this.#hookTimeoutMs}ms`,
      );
      controller.abort(error);
      this.#logger.error(error, { ...fields, hook: name });
    } else if (outcome.failed) {
      this.#logger.error(
        outcome.error instanceof Error
          ? outcome.error
          : new Error(`webhooks: ${name} failed`),
        { ...fields, hook: name },
      );
    }
  }

  #fields(entry: Entry): Record<string, unknown> {
    return entry.kind === 'event'
      ? {
          package: 'webhooks',
          organizationId: entry.organizationId,
          eventId: entry.eventId,
        }
      : {
          package: 'webhooks',
          organizationId: entry.organizationId,
          eventId: entry.eventId,
          endpointId: entry.endpointId,
          deliveryId: entry.deliveryId,
          attempt: entry.attempt,
        };
  }
}
