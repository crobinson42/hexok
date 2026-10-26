# App template

A blog API with three Node processes sharing Redis.

`SavePost` creates or updates a post and assigns an id when the caller omits one. `PublishPost` and `UnpublishPost` use `PostEntity`. `PublishPost` takes `emailSubscribers` and an optional `publishAt`. With no `publishAt`, or a time that is not in the future, it publishes now and emits `PostPublishedEvent`. A future `publishAt` stores status `scheduled` and emits nothing. `PublishDuePosts` publishes those posts once `publishAt` has passed, using the stored `emailSubscribers` flag. `UnpublishPost` publishes `PostUnpublishedEvent` for a live post. On a scheduled post it cancels the time and emits nothing. The worker `EmailSubscribersHandler` calls the internal `EmailSubscribers` use case when that flag is true. `EmailUnpublishedHandler` calls the same use case with a removal subject. `SubscriberReminder` is the scheduled use case and calls `EmailSubscribers` once a day. `SubscribeToPosts` stores an email and a channel list (`email`, `sms`, or both) and publishes `SubscriberJoinedEvent` only for a new address. Omitted `channels` means email. SMS requires `phone`. A second subscribe for the same email does not change channels. `WelcomeSubscriberHandler` welcomes on the chosen channels. `EmailSubscribers` does the same for publish, unpublish, and the daily reminder. A failed SMS is logged and does not stop the rest of the list.

API commands extend `ApiUseCase`. Every call passes `{ authToken?: string }`, taken from the `Authorization` header. The token is optional. This template does not check it. Each API command declares an input schema next to its class, such as `publishPostInput`, and passes it as `{ input }` to `ApiUseCase`. The family guard validates the input before `execute` runs and throws `VALIDATION` with the schema issues. The RPC contract uses the same schema, so a bad request fails with 422 before the use case runs. The guard covers every other caller. The schema checks shape. Business rules, such as SMS requiring a phone, stay in `execute` as `DomainError`. `execute` receives the caller's input, not the parsed value, so input schemas do not use defaults or transforms.

Internal use cases extend `InternalUseCase`. Scheduled use cases extend `ScheduledUseCase(token, schedule)`. `execute` accepts only the context from `internalCall()`. That context carries a symbol private to `context.ts`. The guard rejects any other context, so a request body cannot call these use cases. `registration()` builds the cron job and passes `internalCall()` on each tick. The worker calls `schedule.register(reminder.registration())`.

