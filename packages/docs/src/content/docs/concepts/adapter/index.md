---
title: Adapter
description: The implementation of a port, with optional start and stop for connecting.
---

An adapter is a [port](/hexok/concepts/port/) with its methods filled in. You pass the port class to `Adapter` and implement every abstract method. `start` and `stop` are already there for connecting and disconnecting.

```ts
class InMemoryPosts extends Adapter(PostRepository) {
  override async get(id: string): Promise<Post> { /* … */ }
  override async save(post: Post): Promise<void> { /* … */ }
}
```

## Why it exists

The use case asks a `PostRepository` to save. Something has to actually keep the post: a `Map` while you are sketching the feature, a database when the API runs, a fake in a test that records the calls. Those are adapters of one port. Swapping them changes the constructor arguments at the composition root, and `execute` stays put.

`start` and `stop` give a connection a home that is still outside the use case. The process opens the database before it serves traffic, and closes it when it shuts down.

## How it's used

An in-memory repository is enough to walk the publish story. The API process can later substitute a database class that extends the same port. The composition root constructs the adapter, starts it, and hands it to `PublishPost` on `deps`. An adapter that takes a driver uses that same `deps` object.

```ts
class InMemoryPosts extends Adapter(PostRepository) {
  private readonly rows = new Map<string, Post>()

  override async get(id: string): Promise<Post> {
    const post = this.rows.get(id)
    if (post === undefined) throw BlogError.PostMissing()
    return post
  }

  override async save(post: Post): Promise<void> {
    this.rows.set(post.props.id, post)
  }
}

const posts = new InMemoryPosts()
await posts.start()
const publishPost = new PublishPost({ posts, events })
```

The defaults of `start` and `stop` resolve immediately, so this adapter can leave them alone. A database adapter overrides `start` to connect and `stop` to disconnect. The application calls them. The use case calls `get` and `save`.

When the stored document is not the post, the database adapter uses a [mapper](/hexok/concepts/adapter/mapper/) to translate between them.

## Adapters that own a connection

[`@hexok/queue-redis`](/hexok/packages/queue-redis/), [`@hexok/broadcast-redis`](/hexok/packages/broadcast-redis/), and [`@hexok/schedule-coordinator-redis`](/hexok/packages/schedule-coordinator-redis/) each hold their own Redis connections. They share one lifecycle.

```ts
await queue.start()
await broadcast.start()
await broadcast.subscribe(PostChanged, onPostChanged)
const server = app.listen(port)

async function stop(): Promise<void> {
  await new Promise((resolve) => server.close(resolve))
  await broadcast.stop()
  await queue.stop()
}
```

- Await `start()` on every adapter before the process serves traffic. It resolves once Redis is ready.
- Await `subscribe()` before you rely on delivery. It resolves once Redis confirms the subscription. A broadcast `subscribe()` that is not awaited misses messages published right after it.
- Stop in the reverse order of start, and await each `stop()`. `stop()` waits for in-flight work, and resolves within `stopTimeoutMs` even when Redis is unreachable.
- `state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.

A call at the wrong time rejects or throws with an error whose `code` names the problem. Match on `error.code`, not on the message.

| Code | Meaning |
| --- | --- |
| `NotStarted`, `Starting` | The call came before `start()` resolved. Fix the call order. |
| `Stopped` | The call came after `stop()` began. Fix the call order. |
| `StoppedBeforeReply` | The command was still pending when `stop()` stopped waiting, after `stopTimeoutMs`. Redis may or may not have run it. Do not retry on the stopping adapter. |
| `StartTimeout`, `EndedBeforeReady` | `start()` failed and closed every connection. Call `start()` again, or exit and let the orchestrator restart the process. |

Each package page lists its own timeouts and logs.

## API

`Adapter(PortClass)` returns an abstract class that extends that port. Implement the port's methods. The compiler reports a missing one on the class.

| Member | Role |
| --- | --- |
| `token` | The port's token. An adapter keeps it. |
| Port methods | Implement each abstract method from the port. |
| `start()` | Called by the application before the adapter is used. Override it to connect. The default resolves immediately. |
| `stop()` | Called by the application when it is finished with the adapter. Override it to disconnect. The default resolves immediately. |

The token is fixed by the port. `InMemoryPosts.token` is `PostRepository.token`.
