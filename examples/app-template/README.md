# App template

A blog API with two Node processes sharing Redis.

`SavePost` creates or updates a post and assigns an id when the caller omits one. `PublishPost` and `UnpublishPost` use `PostEntity`. `PublishPost` takes `emailSubscribers`. The worker `EmailSubscribersHandler` emails subscribers only when that flag is true. `SubscribeToPosts` stores an email.

Use cases receive `{ ipAddress }` from the socket. There is no auth.

`http.ts` is Express. `worker.ts` blocks on the Redis list `blog:events`.

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
