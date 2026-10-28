# Adapter

An adapter is a port with its methods filled in. Pass the port class to `Adapter` and implement every abstract method. `start` and `stop` are already there for connecting and disconnecting.

```ts
class InMemoryPosts extends Adapter(PostRepository) {
  override async get(id: string): Promise<Post> {
    /* … */
  }
  override async save(post: Post): Promise<void> {
    /* … */
  }
}
```

## Why it exists

The use case asks a `PostRepository` to save. Something has to actually keep the post: a `Map` while you sketch the feature, a database when the API runs, a fake in a test that records the calls. Those are adapters of one port. Swapping them changes the constructor arguments at the composition root, and `execute` stays put.

`start` and `stop` give a connection a home that is still outside the use case. The process opens the database before it serves traffic, and closes it when it shuts down.

## How to use it

An in-memory repository is enough to walk the publish story. The API process can later substitute a database class that extends the same port. The composition root constructs the adapter, starts it, and hands it to `PublishPost` on `deps`. An adapter that takes a driver or another collaborator uses that same `deps` object.

```ts
class InMemoryPosts extends Adapter(PostRepository) {
  private readonly rows = new Map<string, ReturnType<Post['toProps']>>();

  override async get(id: string): Promise<Post> {
    const props = this.rows.get(id);
    if (props === undefined) throw BlogError.PostMissing({ id });
    return Post.restore(props);
  }

  override async save(post: Post): Promise<void> {
    this.rows.set(post.props.id, post.toProps());
    post.commit();
  }
}

const posts = new InMemoryPosts();
await posts.start();
const publishPost = new PublishPost({ posts, events });
```

Store `toProps()` (or a mapped document) and rebuild with `restore` on the way out. Call `commit()` after the write succeeds.

The defaults of `start` and `stop` resolve immediately, so an in-memory adapter can leave them alone. A database adapter overrides `start` to connect and `stop` to disconnect. The application calls them. The use case calls `get` and `save`.

A publisher adapter accepts the catalog instance and, on a real transport, sends `BlogEvents.message(event)`. A subscription adapter owns the consumer loop. It parses with `BlogEvents.parse`, then calls each subscribed handler. It does not hide handler errors. Ack, retry, prefetch, and consumer groups live here, and only when the broker has them.

One adapter implements one port. A second port is a second class.

## Adapters that own a connection

`@hexok/queue-redis`, `@hexok/broadcast-redis`, and `@hexok/schedule-coordinator-redis` each hold their own Redis connections. They share one lifecycle. A new adapter that holds an ioredis connection builds on `@hexok/ioredis-lifecycle`.

```ts
await queue.start();
await broadcast.start();
await broadcast.subscribe(PostChanged, onPostChanged);
const server = app.listen(port);

async function stop(): Promise<void> {
  await new Promise((resolve) => server.close(resolve));
  await broadcast.stop();
  await queue.stop();
}
```

- **Start.** Await `start()` before the adapter is used. It resolves once Redis is ready. Start every adapter before the process serves traffic or subscribes handlers. A call made before `start()` resolves rejects or throws with code `NotStarted` or `Starting`. `register()` on the schedule coordinator is synchronous, so it throws.
- **State.** `state` is `ready` from `start()` until `stop()`, even while Redis is down. It says whether the adapter accepts calls, not whether Redis answers. Use it to gate traffic during startup and shutdown, not as a Redis health check.
- **Subscribe.** Await `subscribe()` before you rely on delivery. It resolves once Redis confirms the subscription. Redis pub/sub keeps no history, so a broadcast `subscribe()` that is not awaited misses messages published right after it. Its failure is also unhandled.
- **Stop.** Stop in the reverse order of start, and await each `stop()`. Close the gateway first so no new work arrives. `stop()` waits for in-flight commands, and for the queue's handlers and the schedule's ticks, and resolves within `stopTimeoutMs` even when Redis is unreachable. A call after `stop()` begins rejects or throws with code `Stopped`.
- **Unknown outcome.** A command still pending when `stop()` stops waiting, after `stopTimeoutMs`, rejects with code `StoppedBeforeReply`. Redis may or may not have run it. With at-least-once delivery and idempotent handlers, a duplicate is safe, so the next process can send it again. With at-most-once work, such as a one-time code, treat it as possibly done. Check whether it happened before you send it again.

`NotStarted`, `Starting`, and `Stopped` mean the call came at the wrong time. Fix the call order. Do not retry them. `StoppedBeforeReply` means Redis may or may not have run the command. The adapter is stopping, so do not retry on it. `StartTimeout` and `EndedBeforeReady` reject `start()` and close every connection. Call `start()` again, or exit and let the orchestrator restart the process.

Match on `error.code`, not on the message. Message text can change in any release. Each package exports `LifecycleError`, but `LifecycleError.is` uses `instanceof`. It returns false when the application installs two copies of the package. Matching on `code` also works across packages.

```ts
try {
  await queue.publish('post.published', payload);
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'StoppedBeforeReply') {
    // Redis may have stored it. Send it again only when a duplicate is safe.
  }
  throw error;
}
```

`startTimeoutMs` makes `start()` reject with code `StartTimeout` when Redis is not ready in time. Unset, `start()` waits for Redis, which suits compose-style boot. Set it under an orchestrator such as Kubernetes, so the process exits and is restarted.

On Kubernetes, a pod has `terminationGracePeriodSeconds` (30 by default) between `SIGTERM` and `SIGKILL`. An app stops its adapters one after another, so the server close plus every adapter's `stopTimeoutMs` must fit inside it.

| Adapter | Default `stopTimeoutMs` |
| --- | --- |
| `@hexok/queue-redis` | 10000 |
| `@hexok/broadcast-redis` | 1000 |
| `@hexok/schedule-coordinator-redis` | 5000 |

## API

`Adapter(PortClass)` returns an abstract class that extends that port. Implement the port's methods. The compiler reports a missing one on the class.

| Member | Role |
| --- | --- |
| `token` | The port's token. An adapter keeps it and cannot replace it. |
| Port methods | Implement each abstract method from the port. |
| `start()` | Called by the application before the adapter is used. Override it to connect. The default resolves immediately. |
| `stop()` | Called by the application when it is finished with the adapter. Override it to disconnect. The default resolves immediately. |

`InMemoryPosts.token` is `PostRepository.token`.
