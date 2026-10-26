# App template

A blog API with three Node processes sharing Redis.

`SavePost` creates or updates a post and assigns an id when the caller omits one. `PublishPost` and `UnpublishPost` use `PostEntity`. `PublishPost` takes `emailSubscribers` and an optional `publishAt`. With no `publishAt`, or a time that is not in the future, it publishes now and emits `PostPublishedEvent`. A future `publishAt` stores status `scheduled` and emits nothing. `PublishDuePosts` publishes those posts once `publishAt` has passed, using the stored `emailSubscribers` flag. `UnpublishPost` publishes `PostUnpublishedEvent` for a live post. On a scheduled post it cancels the time and emits nothing. The worker `EmailSubscribersHandler` calls the internal `EmailSubscribers` use case when that flag is true. `EmailUnpublishedHandler` calls the same use case with a removal subject. `SubscriberReminder` is the scheduled use case and calls `EmailSubscribers` once a day. `SubscribeToPosts` stores an email and a channel list (`email`, `sms`, or both) and publishes `SubscriberJoinedEvent` only for a new address. Omitted `channels` means email. SMS requires `phone`. A second subscribe for the same email does not change channels. `WelcomeSubscriberHandler` welcomes on the chosen channels. `EmailSubscribers` does the same for publish, unpublish, and the daily reminder. A failed SMS is logged and does not stop the rest of the list.

API commands extend `ApiUseCase`. Every call passes `{ authToken?: string }`, taken from the `Authorization` header. The token is optional. This template does not check it.

Internal use cases extend `InternalUseCase`. Scheduled use cases extend `ScheduledUseCase(token, schedule)`. `execute` accepts only the context from `internalCall()`. That context carries a symbol private to `context.ts`. The guard rejects any other context, so a request body cannot call these use cases. `registration()` builds the cron job and passes `internalCall()` on each tick. The worker calls `schedule.register(reminder.registration())`.

`servers/http.ts` is Express. `PublishPost` writes two catalogs. Each domain event goes to its own Redis stream through `@hexok/queue`. The topic is the event token (`post.published`, `post.unpublished`, `subscriber.joined`). The payload is the event payload. `servers/worker.ts` subscribes once per handler. The topic is `handler.event.token`. The consumer group is the handler token (`email.subscribers`, `email.unpublished`, `email.welcome`), unless the handler class sets `static group`. Same group on one topic competes. The worker throws when two handler classes share a topic and group. A different group gets its own copy. `handler.event.parse` validates the payload. A schema rejection is dropped. A thrown `handle` retries. `ClientEvents` goes to the broadcast channel `client-events` through `@hexok/broadcast`. `servers/ws.ts` is the only subscriber. It parses the channel and sends each event to sockets that subscribed. It does not send mail. A client that connects late does not receive earlier events. The client payload is `postId` and `title`. `emailSubscribers` stays on the domain event.

`ScheduleCoordinator` runs `subscriber-reminder` daily at `0 0 * * *` UTC, and `publish-due-posts` every minute. A Redis lock keeps two workers from both running the same tick. Missed ticks are not replayed. `publish-due-posts` loads every scheduled post with `publishAt` at or before now, so a missed minute is caught on the next tick.

Mail defaults to Resend. `RESEND_API_KEY` and `FROM_EMAIL` are required. `RESEND_SANDBOX=1` rewrites recipients to `delivered@resend.dev`. `EMAIL_PROVIDER=mailgun` needs `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and `FROM_EMAIL`. SMS defaults to the console. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` select Twilio. Each process keeps its own `MemoryQuarantine`. The Redis queue, Resend, Mailgun, and Twilio adapters park outages there. Console SMS does not. A park in the worker is not visible to HTTP. `SENTRY_DSN` and `NEW_RELIC_LICENSE_KEY` add those loggers beside JSON lines on stdout. Vendor SDKs load only when that env is set.

Source is split by layer. Use cases stay grouped by feature and by who calls them:

```
src/domain/     schemas, entities, errors, events
src/app/        ports and use cases
src/infra/      Redis, queue, and vendor adapters
src/servers/    composition root, HTTP, websocket, and the worker

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

`REDIS_URL` defaults to `redis://127.0.0.1:6379`. `PORT` defaults to `3000`. `WS_PORT` defaults to `3001`. Names and which ones are required are in `.env.example`. Node does not load that file.

Connect, then subscribe. Omit `events` to receive the whole catalog, including events added later. Names are event tokens. `key` and `payload` are the catalog message, so a TypeScript client can `ClientEvents.parse({ key, payload })`. Unsubscribing a token while subscribed to all leaves the other catalog tokens. An unknown token is an error and does not change the subscription.

```js
const ws = new WebSocket('ws://127.0.0.1:3001');
ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe' }));
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'event') console.log(message.token, message.payload);
};
```

```json
{ "type": "subscribe", "events": ["post.published"] }
{ "type": "unsubscribe" }
```

```json
{ "type": "subscribed", "events": ["*"] }
{ "type": "event", "token": "post.published", "key": "postPublished", "payload": { "postId": "…", "title": "…" } }
{ "type": "error", "message": "unknown event \"nope\"" }
```

```bash
curl -s -X POST http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"First post"}'

curl -s -X POST http://127.0.0.1:3000/posts/POST_ID/publish \
  -H 'content-type: application/json' \
  -d '{"emailSubscribers":true}'

curl -s -X POST http://127.0.0.1:3000/posts/POST_ID/publish \
  -H 'content-type: application/json' \
  -d '{"emailSubscribers":true,"publishAt":"2026-10-22T18:00:00.000Z"}'

curl -s -X POST http://127.0.0.1:3000/posts/POST_ID/unpublish

curl -s -X POST http://127.0.0.1:3000/subscribers \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","channels":["email"]}'

curl -s -X POST http://127.0.0.1:3000/subscribers \
  -H 'content-type: application/json' \
  -d '{"email":"bea@example.com","phone":"+15550001111","channels":["sms"]}'

curl -s -X POST http://127.0.0.1:3000/subscribers \
  -H 'content-type: application/json' \
  -d '{"email":"cy@example.com","phone":"+15550002222","channels":["email","sms"]}'
```
