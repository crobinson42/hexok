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

- **Start.** Await `start()` before the adapter is used. It resolves once Redis is ready. Start every adapter before the process serves traffic or subscribes handlers. A call made before `start()` resolves rejects with code `NotStarted` or `Starting`.
- **Subscribe.** Await `subscribe()` before you rely on delivery. It resolves once Redis confirms the subscription. Redis pub/sub keeps no history, so a broadcast `subscribe()` that is not awaited misses messages published right after it. Its failure is also unhandled.
- **Stop.** Stop in the reverse order of start, and await each `stop()`. Close the gateway first so no new work arrives. `stop()` resolves within `stopTimeoutMs`, even when Redis is unreachable. A call after `stop()` rejects with code `Stopped`.
- **Unknown outcome.** A command still pending when `stop()` runs rejects with code `StoppedBeforeReply`. Redis may or may not have run it. Retry it when a duplicate is safe: an at-least-once queue whose handlers are idempotent. Do not retry it blindly when a duplicate does harm, such as a second one-time code or a broadcast that must arrive at most once. Treat it as possibly done, or check state first. Retry on a started adapter, never on the stopped one.
- **Wrong time.** `NotStarted`, `Starting`, and `Stopped` mean the call came outside `start()` and `stop()`. Fix the order. Do not retry them.
- **Start timeout.** `startTimeoutMs` makes `start()` reject when Redis is not ready in time. Without it, `start()` waits. Set it under an orchestrator such as Kubernetes: the process exits, and the orchestrator reports the failure and restarts it. Leave it unset for compose-style boot, where Redis can come up after the application.
- **Stop timeout.** Keep `stopTimeoutMs` below the orchestrator's grace period, such as Kubernetes `terminationGracePeriodSeconds`, so `stop()` finishes before the process is killed.

Branch on `code`, not on the message. Message text can change in any release.

```ts
try {
  await queue.publish('post.published', payload);
} catch (error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'StoppedBeforeReply') {
    // Redis may have stored it. Retry only when a duplicate is safe.
  }
  throw error;
}
```

## API

`Adapter(PortClass)` returns an abstract class that extends that port. Implement the port's methods. The compiler reports a missing one on the class.

| Member | Role |
| --- | --- |
| `token` | The port's token. An adapter keeps it and cannot replace it. |
| Port methods | Implement each abstract method from the port. |
| `start()` | Called by the application before the adapter is used. Override it to connect. The default resolves immediately. |
| `stop()` | Called by the application when it is finished with the adapter. Override it to disconnect. The default resolves immediately. |

`InMemoryPosts.token` is `PostRepository.token`.
