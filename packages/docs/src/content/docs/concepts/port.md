---
title: Port
description: The contract a use case or handler calls. An adapter implements it.
---

A port is the contract a use case or an event handler calls. You name it with `Port` and declare the methods the caller needs. An [adapter](/hexok/concepts/adapter/) is the class that implements those methods.

```ts
abstract class PostRepository extends Port('PostRepository') {
  abstract get(id: string): Promise<Post>
  abstract save(post: Post): Promise<void>
}
```

## Why it exists

Publishing a post has to save the post and announce the fact. Those are two different jobs, and each can be done more than one way: memory in a test, a database in the API, a broker when a worker lives in another process. The use case names the jobs. The port is the name. The adapter is the current way the job is done, and it can be replaced without editing `execute`.

## How it's used

`PublishPost` asks a `PostRepository` for the post and asks a `BlogEventPublisher` to take the published-post event. It never imports a database client or a queue.

```ts
abstract class BlogEventPublisher extends Port('BlogEventPublisher') {
  abstract publish(event: EventInstance<typeof BlogEvents>): Promise<void>
}

class PublishPost extends UseCase('post.publish') {
  constructor(
    private readonly posts: PostRepository,
    private readonly events: BlogEventPublisher,
  ) {
    super()
  }

  async execute(input: { id: string }): Promise<{ id: string }> {
    const post = await this.posts.get(input.id)
    post.publish(new Date())
    await this.posts.save(post)
    await this.events.publish(new PostPublished(post.toProps()))
    return { id: post.props.id }
  }
}
```

The methods are whatever this seam needs. A repository might offer `get` and `save`. A publisher might offer only `publish`. A mail port might offer `send`. The use case depends on the port class, and the composition root passes an adapter.

## API

`Port(token)` returns an abstract class. `token` is a string literal.

| Member | Role |
| --- | --- |
| `PostRepository.token` | The name you passed in. |
| Methods you declare | The contract. Mark them `abstract`. A subclass that leaves one unimplemented is a compile error. |

Each `Port(...)` call is its own class, with its own nominal identity. A class with the same method names is a different type. Extend one port. A second seam is a second `Port(...)` and a second class.

The adapter reuses this token. `InMemoryPosts.token` is `'PostRepository'` when `InMemoryPosts` extends `Adapter(PostRepository)`.
