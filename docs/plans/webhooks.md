# @hexok/webhooks: implementation plan

Handoff for Claude Code, written 2026-11-05 from the "Webhooks for hexok" Claude Doc (research and plan).

## How to work this plan

- Read `AGENTS.md` first and follow it: package layout, tests beside source, changesets, README voice.
- Phase 0 is signed off: Cory asked for the package and approved the `@hexok/queue` major release on 2026-11-05.
- Do the phases in order and commit each one separately. A phase is done when its "Done when" tests pass with `npx turbo run lint type-check test`.
- Open items below that are still unticked use the defaults written in this plan. Do not invent new options.
- If the code disagrees with this plan, stop and ask instead of working around it.

## Summary

One new package, `@hexok/webhooks`, and three additions to `@hexok/queue` and `@hexok/queue-redis`: `delayMs` on publish, `concurrency` on subscribe, and a `{ retryInMs }` handler result that acknowledges an entry and schedules its replacement in one step. The package is an outbound sender. Each product owns its endpoints and its delivery logs; the package resolves endpoints through a port, signs, sends, retries, and calls typed hooks. Delivery runs on a Redis-backed `Queue`. The plan is grounded in commit `05d8134`.

Decisions behind it: outbound only; customer organizations register endpoint URLs, but each product stores them; millions of events a day; each product runs its own workers; no ordering per endpoint; Standard Webhooks payloads; logging and persistence are the product's job through hooks; the product disables failing endpoints.

## Packages and files

One new package with four source files, and changes to two existing ones. The new package copies `package.json` scripts, `tsconfig.json`, `tsconfig.check.json` and `vitest.config.ts` from `packages/sms` and joins the root `tsconfig.json` references. Tests sit beside their source.

| File | Holds |
| --- | --- |
| **`packages/webhooks`** → `@hexok/webhooks` (new) | Depends on `hexok` and `@hexok/queue`. No other runtime dependency. |
| `src/webhooks.ts` | The `WebhookEndpoints` port, the call and hook types, the `WebhookError` catalog, the retry schedule as a pure function, and the `Webhooks` class with `publish`, `start`, `stop`, `checkUrl` and `sendTest`. Takes an injectable clock and random source for tests. |
| `src/signing.ts` | Standard Webhooks `sign()` and `verify()` (lengths checked before `timingSafeEqual`), `generateSecret()` and the deterministic `webhookId()`. All on `node:crypto`. |
| `src/http.ts` | `send()`: `node:https` whose socket `lookup` checks every resolved address and IP literal against a `net.BlockList` and connects only to a checked address, so DNS rebinding cannot slip past. One total deadline with an abort signal, no redirects, a 20 KB response cap. `checkUrl()` runs the same check for the endpoint form. The resolver is injectable for tests. |
| `src/index.ts` | Public exports. |
| **`packages/queue`** → `@hexok/queue` (major) | `delayMs` on publish, `concurrency` on subscribe, and the `{ retryInMs, payload? }` handler result. Major, because every adapter must now honour all three or throw. |
| **`packages/queue-redis`** → `@hexok/queue-redis` (major, follows the port) | The delayed set and its promote script, the atomic retry script, a slot pool shared by reads and recovery, and a recovery loop that keeps its cursor. Changes `redis-queue.ts`, `scripts.ts`, `maintain.ts`, the README tables and the ACL line. |

## Developer experience

A product writes one adapter for its endpoints, its hooks, and one `publish` call per event. Event types come from a hexok `EventCatalog`, so `publish` and every hook's `call.event` are typed end to end.

