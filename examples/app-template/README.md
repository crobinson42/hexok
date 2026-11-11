# App template

A blog API with two Node processes sharing Redis.

`SavePost` creates or updates a post and assigns an id when the caller omits one. `PublishPost` and `UnpublishPost` use `PostEntity`. `PublishPost` takes `emailSubscribers` and an optional `publishAt`. With no `publishAt`, or a time that is not in the future, it publishes now and emits `PostPublishedEvent`. A future `publishAt` stores status `scheduled` and emits nothing. `PublishDuePosts` publishes those posts once `publishAt` has passed, using the stored `emailSubscribers` flag. `UnpublishPost` publishes `PostUnpublishedEvent` for a live post. On a scheduled post it cancels the time and emits nothing. The worker `EmailSubscribersHandler` loads subscribers when that flag is true and sends on each subscriber's channels through `EmailSender` and `SmsSender`. `EmailUnpublishedHandler` does the same with a removal subject. `SubscriberReminder` lists subscribers and sends its own reminder once a day. `SubscribeToPosts` stores an email and a channel list (`email`, `sms`, `webhook`, or a combination) and publishes `SubscriberJoinedEvent` only for a new address. Omitted `channels` means email. SMS requires `phone`. Webhook requires `url`. The app generates a `whsec_` secret with `generateSecret()` and returns it on the subscriber. A product shows that secret once and encrypts it at rest. This template returns it on every subscribe for that email. A second subscribe does not change channels, the URL, or the secret. `channels: ["webhook"]` sends no email and no SMS. `email` stays the subscribe key. HTTP calls `checkUrl` before save, with the same `httpsOnly` and `allowPrivate` as the worker, and does not start the sender. `WelcomeSubscriberHandler` reads the joined event and sends on those channels. A rejected email is logged and the list continues. `Unavailable` and `RateLimited` from mail still throw, so the queue retries. Any SMS error is logged. Each send sets an idempotency key from the event and the subscriber id, not the address. Resend dedupes on that key. Mailgun does not.

API commands extend `ApiUseCase`. Every call passes `ApiCtx`, `{ caller?: { userId } }`. HTTP builds it from the `Authorization` header with `@hexok/auth` sessions. No `caller` is an anonymous request. Use cases never import `@hexok/auth`, and the caller carries no token or session id. A use case that needs a caller reads `ctx.caller` and owns that rule. Each API command declares an input schema next to its class, such as `publishPostInput`, and passes it as `{ input }` to `ApiUseCase`. The family guard validates the input before `execute` runs and throws `VALIDATION` with the schema issues. The RPC contract uses the same schema, so a bad request fails with 422 before the use case runs. The guard covers every other caller. The schema checks shape. Business rules, such as SMS requiring a phone, stay in `execute` as `DomainError`. `execute` receives the caller's input, not the parsed value, so input schemas do not use defaults or transforms.

Internal use cases extend `InternalUseCase`. Scheduled use cases extend `ScheduledUseCase(token, schedule)`. `execute` accepts only the context from `internalCallCtx()`. That context carries a symbol private to `context.ts`. The guard rejects any other context, so a request body cannot call these use cases. `registration()` builds the cron job and passes `internalCallCtx(signal)` on each tick. The signal aborts before the lock expires. A tick stops when it sees that. The worker calls `schedule.register(reminder.registration())`.

