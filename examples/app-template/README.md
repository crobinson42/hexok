# App template

A blog API with two Node processes sharing Redis.

`SavePost` creates or updates a post and assigns an id when the caller omits one. `PublishPost` and `UnpublishPost` use `PostEntity`. `PublishPost` takes `emailSubscribers`. The worker `EmailSubscribersHandler` calls the internal `EmailSubscribers` use case when that flag is true. `SubscriberReminder` is the scheduled use case and calls `EmailSubscribers` once a day. `SubscribeToPosts` stores an email.

API commands extend `ApiUseCase`. Every call passes `{ authToken?: string }`, taken from the `Authorization` header. The token is optional. This template does not check it.

Internal and scheduled use cases extend `InternalUseCase`. `execute` accepts only the context from `internalCall()`. That context carries a symbol private to `context.ts`. The guard rejects any other context, so a request body cannot call these use cases.

`http.ts` is Express. `worker.ts` blocks on the Redis list `blog:events`.

`Scheduler` is the schedule-config port. `getConfig` stores a default (UTC, week starts Monday) the first time an id is asked for. `startOfWeek` takes a `YYYY-MM-DD` local date, not an instant, and returns local midnight on that week's first day. `addDays` moves an instant by whole days in a timezone and keeps the wall-clock time, including across a daylight-saving change. `InMemoryScheduler` is the adapter.

Use cases are grouped by feature and by who calls them:

```
src/use-cases/
  context.ts
  posts/api/command/          save, publish, unpublish
  posts/event-handlers/       email subscribers after publish
  posts/internal/             EmailSubscribers use case
  posts/scheduled/            SubscriberReminder use case
  subscribers/api/command/    subscribe
```

`context.ts` holds both factories. The worker constructs `EmailSubscribers`, passes it to `EmailSubscribersHandler`, and starts `SubscriberReminder` on a timer. Those callers pass `internalCall()`. The handler does not subscribe itself.

```bash
redis-server
npm run build -w @hexok/app-template
npm run start -w @hexok/app-template
npm run start:worker -w @hexok/app-template
```

`REDIS_URL` defaults to `redis://127.0.0.1:6379`. `PORT` defaults to `3000`.

```bash
curl -s -X POST http://127.0.0.1:3000/posts \
  -H 'content-type: application/json' \
  -d '{"title":"Hello","body":"First post"}'

curl -s -X POST http://127.0.0.1:3000/posts/POST_ID/publish \
  -H 'content-type: application/json' \
  -d '{"emailSubscribers":true}'

curl -s -X POST http://127.0.0.1:3000/posts/POST_ID/unpublish

curl -s -X POST http://127.0.0.1:3000/subscribers \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com"}'
```