```ts
// domain: the events this product offers customers
class ReportSubmitted extends Event('report.submitted', reportSubmittedSchema) {}
export class WebhookEvents extends EventCatalog('webhooks', { reportSubmitted: ReportSubmitted }) {}

// infra: the product's own endpoints, stored however it likes
class MongoWebhookEndpoints extends Adapter(WebhookEndpoints) {
  async subscribed(organizationId: string, eventType: string) { /* enabled endpoints that list eventType */ }
  async get(organizationId: string, endpointId: string) { /* null when disabled or deleted */ }
}

// runtime: one per process; webhooksQueue is a RedisQueue the app starts and stops
const webhooks = new Webhooks({
  events: WebhookEvents,
  queue: webhooksQueue,
  endpoints: new MongoWebhookEndpoints({ db }),
  logger,
  hooks: {
    onWebhookCall: (call) => deliveryLog.recordCall(call),
    onWebhookSuccess: (call, result) => deliveryLog.recordSuccess(call, result),
    onWebhookFailure: async (call, result, info) => {
      await deliveryLog.recordFailure(call, result, info);
      if (info.gone) await endpointRepo.disable(call.organizationId, call.endpoint.id, 'gone');
    },
  },
}, { concurrency: 50 }); // httpsOnly defaults to true, allowPrivate to false
await webhooks.start(); // worker process only: subscribes to the queue

// a use case
await webhooks.publish({
  organizationId,
  eventId: `report.submitted:${report.id}:${report.version}`,
  event: new ReportSubmitted({ ... }),
});

// the product's endpoint form and "Send test" button
await webhooks.checkUrl(input.url); // same SSRF options as the sender; throws WebhookError.UnsafeUrl
const secret = generateSecret();    // whsec_…; the product encrypts and stores it
const result = await webhooks.sendTest({ endpoint, event: new ReportSubmitted(sample) });
```

Product UIs build endpoint screens on the product's own endpoint records, and log screens on whatever its hooks write. The package adds `checkUrl`, `generateSecret` and `sendTest` for the endpoint form. The names in this sketch are proposals that phases 2 and 3 fix.

## Endpoint port and hooks

The product implements one port and may pass up to three hooks. `E` is the union of the catalog's events, so a hook switches on the event's type with full typing.

```ts
export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  /** whsec_ secrets, newest first. Return two during a rotation window. */
  readonly secrets: readonly string[];
}

export abstract class WebhookEndpoints extends Port('WebhookEndpoints') {
  /** Enabled endpoints of this organization that receive this event token. Called once per publish, by the worker. */
  abstract subscribed(organizationId: string, eventType: string): Promise<readonly WebhookEndpoint[]>;
  /** The endpoint as it stands now, or null when disabled or deleted. Called before every attempt. */
  abstract get(organizationId: string, endpointId: string): Promise<WebhookEndpoint | null>;
}

export interface WebhookCall<E> {
  readonly organizationId: string;
  readonly eventId: string;    // the product's id
  readonly webhookId: string;  // the webhook-id header, the same on every attempt and every resend
  readonly deliveryId: string; // random per endpoint delivery, the same across its retries; a resend gets a new one
  readonly event: E;           // rebuilt with the catalog's parse; narrows on event.token
  readonly endpoint: { readonly id: string; readonly url: string };
  readonly attempt: number;    // 1-based
  readonly signal: AbortSignal; // aborted when this hook's timeout passes
}

export interface WebhookResult {
  readonly status?: number;    // absent when no response arrived
  readonly error?: 'http' | 'timeout' | 'dns' | 'tls' | 'connection' | 'blocked' | 'cancelled';
  readonly durationMs: number;
  readonly responseBody: string; // first 20 KB
}

export interface WebhookFailureInfo {
  readonly attempt: number;
  readonly exhausted: boolean;   // no further attempt is scheduled
  readonly gone: boolean;        // the endpoint answered 410
  readonly nextAttemptAt?: Date; // set when another attempt is scheduled
}

export interface WebhookHooks<E> {
  onWebhookCall?(call: WebhookCall<E>): void | Promise<void>;
  onWebhookSuccess?(call: WebhookCall<E>, result: WebhookResult): void | Promise<void>;
  onWebhookFailure?(call: WebhookCall<E>, result: WebhookResult, info: WebhookFailureInfo): void | Promise<void>;
}
```

- **Hooks are awaited** before the queue entry is settled, each limited by `hookTimeoutMs`, and `call.signal` aborts at that timeout. A hook that throws or times out is logged through the `logger` dep and never changes the result or the retry.
- **Hooks run at least once.** A crash after a hook and before settling repeats that attempt and its hooks. `deliveryId` and `attempt` together are an idempotent key for a log row, and a resend's new `deliveryId` keeps it from overwriting the original rows.
- **`get()` returning null** ends the delivery with no request. `onWebhookFailure` fires with `error: 'cancelled'` and `exhausted: true`, so a log row showing a next attempt gets closed.
- **A throw from `subscribed()` or `get()` is our failure.** It is retried with backoff and no attempt is counted.
- **Secrets never enter Redis.** Delivery entries carry the endpoint id; the worker reads the URL and secrets through `get()` just before sending.
- **Typed rebuild.** The entry stores `WebhookEvents.message(event)`, and the worker rebuilds it with `WebhookEvents.parse`. `publish` validates the JSON form first, as `IntegrationPublisher` does, so a value that does not survive JSON, such as a `Date`, fails at publish instead of in the worker. The envelope's `type` is the event's `token`.