`servers/api.ts` builds the API use cases from ports with `createApi`. `servers/rpc/contract.ts` is the [ts-pf](https://github.com/crobinson42/ts-pf) contract. `apiContract` lists each procedure with its use case input schema, its output schema, and the domain errors it can throw. `eventsContract` streams client events. `servers/rpc/app.ts` implements both. Each procedure calls one use case. `servers/http/handler.ts` serves `apiContract` at `/rpc` and `eventsContract` at `/events` as server-sent events. It is one fetch function, so srvx, Bun, Deno, or Hono can host it. `servers/http/main.ts` starts it with srvx. `PublishPost` writes two catalogs. Each domain event goes to its own Redis stream through `@hexok/queue`. The topic is the event token (`post.published`, `post.unpublished`, `subscriber.joined`). The payload is the event payload. `servers/worker.ts` subscribes once per handler. The topic is `handler.event.token`. The consumer group is the handler token (`email.subscribers`, `email.unpublished`, `email.welcome`), unless the handler class sets `static group`. Same group on one topic competes. The worker throws when two handler classes share a topic and group. A different group gets its own copy. `handler.event.parse` validates the payload. A schema rejection is dropped. A thrown `handle` retries. `ClientEvents` goes to the broadcast channel `client-events` through `@hexok/broadcast`. Each open `subscribe` call in HTTP or the websocket process adds a handler to the channel and removes it when the client stops. `@hexok/broadcast` fans each message out to those handlers over one Redis subscription. Neither process sends mail. A client that connects late does not receive earlier events. The client payload is `postId` and `title`. `emailSubscribers` stays on the domain event.

`ScheduleCoordinator` runs `subscriber-reminder` daily at `0 0 * * *` UTC, and `publish-due-posts` every minute. A Redis lock keeps two workers from both running the same tick. Missed ticks are not replayed. `publish-due-posts` loads every scheduled post with `publishAt` at or before now, so a missed minute is caught on the next tick.

Only the worker sends mail and SMS, so only the worker reads the mail and SMS env. Mail defaults to Resend. `RESEND_API_KEY` and `FROM_EMAIL` are required. `RESEND_SANDBOX=1` rewrites recipients to `delivered@resend.dev`. `EMAIL_PROVIDER=mailgun` needs `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `FROM_EMAIL`. SMS defaults to the console. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` select Twilio. Each process keeps its own `MemoryQuarantine`. The Redis queue, Resend, Mailgun, and Twilio adapters park outages there. Console SMS does not. A park in the worker is not visible to HTTP. `SENTRY_DSN` and `NEW_RELIC_LICENSE_KEY` add those loggers beside JSON lines on stdout. Vendor SDKs load only when that env is set.

Source is split by layer. Use cases stay grouped by feature and by who calls them:

```
src/domain/     schemas, entities, errors, events
src/app/        ports and use cases
src/infra/      Redis, queue, and vendor adapters
src/servers/    composition root, HTTP, websocket, and the worker

src/servers/
  composition.ts        Redis, queue, broadcast, logger, publishers, and the worker's mail and SMS
  api.ts                createApi(ports): the API use cases
  rpc/contract.ts       apiContract and eventsContract, shared with TypeScript clients
  rpc/app.ts            createApiApp and createEventsApp: one use case per procedure
  rpc/errors.ts         domain errors as declared ts-pf errors
  rpc/client-events.ts  clientEventStream: the broadcast channel as a stream
  http/handler.ts       createHttpHandler: /rpc and /events in one fetch function
  http/main.ts          HTTP process entry
  ws/server.ts          createWsServer: ts-pf over npm ws, heartbeat, connection context
  ws/main.ts            websocket process entry
  worker.ts             worker process entry

src/app/use-cases/
  context.ts
  posts/api/command/          save, publish, unpublish
  posts/event-handlers/       email after publish and unpublish
  subscribers/event-handlers/ welcome mail after subscribe
  posts/internal/             EmailSubscribers use case
  posts/scheduled/            SubscriberReminder and PublishDuePosts
  subscribers/api/command/    subscribe
```

`context.ts` holds the API and internal factories. `scheduled.ts` holds `ScheduledUseCase`. The worker constructs `EmailSubscribers`, passes it to `EmailSubscribersHandler` and `EmailUnpublishedHandler`, constructs `WelcomeSubscriberHandler` with the mail sender, SMS sender, and logger, and registers `SubscriberReminder` and `PublishDuePosts` on the schedule coordinator. `PublishDuePosts` writes the same domain queue and client broadcast as `PublishPost`. It subscribes each handler with `subscribeHandler`. HTTP and the handler pass `internalCall()` where they call an internal use case. A scheduled use case does that inside `registration()`. The handler does not subscribe itself. The app owns `DomainEvents` and `ClientEvents`. `DomainEventPublisher` is the queue port. `ClientEventPublisher` is the broadcast port.

```bash
redis-server
npm run build -w @hexok/app-template
npm run start -w @hexok/app-template
npm run start:worker -w @hexok/app-template
npm run start:ws -w @hexok/app-template
```

HTTP and the websocket process stop on `SIGINT` or `SIGTERM`. Each closes its server and open event streams, stops the queue and broadcast, and closes Redis. A second signal exits at once.

`REDIS_URL` defaults to `redis://127.0.0.1:6379`. `PORT` defaults to `3000`. `WS_PORT` defaults to `3001`. Names and which ones are required are in `.env.example`. Node does not load that file.

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
```

An error is `{"ok": false, "error": {"code", "message", "data"?}}`. Clients switch on `code`. `rpc/errors.ts` gives each `DomainError` code a status, and a new code fails type-check until it has one. `declared(...)` adds codes to a procedure, so a TypeScript client reads typed `data`. A middleware rethrows a domain error with its code, message, data, and status. Unknown throws and `INTERNAL` are logged. Other errors are not.

| Error | Status |
| --- | --- |
| `BAD_REQUEST`: malformed JSON, or a body without `input` | 400 |
| `PublishAtInvalid`, `ChannelsRequired`, `ChannelsInvalid`, `SmsRequiresPhone` | 400 |
| `PostNotFound`, or a procedure that does not exist | 404 |
| `AlreadyPublished`, `NotPublished`, `NotScheduled` | 409 |
| `VALIDATION` | 422 |
| `INTERNAL`: `InternalCallerRequired` and anything else | 500 |

```json
{ "ok": false, "error": { "code": "VALIDATION", "message": "Validation failed", "data": { "issues": [{ "message": "…", "path": ["channels", 0] }] } } }
{ "ok": false, "error": { "code": "PostNotFound", "message": "Post was not found", "data": { "id": "…" } } }
```

`ClientEvents` is the contract for client events. Its event tokens are the topics a client subscribes to. Its schemas are the payloads. To add a topic, define an event and add it to the catalog:

```ts
export class CommentAddedClientEvent extends Event(
  'comment.added',
  z.object({ postId: z.string(), body: z.string() }),
) {}

export class ClientEvents extends EventCatalog('client-events', {
  postPublished: PostPublishedClientEvent,
  commentAdded: CommentAddedClientEvent,
}) {}
```

A use case publishes it with `clientEvents.publish(new CommentAddedClientEvent({ … }))`. `eventsContract` reads the keys and payload types from the catalog, so clients can subscribe to `commentAdded` with no server change. A second set of topics is a second catalog with its own broadcast channel and procedure.

`subscribe` takes `{ events?: key[] }` and streams the catalog message `{ key, payload }`, the same value the broadcast channel carries. Keys are the catalog names, such as `postPublished`. Omit `events` to receive the whole catalog. An unknown key is `VALIDATION`. To change the keys, cancel the call and subscribe again. A client that connects late does not receive earlier events. A client can `ClientEvents.parse(message)` to validate it and build the event.

HTTP serves `subscribe` as server-sent events at `POST /events/subscribe`. The websocket process serves the same app over the ts-pf message protocol, and one socket carries many calls. A product that needs only one can drop the other. SSE needs no second process. The client is the same either way. `key` narrows `payload`. The call resolves when the first event arrives:

```ts
import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import { WsLink } from '@ts-pf/message-client';
import { SseCodec } from '@ts-pf/sse';
import type { eventsContract } from './servers/rpc/contract.js';

const link = new FetchLink({
  url: 'http://127.0.0.1:3000/events',
  codec: new SseCodec(),
});
// or: const link = new WsLink({ url: 'ws://127.0.0.1:3001' });
const events = createClient<typeof eventsContract>(link);

for await (const event of await events.subscribe({ events: ['postPublished'] })) {
  if (event.key === 'postPublished') console.log(event.payload.title);
}
```

A browser `EventSource` only sends `GET`, so a browser uses `FetchLink` or `fetch`. From a shell:

```bash
curl -N -X POST http://127.0.0.1:3000/events/subscribe \
  -H 'content-type: application/json' \
  -d '{"input":{}}'
```

`ctx` is the caller context. HTTP reads it from the `Authorization` header. The template sends every event to every client that asked for it. For rooms, tenants, or per-user rules, pass `context` from the `subscribe` handler to `clientEventStream` and check it where its handler pushes a message.

`createWsServer` builds the context once per connection, on the client's hello, from the upgrade request and the hello `meta`. A browser cannot set websocket headers, so it sends a token in `meta`. `ws/main.ts` reads the `Authorization` header, then `meta.token`:

```ts
const link = new WsLink({ url: 'ws://127.0.0.1:3001', meta: { token } });
```

A throw from `context` ends the handshake. ts-pf sends the client `INTERNAL` without the message, so do not throw for a missing token. Leave the user unset and refuse in procedure middleware with a declared `UNAUTHORIZED`. Then one socket carries public and private procedures, and the client narrows on the code:

```ts
const requireUser = impl.middleware(async ({ context, next }) => {
  const user = await users.fromToken(context.authToken);
  if (!user) throw new PFError({ code: 'UNAUTHORIZED', status: 401 });
  return next({ context: { user } });
});

impl.router({
  public: { subscribe: impl.public.subscribe.handler(/* … */) },
  account: { subscribe: impl.account.subscribe.use(requireUser).handler(/* … */) },
});
```

To refuse a connection before it opens, pass `ws: { verifyClient }`. npm `ws` answers the upgrade with the status you give it.

ts-pf ends the stream when the client cancels or disconnects, and aborts a websocket stream when the socket buffer stays full for 30 seconds.

`createWsServer(app, { ws })` passes `ws` to npm `ws`. `{ port }` listens on its own port. `{ server }` shares an HTTP server with one websocket server. For several on one port, such as a public app and an app that requires a user, create each with `{ noServer: true }` and route by path. npm `ws` answers 400 to a path it does not own, so two servers given `{ server, path }` refuse each other's clients:

```ts
const open = createWsServer(publicApp, { ws: { noServer: true }, context });
const account = createWsServer(accountApp, { ws: { noServer: true, verifyClient }, context });
routeUpgrades(httpServer, { '/ws': open, '/ws/account': account });
```

`routeUpgrades` answers an unknown path with 404.