`servers/api.ts` builds the API use cases from ports with `createApi`. `servers/rpc/contract.ts` is the [ts-pf](https://github.com/crobinson42/ts-pf) contract. `apiContract` lists each procedure with its use case input schema and its output schema. Every procedure declares the same client-facing domain errors. `servers/rpc/app.ts` implements it. Each procedure calls one use case. `servers/http/handler.ts` serves `apiContract` at `/rpc`. It is one fetch function, so srvx, Bun, Deno, or Hono can host it. `servers/http/main.ts` starts it with srvx. Each domain event goes to its own Redis stream through `@hexok/queue`. The topic is the event token (`post.published`, `post.unpublished`, `subscriber.joined`). The payload is the event payload. `servers/worker.ts` subscribes once per handler. The topic is `handler.event.token`. The consumer group is the handler token (`email.subscribers`, `email.unpublished`, `email.welcome`, `webhooks.post-published`, `webhooks.subscriber-post-published`, `webhooks.subscriber-post-unpublished`), unless the handler class sets `static group`. Same group on one topic competes. The worker throws when two handler classes share a topic and group. A different group gets its own copy. `handler.event.parse` validates the payload. A schema rejection is dropped. A thrown `handle` retries until `maxDeliveries`. The worker passes `'unlimited'` because its quarantine is in-process. A finite ceiling would acknowledge the entry and park it somewhere that does not survive a restart. HTTP does not send mail.

`ScheduleCoordinator` runs `subscriber-reminder` daily at `0 0 * * *` UTC, and `publish-due-posts` every minute. The worker also runs `queue.maintain` hourly at `15 * * * *` UTC. That job removes queue consumers that have been idle for an hour and own no pending entries. It does not trim. Age trim stays on the publisher. A Redis lock keeps two workers from both running the same tick. Missed ticks are not replayed. `publish-due-posts` loads every scheduled post with `publishAt` at or before now, so a missed minute is caught on the next tick.

The worker sends webhooks with `@hexok/webhooks`. `PostPublishedWebhookHandler` reads `PostPublishedEvent` and publishes `PostPublishedWebhook` from `domain/events/webhook-events.ts`. That catalog is separate from `DomainEvents`, so `emailSubscribers` never reaches a customer endpoint. The `eventId` is `post.published:<postId>`, so a retried handler sends the same `webhook-id`. The env endpoint lives in `MemoryWebhookEndpoints`. A product replaces that store with its own. `WEBHOOK_URL` and `WEBHOOK_SECRET` register one endpoint for `post.published`. Generate a secret with `generateSecret()`. `WEBHOOKS_ALLOW_PRIVATE=1` allows plain http and private addresses, for a receiver on this machine. The hooks log each delivery and failure, and disable an endpoint that answers 410. The sender runs on its own `RedisQueue` with the `webhooks:` prefix, one hour of retention, and a 35 second `stopTimeoutMs`. The worker starts it before the domain queue and stops it after, because domain handlers publish to it. A subscriber who chooses `webhook` is a separate endpoint, read from the subscriber store by `BlogWebhookEndpoints`. The env endpoint is not one of them. It stays on `post.published`. Subscriber endpoints receive `subscriber.post.published`, `subscriber.post.unpublished`, `subscriber.welcome`, and `subscriber.reminder`. `SubscriberPostPublishedWebhookHandler` publishes once when `emailSubscribers` is true. Its `eventId` is `subscriber.post.published:<postId>`, not the product event's id, so a receiver does not dedupe one against the other. `SubscriberPostUnpublishedWebhookHandler` publishes once. `WelcomeSubscriberHandler` publishes to that subscriber's id. `SubscriberReminder` publishes once a day, then sends email and SMS. The endpoint port fans out. A 410 sets `webhookDisabled`, and `get` then returns null.

Only the worker sends mail and SMS, so only the worker reads the mail and SMS env. Mail defaults to Resend. `RESEND_API_KEY` and `FROM_EMAIL` are required. `RESEND_SANDBOX=1` rewrites recipients to `delivered@resend.dev`. `EMAIL_PROVIDER=mailgun` needs `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `FROM_EMAIL`. SMS defaults to the console. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` select Twilio. Each process keeps its own `MemoryQuarantine`. The Redis queue, Resend, Mailgun, and Twilio adapters park outages there. Console SMS does not. A park in the worker is not visible to HTTP. `SENTRY_DSN` and `NEW_RELIC_LICENSE_KEY` add those loggers beside JSON lines on stdout. Vendor SDKs load only when that env is set.

Source is split by layer. Use cases stay grouped by feature and by who calls them:

```
src/domain/     schemas, entities, errors, events
src/app/        ports and use cases
src/infra/      Redis, queue, and vendor adapters
src/servers/    composition root, HTTP, and the worker

src/servers/
  runtime/index.ts             Runtime and createRuntime
  runtime/env.ts               required env and optional package load
  runtime/logger.ts            JSON lines, Sentry, New Relic
  runtime/email.ts             Resend or Mailgun
  runtime/sms.ts               Twilio or console SMS
  runtime/sessions.ts          @hexok/auth sessions: Redis store, signed tokens
  runtime/domain-events.ts     domain queue and publisher
  runtime/schedule.ts          schedule coordinator
  runtime/channel-delivery.ts  createChannelDeliveryServices
  runtime/webhooks.ts          webhook sender, its queue, its hooks, and the subscribe URL check
  api.ts                       createApi(ports): the API use cases
  rpc/contract.ts              apiContract, shared with TypeScript clients
  rpc/app.ts                   createApiApp and callerContext
  rpc/errors.ts                domain errors as ts-pf errors
  http/handler.ts              createHttpHandler: /rpc as one fetch function
  http/main.ts                 HTTP process entry
  worker.ts                    worker process entry
  scripts/open-session.ts      sign a user in for local development

src/app/use-cases/
  context.ts
  scheduled.ts
  posts/api/command/          save, publish, unpublish
  posts/event-handlers/       email and SMS after publish and unpublish, the product webhook, and subscriber webhooks
  posts/internal/             CommitPublishedPost
  posts/scheduled/            SubscriberReminder and PublishDuePosts
  subscribers/api/command/    subscribe
  subscribers/event-handlers/ welcome after subscribe

src/servers/utils/            shutdown and subscribeHandler
```

`context.ts` holds the API and internal factories. `scheduled.ts` holds `ScheduledUseCase`. The worker passes `EmailSender`, `SmsSender`, and `from` to `EmailSubscribersHandler`, `EmailUnpublishedHandler`, `WelcomeSubscriberHandler`, and `SubscriberReminder`. It registers `SubscriberReminder`, `PublishDuePosts`, and `queue.maintain` on the schedule coordinator. `PublishDuePosts` writes the same domain queue as `PublishPost`. It subscribes each handler with `subscribeHandler`. HTTP passes `internalCallCtx()` where it calls an internal use case. A scheduled use case does that inside `registration()`. The handler does not subscribe itself. The app owns `DomainEvents`. `DomainEventPublisher` is the queue port.

```bash
redis-server
npm run build -w @hexok/app-template
npm run start -w @hexok/app-template
```

The worker sends mail. Install `resend`, and set `FROM_EMAIL` and `RESEND_API_KEY`, before starting it. Names are in `.env.example`. Node does not load that file.

```bash
npm run start:worker -w @hexok/app-template
```

HTTP and the worker stop on `SIGINT` or `SIGTERM`. HTTP closes its server and stops the session store. Each stops the schedule coordinator, then the queue, then closes Redis. A second signal exits at once.

`REDIS_URL` defaults to `redis://127.0.0.1:6379`. `PORT` defaults to `3000`. HTTP requires `AUTH_TOKEN_SECRETS`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_AUDIENCE`, and refuses to start without them. `AUTH_SESSION_IDLE_SECONDS` and `AUTH_SESSION_ABSOLUTE_SECONDS` default to 30 minutes and 8 hours. Names and which ones are required are in `.env.example`. Node does not load that file.

The API is RPC. Every call is `POST /rpc/<procedure path>` with the body `{"input": …}`. A success is `{"ok": true, "output": …}`. A TypeScript client imports the contract type and gets typed inputs, outputs, and errors:

```ts
import { asResult, createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import type { apiContract } from './servers/rpc/contract.js';

const api = createClient<typeof apiContract>(
  new FetchLink({ url: 'http://127.0.0.1:3000/rpc' }),
);
const draft = await api.posts.save({ title: 'Hello', body: 'First post' });
const result = await asResult(api.posts.publish({ id: draft.id }));
if (!result.ok && result.error.code === 'PostNotFound') {
  console.log(result.error.data.id);
}
```

Any other client posts JSON and reads the same envelope. `@ts-pf/openapi` generates an OpenAPI document for Swift, Kotlin, or other generated clients. This template does not include it.

To add a procedure, add it to `apiContract` with the use case input schema and the domain errors it throws. Then add one handler to `createApiApp`. A missing or extra handler is a type error.

```bash
curl -s -X POST http://127.0.0.1:3000/rpc/posts/save \
  -H 'content-type: application/json' \
  -d '{"input":{"title":"Hello","body":"First post"}}'

curl -s -X POST http://127.0.0.1:3000/rpc/posts/publish \
  -H 'content-type: application/json' \
  -d '{"input":{"id":"POST_ID","emailSubscribers":true}}'

curl -s -X POST http://127.0.0.1:3000/rpc/posts/publish \
  -H 'content-type: application/json' \
  -d '{"input":{"id":"POST_ID","emailSubscribers":true,"publishAt":"2026-10-22T18:00:00.000Z"}}'

curl -s -X POST http://127.0.0.1:3000/rpc/posts/unpublish \
  -H 'content-type: application/json' \
  -d '{"input":{"id":"POST_ID"}}'

curl -s -X POST http://127.0.0.1:3000/rpc/subscribers/subscribe \
  -H 'content-type: application/json' \
  -d '{"input":{"email":"ada@example.com","channels":["email"]}}'

curl -s -X POST http://127.0.0.1:3000/rpc/subscribers/subscribe \
  -H 'content-type: application/json' \
  -d '{"input":{"email":"bea@example.com","phone":"+15550001111","channels":["sms"]}}'

curl -s -X POST http://127.0.0.1:3000/rpc/subscribers/subscribe \
  -H 'content-type: application/json' \
  -d '{"input":{"email":"ada@example.com","channels":["webhook"],"url":"https://ada.example/hooks"}}'
```

An error is `{"ok": false, "error": {"code", "message", "data"?}}`. Clients switch on `code`. `rpc/errors.ts` gives each `DomainError` code a status, and a new code fails type-check until it has one. Procedures share that map, so a TypeScript client reads typed `data` without a per-procedure list. A use case throws the error. A middleware rethrows it with its code, message, data, and status. Unknown throws and `INTERNAL` are logged. Other errors are not.

| Error | Status |
| --- | --- |
| `BAD_REQUEST`: malformed JSON, or a body without `input` | 400 |
| `PublishAtInvalid`, `ChannelsRequired`, `SmsRequiresPhone`, `WebhookRequiresUrl` | 400 |
| `WebhookUrlRejected`: `checkUrl` refused the URL. `data.reason` is `invalid`, `scheme`, `blocked`, or `unresolved` | 400 |
| `ChannelsInvalid`: a duplicate channel | 400 |
| `Unauthenticated`: a token the authenticator rejects, or a scheme other than `Bearer` | 401 |
| `SignInRequired`: `sessions.end` with no caller | 401 |
| `PostNotFound`, or a procedure that does not exist | 404 |
| `AlreadyPublished`, `NotPublished`, `NotScheduled` | 409 |
| `VALIDATION`: shape, including a channel name other than `email`, `sms`, or `webhook` | 422 |
| `INTERNAL`: `InternalCallerRequired` and anything else | 500 |

```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "subscriber.subscribe input is invalid", "data": { "issues": [{ "message": "…", "path": ["channels", 0] }] } } }
{ "ok": false, "error": { "code": "PostNotFound", "message": "Post was not found", "data": { "id": "…" } } }
```

`http/handler.ts` reads the caller for each call. `callerContext` takes `Authorization: Bearer <token>` and asks `Sessions` from `@hexok/auth` who the token proves. No header is an anonymous caller. Another scheme, or a token that proves no session, is 401 `Unauthenticated` before any procedure runs. Every refusal looks the same to the client.

`runtime/sessions.ts` builds the sessions. `RedisSessionStore` from `@hexok/auth-redis` keeps each session under `app-template:session:`, typed by `callerSchema`. `JoseSessionToken` from `@hexok/auth-jose` signs a token that names the session and nothing else. The store decides: a valid token whose session is gone is refused. A session ends after 30 minutes idle or 8 hours, whichever comes first.

`sessions.end` signs out at the edge. It ends the session the request's token names, and the user's other sessions stay open. No use case sees the token. The template has no login procedure. `npm run session:open -- <userId>` signs a user in and prints a token. A real app checks the credentials it owns, then calls `sessions.open`.

```bash
export AUTH_TOKEN_SECRETS=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
export AUTH_TOKEN_ISSUER=app-template AUTH_TOKEN_AUDIENCE=app-template-api
npm run build -w @hexok/app-template
npm run start -w @hexok/app-template
TOKEN=$(npm run -s session:open -w @hexok/app-template -- ada)

curl -s -X POST http://127.0.0.1:3000/rpc/posts/save \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"input":{"title":"Hello","body":"First post"}}'

curl -s -X POST http://127.0.0.1:3000/rpc/sessions/end \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"input":{}}'
```