## Queue changes

Three additions to the port, all generic: email and SMS retries can use the delay and the retry result, and any I/O-bound handler can use the concurrency. The Redis adapter needs more work than the port suggests, because its recovery path was built for low volume. This is the largest phase.

| Change | Port (`@hexok/queue`) | Redis adapter (`@hexok/queue-redis`) |
| --- | --- | --- |
| Delayed publish | `publish(topic, payload, { delayMs })`. Omitted or 0 publishes now. Resolves an id for the delayed entry. | `ZADD` to `<delayedPrefix><topic>`, default prefix `hexok:queue-delayed:`, so `maintain()` never mistakes it for a stream. A member is a unique id plus the encoded entry and its `sensitive` flag, so identical payloads never merge. A Lua script moves due entries into the stream with `XADD … MAXLEN ~`, at most 1,000 a run, using Redis `TIME`. It skips a run while the stream is over a back-pressure mark below `maxLen`. Every subscription runs it every `promoteMs` (default 1000). |
| Retry result | A handler may return `{ retryInMs, payload? }`. | One script acknowledges the entry and adds its replacement to the delayed set, so a retry is never lost or doubled. The replacement starts at delivery 1. |
| Concurrent handlers | `subscribe(topic, { concurrency })`, default 1, which is today's behaviour. | A slot pool shared by the read loop and recovery. A read asks only for free slots, entries join the heartbeat when they arrive, and `stop()` waits for every running handler. |
| Recovery at volume | No change | `XAUTOCLAIM` keeps its cursor between runs and loops while a full batch comes back, dispatching into the slot pool. Today it scans 10 entries from the head every `visibilityMs / 2` and runs them one at a time. |

- The ACL line gains `+zadd` for `publish` and `+zrangebyscore +zrem +xlen` for the scripts, and the key pattern gains `~hexok:queue-delayed:*`. The integration test that runs the README's ACL line covers them.
- A failed `ZADD` is scrubbed before it is logged or parked, because the ioredis error carries the payload.
- Both scripts take every key they touch in `KEYS`. The adapter does not support Redis Cluster today; if it ever does, a `{topic}` hash tag keeps the stream and its delayed set in one slot.
- Only commands available on Redis 8.0 and the adapter's existing 6.2 minimum are used. Some deployments run 8.0, so `XADD … ACKED` (8.2) and `IDMP` (8.6) are out of scope.
- The test `MemoryQueue` classes in `queue`, `integration-events` and the app-template are updated for the major version. The port's doc states that an adapter that cannot delay must throw.
- Webhooks gets its own `RedisQueue` instance on the durable Redis profile (AOF, `noeviction`). Acknowledged entries stay in a stream until the age trim and `MAXLEN ~` counts them, so the webhooks queue sets `retentionMs` to 1 to 2 hours and `maxLen` to at least the peak entries per second times that retention.

## Behaviour defaults

Every default is a readonly config field with a README table entry, as hexok adapters document theirs.

| Setting | Default | Basis |
| --- | --- | --- |
| Retry schedule | 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h (8 attempts, about 27.5 h), ±20% jitter | Svix |
| `Retry-After` on 429, 502, 503 or 504 | Honoured, clamped between the base delay and twice it | Svix; the spec asks producers to throttle on these |
| 410 Gone | No more attempts; failure info has `gone` and `exhausted` set. The product disables the endpoint | Standard Webhooks spec |
| 3xx | Failure, never followed | Hook0, Outpost, Svix |
| Request deadline | 15 s total, covering DNS, connect, TLS and the response body | Hook0; spec range 15 to 30 s |
| Stored response body | First 20 KB | Svix |
| Concurrency | 50 sends at once per worker process | Proposal; Svix caps at 500 |
| Per-endpoint cap | 5 sends at once to one endpoint per worker process; over the cap, the delivery is pushed back 1 to 5 s without counting an attempt | Proposal; keeps one dead endpoint from filling every slot |
| Hook timeout | 10 s per hook, with an abort signal | Proposal |
| Our own failures | Retried at 30 s, doubling to 5 min, with no attempt counted. An entry that no longer parses is logged and dropped | Outpost, plus backoff so it cannot spin |
| Stop timeout | The webhooks queue's `stopTimeoutMs` is at least the deadline plus two hook timeouts (35 s); `send` aborts on stop | Follows from the deadline |
| Payload | Standard Webhooks envelope `{ type, timestamp, data }`, JSON form validated, up to 256 KB serialized, rejected at publish | Spec; the size is a proposal |
| `webhook-id` | `msg_` plus the first 26 hex characters of SHA-256 over organizationId, a NUL byte and eventId: the same for a repeated publish, never a dot | The spec forbids dots in the id |
| Secret | 32 random bytes as `whsec_` | Svix, Outpost |
| Verify tolerance | ±5 min on `webhook-timestamp` | Standard Webhooks library |
| SSRF | Public addresses only, IP literals included, checked at connect time. `httpsOnly` defaults to true and `allowPrivate` to false, both explicit config, never read from the environment | Hook0, Outpost, Svix |

