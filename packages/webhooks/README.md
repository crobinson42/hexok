# @hexok/webhooks

Outbound webhooks. Install with `npm i @hexok/webhooks`. Payloads, headers, and signatures follow [Standard Webhooks](https://www.standardwebhooks.com/). Delivery runs on the `@hexok/queue` port, on any adapter that supports `delayMs` and retry results, such as `@hexok/queue-redis`.

The package resolves endpoints through a port, signs, sends, retries, and calls typed hooks. Each product stores its own endpoints and its own delivery logs.

## Define the events

The events a product offers to customer endpoints are a hexok `EventCatalog`. Keep them apart from domain events, so internal fields never leave.

```ts
import { Event, EventCatalog } from 'hexok';
import { z } from 'zod';

class ReportSubmitted extends Event('report.submitted', z.object({
  reportId: z.string(),
  title: z.string(),
})) {}

export class WebhookEvents extends EventCatalog('webhooks', {
  reportSubmitted: ReportSubmitted,
}) {}
```

The event's `token` is the envelope's `type`. Schemas describe JSON, the form the queue carries and the endpoint receives. `Date`, `bigint`, `Map`, and `Set` do not survive it. Use an ISO string for a time. A `z.date()` field fails at `publish`.

## Store the endpoints

The product implements one port.

```ts
import { WebhookEndpoints, type WebhookEndpoint } from '@hexok/webhooks';
import { Adapter } from 'hexok';

class MongoWebhookEndpoints extends Adapter(WebhookEndpoints) {
  async subscribed(organizationId: string, eventType: string): Promise<readonly WebhookEndpoint[]> {
    // enabled endpoints of the organization that list eventType
  }
  async get(organizationId: string, endpointId: string): Promise<WebhookEndpoint | null> {
    // the endpoint as it stands now, or null when disabled or deleted
  }
}
```

A `WebhookEndpoint` is `{ id, url, secrets }`. `secrets` holds `whsec_` secrets, newest first. Return two during a rotation window, and each request carries a signature for each.

- `subscribed` is called once per publish, by the worker.
- `get` is called before every attempt. At volume, cache it briefly. A cached secret lags a rotation by the cache time, which is safe while the old secret stays in the window.
- A throw from either is the sender's own failure. It is retried with backoff, and no attempt is counted.

## Publish

```ts
import { Webhooks } from '@hexok/webhooks';

const webhooks = new Webhooks(
  {
    events: WebhookEvents,
    queue: webhooksQueue,
    endpoints: new MongoWebhookEndpoints({ db }),
    logger,
    hooks,
  },
  { concurrency: 50 },
);

await webhooks.publish({
  organizationId,
  eventId: `report.submitted:${report.id}:${report.version}`,
  event: new ReportSubmitted({ reportId: report.id, title: report.title }),
});
```

`publish` validates the JSON form of the payload against its schema, checks that the envelope is at most `maxPayloadBytes`, and writes one queue entry. It resolves the `webhook-id`. It throws `WebhookError.InvalidPayload` when the payload has no JSON form or its JSON form fails the schema, and `WebhookError.PayloadTooLarge` when the envelope is too large. Nothing is written then.

`eventId` is the product's own id for the event. The `webhook-id` is `msg_` and the first 26 hex characters of SHA-256 over `organizationId`, a NUL byte, and `eventId`. A repeated publish of one event sends again with the same `webhook-id`, and receivers dedupe on it, as the spec asks.

Pass `endpointIds` to send only to those endpoints. `subscribed` is not called. A resend button republishes from the product's log with the same `eventId` and the endpoint's id. The receiver sees the same `webhook-id`, and the hooks see a new `deliveryId`.

## Run the worker

```ts
await webhooksQueue.start();
await webhooks.start();
// on shutdown
await webhooks.stop();
await webhooksQueue.stop();
```

`start` subscribes to the queue topic `webhooks` with the consumer group `webhooks`, `concurrency` handlers, and `maxDeliveries: 'unlimited'`. The attempt count lives in each entry. Call it in worker processes only. A process that only publishes does not start it.

The worker fans each published entry out into one delivery entry per endpoint. A delivery entry holds the endpoint id, never its URL or secrets. Before each attempt the worker calls `get`, signs the body with every secret, and sends.

`stop` aborts every send in progress, then unsubscribes. An aborted attempt runs no failure hook. Its entry stays pending, and another worker repeats the same attempt with the same `deliveryId`.

## Hooks

```ts
const hooks: WebhookHooks<EventInstance<typeof WebhookEvents>> = {
  onWebhookCall: (call) => deliveryLog.recordCall(call),
  onWebhookSuccess: (call, result) => deliveryLog.recordSuccess(call, result),
  onWebhookFailure: async (call, result, info) => {
    await deliveryLog.recordFailure(call, result, info);
    if (info.gone) await endpointRepo.disable(call.organizationId, call.endpoint.id, 'gone');
  },
};
```

`call.event` is the event rebuilt with the catalog's `parse`, so a hook narrows on `call.event.token`.

| `WebhookCall` field | Value |
| --- | --- |
| `organizationId`, `eventId` | From `publish`. |
| `webhookId` | The `webhook-id` header. The same on every attempt and every resend. |
| `deliveryId` | Random per endpoint delivery. The same across its retries. A resend gets a new one. |
| `event` | The typed event. |
| `endpoint` | `{ id, url }`. `url` is empty when `get` returned null. |
| `attempt` | 1-based. |
| `signal` | Aborted when this hook's timeout passes. |

`WebhookResult` is `{ status?, error?, durationMs, responseBody }`. `status` is absent when no response arrived. `responseBody` is the first 20 KB. `error` is one of `http`, `timeout`, `dns`, `tls`, `connection`, `blocked`, or `cancelled`. `WebhookFailureInfo` is `{ attempt, exhausted, gone, nextAttemptAt? }`.

- Hooks run in order, `onWebhookCall`, then the send, then `onWebhookSuccess` or `onWebhookFailure`. Each is awaited before the queue entry settles, up to `hookTimeoutMs`. Its `signal` aborts at the timeout.
- A hook that throws or times out is logged and changes nothing else. A hook that times out keeps running until it returns.
- Hooks run at least once. A crash after a hook and before the entry settles repeats that attempt and its hooks. `deliveryId` and `attempt` together are an idempotent key for a log row.
- When `get` returns null, no request is sent. `onWebhookFailure` runs with `error: 'cancelled'` and `exhausted: true`, so a log row that shows a next attempt can be closed.
- A slow hook holds a concurrency slot for up to its timeout.

## Endpoint forms

```ts
import { generateSecret } from '@hexok/webhooks';

await webhooks.checkUrl(input.url);
const secret = generateSecret();
const result = await webhooks.sendTest({ endpoint, event: new ReportSubmitted(sample) });
```

- `checkUrl` runs the sender's URL check: the scheme, then every address the host resolves to. It throws `WebhookError.UnsafeUrl` with `data.reason` of `invalid`, `scheme`, `blocked`, or `unresolved`. The sender checks again at connect time, so a host that later resolves to a private address still fails.
- `generateSecret` returns `whsec_` and 32 random bytes in base64.
- `sendTest` sends the event once, now, to the endpoint passed in, with the same checks. It uses no queue, no retries, and no hooks, and resolves the `WebhookResult`. Its `webhook-id` is random, so a receiver never dedupes a test against a real event.

## Guarantees

Delivery is at least once from a successful `publish`. A receiver can get an event more than once, so it dedupes on `webhook-id`.

- Every entry is a queue entry, so a delivery survives a worker crash and a restart of every worker. A worker killed mid-send leaves its entry pending, and another worker sends the same attempt with the same `webhook-id` and `deliveryId`.
- A 2xx is success. Any other status, and every send error, is a failure.
- A failure is retried on the schedule below. The retry is a queue retry result, so the entry is acked and its replacement scheduled in one step. A retry is never lost or doubled.
- A 410 Gone stops the delivery. The failure info has `gone` and `exhausted` set. The product disables the endpoint.
- A 3xx is a failure. Redirects are never followed.
- There is no order per endpoint. Retries and parallel sends reorder deliveries.
- A fan-out that fails partway is retried whole. The endpoints already written get a second delivery with the same `webhook-id`.

## Retries

| Attempt | Delay before it |
| --- | --- |
| 1 | none |
| 2 | 5 s |
| 3 | 5 min |
| 4 | 30 min |
| 5 | 2 h |
| 6 | 5 h |
| 7 | 10 h |
| 8 | 10 h |

Eight attempts over about 27.5 hours. Each delay gets ±20% jitter. On a 429, 502, 503, or 504, a `Retry-After` in seconds or as an HTTP date replaces the delay, clamped between the delay and twice it. The 8th failure reports `exhausted: true`.

The sender's own failures, a throw from `subscribed`, `get`, or the fan-out's queue publish, are retried at 30 s, doubling to 5 min, with no attempt counted. An entry that no longer parses, such as one for an event removed from the catalog, is logged and dropped.

Over the per-endpoint cap, a delivery is pushed back 1 to 5 s without counting an attempt. The cap is per process, so N worker processes send up to N times `endpointConcurrency` requests at once to one endpoint.

## Sending

Each send is one `POST` with `content-type: application/json` and the headers `webhook-id`, `webhook-timestamp`, and `webhook-signature`. The body is `{ type, timestamp, data }`. `type` is the event token, `timestamp` is the publish time as an ISO string, and `data` is the validated JSON form. `webhook-timestamp` is the send time of each attempt, in seconds.

- One deadline, `timeoutMs`, covers DNS, connect, TLS, and the response body. A server that trickles its response is cut off at the deadline.
- Only public addresses are allowed, IP literals included, unless `allowPrivate` is set. The socket's `lookup` resolves the host and checks every address. A host with any address that is not public fails as `blocked`, and the connection goes only to an address that passed, so DNS rebinding cannot slip past. An IP literal, IPv4-mapped IPv6 included, is checked before connecting.
- `httpsOnly` refuses `http:` URLs.
- A send opens its own connection and never reuses a pooled one. A pooled socket would skip the address check for that request.
- The first 20 KB of the response body is kept. The rest is not read.

## Signing

```ts
import { sign, verify, webhookId } from '@hexok/webhooks';

const signature = sign({ secret, id, timestamp, body });
const valid = verify({
  secrets: [secret],
  id: headers['webhook-id'],
  timestamp: headers['webhook-timestamp'],
  signature: headers['webhook-signature'],
  body: rawBody,
});
```

- `sign` returns `v1,` and the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`, keyed with the base64 part of the `whsec_` secret. `timestamp` is whole seconds.
- `verify` accepts a header of space-separated signatures and a list of secrets. One match is enough. It checks lengths before `timingSafeEqual`. It returns false for a malformed header, a malformed timestamp, or a timestamp more than 5 minutes from now.
- `webhookId(organizationId, eventId)` is the id `publish` uses. It never holds a dot.

## Configuration

`new Webhooks(deps, config)`. `deps` is `{ events, queue, endpoints, logger, hooks? }`. Every `config` field is optional.

| Option | Default | Why |
| --- | --- | --- |
| `concurrency` | `50` | Sends at once per worker process. It is the queue subscription's `concurrency`. |
| `endpointConcurrency` | `5` | Sends at once to one endpoint per worker process. Keeps one dead endpoint from filling every slot. |
| `timeoutMs` | `15000` | One deadline over DNS, connect, TLS, and the response body. The spec range is 15 to 30 seconds. |
| `hookTimeoutMs` | `10000` | How long each hook may run before it is logged and its signal aborts. |
| `retrySchedule` | the table above | The delay before each attempt after the first, in milliseconds. Its length plus one is the number of attempts. |
| `maxPayloadBytes` | `262144` | The largest serialized envelope `publish` accepts, 256 KB. |
| `httpsOnly` | `true` | Refuses `http:` endpoints. |
| `allowPrivate` | `false` | Allows private, loopback, and link-local addresses. For local development and tests. |
| `now` | the system clock | For tests. |
| `random` | `Math.random` | For tests. Drives the jitter and the push-back. |
| `resolve` | the operating system resolver | For tests. Resolves a host to every address. |

`httpsOnly` and `allowPrivate` come from the config only. The package never reads the environment.

These are fixed: the 20 KB response cap, ±20% jitter, the Retry-After clamp, the 1 to 5 s push-back, the 30 s to 5 min own-failure backoff, and the 5 minute `verify` tolerance.

### Errors

| Code | When |
| --- | --- |
| `InvalidPayload` | `publish` or `sendTest` got a payload with no JSON form, or whose JSON form fails its schema. |
| `PayloadTooLarge` | The serialized envelope is over `maxPayloadBytes`. |
| `UnsafeUrl` | `checkUrl` refused the URL. `data.reason` says why. |

Match with `WebhookError.is(error)` and `error.code`.

### Logs

The `logger` dep is structural. `@hexok/logger` and `console` fit it. Every log is at `error` and carries `package: 'webhooks'`. `organizationId` and `eventId` name the event. A delivery adds `endpointId`, `deliveryId`, and `attempt`.

| Event | Fields |
| --- | --- |
| A queue entry no longer parses and is dropped | `package`, `id`, the queue entry id |
| `subscribed`, `get`, or the fan-out's queue publish throws | `package`, `organizationId`, `eventId`, and the delivery fields on a delivery |
| A hook throws | the delivery fields, plus `hook` |
| A hook does not finish within `hookTimeoutMs` | the delivery fields, plus `hook` |

A send failure is not logged. It goes to `onWebhookFailure`.

## The queue

Give webhooks its own queue instance, on a durable Redis profile: AOF on and `maxmemory-policy noeviction`.

```ts
const webhooksQueue = new RedisQueue({
  redis,
  keyPrefix: 'webhooks:',
  delayedPrefix: 'webhooks-delayed:',
  retentionMs: 3_600_000,
  maxLen: 200_000,
  stopTimeoutMs: 35_000,
});
```

- Acknowledged entries stay in the stream until the age trim, and `MAXLEN ~` counts them. With the defaults, a day of fan-out, delivery, and retry entries would push out pending ones. Set `retentionMs` to 1 to 2 hours, and `maxLen` to at least the peak entries per second times that retention.
- A pending retry holds its payload in the delayed set for up to about 27.5 hours. At 2 KB a payload, one million pending retries take about 2 GB.
- Set the queue's `stopTimeoutMs` to at least `timeoutMs` plus two `hookTimeoutMs`, 35 seconds with the defaults, and fit it in the orchestrator's grace period.

## What it leaves to the application

- Endpoint storage. The product stores endpoints, their event types, and their enabled state, and implements `WebhookEndpoints` over them.
- Secrets at rest. The product encrypts secrets in its store. They are in the worker's memory while it sends, and never in Redis.
- Delivery logs. The hooks receive every call, success, and failure. The product writes them where its UI reads them.
- Disabling endpoints. The package stops a delivery on a 410 and reports exhausted ones. The product decides when to disable an endpoint, and `get` returning null stops its pending deliveries.
- The outbox. The guarantee starts at a successful `publish`. A crash between the product's own write and `publish` loses the event unless the product uses an outbox. Pass the outbox row's id in `eventId`.
- Redis sizing. The product sizes `maxLen`, `retentionMs`, and Redis memory from its peak rate, as above.
- Event versions. A breaking payload change is a new event type, such as `report.submitted.v2`.
