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

An in-memory repository is enough to walk the publish story. The API process can later substitute a database class that extends the same port. The composition root constructs the adapter, starts it, and hands it to `PublishPost`.

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
const publishPost = new PublishPost(posts, events);
```

Store `toProps()` (or a mapped document) and rebuild with `restore` on the way out. Call `commit()` after the write succeeds.

The defaults of `start` and `stop` resolve immediately, so an in-memory adapter can leave them alone. A database adapter overrides `start` to connect and `stop` to disconnect. The application calls them. The use case calls `get` and `save`.

A publisher adapter accepts the catalog instance and, on a real transport, sends `BlogEvents.message(event)`. A subscription adapter owns the consumer loop. It parses with `BlogEvents.parse`, then calls each subscribed handler. It does not hide handler errors. Ack, retry, prefetch, and consumer groups live here, and only when the broker has them.

One adapter implements one port. A second port is a second class.

## API

`Adapter(PortClass)` returns an abstract class that extends that port. Implement the port's methods. The compiler reports a missing one on the class.

| Member | Role |
| --- | --- |
| `token` | The port's token. An adapter keeps it and cannot replace it. |
| Port methods | Implement each abstract method from the port. |
| `start()` | Called by the application before the adapter is used. Override it to connect. The default resolves immediately. |
| `stop()` | Called by the application when it is finished with the adapter. Override it to disconnect. The default resolves immediately. |

`InMemoryPosts.token` is `PostRepository.token`.