- **Two entry kinds on one topic.** `publish` writes one queue entry. The worker fans it out: it calls `subscribed()` and publishes one delivery entry per endpoint. A failed attempt returns `{ retryInMs, payload }` with the next attempt number, which the queue applies atomically.
- **Targeted publish.** `publish({ ..., endpointIds })` sends only to those endpoints. A product's resend button republishes from its own log with the same `eventId`: the receiver sees the same `webhook-id`, and the hooks see a new `deliveryId`.
- **`sendTest`** sends once, now, to the endpoint passed in, with the same connect-time SSRF check, and no queue, retries or hooks. It returns the `WebhookResult` for the UI.
- **The per-endpoint cap is per process**, so N worker processes send up to 5 × N requests at once to one endpoint.

## Phases

Six phases, each closed by tests that pass in CI. The queue changes come first: the sender's retries depend on them, and they are the largest piece of work.

0. **Scope gate sign-off.** Done, see the top of this file.
1. **Queue changes** (`@hexok/queue`, `@hexok/queue-redis`). Done when:
   - A delayed entry is not delivered before its due time, and arrives within `promoteMs` plus `blockMs` after it while a slot is free.
   - Two instances promoting at once deliver each delayed entry once; two identical payloads delayed together are both delivered; a delayed entry survives a restart of every instance.
   - A promote run moves at most 1,000 entries and skips while the stream is over its back-pressure mark.
   - `{ retryInMs }` leaves the entry acknowledged and its replacement in the delayed set after one script call, with no state where both or neither exist.
   - With `concurrency: 5`, five slow handlers run at once, none is reclaimed while it runs, and `stop()` waits for all of them.
   - 1,000 entries left pending by a killed consumer are all redelivered within a few recovery runs, not 10 per run.
   - With the new options omitted, the existing suite passes unchanged; `maintain()` does not report the delayed set; the README's ACL line passes its integration test.
2. **Signing and HTTP** (`signing.ts`, `http.ts`). Done when:
   - `sign()` with secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, id `msg_p5jXN8AQM9LWM0D4loKWxJek`, timestamp `1614265330` and body `{"test": 2432232314}` returns `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`, the Standard Webhooks library's own vector.
   - `verify()` rejects a changed body, a wrong secret, a malformed signature and a timestamp 6 minutes off, and accepts either of two secrets.
   - `webhookId()` returns the same id for the same inputs, different ids for (`a:b`, `c`) and (`a`, `b:c`), and never a dot.
   - 2xx is success; a 301 fails and its `Location` is never requested; a server sending one byte every few seconds is cut off at 15 s; a 1 MB response is stored as 20 KB.
   - `https://127.0.0.1`, `https://[::1]`, `https://169.254.169.254` and `https://[::ffff:10.0.0.1]` are blocked; a hostname resolving to one public and one `10.0.0.1` address is blocked at connect time; plain `http` fails under `httpsOnly`.
3. **The `Webhooks` class** on a test queue that supports delay, with an injected clock and random source. Done when:
   - `publish` rejects a payload over 256 KB, one that is not JSON, and an event with a `Date` field, and otherwise writes one entry.
   - Fan-out writes one delivery entry per subscribed endpoint, and no queue entry contains a secret.
   - Hooks run in order and are awaited; a throwing or hanging hook is logged, its signal aborts, and the result is unchanged.
   - A 500 returns attempt 2 at the schedule's offset with `exhausted: false`; the 8th failure reports `exhausted: true`; a 410 reports `gone: true` and stops.
   - `get()` returning null sends no request and reports `cancelled`; a throwing `get()` leaves the attempt count unchanged; an entry that no longer parses is dropped.
   - A sixth concurrent delivery to one endpoint is pushed back without an attempt; `endpointIds` limits a publish; a resend gets a new `deliveryId`; `sendTest` returns a result without touching the queue.
