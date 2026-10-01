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

An in-memory repository is enough to walk the publish story. The API process can later substitute a database class that extends the same port. The composition root constructs the adapter, starts it, and hands it to `PublishPost`.

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
const publishPost = new PublishPost(posts, events)
```

The defaults of `start` and `stop` resolve immediately, so this adapter can leave them alone. A database adapter overrides `start` to connect and `stop` to disconnect. The application calls them. The use case calls `get` and `save`.

## API

`Adapter(PortClass)` returns an abstract class that extends that port. Implement the port's methods. The compiler reports a missing one on the class.

| Member | Role |
| --- | --- |
| `token` | The port's token. An adapter keeps it. |
| Port methods | Implement each abstract method from the port. |
| `start()` | Called by the application before the adapter is used. Override it to connect. The default resolves immediately. |
| `stop()` | Called by the application when it is finished with the adapter. Override it to disconnect. The default resolves immediately. |

The token is fixed by the port. `InMemoryPosts.token` is `PostRepository.token`.