4. **End to end on Redis** (`webhooks.integration.test.ts`, which needs `REDIS_URL` like the queue tests). Done when a publish reaches a local server whose `verify()` passes, a failing server receives the retry after its delay, and a worker process killed mid-send leads to a second delivery with the same `webhook-id` and `deliveryId`, using a short `visibilityMs` for the test.
5. **Example and release.** In `examples/app-template`: an in-memory `WebhookEndpoints`, hooks that write to the logger, `start()` in `worker.ts`, and a publish from a domain event handler. The README has guarantees, a config table, a logs table, and a "What it leaves to the application" section like `integration-events` has: endpoint storage, encrypting secrets at rest, delivery logs, disabling endpoints, the outbox, Redis sizing. Changesets: `@hexok/queue` and `@hexok/queue-redis` major, `@hexok/webhooks` new.

## Scope gate answers

| Option | Pros | Cons and risks | Upkeep |
| --- | --- | --- | --- |
| No change | Nothing new in hexok | Each product writes signing, retries, SSRF checks and backoff itself, and the queue still cannot delay | None in hexok; one copy per product |
| A recipe in the docs, code in each app | No new package | Security-sensitive code is copied and drifts; the queue gap remains | One docs page |
| One package plus the queue changes (chosen) | One tested sender in four files; delay, the retry result and concurrency also help email, SMS and integration-event handlers | A breaking port change; the queue-redis work touches recovery and stop, its most delicate code | One package, a queue major release, a sorted set and two Lua scripts to maintain |

On gate question 4, nothing ties applications to a vendor. Endpoints sit behind a port the product implements, delivery runs on any `Queue` adapter that supports delay, and the package's only runtime dependencies are `hexok` and `@hexok/queue`.

## Risks

- **The guarantee starts at a successful `publish()`.** From there every delivery happens at least once. Before that, atomicity is the product's job: a crash between its own write and `publish` loses the event unless it uses an outbox.
- **Trimming can drop work.** Acknowledged entries stay in the stream until the age trim, and `MAXLEN ~` counts them, so with the defaults a day of fan-out, delivery and retry entries would push out pending ones. The webhooks queue's short `retentionMs` and its `maxLen` sizing prevent that.
- **Redis memory.** A pending retry holds its payload in the delayed set for up to about 27.5 h. At 2 KB a payload, one million pending retries take about 2 GB.
- **Hooks repeat after a crash**, and a slow hook holds a concurrency slot for up to its timeout.
- **`get()` runs before every attempt.** At millions of deliveries a day the product should cache it briefly. A cached secret lags a rotation by the cache time, which is safe while the old secret stays in the rotation window.
- **A repeated publish sends twice** with the same `webhook-id`; receivers dedupe on it, as the spec asks.
- **No ordering per endpoint.** Retries and parallel sends reorder deliveries.
- **Secrets are the product's to protect.** They live in the product's store, encrypted at rest, and in the worker's memory while sending, never in Redis.

## Open items

- [ ] Confirm the webhooks queue runs on the durable Redis profile, and size `maxLen` from the busiest product's peak rate. Deployment only; no code depends on it.
- [ ] Approve or change the proposal defaults: 50 concurrent sends, 5 per endpoint, 10 s hook timeout, 1 s promote interval, 256 KB payloads. Build with these until told otherwise.
- [x] `@hexok/queue` and `@hexok/queue-redis` ship the changes as a major release (decided 2026-11-05).
- [ ] Event versioning: a breaking payload change becomes a new type name such as `report.submitted.v2`, or reuses `Message` versions from `@hexok/integration-events`. Not needed for v1.
- [ ] Confirm that `sendTest` should skip the hooks. Build it that way until told otherwise.

## Progress

### Phase 1: queue changes (2026-11-05)

Done. `@hexok/queue` has `delayMs`, `concurrency` and the `QueueRetryIn<T>` result (`{ retryInMs, payload? }`). `@hexok/queue-redis` has the delayed set, the promote and retry scripts in `scripts.ts`, the shared slot pool, and the cursor-keeping recovery loop. Each "Done when" item has a test in `redis-queue.integration.test.ts` that runs on Redis 8.0 and, for the scripts and ACL, on 6.2 as well. The existing queue and queue-redis tests pass with no change to any test body or assertion.

Decisions the plan left open:

- **Back-pressure mark.** It is 90% of `maxLen`, a constant, not an option. A promote run moves at most `min(1000, mark - XLEN)`, so one run never crosses the mark. It replies -1 when the stream is at the mark.
- **Slots and reads.** The read loop and `XAUTOCLAIM` wait for at least one free slot, then ask for `min(batch, free)`. They hold no slot while they block, so a blocking read cannot starve recovery. Each entry takes its slot when its handler starts. An entry waiting for a slot stays in the heartbeat. With the default `concurrency: 1`, a read asks for one entry, not `batch`. Handlers still run one at a time, as before, but a default subscription now makes one `XREADGROUP` per entry. The read loop and recovery no longer run two handlers at once, which the old code allowed.
- **Delayed publish clock.** `publish({ delayMs })` is a plain `ZADD`, as the ACL row in the plan implies, so its due time is on the publisher's clock. Promotion and the retry script use Redis `TIME`. Clock skew between an app host and Redis shifts a delayed publish by that skew. The README says so.
- **Retry result edge cases.** A `retryInMs` that is not a finite number, zero or more, or a replacement payload that fails to encode, counts as a handler throw and follows `onError`. When the retry script finds the entry no longer pending, it adds nothing, so a reclaimed entry is not retried twice. `retryInMs` is rounded up to whole milliseconds.
- **Scrubbing.** A failed `ZADD` and a failed retry script are scrubbed for every entry, not only sensitive ones, as the plan says. A failed `XADD` is still scrubbed only when sensitive, as before.
- **`maintain()`.** It filters scanned keys that start with `delayedPrefix`. That only matters when a custom `keyPrefix` covers the delayed prefix. The defaults never overlap.
- **Test `MemoryQueue`s** in `queue`, `integration-events` and the app-template throw on `delayMs` and on a retry result, as the port doc now requires of an adapter that cannot delay.
- **Changesets** for the two majors are in this phase's commit, with the code, as AGENTS.md asks. Phase 5 adds the `@hexok/webhooks` one.

For a reviewer:

- **`FakeRedis` in `redis-queue.test.ts` learned the new scripts.** Every subscription now runs the promote script every `promoteMs`, as the plan requires, even with the new options omitted. The fake threw `unknown script` for any script it did not model, which failed one existing test that advances fake timers past 1 s. The fake now replies 0 to the promote script and models the retry script and `ZADD`. No existing test body or assertion changed. Confirm this reading of "passes unchanged".
- **The slot pool and `stop()`** in `redis-queue.ts`: `#freeSlots`, `#takeSlot`, `#releaseSlot`, `#handleBatch`, and `handlersOf`, which now waits for `running` after the read loop and recovery runs end. This is the recovery and stop code the plan calls delicate.
- **A default deployment.** With `maxLen` 10,000 and one day of retention, a topic that writes more than about 9,000 entries a day sits at the mark, and its delayed entries wait until the age trim brings it down. The webhooks queue sizing in the plan avoids this. Other users of `delayMs` need the same sizing. The README states it.

### Phase 2: signing and HTTP (2026-11-05)

Done. `packages/webhooks` exists with `signing.ts`, `http.ts`, their tests, a short README, and the `@hexok/webhooks` changeset. The Standard Webhooks vector matches. The 15 s cut-off test runs at the real default and takes 15 s.

Decisions the plan left open:

- **Function shapes.** `sign({ secret, id, timestamp, body })` takes `timestamp` in whole seconds. `verify({ secrets, id, timestamp, signature, body, now? })` takes the three header values as received and returns a boolean. It does not throw on bad input. A `whsec_` prefix is optional on input, as in the reference library.
- **`WebhookResult` lives in `http.ts`**, because `send` produces it. `webhooks.ts` imports it for the hook types, and `index.ts` exports it. The file list is unchanged.
- **`http.ts` `checkUrl`** returns hexok's `Result<URL, UnsafeUrlReason>` with `invalid`, `scheme`, `blocked` or `unresolved`. Phase 3's `Webhooks.checkUrl` turns a failure into `WebhookError.UnsafeUrl`. This keeps `http.ts` free of the error catalog and of an import cycle.
- **`send` never rejects.** A URL that fails the scheme or literal check returns `error: 'blocked'` without a connection. Aborting the caller's signal returns `cancelled`. Error codes map to `dns`, `tls` or `connection`.
- **One private address blocks the host.** This follows the "Done when" item. The resolver is called once, by the socket's `lookup`, and nothing resolves ahead of it.
- **The blocked ranges** are the IPv4 and IPv6 special-use ranges: loopback, private, link-local, CGNAT, documentation, benchmarking, multicast, reserved, unique-local, NAT64 and 6to4. `BlockList` matches IPv4 rules against IPv4-mapped IPv6 too.
- **New package version.** It is `0.0.0` with a minor changeset, so it publishes as 0.1.0. It depends on `@hexok/queue` `^1.0.0`, the workspace version. Changesets moves that range to `^2.0.0` when it versions the major. `package-lock.json` gains the workspace link.

For a reviewer:

- **`agent: false`.** Every send opens a new TCP and TLS connection. A keep-alive pool would let a socket opened under one check, or one `allowPrivate` setting, carry a later request. At millions of sends a day this costs a handshake per send. A per-instance agent that checks the address on every new socket would remove that cost. It is not in the plan, so it is not built.
- **`http.ts` `send`** settles once from four events: response `end`, response `error`, response `close` without completion, and request `error`. Review that state handling.

### Phase 3: the `Webhooks` class (2026-11-05)

Done. `webhooks.ts` holds the `WebhookEndpoints` port, the call and hook types, `WebhookError`, `retryDelayMs`, and `Webhooks` with `publish`, `start`, `stop`, `checkUrl` and `sendTest`. `webhooks.test.ts` covers every "Done when" item on a test queue that records `delayMs`, with a fixed clock and `random: () => 0.5`, against a local server that checks every request with `verify()`.

Decisions the plan left open:

- **Config names.** `concurrency` (50), `endpointConcurrency` (5), `timeoutMs` (15000), `hookTimeoutMs` (10000), `retrySchedule` (the Svix delays), `maxPayloadBytes` (262144), `httpsOnly` (true), `allowPrivate` (false), and the test seams `now`, `random` and `resolve`. The 20 KB response cap, ±20% jitter, the Retry-After clamp, the 1 to 5 s push-back, the own-failure backoff and the 5 min verify tolerance are fixed behaviour. The README states them. They are not options.
- **Topic and group.** Both are the constant `'webhooks'`. A product gets its own `RedisQueue` with its own `keyPrefix`, so no option is needed.
- **Entries.** An event entry is `{ kind: 'event', organizationId, eventId, key, data, timestamp, failures, endpointIds? }`. A delivery entry adds `endpointId`, `deliveryId` and `attempt`. `data` is the validated JSON form, and the body sent is `{ type: event.token, timestamp, data }`, so receivers get exactly what was validated. `timestamp` is the publish time. `webhook-timestamp` is the send time of each attempt. `failures` counts our own failures in a row and drives the 30 s to 5 min backoff.
- **`endpointIds` skips `subscribed()`.** A targeted publish writes one delivery per listed id. `get()` before the attempt still drops a disabled or deleted endpoint as `cancelled`. Filtering through `subscribed()` would stop a resend to an endpoint that has since unsubscribed from the event type.
- **`call.endpoint.url` is `''` when `get()` returns null.** Entries never hold the URL, because a URL such as a Slack incoming-webhook URL can itself be a secret.
- **Validation errors** are `WebhookError.InvalidPayload` (no JSON form, or the JSON form fails the schema; the message carries the schema error) and `WebhookError.PayloadTooLarge`. `WebhookError.UnsafeUrl` carries `{ reason }`. The schema's `issues` are not carried over.
- **A send that `stop()` aborted** returns `'retry'` without a failure hook. The entry stays pending, and another worker repeats the same attempt with the same `deliveryId`.
- **`publish` resolves the `webhook-id`**, which is useful for logs. `sendTest` uses a random `webhook-id`, so a receiver never dedupes a test against a real event.
- **`send` returns `{ result, retryAfterMs? }`.** `WebhookResult` stays exactly the plan's type. Retry-After is honoured only on 429, 502, 503 and 504.

For a reviewer:

- **The test queue's `subscribe` is an overload.** The port's `subscribe<T>` asks an adapter to hand a `T` it cannot check. The sibling fakes cast `options.handler as QueueHandler<unknown>`. `DelayQueue` in `webhooks.test.ts` instead declares the generic signature and implements it with `unknown`, which TypeScript accepts without a cast. Decide whether that counts as a cast under the team's rule.
- **`#hook`** races the hook against a timer and builds the hook's promise so it never rejects, so a hook that throws after its timeout is not an unhandled rejection. A hook that times out keeps running in the background. Only its signal tells it to stop.
- **Fan-out is at least once.** A crash or a failed `publish` partway through a fan-out repeats it, and the endpoints already written get a second delivery with a new `deliveryId` and the same `webhook-id`.
- **`package-lock.json`** in phase 2 also moved two workspace versions, `hexok` 2.2.3 to 2.2.4 and `integration-events` 0.0.0 to 0.1.0, that were stale on `main`. `npm install` did it when it linked the new workspace.

### Phase 4: end to end on Redis (2026-11-05)

Done. `webhooks.integration.test.ts` runs a real `RedisQueue` against a local server that checks every request with `verify()`. It skips without `REDIS_URL` and throws when `CI` is set without it, as `integration-events` does.

- A publish arrives with a valid signature and the `webhook-id` that `publish` resolved.
- With `retrySchedule: [600]` and `random: () => 0.5`, the retry arrives 600 ms after the 500, plus at most `promoteMs` and `blockMs` (50 each here), with the same `webhook-id`.
- A child worker, started with `runNode`, writes its `webhookId` and `deliveryId` from `onWebhookCall` with `writeSync`, then sends `SIGKILL` to itself 300 ms into a send that the server never answers. A second worker with `visibilityMs: 1000` reclaims the pending delivery. It runs attempt 1 again with the same `deliveryId`, and the server receives the same `webhook-id`.

Decisions: the package gains `@hexok/test-redis` and `ioredis` as dev dependencies, for `runNode` and key cleanup. Neither is a runtime dependency. The child defines the same event catalog inline, because the plan allows no fixture file.

For a reviewer: the crash test depends on timing. The child kills itself 300 ms after the hook, and the parent waits up to 8 s for the redelivery. It passed five runs in a row locally on Redis 8.0.

### Phase 5: example and release (2026-11-05)

Done. The app-template sends a `post.published` webhook. `domain/events/webhook-events.ts` holds a public `PostPublishedWebhook` and its `WebhookEvents` catalog, apart from `DomainEvents`. `infra/webhooks/memory-webhook-endpoints.ts` is the in-memory `WebhookEndpoints`. `PostPublishedWebhookHandler` publishes from the domain event. `servers/runtime/webhooks.ts` builds the sender on its own `RedisQueue` with hooks that log. `worker.ts` starts that queue and `webhooks.start()` before the domain queue, and stops them after it. The `@hexok/webhooks` README has the guarantees, retry, configuration, errors and logs tables, queue sizing, and "What it leaves to the application". The docs infrastructure page mentions the package. The three changesets are `@hexok/queue` major, `@hexok/queue-redis` major and `@hexok/webhooks` minor (new, 0.1.0).

Checked by hand as well as by tests: with the built template, the HTTP process and worker on Redis 8.0, a `posts.publish` reached a local receiver with a valid signature and the envelope `{ type: 'post.published', timestamp, data: { postId, title } }`, without `emailSubscribers`. The success hook logged, and both processes stopped cleanly on `SIGTERM`.

Decisions the plan left open:

- **Template env.** `WEBHOOK_URL` and `WEBHOOK_SECRET` register one endpoint, and `WEBHOOKS_ALLOW_PRIVATE=1` sets `allowPrivate` and turns off `httpsOnly` for a local receiver. The app reads these. The package does not. They are in the template README. `.env.example` is ignored by `.gitignore` (`.env.*`) and is not tracked, so it is not updated.
- **One organization.** The blog is single-tenant, so `BLOG_ORGANIZATION = 'blog'`. The `eventId` is `post.published:<postId>`, which follows the template's email idempotency keys. A post published a second time keeps its `webhook-id`, and receivers that dedupe will drop it. The handler's comment says so.
- **The handler depends on `Pick<Webhooks<…>, 'publish'>`**, not a new app port, to keep the template change small.
- **`Runtime` gains `redisUrl`**, so the worker builds the webhooks queue on the same Redis without reading `REDIS_URL` twice.
- **No skill reference.** The hexok skill indexes modelling concepts. The plan asks for no webhooks reference, so none was added.

For a reviewer:

- **Shutdown order in `worker.ts`:** the runtime first, so domain handlers can still publish, then the webhooks sender and its queue. The webhooks queue's `stopTimeoutMs` is 35 s, which together with the domain queue's 10 s exceeds a default 30 s Kubernetes grace period. The package README says to fit it in the grace period. The template does not change the grace period.
